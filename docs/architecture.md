# Architecture de FranceStudent CLI

## Vue d'ensemble
Le CLI est un outil en ligne de commande (Node.js) qui relie un terminal à l'assistant FranceStudent. Sans projet sélectionné, il fonctionne en chat normal. Avec `/project`, l'agent peut lire et modifier des fichiers locaux, après confirmation de chaque écriture.

## Modules (src/)
- `main.js` : point d'entrée et boucle REPL, qui route chaque saisie vers une commande, l'agent ou le chat normal.
- `cli/commands.js` : commandes slash (`/project`, `/undo`, `/model`, etc.).
- `agent/agent.js` : boucle agent entre le modèle et les outils, avec garde-fou anti-répétition.
- `agent/prompt.js` : construction du prompt de l'agent (catalogue d'outils, format JSON, règles de fiabilité).
- `tools/tools.js` : outils fichiers (lecture, recherche, écriture, édition, déplacement, copie, suppression, notes) et annulation.
- `api/api.js` : client HTTP pour l'API de chat en flux SSE.
- `api/auth.js` : session et jetons courts (JWT) obtenus à partir du cookie de session.
- `project/memory.js` : mémoire persistante par projet (notes, journal, pile d'annulation) et mémoire de session.
- `project/conversations.js` : conversations persistantes, une par projet et par mode (`chat` ou `agent`).
- `project/project-context.js` : indexation du projet et génération ou réutilisation de `RESUME.md`.
- `tools/security.js` : validation des chemins et blocage des accès sensibles.
- `cli/router.js` : décision entre passage par l'agent et chat normal.
- `config.js`, `state.js`, `cli/ui.js`, `tools/diff.js` : configuration, état partagé, rendu terminal et diff ligne à ligne.

## Flux principal
1. `index.js` charge l'environnement puis appelle `run()` de `src/main.js`.
2. `main.js` route la saisie : commande, chat normal ou agent.
3. L'agent envoie le contexte au modèle à chaque tour dans sa conversation persistante, exécute un outil, puis enregistre le résultat.
4. Chaque écriture passe par une confirmation et laisse une entrée annulable avec `/undo`.
