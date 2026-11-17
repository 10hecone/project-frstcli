"use strict";

const path = require("node:path");

const { normalizeRelative } = require("../tools/security");
const { redact, redactJson } = require("./redact");

/*
 * Grammaire de `mcp-call` (commande interne de run_command, pas un binaire) :
 *   mcp-call [--help]
 *   mcp-call list
 *   mcp-call tools <serveur>
 *   mcp-call describe <serveur> <outil>
 *   mcp-call run <serveur> <outil> ['<json>' | --args-file <fichier>]
 *   mcp-call resources <serveur>
 *   mcp-call read <serveur> <uri>
 *   mcp-call prompts <serveur>
 *   mcp-call prompt <serveur> <nom> ['<json>' | --args-file <fichier>]
 *   mcp-call <serveur> <outil> ['<json>']   (raccourci de run)
 * `--help` est accepté à chaque niveau.
 */

const PROGRAM = "mcp-call";

const SUBCOMMANDS = {
    list: { positionals: [], usage: "mcp-call list" },
    tools: { positionals: ["serveur"], usage: "mcp-call tools <serveur>" },
    describe: { positionals: ["serveur", "outil"], usage: "mcp-call describe <serveur> <outil>" },
    run: {
        positionals: ["serveur", "outil"],
        json: true,
        usage: "mcp-call run <serveur> <outil> ['<json>' | --args-file <fichier>]"
    },
    resources: { positionals: ["serveur"], usage: "mcp-call resources <serveur>" },
    read: { positionals: ["serveur", "uri"], usage: "mcp-call read <serveur> <uri>" },
    prompts: { positionals: ["serveur"], usage: "mcp-call prompts <serveur>" },
    prompt: {
        positionals: ["serveur", "nom"],
        json: true,
        usage: "mcp-call prompt <serveur> <nom> ['<json>' | --args-file <fichier>]"
    }
};

const SAFE_ACTIONS = new Set(["help", "list", "tools", "describe", "resources", "prompts"]);
const HELP_FLAGS = new Set(["--help", "-h", "help"]);
const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
const QUESTION_ARGS_CHARS = 300;

const GENERAL_USAGE = [
    "usage : mcp-call <sous-commande> …",
    ...Object.values(SUBCOMMANDS).map(spec => `  ${spec.usage}`),
    "  mcp-call <serveur> <outil> ['<json>']   (raccourci de run)"
].join("\n");

const isSubcommand = name => Object.hasOwn(SUBCOMMANDS, name);

function usageOf(action) {
    return isSubcommand(action) ? `usage : ${SUBCOMMANDS[action].usage}` : GENERAL_USAGE;
}

function usageError(action, message) {
    return { action, error: message, usage: usageOf(action) };
}

/**
 * Analyse les arguments de mcp-call (déjà découpés par parseCommand).
 * Renvoie { action, server, target, json, argsFile, help, shortcut } ou { action, error, usage }.
 */
function parseMcpArgs(args = []) {
    const list = Array.isArray(args) ? args.map(String) : [];
    if (!list.length || (list.length === 1 && HELP_FLAGS.has(list[0]))) return { action: "help", help: true };

    let action = list[0].toLowerCase();
    let rest = list.slice(1);
    let shortcut = false;
    if (!isSubcommand(action)) {
        if (list[0].startsWith("-")) return usageError("help", `option inconnue : ${list[0]}`);
        action = "run";
        rest = list;
        shortcut = true;
    }
    const spec = SUBCOMMANDS[action];

    const positionals = [];
    let argsFile = null;
    let offset = 0;
    let help = false;
    for (let i = 0; i < rest.length; i += 1) {
        const arg = rest[i];
        if (arg === "--help" || arg === "-h") {
            help = true;
        } else if (arg === "--offset") {
            if (action !== "describe") return usageError(action, "--offset existe seulement pour describe");
            const value = rest[++i];
            if (!/^\d+$/.test(value || "") || !Number.isSafeInteger(Number(value))) {
                return usageError(action, "--offset attend un entier positif ou nul");
            }
            offset = Number(value);
        } else if (arg === "--args-file" || arg.startsWith("--args-file=")) {
            if (!spec.json) return usageError(action, `--args-file n'existe pas pour ${action}`);
            if (argsFile !== null) return usageError(action, "--args-file donné deux fois");
            argsFile = arg === "--args-file" ? rest[++i] : arg.slice("--args-file=".length);
            if (!argsFile) return usageError(action, "--args-file attend un chemin de fichier");
        } else if (arg === "--") {
            positionals.push(...rest.slice(i + 1));
            break;
        } else if (arg.startsWith("--") && positionals.length < spec.positionals.length) {
            return usageError(action, `option inconnue : ${arg}`);
        } else {
            positionals.push(arg);
        }
    }

    if (help) return { action, help: true, shortcut };

    const expected = spec.positionals.length;
    if (positionals.length < expected) {
        const missing = spec.positionals.slice(positionals.length).map(name => `<${name}>`).join(" ");
        return usageError(action, `argument manquant : ${missing}`);
    }
    const extra = positionals.slice(expected);
    if (extra.length > (spec.json ? 1 : 0)) {
        const hint = spec.json ? " (le JSON doit être un seul argument, entre apostrophes)" : "";
        return usageError(action, `trop d'arguments : ${extra.join(" ").slice(0, 80)}${hint}`);
    }
    if (extra.length && argsFile !== null) {
        return usageError(action, "donne le JSON en argument ou avec --args-file, pas les deux");
    }

    return {
        action,
        server: positionals[0] ?? null,
        target: positionals[1] ?? null,
        json: extra[0] ?? null,
        argsFile,
        ...(offset ? { offset } : {}),
        help: false,
        shortcut
    };
}

