"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { normalizeRelative } = require("../security");
const { judgeMcpCall } = require("../../mcp/policy");

// Programmes jamais lancés : shells (ils contourneraient l'analyse de la
// commande), suppression ou formatage, élévation de privilèges, exécution indirecte.
const DENIED_PROGRAMS = new Set([
    "bash", "sh", "zsh", "fish", "cmd", "wsl",
    "rm", "rmdir", "rd", "del", "erase", "format", "mkfs", "dd", "diskpart",
    "sudo", "su", "doas", "runas", "xargs", "eval", "env",
    "reg", "schtasks", "shutdown", "mshta", "rundll32", "regsvr32", "cscript", "wscript"
]);

const NODE_EVAL_FLAGS = new Set(["-e", "-p", "--eval", "--print"]);

// Programmes en lecture seule : lancés sans confirmation si leurs arguments
// passent la vérification des chemins.
const SAFE_PROGRAMS = new Set([
    "ls", "pwd", "echo", "cat", "head", "tail", "wc", "grep",
    "where", "which", "whoami", "hostname", "uname"
]);

const GIT_DENIED = new Map([
    ["push", "git push est interdit : rien n'est poussé depuis l'agent."],
    ["clean", "git clean supprime des fichiers non suivis : interdit."],
    ["filter-branch", "git filter-branch réécrit l'historique : interdit."],
    ["filter-repo", "git filter-repo réécrit l'historique : interdit."],
    ["update-ref", "git update-ref modifie les références directement : interdit."],
    ["credential", "git credential manipule des identifiants : interdit."]
]);

const GIT_SAFE = new Set(["status", "diff", "log", "show", "rev-parse", "ls-files", "blame", "shortlog", "describe"]);
const GIT_BRANCH_LIST_FLAGS = new Set(["-a", "-r", "--all", "--remotes", "--list", "-l", "-v", "-vv", "--verbose", "--show-current"]);
const GIT_CONFIG_READ_FLAGS = new Set(["--get", "--get-all", "--get-regexp", "--list", "-l"]);
// Options globales de git suivies d'une valeur séparée.
const GIT_VALUE_OPTIONS = new Set(["-C", "--git-dir", "--work-tree", "--namespace"]);
// Options qui font lancer un programme par git.
const GIT_EXEC_OPTIONS = ["--upload-pack", "--receive-pack", "--exec", "--exec-path"];

const FIND_DENIED_FLAGS = new Set(["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"]);

const NPM_DENIED = new Set([
    "publish", "unpublish", "login", "logout", "adduser", "add-user", "token", "owner",
    "access", "deprecate", "dist-tag", "star", "unstar", "team", "org", "hook", "profile"
]);
const NPM_INSTALL = new Set(["install", "i", "add", "uninstall", "remove", "rm", "un", "update", "up", "link", "ln"]);
const NPM_SAFE = new Set(["ls", "list", "ll", "la"]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "npx", "pnpx"]);

const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const SENSITIVE_NAME_RE = /^(\.env.*|\.npmrc|\.netrc|\.pgpass|(id_rsa|id_ed25519|credentials|secrets?)(\..*)?|.*\.(pem|key|p12|pfx|kdbx|keystore|jks))$/i;
// Options à la Windows (/s, /?, /min, /wait) : ce ne sont pas des chemins.
const WINDOWS_SWITCH_RE = /^\/[a-z?]{1,10}$/i;

/**
 * Vrai si value est une option Windows (/s, /min) et non un chemin.
 * Une ou deux lettres : toujours une option. Au-delà, seulement si aucun
 * fichier ou dossier de ce nom n'existe (ls /users reste un chemin).
 */
function isWindowsSwitch(value, base = process.cwd()) {
    if (!WINDOWS_SWITCH_RE.test(value)) return false;
    if (value.length <= 3) return true;
    try {
        return !fs.existsSync(path.resolve(base, value));
    } catch {
        return false;
    }
}

// "C:\\Tools\\Node.EXE" -> "node", "/usr/bin/rm" -> "rm".
function programName(file) {
    const base = path.win32.basename(String(file)).toLowerCase();
    const ext = path.win32.extname(base);
    return ext ? base.slice(0, -ext.length) : base;
}

function isNodeEvalFlag(arg) {
    const a = String(arg);
    if (NODE_EVAL_FLAGS.has(a)) return true;
    if (a.startsWith("--eval=") || a.startsWith("--print=")) return true;
    // Options courtes groupées, par exemple -pe.
    return /^-[a-z]{2,}$/i.test(a) && /[ep]/i.test(a);
}

