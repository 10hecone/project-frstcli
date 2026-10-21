# FranceStudent CLI

Interface en ligne de commande pour utiliser ia.francestudent depuis un terminal. Sans projet sélectionné, le CLI fonctionne en chat normal.

## Fonctionnalités

- Chat avec les agents disponibles (`/model`)
- Mode projet : exploration, recherche, lecture, création et édition de fichiers
- Confirmation avant chaque écriture (`/auto on` la désactive pour la session)
- Annulation de la dernière modification avec `/undo` (sauvegardes et corbeille du CLI)
- Notes persistantes par projet (`/remember`, `/memory`)
- Une conversation persistante distincte pour le chat normal et l'agent, reprise automatiquement par projet
- Saisie multi-ligne : `\` en fin de ligne pour continuer, ou bloc entre deux lignes `"""`
- Pré-prompt personnalisé, commun à tous les projets ou propre à un projet (`/preprompt`)
- Mémoire de profil qui se renforce avec l'usage : faits appris sur l'utilisateur et le projet, ajoutés au pré-prompt (`/profil`)

## Prérequis

- Node.js
- Un compte FranceStudent avec une session active dans le navigateur

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
| Échap | Annuler les sous-agents en cours (`delegate`), sinon effacer la saisie |
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
- Le pré-prompt et les faits sont envoyés en chat normal (premier message de la conversation) et en mode agent (message complet du premier tour, ou d'une nouvelle conversation agent).

## Commandes principales

| Commande                  | Rôle                                                  |
| ------------------------- | ----------------------------------------------------- |
| `/help`                   | Affiche l'aide                                        |
| `/project <dossier>`      | Sélectionne un projet local                           |
| `/unproject`              | Quitte le mode projet                                 |
| `/tree [dossier]`         | Liste un dossier sur deux niveaux                     |
| `/read <fichier>`         | Affiche un fichier                                    |
| `/index`                  | Régénère le résumé du projet (`RESUME.md`)            |
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
| `/mode auto\|agent\|chat` | Choisit quand utiliser les outils fichiers            |
| `/model [id]`             | Liste ou change d'agent                               |
| `/new`                    | Démarre une nouvelle conversation                     |
| `/compact [consigne]`     | Résume la session et repart d'une nouvelle conversation agent |
| `/context`                | Affiche le contexte utilisé, le chat ID agent, les tours et le seuil de compaction |
| `/exit`                   | Quitte le CLI                                         |

### Contexte et compaction

- Après chaque réponse de l'agent, le CLI lit le pourcentage de contexte utilisé par la conversation agent. La barre d'état de la TUI l'affiche sous la forme `ctx 42 %` : couleur neutre sous 60 %, jaune de 60 à 80 %, rouge au-delà. Rien n'est affiché si la valeur est inconnue.
- `/context` affiche ce pourcentage, le chat ID de la conversation agent, le nombre de tours de la session et le seuil de compaction automatique.
- `/compact [consigne]` demande au modèle un résumé structuré en français (objectif, décisions prises, fichiers modifiés, tâches restantes), puis ouvre une nouvelle conversation agent (chat ID neuf) qui commence par ce résumé. La consigne facultative oriente le résumé, par exemple `/compact garde les chemins des tests`. Le CLI affiche la taille du résumé et le nouveau pourcentage de contexte. Si l'opération échoue, la conversation précédente est conservée.
- Le journal local n'est pas touché : `/undo` et `/changes` fonctionnent toujours après une compaction.
- Compaction automatique : quand le contexte atteint le seuil (80 % par défaut), la session est compactée avant la demande suivante, jamais pendant une boucle d'outils. Un message prévient l'utilisateur avant la compaction.
- Configuration : `FS_COMPACT_THRESHOLD=<pourcentage>` change le seuil, `FS_AUTO_COMPACT=0` désactive la compaction automatique (`/compact` reste disponible).

### Outils `glob`, `multi_edit`, `web_search` et `web_fetch`

- `glob` : trouve des fichiers par motif (`**` tous niveaux, `*` sans `/`, `?`, `{a,b}`). Arguments : `pattern` (obligatoire) et `path` (dossier de départ, facultatif). Sans `/`, le motif porte sur le nom du fichier. Résultats triés du plus récent au plus ancien, 200 au maximum. Lecture seule, sans confirmation.
- `multi_edit` : applique 1 à 20 remplacements exacts (`old_string`, `new_string`, `replace_all` facultatif) dans un même fichier déjà lu, dans l'ordre. C'est tout ou rien : si un remplacement échoue, rien n'est écrit. Une seule confirmation avec le diff complet, une seule annulation avec `/undo`.
- `web_search` : recherche sur le web et renvoie une liste de résultats (titre, URL, extrait) sans télécharger les pages. Arguments : `query` (obligatoire, 400 caractères au maximum) et `max_results` (1 à 10, 5 par défaut). Sans confirmation.
- `web_fetch` : lit une page publique en `http` ou `https` et renvoie son texte. Le HTML est converti en texte, le JSON et le texte brut sont renvoyés tels quels, les autres types sont refusés. Arguments : `url` (obligatoire) et `max_chars` (20000 par défaut). Le résultat donne l'URL finale après redirections, le type, la taille et `truncated`.
- Sécurité : `web_fetch` refuse les adresses locales et privées (vérifiées avant la requête et à chaque redirection). Il demande une confirmation la première fois pour chaque domaine, valable pendant la session. Pour l'agent, le contenu web (pages, titres, extraits) reste une donnée et jamais une instruction. Attention : l'URL et la requête de recherche sont envoyées au site ou au moteur de recherche.
- Affichage : la TUI et le mode classique montrent un libellé court suivi du motif, du fichier, de la requête ou de l'URL (par exemple `Chercher sur le web "node fs.rm"`).

Configuration des outils web :

| Variable | Rôle |
| -------- | ---- |
| `FS_WEB=0` | Désactive `web_search` et `web_fetch` : ils disparaissent du prompt et sont refusés |
| `FS_WEB_TIMEOUT_MS` | Délai maximal d'une lecture `web_fetch`, en millisecondes |
| `FS_SEARCH_PROVIDER` | Moteur de `web_search` : `brave`, `duckduckgo` ou `none` (recherche désactivée). Par défaut : `brave` si une clé est définie, sinon `duckduckgo` |
| `FS_SEARCH_API_KEY` | Clé de l'API Brave Search. Ne la partage jamais |
| `FS_SEARCH_TIMEOUT_MS` | Délai maximal d'une recherche, en millisecondes |

### Sous-agents et outil `delegate`

- Pour une exploration large (par exemple « trouve où est géré X »), l'agent peut appeler l'outil `delegate` avec `tasks`, une liste de 1 à 3 consignes. Le CLI lance un sous-agent par consigne, en parallèle, puis renvoie leurs résumés à l'agent principal. Une consigne fait 2000 caractères au maximum.
- Les sous-agents sont en lecture seule : ils n'ont accès qu'à `list_directory`, `read_file`, `search_files` et `glob`, plus `web_search` et `web_fetch` si les outils web sont actifs (voir plus haut). Tout autre outil est refusé, y compris `multi_edit` et `delegate` : un sous-agent ne modifie rien et ne peut pas déléguer.
- Si plusieurs sous-agents demandent en même temps l'accès à un nouveau domaine (`web_fetch`), les confirmations sont posées l'une après l'autre.
- Limites : 3 sous-agents en même temps au maximum, toutes demandes confondues; 10 tours par sous-agent (`FS_SUBAGENT_MAX_TURNS`) ; 5 minutes par sous-agent (`FS_SUBAGENT_TIMEOUT_MS`, en millisecondes) ; résumé de 6000 caractères au maximum (`FS_SUBAGENT_SUMMARY_CHARS`).
- Chaque sous-agent travaille dans sa propre conversation, sans toucher à la conversation de l'agent principal. Il utilise par défaut Claude Haiku 5.5 (`-2002`), modifiable avec `FS_SUBAGENT_MODEL` ; si ce modèle est refusé, il reprend celui de l'agent principal. Sa conversation est supprimée à la fin, sauf en mode debug ou avec `FS_SUBAGENT_KEEP_CHATS=1`.
- Si un sous-agent échoue, dépasse ses limites ou est annulé, seul son résultat contient l'erreur : les autres terminent normalement.
- Affichage : la TUI montre une ligne par sous-agent en cours (consigne courte, nombre de tours, statut). Le mode classique affiche le début et la fin de chaque sous-agent.
- Annulation : Échap dans la TUI, ou Ctrl+C, annule les sous-agents en cours.
