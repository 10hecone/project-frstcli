# Architecture de FranceStudent CLI

## Vue d'ensemble
Le CLI est un outil en ligne de commande (Node.js) qui relie un terminal à l'assistant FranceStudent. Comme Claude Code, il travaille dans le dossier où il est lancé (`frst` ou `frst <dossier>`) : le modèle peut y lire et modifier des fichiers et lancer des commandes, selon le mode de permission (`default`, `acceptEdits`, `plan`). Le dossier est fixé pour toute la session ; `frst --no-project` donne un chat normal sans outils. L'interface du terminal est la TUI (Ink) ; l'ancien CLI classique a été retiré.

## Modules (src/)
- `cli/launch-args.js` : arguments de lancement (`parseLaunchArgs` : `[dossier]`, `-c`/`--continue`, `-r`/`--resume`, `--no-project`, `--help`, `--version`) et texte d'aide `USAGE`. Sans effet de bord.
- `cli/commands.js` : commandes slash (`/status`, `/resume`, `/mode`, `/undo`, `/model`, etc.). Sans dossier, les commandes de projet répondent par `requireFolder()`.
- `cli/command-list.js` : liste unique des commandes (aide `/help`, complétion Tab de la TUI et de la GUI).
- `cli/router.js` : `isWorkspaceQuestion` (« quel dossier est ouvert ? » répondu sans appel au modèle).
- `api/api.js` : client HTTP pour l'API de chat en flux SSE.
- `api/auth.js` : session et jetons courts (JWT) obtenus à partir du cookie de session.
- `api/login.js`, `api/html-forms.js` : connexion par e-mail et mot de passe (OAuth WHMCS) et lecture des formulaires HTML.
- `project/memory.js` : mémoire persistante par projet (notes, journal, pile d'annulation) et mémoire de session.
- `project/profile.js` : pré-prompt personnalisé (utilisateur dans `~/.francestudent-cli/profile.json`, projet dans `profile.json` du dossier de données du projet) et faits appris dont le poids se renforce à chaque observation (`observe`, `reinforce`, `buildPreprompt`).
- `project/projects.js` : registre des dossiers connus (`path`, `trusted`, `lastOpenedAt`, `sessions: [{ id, title, settings, updatedAt }]`).
- `project/instructions.js` : `FRSTCLI.md` du dossier et de ses parents (`instructionFiles`, le plus proche en dernier), joints au premier message d'une conversation.
- `project/project-context.js` : contexte court du projet et `RESUME.md` à la demande (`/index`).
- `project/git-branch.js` : branche Git du dossier (en-tête de la TUI, `/status`).
- `tools/` : outils du modèle (fichiers, `run_command`, commandes en arrière-plan), sécurité des chemins et diff. Détails : `docs/tools.md`.
- `config.js`, `state.js` : configuration et état partagé (conversation en cours, modèle, usage).

## Port d'interface (src/ui-bridge.js)
Les modules métier n'écrivent jamais directement dans le terminal : ils appellent le port `ui` (`ui.info`, `ui.stream`, `ui.confirm`, `ui.diff`, `ui.clear`, etc., liste dans `UI_METHODS`). Chaque appel est délégué au backend actif au moment de l'appel :
- dans la TUI, l'adaptateur `src/tui/adapter.js`, branché avec `setUiBackend` ;
- dans l'application de bureau, le backend de `src/gui/` ;
- à défaut, `src/cli/ui.js` (rendu texte de base), chargé à la demande.
Pour ajouter une méthode au port, il faut l'ajouter à `UI_METHODS` et l'implémenter dans les backends. Les capacités optionnelles (comme `chooseSession`) ne font pas partie du port : l'appelant vérifie leur présence.

## Cœur partagé (src/core/)
- `core/session.js` : `bootstrap(options)` (connexion, ouverture du dossier, reprise de session éventuelle ; renvoie `{ ok, session: { kind: "new"|"resumed"|"none", title? } }`) et `handleInput` (commande, question sur le dossier ou message au modèle).
- `core/sessions.js` : sessions du dossier ouvert (`listSessions`, `findSession`, `resumeSession`, `describeSession`, `chooseSession`), partagées par `frst -c`, `frst --resume` et `/resume`.
- `core/workspace.js` : dossier ouvert (`open` avec demande de confiance, `root`, `onChange`).
- `core/permissions-mode.js` : mode de permission de la session (`get`, `set`, `cycle` pour Shift+Tab).
- `core/chat.js` : envoi d'un message et boucle d'outils ; `core/compact.js` : résumé `/compact`.

## TUI (src/tui/)
- `index.jsx` : point d'entrée du bundle (options de lancement, store, adaptateur, rendu Ink, amorçage, sortie propre).
- `store.js` : store minimal en CommonJS (transcript, message en cours, spinner, confirmations, barre d'état).
- `adapter.js` : backend TUI du port d'interface (avec `banner({ session, first })` et `chooseSession`).
- `app.jsx` et `components/` : composants React/Ink (`Header`, `Welcome`, `SessionPicker`, `PromptInput`, `StatusBar`…).
- `input-model.js`, `history-file.js` : saisie multiligne et historique persistant.
Détails : `docs/tui.md`.

## Build (esbuild)
`scripts/build-tui.js` construit `src/tui/index.jsx` en un seul fichier ESM, `dist/tui.mjs` (Node 22, JSX automatique, dépendances npm externes). Les modules CommonJS de `src/` situés hors de `src/tui` restent externes et sont chargés avec `require` : la TUI partage ainsi les mêmes singletons (`state`, mémoire, jobs) que le reste de l'application. Le bundle est construit par `npm run build:tui`, par `prepare` (au `npm install`) et par `pretest` (avant `npm test`). `dist/` n'est pas versionné.

## Point d'entrée
- `bin/frst.js` (`frst`) : `launchInfo(argv)` affiche l'aide, la version ou l'erreur d'arguments sans lancer la TUI. Sinon il vérifie que le terminal est interactif et que `dist/tui.mjs` existe (`checkTui`), puis importe le bundle. En cas d'échec, il restaure le terminal et quitte avec un code d'erreur. `frst mcp …` gère les serveurs MCP sans lancer la TUI.

## Flux principal
1. `bin/frst.js` lit les arguments, charge l'environnement puis importe `dist/tui.mjs`.
2. La TUI s'affiche et appelle `session.bootstrap` : connexion, confiance et ouverture du dossier (courant par défaut), reprise de session avec `-c` ou `--resume` (`SessionPicker`). L'accueil indique ensuite le dossier et la session.
3. Chaque saisie passe par `core/session.js` : commande slash, question sur le dossier, ou message au modèle, qui choisit lui-même ses outils.
4. Les écritures et commandes non sûres sont confirmées selon le mode de permission ; chaque écriture laisse une entrée annulable avec `/undo`.
