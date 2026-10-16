# Interface TUI (`frst`)

La TUI est l'interface plein terminal de FranceStudent Code, construite avec React et Ink. Elle remplace l'affichage readline de `src/cli/ui.js` sans toucher à la logique métier : les modules de `src/` appellent le port `ui` de `src/ui-bridge.js`, et la TUI branche son propre backend sur ce port.

## Lancement

- `frst` (ou `npm run start:tui`) : TUI si le terminal est interactif et que `dist/tui.mjs` existe.
- `frst --classic` ou `FRST_UI=classic frst` : ancien CLI readline.
- `frstcli` (ou `npm start`) : ancien CLI, directement.

`bin/frst.js` (`chooseInterface`) choisit l'interface classique dans ces cas : option `--classic`, `FRST_UI=classic`, entrée ou sortie qui ne sont pas des TTY, bundle absent. Si le chargement de la TUI échoue, il restaure le terminal (`restoreTerminal`) puis ouvre l'interface classique.

## Fichiers

| Fichier | Rôle |
| ------- | ---- |
| `src/tui/index.jsx` | Point d'entrée du bundle : crée le store et l'adaptateur, branche le backend (`setUiBackend`), lance `render` d'Ink (`exitOnCtrlC: false`, `patchConsole: true`) et gère la sortie propre (`cleanExit`, `colorEnabled`). |
| `src/tui/store.js` | Store minimal sans React (CommonJS) : état, `dispatch`, `subscribe`. |
| `src/tui/adapter.js` | Backend TUI du port : traduit chaque appel `ui.xxx()` en actions du store et résout les confirmations. |
| `src/tui/app.jsx` | Composant racine : lit le store (`useSyncExternalStore`) et compose l'écran. |
| `src/tui/input-model.js` | Modèle pur de la saisie multiligne (curseur, historique, complétion des commandes slash). |
| `src/tui/history-file.js` | Historique persistant des saisies (`input-history.json` dans le dossier de données, 200 entrées au plus). |
| `src/tui/components/` | Composants d'affichage (voir plus bas). |

## Store

L'état contient :

- `transcript` : entrées terminées (`welcome`, `user`, `assistant`, `tool`, `result`, `plan`, `diff`, `info`, `warn`, `error`, `print`), chacune avec un `id` unique ;
- `live` : message en cours de streaming ;
- `spinner` : indicateur de chargement actif ;
- `prompts` et `pendingPrompt` : file des confirmations et questions, `pendingPrompt` étant la première ;
- `command` : sortie en cours de `run_command`, repliée sur ses dernières lignes ;
- `status` : données de la barre d'état ;
- `epoch` : incrémenté par l'action `clear` (`/clear`) pour remonter le `<Static>` du transcript.

Le store est en CommonJS et testé sans Ink.

## Adaptateur

`createTuiBackend(store, options)` expose toutes les méthodes de `UI_METHODS`. Les sorties (`info`, `assistant`, `tool`, `diff`, etc.) ajoutent des entrées au transcript. `stream` alimente `live`, puis transfère les lignes terminées dans le transcript. `spinner(label)` renvoie un contrôleur (`update`, `stop`). `confirm`, `askCommand`, `ask` et `askSecret` mettent une question dans la file et renvoient une promesse, résolue par la réponse de l'utilisateur. `clear()` efface l'écran (`onClearScreen`), vide le store puis réaffiche l'accueil. `refreshStatus` met à jour la barre d'état.

## Composants

Ordre d'affichage dans `App` :

1. `Transcript` : entrées terminées dans `<Static>` (`Welcome`, `Message`, `ToolCall`, `Diff`, `Plan`).
2. `CommandOutput` : sortie de la commande en cours.
3. `LiveMessage` : dernières lignes du message en streaming, selon la hauteur du terminal.
4. `Spinner` : libellé, durée écoulée, rappel « Ctrl+C pour interrompre ».
5. `ConfirmDialog` / `TextPrompt` s'il y a une question en attente, sinon `PromptInput`.
6. `StatusBar` : mode, modèle, projet, branche git, auto-approbation, jobs, tokens.

`PromptInput` est encadrée par une ligne horizontale discrète au-dessus et une en dessous, comme dans Claude Code (bordure Ink limitée au haut et au bas).

## Raccourcis clavier

| Touche | Action |
| ------ | ------ |
| Entrée | Envoyer |
| `\` + Entrée, Ctrl+J, Alt+Entrée | Nouvelle ligne |
| ↑ / ↓ | Changer de ligne, puis parcourir l'historique |
| Tab | Compléter une commande slash |
| Échap | Effacer la saisie |
| Ctrl+A / Ctrl+E (ou Début / Fin) | Début / fin de ligne |
| Ctrl+U / Ctrl+K | Couper jusqu'au début / jusqu'à la fin |
| Ctrl+V | Coller le presse-papiers (`src/clipboard.js`) |
| Ctrl+L | Effacer l'écran seulement (le transcript reste dans le store, contrairement à `/clear`) |
| Ctrl+C | Interrompre la tâche ; sinon effacer la saisie ; un second appui quitte |
| Ctrl+D | Quitter si la saisie est vide |

Dans une confirmation : `o` = oui, `n` = non, `t` = toujours (absent pour les confirmations forcées), flèches + Entrée, Échap = non.

## Règles anti-scintillement

- Tout ce qui est terminé va dans le transcript, rendu par `<Static>` : Ink l'écrit une seule fois et ne le redessine plus.
- La zone dynamique reste courte : `LiveMessage` n'affiche que les dernières lignes qui tiennent dans `rows - RESERVED_ROWS`, et `RESERVED_ROWS` compte le spinner, la marge, la saisie avec ses deux bordures et la barre d'état. Si la mise en page sous le message change, il faut mettre cette constante à jour.
- La hauteur est relue à chaque événement `resize` de stdout (`useTerminalRows`).
- Le timer du spinner (environ 100 ms) ne tourne que pendant une activité.
- Les `console.log` restants sont capturés par Ink (`patchConsole`).
- `NO_COLOR` désactive les couleurs (`colorEnabled`).

## Ajouter un composant

1. Créer `src/tui/components/MonComposant.jsx` : composant pur, avec ses données en props et sans accès direct au store.
2. Pour une nouvelle entrée de transcript : ajouter le type à `ENTRY_TYPES` dans `store.js`, l'émettre depuis l'adaptateur, puis le rendre dans `Entry` (`Transcript.jsx`).
3. Pour un élément dynamique : le placer dans `app.jsx` avant la saisie et ajuster `RESERVED_ROWS` s'il occupe des lignes en permanence.
4. Si une méthode du port est nécessaire : l'ajouter à `UI_METHODS` (`src/ui-bridge.js`) et l'implémenter dans `src/cli/ui.js` et dans l'adaptateur.
5. Exporter le composant depuis `index.jsx` si les tests en ont besoin, puis ajouter un test `test/tui-*.test.js` (import de `dist/tui.mjs` avec `FRST_TUI_NO_START=1`, `ink-testing-library`).
