# Architecture de FranceStudent CLI

## Vue d'ensemble
Le CLI est un outil en ligne de commande (Node.js) qui relie un terminal à l'assistant FranceStudent. Sans projet sélectionné, il fonctionne en chat normal. Avec `/project`, l'agent peut lire et modifier des fichiers locaux, après confirmation de chaque écriture.

## Modules (src/)
- `main.js` : point d'entrée et boucle REPL, qui route chaque saisie vers une commande, l'agent ou le chat normal. Gère aussi `/preprompt` et `/profil` (`handleProfileCommand`), transmet chaque demande à `profile.observe` et joint le pré-prompt au premier message d'une conversation de chat.
- `cli/commands.js` : commandes slash (`/project`, `/undo`, `/model`, etc.).
- `agent/agent.js` : boucle agent entre le modèle et les outils, avec garde-fou anti-répétition.
- `agent/prompt.js` : construction du prompt de l'agent (catalogue d'outils, format JSON, règles de fiabilité).
- `tools/tools.js` : façade des outils. Elle réexporte TOOLS, validateToolCall et describeCall, et définit summarizeResult, setProject, unsetProject et undoLast. Les outils eux-mêmes sont dans `tools/fs/` (fichiers, dont glob et multi_edit), `tools/web/` (web_search, web_fetch), `tools/delegate.js` (sous-agent en lecture seule, `agent/subagent.js`) et `tools/todo-write.js` (liste de tâches). Détails : `docs/tools.md`.
- `api/api.js` : client HTTP pour l'API de chat en flux SSE.
- `api/auth.js` : session et jetons courts (JWT) obtenus à partir du cookie de session.
- `project/memory.js` : mémoire persistante par projet (notes, journal, pile d'annulation) et mémoire de session.
- `project/profile.js` : pré-prompt personnalisé (utilisateur dans `~/.francestudent-cli/profile.json`, projet dans `profile.json` du dossier de données du projet) et faits appris dont le poids se renforce à chaque observation (`observe`, `reinforce`, `buildPreprompt`).
- `project/conversations.js` : conversations persistantes, une par projet et par mode (`chat` ou `agent`).
- `project/project-context.js` : indexation du projet et génération ou réutilisation de `RESUME.md`.
- `tools/security.js` : validation des chemins et blocage des accès sensibles.
- `cli/router.js` : décision entre passage par l'agent et chat normal.
- `api/login.js`, `api/html-forms.js` : connexion par e-mail et mot de passe (OAuth WHMCS) et lecture des formulaires HTML.
- `tools/registry.js` : registre des outils de l'agent, validation et description des appels.
- `tools/command/` : outil `run_command` (analyse, politique de sécurité, permissions, enchaînements, exécution) et commandes en arrière-plan (`job_output`, `job_stop`).
- `project/projects.js` : registre des projets connus et de leurs conversations.
- `config.js`, `state.js`, `cli/ui.js`, `tools/diff.js` : configuration, état partagé, rendu terminal et diff ligne à ligne. `cli/ui.js` fournit aussi `askMultiline` (saisie multi-ligne : `\` en fin de ligne, ou bloc entre deux lignes `"""`).

## Port d'interface (src/ui-bridge.js)
Les modules métier n'écrivent jamais directement dans le terminal : ils appellent le port `ui` (`ui.info`, `ui.stream`, `ui.confirm`, `ui.diff`, `ui.clear`, etc., liste dans `UI_METHODS`). Chaque appel est délégué au backend actif au moment de l'appel :
- par défaut, `src/cli/ui.js` (ancien CLI readline), chargé à la demande ;
- dans la TUI, l'adaptateur `src/tui/adapter.js`, branché avec `setUiBackend`.
Pour ajouter une méthode au port, il faut l'ajouter à `UI_METHODS` et l'implémenter dans les deux backends.

## Cœur partagé (src/core/)
- `core/session.js` et `core/chat.js` : logique de session et de chat extraite de `main.js`, utilisée à la fois par l'ancien CLI et par la TUI.

## TUI (src/tui/)
- `index.jsx` : point d'entrée du bundle (store, adaptateur, rendu Ink, sortie propre).
- `store.js` : store minimal en CommonJS (transcript, message en cours, spinner, confirmations, barre d'état).
- `adapter.js` : backend TUI du port d'interface.
- `app.jsx` et `components/` : composants React/Ink.
- `input-model.js`, `history-file.js` : saisie multiligne et historique persistant.
Détails : `docs/tui.md`.

## Build (esbuild)
`scripts/build-tui.js` construit `src/tui/index.jsx` en un seul fichier ESM, `dist/tui.mjs` (Node 22, JSX automatique, dépendances npm externes). Les modules CommonJS de `src/` situés hors de `src/tui` restent externes et sont chargés avec `require` : la TUI partage ainsi les mêmes singletons (`state`, mémoire, jobs) que l'ancien CLI. Le bundle est construit par `npm run build:tui`, par `prepare` (au `npm install`) et par `pretest` (avant `npm test`). `dist/` n'est pas versionné.

## Points d'entrée
- `bin/frst.js` (`frst`) : choisit la TUI ou l'ancien CLI (`--classic`, `FRST_UI=classic`, absence de TTY ou de bundle), puis importe `dist/tui.mjs`. En cas d'échec, il revient à l'ancien CLI après avoir restauré le terminal.
- `index.js` (`frstcli`) : ancien CLI.

## Flux principal
1. `index.js` charge l'environnement puis appelle `run()` de `src/main.js`.
2. `main.js` route la saisie : commande, chat normal ou agent.
3. L'agent envoie le contexte au modèle à chaque tour dans sa conversation persistante, exécute un outil, puis enregistre le résultat.
4. Chaque écriture passe par une confirmation et laisse une entrée annulable avec `/undo`.
