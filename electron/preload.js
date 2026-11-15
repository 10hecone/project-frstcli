"use strict";

/**
 * Preload : seule passerelle entre la page (React) et le processus principal.
 * Expose window.frst, une API minimale et typée par usage (pas d'ipcRenderer brut).
 *
 * Construit par scripts/build-gui.js vers dist/gui/preload.js : le bac à sable
 * d'Electron n'autorise pas les require relatifs, d'où le bundle.
 */

const { contextBridge, ipcRenderer } = require("electron");
const { CHANNELS } = require("../src/gui/channels");

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const ids = (list) => (Array.isArray(list) ? list.map((id) => String(id ?? "")).filter(Boolean) : []);

contextBridge.exposeInMainWorld("frst", {
    // ---- Session ----
    start: () => invoke(CHANNELS.START),
    snapshot: () => invoke(CHANNELS.SNAPSHOT),
    submit: (text, files) => invoke(CHANNELS.SUBMIT, String(text ?? ""), ids(files)),
    answer: (id, value) => invoke(CHANNELS.ANSWER, Number(id), String(value ?? "")),
    interrupt: () => invoke(CHANNELS.INTERRUPT),

    // ---- Barre latérale et barre de chat ----
    info: () => invoke(CHANNELS.INFO),
    listChats: (options = {}) =>
        invoke(CHANNELS.CHATS, {
            projectId: options.projectId ? String(options.projectId) : null,
            cursor: options.cursor ? String(options.cursor) : null,
            query: String(options.query ?? "")
        }),
    openChat: (id) => invoke(CHANNELS.OPEN_CHAT, String(id ?? "")),
    newThread: () => invoke(CHANNELS.NEW_THREAD),
    listProjects: () => invoke(CHANNELS.PROJECTS),
    selectProject: (id) => invoke(CHANNELS.SELECT_PROJECT, id ? String(id) : null),
    usage: () => invoke(CHANNELS.USAGE),
    listSkills: () => invoke(CHANNELS.SKILLS),
    toggleSkill: (id, enabled, shared) =>
        invoke(CHANNELS.TOGGLE_SKILL, String(id ?? ""), Boolean(enabled), Boolean(shared)),
    setModel: (id) => invoke(CHANNELS.SET_MODEL, Number(id)),
    pickFiles: () => invoke(CHANNELS.PICK_FILES),

    // ---- Résultat des actions, intégration à la fenêtre ----
    platform: process.platform,
    listChanges: () => invoke(CHANNELS.CHANGES),
    undoChange: (id) => invoke(CHANNELS.UNDO_CHANGE, String(id ?? "")),
    undoTurn: (turn) =>
        invoke(CHANNELS.UNDO_TURN, { count: Number(turn?.count) || 0, lastAt: String(turn?.lastAt ?? "") }),
    openPath: (path) => invoke(CHANNELS.OPEN_PATH, String(path ?? "")),
    attention: (payload) =>
        invoke(CHANNELS.ATTENTION, {
            kind: String(payload?.kind ?? ""),
            title: String(payload?.title ?? ""),
            body: String(payload?.body ?? "")
        }),
    zoom: (action) => invoke(CHANNELS.ZOOM, String(action ?? "")),
    setAppearance: (options) =>
        invoke(CHANNELS.APPEARANCE, {
            theme: options?.theme === "light" ? "light" : "dark",
            transparency: options?.transparency !== false
        }),

    /** Abonnement aux changements de zoom (raccourcis clavier gérés par le processus principal). */
    onZoomChanged(listener) {
        if (typeof listener !== "function") return () => {};
        const handler = (_event, factor) => listener(Number(factor) || 1);
        ipcRenderer.on(CHANNELS.ZOOM_CHANGED, handler);
        return () => ipcRenderer.removeListener(CHANNELS.ZOOM_CHANGED, handler);
    },

    /** Abonnement aux actions du store ; renvoie la fonction de désabonnement. */
    onAction(listener) {
        if (typeof listener !== "function") return () => {};
        const handler = (_event, message) => listener(message);
        ipcRenderer.on(CHANNELS.ACTION, handler);
        return () => ipcRenderer.removeListener(CHANNELS.ACTION, handler);
    }
});
