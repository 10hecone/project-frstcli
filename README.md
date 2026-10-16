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

Lancement :

```bash
node index.js
```

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
- Limite actuelle : le pré-prompt et les faits ne sont envoyés qu'en chat normal, pas encore en mode agent.

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
| `/exit`                   | Quitte le CLI                                         |
