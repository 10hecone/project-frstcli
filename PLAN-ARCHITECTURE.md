# Plan : passer de `/project` à une architecture proche de Claude Code

Objectif : le dossier ouvert devient le centre de l'outil (comme `claude` lancé dans un dossier),
pour la CLI, la TUI et la GUI Electron. Cette phase se concentre sur le cœur et l'interface ;
l'ajout de dossiers supplémentaires (`/add-dir`) viendra plus tard.

Coche les cases au fur et à mesure (`- [x]`).

---

## Décisions prises

- **Racine = dossier courant.** Pas de remontée jusqu'à `.git`. Seul `FRSTCLI.md` est aussi lu dans les dossiers parents.
- **Confiance demandée au premier lancement** dans un dossier. Refuser ferme l'outil. `~` et `C:\` déclenchent un avertissement renforcé, sans blocage.
- **Nouvelle session à chaque lancement.** `-c` reprend la dernière, `--resume` et `/resume` ouvrent la liste.
- **`/project` et `/unproject` sont supprimés.** On ne change pas de dossier pendant une session : on relance (CLI/TUI) ou on ouvre une nouvelle session (GUI).
- **3 modes de permission**, comme Claude Code : `default` (demande avant d'agir), `acceptEdits` (accepte les modifications), `plan` (lecture et proposition, rien n'est modifié). On passe de l'un à l'autre avec Shift+Tab. Ils remplacent `mode auto|chat` et `autoApprove`.
- **Chat sans outils (écart assumé avec Claude Code) :** possible seulement avec `frst --no-project`, ou depuis la GUI avec « Continuer sans dossier ».
- **Les conversations restent sur le serveur FranceStudent.** En local, on ne garde que leurs identifiants, par dossier.
- **Les projets FranceStudent distants deviennent les « Projets en ligne »**, bien séparés des dossiers locaux.

## Architecture visée

```
bin/frst.js      → arguments : [dossier], -c, --resume, --no-project
src/core/workspace.js   → NOUVEAU, cœur commun CLI/TUI/GUI
     { root, trusted, extraDirs: [] }
     open(), close(), contains(), relative(), onChange()
src/core/permissions-mode.js → NOUVEAU : default | acceptEdits | plan
src/core/session.js     → bootstrap({ workspace, resume, noProject })
src/project/projects.js → { path, trusted, lastOpenedAt, sessions: [{ id, title, settings, updatedAt }] }
src/gui/folders.js      → NOUVEAU, sans Electron : récents, ouvrir, fermer, confiance, sessions
electron/ipc.js         → canaux PICK_FOLDER, OPEN_FOLDER, CLOSE_FOLDER, RECENT_FOLDERS,
     TRUST_FOLDER, FOLDER_SESSIONS, SET_PERMISSION_MODE
```

Règle : aucune interface n'écrit `state.workspace` directement. Tout passe par `workspace.open()` et `workspace.close()`.

---

## Phase 1 : le cœur (commun aux trois interfaces)

- [x] **1. Créer le module `Workspace`**
  - Créer `src/core/workspace.js` et y déplacer `setProject`/`unsetProject` depuis `src/tools/tools.js`.
  - Exposer `open(dir)`, `close()`, `contains(path)`, `relative(path)` et `onChange(fn)`.
  - Prévoir `extraDirs: []`, vide pour l'instant.
  - Aucun changement de comportement (refactoring pur).

- [x] **2. Remplacer tous les accès à `state.workspace`**
  - Cœur : outils fichiers (`src/tools/fs`), `tools/command/permissions.js`, `tools/command/policy.js`, `tools/security.js`.
  - GUI : `src/gui/changes.js` (ligne 75), `src/gui/workspace.js` (`branch`, `info`), `electron/ipc.js` (`openPath`).
  - TUI : `tui/index.jsx`, `components/Header.jsx`, `components/Welcome.jsx`.
  - Aucun changement de comportement.

- [x] **3. Gérer la confiance par dossier**
  - Enregistrer `trusted: true` dans `projects.json`.
  - Un seul message, dans le cœur (réutilisé par la TUI et la GUI) : il rappelle que les fichiers lus sont envoyés au fournisseur API. Ce message remplace l'avertissement actuel de `setProject`.
  - Refuser la confiance ferme l'outil. Avertissement renforcé pour `~` et `C:\`.

