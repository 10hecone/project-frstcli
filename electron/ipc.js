"use strict";

/**
 * Liaison IPC entre la fenêtre et l'hôte de session (src/gui/host.js).
 * Ce fichier ne contient aucune logique métier : il traduit seulement les canaux
 * (src/gui/channels.js) en appels à l'hôte.
 */

const { ipcMain } = require("electron");
const { CHANNELS } = require("../src/gui/channels");
const { createGuiHost } = require("../src/gui/host");

function registerIpc(win, { onExit = null } = {}) {
    const send = (message) => {
        if (win.isDestroyed() || win.webContents.isDestroyed()) return;
        win.webContents.send(CHANNELS.ACTION, message);
    };

    const host = createGuiHost({ send, onExit });

    // Seule la fenêtre principale peut piloter la session.
    const guard =
        (handler) =>
        (event, ...args) => {
            if (win.isDestroyed() || event.sender !== win.webContents) {
                throw new Error("Origine IPC refusée.");
            }
            return handler(...args);
        };

    const handlers = {
        [CHANNELS.START]: () => host.start(),
        [CHANNELS.SNAPSHOT]: () => host.snapshot(),
        [CHANNELS.SUBMIT]: (text) => host.submit(text),
        [CHANNELS.ANSWER]: (id, value) => host.answer(id, value),
        [CHANNELS.INTERRUPT]: () => host.interrupt()
    };

    for (const [channel, handler] of Object.entries(handlers)) {
        ipcMain.handle(channel, guard(handler));
    }

    return {
        host,
        dispose() {
            for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel);
            host.dispose();
        }
    };
}

module.exports = { registerIpc };