// python, python3, python3.12, pythonw, py, pypy3.
const PYTHON_RE = /^(python[0-9.]*w?|py|pypy[0-9.]*)$/;

// Options courtes de python suivies d'une valeur (collée ou séparée).
const PYTHON_VALUE_FLAGS = new Set(["W", "X"]);

/** Vrai si les options de python contiennent -c (seule, groupée ou collée : -c, -Ic, -cprint(1)). */
function hasPythonInlineCode(args) {
    for (let i = 0; i < args.length; i += 1) {
        const a = String(args[i]);
        if (a === "--" || a === "-" || !a.startsWith("-")) return false;
        if (a.startsWith("--")) continue;
        for (let j = 1; j < a.length; j += 1) {
            const ch = a[j];
            if (ch === "c") return true;
            // -m lance un module : la suite appartient au module.
            if (ch === "m") return false;
            if (PYTHON_VALUE_FLAGS.has(ch)) {
                if (j === a.length - 1) i += 1;
                break;
            }
        }
    }
    return false;
}

/** Vrai pour deno eval ou une option --eval (deno repl --eval). */
function hasDenoInlineCode(args) {
    const list = args.map(String);
    if (list.some(a => a === "--eval" || a.startsWith("--eval=") || a.startsWith("--eval-file"))) return true;
    const sub = list.find(a => !a.startsWith("-"));
    return (sub || "").toLowerCase() === "eval";
}

const deny = (reason) => ({ level: "deny", reason });
const ask = (reason) => ({ level: "ask", reason });
const safe = (reason) => ({ level: "safe", reason });

function isOutside(rel) {
    return rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}

function looksLikePath(value) {
    return /[\\/]/.test(value) ||
        value.startsWith(".") ||
        value.startsWith("~") ||
        /^[a-z]:/i.test(value) ||
        SENSITIVE_NAME_RE.test(value);
}

// Partie d'un argument qui peut désigner un chemin, ou null.
function pathCandidate(arg, base) {
    let value = arg;
    if (value.startsWith("-")) {
        const eq = value.indexOf("=");
        if (eq !== -1) {
            value = value.slice(eq + 1);
        } else if (!value.startsWith("--") && value.length > 2) {
            // Option courte collée à sa valeur : -f/etc/passwd -> /etc/passwd.
            value = value.slice(2);
        } else {
            return null;
        }
    }
    if (!value || URL_RE.test(value)) return null;
    if (process.platform === "win32" && isWindowsSwitch(value, base)) return null;
    // Référence git "rev:chemin" (HEAD:src/a.js) ; une lettre de lecteur (C:) est exclue.
    const revPath = /^[^\\/:]{2,}:(.*)$/.exec(value);
    if (revPath) value = revPath[1];
    if (!value) return null;
    return looksLikePath(value) ? value : null;
}

function checkPath(value, base, root) {
    if (value.startsWith("~")) {
        return `Chemin hors du projet interdit : ${value} (dossier personnel).`;
    }
    const rel = path.relative(root, path.resolve(base, value));
    if (isOutside(rel)) return `Chemin hors du projet interdit : ${value}`;
    if (!rel) return null;
    try {
        normalizeRelative(rel);
    } catch (error) {
        return `${error.message} (argument « ${value} »)`;
    }
    return null;
}

