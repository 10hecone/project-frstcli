# Plan d'implémentation : TUI moderne (React + Ink) pour FranceStudent Code

> Statut : plan uniquement. Rien n'est encore implémenté.
> Contrainte principale : l'ancien CLI (`frstcli`, `src/main.js`, `src/cli/ui.js`) reste disponible et fonctionnel à chaque étape.

---

## 1. Analyse de l'existant

### 1.1 Lancement
- `package.json` : CommonJS, Node >= 22, `bin.frstcli -> index.js`, `files: [index.js, src]`.
- Dépendances déjà installées dans le projet (`npm install ink-text-input ink-spinner ink-select-input ink-markdown react ink` et `npm install -D tsx`), pas encore utilisées dans le code :
  - `ink` (^8.0.0) et `react` (^19.3.1) : moteur de rendu de la TUI.
  - `ink-text-input` (^6.0.0) : champ de saisie, base possible de `PromptInput`.
  - `ink-spinner` (^5.0.0) : indicateurs de chargement (`Spinner`).
  - `ink-select-input` (^6.2.0) : listes de choix (`ConfirmDialog` o/n/t, `/model`).
  - `ink-markdown` (^1.0.4) : rendu Markdown dans Ink. Paquet ancien : vérifier à l'étape 0 sa compatibilité avec Ink 8 et React 19, sinon garder `renderMarkdownLine`.
  - `tsx` (devDependency) : exécute directement les fichiers `.jsx` sans étape de build (développement, tests). Absent de `devDependencies` dans `package.json` au moment de la rédaction : à vérifier.
- `index.js` charge `dotenv` (facultatif), puis `run()` de `src/main.js`.
- `src/main.js` : `main()` = bannière, `initAuth()` / `promptAndLogin()`, restauration des conversations, puis boucle `askInput()` → `/commande` (`handleCommand`), question sur le projet, `runAgent()` ou `chatNormally()`.

### 1.2 Logique métier (à partager telle quelle)
- `src/api/*` : auth (cookie → JWT), login WHMCS, `requestModel()` avec streaming SSE, `onDelta`, relances, `cancelStream()`.
- `src/agent/*` : boucle agent (`runAgent`), prompt, parsing JSON, lots de lecture.
- `src/tools/*` : outils fichiers, `run_command`, jobs, journal `/undo`, sécurité.
- `src/project/*` : mémoire, conversations, contexte projet, `FRSTCLI.md`.
- `src/state.js` : état global (conversation, modèle, projet, mode, `autoApprove`).

### 1.3 Couplage avec le terminal (le vrai problème)
La logique métier appelle directement le singleton `ui` de `src/cli/ui.js` ou écrit sur stdout :

| Module | Appels d'interface |
|---|---|
| `agent/agent.js` | `ui.tool`, `ui.result`, `ui.plan`, `ui.assistant`, `ui.spinner`, `ui.confirm` (prolonger les tours), `c.red` |
| `api/api.js` | `ui.onInterrupt` (Ctrl+C → `cancelStream`), `ui.warn`, `ui.debug` |
| `api/auth.js`, `api/login.js` | `ui.spinner("Connexion")`, saisie e-mail / mot de passe (`ask`, `askSecret`) |
| `project/project-context.js` | `ui.spinner("Analyse du projet i/n")` |
| `tools/command/index.js` | `ui.askCommand` (o/n/t), `ui.onInterrupt`, `ui.commandLine` (sortie en direct) |
| `tools/fs/*.js` | `ui.confirm`, `ui.result` (résumé, +/- lignes) |
| `tools/diff.js` | `printDiff` → `console.log` direct |
| `cli/commands.js` | ~25 `console.log` directs (`/help`, `/tree`, `/read`, `/changes`, `/memory`, `/usage`, `/history`...) |
| `main.js` | `chatNormally` écrit sur `process.stdout` (spinner, `createMarkdownStream`) |

`src/cli/ui.js` repose aussi sur `readline` et sur des API privées (`_ttyWrite`, `_writeToOutput`). Ink prend le contrôle de stdin en mode brut : les deux ne peuvent **pas** cohabiter dans le même processus. D'où la nécessité d'une couche d'abstraction.

