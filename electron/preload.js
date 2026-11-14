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

contextBridge.exposeInMainWorld("frst", {
    start: () => ipcRenderer.invoke(CHANNELS.START),
    snapshot: () => ipcRenderer.invoke(CHANNELS.SNAPSHOT),
    submit: (text) => ipcRenderer.invoke(CHANNELS.SUBMIT, String(text ?? "")),
    answer: (id, value) => ipcRenderer.invoke(CHANNELS.ANSWER, Number(id), String(value ?? "")),
    interrupt: () => ipcRenderer.invoke(CHANNELS.INTERRUPT),

    /** Abonnement aux actions du store ; renvoie la fonction de désabonnement. */
    onAction(listener) {
        if (typeof listener !== "function") return () => {};
        const handler = (_event, message) => listener(message);
        ipcRenderer.on(CHANNELS.ACTION, handler);
        return () => ipcRenderer.removeListener(CHANNELS.ACTION, handler);
    }
});
