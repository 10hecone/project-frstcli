"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const { CONFIG } = require("../config");
const { writeJsonFile } = require("../tools/core/atomic");
const { parseCommand, formatCommand } = require("../tools/command/parse");
const { judge } = require("../tools/command/policy");
const { runProcess } = require("../tools/command/runner");
const { cleanOutput } = require("../tools/command/output");
const { makeGlobFilter } = require("../tools/fs/search-files");

/*
 * Hooks PostToolUse (comme Claude Code) : une commande lancée après un edit_file ou un
 * write_file réussi, dont la sortie est ajoutée au résultat de l'outil (ex. un linter).
 *
 * Fichiers (même format) :
 *   - projet : <projet>/.frst/settings.json (versionné, soumis à approbation) ;
 *   - utilisateur : ~/.francestudent-cli/settings.json (toujours approuvé).
 *
 *   { "hooks": { "PostToolUse": [
 *     { "matcher": "edit_file|write_file", "glob": "*.luau", "command": "selene {file}", "timeout": 30 }
 *   ] } }
 *
 * La forme imbriquée de Claude Code ({ matcher, hooks: [{ type: "command", command, timeout }] })
 * est aussi acceptée. {file} est remplacé par le chemin relatif du fichier modifié, argument par
 * argument (après le découpage : pas d'injection possible par un nom de fichier).
 *
 * Sécurité : pas de shell (spawn, shell:false) ; judge() refuse les programmes interdits ;
 * un hook du projet ne tourne qu'après un « oui » mémorisé avec l'empreinte SHA-256 de sa
 * définition (fichier hook-approvals.json), et seulement dans un dossier de confiance.
 */

const PROJECT_FILE = path.join(".frst", "settings.json");
const USER_FILE = "settings.json";
const APPROVALS_FILE = "hook-approvals.json";
const EVENTS = ["PostToolUse"];
const EDIT_TOOLS = ["edit_file", "write_file"];
const DEFAULT_TIMEOUT_S = 60;
const MAX_TIMEOUT_S = 600;
const MAX_HOOKS = 20;
const MAX_OUTPUT_CHARS = 4000;

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

async function readJson(file) {
    try {
        return JSON.parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw new Error(`${file} illisible : ${error.message}`);
    }
}

/** Valide une entrée ; renvoie la liste des hooks (forme plate) ou lève une erreur claire. */
function normalizeEntry(entry, { event, scope, index }) {
    const where = `hooks.${event}[${index}]`;
    if (!isObject(entry)) throw new Error(`${where} : objet attendu.`);

    const matcher = entry.matcher === undefined || entry.matcher === "" || entry.matcher === "*"
        ? null
        : entry.matcher;
    if (matcher !== null && typeof matcher !== "string") throw new Error(`${where}.matcher : texte attendu.`);
    if (matcher !== null) {
        try {
            new RegExp(`^(?:${matcher})$`);
        } catch {
            throw new Error(`${where}.matcher : expression invalide.`);
        }
    }

    const glob = entry.glob ?? null;
    if (glob !== null && (typeof glob !== "string" || !glob.trim())) throw new Error(`${where}.glob : texte attendu.`);
    if (glob !== null) makeGlobFilter(glob);

    const commands = Array.isArray(entry.hooks) ? entry.hooks : [entry];
    commands.forEach((hook, i) => {
        if (!isObject(hook) || (hook.type !== undefined && hook.type !== "command")) {
            throw new Error(`${where}.hooks[${i}] : seul le type "command" est pris en charge.`);
        }
    });

    return commands.map(hook => {
        if (typeof hook.command !== "string" || !hook.command.trim()) {
            throw new Error(`${where} : "command" manquant.`);
        }
        parseCommand(hook.command);
        const timeout = hook.timeout ?? DEFAULT_TIMEOUT_S;
        if (!Number.isFinite(timeout) || timeout <= 0) throw new Error(`${where}.timeout : nombre de secondes attendu.`);
        return {
            event,
            scope,
            matcher,
            glob,
            command: hook.command.trim(),
            timeout: Math.min(MAX_TIMEOUT_S, timeout)
        };
    });
}

