"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { CONFIG } = require("../config");
const { state } = require("../state");
const { auth, getAccessToken } = require("./auth");

/*
 * Projets FranceStudent (https://ia.francestudent.org/projects), via l'API :
 * GET /projects -> ProjectDto[] ; POST /projects { name } -> ProjectDto.
 * Le projet choisi avec /fr-project est mémorisé dans dataDir/fr-project.json
 * et rattaché (projectId) à chaque nouvelle conversation.
 */

const FILE = path.join(CONFIG.dataDir, "fr-project.json");
const MAX_NAME_CHARS = 255;

async function requestJson(method, route, body, retried = false) {
    const token = await getAccessToken(retried);
    const response = await fetch(`${CONFIG.apiUrl}${route}`, {
        method,
        headers: {
            Accept: "application/json",
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
            Authorization: `Bearer ${token}`,
            "User-Agent": CONFIG.userAgent,
            "francestudent-client-platform": CONFIG.clientPlatform,
            "francestudent-client-version": CONFIG.clientVersion,
            "francestudent-device-id": auth.deviceId,
            Origin: CONFIG.origin,
            Referer: `${CONFIG.origin}/`
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000)
    });

    if (response.status === 401 && !retried) return requestJson(method, route, body, true);
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        const error = new Error(`HTTP ${response.status} sur ${method} ${route}${text ? ` : ${text.slice(0, 300)}` : ""}`);
        error.status = response.status;
        throw error;
    }

    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        const error = new Error(`Réponse illisible sur ${method} ${route} (JSON attendu).`);
        error.status = response.status;
        throw error;
    }
}

async function listProjects() {
    const data = await requestJson("GET", "/projects");
    return Array.isArray(data) ? data : [];
}

const createProject = name => requestJson("POST", "/projects", { name });

const normalizeName = name => String(name || "").trim().toLocaleLowerCase("fr-FR");

/** Cherche un projet par nom (sans tenir compte de la casse) ; le crée s'il n'existe pas. */
async function findOrCreateProject(name) {
    const clean = String(name || "").trim();
    if (!clean) throw new Error("Nom de projet vide.");
    if (clean.length > MAX_NAME_CHARS) {
        throw new Error(`Nom de projet trop long (${MAX_NAME_CHARS} caractères au maximum).`);
    }

    const wanted = normalizeName(clean);
    const existing = (await listProjects()).find(project => normalizeName(project?.name) === wanted);
    if (existing) return { project: existing, created: false };

    const project = await createProject(clean);
    if (!project || !project.id) throw new Error("L'API n'a pas renvoyé l'identifiant du projet créé.");
    return { project, created: true };
}

/** Recharge le projet FranceStudent mémorisé dans state.frProject. */
async function loadSelected() {
    try {
        const raw = JSON.parse(await fs.readFile(FILE, "utf8"));
        if (raw && typeof raw.id === "string" && raw.id) {
            state.frProject = { id: raw.id, name: String(raw.name || "") };
        }
    } catch {
        // aucun projet mémorisé ou fichier illisible
    }
    return state.frProject || null;
}

/** Mémorise (ou oublie avec null) le projet FranceStudent utilisé pour les nouvelles conversations. */
async function saveSelected(project) {
    state.frProject = project ? { id: project.id, name: String(project.name || "") } : null;

    if (!state.frProject) {
        await fs.rm(FILE, { force: true });
        return null;
    }

    await fs.mkdir(CONFIG.dataDir, { recursive: true, mode: 0o700 });
    const tmp = `${FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state.frProject, null, 2), { mode: 0o600 });
    await fs.rename(tmp, FILE);
    return state.frProject;
}

/** Rattache (ou déplace) un chat au projet : PUT /projects/{projectId}/chats/{chatId}. */
const attachChat = (projectId, chatId) =>
    requestJson("PUT", `/projects/${encodeURIComponent(projectId)}/chats/${encodeURIComponent(chatId)}`);

const attached = new Set();

/** Rattache le chat au projet sélectionné, une seule fois par couple projet/chat. Ne lève jamais. */
async function ensureAttached(chatId) {
    const projectId = state.frProject?.id;
    if (!projectId || !chatId) return false;

    const key = `${projectId}:${chatId}`;
    if (attached.has(key)) return true;

    try {
        await attachChat(projectId, chatId);
        attached.add(key);
        return true;
    } catch {
        return false;
    }
}

module.exports = {
    listProjects,
    createProject,
    attachChat,
    ensureAttached,
    findOrCreateProject,
    loadSelected,
    saveSelected,
    FILE,
    MAX_NAME_CHARS
};
