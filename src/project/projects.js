"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { CONFIG } = require("../config");
const { ui } = require("../ui-bridge");

/*
 * Dossiers connus du CLI, enregistrés dans CONFIG.dataDir/projects.json
 * (~/.francestudent-cli par défaut, jamais dans le dossier ouvert).
 * Forme : { "<clé>": { path, trusted, createdAt, lastOpenedAt, sessions: [{ id, title, settings, updatedAt }] } }
 * Les conversations restent sur le serveur : on ne garde que leurs identifiants, la plus récente en premier.
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

/**
 * Ancienne forme { conversations: { chat, agent } } : la conversation chat devient la première session,
 * l'ancienne conversation agent est oubliée. Renvoie true si le projet a été modifié.
 */
function migrateProject(project) {
    if (!project || typeof project !== "object" || Array.isArray(project.sessions)) return false;

    const chat = project.conversations && project.conversations.chat;
    project.sessions = chat && chat.id
        ? [{ id: chat.id, title: null, settings: chat.settings || null, updatedAt: chat.updatedAt || null }]
        : [];
    delete project.conversations;
    return true;
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
    for (const project of Object.values(projects)) {
        if (migrateProject(project)) migrate = true;
    }
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

function entryFor(workspace, now) {
    const key = keyOf(workspace);
    return projects[key] || (projects[key] = { path: workspace, createdAt: now, lastOpenedAt: now, sessions: [] });
}

/** Ouvre un dossier (créé s'il est inconnu) et le marque comme digne de confiance. */
async function open(workspace) {
    await load();

    const now = new Date().toISOString();
    const created = !projects[keyOf(workspace)];
    const project = entryFor(workspace, now);

    project.path = workspace;
    project.lastOpenedAt = now;
    // open() n'est appelé qu'une fois la confiance accordée (workspace.open).
    project.trusted = true;

    await save();

    return { project, created };
}

/**
 * Mémorise une session du dossier et la place en tête. Un titre déjà connu est gardé :
 * celui de l'API s'il a été enregistré, sinon le début du premier message.
 */
async function saveSession(workspace, { id, title = null, settings = null }) {
    if (!workspace || !id) return;
    await load();

    const now = new Date().toISOString();
    const project = entryFor(workspace, now);
    const index = project.sessions.findIndex((session) => session.id === id);
    const previous = index === -1 ? null : project.sessions.splice(index, 1)[0];

    project.sessions.unshift({
        id,
        title: (previous && previous.title) || title || null,
        settings: settings || (previous && previous.settings) || null,
        updatedAt: now
    });

    await save();
}

module.exports = { open, get, saveSession, migrateProject, readStore, FILE, LEGACY_FILE, REPO_ROOT };