function normalizeSettings(raw, scope) {
    if (raw === null) return [];
    if (!isObject(raw)) throw new Error("objet JSON attendu.");
    if (raw.hooks === undefined) return [];
    if (!isObject(raw.hooks)) throw new Error("\"hooks\" doit être un objet.");

    const list = [];
    for (const event of EVENTS) {
        const entries = raw.hooks[event] ?? [];
        if (!Array.isArray(entries)) throw new Error(`hooks.${event} : tableau attendu.`);
        entries.forEach((entry, index) => list.push(...normalizeEntry(entry, { event, scope, index })));
    }
    if (list.length > MAX_HOOKS) throw new Error(`${list.length} hooks déclarés (maximum ${MAX_HOOKS}).`);
    return list;
}

const projectFile = root => path.join(root, PROJECT_FILE);
const userFile = () => path.join(CONFIG.dataDir, USER_FILE);

/** Hooks des deux fichiers : { hooks, errors }. Un fichier invalide est ignoré en entier. */
async function loadHooks(root) {
    const hooks = [];
    const errors = [];
    const sources = [["user", userFile()]];
    if (root) sources.push(["project", projectFile(root)]);

    for (const [scope, file] of sources) {
        try {
            hooks.push(...normalizeSettings(await readJson(file), scope));
        } catch (error) {
            errors.push(`${scope === "project" ? PROJECT_FILE : file} : ${error.message}`);
        }
    }
    return { hooks, errors };
}

/** Le hook concerne-t-il cet outil et ce fichier ? */
function matches(hook, toolName, rel) {
    if (hook.matcher !== null && !new RegExp(`^(?:${hook.matcher})$`).test(toolName)) return false;
    if (hook.glob !== null && !makeGlobFilter(hook.glob)(rel)) return false;
    return true;
}

/** Découpe la commande puis remplace {file} dans chaque argument. */
function buildCommand(hook, rel) {
    const { file, args } = parseCommand(hook.command);
    const fill = text => text.split("{file}").join(rel);
    return { file: fill(file), args: args.map(fill) };
}

// ---------------------------------------------------------------------------
// Approbation des hooks du projet
// ---------------------------------------------------------------------------