function judgeGit(args) {
    let index = 0;
    for (; index < args.length; index += 1) {
        const a = args[index];
        if (a === "-c" || a.startsWith("--config-env")) {
            return deny("git -c / --config-env interdit : une option de configuration peut lancer un programme (core.sshCommand, alias...).");
        }
        if (GIT_VALUE_OPTIONS.has(a)) {
            index += 1;
            continue;
        }
        if (!a.startsWith("-")) break;
    }

    if (args.some(a => GIT_EXEC_OPTIONS.some(o => a === o || a.startsWith(`${o}=`)))) {
        return deny("Option git qui lance un programme (--upload-pack, --receive-pack, --exec) : interdite.");
    }

    const sub = (args[index] || "").toLowerCase();
    const rest = args.slice(index + 1);

    if (!sub) return safe("git sans sous-commande (aide ou version).");
    if (GIT_DENIED.has(sub)) return deny(GIT_DENIED.get(sub));
    if (sub === "reset" && rest.includes("--hard")) {
        return deny("git reset --hard efface les modifications locales : interdit.");
    }
    if (sub === "rebase" && rest.some(a => a === "-x" || a === "--exec" || a.startsWith("--exec="))) {
        return deny("git rebase --exec lance des commandes : interdit.");
    }
    if (sub === "config") {
        if (rest.some(a => GIT_CONFIG_READ_FLAGS.has(a))) return ask("Lecture de la configuration git.");
        return deny("git config en écriture interdit : la configuration peut lancer des programmes (alias, core.*).");
    }
    if (GIT_SAFE.has(sub)) {
        if (rest.some(a => a.startsWith("--output") || a === "--ext-diff")) {
            return ask(`git ${sub} avec --output ou --ext-diff écrit un fichier ou lance un programme.`);
        }
        return safe(`git ${sub} en lecture seule.`);
    }
    if (sub === "branch" && rest.every(a => GIT_BRANCH_LIST_FLAGS.has(a))) {
        return safe("Liste des branches.");
    }
    return ask(`git ${sub} peut modifier le dépôt.`);
}

function judgeFind(args) {
    const bad = args.find(a => FIND_DENIED_FLAGS.has(a.toLowerCase()));
    if (bad) return deny(`find ${bad} interdit : il supprime, écrit ou lance des commandes.`);
    return safe("Recherche de fichiers en lecture seule.");
}

// Options courtes de grep suivies d'une valeur (collée ou séparée).
const GREP_VALUE_FLAGS = new Set(["e", "f", "m", "A", "B", "C", "d", "D"]);

/**
 * Vrai si grep parcourt des dossiers : -r, -R, --recursive, --dereference-recursive,
 * -d recurse, --directories=recurse, y compris en options groupées (-rn, -nRi).
 */
function isRecursiveGrep(args) {
    for (let i = 0; i < args.length; i += 1) {
        const a = String(args[i]);
        if (a === "--") return false;
        if (a === "--recursive" || a === "--dereference-recursive") return true;
        if (a.toLowerCase() === "--directories=recurse") return true;
        if (a === "--directories" && String(args[i + 1] ?? "").toLowerCase() === "recurse") return true;
        if (a.startsWith("--") || !a.startsWith("-") || a === "-") continue;
        for (let j = 1; j < a.length; j += 1) {
            const ch = a[j];
            if (ch === "r" || ch === "R") return true;
            if (GREP_VALUE_FLAGS.has(ch)) {
                const value = j === a.length - 1 ? String(args[i + 1] ?? "") : a.slice(j + 1);
                if (ch === "d" && value.toLowerCase() === "recurse") return true;
                if (j === a.length - 1) i += 1;
                break;
            }
        }
    }
    return false;
}

function isCallFlag(a) {
    return a === "-c" || a === "--call" || a.startsWith("--call=");
}

function judgePackageManager(name, args) {
    if (args.some(a => a.startsWith("--script-shell"))) {
        return deny("--script-shell interdit : il choisit le shell des scripts.");
    }
    if (name === "npx" || name === "pnpx") {
        if (args.some(isCallFlag)) return deny(`${name} -c lance une commande dans un shell : interdit.`);
        return ask(`${name} télécharge et lance un paquet.`);
    }

    const sub = (args.find(a => !a.startsWith("-")) || "").toLowerCase();
    if (!sub) {
        if (args.length === 1 && (args[0] === "-v" || args[0] === "--version")) return safe(`Version de ${name}.`);
        return ask(`Commande ${name}.`);
    }
    if (NPM_DENIED.has(sub)) {
        return deny(`${name} ${sub} est interdit : il publie ou touche aux comptes et jetons.`);
    }
    if ((sub === "exec" || sub === "x" || sub === "dlx") && args.some(isCallFlag)) {
        return deny(`${name} ${sub} -c lance une commande dans un shell : interdit.`);
    }
    if (NPM_INSTALL.has(sub) && args.some(a => a === "-g" || a === "--global" || a === "--location=global")) {
        return deny(`${name} ${sub} global interdit : seules les dépendances du projet peuvent changer.`);
    }
    if (sub === "config" && args.some(a => a === "set" || a === "delete" || a === "edit")) {
        return deny(`${name} config en écriture interdit.`);
    }
    if (NPM_SAFE.has(sub)) return safe(`${name} ${sub} en lecture seule.`);
    return ask(`${name} ${sub} lance des scripts ou modifie le projet.`);
}

