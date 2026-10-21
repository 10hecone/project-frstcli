# Journal des modifications

Toutes les modifications notables de FranceStudent Code sont listées ici.

Le format s'inspire de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Le dépôt n'a encore aucun tag git : `package.json` indique la version 1.0.0 et les sections sont découpées par période. Les hash entre parenthèses renvoient aux commits de la branche `dev`.

## [Non publié] — du 2026-10-19 au 2026-10-21

### Ajouté

- Suivi du pourcentage de contexte utilisé (f634589), affiché dans la barre d'état de la TUI (960edb6).
- Commande `compact` pour résumer la session (758bae0) et compaction automatique au-delà du seuil de contexte (8a6e199).
- Commande `context` et documentation de la compaction (b0f6b75).
- Outil `todo_write` avec validation des statuts (5e11f49), consignes dans le prompt de l'agent (4b7bbd7) et affichage en direct des tâches dans la TUI (7603004).
- Moteur de sous-agent en lecture seule (1172c4e), outil `delegate` pour lancer des sous-agents (3b4cd42), affichage et documentation des sous-agents (c49f589).
- Outil `glob` pour trouver des fichiers par motif (c051095).
- Outil `multi_edit` pour plusieurs remplacements atomiques (63f942a).
- Outil `web_fetch` pour lire une page web (d10bbcd) et outil `web_search` pour la recherche web (0fac8da).
- Consignes et documentation des nouveaux outils (eb67a60, d043abd).
- Script `scripts/debug-ctx.js` de diagnostic du pourcentage de contexte (253562f).

### Corrigé

- Routage des demandes d'action et fin de la liste de tâches (f6054bf).
- Réponses JSON illisibles et comparaison d'origine dans la connexion (5933c99).
- Session gardée hors disque et redirections des outils web (72c4738).
- Limites de l'agent, commande de test de la commande `init` et sortie de `frst` (001551e).
- Prompt des sous-agents face aux outils natifs du serveur (52736cc).
- Aucun style ANSI dans la TUI quand les couleurs sont désactivées (cb65b5e).

### Sécurité

- Corrections de sécurité avant les sous-agents : politique des commandes, chemins, journal, `move_path` et `search_files` (da16abe).
- `web_fetch` épingle l'IP vérifiée contre le DNS rebinding (2b6131d).

### Divers

- Test de bout en bout de `todo_write` en mode classique (b123992).
- Suppression du test de diagnostic de la souris (20cda0c).
- `idea.md` et `plan.md` ignorés par git (9125448).

## [1.0.0] — du 2026-10-11 au 2026-10-16

Version de départ, non taguée.

### Ajouté

- Première version du CLI (9adffc7), documentation (a9c12d7, 31e5905) et restructuration (c23428e).
- Reprise des conversations (chat et agent) et historique local (7fdfedc).
- Authentification (6961fdf) et début du parser de commandes (3251b7f).
- Outils extraits dans `src/tools/fs` avec un registre (15fe07f), documentation de `src/tools` (b4c707a).
- `run_command` : description et résumé (359142c), politique `judge()` qui classe les commandes en safe, ask ou deny (13e94fc), pipeline avec `&&`, `||`, `;`, `|`, `cd` et redirections, nettoyage de la sortie et `files_changed` (68a28f9).
- Agent : lecture en lot avec `calls`, jusqu'à 5 lectures par tour (040ff42), exécutées en parallèle (271e0d0).
- Fichier d'instructions `FRSTCLI.md` et commande `init` (142442a).
- Plafond de tours réglable, limite souple et tour sans maximum (9708546).
- Empreinte SHA-1 du contenu et cache de résumé par fichier (df54ed8).
- Historique compacté des anciennes observations et garde-fou anti-boucle pour les lots (9b67207).
- Options regex et glob pour `search_files` (9c20ee6).
- Commande `plan` en lecture seule et CI GitHub Actions (1a33db0).
- Tokens réels lus dans `response.completed`, avec repli sur l'estimation (bd27853).
- Ctrl+C annule la génération via `stream/cancel` (126cc64).
- Commande `usage` : session, conversations et limites du compte (c45d978, a5d333c).
- Une conversation chat et une conversation agent par projet, enregistrées dans `projects.json` (f2cb49b).
- Cache par workspace de l'environnement, des instructions et du contexte projet (9dc2c9d).
- Collage multiligne, Ctrl+V depuis le presse-papier, effacement complet avec Échap et Ctrl+A (97bd49e).
- Rendu Markdown en streaming : titres, listes, blocs de code, citations (954a831).
- Saisie multiligne, pré-prompt personnalisé et mémoire de profil (e9edaca).
- Liaison avec les projets FranceStudent (250793e).
- Liste des agents depuis l'API et choix par nom avec la commande `model` (3fc961e).

#### Interface TUI (Ink)

- Plan d'implémentation (80646d1), chaîne de build et commande `frst` (7bf33f3).
- Port d'interface `ui-bridge` et diff en données pures (e5b40e2, 78838b4).
- Session et chat partagés dans `core` (50e82f8), store et adaptateur de la TUI (674fa9d).
- Étape 5 : application Ink, rectangle d'accueil et transcript (82de4ad).
- Étape 6 : conversation en streaming, composants des outils, diff, plan et saisie (2f461e7).
- Étape 7 : saisie multiligne, historique persistant et raccourcis (2678869).
- Étape 8 : dialogues de confirmation et de saisie (b8a1f73, 72c473a).
- Étape 9 : barre d'état et spinner animé (fd7f8e7).
- Étape 10 : fluidité, redimensionnement et sortie propre (23a2c5e, c680fe1).
- Étape 11 : documentation (README, `docs/architecture.md`, `docs/tui.md`) (cc5bc73).
- Menu des commandes slash sous la saisie (b0f14e9).
- Mode plein écran optionnel avec en-tête fixe et défilement (0bdce72).

### Modifié

- Prompt : `run_command` aligné sur `command` et `timeout_ms` (78f771e).
- Fins de ligne normalisées (4057139).

### Corrigé

- Corrections de l'agent, des tests et de l'interface (2b345ea).
- Imports de `ui` et `state` dans les commandes (f492e7d).
- Excès de tokens (6961fdf) et améliorations de performance (a6291be, 84b7dc6, 1b05532).
- Boucle des réglages sans `autoApprove` (0383f36).
- `.gitignore` corrigé (8217e5a).
- Accolades manquantes dans `ui.js` après un merge (cd7d9fb).

### Sécurité

- Écriture atomique (fichier temporaire puis renommage) pour `write_file` et `edit_file` (2f7a322).
- Limite `maxWriteChars` et dossiers créés en `0o700` (18d56f0).
- Revérification du `realpath` avant écriture contre le TOCTOU (674c3cf).

### Tests

- `resolveProgram` sous Windows (ceef7f3).
- Diagnostic des canaux stdin pour la souris (ff7333f), retiré depuis.
