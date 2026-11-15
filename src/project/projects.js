"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { CONFIG } = require("../config");
const { ui } = require("../ui-bridge");

/*
 * Projets connus du CLI, enregistrés dans CONFIG.dataDir/projects.json
 * (~/.francestudent-cli par défaut, jamais dans le projet ouvert). Un projet = une conversation chat + une conversation agent.
 * Forme : { "<clé>": { path, trusted, createdAt, lastOpenedAt, conversations: { chat, agent } } }
 * avec chat / agent = { id, settings, updatedAt } ou null.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
// Ancien emplacement (racine du dépôt du CLI) : relu s'il n'y a rien dans dataDir, puis recopié, jamais supprimé.
const LEGACY_FILE = path.join(REPO_ROOT, "projects.json");
const FILE = path.join(CONFIG.dataDir, "projects.json");

let projects = null;
let saving = Promise.resolve();

function keyOf(workspace) {
    const resolved = path.resolve(workspace);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function emptyConversations() {
    return { chat: null, agent: null };
}

/** Lit un fichier JSON : found vaut false seulement si le fichier n'existe pas. */
async function readStore(file) {
    try {
        return { found: true, data: JSON.parse(await fs.readFile(file, "utf8")) };
    } catch (error) {
        return { found: Boolean(error && error.code !== "ENOENT"), data: null };
    }
}

async function load() {
    if (projects) return projects;

    let { found, data } = await readStore(FILE);
    let migrate = false;
    if (!found) {
        ({ found, data } = await readStore(LEGACY_FILE));
        migrate = found && data !== null;
    }

    // Première utilisation ou fichier illisible : aucun projet.
    projects = data && typeof data === "object" && !Array.isArray(data) ? data : {};
    if (migrate) await save();

    return projects;
}

function save() {
    const data = JSON.stringify(projects, null, 2);

    saving = saving.then(async () => {
        try {
            await fs.mkdir(path.dirname(FILE), { recursive: true, mode: 0o700 });
            const tmp = `${FILE}.${process.pid}.tmp`;
            await fs.writeFile(tmp, data, { mode: 0o600 });
            await fs.rename(tmp, FILE);
        } catch (error) {
            ui.warn(`projects.json non enregistré : ${error.message}`);
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
    // open() n'est appelé qu'une fois la confiance accordée (workspace.open).
    project.trusted = true;
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

module.exports = { open, get, setConversation, readStore, FILE, LEGACY_FILE, REPO_ROOT };
