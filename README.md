# FranceStudent CLI

Interface en ligne de commande pour utiliser  ia.francestudent depuis un terminal. Sans projet sélectionné, le CLI fonctionne en chat normal. 

## Fonctionnalités

- Chat avec les agents disponibles (`/model`)
- Mode projet : exploration, recherche, lecture, création et édition de fichiers
- Confirmation avant chaque écriture (`/auto on` la désactive pour la session)
- Annulation de la dernière modification avec `/undo` (sauvegardes et corbeille du CLI)
- Notes persistantes par projet (`/remember`, `/memory`)

## Prérequis

- Node.js
- Un compte FranceStudent avec une session active dans le navigateur

## Installation

```bash
git clone <url-du-depot>
cd project-frstcli
npm install
```

Crée un fichier `.env` à la racine du projet :

```env
FS_SESSION_TOKEN=valeur_du_cookie
```

Pour récupérer la valeur : dans le navigateur, ouvre les outils de développement (F12), va dans Stockage, puis Cookies, sur `https://ia.francestudent.org`, et copie la valeur du cookie `next-auth.session-token`. Ne partage jamais ce fichier `.env`.

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

## Commandes principales

| Commande | Rôle |
| --- | --- |
| `/help` | Affiche l'aide |
| `/project <dossier>` | Sélectionne un projet local |
| `/unproject` | Quitte le mode projet |
| `/tree [dossier]` | Liste un dossier sur deux niveaux |
| `/read <fichier>` | Affiche un fichier |
| `/index` | Régénère le résumé du projet (`RESUME.md`) |
| `/undo` | Annule la dernière modification |
| `/changes` | Liste les modifications annulables |
| `/memory` | Affiche les notes et les dernières actions |
| `/remember <texte>` | Ajoute une note au projet |
| `/mode auto\|agent\|chat` | Choisit quand utiliser les outils fichiers |
| `/model [id]` | Liste ou change d'agent |
| `/new` | Démarre une nouvelle conversation |
| `/exit` | Quitte le CLI |
