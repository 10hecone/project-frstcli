"use strict";

/**
 * Dossiers de l'interface graphique : récents, ouverture, fermeture, confiance, sessions.
 *
 * Ne dépend pas d'Electron. Toutes les dépendances sont injectables (tests) :
 * projects, detectEnvironment, stateModule, workspaceCore.
 * Toute ouverture passe par workspace.open() : rien n'écrit state.workspace ici.
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const { workspace, trustMessage } = require("../core/workspace");

const RECENT_LIMIT = 12;

function createFolders({
    backend,
    refresh = () => {},
    isRunning = () => false,
    projects = null,
    detectEnvironment = null,
    stateModule = null,
    workspaceCore = workspace
} = {}) {
    const store = () => projects || require("../project/projects");
    const detect = () => detectEnvironment || require("../project/short-context").detectEnvironment;
    const st = () => stateModule || require("../state");

    function ensureIdle() {
        if (isRunning()) throw new Error("Une demande est en cours : attends la fin ou interromps-la.");
    }

    /** Chemin réel d'un dossier existant (la clé de projects.json en dépend). */
    async function resolveDir(input) {
        const dir = String(input ?? "").trim();
        if (!dir) throw new Error("Dossier manquant.");
        const real = await fs.realpath(path.resolve(dir));
        if (!(await fs.stat(real)).isDirectory()) throw new Error("Ce chemin n'est pas un dossier.");
        return real;
    }

    async function branchOf(dir) {
        try {
            return (await detect()(dir))?.git?.branch || null;
        } catch {
            return null;
        }
    }

    /** Dossiers connus, du plus récent au plus ancien : { name, path, branch, sessions, lastOpenedAt, trusted }. */
    async function recent() {
        const known = (await store().list()).filter((project) => project && project.path).slice(0, RECENT_LIMIT);
        return Promise.all(
            known.map(async (project) => ({
                name: path.basename(project.path) || project.path,
                path: project.path,
                branch: await branchOf(project.path),
                sessions: Array.isArray(project.sessions) ? project.sessions.length : 0,
                lastOpenedAt: project.lastOpenedAt || null,
                trusted: Boolean(project.trusted)
            }))
        );
    }

    // Le transcript est vidé après l'ouverture : il réaffiche l'accueil du nouveau dossier.
    function resetView() {
        const { state } = st();
        state.contextUsagePercent = null;
        state.contextDetails = null;
        state.pendingFiles = [];
        backend.clear();
        refresh();
    }

    /**
     * Ouvre un dossier dans une nouvelle session. Un dossier sans confiance n'est pas ouvert :
     * on renvoie { needsTrust, message } pour que la fenêtre affiche le dialogue de confiance.
     */
    async function open(input) {
        ensureIdle();
        const real = await resolveDir(input);
        const known = await store().get(real);
        if (!(known && known.trusted)) {
            return { ok: false, needsTrust: true, path: real, message: trustMessage(real) };
        }

        if (!(await workspaceCore.open(real))) return { ok: false, reason: "Dossier non ouvert." };
        resetView();
        return { ok: true, path: real };
    }

    function close() {
        ensureIdle();
        workspaceCore.close();
        resetView();
        return { ok: true };
    }

    /** Mémorise la confiance accordée ; l'ouverture reste une action séparée. */
    async function trust(input) {
        const real = await resolveDir(input);
        await store().trust(real);
        return { ok: true, path: real };
    }

    /** Sessions d'un dossier, la plus récente en premier : { id, title, updatedAt }. */
    async function sessions(input) {
        const project = await store().get(await resolveDir(input));
        const list = project && Array.isArray(project.sessions) ? project.sessions : [];
        return list.map((session) => ({
            id: String(session.id),
            title: session.title || "Sans titre",
            updatedAt: session.updatedAt || null
        }));
    }

    return { recent, open, close, trust, sessions };
}

module.exports = { createFolders, RECENT_LIMIT };
