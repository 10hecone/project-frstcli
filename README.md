# FranceStudent CLI

Interface en ligne de commande pour utiliser ia.francestudent depuis un terminal. Lancé dans un dossier (`frst`), il y travaille avec ses outils ; `frst --no-project` donne un chat normal sans outils.

## Fonctionnalités

- Chat avec les agents disponibles (`/model`)
- Dossier ouvert au lancement : le modèle explore, cherche, lit, crée et modifie des fichiers et lance des commandes, avec les outils client natifs de l'API France Student
- Modes de permission (`/mode` ou Shift+Tab) : `default` confirme chaque écriture et chaque commande non sûre, `acceptEdits` accepte les écritures, `plan` reste en lecture seule
- Annulation de la dernière modification avec `/undo` (sauvegardes et corbeille du CLI)
- Notes persistantes par projet (`/remember`, `/memory`)
- Plusieurs sessions par dossier : nouvelle session à chaque lancement, reprise avec `frst -c`, `frst --resume` ou `/resume`
- Saisie multi-ligne : `\` en fin de ligne pour continuer, ou bloc entre deux lignes `"""`
- Pré-prompt personnalisé, commun à tous les projets ou propre à un projet (`/preprompt`)
- Mémoire de profil qui se renforce avec l'usage : faits appris sur l'utilisateur et le projet, ajoutés au pré-prompt (`/profil`)
- Serveurs MCP locaux (stdio, http, sse) au format de Claude Code, utilisés par le modèle via la commande `mcp-call` (`/mcp`)
- Application de bureau (Electron) en plus du terminal (`npm run app`)

## Prérequis

- Node.js 22 ou plus récent
- Un compte FranceStudent avec une session active dans le navigateur
- Pour le mode projet : l'accès aux outils client de l'API (« mode avancé », voir [docs/sdkapi.md](docs/sdkapi.md)), disponible avec les modèles OpenAI et Claude

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

Pour disposer de la commande `frst` partout :

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
| `frst` (ou `npm start`) | Interface plein terminal (TUI Ink), dans le dossier courant |
| `frst <dossier>` | Idem, dans le dossier indiqué |
| `frst mcp <commande>` | Gère les serveurs MCP hors session (voir [Serveurs MCP locaux](#serveurs-mcp-locaux)) |
| `npm run app` | Application de bureau (Electron) ; construit l'interface avant de la lancer |

Comme Claude Code, `frst` travaille dans le dossier où il est lancé : il n'y a plus de `/project` ni de `/unproject`. Pour changer de dossier, quitte et relance `frst` ailleurs. Au premier lancement dans un dossier, le CLI demande si tu lui fais confiance ; s'il est refusé, rien n'est ouvert.

| Option | Effet |
| ------ | ----- |
| `-c`, `--continue` | Reprend la dernière session du dossier |
| `-r`, `--resume` | Ouvre la liste des sessions du dossier (↑/↓, Entrée ; Échap = nouvelle session) |
| `--no-project` | Chat sans dossier ni outils locaux |
| `-h`, `--help` | Affiche l'aide de lancement |
| `-v`, `--version` | Affiche la version |

Sans option, chaque lancement démarre une nouvelle session. Les fichiers `FRSTCLI.md` du dossier et de ses parents sont lus comme instructions (le plus proche en dernier, il prime).

`frst` exige un terminal interactif et le bundle `dist/tui.mjs` ; sinon il affiche un message d'erreur et quitte.

### Raccourcis clavier de la TUI

| Touche | Action |
| ------ | ------ |
| Entrée | Envoyer |
| `\` + Entrée, Ctrl+J, Alt+Entrée | Nouvelle ligne |
| ↑ / ↓ | Changer de ligne, puis parcourir l'historique (conservé entre les sessions) |
| Tab | Compléter une commande slash |
| Shift+Tab | Changer de mode de permission (`default` → `acceptEdits` → `plan`) |
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
$ cd mon-projet && frst
› /status
› /tree
› Explique le rôle de src/config.js
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

| Commande | Rôle |
| -------- | ---- |
| `/help` | Affiche l'aide : dossier ouvert, commandes, modes, sessions et options de lancement |
| `/status` | Dossier, confiance, session, branche Git, mode de permission, agent et `FRSTCLI.md` chargés |
| `/pwd` | Affiche le dossier ouvert |
| `/resume [n\|id]` | Reprend une session du dossier (sans argument : sélecteur au clavier) |
| `/mode default\|acceptEdits\|plan` | Mode de permission (aussi Shift+Tab) : tout confirmer, accepter les écritures, lecture seule |
| `/tree [dossier]` | Liste un dossier sur deux niveaux |
| `/read <fichier>` | Affiche un fichier |
| `/index [force\|show]` | Résume le projet avec l'IA et enregistre `RESUME.md` (`force` refait tout, `show` l'affiche) |
| `/init` | Crée `FRSTCLI.md` (instructions du projet), sans écraser un fichier existant |
| `/memory [open]` | `FRSTCLI.md` chargés, notes et dernières actions ; `open` ouvre `FRSTCLI.md` |
| `/remember <texte>` | Ajoute une note au projet |
| `/forget <n\|all>` | Supprime une note du projet (ou toutes) |
| `/plan <demande>` | Propose un plan en lecture seule, sans modification |
| `/undo` | Annule la dernière modification |
| `/changes` | Liste les modifications annulables |
| `/permissions [remove <n\|préfixe>\|clear]` | Liste ou supprime les règles des commandes autorisées (projet) |
| `/jobs [stop <id>\|stop-all]` | Liste ou arrête les commandes en arrière-plan |
| `/new` | Démarre une nouvelle conversation |
| `/compact [consigne]` | Résume la session et repart d'une nouvelle conversation |
| `/context` | Affiche le contexte utilisé, le chat ID et les tours |
| `/chat-id [numéro\|id]` | Affiche les IDs ou reprend une conversation |
| `/history [all]` | Liste les dernières conversations (id, titre, date) |
| `/messages` | Affiche les messages de la session |
| `/usage` | Consommation : session, conversation, limites du compte |
| `/model [nom]` | Liste ou change d'agent |
| `/web on\|off` | Recherche web côté serveur (chat normal) |
| `/fr-project <nom>\|off` | Rattache les nouvelles conversations à un projet FranceStudent (créé s'il n'existe pas) |
| `/preprompt [user\|projet] [texte\|clear]` | Affiche, définit ou efface le pré-prompt (utilisateur par défaut) |
| `/profil [user\|projet] [learn <fait>\|forget <n>]` | Liste, ajoute ou oublie les faits appris (poids renforcés) |
| `/auth [refresh]` | État de la connexion, ou renouvellement du jeton |
| `/login` | Se connecter avec e-mail et mot de passe |
| `/clear` | Efface le terminal |
| `/exit` | Quitte le CLI (alias : `/quit`) |
| `/mcp [list\|get\|add\|add-json\|remove]` | Liste, détaille, ajoute ou supprime des serveurs MCP |
| `/mcp enable\|disable\|reconnect <nom>` | Active, désactive ou reconnecte un serveur MCP |
| `/mcp allow <serveur>` | Autorise tous les appels d'un serveur MCP dans le projet |
| `/mcp login\|logout <nom>` | Connexion OAuth à un serveur MCP http ou sse |
| `/mcp reset-project-choices` | Oublie les approbations des serveurs de `.mcp.json` |

Sans dossier (`frst --no-project`), les commandes liées au projet (`/tree`, `/read`, `/index`, `/init`, `/plan`, `/resume`, `/remember`…) indiquent qu'il faut relancer `frst` dans un dossier.

### Contexte envoyé au modèle

- Au premier message d'une conversation avec un projet ouvert, le CLI joint un contexte court (3 000 caractères au maximum) : nom du projet, système, branche Git, gestionnaire de paquets, commande de test et premier niveau de l'arborescence. Le contenu des fichiers n'est jamais joint : le modèle le lit avec les outils. Les `FRSTCLI.md` du dossier et de ses parents (instructions du projet, voir `/init` ; le plus proche en dernier) et le pré-prompt sont joints aussi. Les messages suivants partent seuls.
- `RESUME.md` n'est plus généré à l'ouverture du projet ni envoyé au modèle. `/index` le génère à la demande (seuls les fichiers modifiés depuis le dernier résumé sont renvoyés à l'IA, `/index force` refait tout) et `/index show` l'affiche.
- Pas de limite de rondes d'outils par défaut. Avec `FS_MAX_AGENT_TURNS=N` (N > 0), le CLI demande toutes les N rondes s'il faut continuer.

### Contexte et compaction

- Après chaque réponse, le CLI lit le pourcentage de contexte utilisé par la conversation. La barre d'état de la TUI l'affiche sous la forme `ctx 42 %` : couleur neutre sous 60 %, jaune de 60 à 80 %, rouge au-delà. Rien n'est affiché si la valeur est inconnue.
- Compaction automatique : avant d'envoyer un message, si le contexte mesuré atteint 85 % (`FS_AUTO_COMPACT=N` pour changer le seuil, `0` pour la désactiver), le CLI demande au serveur de compacter la conversation (`POST /chats/{id}/context`). La conversation est conservée.
- `/context` affiche ce pourcentage, le chat ID de la conversation, le nombre de tours de la session, le seuil de compaction automatique et, s'il y en a un, le résumé `/compact` en attente.
- `/compact` demande au serveur de résumer l'historique de la conversation (`POST /chats/{id}/context`, réservé au propriétaire du chat) : même conversation, contexte réduit.
- `/compact <consigne>`, ou si la compaction serveur échoue, demande au modèle un résumé structuré en français (objectif, décisions prises, fichiers modifiés, tâches restantes). Le résumé (20 000 caractères au maximum) est joint à ton prochain message, qui ouvre une nouvelle conversation : aucune requête supplémentaire n'est envoyée. La consigne oriente le résumé, par exemple `/compact garde les chemins des tests`. L'ancienne conversation reste accessible avec `/chat-id`. Si l'opération échoue, la conversation en cours est conservée.
- Le journal local n'est pas touché : `/undo` et `/changes` fonctionnent toujours après une compaction.

### Outils du modèle

Le CLI utilise les outils client natifs de l'API France Student (voir [docs/sdkapi.md](docs/sdkapi.md)). Six outils sont déclarés, toujours dans le même ordre pour garder le cache de prompt : `list_directory`, `read_file`, `search_files`, `edit_file`, `write_file` et `run_command`. Avec `/plan`, seuls les trois premiers (lecture seule) sont proposés.

- Les résultats sont renvoyés en texte : `read_file` en lignes numérotées, `search_files` en lignes `chemin:ligne: texte` (50 résultats par défaut), `list_directory` avec une entrée par ligne (dossiers terminés par `/`), `run_command` avec la commande, le statut puis la sortie. Les autres résultats restent en JSON compact.
- `read_file` renvoie au plus 30 000 caractères, coupés sur une fin de ligne : le résultat indique la ligne où reprendre (`start_line`).
- La sortie de `run_command` est limitée à 16 000 caractères : le début et la fin sont gardés. La même limite s'applique aux résultats de `mcp-call`.
- L'API accepte 32 résultats au maximum par envoi : si le modèle demande plus d'appels en une fois, seuls les 32 premiers sont exécutés et un avertissement s'affiche.
- Les écritures (`edit_file`, `write_file`) et les commandes non sûres demandent une confirmation en mode `default` ; en mode `acceptEdits`, seules les commandes non sûres en demandent une.
- Liste de tâches : le modèle la tient avec la commande virtuelle `todo` de `run_command` (`todo set "étape 1" "étape 2"`, `todo start <n>`, `todo done <n>`, `todo list`…). Elle s'affiche dans l'interface, ne demande aucune confirmation et est vidée par `/new`.
- Les anciens outils (`glob`, `multi_edit`, `web_search`, `web_fetch`, `delegate`, `todo_write`…) et leurs variables (`FS_WEB`, `FS_SEARCH_*`, `FS_SUBAGENT_*`, `FS_COMPACT_THRESHOLD`) n'existent plus. La recherche web reste disponible en chat normal avec `/web on`.
- Le mode agent séparé a été retiré : le modèle décide lui-même d'appeler ses outils. Une ancienne conversation « agent » reprise avec `/chat-id` continue comme une conversation normale.

### Hooks

Comme dans Claude Code, une commande peut être lancée automatiquement après chaque `edit_file` ou `write_file` réussi (événement `PostToolUse`). Sa sortie est ajoutée au résultat de l'outil : le modèle voit par exemple les erreurs d'un linter et peut les corriger.

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "edit_file|write_file", "glob": "*.luau", "command": "selene {file}", "timeout": 30 }
    ]
  }
}
```

- Fichiers : `.frst/settings.json` dans le projet, et `settings.json` dans le dossier de données (`~/.francestudent-cli/`). La forme imbriquée de Claude Code (`{ "matcher": ..., "hooks": [{ "type": "command", "command": ... }] }`) est aussi acceptée.
- `matcher` : expression sur le nom de l'outil (tous les outils d'écriture si absent) ; `glob` : filtre sur le fichier ; `{file}` : chemin relatif du fichier modifié ; `timeout` en secondes (60 par défaut, 600 au maximum).
- Pas de shell : la commande est découpée comme celles de `run_command` (pas de `&&`, `|` ni redirection) et les programmes interdits (`node -e`…) sont refusés.
- Un hook du projet ne tourne que dans un dossier de confiance, après ton accord. La réponse est mémorisée (`hook-approvals.json`) et redemandée si la définition change.

## Serveurs MCP locaux

Le CLI peut utiliser des serveurs MCP installés sur ta machine. La configuration reprend le format de Claude Code (`mcpServers`) avec trois portées : `local` (par défaut, toi seul dans ce projet), `project` (`.mcp.json` partagé avec le dépôt) et `user` (tous tes projets).

```text
/mcp add fichiers -- npx -y @modelcontextprotocol/server-filesystem .
/mcp add --transport http --header "Authorization: Bearer ${DOCS_TOKEN}" docs https://exemple.org/mcp
/mcp
```

- L'API n'accepte que six outils : le modèle appelle donc les serveurs MCP avec une commande virtuelle de `run_command`, `mcp-call` (`mcp-call list`, `mcp-call tools <serveur>`, `mcp-call run <serveur> <outil> '<json>'`…).
- Les listes et descriptions passent sans confirmation ; les appels d'outils, lectures de ressources et prompts demandent une confirmation (« Toujours » mémorise la règle pour l'outil).
- Les serveurs d'un `.mcp.json` ne démarrent qu'après ton approbation, redemandée si leur définition change.
- Aucun secret en clair sur la ligne de commande : utilise `${VAR}` ou omets la valeur pour une saisie masquée.
- Dans l'application de bureau, la vue « Serveurs MCP » permet d'activer, examiner, connecter ou reconnecter les serveurs.

Détails : [docs/mcp.md](docs/mcp.md).

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
| `FS_MCP_TIMEOUT_MS` | Délai max de démarrage d'un serveur MCP | `30000` |
| `FS_MCP_TOOL_TIMEOUT_MS` | Délai max d'un appel MCP (10 min au plus) | `120000` |
| `FS_DEBUG` | `1` : journaux de débogage | — |
| `FRST_TUI_FULLSCREEN` | `1` : TUI en plein écran (en-tête fixe, défilement) | — |
| `NO_COLOR` | Désactive les couleurs | — |

## Développement

```bash
npm test       # construit la TUI puis lance node --test test/*.test.js
npm run build:tui     # reconstruit dist/tui.mjs
npm run build:gui     # construit l'interface de l'application de bureau
npm run app           # construit puis lance l'application de bureau (Electron)
npm run dist:app      # paquet installable de l'application (electron-builder)
npm run bench:search  # banc de search_files
```

Documentation technique : [docs/architecture.md](docs/architecture.md), [docs/tools.md](docs/tools.md), [docs/tui.md](docs/tui.md), [docs/mcp.md](docs/mcp.md) (serveurs MCP locaux), [docs/sdkapi.md](docs/sdkapi.md) (API et outils client) et [CHANGELOG.md](CHANGELOG.md).