/** Forme complète pour les règles de permission : le raccourci devient `run`, les options passent à la fin. */
function canonicalMcpArgs(args = []) {
    const parsed = parseMcpArgs(args);
    if (parsed.error || parsed.help || !isSubcommand(parsed.action)) return Array.isArray(args) ? args.map(String) : [];
    const tokens = [parsed.action];
    if (parsed.server !== null) tokens.push(parsed.server);
    if (parsed.target !== null) tokens.push(parsed.target);
    if (parsed.json !== null) tokens.push(parsed.json);
    if (parsed.argsFile !== null) tokens.push("--args-file", parsed.argsFile);
    if (parsed.offset) tokens.push("--offset", String(parsed.offset));
    return tokens;
}

function checkArgsFile(file, cwd, workspace) {
    if (file.startsWith("~")) return `--args-file hors du projet interdit : ${file}`;
    const root = path.resolve(workspace || cwd || process.cwd());
    const base = path.resolve(root, cwd || ".");
    const rel = path.relative(root, path.resolve(base, file));
    if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
        return `--args-file hors du projet interdit : ${file}`;
    }
    try {
        normalizeRelative(rel || ".");
    } catch (error) {
        return `--args-file refusé : ${error.message}`;
    }
    return null;
}

/**
 * Classe un appel mcp-call : { level: "safe" | "ask" | "deny", reason }.
 * Une erreur d'usage n'est pas refusée : call.js affiche l'usage (code 2).
 */
function judgeMcpCall(args = [], { cwd, workspace } = {}) {
    const parsed = parseMcpArgs(args);
    if (parsed.error) return { level: "safe", reason: "mcp-call : erreur d'usage, l'aide sera affichée." };
    if (parsed.help) return { level: "safe", reason: "Aide de mcp-call." };

    if (parsed.server !== null && (!SERVER_NAME_RE.test(parsed.server) || parsed.server === "__proto__")) {
        return {
            level: "deny",
            reason: `Nom de serveur MCP invalide : ${JSON.stringify(parsed.server.slice(0, 40))} (lettres, chiffres, _ et -). Lance « mcp-call list ».`
        };
    }
    if (parsed.argsFile !== null) {
        const problem = checkArgsFile(parsed.argsFile, cwd, workspace);
        if (problem) return { level: "deny", reason: problem };
    }

    if (SAFE_ACTIONS.has(parsed.action)) {
        return { level: "safe", reason: `mcp-call ${parsed.action} en lecture seule.` };
    }
    const what = {
        run: `l'outil « ${parsed.target} » du serveur MCP « ${parsed.server} »`,
        read: `une ressource du serveur MCP « ${parsed.server} »`,
        prompt: `le prompt « ${parsed.target} » du serveur MCP « ${parsed.server} »`
    }[parsed.action];
    return { level: "ask", reason: `mcp-call ${parsed.action} appelle ${what}.` };
}

function shorten(text, max) {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Arguments affichés dans la question : masqués d'abord (un secret coupé ne serait plus reconnu), puis tronqués.
function displayArgs(json, redactText) {
    let text;
    try {
        text = JSON.stringify(redactJson(JSON.parse(json), redactText));
    } catch {
        text = redactText(json);
    }
    return shorten(text.replace(/[\u0000-\u001f\u007f]+/g, " "), QUESTION_ARGS_CHARS);
}

function describeAnnotations(annotations) {
    if (!annotations || typeof annotations !== "object") return null;
    const notes = [];
    if (annotations.readOnlyHint === true) notes.push("lecture seule");
    if (annotations.destructiveHint === true) notes.push("peut supprimer ou écraser des données");
    if (annotations.idempotentHint === true) notes.push("idempotent");
    if (annotations.openWorldHint === true) notes.push("contacte des services externes");
    return notes.length ? notes.join(", ") : null;
}

/**
 * Question de confirmation d'un appel mcp-call (run, read, prompt) : serveur, outil,
 * arguments masqués et tronqués, indications du serveur à titre d'information.
 */
function describeMcpCall(args = [], { redactText = redact, annotations = null } = {}) {
    const parsed = parseMcpArgs(args);
    if (parsed.error || parsed.help) return `Lancer "mcp-call ${args.join(" ")}" ?`;

    const lines = [];
    if (parsed.action === "read") {
        lines.push(`Lire la ressource ${shorten(redactText(parsed.target), 200)} du serveur MCP « ${parsed.server} » ?`);
    } else {
        const kind = parsed.action === "prompt" ? "le prompt" : "l'outil";
        lines.push(`Appeler ${kind} « ${parsed.target} » du serveur MCP « ${parsed.server} » ?`);
        if (parsed.json !== null) lines.push(`Arguments : ${displayArgs(parsed.json, redactText)}`);
        if (parsed.argsFile !== null) lines.push(`Arguments lus dans : ${parsed.argsFile}`);
    }
    const notes = describeAnnotations(annotations);
    if (notes) lines.push(`Indications du serveur (non vérifiées) : ${notes}`);
    return lines.join("\n");
}

module.exports = {
    PROGRAM,
    SUBCOMMANDS,
    GENERAL_USAGE,
    isSubcommand,
    QUESTION_ARGS_CHARS,
    usageOf,
    parseMcpArgs,
    canonicalMcpArgs,
    judgeMcpCall,
    describeMcpCall
};
