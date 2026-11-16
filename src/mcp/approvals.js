"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const { CONFIG } = require("../config");
const { writeJsonFile } = require("../tools/core/atomic");

/*
 * Approbation des serveurs MCP du scope « project » (<projet>/.mcp.json).
 *
 * Un dépôt cloné ne doit pas pouvoir lancer un programme chez l'utilisateur : un serveur du projet
 * ne démarre qu'après une réponse « oui », mémorisée avec l'empreinte SHA-256 de sa définition
 * complète (commande, arguments, noms et valeurs d'env, URL, en-têtes, délai). Toute modification
 * (un `git pull` par exemple) change l'empreinte et redemande l'approbation.
 *
 * Fichier : ~/.francestudent-cli/mcp-approvals.json (0o600)
 *   { version: 1, projects: { "<clé du dossier>": { "<nom>": { sha256, decision, at } } } }
 *
 * Les scopes « local » et « user » sont écrits par l'utilisateur lui-même : toujours approuvés.
 */

const FILE_NAME = "mcp-approvals.json";
const DECISIONS = ["approved", "rejected"];

// Statuts renvoyés par statusOf / ensureApproved.
const STATUS = {
    approved: "approved",
    rejected: "rejected",
    pending: "pending",       // pas encore de réponse (ou définition modifiée depuis)
    untrusted: "untrusted"    // dossier pas encore de confiance : serveur ignoré
};

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

const approvalsFile = () => path.join(CONFIG.dataDir, FILE_NAME);

