# FranceStudent CLI

Interface en ligne de commande pour utiliser ia.francestudent depuis un terminal. Sans projet sélectionné, le CLI fonctionne en chat normal.

## Fonctionnalités

- Chat avec les agents disponibles (`/model`)
- Mode projet : le modèle explore, cherche, lit, crée et modifie des fichiers et lance des commandes, avec les outils client natifs de l'API France Student
- Confirmation avant chaque écriture et chaque commande non sûre (`/auto on` la désactive pour la session)
- Annulation de la dernière modification avec `/undo` (sauvegardes et corbeille du CLI)
- Notes persistantes par projet (`/remember`, `/memory`)
- Une conversation persistante par projet, reprise automatiquement
- Saisie multi-ligne : `\` en fin de ligne pour continuer, ou bloc entre deux lignes `"""`
- Pré-prompt personnalisé, commun à tous les projets ou propre à un projet (`/preprompt`)
- Mémoire de profil qui se renforce avec l'usage : faits appris sur l'utilisateur et le projet, ajoutés au pré-prompt (`/profil`)

## Prérequis

- Node.js 22 ou plus récent
- Un compte FranceStudent avec une session active dans le navigateur
- Pour le mode projet : l'accès aux outils client de l'API (« mode avancé », voir `client-tools.md`), disponible avec les modèles OpenAI et Claude

## Installation Windows de l’application graphique

Télécharge `frst-atelier-<version>-windows-x64-setup.exe` depuis les releases GitHub et lance-le. L’installateur propose le dossier d’installation et crée les raccourcis de l’application. Il inclut Electron : Node.js n’est pas nécessaire pour utiliser l’interface graphique. L’exécutable n’est pas signé ; Windows peut afficher un avertissement SmartScreen. Le CLI est distribué séparément dans `frst-cli-<version>-windows-x64-setup.exe`.

Pour construire l’installateur graphique sur Windows x64 :

```powershell
npm ci
npm run dist:win
```

Le fichier est créé dans `release/`. Le workflow « Windows - Installateurs CLI et application » peut être lancé manuellement depuis Actions : les deux installateurs sont disponibles comme artifacts. Un tag `vX.Y.Z` correspondant à la version de `package.json` crée une release **en brouillon** contenant les deux installateurs et leurs empreintes SHA-256 ; elle doit être vérifiée puis publiée manuellement.

## Installation

```bash
git clone <url-du-depot>
cd project-frstcli
npm install
```

Au premier lancement, le CLI demande ton e-mail et ton mot de passe France Student (saisie masquée). Le mot de passe n'est jamais enregistré : seul le cookie de session l'est, dans `~/.francestudent-cli/session.json` (droits 0600). Commande `/login` pour se reconnecter.

Variantes : `FS_EMAIL` et `FS_PASSWORD` (variables d'environnement) pour une connexion sans saisie, ou `FS_SESSION_TOKEN` (valeur du cookie `next-auth.session-token`, F12 > Stockage > Cookies) si la connexion automatique est bloquée (captcha, double authentification, Cloudflare). Ne partage jamais ces valeurs.

`npm install` lance aussi le script `prepare`, qui construit le bundle de la TUI (`dist/tui.mjs`, via esbuild). Pour le reconstruire à la main : `npm run build:tui`.

Pour disposer des commandes `frst` et `frstcli` partout :

```bash
npm link
```

Sous PowerShell, si `frst` reste introuvable après `npm link`, le dossier npm global
doit être dans le `PATH`. Pour la session courante :

```powershell
$prefix = npm config get prefix
$env:Path += ";$prefix"
frst
```

Pour conserver ce réglage pour les prochaines sessions PowerShell, ajoute ce
dossier au `PATH` utilisateur dans les paramètres Windows, puis ouvre un
nouveau terminal. Pour lancer le CLI sans modifier le `PATH`, utilise
`node .\bin\frst.js` depuis le dépôt.

Lancement :

| Commande | Interface |
| -------- | --------- |
| `frst` (ou `npm run start:tui`) | Nouvelle interface plein terminal (TUI Ink) |
| `frst --classic` (ou `FRST_UI=classic frst`) | Ancien CLI readline |
| `frstcli` (ou `npm start`, `node index.js`) | Ancien CLI readline, directement |

`frst` ouvre automatiquement l'ancien CLI si le terminal n'est pas interactif, si `dist/tui.mjs` est absent ou si la TUI ne peut pas démarrer.

### Raccourcis clavier de la TUI

| Touche | Action |
| ------ | ------ |
| Entrée | Envoyer |
| `\` + Entrée, Ctrl+J, Alt+Entrée | Nouvelle ligne |
| ↑ / ↓ | Changer de ligne, puis parcourir l'historique (conservé entre les sessions) |
| Tab | Compléter une commande slash |
| Échap | Effacer la saisie |
| Ctrl+A / Ctrl+E | Début / fin de ligne |
| Ctrl+U / Ctrl+K | Couper jusqu'au début / jusqu'à la fin |
| Ctrl+V | Coller le presse-papiers |
| Ctrl+L | Effacer l'écran (`/clear` vide aussi l'historique affiché) |
| Ctrl+C | Interrompre la tâche, sinon effacer la saisie ; un second appui quitte |
| Ctrl+D | Quitter si la saisie est vide |

Confirmations : `o` = oui, `n` = non, `t` = toujours, Échap = non. `NO_COLOR=1` désactive les couleurs. Détails : [docs/tui.md](docs/tui.md).

## Utilisation

Exemple de session :

```text
› /project ./mon-projet
› /tree
› Explique le rôle de src/main.js
› Ajoute une fonction de formatage de date dans src/utils/date.js
```

### Saisie multi-ligne

- Termine une ligne par `\` pour continuer sur la suivante (invite `... `).
- Tape `"""` seul sur une ligne pour ouvrir un bloc (collage possible), puis `"""` seul pour l'envoyer.

### Pré-prompt et mémoire de profil

- `/preprompt <texte>` enregistre un pré-prompt commun à tous les projets ; `/preprompt projet <texte>` en enregistre un pour le projet ouvert. Il est joint au premier message d'une conversation de chat (utilise `/new` pour l'appliquer).
- Le CLI repère les sujets récurrents de tes demandes (TypeScript, Python, React, tests, documentation, Git). À partir de 3 mentions, un sujet devient un fait dont le poids augmente à chaque nouvelle mention. Les 12 faits les plus lourds sont ajoutés au pré-prompt.
- `/profil learn <fait>` ajoute ou renforce un fait à la main, `/profil forget <n>` le supprime.
- Stockage : `~/.francestudent-cli/profile.json` (utilisateur) et `profile.json` dans le dossier de données du projet.
- Le pré-prompt et les faits sont joints au premier message de chaque conversation, avec ou sans projet.

## Commandes principales

| Commande                  | Rôle                                                  |
| ------------------------- | ----------------------------------------------------- |
| `/help`                   | Affiche l'aide                                        |
| `/project <dossier>`      | Sélectionne un projet local                           |
| `/unproject`              | Quitte le mode projet                                 |
| `/tree [dossier]`         | Liste un dossier sur deux niveaux                     |
| `/read <fichier>`         | Affiche un fichier                                    |
| `/index`                  | Résume le projet avec l'IA et enregistre `RESUME.md` (`/index force` refait tout) |
| `/resume` | Affiche le résumé enregistré (`RESUME.md`) |
| `/plan <demande>` | Propose un plan en lecture seule, sans modification            |
| `/undo`                   | Annule la dernière modification                       |
| `/changes`                | Liste les modifications annulables                    |
| `/chat-id [numéro\|id]`   | Affiche les IDs ou reprend une conversation |
| `/history [all]`          | Liste les dernières conversations (id, titre, date)   |
| `/messages`               | Affiche les messages de la session                    |
| `/memory`                 | Affiche les notes et les dernières actions            |
| `/remember <texte>`       | Ajoute une note au projet                             |
| `/preprompt [user\|projet] [texte\|clear]` | Affiche, définit ou efface le pré-prompt (utilisateur par défaut) |
| `/profil [user\|projet] [learn <fait>\|forget <n>]` | Liste, ajoute ou oublie les faits appris (poids renforcés) |
| `/permissions [remove <n\|préfixe>\|clear]` | Liste ou supprime les règles des commandes autorisées (projet) |
| `/jobs [stop <id>\|stop-all]` | Liste ou arrête les commandes en arrière-plan        |
| `/login`                  | Se connecter avec e-mail et mot de passe              |
| `/mode auto\|chat` | `auto` : outils actifs avec `/project` ; `chat` : aucun outil            |
| `/model [nom]`             | Liste ou change d'agent                               |
| `/new`                    | Démarre une nouvelle conversation                     |
| `/compact [consigne]`     | Résume la session et repart d'une nouvelle conversation |
| `/context`                | Affiche le contexte utilisé, le chat ID et les tours |
| `/exit`                   | Quitte le CLI                                         |
| `/pwd` | Affiche le projet sélectionné |
| `/fr-project <nom>\|off` | Rattache les nouvelles conversations à un projet FranceStudent (créé s'il n'existe pas) |
| `/init` | Crée `FRSTCLI.md` (instructions du projet), sans écraser un fichier existant |
| `/forget <n\|all>` | Supprime une note du projet (ou toutes) |
| `/auto on\|off` | Désactive ou rétablit les confirmations pour la session |
| `/web on\|off` | Recherche web côté serveur (chat normal) |
| `/usage` | Consommation : session, conversation, limites du compte |
| `/auth [refresh]` | État de la connexion, ou renouvellement du jeton |
| `/clear` | Efface le terminal (`/quit` est un alias de `/exit`) |

### Contexte envoyé au modèle

- Au premier message d'une conversation avec un projet ouvert, le CLI joint un contexte court (3 000 caractères au maximum) : nom du projet, système, branche Git, gestionnaire de paquets, commande de test et premier niveau de l'arborescence. Le contenu des fichiers n'est jamais joint : le modèle le lit avec les outils. `FRSTCLI.md` (instructions du projet, voir `/init`) et le pré-prompt sont joints aussi. Les messages suivants partent seuls.
- `RESUME.md` n'est plus généré à l'ouverture du projet ni envoyé au modèle. `/index` le génère à la demande (seuls les fichiers modifiés depuis le dernier résumé sont renvoyés à l'IA, `/index force` refait tout) et `/resume` l'affiche.
- Pas de limite de rondes d'outils par défaut. Avec `FS_MAX_AGENT_TURNS=N` (N > 0), le CLI demande toutes les N rondes s'il faut continuer.

### Contexte et compaction

- Après chaque réponse, le CLI lit le pourcentage de contexte utilisé par la conversation. La barre d'état de la TUI l'affiche sous la forme `ctx 42 %` : couleur neutre sous 60 %, jaune de 60 à 80 %, rouge au-delà. Rien n'est affiché si la valeur est inconnue.
- Pas de compaction automatique : l'API rejoue l'historique à chaque tour et les fournisseurs le compactent eux-mêmes.
- `/context` affiche ce pourcentage, le chat ID de la conversation, le nombre de tours de la session et, s'il y en a un, le résumé `/compact` en attente.
- `/compact [consigne]` demande au modèle un résumé structuré en français (objectif, décisions prises, fichiers modifiés, tâches restantes). Le résumé (20 000 caractères au maximum) est joint à ton prochain message, qui ouvre une nouvelle conversation : aucune requête supplémentaire n'est envoyée. La consigne facultative oriente le résumé, par exemple `/compact garde les chemins des tests`. L'ancienne conversation reste accessible avec `/chat-id`. Si l'opération échoue, la conversation en cours est conservée.
- Le journal local n'est pas touché : `/undo` et `/changes` fonctionnent toujours après une compaction.

### Outils du modèle

Le CLI utilise les outils client natifs de l'API France Student (voir `client-tools.md`). Six outils sont déclarés, toujours dans le même ordre pour garder le cache de prompt : `list_directory`, `read_file`, `search_files`, `edit_file`, `write_file` et `run_command`. Avec `/plan`, seuls les trois premiers (lecture seule) sont proposés.

- Les résultats sont renvoyés en texte : `read_file` en lignes numérotées, `search_files` en lignes `chemin:ligne: texte` (50 résultats par défaut), `list_directory` avec une entrée par ligne (dossiers terminés par `/`), `run_command` avec la commande, le statut puis la sortie. Les autres résultats restent en JSON compact.
- `read_file` renvoie au plus 30 000 caractères, coupés sur une fin de ligne : le résultat indique la ligne où reprendre (`start_line`).
- La sortie de `run_command` est limitée à 16 000 caractères : le début et la fin sont gardés.
- L'API accepte 32 résultats au maximum par envoi : si le modèle demande plus d'appels en une fois, seuls les 32 premiers sont exécutés et un avertissement s'affiche.
- Les écritures (`edit_file`, `write_file`) et les commandes non sûres demandent une confirmation, sauf avec `/auto on`.
- Les anciens outils (`glob`, `multi_edit`, `web_search`, `web_fetch`, `delegate`, `todo_write`…) et leurs variables (`FS_WEB`, `FS_SEARCH_*`, `FS_SUBAGENT_*`, `FS_AUTO_COMPACT`, `FS_COMPACT_THRESHOLD`) n'existent plus. La recherche web reste disponible en chat normal avec `/web on`.
- Le mode agent séparé a été retiré : il n'y a plus qu'une conversation par projet, et le modèle décide lui-même d'appeler ses outils. `/mode agent` reste accepté comme alias de `/mode auto`. Une ancienne conversation « agent » reprise avec `/chat-id` continue comme une conversation normale.

## Variables d'environnement

Toutes sont facultatives. Un fichier `.env` à la racine est lu au démarrage.

| Variable | Rôle | Défaut |
| -------- | ---- | ------ |
| `FS_EMAIL`, `FS_PASSWORD` | Connexion sans saisie | — |
| `FS_SESSION_TOKEN` | Cookie de session fourni à la main | — |
| `FS_AGENT_ID` | Agent utilisé au démarrage | `-1002` |
| `FS_MAX_AGENT_TURNS` | Rondes d'outils avant de demander s'il faut continuer (`0` = sans limite) | `0` |
| `FS_FIRST_BYTE_TIMEOUT_MS` | Délai max avant le premier octet de réponse | `60000` |
| `FS_IDLE_TIMEOUT_MS` | Délai max sans données pendant le flux | `90000` |
| `FS_DATA_DIR` | Dossier des données du CLI (session, historique, mémoire, sauvegardes) | `~/.francestudent-cli` |
| `FS_RESUME_IN_PROJECT` | `1` : écrit `RESUME.md` dans le projet | — |
| `FS_API_URL`, `FS_ORIGIN` | Adresses de l'API et du site | API et site France Student |
| `FS_DEBUG` | `1` : journaux de débogage | — |
| `FRST_UI` | `classic` : lance l'ancien CLI avec `frst` | — |
| `FRST_TUI_FULLSCREEN` | `1` : TUI en plein écran (en-tête fixe, défilement) | — |
| `NO_COLOR` | Désactive les couleurs | — |

## Développement

```bash
npm test       # construit la TUI puis lance node --test test/*.test.js
npm run build:tui     # reconstruit dist/tui.mjs
npm run bench:search  # banc de search_files
```

Documentation technique : [docs/architecture.md](docs/architecture.md), [docs/tools.md](docs/tools.md), [docs/tui.md](docs/tui.md), [client-tools.md](client-tools.md) (protocole des outils client) et [CHANGELOG.md](CHANGELOG.md).
