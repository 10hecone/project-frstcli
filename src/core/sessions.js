"use strict";

const { state, resetConversation, setConversation } = require("../state");
const { workspace } = require("./workspace");

/*
 * Sessions du dossier ouvert (projects.json) : liste et reprise.
 * Partagé par `frst -c`, `frst --resume` et la commande /resume.
 */

/** Sessions du dossier, la plus récente en premier ([] sans dossier). */
async function listSessions(root = workspace.root) {
    if (!root) return [];
    const project = await require("../project/projects").get(root);
    return project && Array.isArray(project.sessions) ? project.sessions.filter((session) => session && session.id) : [];
}

/** Retrouve une session par numéro affiché (1, 2, …) ou par id exact ; null si inconnue. */
function findSession(sessions, ref) {
    const value = String(ref ?? "").trim();
    if (!value) return null;
    const byId = sessions.find((session) => session.id === value);
    if (byId) return byId;
    if (/^\d{1,3}$/.test(value)) {
        const n = Number(value);
        if (n >= 1 && n <= sessions.length) return sessions[n - 1];
    }
    return null;
}

/** Reprend une session : la conversation suivante continue sur le serveur. */
function resumeSession(session) {
    if (!session || !session.id) return null;
    resetConversation();
    setConversation(session.id, session.settings || null);
    state.contextUsagePercent = state.contextDetails = null;
    return session;
}

/** Libellé d'une session : titre (ou id) et date de dernière activité. */
function describeSession(session) {
    const title = session.title || "(sans titre)";
    const date = String(session.updatedAt || "").slice(0, 16).replace("T", " ");
    return { title, date };
}

/**
 * Fait choisir une session à l'utilisateur si l'interface sait le faire (TUI : SessionPicker).
 * Renvoie la session choisie, null si annulé, undefined si l'interface n'a pas de sélecteur.
 */
async function chooseSession(sessions) {
    const backend = require("../ui-bridge").getUiBackend();
    if (!backend || typeof backend.chooseSession !== "function") return undefined;
    const id = await backend.chooseSession(sessions.map((session) => ({ id: session.id, ...describeSession(session) })));
    return id ? findSession(sessions, id) : null;
}

module.exports = { listSessions, findSession, resumeSession, describeSession, chooseSession };