- [x] **4. Gérer plusieurs sessions par dossier**
  - Faire passer `projects.json` à `sessions: [...]`, avec migration de l'ancien `conversations.chat` (sur le modèle de la migration `LEGACY_FILE`).
  - Supprimer `chatIds.agent`, `conversationSettings.agent`, `activateConversation(mode)` et l'option `newconv`.
  - Le titre d'une session vient de l'API (titre du chat) ou, à défaut, du premier message.

- [x] **5. Ajouter les modes de permission**
  - Créer `src/core/permissions-mode.js` avec les modes `default`, `acceptEdits` et `plan`.
  - `default` : les écritures et les commandes non sûres sont confirmées (comportement actuel).
  - `acceptEdits` : les écritures de fichiers sont acceptées ; les commandes non sûres restent confirmées.
  - `plan` : seuls les outils de lecture sont envoyés au modèle ; il propose un plan sans rien modifier.
  - Supprimer `state.mode` (`auto|chat`) et `state.autoApprove`. Le chat sans outils devient `--no-project`.

## Phase 2 : CLI et TUI

- [x] **6. Ouvrir le dossier au lancement**
  - `frst` utilise `process.cwd()` et `frst <dossier>` le dossier indiqué.
  - `-c` reprend la dernière session, `--resume` ouvre la liste, `--no-project` lance le chat sans outils.
  - `FRSTCLI.md` est lu dans le dossier et ses parents (le plus proche en dernier).
  - Supprimer la restauration de la conversation « chat » globale dans `session.bootstrap`.

- [x] **7. Mettre à jour les commandes**
  - Supprimer `/project`, `/unproject`, `requireProject()`, `router.seemsToRequestLocalFiles` et le message « sélectionne d'abord un dossier » (`session.js`).
  - Ajouter :
    - `/status` : dossier, confiance, session, branche, mode de permission, agent ;
    - `/resume` : liste des sessions du dossier ;
    - `/permissions` : voir et retirer les règles de `permissions.json` ;
    - `/memory` : ouvrir `FRSTCLI.md`.
  - Remplacer `/mode auto|chat` par `/mode default|acceptEdits|plan`.
  - Mettre à jour `command-list.js`, `showHelp()` et le texte d'accueil de `ui.js` (ligne 346).

- [x] **8. Mettre à jour l'interface de la TUI**
  - `Header.jsx` : chemin court (`~/…/dossier`) et branche Git.
  - `Welcome.jsx` : demande de confiance au premier lancement, sinon « Nouvelle session » ou « Session reprise ».
  - Nouveau `SessionPicker.jsx` (`/resume`, `--resume`) : liste au clavier (titre, date).
  - Barre d'état : dossier, mode de permission (Shift+Tab pour changer), pourcentage de contexte.
  - ~~CLI classique : mêmes informations en texte simple.~~ Sans objet : le CLI classique a été supprimé (seule la TUI reste).

## Phase 3 : la GUI Electron

- [x] **9. Créer le service `src/gui/folders.js`** (sans Electron, testable)
  - `recent()` : dossiers connus triés par `lastOpenedAt` (nom, chemin, branche, nombre de sessions).
  - `open(path)` : appelle `workspace.open()`, vide le transcript (`backend.clear()`) et démarre une nouvelle session.
  - `close()`, `trust(path)`, `sessions(path)`.
  - Refuser pendant une demande en cours (comme `ensureIdle()`).
  - Dépendances injectables, comme `createWorkspace`.

- [x] **10. Ajouter les canaux IPC et le sélecteur natif**
  - `src/gui/channels.js` : `PICK_FOLDER`, `OPEN_FOLDER`, `CLOSE_FOLDER`, `RECENT_FOLDERS`, `TRUST_FOLDER`, `FOLDER_SESSIONS`, `SET_PERMISSION_MODE`.
  - `electron/ipc.js` : `pickFolder()` avec `dialog.showOpenDialog({ properties: ["openDirectory"] })`, puis `folders.open()`.
  - `electron/preload.js` : exposer les nouveaux canaux.
  - `renderer/api/client.js` : valeurs de repli dans `WORKSPACE_FALLBACKS`.

