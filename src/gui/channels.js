"use strict";

/**
 * Canaux IPC entre le processus principal Electron et la fenêtre.
 * Partagés par electron/ipc.js et electron/preload.js : un seul endroit à modifier.
 */
const CHANNELS = Object.freeze({
    // Fenêtre → processus principal (ipcRenderer.invoke) : session
    START: "frst:start",
    SNAPSHOT: "frst:snapshot",
    SUBMIT: "frst:submit",
    ANSWER: "frst:answer",
    INTERRUPT: "frst:interrupt",

    // Fenêtre → processus principal : barre latérale et barre de chat
    INFO: "frst:info",
    CHATS: "frst:chats",
    OPEN_CHAT: "frst:open-chat",
    NEW_THREAD: "frst:new-thread",
    PROJECTS: "frst:projects",
    SELECT_PROJECT: "frst:select-project",
    USAGE: "frst:usage",
    SKILLS: "frst:skills",
    TOGGLE_SKILL: "frst:toggle-skill",
    SET_MODEL: "frst:set-model",
    PICK_FILES: "frst:pick-files",

    // Fenêtre → processus principal : modifications de fichiers et chemins
    CHANGES: "frst:changes",
    UNDO_CHANGE: "frst:undo-change",
    UNDO_TURN: "frst:undo-turn",
    OPEN_PATH: "frst:open-path",

    // Fenêtre → processus principal : intégration au système
    ATTENTION: "frst:attention",
    ZOOM: "frst:zoom",
    APPEARANCE: "frst:appearance",

    // Processus principal → fenêtre (webContents.send)
    ACTION: "frst:action",
    ZOOM_CHANGED: "frst:zoom-changed"
});

module.exports = { CHANNELS };
