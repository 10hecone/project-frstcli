"use strict";

/**
 * Canaux IPC entre le processus principal Electron et la fenêtre.
 * Partagés par electron/ipc.js et electron/preload.js : un seul endroit à modifier.
 */
const CHANNELS = Object.freeze({
    // Fenêtre → processus principal (ipcRenderer.invoke)
    START: "frst:start",
    SNAPSHOT: "frst:snapshot",
    SUBMIT: "frst:submit",
    ANSWER: "frst:answer",
    INTERRUPT: "frst:interrupt",

    // Processus principal → fenêtre (webContents.send)
    ACTION: "frst:action"
});

module.exports = { CHANNELS };