- [x] **11. Lancer avec un dossier**
  - Créer une fonction pure `folderFromArgv(argv)`, utilisée dans `electron/main.js` au démarrage.
  - `second-instance` : ouvrir le dossier reçu dans une nouvelle session (en attendant les fenêtres multiples, voir la phase 6).

- [x] **12. Ajouter l'écran d'accueil et le dialogue de confiance**
  - Nouveau `Home.jsx`, affiché quand aucun dossier n'est ouvert : bouton « Ouvrir un dossier », dossiers récents (nom, chemin, branche, date), lien « Continuer sans dossier ».
  - Nouveau `TrustDialog.jsx` (sur le modèle de `PromptDialog.jsx`) : refuser revient à l'écran d'accueil.

- [x] **13. Revoir la barre latérale (`Sidebar.jsx`)**
  - En haut, un sélecteur du dossier actif (nom et branche) avec un menu : récents, « Ouvrir… », « Fermer le dossier ».
  - La liste « Threads » devient la liste des sessions du dossier actif.
  - Les projets FranceStudent passent dans une section à part, « Projets en ligne ».

- [x] **14. Mettre à jour les autres composants du renderer**
  - `hooks/useWorkspace.js` : état `folders` (récents, actif, chargement), rechargé quand `status.workspace` change.
  - `StatusBar.jsx` : dossier, branche, mode de permission (cliquable, Shift+Tab aussi).
  - `Composer.jsx` (ligne 371) : la puce du dossier ouvre le sélecteur de dossier.
  - `Entry.jsx` (ligne 20) : « aucun dossier ouvert » au lieu de « utilise /project <dossier> ».
  - `TitleBar.jsx` : `nom-du-dossier — FranceStudent Code`.

## Phase 4 : révision du design de la barre latérale et de la barre d'activité

**Périmètre : couleurs et boutons seulement**, dans :
- la **barre latérale** (`Sidebar.jsx`) : Nouveau thread, onglets Chats / Projets, recherche, liste des chats, « Afficher plus », projets (dépliage, Rattacher), skills (interrupteurs), message temporaire (toast) ;
- la **barre d'activité** (`ActivityBar.jsx`) : logo, icônes Conversations / Skills, indicateur de vue active ;
- les éléments ajoutés aux étapes 12 et 13 : sélecteur de dossier, sessions du dossier, « Projets en ligne ».

**Hors périmètre :** la zone de discussion (`Transcript`, `Composer`, `PromptDialog`, `Diff`), la mise en page et les animations.
La règle de base `button` (ligne 88, accent par défaut) n'est **pas** modifiée ici, car elle touche aussi la zone de discussion.
Les nouvelles variantes sont appliquées seulement aux deux barres.

Principes suivis (approche Apple) :
- la sélection se distingue nettement du survol ;
- une seule action mise en avant par panneau ;
- la couleur porte un sens ;
- retour visuel dès l'appui ;
- même apparence = même comportement ;
- matériaux : barre d'activité la plus sombre, barre latérale épaisse, popovers presque opaques.

### État actuel relevé (`styles/app.css`)

| Élément | Constat |
|---|---|
| `.chat-item.active` (ligne 376) et `.activity-item[aria-selected]` (ligne 653) | La sélection (`--glass-active`, blanc 10 %) est trop proche du survol (`--glass-hover`, blanc 6 %) : on distingue mal le chat ouvert. |
| `.chat-item` désactivé pendant une réponse | Le style `button:disabled` (opacité 0,45) assombrit toute la liste à chaque réponse. |
| `.new-thread` (ligne 251) | Neutre, ce qui est bien, mais pas d'état d'appui distinct ; il a le même poids visuel que les onglets juste en dessous. |
| `.segmented` (ligne 272) et `.search` (ligne 321) | Fond codé en dur : `rgba(0, 0, 0, 0.25)`. |
| `.switch` (ligne 520) | Fond éteint (`rgba(255, 255, 255, 0.16)`) et bouton (`#fff`) codés en dur ; état allumé en `--ok` (vert). |
| `.logo` (ligne 214) | Dégradé codé en dur (`#6f9bff`, `#8a5cff`). |
| `.chat-item`, `.disclosure`, `.skill`, `.activity-item` (`:hover`) | Survol appliqué aussi sur écran tactile (pas de `@media (hover: hover)`). |
| `.pill` Rattacher / Rattaché (ligne 452) | Lisible, mais ses états (survol, appui) ne suivent pas ceux des autres boutons. |
| `.panel-error` | Erreur signalée par la couleur seule. |
| Points à garder | Matériaux déjà hiérarchisés (`--glass-rail` > `--glass-thick`), fondus de bord du défilement, indicateur unique qui glisse, toast qui entre et sort par le même chemin. |

