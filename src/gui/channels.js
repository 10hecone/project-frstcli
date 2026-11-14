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

    // Processus principal → fenêtre (webContents.send)
    ACTION: "frst:action"
});

module.exports = { CHANNELS };
