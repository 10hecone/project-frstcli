"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { ui } = require("../cli/ui");

/*
 * Projets connus du CLI, enregistrés dans projects.json à la racine de ce dépôt
 * (jamais dans le projet ouvert). Un projet = une conversation chat + une conversation agent.
 * Forme : { "<clé>": { path, createdAt, lastOpenedAt, conversations: { chat, agent } } }
 * avec chat / agent = { id, settings, updatedAt } ou null.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FILE = path.join(REPO_ROOT, "projects.json");

let projects = null;
let saving = Promise.resolve();

function keyOf(workspace) {
    const resolved = path.resolve(workspace);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function emptyConversations() {
    return { chat: null, agent: null };
}

async function load() {
    if (projects) return projects;

    try {
        const raw = JSON.parse(await fs.readFile(FILE, "utf8"));
        projects = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    } catch {
        projects = {}; // première utilisation ou fichier illisible
    }

    return projects;
}

function save() {
    const data = JSON.stringify(projects, null, 2);

    saving = saving.then(async () => {
        try {
            const tmp = `${FILE}.${process.pid}.tmp`;
            await fs.writeFile(tmp, data, { mode: 0o600 });
            await fs.rename(tmp, FILE);
        } catch (error) {
            ui.debug(`projects.json non enregistré : ${error.message}`);
        }
    });

    return saving;
}

async function get(workspace) {
    if (!workspace) return null;
    await load();
    return projects[keyOf(workspace)] || null;
}

/**
 * Ouvre un projet. S'il est inconnu, il est créé. S'il existe, il est repris tel quel,
 * sauf avec newConv : ses deux conversations sont alors oubliées.
 */
async function open(workspace, { newConv = false } = {}) {
    await load();

    const key = keyOf(workspace);
    const now = new Date().toISOString();
    const existing = projects[key] || null;

    const project = existing || { path: workspace, createdAt: now, conversations: emptyConversations() };

    project.path = workspace;
    project.lastOpenedAt = now;
    if (!project.conversations || newConv) project.conversations = emptyConversations();

    projects[key] = project;
    await save();

    return { project, created: !existing };
}

/** Mémorise la conversation (chat ou agent) d'un projet. */
async function setConversation(workspace, mode, id, settings = null) {
    if (!workspace || !id) return;
await load();

    const key = keyOf(workspace);
    const now = new Date().toISOString();
    const project = projects[key] ||
        (projects[key] = { path: workspace, createdAt: now, lastOpenedAt: now, conversations: emptyConversations() });

    if (!project.conversations) project.conversations = emptyConversations();
    project.conversations[mode === "agent" ? "agent" : "chat"] = { id, settings: settings || null, updatedAt: now };

    await save();
}

module.exports = { open, get, setConversation, FILE, REPO_ROOT };