### 1.4 Contraintes techniques d'Ink
- Ink et les versions récentes de React sont des modules **ESM** ; le projet est **CommonJS**. Depuis du CommonJS, on les charge avec `await import("ink")` (le `require()` d'un module ESM peut échouer s'il utilise un `await` de premier niveau).
- Node n'exécute pas le JSX : il faut une étape de compilation. Choix proposé : **esbuild** (devDependency, rapide, sans configuration Babel).
- Ink redessine la zone dynamique à chaque rendu : tout ce qui est terminé doit aller dans `<Static>` (écrit une seule fois, puis laissé au défilement naturel du terminal). C'est la clé du rendu sans scintillement.
- Vérifier à l'étape 0 l'API exacte de la version d'Ink installée (`render`, `Static`, `Box`, `Text`, `useInput`, `useApp`, `useStdout`, options `exitOnCtrlC` et `patchConsole`).

---

## 2. Architecture cible

```
index.js                 → ancien CLI (inchangé)          commande : frstcli
bin/frst.js              → nouvelle TUI (même terminal)    commande : frst
                           frst --classic → ancien CLI

src/
  ui-bridge.js           ← NOUVEAU : « port » d'interface (une seule API pour les deux UI)
  core/
    session.js           ← NOUVEAU : bootstrap (auth, conversations) + routage d'une saisie
    chat.js              ← NOUVEAU : chat simple sans rendu (extrait de main.js)
  cli/ui.js              ← adaptateur classique (readline + ANSI), devient l'implémentation par défaut
  main.js                ← boucle classique, utilise core/session.js
  tui/
    store.js             ← NOUVEAU (CommonJS pur, testable) : réducteur des événements
    adapter.js           ← NOUVEAU (CommonJS) : implémentation du port qui alimente le store
    input-model.js       ← NOUVEAU (CommonJS pur) : édition multiligne, historique
    history-file.js      ← NOUVEAU : historique des saisies persistant (CONFIG.dataDir)
    app.jsx              ← composant racine
    components/*.jsx     ← Welcome, Transcript, Message, ToolCall, Diff, PromptInput,
                            ConfirmDialog, StatusBar, Spinner
    index.jsx            ← render(<App/>), branchement de l'adaptateur
scripts/build-tui.js     ← esbuild : src/tui/index.jsx → dist/tui.mjs
```

### 2.1 Le port d'interface (`src/ui-bridge.js`)
Un objet unique qui délègue à l'implémentation active :

- Affichage : `info`, `warn`, `error`, `debug`, `print(lignes)`, `assistant(texte)`, `plan(étapes)`, `tool(nom, détail)`, `result(texte, { tone })`, `diff(données)`, `commandLine(texte)`.
- Flux : `stream()` → `{ write(delta), end() }` pour la réponse SSE en cours.
- Activité : `spinner(label)` → `{ update(label), stop() }`.
- Interaction : `confirm(question)` → booléen, `askCommand(question, préfixe)` → `o|n|t`, `ask(question)`, `askSecret(question)`.
- Interruption : `onInterrupt(handler)` → fonction de désinscription.
- `setUiBackend(impl)` / `getUiBackend()`.

Compatibilité : `src/cli/ui.js` continue d'exporter `ui` et `c` ; son `ui` devient l'implémentation par défaut du port. Les modules métier passent progressivement de `require("../cli/ui").ui` à `require("../ui-bridge").ui` ; tant que la TUI n'est pas lancée, le comportement est strictement identique.

Règle : la logique métier ne produit plus de **couleurs ANSI** ni de `console.log` ; elle envoie des données structurées (`tone: "error"`, lignes de diff `{ type, num, text }`). Chaque interface décide du rendu.

### 2.2 Logique partagée (`src/core/`)
- `bootstrap({ login })` : `initAuth`, connexion si besoin (via `ui.ask` / `ui.askSecret`), restauration des conversations.
- `handleInput(input)` : la logique de routage aujourd'hui dans la boucle de `main.js` (commande, question projet, avertissement sans projet, agent ou chat).
- `chat.send(input, { onDelta })` : la partie métier de `chatNormally` (contexte projet, `requestModel`, `record`, `conversations.touch`).

Les deux interfaces appellent ces fonctions : aucune duplication de l'API, du SSE ni des outils.

