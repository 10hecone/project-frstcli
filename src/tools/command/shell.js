"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { runProcess } = require("./runner");
const { getEnv } = require("./program");
const { judge, programName, pathCandidate, checkPath } = require("./policy");
const { decide, deniedBy, suggestPrefix } = require("./permissions");
const { resolveDirectory } = require("./pipeline");

/*
 * Vrai shell pour run_command (comme Claude Code), utilisé quand l'analyseur interne ne sait
 * pas découper la ligne ($VAR, $(...), redirection vers un fichier, boucles...) :
 *   - Windows : Git Bash (Git\bin\bash.exe), sinon PowerShell (pwsh, puis powershell.exe) ;
 *   - Unix : $SHELL s'il s'agit de bash ou zsh, sinon /bin/bash, puis /bin/sh.
 * Seulement dans un dossier de confiance. Le dossier courant final est conservé (state.cwd),
 * pas les variables. Toute ligne que assessShell() ne juge pas sûre est confirmée.
 *
 * Réglages (utilisateur seulement, jamais depuis le projet) : FS_SHELL ou "shell" dans
 * settings.json (auto, bash, powershell, off) ; FS_SHELL_PATH ou "shellPath".
 */

const MODES = ["auto", "bash", "powershell", "off"];
const MAX_SHELL_CHARS = 8000;

// ---------------------------------------------------------------------------
// Choix du shell
// ---------------------------------------------------------------------------

function fileExists(target) {
    try {
        return fs.statSync(target).isFile();
    } catch {
        return false;
    }
}

function normalizeMode(value) {
    const mode = String(value ?? "").trim().toLowerCase();
    if (mode === "git-bash" || mode === "gitbash") return "bash";
    if (mode === "pwsh") return "powershell";
    return MODES.includes(mode) ? mode : "auto";
}

/** "posix" (bash, zsh, sh), "powershell" ou null selon le nom du programme. */
function kindOf(file) {
    const name = String(file).split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, "");
    if (name === "pwsh" || name === "powershell") return "powershell";
    if (name === "bash" || name === "zsh" || name === "sh") return "posix";
    return null;
}

// bash.exe de System32 ou de WindowsApps lance WSL (autre système de fichiers) : jamais retenu.
function isWslLauncher(file) {
    return /[\\/](system32|sysnative|windowsapps)[\\/]/i.test(file);
}

function searchPath(names, env, platform, exists) {
    const lib = platform === "win32" ? path.win32 : path.posix;
    const dirs = (getEnv(env, "PATH") || "").split(platform === "win32" ? ";" : ":").filter(Boolean);
    for (const dir of dirs) {
        for (const name of names) {
            const full = lib.join(dir, name);
            if (exists(full)) return full;
        }
    }
    return null;
}

function gitBashCandidates(env, exists) {
    const list = [];
    for (const name of ["PROGRAMFILES", "PROGRAMW6432", "PROGRAMFILES(X86)"]) {
        const dir = getEnv(env, name);
        if (dir) list.push(path.win32.join(dir, "Git", "bin", "bash.exe"));
    }
    const local = getEnv(env, "LOCALAPPDATA");
    if (local) list.push(path.win32.join(local, "Programs", "Git", "bin", "bash.exe"));

    // Git installé ailleurs : Git\cmd\git.exe, Git\bin\git.exe ou Git\mingw64\bin\git.exe.
    const git = searchPath(["git.exe"], env, "win32", exists);
    if (git) {
        let root = path.win32.dirname(git);
        if (/[\\/]mingw64[\\/]bin$/i.test(root)) root = path.win32.dirname(path.win32.dirname(root));
        else if (/[\\/](cmd|bin)$/i.test(root)) root = path.win32.dirname(root);
        list.push(path.win32.join(root, "bin", "bash.exe"));
    }
    const onPath = searchPath(["bash.exe"], env, "win32", exists);
    if (onPath) list.push(onPath);
    return list.filter(file => !isWslLauncher(file));
}

