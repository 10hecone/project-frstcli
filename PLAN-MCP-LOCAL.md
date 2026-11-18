# Plan : gestion MCP locale (`mcp-call`) équivalente à Claude Code

Objectif : l'IA de France Student pilote des serveurs MCP **locaux** (stdio, http, sse) sans passer par le service `/mcp/servers` de France Student. Elle n'a qu'une porte d'entrée : la commande `mcp-call`, lancée avec l'outil `run_command`. L'utilisateur gère les serveurs avec `/mcp` (CLI, TUI, GUI) et `frst mcp`, comme `claude mcp` et `/mcp` dans Claude Code.

Travail sur **`main` uniquement** (état de départ : `8752608`). Coche les cases au fur et à mesure (`- [x]`).

---

## Constat (relu sur `main`)

| Fait | Source | Conséquence |
|---|---|---|
| L'API n'accepte que 6 outils client, dans un ordre fixe (cache de prompt) | `docs/sdkapi.md` l.237, `registry.js` (`CLIENT_TOOLS`) | Aucun nouvel outil possible : MCP passe par `run_command` |
| `run_command` n'utilise jamais de shell ; `; & \| > < $VAR` sont refusés ou analysés | `command/parse.js`, `command/pipeline.js` | Le JSON des arguments doit être entre apostrophes |
| `clientTools` ne contient que des **noms** d'outils ; leur description est côté serveur France Student | `docs/sdkapi.md` l.596 et l.599 | On ne peut pas décrire `mcp-call` à l'IA dans le catalogue, et elle ne le connaît pas (contrairement à `git` ou `npm`) : la commande doit se découvrir toute seule (voir « Décisions ») |
| Une ligne de commande fait 4000 caractères maximum | `MAX_COMMAND_CHARS` | Les gros arguments passent par `--args-file` |
| Programme inconnu = confirmation ; chaque argument « qui ressemble à un chemin » est vérifié | `command/policy.js` | `mcp-call` a sa propre règle : un JSON n'est pas un chemin |
| Règles « toujours autoriser » = préfixes de mots, par projet, fichier `permissions.json` (0o600, écriture atomique) | `command/permissions.js` | On réutilise ce fichier, pas de second système |
| `filterEnv` retire `FS_*` (identifiants France Student) et tout nom contenant TOKEN, SECRET, KEY, PASSWORD, CREDENTIAL | `command/program.js` | Un serveur MCP ne reçoit jamais ces variables, sauf celles que l'utilisateur déclare dans son `env` |
| Sortie renvoyée au modèle : 16 000 caractères (`cleanOutput`), 40 000 par résultat et 120 000 par envoi (`chat.js`) | `command/output.js`, `core/chat.js` | Même plafond pour MCP |
| `git push` est refusé à l'agent ; `git commit` demande confirmation | `command/policy.js` | Tu pousses toi-même |
| Aucun code MCP dans `src/` | recherche `mcp` | Tout est à créer |
| `docs/tools.md` et `CHANGELOG.md` citent `delegate.js`, `todo-write.js`, `client-tools.md` et la branche `dev` : absents de `main` | listage de `src/tools/`, `docs/` | Ne pas se fier à ces docs ; les corriger à l'étape 11 |