- [x] **15. Couleurs : des tokens propres aux deux barres**
  - Déplacer les styles des deux barres dans `styles/sidebar.css`, pour délimiter clairement le périmètre et le tester.
  - Remplacer les couleurs codées en dur (`.segmented`, `.search`, `.switch`, `.logo`) par des tokens.
  - Nouveaux tokens :
    - `--fill`, `--fill-hover`, `--fill-pressed` : boutons neutres ;
    - `--field` : fond des champs (recherche) et du contrôle segmenté ;
    - `--selection` : élément sélectionné, une teinte d'accent légère (comme les barres latérales de macOS), nettement différente du survol neutre ;
    - `--selection-text` : texte de l'élément sélectionné ;
    - `--switch-off`, `--switch-on`, `--knob` : interrupteur. **Décidé :** vert (`--ok`) pour l'état allumé, comme l'interrupteur système d'iOS, dans toutes les vues ;
    - `--brand-start`, `--brand-end` : dégradé du logo.
  - **Hiérarchie des couleurs :**
    - l'accent plein ne sert qu'à l'indicateur de vue active, au contour de focus et à l'état « Rattaché » ;
    - la sélection utilise `--selection` (accent léger) ;
    - tout le reste est neutre.
  - **Matériaux :** barre d'activité (`--glass-rail`) plus sombre que la barre latérale (`--glass-thick`). Le toast et les menus (dont le sélecteur de dossier de l'étape 13) utilisent `--glass-popover`. On ne pose jamais un verre clair sur un autre verre clair.
  - **Erreurs (`.panel-error`) :** ajouter une icône à côté du texte rouge.
  - **Thème clair (décidé) :** comme iOS, clair et sombre suivent le réglage du système. Un jeu de tokens `[data-theme="light"]` pour ces deux barres, avec les mêmes noms, appliqué selon `prefers-color-scheme` ou le choix fait dans le réglage d'apparence existant (`setAppearance`).
  - **Détails proches d'iOS :**
    - coins arrondis continus (rayons cohérents entre conteneur et contenu : rayon intérieur = rayon extérieur − marge) ;
    - contrôle segmenté à la manière d'iOS : segment sélectionné surélevé (blanc en clair, gris clair en sombre) avec une ombre légère, qui glisse d'un segment à l'autre ;
    - interrupteur aux proportions d'iOS (51×31, réduit à l'échelle de la barre), pastille blanche avec ombre ;
    - boutons neutres avec une ombre douce plutôt qu'un bord marqué.