function powerShellCandidates(env, platform, exists) {
    if (platform !== "win32") return [searchPath(["pwsh"], env, platform, exists)].filter(Boolean);
    const list = [
        searchPath(["pwsh.exe"], env, platform, exists),
        searchPath(["powershell.exe"], env, platform, exists)
    ];
    const systemRoot = getEnv(env, "SYSTEMROOT");
    if (systemRoot) list.push(path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"));
    return list.filter(Boolean);
}

function posixCandidates(env, exists) {
    const list = [];
    const user = getEnv(env, "SHELL");
    if (user && /\/(bash|zsh)$/.test(user)) list.push(user);
    list.push("/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash", "/bin/sh");
    return list;
}

function describe(file) {
    return { kind: kindOf(file), file, name: String(file).split(/[\\/]/).pop().replace(/\.exe$/i, "") };
}

/**
 * Shell à utiliser : { kind, file, name }, ou null (mode off ou rien trouvé).
 * env, platform et exists sont injectables pour les tests.
 */
function findShell({ mode = "auto", shellPath = null, env = process.env, platform = process.platform, exists = fileExists } = {}) {
    const wanted = normalizeMode(mode);
    if (wanted === "off") return null;
    const accepts = kind => kind && (wanted === "auto" || (wanted === "bash" ? kind === "posix" : kind === "powershell"));

    if (shellPath && typeof shellPath === "string") {
        const kind = kindOf(shellPath);
        const wsl = platform === "win32" && isWslLauncher(shellPath);
        if (accepts(kind) && !wsl && exists(shellPath)) return describe(shellPath);
    }

    const posix = platform === "win32" ? gitBashCandidates(env, exists) : posixCandidates(env, exists);
    const bash = wanted === "powershell" ? null : posix.find(file => exists(file));
    if (bash) return describe(bash);
    if (wanted === "bash") return null;
    const ps = powerShellCandidates(env, platform, exists).find(file => exists(file));
    return ps ? describe(ps) : null;
}

/** Réglages du shell : variables FS_SHELL / FS_SHELL_PATH, sinon settings.json de l'utilisateur. */
async function shellConfig(env = process.env) {
    let user = {};
    try {
        const { loadSettings } = require("../../core/settings");
        user = (await loadSettings(null)).user;
    } catch {
        user = {};
    }
    const mode = normalizeMode(getEnv(env, "FS_SHELL") ?? user.shell);
    const configured = getEnv(env, "FS_SHELL_PATH") || user.shellPath;
    return { mode, shellPath: typeof configured === "string" && configured.trim() ? configured.trim() : null };
}

const shellCache = new Map();

async function defaultIsTrusted(root) {
    const known = await require("../../project/projects").get(root);
    return Boolean(known && known.trusted);
}

/** Shell actif pour ce projet (dossier de confiance seulement), ou null. */
async function activeShell(root, { isTrusted = defaultIsTrusted } = {}) {
    if (!root) return null;
    try {
        if (!(await isTrusted(root))) return null;
    } catch {
        return null;
    }
    const config = await shellConfig();
    const key = JSON.stringify(config);
    if (!shellCache.has(key)) shellCache.set(key, findShell(config));
    return shellCache.get(key);
}

// ---------------------------------------------------------------------------
// Analyse approximative de la ligne (bash ou PowerShell)
// ---------------------------------------------------------------------------

const DOLLAR_NEXT_RE = /[A-Za-z0-9_{(?!#@*$:-]/;

/**
 * Découpe la ligne en segments ({ words, redirects, op }) hors guillemets. Chaque mot porte
 * quoted, glob (motif * ? [ ou accolades) et dynamic ($VAR) ; opaque = raison pour laquelle
 * la ligne ne peut pas être analysée (substitution, bloc, heredoc...).
 */
function lexShell(line, kind = "posix") {
    const ps = kind === "powershell";
    const segments = [];
    let segment = { words: [], redirects: [], op: null };
    let word = null;
    let pending = null;
    let opaque = null;
    const flag = reason => {
        if (!opaque) opaque = reason;
    };
    const current = () => {
        if (!word) word = { text: "", quoted: false, glob: false, dynamic: false };
        return word;
    };
    const endWord = () => {
        if (!word) return;
        if (pending) {
            pending.target = word;
            segment.redirects.push(pending);
            pending = null;
        } else {
            segment.words.push(word);
        }
        word = null;
    };
    const endSegment = op => {
        endWord();
        if (pending) {
            flag("Redirection sans cible.");
            pending = null;
        }
        segment.op = op;
        if (segment.words.length || segment.redirects.length) segments.push(segment);
        segment = { words: [], redirects: [], op: null };
    };
    const dollar = (w, next) => {
        if (next === "(") flag(ps ? "Sous-expression PowerShell $(...)." : "Substitution de commande $(...).");
        if (next !== undefined && DOLLAR_NEXT_RE.test(next)) w.dynamic = true;
    };

    const n = line.length;
    let i = 0;
    while (i < n) {
        const c = line[i];
        const next = line[i + 1];

        if (c === " " || c === "\t" || c === "\r") {
            endWord();
            i++;
            continue;
        }
        if (c === "\n") {
            endSegment("\n");
            i++;
            continue;
        }
        if (c === "#" && !word) {
            while (i < n && line[i] !== "\n") i++;
            continue;
        }
        if ((!ps && c === "\\") || (ps && c === "`")) {
            if (next === "\n") {
                i += 2;
                continue;
            }
            if (next !== undefined) {
                const w = current();
                w.text += next;
                w.quoted = true;
            }
            i += 2;
            continue;
        }
        if (!ps && c === "`") {
            flag("Substitution de commande (`...`).");
            current().dynamic = true;
            i++;
            continue;
        }
        if (c === "'") {
            const w = current();
            w.quoted = true;
            i++;
            for (;;) {
                if (i >= n) {
                    flag("Guillemet ' non fermé.");
                    break;
                }
                if (line[i] === "'") {
                    if (ps && line[i + 1] === "'") {
                        w.text += "'";
                        i += 2;
                        continue;
                    }
                    i++;
                    break;
                }
                w.text += line[i];
                i++;
            }
            continue;
        }
        if (c === '"') {
            const w = current();
            w.quoted = true;
            i++;
            for (;;) {
                if (i >= n) {
                    flag('Guillemet " non fermé.');
                    break;
                }
                const d = line[i];
                if (d === '"') {
                    if (ps && line[i + 1] === '"') {
                        w.text += '"';
                        i += 2;
                        continue;
                    }
                    i++;
                    break;
                }
                if (!ps && d === "\\" && i + 1 < n && '$`"\\\n'.includes(line[i + 1])) {
                    w.text += line[i + 1];
                    i += 2;
                    continue;
                }
                if (ps && d === "`" && i + 1 < n) {
                    w.text += line[i + 1];
                    i += 2;
                    continue;
                }
                if (d === "$") dollar(w, line[i + 1]);
                if (!ps && d === "`") {
                    flag("Substitution de commande (`...`).");
                    w.dynamic = true;
                }
                w.text += d;
                i++;
            }
            continue;
        }
        if (c === "$") {
            const w = current();
            dollar(w, next);
            w.text += c;
            i++;
            continue;
        }
        if (ps && c === "@" && !word && next !== undefined && /[A-Za-z_]/.test(next)) {
            current().dynamic = true;
            word.text += c;
            i++;
            continue;
        }
        if (c === ">" || c === "<") {
            let fd = null;
            if (word && !word.quoted && (/^\d$/.test(word.text) || (ps && word.text === "*"))) {
                fd = word.text;
                word = null;
            } else {
                endWord();
            }
            if (c === "<") {
                if (!ps && next === "(") flag("Substitution de processus <(...).");
                else if (next === "<") flag("Heredoc ou here-string (<<).");
                else if (ps) flag("Redirection d'entrée < (PowerShell).");
                else pending = { op: "<", fd };
                i += next === "(" || next === "<" ? 2 : 1;
                continue;
            }
            if (!ps && next === "(") {
                flag("Substitution de processus >(...).");
                i += 2;
                continue;
            }
            let op = ">";
            let j = i + 1;
            if (line[j] === ">") {
                op = ">>";
                j++;
            } else if (!ps && line[j] === "|") {
                j++;
            }
            if (line[j] === "&") {
                // 2>&1, >&2 : duplication d'un flux, pas de fichier.
                let k = j + 1;
                while (k < n && /[0-9-]/.test(line[k])) k++;
                if (k > j + 1) {
                    i = k;
                    continue;
                }
                j++;
            }
            pending = { op, fd };
            i = j;
            continue;
        }
        if (c === "&") {
            if (next === "&") {
                endSegment("&&");
                i += 2;
                continue;
            }
            if (!ps && next === ">") {
                endWord();
                let j = i + 2;
                let op = ">";
                if (line[j] === ">") {
                    op = ">>";
                    j++;
                }
                pending = { op, fd: "&" };
                i = j;
                continue;
            }
            if (ps && !word && segment.words.length === 0) flag("Opérateur d'appel & (PowerShell).");
            else flag("Lancement en arrière-plan (&) : utilise plutôt le paramètre background ou bg-run.");
            endSegment("&");
            i++;
            continue;
        }
        if (c === "|") {
            if (next === "|") {
                endSegment("||");
                i += 2;
            } else if (!ps && next === "&") {
                endSegment("|&");
                i += 2;
            } else {
                endSegment("|");
                i++;
            }
            continue;
        }
        if (c === ";") {
            endSegment(";");
            i += next === ";" ? 2 : 1;
            continue;
        }
        if (c === "(" || c === ")" || c === "{" || c === "}") {
            // a{b,c} (bash) : expansion d'accolades dans un mot, traitée comme un motif.
            if (!ps && word && (c === "{" || c === "}")) {
                word.glob = true;
            } else {
                flag(ps ? "Bloc de script ou expression PowerShell ({ } ou ( ))." : "Sous-shell ou bloc de commandes ({ } ou ( )).");
            }
            current().text += c;
            i++;
            continue;
        }
        if (c === "*" || c === "?" || (c === "[" && (word || (next !== undefined && next !== " ")))) {
            const w = current();
            w.glob = true;
            w.text += c;
            i++;
            continue;
        }
        current().text += c;
        i++;
    }
    endSegment(null);
    return { segments, opaque };
}

// Commandes qui lancent d'autres commandes ou changent le shell : jamais de règle « toujours ».
const POSIX_OPAQUE = new Set([
    "eval", "source", ".", "exec", "command", "builtin", "time", "nohup", "trap", "alias", "function",
    "coproc", "select", "while", "for", "until", "if", "case", "do", "done", "then", "fi", "else",
    "elif", "esac", "xargs"
]);
const PS_OPAQUE = new Set([
    "invoke-expression", "iex", "invoke-command", "icm", "start-process", "saps", "start-job",
    "foreach-object", "where-object", "invoke-item", "ii", ".", "&", "new-alias", "set-alias",
    "add-type", "for", "foreach", "while", "do", "if", "switch", "function", "filter"
]);
// Commandes internes sans effet sur les fichiers.
const POSIX_BUILTINS = new Set(["echo", "printf", "true", "false", "exit", "export", "unset", "shift", "pwd", "test", "[", "type"]);
const PS_BUILTINS = new Set(["echo", "write", "write-output", "write-host", "pwd", "gl", "get-location", "exit"]);
// Arguments de ces commandes : vérifiés comme chemins (les autres internes n'affichent que du texte).
const PATH_BUILTINS = new Set(["test", "[", "type"]);
const POSIX_CD = new Set(["cd", "pushd"]);
const PS_CD = new Set(["cd", "chdir", "sl", "set-location", "pushd", "push-location"]);
const PS_CD_OPTIONS = new Set(["-path", "-literalpath"]);
// Cmdlets en lecture seule (noms de fichiers, pas leur contenu) : sans question si judge() ne refuse pas.
// Get-Content et Select-String n'y sont pas : alimentés par un tube, ils liraient n'importe quel fichier.
const PS_SAFE = new Set([
    "get-childitem", "gci", "dir", "ls", "get-item", "gi", "test-path", "resolve-path", "select-object",
    "select", "sort-object", "sort", "measure-object", "measure", "format-table", "ft", "format-list", "fl",
    "out-string", "get-date", "get-command", "gcm"
]);

function isNullSink(text, ps) {
    const lower = text.toLowerCase();
    return lower === "/dev/null" || lower === "nul" || (ps && lower === "$null");
}

/**
 * Décision pour une ligne de shell :
 *   { level: "run" | "ask" | "deny", reason, reasons, prefixes }
 * prefixes : préfixes proposés pour « toujours » (vide = pas de règle possible).
 * rules : règles autorisées (permissions.json + settings utilisateur) ; denyRules : settings.
 */
function assessShell(line, { kind = "posix", cwd, workspace, rules = [], denyRules = [], acceptsEdits = false } = {}) {
    const ps = kind === "powershell";
    const root = path.resolve(workspace || cwd || process.cwd());
    let base = path.resolve(root, cwd || ".");
    const { segments, opaque } = lexShell(String(line ?? ""), kind);
    const several = segments.length > 1;
    const blocking = [];
    const reasons = [];
    const prefixes = [];
    if (opaque) blocking.push(opaque);
    const deny = (reason, display) => ({
        level: "deny",
        reason: several && display ? `${display} : ${reason}` : reason,
        reasons: [],
        prefixes: []
    });

    for (const segment of segments) {
        for (const redirect of segment.redirects) {
            const target = redirect.target;
            if (!target || isNullSink(target.text, ps)) continue;
            if (target.dynamic || target.glob) {
                blocking.push(`Redirection vers une cible variable : ${target.text}`);
                continue;
            }
            const problem = checkPath(target.text, base, root);
            if (problem) return deny(problem);
            if (redirect.op !== "<" && !acceptsEdits) blocking.push(`Écriture dans ${target.text} (redirection).`);
        }

        const words = [...segment.words];
        while (!ps && words.length && !words[0].quoted && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0].text)) {
            blocking.push(`Affectation de variable : ${words[0].text.split("=")[0]}`);
            words.shift();
        }
        if (!words.length) continue;

        const [head, ...rest] = words;
        const args = rest.map(w => w.text);
        const display = words.map(w => w.text).join(" ");
        const name = programName(head.text);

        if (head.dynamic) {
            blocking.push(`Programme variable : ${head.text}`);
            continue;
        }
        if ((ps ? PS_OPAQUE : POSIX_OPAQUE).has(name)) {
            blocking.push(`${head.text} lance d'autres commandes : impossible à vérifier.`);
            continue;
        }
        if (rest.some(w => w.dynamic)) blocking.push(`Variable dans « ${display} » : valeur inconnue avant l'exécution.`);
        if (words.some(w => w.glob)) blocking.push(`Motif dans « ${display} » : peut désigner des fichiers sensibles.`);

        if ((ps ? PS_CD : POSIX_CD).has(name)) {
            const targets = rest.filter(w => !(ps && PS_CD_OPTIONS.has(w.text.toLowerCase())));
            if (!targets.length) return deny(`${head.text} sans argument mène au dossier personnel : interdit.`, display);
            const target = targets[0];
            if (target.text === "-") return deny(`${head.text} - : retour à un dossier inconnu, interdit.`, display);
            if (target.dynamic || target.glob) continue;
            const problem = checkPath(target.text, base, root);
            if (problem) return deny(problem, display);
            base = path.resolve(base, target.text);
            continue;
        }

        if ((ps ? PS_BUILTINS : POSIX_BUILTINS).has(name)) {
            if (PATH_BUILTINS.has(name)) {
                for (const arg of args) {
                    const value = pathCandidate(arg, base);
                    const problem = value === null ? null : checkPath(value, base, root);
                    if (problem) return deny(problem, display);
                }
            }
            continue;
        }

        const ruleDenied = deniedBy(denyRules, head.text, args);
        if (ruleDenied) return deny(`Refusé par la règle « ${ruleDenied.source} » (settings.json).`, display);

        let verdict = judge({ file: head.text, args, cwd: base, workspace: root });
        if (ps && PS_SAFE.has(name) && verdict.level === "ask") verdict = { level: "safe", reason: `${head.text} en lecture seule.` };
        if (verdict.level === "deny") return deny(verdict.reason, display);
        if (verdict.alwaysAsk) {
            blocking.push(verdict.reason || `${display} : confirmation obligatoire.`);
            continue;
        }
        if (decide({ verdict, rules, file: head.text, args }) === "ask") {
            reasons.push(verdict.reason);
            prefixes.push(suggestPrefix(head.text, args));
        }
    }

    if (blocking.length) return { level: "ask", reason: blocking[0], reasons: [...blocking, ...reasons], prefixes: [] };
    if (prefixes.length) return { level: "ask", reason: reasons[0], reasons, prefixes };
    return { level: "run", reason: null, reasons: [], prefixes: [] };
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

/** Script bash/zsh/sh : la commande telle quelle, puis le dossier final écrit à la sortie. */
function buildPosixScript(line) {
    return [
        "__frst_exit() {",
        "  __frst_status=$?",
        "  pwd -W >\"$FRST_CWD_FILE\" 2>/dev/null || pwd >\"$FRST_CWD_FILE\" 2>/dev/null",
        "  exit $__frst_status",
        "}",
        "trap __frst_exit EXIT",
        String(line).replace(/\r\n?/g, "\n"),
        ""
    ].join("\n");
}

/** Script PowerShell : sortie UTF-8, code de sortie propagé, dossier final écrit à la fin. */
function buildPowerShellScript(line) {
    return [
        "$ProgressPreference = 'SilentlyContinue'",
        "try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}",
        "$OutputEncoding = [System.Text.Encoding]::UTF8",
        "$global:LASTEXITCODE = 0",
        "$__frstOk = $true",
        "try {",
        String(line).replace(/\r\n?/g, "\n"),
        "$__frstOk = $?",
        "} finally {",
        "try { [System.IO.File]::WriteAllText($env:FRST_CWD_FILE, (Get-Location).ProviderPath) } catch {}",
        "}",
        "if ($LASTEXITCODE) { exit $LASTEXITCODE }",
        "if (-not $__frstOk) { exit 1 }",
        "exit 0"
    ].join("\n");
}

function readReportedCwd(file) {
    try {
        const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)[0].trim();
        return text || null;
    } catch {
        return null;
    }
}

/** Dossier final validé : dans le projet (liens résolus), sinon la racine avec une note. */
function settleCwd(reported, fallback, workspace) {
    if (!reported) return { cwd: fallback, note: null };
    const result = resolveDirectory(workspace, path.resolve(reported), workspace);
    if (result.ok) return { cwd: result.cwd, note: null };
    return { cwd: workspace, note: `Dossier final hors du projet (${reported}) : retour à la racine du projet.` };
}

/**
 * Lance la ligne dans le shell. Renvoie le résultat de runProcess plus
 * cwd (dossier final validé) et cwd_note.
 */
async function runShell(line, { shell, cwd, workspace, timeoutMs, noTimeout = false, onLine, signalHandle } = {}) {
    if (!shell) throw new Error("Aucun shell disponible.");
    if (String(line).length > MAX_SHELL_CHARS) {
        throw new Error(`Commande trop longue pour le shell (${MAX_SHELL_CHARS} caractères au plus) : écris un script avec write_file.`);
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frst-shell-"));
    const cwdFile = path.join(dir, "cwd.txt");
    const slash = value => value.split(path.sep).join("/");
    let args;
    let cwdEnv;
    if (shell.kind === "posix") {
        const script = path.join(dir, "command.sh");
        fs.writeFileSync(script, buildPosixScript(line), "utf8");
        args = [slash(script)];
        cwdEnv = slash(cwdFile);
    } else {
        const encoded = Buffer.from(buildPowerShellScript(line), "utf16le").toString("base64");
        args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-OutputFormat", "Text", "-EncodedCommand", encoded];
        cwdEnv = cwdFile;
    }
    try {
        const result = await runProcess({
            file: shell.file,
            args,
            cwd,
            timeoutMs,
            noTimeout,
            onLine,
            signalHandle,
            extraEnv: { FRST_CWD_FILE: cwdEnv }
        });
        const settled = settleCwd(readReportedCwd(cwdFile), cwd, workspace || cwd);
        return { ...result, cwd: settled.cwd, cwd_note: settled.note };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

module.exports = {
    MODES,
    MAX_SHELL_CHARS,
    normalizeMode,
    kindOf,
    findShell,
    shellConfig,
    activeShell,
    lexShell,
    assessShell,
    buildPosixScript,
    buildPowerShellScript,
    settleCwd,
    runShell
};