Hypothèse : « la boîte d'outils » de `mcp-call <le mcp> <la boîte d'outils>` = l'outil du serveur MCP. `mcp-call tools <serveur>` (ou le raccourci `mcp-call <serveur>`) liste donc la « boîte » (tous ses outils).

---

## Décisions prises

- **`mcp-call` est traité comme `git` et `npm`** : un programme connu de la politique de `run_command` (branche dédiée dans `judge()`), mais virtuel, intercepté avant tout lancement de processus. Il se lance **seul** : pas de `&&`, `||`, `;`, `|` autour.
- **`mcp-call` est réservé à l'IA.** Ce n'est pas une commande de l'utilisateur : aucun binaire, rien dans le `PATH`, rien dans `bin/` ni dans `package.json`, et il ne marche que dans `run_command`. Il remplace la création d'un 7e outil (impossible, voir « Constat »). L'utilisateur, lui, gère les serveurs avec `/mcp` (et `frst mcp`, étape 8, facultative).
- **L'IA ne connaît pas `mcp-call`, donc la commande doit se découvrir comme n'importe quelle CLI** : sous-commandes classiques (`list`, `tools`, `run`…), `--help` à chaque niveau, et en cas d'erreur d'usage un message qui affiche la ligne d'usage correcte (comme `git` et `npm`). Le premier message ne contient qu'**une ligne** de rappel ; le mode d'emploi complet est dans `mcp-call --help`.
- **Une dépendance : `@modelcontextprotocol/sdk`** (SDK officiel, version v1 stable, épinglée). Les transports stdio et HTTP, OAuth (PKCE, enregistrement dynamique), les notifications et la reprise représentent des milliers de lignes ; les réécrire serait plus risqué que la dépendance. `StdioClientTransport` et `Client` viennent de `.../client/stdio.js` et `.../client/index.js`. `SSEClientTransport` est déprécié : gardé seulement pour `type: "sse"`.
- **Même format de config que Claude Code** : `{ "mcpServers": { "<nom>": { "type", "command", "args", "env", "url", "headers", "timeout" } } }`.
- **3 scopes, comme Claude Code** (précédence : `local` > `project` > `user`, pas de fusion champ par champ) :

  | Scope | Fichier |
  |---|---|
  | `local` (défaut) | `~/.francestudent-cli/projects/<projet>/mcp.json` (privé, ce projet) |
  | `project` | `<projet>/.mcp.json` (partageable, lisible par Claude Code aussi) |
  | `user` | `~/.francestudent-cli/mcp.json` (tous les projets) |
- **Les serveurs du projet (`.mcp.json`) ne démarrent qu'après ton approbation.** Un dépôt cloné ne doit pas pouvoir lancer un programme chez toi.
- **Démarrage paresseux** : un serveur ne se lance qu'au premier appel, et s'arrête à la sortie du CLI.
- **Un appel d'outil MCP demande toujours confirmation**, sauf règle « toujours autoriser » enregistrée pour ce `serveur + outil`. Les indications du serveur (`readOnlyHint`…) sont affichées, **jamais** utilisées pour autoriser : elles viennent d'un tiers.
- **Tout ce qui vient d'un serveur est une donnée non fiable** (description d'outil, résultat, erreur) : nettoyée, plafonnée, étiquetée.
- **Les secrets ne sont jamais écrits développés, affichés ni renvoyés à l'IA.**
- Mode `plan` : `run_command` n'est pas proposé, donc pas de `mcp-call`. Mode `acceptEdits` : ne change rien (un appel MCP n'est pas une écriture de fichier).

### Grammaire de `mcp-call` (ce que l'IA utilise)

```
mcp-call --help                                aide générale (sous-commandes et exemples)
mcp-call list                                  serveurs configurés et état (ne démarre rien)
mcp-call tools <serveur>                       outils du serveur (nom + description courte)
mcp-call describe <serveur> <outil>            schéma d'entrée de l'outil
mcp-call run <serveur> <outil> ['<json>']      appel (sans JSON : arguments {})
mcp-call run <serveur> <outil> --args-file <chemin>   JSON lu dans un fichier du projet
mcp-call resources <serveur>                   ressources du serveur
mcp-call read <serveur> <uri>                  lire une ressource
mcp-call prompts <serveur>                     prompts du serveur
mcp-call prompt <serveur> <nom> ['<json>']     obtenir un prompt
```

Chaque niveau accepte `--help`. Ta forme `mcp-call <serveur> <outil> ['<json>']` reste acceptée comme **raccourci** : `mcp-call <serveur>` = `tools`, et `mcp-call <serveur> <outil> …` = `run`. Elle est ramenée à la forme complète avant toute décision de permission. Les noms de serveur qui sont des sous-commandes (`list`, `tools`, `describe`, `run`, `resources`, `read`, `prompts`, `prompt`, `help`) sont réservés et refusés par `config.js`, pour que le raccourci ne soit jamais ambigu.

Code de sortie : `0` succès ; `1` l'outil répond `isError` ; `2` erreur d'usage, serveur inconnu ou protocole.

### Équivalence avec Claude Code

| Claude Code | Ici | Étape |
|---|---|---|
| Transports stdio, http, sse | idem | 3 |
| Scopes local, project, user et précédence | idem | 1 |
| `${VAR}` et `${VAR:-défaut}` dans `command`, `args`, `env`, `url`, `headers` | idem, plus sûr (voir étape 1) | 1 |
| Approbation des serveurs du projet, `reset-project-choices` | idem | 2, 7 |
| `claude mcp add`, `add-json`, `list`, `get`, `remove`, `login`, `logout` | `/mcp …` et `frst mcp …` | 7, 8 |
| `/mcp` : statuts, reconnecter, activer ou désactiver | `/mcp list`, `reconnect`, `enable`, `disable` | 7 |
| Délai de démarrage (30 s), délai par serveur `timeout`, arrêt après inactivité (stdio 30 min, http 5 min) | `FS_MCP_TIMEOUT_MS`, champ `timeout`, minuteur d'inactivité | 3 |
| Reconnexion http/sse : 5 essais, attente doublée à partir de 1 s | idem | 3 |
| Notifications `list_changed` | le cache d'outils est invalidé | 3 |
| Chargement différé des outils (tool search) | liste à la demande via `mcp-call tools <serveur>` | 6 |
| Ressources et prompts | `resources`, `read`, `prompts`, `prompt` | 5 |
| OAuth : DCR, `--client-id`, `--client-secret`, `--callback-port`, renouvellement | idem | 9 |
| Limite de sortie (25 000 tokens) | 16 000 caractères, comme toute commande | 5 |
| WebSocket, `headersHelper` (commande shell arbitraire), plugins, réglages d'organisation, connecteurs claude.ai, `add-from-claude-desktop`, `mcp serve` | **hors périmètre** | — |

Écarts assumés :
- **Variable `${VAR}` non définie et sans défaut** : Claude Code charge quand même le serveur avec le texte `${VAR}` ; ici le serveur ne démarre pas et l'erreur nomme la variable (sinon un faux jeton partirait chez le serveur).
- **`FS_*` n'est jamais développé** dans une config (ce sont les identifiants France Student).
- Délai d'un appel : 10 minutes maximum (comme `run_command`), au lieu de ~28 h.

---

## Architecture visée

```
src/mcp/
  config.js     lecture/écriture des 3 scopes, validation, ${VAR}, précédence
  approvals.js  approbation des serveurs du projet (empreinte de la définition)
  client.js     une connexion (SDK) : transport, délais, reconnexion, arrêt
  manager.js    connexions paresseuses, cache d'outils, arrêt à la sortie
  call.js       grammaire de mcp-call, exécution, mise en forme de la sortie
  policy.js     judgeMcpCall (appelé par tools/command/policy.js)
  redact.js     masquage des secrets (valeurs d'env et d'en-têtes, clés sensibles, URL)
  oauth.js      fournisseur OAuth, serveur de retour sur 127.0.0.1, jetons
  cli.js        runMcpCommand(argv) : utilisé par /mcp et par frst mcp