### 2.3 Rendu TUI sans scintillement
- `<Static items={transcript}>` : bannière d'accueil, messages terminés, appels d'outils terminés. Écrits une fois, puis défilement natif du terminal (pas de défilement simulé).
- Zone dynamique (petite) : message en cours de streaming (seulement ses dernières lignes si plus haut que l'écran), dialogue de confirmation, zone de saisie, barre d'état.
- Deltas SSE regroupés (tampon + rendu toutes les ~40 ms) pour limiter les redessins.
- Markdown : réutiliser `renderMarkdownLine` / `renderInline` de `cli/ui.js` (ou un module extrait `src/markdown.js`) ; Ink affiche correctement les chaînes contenant des codes ANSI.
- Les lignes complètes d'un message en cours peuvent être déplacées vers `<Static>` au fil du streaming pour garder la zone dynamique courte.

### 2.4 Lancement « comme Claude Code »
- Nouvelle entrée `bin.frst` → `bin/frst.js` : ouvre la TUI **dans le terminal courant** (aucune nouvelle fenêtre).
- `frstcli` reste l'ancien CLI ; `frst --classic` (ou `FRST_UI=classic`) lance aussi l'ancien CLI.
- Repli automatique vers l'ancien CLI si stdin ou stdout n'est pas un TTY, ou si `dist/tui.mjs` est absent (avec un message).
- Installation locale : `npm install` (déclenche `prepare` → build), puis `npm link` (ou `npm install -g .`). npm crée les lanceurs `frst.cmd` / `frst.ps1` sous Windows.

### 2.5 Compilation
- `scripts/build-tui.js` (esbuild) : entrée `src/tui/index.jsx`, sortie `dist/tui.mjs`, `format: esm`, `platform: node`, `jsx: automatic`, paquets npm externes.
- **Important** : les modules CommonJS de `src/` (hors `src/tui`) doivent rester **externes** (petit plugin esbuild) et être chargés via `createRequire(import.meta.url)`. Sinon, `state`, le port d'interface ou la mémoire seraient dupliqués dans le bundle et les singletons divergeraient.
- Scripts : `build:tui`, `prepare` (build après `npm install`), `pretest` (build avant les tests), `start:tui`.
- `dist/` ajouté à `.gitignore` et à `files` dans `package.json`.

---

## 3. Étapes

Chaque étape laisse `npm test` vert et `frstcli` fonctionnel.

### Étape 0 — Préparation de la chaîne de build
- **Fichiers :** `package.json`, `scripts/build-tui.js` (nouveau), `.gitignore`, `src/tui/index.jsx` (squelette), `bin/frst.js` (nouveau).
- **Modifications :** ajouter `esbuild` et `ink-testing-library` en devDependencies ; scripts `build:tui`, `prepare`, `pretest`, `start:tui` ; `bin.frst` ; `files` += `bin`, `dist` ; `dist/` ignoré par git. `bin/frst.js` : si `--classic`, `FRST_UI=classic` ou pas de TTY → `require("../src/main").run()` ; sinon `import("../dist/tui.mjs")`. Le squelette affiche « FranceStudent Code (TUI) » puis quitte.
- **Dépendances :** vérifier les versions installées d'`ink` et `react` (et `react` compatible avec la version d'Ink).
- **Tests :** `test/tui-launcher.test.js` (choix classique/TUI selon arguments, variable d'environnement et TTY, en isolant la fonction de décision).
- **Prompt :**
  > Étape 0 de IMPLEMENTATION_PLAN.md. Mets en place la chaîne de build de la future TUI sans toucher au comportement de `frstcli`. Ajoute `esbuild` et `ink-testing-library` en devDependencies (`npm install -D`). Crée `scripts/build-tui.js` qui compile `src/tui/index.jsx` en `dist/tui.mjs` (esm, platform node, jsx automatic, paquets npm externes, et un plugin qui laisse externes tous les fichiers CommonJS de `src/` hors `src/tui`). Ajoute dans `package.json` les scripts `build:tui`, `prepare`, `pretest`, `start:tui`, la commande `bin.frst` -> `bin/frst.js`, et `bin` + `dist` dans `files`. Ajoute `dist/` à `.gitignore`. Crée `bin/frst.js` (CommonJS, shebang) avec une fonction exportée `chooseInterface({ argv, env, isTTY, hasBundle })` qui renvoie `classic` ou `tui` ; `--classic`, `FRST_UI=classic`, absence de TTY ou de bundle → classic (avec un message si le bundle manque). Crée un squelette `src/tui/index.jsx` qui rend un simple texte avec Ink puis quitte. Écris `test/tui-launcher.test.js` pour `chooseInterface`. Vérifie avec `npm run build:tui`, `npm test`, puis indique comment tester `npm link` et `frst`. Ne modifie ni `index.js` ni `src/main.js`.

### Étape 1 — Port d'interface (`src/ui-bridge.js`)
- **Fichiers :** `src/ui-bridge.js` (nouveau), `src/cli/ui.js` (ajouts : `print`, `stream`, `diff`, `ask`, `askSecret` exposés dans `ui`), tests.
- **Modifications :** créer le port qui délègue à un backend (par défaut : le `ui` classique, chargé à la demande pour éviter les cycles). Aucune migration des appelants à cette étape.
- **Dépendances :** aucune nouvelle.
- **Tests :** `test/ui-bridge.test.js` : délégation, changement de backend, `onInterrupt` renvoie une désinscription, méthodes manquantes → erreur claire.
- **Prompt :**
  > Étape 1 de IMPLEMENTATION_PLAN.md. Crée `src/ui-bridge.js` (CommonJS) : un objet `ui` dont chaque méthode (`info`, `warn`, `error`, `debug`, `print`, `assistant`, `plan`, `tool`, `result`, `diff`, `commandLine`, `stream`, `spinner`, `confirm`, `askCommand`, `ask`, `askSecret`, `onInterrupt`, `banner`, `prompt`) délègue au backend actif, plus `setUiBackend(impl)` et `getUiBackend()`. Le backend par défaut est le `ui` de `src/cli/ui.js`, chargé à la demande pour éviter un cycle avec `state`. Complète `src/cli/ui.js` pour que son `ui` implémente toutes ces méthodes en réutilisant l'existant (`print` = console.log de chaque ligne, `stream` = `createMarkdownStream`, `diff` = rendu actuel, `ask`/`askSecret` = fonctions existantes, `result(text, { tone })` colore en rouge si `tone === "error"`). Ne change aucun autre module.Ajoute `test/ui-bridge.test.js`. Lance `npm test`.

### Étape 2 — Migration de la logique métier vers le port
- **Fichiers :** `agent/agent.js`, `api/api.js`, `api/auth.js`, `api/login.js`, `project/project-context.js`, `tools/command/index.js`, `tools/fs/*.js`, `tools/diff.js`, `cli/commands.js`.
- **Modifications :** remplacer `require("../cli/ui").ui` par le port ; remplacer `c.red(...)` dans les résultats par `ui.result(texte, { tone: "error" })` ; séparer `tools/diff.js` en `buildDiff(old, new, maxLines)` (données pures `{ type, num, text }` + compteurs) et `printDiff` (classique, inchangé visuellement) ; les outils appellent `ui.diff(buildDiff(...))` ; remplacer les `console.log` de `commands.js` par `ui.print(...)` (les couleurs `c.*` restent acceptées dans `print` pour cette étape).
- **Dépendances :** étape 1.
- **Tests :** tous les tests existants doivent passer sans modification de comportement ; ajouter `test/diff-build.test.js` ; adapter les tests qui simulent `ui` (`command-pipeline`, `command-run-permissions`) pour simuler le backend du port.
- **Prompt :**
  > Étape 2 de IMPLEMENTATION_PLAN.md. Migre la logique métier vers `src/ui-bridge.js` sans changer l'affichage de l'ancien CLI. Dans `src/agent/agent.js`, `src/api/api.js`, `src/api/auth.js`, `src/api/login.js`, `src/project/project-context.js`, `src/tools/command/index.js`, `src/tools/fs/*.js` et `src/cli/commands.js`, importe `ui` depuis le port au lieu de `src/cli/ui.js`. Remplace les `ui.result(c.red(x))` par `ui.result(x, { tone: "error" })`. Découpe `src/tools/diff.js` : `buildDiff(oldText, newText, maxLines)` renvoie des données pures (lignes `{ type: "+"|"-"|" "|"gap"|"more", num, text }`, `added`, `removed`), et `printDiff` garde exactement le rendu actuel en s'appuyant dessus ; les outils `write_file` et `edit_file` passent par `ui.diff`. Remplace les `console.log` de `src/cli/commands.js` par `ui.print`. Lis chaque fichier avant de le modifier, fais des modifications minimales, adapte les tests qui remplacent `ui` pour qu'ils passent par `setUiBackend`, ajoute `test/diff-build.test.js`, puis lance `npm test` et vérifie manuellement `npm start`.

### Étape 3 — Logique de session partagée (`src/core/`)
- **Fichiers :** `src/core/session.js`, `src/core/chat.js` (nouveaux), `src/main.js`.
- **Modifications :** extraire de `main.js` : `bootstrap()`, `handleInput(input)` (retourne `{ exit: true }` pour `/exit`) et la partie métier de `chatNormally` (`chat.send(input, { onDelta })`). `main.js` garde la boucle `askInput` + le rendu classique et exporte toujours `main`, `run`, `chatNormally`.
- **Dépendances :** étapes 1-2.
- **Tests :** `test/core-session.test.js` (routage commande / agent / chat / question projet avec `runAgent`, `requestModel` et `handleCommand` simulés), `test/core-chat.test.js` (contexte projet joint au premier message seulement, `conversations.touch`).
- **Prompt :**
  > Étape 3 de IMPLEMENTATION_PLAN.md. Lis `src/main.js` en entier. Crée `src/core/chat.js` avec `send(input, { onDelta })` qui contient la logique métier de `chatNormally` (activation de la conversation chat, contexte projet au premier message, `api.requestModel`, `record`, `conversations.touch`, et renvoie `{ response, newChatId }`), sans aucun affichage. Crée `src/core/session.js` avec `bootstrap()` (initAuth, connexion via `promptAndLogin` si besoin, restauration des conversations ; renvoie `{ ok, reason }`) et `handleInput(input, { onChatDelta })` qui reprend le routage de la boucle de `main()` et renvoie `{ exit }`. Réécris `src/main.js` pour utiliser ces fonctions en gardant exactement le même affichage (spinner, Markdown en streaming, messages). Conserve les exports `main`, `run`, `chatNormally`. Ajoute `test/core-session.test.js` et `test/core-chat.test.js` avec des simulations, puis `npm test`.

### Étape 4 — Store et adaptateur TUI (sans JSX)
- **Fichiers :** `src/tui/store.js`, `src/tui/adapter.js` (nouveaux, CommonJS).
- **Modifications :** store minimal (état + `dispatch` + `subscribe`) : `transcript` (entrées terminées : `welcome`, `user`, `assistant`, `tool`, `result`, `plan`, `diff`, `info`, `warn`, `error`, `print`), `live` (message en streaming), `spinner`, `pendingPrompt` (confirmation, question, secret), `status`. L'adaptateur implémente le port : les méthodes d'affichage poussent des entrées ; `confirm`/`askCommand`/`ask`/`askSecret` créent un `pendingPrompt` et renvoient une promesse résolue par l'UI ; `onInterrupt` gère une pile de gestionnaires ; `stream()` regroupe les deltas (~40 ms).
- **Dépendances :** étapes 1-3.
- **Tests :** `test/tui-store.test.js`, `test/tui-adapter.test.js` (ordre des entrées, résolution de `confirm`, `t` → `autoApprove`, regroupement des deltas avec horloge injectée, désinscription des interruptions).
- **Prompt :**
  > Étape 4 de IMPLEMENTATION_PLAN.md. Crée en CommonJS pur, sans React : `src/tui/store.js` (createStore avec `getState`, `dispatch`, `subscribe`, et un réducteur pour les actions `append`, `liveStart`, `liveAppend`, `liveEnd`, `spinner`, `prompt`, `promptResolved`, `status`) et `src/tui/adapter.js` (`createTuiBackend(store, { now, setTimer })`) qui implémente toutes les méthodes du port `src/ui-bridge.js`. Les confirmations renvoient une promesse résolue quand l'UI appelle `resolvePrompt(id, valeur)` ; reproduis la sémantique actuelle de `ui.confirm` (réponse `t` = autoApprove pour la session, sauf pour `askCommand` qui ne doit jamais être auto-approuvé). `stream()` met les deltas en tampon et les envoie au store au plus toutes les 40 ms, `end()` vide le tampon. Ajoute `test/tui-store.test.js` et `test/tui-adapter.test.js`, puis `npm test`.

### Étape 5 — Squelette de l'App et rectangle d'accueil
- **Fichiers :** `src/tui/index.jsx`, `src/tui/app.jsx`, `src/tui/components/Welcome.jsx`, `src/tui/components/Transcript.jsx`.
- **Modifications :** `index.jsx` charge le port, le store et `core/session` via `createRequire`, installe l'adaptateur, appelle `render(<App/>, { exitOnCtrlC: false })`, puis `bootstrap()`. `Welcome` : cadre arrondi (`Box borderStyle="round"`) avec nom, version, modèle (`state.model`), répertoire courant (`state.workspace` ou `process.cwd()`), astuces (`/help`, `frst --classic`). Le Welcome est la première entrée de `<Static>`.
- **Dépendances :** étapes 0 et 4.
- **Tests :** `test/tui-render.test.js` : construit le bundle (`pretest`), rend `App` avec `ink-testing-library`, vérifie le cadre, le modèle et le dossier.
- **Prompt :**
  > Étape 5 de IMPLEMENTATION_PLAN.md. Remplace le squelette `src/tui/index.jsx` par le vrai point d'entrée : charge via `createRequire(import.meta.url)` les modules CommonJS (`src/ui-bridge.js`, `src/tui/store.js`, `src/tui/adapter.js`, `src/core/session.js`, `src/state.js`), installe le backend TUI avec `setUiBackend`, rend `<App store={store}/>` avec `exitOnCtrlC: false`, puis lance `bootstrap()`. Crée `src/tui/app.jsx`, `src/tui/components/Welcome.jsx` (cadre arrondi : FranceStudent Code, version de package.json, modèle courant, répertoire courant, astuces) et `src/tui/components/Transcript.jsx` (`<Static>` sur `transcript`). Exporte `App` pour les tests. Ajoute `test/tui-render.test.js` qui importe le bundle de test et utilise `ink-testing-library`. Vérifie `npm run build:tui`, `npm test`, puis `frst` et `frstcli` à la main.

### Étape 6 — Conversation : streaming SSE, Markdown, outils
- **Fichiers :** `src/markdown.js` (extrait de `cli/ui.js`, réexporté par lui), `components/Message.jsx`, `components/LiveMessage.jsx`, `components/ToolCall.jsx`, `components/Diff.jsx`, `components/Plan.jsx`.
- **Modifications :** messages utilisateur (préfixe `>`), réponse en streaming (zone dynamique limitée à la hauteur de l'écran, lignes complètes déplacées vers `<Static>`), Markdown via `renderMarkdownLine`, outils au style Claude Code (`● Lire src/a.js` puis `⎿ résumé`), diff coloré, plan numéroté, sortie en direct de `run_command` repliée.
- **Dépendances :** étapes 2, 4, 5.
- **Tests :** rendu de chaque composant avec `ink-testing-library` ; test d'un flux complet simulé (`requestModel` factice qui envoie des deltas) ; vérifier que les tests Markdown existants (`test/markdown.test.js`) passent toujours.
- **Prompt :**
  > Étape 6 de IMPLEMENTATION_PLAN.md. Déplace le Markdown léger de `src/cli/ui.js` vers `src/markdown.js` (même API, réexportée par `src/cli/ui.js` pour ne rien casser). Dans la TUI, crée `Message.jsx`, `LiveMessage.jsx`, `ToolCall.jsx`, `Diff.jsx` et `Plan.jsx`. Le message en cours n'affiche que ses dernières lignes (hauteur du terminal via `useStdout`), et les lignes terminées passent dans `<Static>` pour éviter tout scintillement. Les outils s'affichent comme dans Claude Code (puce, libellé de `TOOL_LABELS`, détail, puis `⎿` et le résumé, en rouge si `tone === "error"`). Branche la saisie utilisateur sur `handleInput` de `src/core/session.js` avec un `onChatDelta` qui utilise `ui.stream()`. Ajoute des tests de rendu et un test de flux simulé, garde `test/markdown.test.js` vert, puis `npm test`.

### Étape 7 — Zone de saisie multiligne, historique, raccourcis
- **Fichiers :** `src/tui/input-model.js`, `src/tui/history-file.js` (CommonJS), `components/PromptInput.jsx`.
- **Modifications :** modèle d'édition pur (curseur, insertion, suppression, lignes). Raccourcis : Entrée = envoyer ; `\\` + Entrée, Ctrl+J ou Alt+Entrée = nouvelle ligne ; ←/→, Début/Fin, Ctrl+A / Ctrl+E ; ↑/↓ = ligne précédente ou historique ; Échap = effacer ; Ctrl+U / Ctrl+K ; Ctrl+L = effacer l'écran ; Tab = compléter les commandes `/` ; collage multiligne (morceau reçu d'un coup) ; Ctrl+V lit le presse-papier (réutiliser `readClipboard`). Historique persistant (`CONFIG.dataDir/input-history.json`, 200 entrées, sans doublons consécutifs). Ctrl+C : interrompt la génération ou la commande en cours ; sinon efface la saisie ; deux fois de suite = quitter. Ctrl+D sur saisie vide = quitter.
- **Dépendances :** étapes 4-6.
- **Tests :** `test/tui-input-model.test.js` (édition, curseur, historique), `test/tui-history-file.test.js` (persistance, limite), test de rendu de `PromptInput`.
- **Prompt :**
  > Étape 7 de IMPLEMENTATION_PLAN.md. Crée `src/tui/input-model.js` (fonctions pures sur `{ lines, row, col }` : insertion, retour arrière, suppression, déplacements, nouvelle ligne, effacement, collage), `src/tui/history-file.js` (historique persistant dans `CONFIG.dataDir`, 200 entrées, écriture atomique, sans doublons consécutifs) et `src/tui/components/PromptInput.jsx` avec `useInput`. Raccourcis : Entrée envoie, `\\` + Entrée / Ctrl+J / Alt+Entréeajoutent une ligne, ↑/↓ naviguent dans les lignes puis l'historique, Échap efface, Ctrl+U/K/A/E, Ctrl+L efface l'écran, Tab complète les commandes slash (liste issue de `/help`), Ctrl+V colle le presse-papier (extrais `readClipboard` de `src/cli/ui.js` dans un module partagé). Ctrl+C appelle d'abord les gestionnaires `onInterrupt` du backend, sinon efface la saisie, et quitte au second appui ; Ctrl+D sur saisie vide quitte. Ajoute les tests unitaires et un test de rendu, puis `npm test`.

### Étape 8 — Confirmations, questions et connexion dans la TUI
- **Fichiers :** `components/ConfirmDialog.jsx`, `components/TextPrompt.jsx` (avec masquage pour le mot de passe), `app.jsx`.
- **Modifications :** quand `pendingPrompt` existe, la saisie est remplacée par un dialogue : confirmation o/n/t (flèches + Entrée ou touches directes), choix de commande (`askCommand` avec le préfixe proposé), question libre, mot de passe masqué (pour `promptAndLogin` et `/login`). Le diff ou le résumé de l'outil reste visible au-dessus.
- **Dépendances :** étapes 4, 6, 7.
- **Tests :** rendu et résolution des dialogues ; `askCommand` ne doit jamais être auto-approuvé ; le secret n'apparaît jamais dans la sortie rendue.
- **Prompt :**
  > Étape 8 de IMPLEMENTATION_PLAN.md. Crée `ConfirmDialog.jsx` (o = oui une fois, n = non, t = toujours ; navigation aux flèches et touches directes ; Échap = non) et `TextPrompt.jsx` (question libre, option `secret` qui affiche des `•`). Dans `app.jsx`, affiche le dialogue à la place de `PromptInput` quand `pendingPrompt` existe et résous la promesse via l'adaptateur. Vérifie que `write_file`, `edit_file`, `delete_path`, `run_command`, la prolongation des tours de l'agent, `/login` et la connexion au démarrage fonctionnent dans la TUI. Ajoute des tests (dont : le mot de passe n'apparaît jamais dans `lastFrame()`, `askCommand` ignore `autoApprove`), puis `npm test`.

### Étape 9 — Barre d'état et indicateurs de chargement
- **Fichiers :** `components/StatusBar.jsx`, `components/Spinner.jsx`, `adapter.js`.
- **Modifications :** spinner animé avec libellé (`Réflexion (tour n)`, `Analyse du projet i/n`, `Connexion`), durée écoulée et indication « Ctrl+C pour interrompre ». Barre d'état : mode (`auto/agent/chat`), modèle, projet, `auto-approve`, jobs en arrière-plan, tokens de la session (`api.usage`), branche git si connue. Animation à intervalle modéré (~100 ms) et uniquement pendant une activité.
- **Dépendances :** étapes 4-8.
- **Tests :** rendu de la barre avec différents états ; le spinner s'arrête et disparaît à `stop()`.
- **Prompt :**
  > Étape 9 de IMPLEMENTATION_PLAN.md. Crée `Spinner.jsx` (animation ~100 ms, libellé, durée écoulée, rappel Ctrl+C) et `StatusBar.jsx` (mode, modèle, nom du projet, auto-approbation, nombre de jobs actifs via `src/tools/command/jobs.js`, tokens de `api.usage`). Mets à jour l'adaptateur pour que `spinner(label)` alimente le store (`update`, `stop`). Le timer d'animation ne doit tourner que pendant une activité. Ajoute des tests de rendu, puis `npm test`.

### Étape 10 — Fluidité, robustesse et finitions
- **Fichiers :** `src/tui/*`, `bin/frst.js`.
- **Modifications :** redimensionnement du terminal (recalcul des hauteurs), `NO_COLOR`, sortie propre (restauration du curseur et du mode brut, arrêt des jobs, fermeture de la mémoire), `/clear` (effacer l'écran et réafficher l'accueil), `/exit` et `/quit`, capture des `console.log` restants (option `patchConsole` d'Ink) pour ne jamais casser l'affichage, vérification sous Windows Terminal, PowerShell, cmd et sur un terminal Linux/macOS. Mesurer : aucune ligne redessinée en dehors de la zone dynamique pendant un long streaming.
- **Dépendances :** toutes les étapes précédentes.
- **Tests :** test de sortie propre, test de `/clear`, test de l'adaptateur sous `NO_COLOR`.
- **Prompt :**
  > Étape 10 de IMPLEMENTATION_PLAN.md. Rends la TUI robuste : gère le redimensionnement (`useStdout` + événement `resize`), `NO_COLOR`, `/clear` (efface l'écran et réaffiche l'accueil), `/exit` et `/quit`, et une sortie propre (arrêt des jobs en arrière-plan, `memory.close()`, restauration du terminal) sur Ctrl+C double, Ctrl+D et erreur fatale. Active `patchConsole` pour que tout `console.log` résiduel passe au-dessus de la zone dynamique. Recherche avec search_files les derniers `console.log` / `process.stdout.write` dans la logique métier et fais-les passer par le port. Ajoute les tests correspondants, puis `npm test`, et donne une liste de vérifications manuelles (Windows Terminal, PowerShell, long streaming, gros diff).

### Étape 11 — Documentation et CI
- **Fichiers :** `README.md`, `docs/architecture.md`, `docs/tui.md` (nouveau), `.github/workflows/ci.yml`.
- **Modifications :** expliquer `frst` vs `frstcli` / `frst --classic`, l'installation (`npm install`, `npm link`), les raccourcis, l'architecture du port d'interface ; la CI exécute déjà `npm test` (le `pretest` construit le bundle) : vérifier qu'elle passe sur Ubuntu et Windows.
- **Prompt :**
  > Étape 11 de IMPLEMENTATION_PLAN.md. Mets à jour `README.md` (installation, commandes `frst`, `frst --classic`, `frstcli`, raccourcis clavier), `docs/architecture.md` (port `src/ui-bridge.js`, `src/core/`, `src/tui/`, build esbuild) et crée `docs/tui.md` (composants, store, adaptateur, règles anti-scintillement,ajout d'un composant). Vérifie que `.github/workflows/ci.yml` construit bien le bundle via `pretest`. Lance `npm test`.

---

## 4. Risques et points de vigilance
- **ESM / CommonJS** : ne jamais dupliquer les singletons (`state`, port, mémoire, jobs) dans le bundle ; tester que `require("src/state")` et l'état vu par la TUI sont le même objet.
- **stdin** : ne jamais créer l'interface `readline` de `cli/ui.js` quand la TUI est active (elle entrerait en conflit avec Ink).
- **Ctrl+C** : avec `exitOnCtrlC: false`, c'est l'application qui doit annuler le flux (`cancelStream`) et tuer les commandes (`killTree`).
- **Shift+Entrée** n'est pas distinguable dans beaucoup de terminaux : prévoir `\\` + Entrée, Ctrl+J et Alt+Entrée.
- **Version d'Ink** : contrôler l'API réelle de la version installée avant l'étape 5.
- **Tests** : `npm test` = `node --test test/*.test.js` ; les tests TUI restent en `.test.js` et importent le bundle construit par `pretest`.

---

## 5. Checklist d'avancement

- [x] Étape 0 — Build esbuild, `bin/frst.js`, scripts, `dist/` ignoré
- [x] Étape 1 — Port d'interface `src/ui-bridge.js`
- [x] Étape 2 — Logique métier migrée vers le port (diff en données, `ui.print`)
- [x] Étape 3 — `src/core/session.js` et `src/core/chat.js`, `main.js` allégé
- [x] Étape 4 — Store et adaptateur TUI (CommonJS, testés)
- [x] Étape 5 — App Ink + rectangle d'accueil
- [x] Étape 6 — Streaming SSE, Markdown, outils, diff, plan
- [x] Étape 7 — Saisie multiligne, historique persistant, raccourcis
- [x] Étape 8 — Confirmations, choix de commande, connexion
- [x] Étape 9 — Barre d'état et spinners
- [ ] Étape 10 — Fluidité, redimensionnement, sortie propre
- [ ] Étape 11 — Documentation et CI

Vérifications à chaque étape :
- [ ] `npm test` vert (Windows et Linux en CI)
- [ ] `frstcli` (ancien CLI) testé à la main : chat, agent, `/project`, `/undo`, confirmations
- [ ] `frst` testé à la main à partir de l'étape 5
