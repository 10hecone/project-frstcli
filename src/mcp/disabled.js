"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { CONFIG } = require("../config");
const { writeJsonFile } = require("../tools/core/atomic");
const { projectKey } = require("./approvals");

/*
 * Serveurs MCP désactivés (/mcp disable <nom>), par dossier ouvert.
 * La définition reste dans son scope : seul le démarrage est bloqué.
 *
 * Fichier : ~/.francestudent-cli/mcp-disabled.json (0o600)
 *   { version: 1, projects: { "<clé du dossier>" | "*": ["nom", …] } }
 * « * » : aucun dossier ouvert (serveurs du scope user seulement).
 */

const FILE_NAME = "mcp-disabled.json";

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

const disabledFile = () => path.join(CONFIG.dataDir, FILE_NAME);
const keyOf = root => (root ? projectKey(root) : "*");

async function readStore() {
    try {
        const raw = JSON.parse((await fs.readFile(disabledFile(), "utf8")).replace(/^\uFEFF/, ""));
        const projects = isObject(raw) && isObject(raw.projects) ? raw.projects : {};
        return { version: 1, projects };
    } catch {
        // Absent ou illisible : rien n'est désactivé.
        return { version: 1, projects: {} };
    }
}

function namesOf(store, root) {
    const list = store.projects[keyOf(root)];
    return Array.isArray(list) ? list.filter(name => typeof name === "string") : [];
}

// Les écritures d'un même processus passent l'une après l'autre : pas de mise à jour perdue.
let chain = Promise.resolve();
function exclusive(task) {
    const run = chain.then(task);
    chain = run.catch(() => {});
    return run;
}

/** Noms des serveurs désactivés pour ce dossier. */
async function listDisabled(root) {
    return namesOf(await readStore(), root);
}

/** Vrai si le serveur est désactivé pour ce dossier (signature attendue par createMcpManager). */
async function isDisabled(server, root) {
    const name = typeof server === "string" ? server : server?.name;
    return (await listDisabled(root)).includes(name);
}

/** Désactive (true) ou réactive (false) un serveur. Renvoie false si rien n'a changé. */
function setDisabled(root, name, disabled) {
    return exclusive(async () => {
        const store = await readStore();
        const key = keyOf(root);
        const names = namesOf(store, root);
        const present = names.includes(name);

        if (present === Boolean(disabled)) return false;

        const next = disabled ? [...names, name].sort() : names.filter(item => item !== name);
        if (next.length) store.projects[key] = next;
        else delete store.projects[key];

        await writeJsonFile(disabledFile(), store);
        return true;
    });
}

module.exports = { FILE_NAME, disabledFile, listDisabled, isDisabled, setDisabled };
