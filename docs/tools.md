# Outils de l'agent (src/tools/)

## Organisation

- `tools.js` : façade. Elle réexporte TOOLS, validateToolCall et describeCall, et définit summarizeResult, setProject, unsetProject et undoLast.
- `registry.js` : la liste des outils. Chaque module fournit `name`, `run`, `check` et `describe`. validateToolCall vérifie le nom et les arguments avant l'exécution. Le fichier gère aussi les outils client de l'API ([sdkapi.md](sdkapi.md)) :
  - `CLIENT_TOOLS` : les six outils déclarés à l'API, dans un ordre fixe (cache de prompt) ; `READ_TOOLS` : les trois outils de lecture (`/plan`).
  - `normalizeArgs` : convertit les arguments du catalogue (`old_text`, `timeout_seconds`…) vers ceux des outils locaux et ignore les clés inconnues. `search_files` reçoit 50 résultats par défaut.
  - `runClientTool` : normalise, valide puis exécute un appel.
  - `formatClientResult` : texte renvoyé à l'API (lignes numérotées pour `read_file`, `chemin:ligne: texte` pour `search_files`, une entrée par ligne pour `list_directory`, commande, statut et sortie pour `run_command`, JSON compact pour le reste).
- `security.js` : normalizeRelative, resolveInWorkspace, assertRealInside et PATH_LIMITS. Ce fichier contient les blocages (fichiers d'identifiants, noms réservés Windows, sortie du projet).
- `diff.js` : affichage des différences.
- `fs/` : un fichier par outil (list-directory, read-file, search-files, write-file, edit-file), plus pair.js.
- `core/` : briques communes.
  - `args.js` : contrôle des arguments (requireString, optionalString, optionalInt).
  - `fs-utils.js` : ensureParent (mkdir en mode 0o700), entre autres.
  - `freshness.js` : readTextFile et assertFreshRead.
  - `atomic.js` : writeAtomic(target, content, {expected, read}).
  - `journal.js` : journal des modifications et undoLast.
  - `walk.js` : walkFiles(dir, relDir, {maxFiles}).
- `command/` : run_command (index.js, parse.js, runner.js, program.js). program.js contient filterEnv, killTree et resolveProgram, sortis de runner.js. La sortie renvoyée au modèle est limitée à 16 000 caractères (moitié début, moitié fin, `output.js`). Les commandes en arrière-plan (`jobs.js`) se gèrent avec `/jobs`. `index.js` reconnaît aussi la commande virtuelle `mcp-call`, exécutée dans le processus (src/mcp/call.js), seule, sans enchaînement ni pipe ; sa question de confirmation vient de src/mcp/policy.js.

Les anciens outils `delegate` et `todo_write` (`delegate.js`, `todo-write.js`) ont été retirés.

## Serveurs MCP (src/mcp/)

- `config.js` : lecture, validation et écriture des portées `local`, `project` (`.mcp.json`) et `user` ; développement de `${VAR}`.
- `approvals.js` : approbation des serveurs de `.mcp.json` par empreinte ; `disabled.js` : serveurs désactivés.
- `client.js` : connexion (stdio, http, sse) avec `@modelcontextprotocol/sdk` ; `manager.js` : démarrage paresseux, 8 connexions au plus, arrêt après inactivité, cache des listes.
- `policy.js` : grammaire de `mcp-call`, questions et règles de permission ; `call.js` : exécution et mise en forme des résultats.
- `redact.js` : masquage des secrets ; `oauth.js` : connexion OAuth et jetons ; `cli.js` : commandes `/mcp` et `frst mcp`.

Détails : [mcp.md](mcp.md).

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
- read_file : compte les lignes sans split. Le découpage n'est fait que si start_line ou end_line est demandé. Au-delà de CONFIG.maxReadChars, le texte est coupé sur la dernière fin de ligne.
- readTextFile : lit avec fs.open. Un octet nul dans les 4 premiers Ko fait refuser le fichier sans lire la suite.
- Banc : `node scripts/bench-search.js` (2000 fichiers, 5 passes, médiane).

## Tests

`npm test` lance `node --test test/*.test.js`. Fichiers liés aux outils : security, atomic, real-inside, search-files, result-shape, command-parse, command-runner, program, client-tools, chat-loop et short-context (contexte court, troncature de read_file, formatClientResult). Sous Windows, program.test.js utilise un dossier temporaire avec de faux outil.cmd et outil.exe pour tester findOnWindows et resolveProgram ; ces tests sont ignorés sur les autres systèmes.