function fingerprint(hook) {
    const canonical = { event: hook.event, matcher: hook.matcher, glob: hook.glob, command: hook.command, timeout: hook.timeout };
    return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

const approvalsFile = () => path.join(CONFIG.dataDir, APPROVALS_FILE);

function projectKey(root) {
    const resolved = path.resolve(root);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function readApprovals() {
    const raw = await readJson(approvalsFile()).catch(() => null);
    return isObject(raw) && isObject(raw.projects) ? { version: 1, projects: raw.projects } : { version: 1, projects: {} };
}

let chain = Promise.resolve();
function exclusive(task) {
    const run = chain.then(task);
    chain = run.catch(() => {});
    return run;
}

async function getDecision(root, hook) {
    const project = (await readApprovals()).projects[projectKey(root)];
    const decision = isObject(project) ? project[fingerprint(hook)] : null;
    return isObject(decision) && ["approved", "rejected"].includes(decision.decision) ? decision.decision : "pending";
}

function setDecision(root, hook, decision) {
    return exclusive(async () => {
        const store = await readApprovals();
        const key = projectKey(root);
        const project = isObject(store.projects[key]) ? store.projects[key] : {};
        project[fingerprint(hook)] = { command: hook.command, decision, at: new Date().toISOString() };
        store.projects[key] = project;
        await writeJsonFile(approvalsFile(), store);
    });
}

async function defaultIsTrusted(root) {
    const known = await require("../project/projects").get(root);
    return Boolean(known && known.trusted);
}

function describeForApproval(hook) {
    return [
        `Le projet déclare un hook ${hook.event} (fichier ${PROJECT_FILE}).`,
        `Commande : ${hook.command}`,
        `Outils : ${hook.matcher ?? "tous"}${hook.glob ? ` ; fichiers : ${hook.glob}` : ""}`,
        "Cette commande sera lancée sur ta machine après chaque modification correspondante. Autoriser ce hook ?"
    ].join("\n");
}

const asking = new Map();

/** "approved", "rejected", "pending" (sans interface) ou "untrusted". */
async function ensureApproved(root, hook, { ui = null, isTrusted = defaultIsTrusted } = {}) {
    if (hook.scope !== "project") return "approved";
    if (!(await isTrusted(root))) return "untrusted";

    const status = await getDecision(root, hook);
    if (status !== "pending" || !ui || typeof ui.confirm !== "function") return status;

    const key = `${projectKey(root)}\0${fingerprint(hook)}`;
    if (asking.has(key)) return asking.get(key);

    const pending = (async () => {
        const decision = (await ui.confirm(describeForApproval(hook))) ? "approved" : "rejected";
        await setDecision(root, hook, decision);
        return decision;
    })();
    asking.set(key, pending);
    try {
        return await pending;
    } finally {
        asking.delete(key);
    }
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

/** Lance un hook ; ne lève jamais. Renvoie { command, status, exit_code, output }. */
async function runHook(hook, rel, { root, ui, isTrusted, run = runProcess }) {
    let command;
    try {
        command = buildCommand(hook, rel);
    } catch (error) {
        return { command: hook.command, status: "error", output: error.message };
    }
    const label = formatCommand(command.file, command.args);

    const approval = await ensureApproved(root, hook, { ui, isTrusted });
    if (approval !== "approved") {
        return { command: label, status: "skipped", output: approval === "untrusted" ? "dossier pas de confiance" : "hook non approuvé" };
    }

    const verdict = judge({ file: command.file, args: command.args, cwd: root, workspace: root });
    if (verdict.level === "deny") return { command: label, status: "denied", output: verdict.reason };

    try {
        const result = await run({ file: command.file, args: command.args, cwd: root, timeoutMs: hook.timeout * 1000 });
        const { output } = cleanOutput(result.output ?? "", { maxChars: MAX_OUTPUT_CHARS, truncated: result.truncated });
        const status = result.timed_out ? "timeout" : result.exit_code === 0 ? "ok" : "failed";
        return { command: label, status, exit_code: result.exit_code, output };
    } catch (error) {
        return { command: label, status: "error", output: error.message };
    }
}

const STATUS_TEXT = {
    ok: () => "réussi",
    failed: run => `échec (code ${run.exit_code})`,
    timeout: () => "délai dépassé",
    denied: () => "refusé",
    skipped: () => "ignoré",
    error: () => "erreur"
};

/** Texte ajouté au résultat de l'outil (vide si aucun hook n'a tourné). */
function formatRuns(runs) {
    return runs
        .filter(run => run.status !== "skipped")
        .map(run => {
            const head = `[hook PostToolUse] ${run.command} : ${STATUS_TEXT[run.status](run)}`;
            return run.output ? `${head}\n${run.output}` : head;
        })
        .join("\n\n");
}

/**
 * Après un appel d'outil réussi : lance les hooks PostToolUse correspondants, l'un après
 * l'autre. Renvoie { runs, text } ; ne lève jamais (un hook cassé ne casse pas la session).
 */
async function runPostToolUse(toolName, result, { root, ui = null, isTrusted = defaultIsTrusted, run } = {}) {
    const empty = { runs: [], text: "" };
    if (!root || !EDIT_TOOLS.includes(toolName)) return empty;
    if (!result || result.denied || result.changed === false || typeof result.path !== "string") return empty;

    const rel = result.path.replace(/\\/g, "/");
    const { hooks, errors } = await loadHooks(root);
    for (const error of errors) ui?.warn?.(`Hooks ignorés : ${error}`);

    const runs = [];
    for (const hook of hooks.filter(h => h.event === "PostToolUse" && matches(h, toolName, rel))) {
        const outcome = await runHook(hook, rel, { root, ui, isTrusted, run });
        runs.push(outcome);
        if (outcome.status === "skipped") continue;
        const tone = outcome.status === "ok" ? undefined : "error";
        ui?.result?.(`hook : ${outcome.command} (${STATUS_TEXT[outcome.status](outcome)})`, tone ? { tone } : undefined);
    }
    return { runs, text: formatRuns(runs) };
}

module.exports = {
    PROJECT_FILE,
    USER_FILE,
    APPROVALS_FILE,
    loadHooks,
    normalizeSettings,
    matches,
    buildCommand,
    fingerprint,
    ensureApproved,
    runPostToolUse,
    formatRuns
};