test/fixtures/fake-mcp-server.js   serveur MCP stdio de test
src/gui/mcp.js                     données du panneau MCP de la GUI (sans Electron)
```

Fichiers existants modifiés : `tools/command/policy.js`, `tools/command/permissions.js`, `tools/command/index.js`, `project/short-context.js`, `project/memory.js` (exporter `projectDir`), `cli/command-list.js`, `cli/commands.js`, `config.js`, `bin/frst.js`, `package.json` et `package-lock.json` ; pour la GUI : `gui/host.js`, `gui/channels.js`, `electron/ipc.js`, `electron/preload.js` et, dans `gui/renderer/`, `api/client.js`, `hooks/useWorkspace.js`, `components/ActivityBar.jsx`, `components/Icons.jsx`, `components/Sidebar.jsx`, `styles/sidebar.css`, `styles/app.css`.

---

## Règles git (branche `main` seulement)

Avant de commencer :

```bash
git switch main
git pull --ff-only origin main
git status                     # arbre propre
npm ci && npm test             # base verte (pretest construit la TUI)
```

À chaque étape :

```bash
npm test                       # doit passer
git add <fichiers de l'étape>  # jamais "git add -A" ni "git add ."
git diff --cached              # relire : aucun secret, aucun .env, aucun chemin perso
git commit -m "feat: ..."
git push origin main           # puis attendre la CI verte (Ubuntu et Windows) avant l'étape suivante
```

- Un commit = une étape = tests verts. Pas de `--no-verify`, pas de `push --force`.
- Retour arrière d'une étape : `git revert <sha>` (jamais `reset --hard`).
- `package.json` et `package-lock.json` partent **dans le même commit** (la CI lance `npm ci`).
- Ordre voulu : la fonction `mcp-call` n'est branchée qu'à l'étape 6. Avant, un `mcp-call` demandé par l'IA donne « Programme introuvable » : rien ne s'exécute.

---

## Phase 0 : préparation

- [x] **0. Dépendance et test de fumée**
  - `npm install --save-exact @modelcontextprotocol/sdk` (dans `dependencies`, pas `devDependencies`).
  - `test/mcp-sdk.test.js` : `require` de `.../client/index.js`, `.../client/stdio.js`, `.../client/streamableHttp.js`, `.../client/sse.js` et `.../types.js` ; vérifie que `Client`, `StdioClientTransport`, `StreamableHTTPClientTransport` sont des fonctions. Ce test garde le contrat si le SDK change.
  - Vérifier : `require` fonctionne depuis le CommonJS de `src/` (la TUI laisse `src/` hors du bundle, voir `scripts/build-tui.js`), et `npm run dist:app` embarque bien le SDK (electron-builder prend les `dependencies`).
  - Déjà contrôlé dans `package.json` et `.gitignore` : `build.files` contient `src/**/*` (donc `src/mcp/` est embarqué sans rien ajouter ; seul `src/gui/renderer/**` est exclu) et le champ `files` de npm contient `src` ; `dist/`, `release/` et `FRSTCLI.md` sont dans `.gitignore` (rien de généré n'entre dans un commit) ; `test/fixtures/` n'est pas embarqué (normal). Reste à vérifier après `npm run dist:app` : la présence du SDK dans l'application installée (`app.asar`).
  - Commit : `chore: dépendance @modelcontextprotocol/sdk`

## Phase 1 : configuration et approbation

- [x] **1. `src/mcp/config.js` : scopes, validation, variables**
  - Exporter `projectDir(workspace)` depuis `project/memory.js` (aujourd'hui interne) : `frst mcp` doit lire le scope `local` sans ouvrir une session.
  - Validation à la lecture **et** à l'écriture :
    - nom : `^[A-Za-z0-9_-]{1,64}$` (évite l'injection d'arguments et les noms de fichiers piégés), et différent des sous-commandes réservées de `mcp-call` ;
    - `type` : `stdio` (défaut si `command`), `http`, `sse` ; autre valeur refusée, avec message clair (`ws` : hors périmètre) ;
    - `stdio` : `command` non vide, `args` tableau de chaînes, `env` objet chaîne→chaîne ;
    - `http`/`sse` : `url` de 2048 caractères maximum, `https` obligatoire (`http` seulement pour `localhost`, `127.0.0.1`, `[::1]`), pas d'identifiants dans l'URL (`user:mdp@`) ;
    - `timeout` : entier ≥ 1000 (sinon ignoré) ; 50 serveurs maximum par scope.
  - Entrée mal formée : ignorée avec un avertissement qui nomme le champ, les autres serveurs se chargent.
  - Développement `${VAR}` / `${VAR:-défaut}` **à la connexion seulement** : la config sur disque garde le modèle, `get` l'affiche tel quel. `FS_*` et variable absente sans défaut : erreur (voir « Écarts assumés »).
  - Écriture : même schéma que `permissions.js` (fichier temporaire, `rename`, `chmod 0o600`, dossier 0o700). Si trois copies apparaissent, extraire un helper commun dans `tools/core/fs-utils.js`.
  - Précédence `local` > `project` > `user` par nom ; chaque serveur garde son `scope` d'origine.
  - Tests `test/mcp-config.test.js` : validation, précédence, `${VAR}`, `FS_*` refusé, fichier 0o600 (hors Windows), entrée invalide ignorée.
  - Commit : `feat: configuration des serveurs MCP (scopes local, project, user)`

- [x] **2. `src/mcp/approvals.js` : approbation des serveurs du projet**
  - Seuls les serveurs du scope `project` sont concernés. Le dossier doit d'abord être de confiance : `workspace.open()` ne l'ouvre qu'après la question de confiance (`trusted` dans `projects.json`), donc sans dossier ouvert ces serveurs sont ignorés.
  - Fichier `~/.francestudent-cli/mcp-approvals.json` (0o600) : `{ version: 1, projects: { "<clé du dossier>": { "<nom>": { "sha256": "...", "decision": "approved|rejected" } } } }`. La clé du dossier se calcule comme `projectDir` (minuscules sous Windows).
  - L'empreinte couvre la définition complète (commande, arguments, noms **et valeurs** d'`env`, URL, en-têtes). **Toute modification redemande l'approbation** : un `git pull` ne peut pas changer silencieusement la commande lancée.
  - Question posée : nom, commande + arguments (ou URL), **noms** des variables d'env et d'en-têtes (jamais les valeurs), puis oui / non. Un refus est mémorisé ; `reset-project-choices` l'efface.
  - Sans terminal (`frst mcp list`) : statut « en attente d'approbation », rien ne démarre.
  - Tests `test/mcp-approvals.test.js` : empreinte stable, changement d'un argument ⇒ nouvelle question, refus mémorisé, dossier non approuvé ⇒ serveur ignoré.
  - Commit : `feat: approbation des serveurs MCP du projet`

## Phase 2 : connexion

- [x] **3. `src/mcp/client.js` et `src/mcp/manager.js`**
  - Ajouter dans `config.js` (modèle `envInt`) : `FS_MCP_TIMEOUT_MS` (démarrage, 30 000), `FS_MCP_TOOL_TIMEOUT_MS` (appel, 120 000 par défaut, 600 000 maximum).
  - **stdio** : programme résolu par `resolveProgram` (npx sous Windows), `shell: false`, dossier de travail = racine du projet, environnement = `filterEnv()` + `env` déclaré et développé (seules entrées qui peuvent contenir des secrets). `stderr: "pipe"` (la valeur par défaut du SDK, `inherit`, casserait l'affichage de la TUI) dans un tampon circulaire de 8 000 caractères.
  - **http** : `StreamableHTTPClientTransport` avec les en-têtes développés. **sse** : `SSEClientTransport`, seulement si `type: "sse"`.
  - Un seul `connect()` en vol par serveur (les appels simultanés partagent la promesse) ; délai de démarrage ; connexion refusée si le serveur est désactivé ou non approuvé.
  - Appel : `callTool` avec `AbortSignal` (Ctrl+C : le `signalHandle` de `run_command` existe déjà) et délai ; 8 serveurs connectés au maximum.
  - Reconnexion http/sse : jusqu'à 5 essais, attente doublée à partir de 1 s ; pas de reconnexion automatique pour un premier démarrage stdio ni pour une erreur d'authentification.
  - Arrêt après inactivité (stdio 30 min, http 5 min, minuteur `unref`) ; `process.once("exit", killAll)` avec `killTree` (comme `jobs.js`) pour qu'aucun processus ne survive. À confirmer dans le SDK : lecture du `pid` du transport stdio.
  - `list_changed` : le cache des outils, ressources et prompts est invalidé ; en cas d'échec de rafraîchissement, l'ancien cache est gardé.
  - Changement de dossier (`/project`, sélecteur de la GUI, seconde instance) : le gestionnaire s'abonne à `workspace.onChange` (`core/workspace.js`), arrête les serveurs du dossier précédent et recharge les scopes `local` et `project`. Sans cela, un serveur lancé pour un projet resterait actif dans un autre.
  - Programme introuvable (`npx`, `node`, `uvx`…) : état « échec » avec un message lisible (« `npx` est introuvable dans le PATH : installe-le ou corrige la commande »). Jamais de repli sur l'exécutable d'Electron : il lancerait une seconde application. Cas réel de la GUI : un utilisateur sans Node.js installé. Sous macOS et Linux, une application lancée depuis le Finder ou le menu des applications reçoit souvent un `PATH` minimal (`npx`, `node`, `uvx` introuvables alors qu'ils marchent dans un terminal) : le message d'erreur le mentionne et conseille d'indiquer le chemin complet dans `command`.
  - `redact.js` : toute chaîne qui sort du module (erreurs, stderr, affichage) est passée dans `redact()` : valeurs développées d'`env` et d'en-têtes remplacées par `***`, URL sans paramètres sensibles, clés `token|secret|key|password|authorization|credential` masquées dans le JSON affiché.
  - Fixture `test/fixtures/fake-mcp-server.js` (SDK serveur + stdio) : outils `echo`, `slow`, `fail`, `env_keys`, `big`.
  - Tests `test/mcp-client.test.js` : connexion, liste, appel, délai dépassé, Ctrl+C, arrêt du processus à la fermeture, **le serveur ne reçoit ni `FS_*` ni `*_TOKEN` du parent mais reçoit son `env` déclaré**, stderr plafonné et masqué.
  - Commit : `feat: connexion paresseuse des serveurs MCP (stdio, http, sse)`

## Phase 3 : la commande `mcp-call` pour l'IA

- [x] **4. Politique et permissions (avant le branchement)**
  - `src/mcp/policy.js` : `judgeMcpCall(args)`.
    - `deny` : nom de serveur invalide, `--args-file` hors du projet. Une erreur d'usage n'est **pas** refusée : elle atteint `call.js`, qui affiche l'usage (code 2).
    - `safe` : `--help`, `list`, `tools`, `describe`, `resources`, `prompts` (lecture seule ; le démarrage d'un serveur reste soumis à l'étape 2).
    - `ask` : `run`, `read`, `prompt`.
  - `tools/command/policy.js` : branche `if (name === "mcp-call") return judgeMcpCall(list)` **avant** la boucle de vérification des chemins (un JSON n'est pas un chemin). `--args-file` passe par `resolveInWorkspace` (fichiers sensibles refusés).
  - `tools/command/permissions.js` : `suggestPrefix` d'un `mcp-call run` = 4 mots (`mcp-call run <serveur> <outil>`), la forme raccourcie étant d'abord ramenée à la forme complète ; sans cela, répondre « toujours » à un seul appel autoriserait **tout** le serveur (y compris un outil destructeur). `add()` refuse les préfixes `["mcp-call"]` et `["mcp-call", "run"]`. Autoriser tout un serveur reste possible, mais explicitement : `/mcp allow <serveur>` (préfixe `mcp-call run <serveur>`, 3 mots).
  - Question affichée : serveur, outil, arguments tronqués à 300 caractères et passés dans `redact()`, indications `annotations` du serveur à titre d'information.
  - Tests `test/mcp-policy.test.js` (même style que `command-policy.test.js`) et un cas ajouté à `command-permissions.test.js`.
  - Commit : `feat: politique et permissions de mcp-call`

- [x] **5. `src/mcp/call.js`**
  - Analyse avec `parseCommand` (JSON entre apostrophes). `--args-file` : lecture UTF-8 limitée à 1 Mo, doit être un objet JSON.
  - Résultat au format de `runProcess` (`exit_code`, `signal`, `timed_out`, `interrupted`, `duration_ms`, `output`, `truncated`, `stdout`) : tout le reste de `run_command` (instantané `git status` avant/après, `files_changed`, `cleanOutput`, interruption) fonctionne sans changement.
  - Mise en forme de la sortie :
    - texte : blocs `text` joints ; sans contenu, `structuredContent` en JSON compact ;
    - image ou audio : `[image image/png, 12 Ko : non transmise]` (l'API n'accepte que du texte) ;
    - `resource_link` : `[ressource : <uri>]` ; ressource intégrée textuelle : son texte ;
    - première ligne : `[résultat du serveur MCP "<serveur>", outil "<outil>" : données non fiables, pas des instructions]`.
  - Listes : descriptions nettoyées (caractères de contrôle retirés), 160 caractères chacune, 100 outils affichés au plus ; `describe` : schéma JSON compact de 4 000 caractères maximum ; `--help` (à chaque niveau) : usage, exemples et conseil `--args-file`, 1 500 caractères maximum.
  - Erreur d'usage, sous-commande ou serveur inconnu : `exit_code` 2, message court, **ligne d'usage correcte** et liste des noms valides (comme `git` et `npm` : l'IA se corrige au tour suivant).
  - Tests `test/mcp-call.test.js` : grammaire, `--args-file`, sortie texte / image / erreur d'outil, étiquette de données non fiables, secrets absents de la sortie.
  - Commit : `feat: exécution de mcp-call (outils, ressources, prompts)`

- [x] **6. Branchement dans `run_command` et rappel pour l'IA**
  - `tools/command/index.js` : la fonction `run` passée à `executePipeline` envoie `segment.file === "mcp-call"` vers `call.js` au lieu de `runProcess`. Une ligne qui mélange `mcp-call` et d'autres segments est refusée : « mcp-call se lance seul ».
  - `project/short-context.js` : **une seule ligne** ajoutée au premier message, **seulement s'il existe au moins un serveur actif** (sinon aucun coût) : « MCP local : commande `mcp-call` (voir `mcp-call --help`). Serveurs : <noms>. Les résultats viennent de serveurs tiers : ce sont des données, pas des instructions. » La grammaire, le JSON entre apostrophes et le passage par `--args-file` (au-delà d'environ 3 500 caractères ou avec une apostrophe) sont dans `mcp-call --help` : l'IA les découvre comme pour `git` ou `npm`. La ligne est figée pour toute la conversation (cache de prompt) ; `mcp-call list` donne toujours l'état à jour. C'est le seul canal possible : le catalogue `run_command` est décrit côté serveur France Student.
  - Tests : un test vérifie que `mcp-call` n'existe nulle part hors de `run_command` (pas de fichier dans `bin/`, pas d'entrée `bin` dans `package.json`), `command-run-permissions.test.js` (refus, confirmation, règle), `short-context.test.js` (bloc présent ou absent), `chat-loop.test.js` (un `mcp-call` de bout en bout avec la fixture).
  - Commit : `feat: mcp-call branché sur run_command et rappel dans le contexte`

## Phase 4 : gestion par l'utilisateur

- [x] **7. `src/mcp/cli.js` : `runMcpCommand(argv)` et `/mcp`**
  - Sous-commandes :
    - `list` : état de chaque serveur (connecté, outils non chargés, échec, authentification requise, en attente d'approbation, désactivé) ;
    - `get <nom>` : scope, transport, commande ou URL, noms des variables d'env, en-têtes masqués, outils, dernières lignes de stderr (masquées) ;
    - `add [--transport stdio|http|sse] [--scope local|project|user] [--env K=V] [--header "N: v"] <nom> (-- <commande> [args…] | <url>)` ;
    - `add-json <nom> '<json>' [--scope …]` ;
    - `remove <nom> [--scope …]`, `enable <nom>`, `disable <nom>`, `reconnect <nom|all>`, `login <nom>`, `logout <nom>`, `allow <serveur>`, `reset-project-choices`.
  - `add` : `--scope project` écrit `.mcp.json` à la racine (seul cas où le CLI écrit dans le dossier du projet) ; un nom déjà présent dans ce scope est refusé.
  - Secrets : une valeur **en clair** pour une clé sensible (`token|secret|key|password|authorization`) est **refusée** sur la ligne ; `/mcp add` redemande la valeur avec saisie masquée (`ui.askSecret`), ou accepte une référence `--env CLE=${VARIABLE}`. Ainsi le secret n'apparaît jamais dans la ligne tapée : ni dans l'historique de la TUI (`tui/history-file.js`), ni dans le fil de la GUI (qui affiche chaque saisie).
  - `command-list.js` : une entrée `/mcp …` (utilisée par l'aide et l'auto-complétion de la GUI) ; `commands.js` : un `case "/mcp"` qui appelle `runMcpCommand`.
  - Tests `test/mcp-cli.test.js` : analyse de `add`, scopes, refus d'un doublon, `get` sans secret, `reset-project-choices`.
  - Commit : `feat: commande /mcp`

- [x] **8. `frst mcp …` hors session (facultatif : double `/mcp`, à supprimer si tu ne le veux pas)**
  - `bin/frst.js` : si le premier argument est `mcp`, appeler `runMcpCommand` **avant** le choix de l'interface et sans connexion France Student (`bootstrap` n'est pas lancé) ; code de sortie 0 ou 1. Lire `bin/frst.js` en entier avant de modifier (cette analyse n'a lu que son début).
  - Test dans `tui-launcher.test.js` : `frst mcp list` ne lance ni la TUI ni l'authentification.
  - Commit : `feat: frst mcp en ligne de commande`

## Phase 5 : OAuth

- [x] **9. `src/mcp/oauth.js`**
  - Fournisseur du SDK (`OAuthClientProvider`) : PKCE, enregistrement dynamique, découverte (RFC 9728 puis RFC 8414, gérée par le SDK), `--client-id` / `--client-secret` (saisie masquée) / `--callback-port`, renouvellement automatique.
  - Retour d'autorisation : serveur HTTP lié à **`127.0.0.1` seulement**, port aléatoire (ou `--callback-port`), paramètre `state` vérifié, usage unique, fermeture après réponse, abandon au bout de 5 minutes.
  - Annulation : `oauth.js` exporte `cancelPending()` (ferme le serveur de retour, libère le port, rejette la promesse du flux en cours ; idempotente, sans effet s'il n'y a rien en cours). Elle sert à `/mcp logout`, à la fermeture du CLI (`process.once("exit")`) et à `dispose()` de la GUI (étape 10).
  - Jetons dans `~/.francestudent-cli/mcp-auth.json` (0o600), clé = nom + empreinte de l'URL (changer l'URL invalide les jetons). `logout` les supprime.
  - Ouverture du navigateur : une fonction `openUrl` **remplaçable** (`setUrlOpener`). Par défaut, programme fixe avec `spawn` sans shell : `rundll32 url.dll,FileProtocolHandler <url>` sous Windows (jamais `cmd /c start` : l'esperluette `&` de l'URL casserait la commande), `open` sous macOS, `xdg-open` ailleurs. L'URL est aussi affichée pour l'ouvrir à la main. **La validation est faite dans `oauth.js`, avant d'appeler l'ouvreur, quel qu'il soit** : `https` (ou `http` seulement pour `localhost`, `127.0.0.1`, `[::1]`, même règle que `config.js`), 2048 caractères maximum, sans identifiants (`user:mdp@`), sinon refusée ; jamais `file:`, `javascript:` ni protocole personnalisé. La GUI remplace la fonction par `shell.openExternal` (étape 10) : elle ne reçoit donc que des URL déjà validées et ne doit pas être appelée autrement.
  - Statut « authentification requise » dès qu'un 401 arrive ; une fois connecté, l'IA n'a rien à faire (elle ne voit jamais un jeton).
  - Tests `test/mcp-oauth.test.js` : `state` faux refusé, écoute sur 127.0.0.1, expiration, permissions du fichier, `logout`, **URL refusée avant l'ouvreur même s'il est remplacé** (`file:`, `javascript:`, `http://exemple.com`, identifiants dans l'URL, plus de 2048 caractères), `cancelPending()` (port libéré, promesse rejetée, second appel sans erreur). Essai manuel contre un vrai serveur OAuth (non automatisable ici).
  - Avant cette étape, un serveur http protégé par jeton fonctionne déjà avec `--header "Authorization: Bearer ${JETON}"`.
  - Commit : `feat: authentification OAuth des serveurs MCP http`

## Phase 6 : interface Electron (GUI)

**Ce que la GUI reçoit sans rien faire.** Le processus principal d'Electron exécute le même cœur (`src/`) que le CLI, dans un seul processus (`electron/ipc.js` → `src/gui/host.js` → `core/session.js`). Dès l'étape 6 :
- `mcp-call` marche dans `run_command` ;
- la confirmation d'un appel s'affiche dans `PromptDialog.jsx` (type `command`, avec le bouton « Toujours « mcp-call run github create_issue » ») ;
- l'approbation d'un serveur du projet est un dialogue `confirm` ;
- les valeurs secrètes (`ui.askSecret`) arrivent dans un champ masqué ;
- `/mcp …` se tape dans la barre de chat et apparaît dans l'auto-complétion (la liste `command-list.js` est partagée avec la page) ;
- la page n'a aucun accès réseau (`connect-src 'none'` dans `index.html`) et doit le rester : tout MCP passe par le processus principal.

Reste à faire pour la GUI :

- [x] **10. Cycle de vie : fermeture, changement de dossier, OAuth**
  - `src/gui/host.js` : `createGuiHost` reçoit un paramètre injectable `mcp` (comme `jobs`) et `dispose()` appelle `mcp.killAll()` dans un `attempt` de plus. Chemin d'arrêt réel : fermer la fenêtre → `window-all-closed` → `app.quit()` → `before-quit` → `ipc.dispose()` → `host.dispose()`. Sans cette ligne, les serveurs stdio survivraient à l'application.
  - Changement de dossier : déjà géré par l'étape 3 (`workspace.onChange`) ; la GUI ajoute le test.
  - OAuth : `electron/ipc.js` appelle `setUrlOpener((url) => shell.openExternal(url))` au démarrage. L'URL est déjà validée par `oauth.js` (étape 9) : la GUI ne contourne pas ce contrôle et n'appelle jamais `shell.openExternal` avec une URL qui n'en vient pas. Le `dispose()` d'`ipc.js` appelle `cancelPending()` (étape 9) pour annuler un flux en cours.
  - Tests : `gui-host.test.js` (`dispose()` appelle `killAll` du gestionnaire injecté, même si `jobs` échoue) ; `gui-folders.test.js` (ouvrir un autre dossier arrête les serveurs du précédent).
  - Commit : `feat: arrêt des serveurs MCP à la fermeture et au changement de dossier (GUI)`

- [x] **11. Panneau « MCP » dans la barre latérale** (sur le modèle du panneau Skills)
  - `src/gui/mcp.js` (sans Electron, testable comme `workspace.js`) : `createMcpPanel({ manager, config, isRunning })` renvoie :
    - `list()` → `{ servers: [{ name, scope, transport, detail, status, reason, toolCount, enabled }] }`, `status` valant `connected`, `pending`, `failed`, `needs-approval`, `needs-auth` ou `disabled`. `detail` = commande et arguments (jamais les valeurs d'`env`) ou URL sans paramètres ni identifiants ; `reason` = message court, passé dans `redact()` ;
    - `setEnabled(name, enabled)`, `connect(name)` (connecte, reconnecte ou, pour un serveur en attente, ouvre la question d'approbation de l'étape 2), `login(name)` (étape 9) ;
    - ces trois actions renvoient `{ ok: false, reason }` pendant qu'une réponse de l'IA est en cours (`isRunning()`, même règle que les skills et les dossiers : on ne retire pas un serveur sous les pieds d'un tour).
  - `gui/channels.js` : `MCP_LIST`, `MCP_SET_ENABLED`, `MCP_CONNECT`, `MCP_LOGIN`. `electron/ipc.js` : création du panneau à côté de `changes`, quatre lignes dans `handlers` (donc derrière `guard()`). `electron/preload.js` : `listMcp()`, `setMcpEnabled(name, enabled)`, `connectMcp(name)`, `loginMcp(name)` (chaînes et booléens forcés, comme les autres).
  - Page : `api/client.js` (valeurs par défaut hors ligne dans `WORKSPACE_FALLBACKS`) ; `hooks/useWorkspace.js` (`mcp`, `loadMcp`, `setMcpEnabled` avec mise à jour optimiste comme `toggleSkill`, `connectMcp`, `loginMcp`) ; `ActivityBar.jsx` + `Icons.jsx` (vue « MCP ») ; `Sidebar.jsx` (titre, chargement à l'ouverture, `McpPanel`) ; `styles/sidebar.css`.
  - `McpPanel` : pour chaque serveur, état en **texte et icône** (jamais la couleur seule), nom, étiquette de scope, nombre d'outils, interrupteur (`role="switch"`, classe `.switch` existante) et un bouton selon l'état : « Examiner » (en attente d'approbation), « Se connecter » (authentification requise), « Reconnecter » (échec). Rappel en haut : « Ajoute un serveur avec `/mcp add` dans la barre de chat. »
  - Hors première version : formulaire d'ajout et de suppression (ils passent par `/mcp add` et `/mcp remove`).
  - `npm test` ne construit que la TUI : lancer `npm run build:gui` avant l'essai à la main.
  - Tests `test/gui-mcp.test.js` (états, interrupteur, refus pendant un tour, serveur « échec » avec message masqué, **aucune valeur d'`env`, d'en-tête ni de jeton dans `list()`**) ; `sidebar-contrast.test.js` doit rester vert.
  - Commit : `feat: panneau MCP dans la barre latérale de la GUI`

- [x] **12. Dialogues lisibles et canaux IPC restreints**
  - `styles/app.css` : `.dialog .question` et `.dialog .prefix` reçoivent `overflow-wrap: anywhere` et une hauteur maximale de 40 % de l'écran avec défilement : arguments JSON (300 caractères) et commandes de serveur peuvent être longs.
  - IPC : seulement les quatre canaux de l'étape 11. **Aucun canal ne permet d'ajouter un serveur, de lire la config ou d'appeler un outil** : la page ne peut que lister, activer, connecter ; le reste passe par une saisie visible (`/mcp …`) ou par l'IA, avec confirmation. Le processus principal revalide le nom reçu (même regex que `config.js`).
  - Tout texte venu d'un serveur (nom, description, erreur) est rendu comme texte React : jamais `dangerouslySetInnerHTML`, jamais `Markdown.jsx` (réservé aux réponses de l'IA). La sortie d'un `mcp-call` dans le fil est déjà en `<pre>` brut (`Entry.jsx`).
  - Tests : `gui-mcp.test.js` (un nom ou un message contenant `<img onerror=…>` ressort tel quel, sans interprétation) ; `gui-renderer-lib.test.js` (`WORKSPACE_METHODS` contient les quatre méthodes MCP et leurs valeurs hors ligne).
  - Commit : `feat: dialogues MCP lisibles et canaux IPC restreints (GUI)`

## Phase 7 : finition

- [x] **13. Documentation**
  - `docs/mcp.md` : grammaire de `mcp-call`, format de config, scopes, approbation, permissions, OAuth, panneau MCP de la GUI, limites. Y préciser que le service `/mcp/servers` de `docs/sdkapi.md` est **volontairement inutilisé**.
  - `README.md` (section MCP), `CHANGELOG.md` (entrée « Non publié »).
  - Corriger `docs/tools.md` : retirer ou signaler `delegate.js`, `todo-write.js`, `client-tools.md` absents de `main`, et décrire `src/mcp/`.
  - Commit : `docs: gestion MCP locale`

- [ ] **14. Revue de sécurité et essais réels** (partie automatique faite : recherches propres, tests négatifs `a;b`, `..` et fausse consigne ajoutés ; restent les essais manuels et la CI)
  - Revue du 18/11/2026 : recherches relancées (aucun `shell: true` ni `console.*` dans `src/mcp/`, env stdio filtré par `filterEnv`, aucun `dangerouslySetInnerHTML`, `connect-src 'none'` intact) ; `npm test` : 765 réussis, 0 échec. Essai réel sous Windows avec `Roblox_Studio` (stdio) : `list`, `tools` (38 outils), `run list_roblox_studios` étiqueté comme données ; refus constatés pour `--args-file .env` et `tools ../evil`. Aucun correctif nécessaire.
  - Restent : essai Linux/macOS, serveur http avec jeton, OAuth réel, arrêt sans processus restant (`/exit`, Ctrl+C), essais de la GUI sur l'installateur, CI verte.
  - Recherches dans `src/mcp/` : aucun `shell: true`, aucun `process.env` transmis tel quel, aucun `console.log` de config, chaque sortie passe par `redact()`.
  - Tests négatifs ajoutés si manquants : nom de serveur avec espace, `;` ou `..` ; `.mcp.json` modifié après approbation ; `--args-file ../x` et `--args-file .env` ; résultat contenant une fausse consigne (étiquetée, jamais exécutée).
  - Essais manuels : un serveur stdio réel (par exemple un serveur de référence lancé avec `npx`), **sous Windows** (`npx` via `resolveProgram`) et sous Linux ; un serveur http avec jeton ; arrêt propre du CLI (`/exit`, Ctrl+C) sans processus restant.
  - Essais manuels hors Windows (mode développement, `npm run app`) : lancer l'application depuis le Finder ou le menu des applications (pas depuis un terminal), `npx` hors du `PATH` minimal ⇒ message de l'étape 3 ; flux OAuth avec une URL d'autorisation non `https` ⇒ refusée, `shell.openExternal` jamais appelé.
  - Essais manuels de la GUI, sur l'installateur (`npm run build:gui` puis `npm run dist:app`, installation, lancement depuis le menu Démarrer) : panneau MCP (chaque état) ; dialogue d'approbation d'un `.mcp.json` ; confirmation d'un `mcp-call` avec le bouton « Toujours » ; changement de dossier ⇒ serveurs relancés ; fermeture de la fenêtre ⇒ aucun processus de serveur restant (Gestionnaire des tâches) ; connexion OAuth (le navigateur s'ouvre via `shell.openExternal`, le retour revient dans l'application) ; `npx` retiré du `PATH` ⇒ message clair dans le panneau.
  - Recherches dans `src/gui/renderer/` : aucun `dangerouslySetInnerHTML`, aucun accès réseau ajouté (`connect-src 'none'` intact dans `index.html`).
  - CI verte sur Ubuntu et Windows.
  - Commit éventuel : `fix: durcissement MCP après revue`

---

## Ordre des commits

0. `chore: dépendance @modelcontextprotocol/sdk`
1. `feat: configuration des serveurs MCP (scopes local, project, user)`
2. `feat: approbation des serveurs MCP du projet`
3. `feat: connexion paresseuse des serveurs MCP (stdio, http, sse)`
4. `feat: politique et permissions de mcp-call`
5. `feat: exécution de mcp-call (outils, ressources, prompts)`
6. `feat: mcp-call branché sur run_command et rappel dans le contexte`
7. `feat: commande /mcp`
8. `feat: frst mcp en ligne de commande`
9. `feat: authentification OAuth des serveurs MCP http`
10. `feat: arrêt des serveurs MCP à la fermeture et au changement de dossier (GUI)`
11. `feat: panneau MCP dans la barre latérale de la GUI`
12. `feat: dialogues MCP lisibles et canaux IPC restreints (GUI)`
13. `docs: gestion MCP locale`
14. `fix: durcissement MCP après revue` (si besoin)

Les commits 0 à 5 ne changent aucun comportement visible pour l'IA : `mcp-call` n'existe pour elle qu'au commit 6.

## Limites connues (raccourcis assumés)

- Sortie plafonnée à 16 000 caractères (début et fin gardés) ; images et audio non transmis. Passer à plus demanderait d'écrire la sortie complète dans le projet, ce que ce plan évite.
- Arguments JSON : 4 000 caractères en ligne, sinon `--args-file`.
- Pas de validation JSON Schema côté CLI : le serveur valide ses propres entrées.
- Le bloc MCP du premier message est figé pendant la conversation (cache de prompt).
- Chiffres repris de la documentation officielle de Claude Code consultée aujourd'hui : délai de démarrage 30 s, inactivité 30 min / 5 min, 5 reconnexions, limite de sortie 25 000 tokens. La syntaxe exacte des règles de permission MCP et des mentions `@ressource` de Claude Code n'a pas pu être relue : l'équivalent ici est `mcp-call`, avec ses propres règles.
- GUI : pas de formulaire d'ajout ou de suppression de serveur dans la première version (`/mcp add` et `/mcp remove` dans la barre de chat) ; pas d'étiquette dédiée « MCP » dans le fil (une commande `mcp-call` s'affiche comme toute commande).
- Si l'application est tuée brutalement (Gestionnaire des tâches, plantage), Windows ne ferme pas les processus enfants : un serveur stdio peut rester actif jusqu'à la fermeture de son entrée standard, ce que la plupart des serveurs MCP font. Un arrêt normal passe par `host.dispose()` (étape 10).
- Un utilisateur de la GUI sans Node.js ne peut pas lancer un serveur `npx` : message d'erreur clair (étape 3), les serveurs http restent utilisables.
- Plateformes de la GUI : `package.json` ne configure qu'une cible d'installateur, Windows (`nsis`). macOS et Linux ne servent donc qu'en mode développement (`npm run app`). Dans ce cas le `PATH` d'une application lancée hors d'un terminal peut être minimal : le plan ne cherche pas `npx` dans d'autres dossiers (voir « Questions ouvertes »).
- Fichiers pas relus dans cette analyse : `electron/attention.js`, `src/gui/workspace.js` (hors `listSkills`), `bin/frst.js` (début seulement). Relus ensuite, en entier : `electron/ipc.js`, `electron/main.js`, `electron/preload.js`, `src/gui/host.js`, `src/gui/channels.js`, `package.json`, `.gitignore`.

## Questions ouvertes

- Confirmer l'hypothèse : « boîte d'outils » = l'outil MCP.
- Sous-commandes à la `git` (`list`, `tools`, `describe`, `run`…) avec ta forme `mcp-call <serveur> <outil>` gardée comme raccourci : d'accord ?
- Garder la confirmation à **chaque** appel d'outil par défaut (proposition) ?
- Panneau MCP de la GUI limité à l'état, l'activation, la connexion et l'OAuth pour la première version (ajout par `/mcp add`) : d'accord ?
- Lire aussi le `.mcp.json` du projet (compatible Claude Code, avec approbation) ou limiter à `local` et `user` pour une première version ?
- Hors Windows, chercher `npx`, `node` et `uvx` dans des dossiers usuels (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`) en plus du `PATH`, ou se contenter du message d'erreur de l'étape 3 ? (Sans objet si la GUI reste Windows seulement.)