- [x] **16. Boutons : une famille commune aux deux barres**
  - **Variantes** (classes appliquées seulement dans les deux barres) :
    - `secondary` : remplissage neutre et bord fin. Pour « Nouveau thread » (action principale du panneau, placée en premier, avec une icône ＋ plus visible) et pour le sélecteur de dossier ;
    - `ghost` : transparent, `--fill-hover` au survol. Pour « Afficher plus » et les lignes dépliables des projets (`.disclosure`) ;
    - `row` : ligne de liste (chats, sessions) avec trois états bien distincts : repos (transparent), survol (`--fill-hover`), sélection (`--selection` + `--selection-text`, sans ombre interne) ;
    - `icon` : carré de 40 px dans la barre d'activité. L'onglet actif est signalé par `--selection` et l'indicateur d'accent qui glisse ;
    - `pill` : pastille à bascule (Rattacher / Rattaché), avec les mêmes états que les autres variantes.
  - **Contrôle segmenté** (Chats / Projets) : le segment sélectionné est surélevé à la manière d'iOS (remplissage neutre clair et ombre légère, sans accent), sur fond `--field`.
  - **États communs :**
    - survol, seulement avec `@media (hover: hover)` ;
    - appui : retour immédiat (`scale(0.97)` déjà présent, plus `--fill-pressed`) ;
    - `focus-visible` : contour d'accent ;
    - désactivé.
  - **Pendant une réponse :** la liste des chats garde ses couleurs normales (pas d'opacité 0,45). Seul le curseur change (`not-allowed`), avec l'infobulle « Indisponible pendant une réponse » qui existe déjà.
  - **Tailles :** lignes de liste de 32 px, boutons de 32 px, icônes de la barre d'activité de 40 px. Zone de clic d'au moins 28 px. Rayon `--radius` pour les boutons et les lignes, `--radius-pill` seulement pour les pastilles et les étiquettes.

- [x] **17. Accessibilité et vérification**
  - Contraste :
    - au moins 4,5:1 pour les titres de chats, le texte de la sélection et le texte secondaire (`--muted` sur `--glass-thick`) ;
    - au moins 3:1 pour les icônes de la barre d'activité et les bords des pastilles.
  - Étendre `prefers-contrast: more` (ligne 1617) et `prefers-reduced-transparency` (ligne 1581) aux nouveaux tokens. En contraste élevé, la sélection reçoit aussi un bord net.
  - Vérifier sur Windows avec et sans transparence (Mica ou acrylique désactivés).
  - Captures avant et après des deux barres :
    - vues Conversations (onglets Chats et Projets) et Skills ;
    - en thème sombre et en thème clair ;
    - un chat sélectionné ;
    - pendant une réponse ;
    - avec un toast affiché.

## Phase 5 : tests (`npm test`)

- [ ] **18. Tests du cœur**
  - `workspace.test.js` : `open`/`close`, `contains()` (casse sous Windows, liens symboliques, chemins `..`).
  - `projects.test.js` : migration de `conversations` vers `sessions[]`, confiance.
  - `permissions-mode.test.js` : outils autorisés et confirmations dans chaque mode.
  - `frst.test.js` : arguments `[dossier]`, `-c`, `--resume`, `--no-project`.

- [ ] **19. Tests de la GUI**
  - `folders.test.js` : `recent`, `open`, `trust`, refus pendant une demande.
  - `changes.js` et `paths.js` utilisent bien `workspace.root`.
  - `folderFromArgv()` (Windows et macOS, arguments Electron ignorés).
  - `design-tokens.test.js` : aucune couleur codée en dur (`#…`, `rgb(a)`) dans `styles/sidebar.css` en dehors des blocs de tokens ; chaque token sombre a son équivalent clair.

## Phase 6 : priorité suivante

- [ ] **20. Une fenêtre par dossier (GUI)**
  - Lever `requestSingleInstanceLock` : chaque dossier s'ouvre dans sa propre fenêtre.
  - Prérequis : `src/state.js` est aujourd'hui un état global unique. Il faudra un état et un hôte de session (`createGuiHost`) par fenêtre. C'est un gros chantier, à faire après la phase 3.

## Plus tard

- `/add-dir` et `--add-dir` (remplissent `extraDirs`).
- Mention `@fichier` dans la saisie, avec autocomplétion (extension de `Autocomplete.jsx` et de `lib/completion.js`).
- Permissions par dossier supplémentaire.
- Glisser-déposer d'un dossier dans la fenêtre de la GUI.
- Barre d'état personnalisable.

---

## Ordre des commits

Les commits 1 et 2 ne changent aucun comportement.

1. `refactor: extraction du module workspace`
2. `refactor: lecture de workspace.root partout`
3. `feat: confiance par dossier`
4. `feat: sessions multiples par dossier`
5. `feat: modes de permission default, acceptedits et plan`
6. `feat: ouverture depuis le dossier courant (cli/tui)`
7. `feat: commandes status, resume, permissions et memory`
8. `feat: en-tête, barre d'état et sélecteur de session dans la tui`
9. `feat: service folders et canaux ipc`
10. `feat: écran d'accueil et dialogue de confiance (gui)`
11. `feat: barre latérale groupée par dossier (gui)`
12. `style: couleurs de la barre latérale et de la barre d'activité (gui)`
13. `style: boutons de la barre latérale et de la barre d'activité (gui)`
14. `chore: retrait de /project et des restes du mode agent`

## Question ouverte

- GUI : au démarrage, rouvrir automatiquement le dernier dossier, ou toujours afficher l'écran d'accueil ?
  (Proposition : écran d'accueil par défaut, avec une option dans les réglages.)
