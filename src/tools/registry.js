"use strict";

const { requireString, optionalInt } = require("./core/args");
const { runCommand } = require("./command/index");

// ---------------------------------------------------------------------------
// Outils client (catalogue fixe de l'API, voir client-tools.md)
// ---------------------------------------------------------------------------

// Ordre FIXE : la liste envoyée à l'API doit rester identique d'un tour à l'autre
// pour garder le cache de prompt. Ne pas trier, ne pas filtrer dynamiquement.
const CLIENT_TOOLS = Object.freeze([
    "list_directory",
    "read_file",
    "search_files",
    "edit_file",
    "write_file",
    "run_command"
]);

// Sous-ensemble en lecture seule (mode /plan).
const READ_TOOLS = Object.freeze(["list_directory", "read_file", "search_files"]);

// Délai maximal accepté pour run_command (en secondes).
const MAX_TIMEOUT_SECONDS = 600;

const REGEX_CHARS = /[\\^$.*+?()[\]{}|]/;

/** Entier depuis un nombre ou une chaîne numérique ("80"), sinon la valeur telle quelle (check() la refusera). */
function toInt(value) {
    if (typeof value === "string" && /^\s*-?\d+\s*$/.test(value)) return Number(value);
    return value;
}

function toBool(value) {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
}

/** Le catalogue n'a pas de drapeau regex : la requête est traitée en regex si elle en a l'air et compile. */
function looksLikeRegex(query) {
    if (typeof query !== "string" || !REGEX_CHARS.test(query)) return false;
    try {
        new RegExp(query);
        return true;
    } catch {
        return false;
    }
}

function secondsToMs(value) {
    const seconds = Number(toInt(value));
    if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
    return Math.round(Math.min(seconds, MAX_TIMEOUT_SECONDS) * 1000);
}

/** Retire les clés undefined. */
function compact(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/**
 * Convertit les arguments du catalogue de l'API vers le format des outils locaux.
 * Seules les clés connues sont gardées : un argument inattendu envoyé par le modèle
 * (background, recursive...) est ignoré.
 */
function normalizeArgs(name, raw) {
    const a = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};

    switch (name) {
        case "list_directory": {
            const depth = toInt(a.depth);
            return compact({
                path: a.path,
                depth: Number.isInteger(depth) ? Math.min(3, Math.max(1, depth)) : depth
            });
        }
        case "read_file":
            return compact({
                path: a.path,
                start_line: toInt(a.start_line),
                end_line: toInt(a.end_line)
            });
        case "search_files":
            return compact({
                query: a.query,
                path: a.path,
                glob: a.glob,
                regex: looksLikeRegex(a.query) ? true : undefined,
                max_results: toInt(a.max_results)
            });
        case "edit_file":
            return compact({
                path: a.path,
                old_string: a.old_text,
                new_string: a.new_text,
                replace_all: toBool(a.replace_all)
            });
        case "write_file":
            return compact({ path: a.path, content: a.content });
        case "run_command":
            return compact({
                command: a.command,
                cwd: a.cwd,
                timeout_ms: secondsToMs(a.timeout_seconds)
            });
        default:
            throw new Error(`Outil client inconnu : ${name}.`);
    }
}

// ---------------------------------------------------------------------------
// Outils locaux
// ---------------------------------------------------------------------------

const runCommandTool = {
    name: "run_command",
    run: runCommand,
    check(args) {
        if (args.command !== undefined) {
            requireString(args.command, "command");
        } else {
            requireString(args.name, "name");
        }
        optionalInt(args.timeout_ms, "timeout_ms");
        if (args.background !== undefined && typeof args.background !== "boolean") {
            throw new Error("background doit être true ou false.");
        }
    },
    describe(a) {
        const command = a.command ?? a.name ?? "?";
        const suffix = a.background === true ? " (arrière-plan)" : "";
        return a.timeout_ms !== undefined
            ? `${command} (délai ${a.timeout_ms} ms)${suffix}`
            : `${command}${suffix}`;
    }
};

