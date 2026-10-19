"use strict";

const path = require("node:path");

const { normalizeRelative } = require("../security");

// Programmes jamais lancés : shells (ils contourneraient l'analyse de la
// commande), suppression ou formatage, élévation de privilèges, exécution indirecte.
const DENIED_PROGRAMS = new Set([
    "bash", "sh", "zsh", "fish", "cmd", "powershell", "pwsh", "wsl",
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
// Options à la Windows (/s, /?) : ce ne sont pas des chemins.
const WINDOWS_SWITCH_RE = /^\/[a-z?]{1,2}$/i;

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
function pathCandidate(arg) {
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
    if (process.platform === "win32" && WINDOWS_SWITCH_RE.test(value)) return null;
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

    for (const arg of list) {
        const value = pathCandidate(arg);
        if (value === null) continue;
        const problem = checkPath(value, base, root);
        if (problem) return deny(problem);
    }

    if (name === "git") return judgeGit(list);
    if (name === "find") return judgeFind(list);
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
    DENIED_PROGRAMS,
    SAFE_PROGRAMS
};