const MAX_PS_SCRIPT_CHARS = 20000;
const PS_USAGE = "Utilise powershell -NoProfile -Command '<script>' (script entre guillemets simples) ou powershell -NoProfile -File script.ps1.";

/** Nom d'option PowerShell sans tiret ni barre (-NoProfile, --nop, /c), ou null. */
function psOptionName(arg) {
    const m = /^(?:--?|\/)([a-z]+)$/i.exec(arg);
    return m ? m[1].toLowerCase() : null;
}

function isPsPrefix(option, full, min) {
    return option.length >= min && full.startsWith(option);
}

/**
 * PowerShell : jamais sans confirmation, ni règle « Toujours » (alwaysAsk).
 * Le script complet (-Command ou contenu de -File) est renvoyé pour être montré.
 */
function judgePowerShell(name, list, base, root) {
    for (let i = 0; i < list.length; i += 1) {
        const arg = list[i];
        const option = psOptionName(arg);
        if (option === null) {
            return deny(`Argument PowerShell inattendu : ${arg}. ${PS_USAGE}`);
        }
        if (option.startsWith("e") && !option.startsWith("ex") && option !== "ep") {
            return deny("PowerShell -EncodedCommand interdit : le script doit rester lisible.");
        }
        if (isPsPrefix(option, "noexit", 3)) {
            return deny("PowerShell -NoExit interdit : la commande ne se terminerait jamais.");
        }
        if (isPsPrefix(option, "noprofile", 3) || isPsPrefix(option, "nologo", 3) || isPsPrefix(option, "noninteractive", 3)) {
            continue;
        }
        if (option === "ep" || isPsPrefix(option, "executionpolicy", 2)) {
            if (i + 1 >= list.length) return deny("PowerShell -ExecutionPolicy sans valeur.");
            i += 1;
            continue;
        }
        if (option === "c" || isPsPrefix(option, "command", 3)) {
            const rest = list.slice(i + 1);
            if (rest.length === 0) return deny(`PowerShell -Command sans script. ${PS_USAGE}`);
            if (rest.length === 1 && rest[0] === "-") {
                return deny("PowerShell -Command - (script lu sur l'entrée) interdit : le script doit être visible.");
            }
            const script = rest.join(" ");
            return { level: "ask", alwaysAsk: true, script, reason: `${name} lance un script PowerShell.` };
        }
        if (option === "f" || isPsPrefix(option, "file", 2)) {
            const file = list[i + 1];
            if (!file) return deny(`PowerShell -File sans script. ${PS_USAGE}`);
            const problem = checkPath(file, base, root);
            if (problem) return deny(problem);
            let content;
            try {
                content = fs.readFileSync(path.resolve(base, file), "utf8");
            } catch {
                return deny(`Script PowerShell introuvable : ${file}`);
            }
            if (content.length > MAX_PS_SCRIPT_CHARS) {
                return deny(`Script PowerShell trop long pour être relu (plus de ${MAX_PS_SCRIPT_CHARS} caractères) : ${file}`);
            }
            const extra = list.slice(i + 2);
            const header = extra.length ? `# ${file} ${extra.join(" ")}` : `# ${file}`;
            return { level: "ask", alwaysAsk: true, script: `${header}\n${content}`, reason: `${name} lance le script ${file}.` };
        }
        return deny(`Option PowerShell non autorisée : ${arg}. ${PS_USAGE}`);
    }
    return deny(`PowerShell interactif interdit. ${PS_USAGE}`);
}

const BG_COMMANDS = new Set(["bg-run", "bg-output", "bg-stop"]);
const JOB_ID_RE = /^job-\d+$/;
const BG_NESTED = new Set([...BG_COMMANDS, "mcp-call", "cd"]);

/** bg-run <commande> : la commande lancée est jugée comme si elle était lancée directement. */
function judgeBgRun(list, ctx) {
    if (list.length === 0 || list[0].startsWith("-")) {
        return deny("Usage : bg-run <commande> (ex. bg-run rojo serve). Puis bg-output <id> pour lire sa sortie, bg-stop <id> pour l'arrêter.");
    }
    const inner = programName(list[0]);
    if (BG_NESTED.has(inner)) return deny(`bg-run ${inner} interdit : donne directement la commande à lancer.`);
    const verdict = judge({ file: list[0], args: list.slice(1), cwd: ctx.cwd, workspace: ctx.workspace });
    if (verdict.level === "deny") return verdict;
    return { ...verdict, level: "ask", reason: `Lancement en arrière-plan. ${verdict.reason}` };
}