const jobOutputTool = {
    name: "job_output",
    run: (args) => require("./command/jobs").jobOutput(args),
    check(args) {
        requireString(args.id, "id");
    },
    describe: (a) => a.id ?? "?"
};

const jobStopTool = {
    name: "job_stop",
    run: (args) => require("./command/jobs").jobStop(args),
    check(args) {
        requireString(args.id, "id");
    },
    describe: (a) => a.id ?? "?"
};

const MODULES = [
    require("./fs/list-directory"),
    require("./fs/read-file"),
    require("./fs/search-files"),
    require("./fs/write-file"),
    require("./fs/edit-file"),
    runCommandTool,

    // LEGACY : plus envoyés à l'API depuis la suppression de l'ancien agent (phase 4).
    // Gardés le temps de vérifier leurs autres usages (tests, TUI) ; à trier en phase 5.
    require("./fs/glob"),
    require("./fs/create-directory"),
    require("./fs/multi-edit"),
    require("./fs/move-path"),
    require("./fs/copy-path"),
    require("./fs/delete-path"),
    require("./fs/remember"),
    require("./todo-write"),
    require("./web/web-fetch"),
    require("./web/web-search"),
    jobOutputTool,
    jobStopTool
];

const TOOLS = {};
const DESCRIBE = {};

for (const tool of MODULES) {
    TOOLS[tool.name] = { run: tool.run, check: tool.check };
    DESCRIBE[tool.name] = tool.describe;
}

function validateToolCall(action) {
    if (!action || typeof action !== "object") {
        throw new Error("Action d'outil invalide.");
    }

    if (!Object.hasOwn(TOOLS, action.name)) {
        throw new Error(
            `Outil inconnu : ${action.name}. Outils valides : ${Object.keys(TOOLS).join(", ")}.`
        );
    }

    if (!action.args || typeof action.args !== "object" || Array.isArray(action.args)) {
        throw new Error("args doit être un objet.");
    }

    TOOLS[action.name].check(action.args);
}

/** Description lisible de l'action, affichée à côté du nom de l'outil. */
function describeCall(action) {
    const a = action.args || {};

    if (Object.hasOwn(DESCRIBE, action.name)) return DESCRIBE[action.name](a);

    return a.path ?? ".";
}

// ---------------------------------------------------------------------------
// Exécution d'un appel client (completed.message.toolCalls[i])
// ---------------------------------------------------------------------------

/** Description lisible d'un appel client, avec les arguments du catalogue de l'API. */
function describeClientCall(name, rawArgs) {
    try {
        return describeCall({ name, args: normalizeArgs(name, rawArgs) });
    } catch {
        return name;
    }
}

/**
 * Normalise, valide puis exécute un appel client. Renvoie le résultat brut de l'outil
 * (objet) ; les erreurs sont levées et seront converties en { isError: true } par la boucle du chat.
 * allowed : liste des outils envoyés à l'API pour ce tour (CLIENT_TOOLS ou READ_TOOLS).
 */
async function runClientTool(name, rawArgs, allowed = CLIENT_TOOLS) {
    if (!allowed.includes(name)) {
        throw new Error(`Outil non disponible : ${name}.`);
    }

    const args = normalizeArgs(name, rawArgs);
    validateToolCall({ name, args });

    let result = await TOOLS[name].run(args);

    if (
        name === "search_files" &&
        Number.isInteger(args.max_results) &&
        args.max_results > 0 &&
        Array.isArray(result?.matches) &&
        result.matches.length > args.max_results
    ) {
        result = { ...result, matches: result.matches.slice(0, args.max_results), truncated: true };
    }

    return result;
}

module.exports = {
    TOOLS,
    validateToolCall,
    describeCall,
    CLIENT_TOOLS,
    READ_TOOLS,
    normalizeArgs,
    describeClientCall,
    runClientTool
};
