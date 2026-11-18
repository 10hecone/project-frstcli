"use strict";

const { CONFIG } = require("../config");
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

// Nombre de résultats de search_files quand le modèle n'en précise pas.
const DEFAULT_SEARCH_RESULTS = 50;

// Le catalogue public n'expose pas encore de booléen regex : préfixe explicite.
const REGEX_PREFIX = "regex:";

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

/**
 * Regex par défaut (comme ripgrep) : « A|B » fonctionne sans préfixe. Un motif invalide
 * (« foo( ») est cherché tel quel. Préfixes : « literal: » force le littéral, « regex: »
 * reste accepté, « files: » ne renvoie que les fichiers et leur nombre de correspondances.
 */
function searchQuery(query) {
    if (typeof query !== "string") return { query, regex: false };
    if (query.startsWith("files:")) return { ...searchQuery(query.slice("files:".length)), files_only: true };
    if (query.startsWith("literal:")) return { query: query.slice("literal:".length), regex: false };
    const text = query.startsWith(REGEX_PREFIX) ? query.slice(REGEX_PREFIX.length) : query;
    try {
        new RegExp(text, "i");
        return { query: text, regex: true };
    } catch {
        return { query: text, regex: false, literal_fallback: true };
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
        case "read_file": {
            // offset/limit (habitude de certains modèles) : alias de start_line/end_line.
            const offset = toInt(a.offset);
            const limit = toInt(a.limit);
            const start = toInt(a.start_line) ?? offset;
            const end = toInt(a.end_line) ?? (Number.isInteger(start) && Number.isInteger(limit) ? start + limit - 1 : undefined);
            return compact({ path: a.path, start_line: start, end_line: end });
        }
        case "search_files":
            return compact({
                ...searchQuery(a.query),
                path: a.path,
                glob: a.glob,
                max_results: toInt(a.max_results) ?? DEFAULT_SEARCH_RESULTS
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

const MODULES = [
    require("./fs/list-directory"),
    require("./fs/read-file"),
    require("./fs/search-files"),
    require("./fs/write-file"),
    require("./fs/edit-file"),
    runCommandTool
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

// ---------------------------------------------------------------------------
// Résultat renvoyé à l'API : du texte lisible plutôt que du JSON
// (moins de caractères, pas d'échappement des retours à la ligne).
// ---------------------------------------------------------------------------

/** read_file : en-tête puis lignes numérotées « N<tab>texte ». */
function formatReadFile(r) {
    const content = r.content;
    const empty = content === "" && !Array.isArray(r.range);
    const lines = content.split("\n");
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

    const first = Array.isArray(r.range) ? r.range[0] : 1;
    const last = first + lines.length - 1;

    if (r.unchanged) return `Fichier : ${r.path} (${r.total_lines} ligne(s)) — ${r.message}`;

    const out = [
        empty
            ? `Fichier : ${r.path} (vide)`
            : `Fichier : ${r.path} (${r.total_lines} ligne(s) au total, lignes ${first} à ${last} affichées)`
    ];

    if (!empty) {
        // Rappel « ne pas recopier les numéros » : dans les notes techniques, une seule fois.
        lines.forEach((line, i) => out.push(`${first + i}\t${line}`));
    }

    if (r.truncated) out.push(`[tronqué] ${r.message}`);

    return out.join("\n");
}

/** search_files : une correspondance par ligne « chemin:ligne: texte ». */
function formatSearch(r) {
    const head = r.message || `${r.matches.length} résultat(s).`;
    const out = [r.truncated ? `${head} Liste incomplète : affine la recherche (path, glob).` : head];

    if (r.files_only) {
        const counts = new Map();
        for (const m of r.matches) counts.set(m.path, (counts.get(m.path) || 0) + (m.count ?? 1));
        for (const [file, n] of counts) out.push(`${file} (${n})`);
        return out.join("\n");
    }

    if (CONFIG.optim) {
        // Groupé par fichier : le chemin n'est écrit qu'une fois.
        let current = null;
        for (const m of r.matches) {
            if (m.path !== current) {
                current = m.path;
                out.push(`${m.path}`);
            }
            out.push(`  ${m.line}: ${m.text}`);
        }
        return out.join("\n");
    }

    for (const m of r.matches) out.push(`${m.path}:${m.line}: ${m.text}`);

    return out.join("\n");
}

/** list_directory : une entrée par ligne, dossiers terminés par « / » (arbre indenté si optim). */
function formatList(r) {
    const head = `Dossier : ${r.path}${r.entries.length ? "" : " (vide)"}`;
    const out = [r.truncated ? `${head} (liste tronquée à ${r.entries.length} éléments)` : head];

    // Arbre : nom seul, indenté de 2 espaces par niveau sous le dossier listé.
    const base = r.path === "." ? 0 : r.path.split("/").length;
    for (const e of r.entries) {
        const name = e.type === "directory" ? `${e.path}/` : e.path;
        if (!CONFIG.optim) {
            out.push(name);
            continue;
        }
        const parts = e.path.split("/");
        const depth = parts.length - base - 1;
        out.push(`${"  ".repeat(Math.max(0, depth))}${parts[parts.length - 1]}${e.type === "directory" ? "/" : ""}`);
    }

    return out.join("\n");
}

/** edit_file : statut puis extrait numéroté de la zone modifiée. */
function formatEdit(r) {
    const out = [`${r.message} ${r.path} (${r.replacements} remplacement(s)).`];
    if (r.warning) out.push(`Avertissement : ${r.warning}`);
    out.push(`Extrait après modification (lignes ${r.excerpt.first} à ${r.excerpt.last}) :`, r.excerpt.text);
    return out.join("\n");
}

/** run_command : commande, dossier, statut, fichiers modifiés, étapes puis sortie. */
function formatCommandResult(r) {
    if (r.denied) return `Commande refusée : ${r.command}${r.message ? `\n${r.message}` : ""}`;
    if (r.background) return `$ ${r.command}\n${r.message ?? ""}`.trimEnd();

    const out = [`$ ${r.command}`];
    // Dossier affiché seulement s'il diffère de la racine du projet.
    if (r.cwd && r.cwd !== ".") out.push(`Dossier : ${r.cwd}`);
    if (r.message && r.message !== r.output) out.push(r.message);

    if (Array.isArray(r.files_changed) && r.files_changed.length) {
        out.push(`Fichiers modifiés : ${r.files_changed.join(", ")}.`);
    }

    // Étapes listées seulement si l'une a échoué ou n'a pas été lancée (numéros, sans recopier les commandes).
    const segments = Array.isArray(r.segments) && r.segments.length > 1 ? r.segments : [];
    if (segments.some(s => s.skipped || (s.exit_code ?? 0) !== 0)) {
        const steps = segments.map((s, i) => `[${i + 1}] ${s.skipped ? "non lancée" : `code ${s.exit_code ?? "?"}`}`);
        out.push(`Étapes : ${steps.join(", ")}`);
    }

    if (r.truncated) out.push("Sortie tronquée : début et fin conservés. Des données intermédiaires peuvent manquer ; ne pas traiter ce résultat comme complet.");

    const output = typeof r.output === "string" ? r.output.trimEnd() : "";
    out.push(output ? `Sortie :\n${output}` : "Sortie : (aucune)");

    return out.join("\n");
}

/**
 * Texte renvoyé à l'API pour le résultat d'un outil client.
 * read_file, search_files, list_directory et run_command sont mis en forme ;
 * les autres résultats (edit_file, write_file...) restent en JSON compact.
 */
function formatClientResult(name, result) {
    if (typeof result === "string") return result;
    if (result === undefined || result === null) return "OK.";

    try {
        if (name === "read_file" && typeof result.content === "string") return formatReadFile(result);
        if (name === "search_files" && Array.isArray(result.matches)) return formatSearch(result);
        if (name === "list_directory" && Array.isArray(result.entries)) return formatList(result);
        if (name === "run_command" && typeof result.command === "string") return formatCommandResult(result);
        if (name === "edit_file" && result.excerpt && !result.denied) return formatEdit(result);
        if (result.denied && typeof result.message === "string") return `Refusé : ${result.message}`;
    } catch {
        // forme inattendue : JSON ci-dessous
    }

    return JSON.stringify(result);
}

module.exports = {
    TOOLS,
    validateToolCall,
    describeCall,
    CLIENT_TOOLS,
    READ_TOOLS,
    DEFAULT_SEARCH_RESULTS,
    normalizeArgs,
    describeClientCall,
    runClientTool,
    formatClientResult
};