function judgeBgJob(name, list) {
    if (name === "bg-output" && list.length === 0) return safe("Liste des jobs en arrière-plan.");
    if (list.length === 1 && JOB_ID_RE.test(list[0])) return safe(`${name} ${list[0]}.`);
    return deny(`Usage : ${name} <id> (ex. ${name} job-1).`);
}

/**
 * Classe une commande déjà analysée (sans shell) :
 * - "safe" : lecture seule, aucune confirmation nécessaire ;
 * - "ask" : confirmation de l'utilisateur ;
 * - "deny" : jamais lancée.
 * Renvoie { level, reason }.
 */
function judge({ file, args = [], cwd, workspace } = {}) {
    const name = programName(file ?? "");
    const list = Array.isArray(args) ? args.map(String) : [];

    if (!name) return deny("Programme manquant.");
    if (name === "start") {
        return deny("start est une commande interne de cmd, indisponible ici (aucun shell). Pour lancer un programme en arrière-plan, utilise bg-run <commande> (ex. bg-run rojo serve).");
    }
    if (DENIED_PROGRAMS.has(name)) {
        return deny(`Programme interdit : ${name}. Utilise les outils de fichiers ou une commande plus ciblée.`);
    }
    if (name === "node" && list.some(isNodeEvalFlag)) {
        return deny("Exécution de code en ligne (node -e / -p) interdite. Écris un script avec write_file puis lance-le.");
    }
    if (PYTHON_RE.test(name) && hasPythonInlineCode(list)) {
        return deny("Exécution de code en ligne (python -c) interdite. Écris un script avec write_file puis lance-le.");
    }
    if (name === "deno" && hasDenoInlineCode(list)) {
        return deny("Exécution de code en ligne (deno eval) interdite. Écris un script avec write_file puis lance-le.");
    }

    const root = path.resolve(workspace || cwd || process.cwd());
    const base = path.resolve(root, cwd || ".");
    if (isOutside(path.relative(root, base))) {
        return deny(`Dossier courant hors du projet : ${cwd}`);
    }

    // Avant la vérification des chemins : un argument JSON n'est pas un chemin.
    if (name === "mcp-call") return judgeMcpCall(list, { cwd: base, workspace: root });
    if (name === "bg-run") return judgeBgRun(list, { cwd, workspace: root });
    if (BG_COMMANDS.has(name)) return judgeBgJob(name, list);
    if (name === "powershell" || name === "pwsh") return judgePowerShell(name, list, base, root);

    for (const arg of list) {
        const value = pathCandidate(arg, base);
        if (value === null) continue;
        const problem = checkPath(value, base, root);
        if (problem) return deny(problem);
    }

    if (name === "git") return judgeGit(list);
    if (name === "find") return judgeFind(list);
    // Une recherche récursive lit des fichiers non nommés dans la commande
    // (.env, clés...) : la vérification des chemins ne peut pas les voir.
    if ((name === "grep" || name === "egrep" || name === "fgrep") && isRecursiveGrep(list)) {
        return ask("grep récursif : peut afficher le contenu de fichiers sensibles (.env, clés).");
    }
    if (name === "rg" || name === "ag" || name === "ack") {
        return ask(`${name} parcourt les dossiers : peut afficher le contenu de fichiers sensibles (.env, clés).`);
    }
    if (name === "findstr" && list.some(a => /^[/-][a-z]*s[a-z]*$/i.test(a))) {
        return ask("findstr /s récursif : peut afficher le contenu de fichiers sensibles (.env, clés).");
    }
    if (PACKAGE_MANAGERS.has(name)) return judgePackageManager(name, list);
    if (name === "node") {
        if (list.length === 1 && (list[0] === "--version" || list[0] === "-v")) return safe("Version de Node.js.");
        return ask("node lance un script du projet.");
    }
    if (SAFE_PROGRAMS.has(name)) return safe(`${name} en lecture seule.`);
    return ask(`Programme ${name} : confirmation nécessaire.`);
}

module.exports = {
    judge,
    programName,
    isNodeEvalFlag,
    isWindowsSwitch,
    DENIED_PROGRAMS,
    SAFE_PROGRAMS
};