/** Clé du dossier : chemin résolu, en minuscules sous Windows (même règle que projectDir). */
function projectKey(workspace) {
    const resolved = path.resolve(workspace);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

// Objet aux clés triées : l'empreinte ne dépend pas de l'ordre des champs dans le fichier.
function sorted(map = {}) {
    return Object.fromEntries(Object.keys(map).sort().map(key => [key, map[key]]));
}

/** Empreinte SHA-256 de la définition complète d'un serveur (avant développement des variables). */
function fingerprint(server) {
    const canonical = server.type === "stdio"
        ? {
            type: "stdio",
            command: server.command,
            args: [...(server.args ?? [])],
            env: sorted(server.env)
        }
        : {
            type: server.type,
            url: server.url,
            headers: sorted(server.headers)
        };
    canonical.timeout = server.timeout ?? null;

    return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

// ---------------------------------------------------------------------------
// Fichier
// ---------------------------------------------------------------------------

async function readStore() {
    try {
        const raw = JSON.parse((await fs.readFile(approvalsFile(), "utf8")).replace(/^\uFEFF/, ""));
        const projects = isObject(raw) && isObject(raw.projects) ? raw.projects : {};
        return { version: 1, projects };
    } catch {
        // Absent ou illisible : aucune approbation (donc tout est redemandé, jamais l'inverse).
        return { version: 1, projects: {} };
    }
}

// Les écritures d'un même processus passent l'une après l'autre : pas de mise à jour perdue.
let chain = Promise.resolve();
function exclusive(task) {
    const run = chain.then(task);
    chain = run.catch(() => {});
    return run;
}

function entryOf(store, workspace, name) {
    const project = store.projects[projectKey(workspace)];
    if (!isObject(project) || !Object.hasOwn(project, name)) return null;

    const entry = project[name];
    if (!isObject(entry) || typeof entry.sha256 !== "string" || !DECISIONS.includes(entry.decision)) return null;
    return entry;
}

/** Décision mémorisée pour ce serveur et cette définition : "approved", "rejected" ou "pending". */
async function getDecision(workspace, server) {
    const entry = entryOf(await readStore(), workspace, server.name);
    if (!entry || entry.sha256 !== fingerprint(server)) return STATUS.pending;
    return entry.decision;
}

/** Mémorise "approved" ou "rejected" pour la définition actuelle du serveur. */
function setDecision(workspace, server, decision) {
    if (!DECISIONS.includes(decision)) throw new Error(`décision inconnue : ${decision}`);

    return exclusive(async () => {
        const store = await readStore();
        const key = projectKey(workspace);
        const project = isObject(store.projects[key]) ? store.projects[key] : {};

        project[server.name] = { sha256: fingerprint(server), decision, at: new Date().toISOString() };
        store.projects[key] = project;
        await writeJsonFile(approvalsFile(), store);
    });
}

/** Oublie toutes les réponses données pour ce dossier. Renvoie le nombre de choix effacés. */
function resetProjectChoices(workspace) {
    return exclusive(async () => {
        const store = await readStore();
        const key = projectKey(workspace);
        const project = store.projects[key];
        if (!isObject(project)) return 0;

        const count = Object.keys(project).length;
        delete store.projects[key];
        await writeJsonFile(approvalsFile(), store);
        return count;
    });
}

// ---------------------------------------------------------------------------
// Confiance et question
// ---------------------------------------------------------------------------

async function defaultIsTrusted(workspace) {
    const projects = require("../project/projects");
    const known = await projects.get(workspace);
    return Boolean(known && known.trusted);
}

/**
 * Texte de la question : nom, commande + arguments (ou URL), noms des variables d'env et
 * d'en-têtes. Jamais leurs valeurs.
 */
function describeForApproval(server) {
    const lines = [`Le projet déclare le serveur MCP « ${server.name} » (fichier .mcp.json).`];

    if (server.type === "stdio") {
        lines.push(`Commande : ${[server.command, ...(server.args ?? [])].join(" ")}`);
        const names = Object.keys(server.env ?? {});
        if (names.length) lines.push(`Variables d'environnement : ${names.join(", ")}`);
    } else {
        lines.push(`Adresse (${server.type}) : ${server.url}`);
        const names = Object.keys(server.headers ?? {});
        if (names.length) lines.push(`En-têtes : ${names.join(", ")}`);
    }

    lines.push("Ce programme tournera sur ta machine avec tes droits. Autoriser ce serveur ?");
    return lines.join("\n");
}

/**
 * Statut sans rien demander : "approved" (scopes local et user, ou réponse « oui »), "rejected",
 * "pending" ou "untrusted" (dossier pas de confiance ou absent).
 */
async function statusOf(workspace, server, { isTrusted = defaultIsTrusted } = {}) {
    if (server.scope !== "project") return STATUS.approved;
    if (!workspace || !(await isTrusted(workspace))) return STATUS.untrusted;
    return getDecision(workspace, server);
}

// Une seule question à la fois par serveur (deux appels simultanés partagent la réponse).
const asking = new Map();

/**
 * Comme statusOf, mais pose la question si le serveur est en attente et qu'une interface est fournie
 * (`ui.confirm`). Sans interface (ex. `frst mcp list`), le statut reste "pending" : rien ne démarre.
 * Un refus est mémorisé ; seul `reset-project-choices` (ou une modification de la définition) le lève.
 */
async function ensureApproved(workspace, server, { ui = null, isTrusted = defaultIsTrusted } = {}) {
    const status = await statusOf(workspace, server, { isTrusted });
    if (status !== STATUS.pending || !ui || typeof ui.confirm !== "function") return status;

    const key = `${projectKey(workspace)}\0${server.name}\0${fingerprint(server)}`;
    if (asking.has(key)) return asking.get(key);

    const pending = (async () => {
            const yes = Boolean(await ui.confirm(describeForApproval(server)));
            const decision = yes ? STATUS.approved : STATUS.rejected;
        await setDecision(workspace, server, decision);
        return decision;
    })();

    asking.set(key, pending);
    try {
        return await pending;
    } finally {
        asking.delete(key);
    }
}

module.exports = {
    FILE_NAME,
    STATUS,
    approvalsFile,
    projectKey,
    fingerprint,
    getDecision,
    setDecision,
    resetProjectChoices,
    describeForApproval,
    statusOf,
    ensureApproved
};
