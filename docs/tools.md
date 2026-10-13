# Outils de l'agent (src/tools/)

## Organisation

- `tools.js` : façade. Elle réexporte TOOLS, validateToolCall et describeCall, et définit summarizeResult, setProject, unsetProject et undoLast.
- `registry.js` : la liste des outils. Chaque module fournit `name`, `run`, `check` et `describe`. validateToolCall vérifie le nom et les arguments avant l'exécution.
- `security.js` : normalizeRelative, resolveInWorkspace, assertRealInside et PATH_LIMITS. Ce fichier contient les blocages (fichiers d'identifiants, noms réservés Windows, sortie du projet).
- `diff.js` : affichage des différences.
- `fs/` : un fichier par outil (list-directory, read-file, search-files, create-directory, write-file, edit-file, move-path, copy-path, delete-path, remember), plus pair.js pour les outils à deux chemins.
- `core/` : briques communes.
  - `args.js` : contrôle des arguments (requireString, optionalString, optionalInt).
  - `fs-utils.js` : ensureParent (mkdir en mode 0o700), entre autres.
  - `freshness.js` : readTextFile et assertFreshRead.
  - `atomic.js` : writeAtomic(target, content, {expected, read}).
  - `journal.js` : journal des modifications et undoLast.
  - `walk.js` : walkFiles(dir, relDir, {maxFiles}).
- `command/` : run_command (index.js, parse.js, runner.js).

## Ajouter un outil

1. Créer `src/tools/fs/<nom>.js`, qui exporte `{ name, run, check, describe }`.
2. L'ajouter à `MODULES` dans `registry.js`.
3. Si besoin, ajouter un cas dans `summarizeResult` (tools.js).
4. Ajouter un test dans `test/`.

## Règles de sécurité

- Tout chemin passe par resolveInWorkspace : il est relatif, normalisé et filtré.
- Avant d'écrire, assertRealInside suit les liens et jonctions avec realpath, et refuse une cible réelle située hors du projet.
- Les écritures passent par writeAtomic (fichier temporaire puis renommage). L'écriture est refusée si le fichier a changé depuis la lecture.
- Limites : CONFIG.maxWriteChars pour content et new_string, CONFIG.maxReadBytes pour la lecture.

## Performance

- search_files : parcourt les fichiers avec walkFiles, puis les lit par lots de 8 en parallèle. Le texte est mis en minuscules une seule fois par fichier, et le fichier est sauté s'il ne contient pas la recherche. Limites : CONFIG.maxSearchFiles et CONFIG.maxSearchResults.
- read_file : compte les lignes sans split. Le découpage n'est fait que si start_line ou end_line est demandé.
- readTextFile : lit avec fs.open. Un octet nul dans les 4 premiers Ko fait refuser le fichier sans lire la suite.
- Banc : `node scripts/bench-search.js` (2000 fichiers, 5 passes, médiane).

## Tests

`npm test` lance `node --test test/*.test.js`. Fichiers liés aux outils : security, atomic, real-inside, search-files et result-shape.
