"use strict";

/**
 * Liaison IPC entre la fenêtre et l'hôte de session (src/gui/host.js) et les
 * services de l'espace de travail (src/gui/workspace.js).
 * Ce fichier ne contient aucune logique métier : il traduit seulement les canaux
 * (src/gui/channels.js) en appels à l'hôte. Seule exception : la boîte de dialogue
 * de choix de fichiers, qui a besoin d'Electron.
 */

const { dialog, ipcMain } = require("electron");
const { CHANNELS } = require("../src/gui/channels");
const { createGuiHost } = require("../src/gui/host");
const { createWorkspace } = require("../src/gui/workspace");

const MAX_PICKED_FILES = 10;

function registerIpc(win, { onExit = null } = {}) {
    const send = (message) => {
        if (win.isDestroyed() || win.webContents.isDestroyed()) return;
        win.webContents.send(CHANNELS.ACTION, message);
    };

    // La branche git est lue par l'espace de travail (créé juste après l'hôte).
    let workspace = null;
    const host = createGuiHost({
        send,
        onExit,
        statusExtra: async () => ({ branch: workspace ? await workspace.branch() : null })
    });
    workspace = createWorkspace({
        backend: host.backend,
        refresh: () => host.syncStatus(),
        isRunning: () => host.isRunning()
    });

    // Seule la fenêtre principale peut piloter la session.
    const guard =
        (handler) =>
        (event, ...args) => {
            if (win.isDestroyed() || event.sender !== win.webContents) {
                throw new Error("Origine IPC refusée.");
            }
            return handler(...args);
        };

    /** Choix de fichiers locaux puis envoi (Files v2) : { files, errors, cancelled }. */
    async function pickFiles() {
        const result = await dialog.showOpenDialog(win, {
            title: "Joindre des fichiers",
            buttonLabel: "Joindre",
            properties: ["openFile", "multiSelections"]
        });
        if (result.canceled || !result.filePaths.length) return { files: [], errors: [], cancelled: true };
        const paths = result.filePaths.slice(0, MAX_PICKED_FILES);
        const uploaded = await workspace.uploadFiles(paths);
        if (result.filePaths.length > MAX_PICKED_FILES) {
            uploaded.errors.push(`${MAX_PICKED_FILES} fichiers au maximum par envoi.`);
        }
        return { ...uploaded, cancelled: false };
    }

    const handlers = {
        [CHANNELS.START]: () => host.start(),
        [CHANNELS.SNAPSHOT]: () => host.snapshot(),
        [CHANNELS.SUBMIT]: (text, files) => host.submit(text, files),
        [CHANNELS.ANSWER]: (id, value) => host.answer(id, value),
        [CHANNELS.INTERRUPT]: () => host.interrupt(),

        [CHANNELS.INFO]: () => workspace.info(),
        [CHANNELS.CHATS]: (options) => workspace.listChats(options || {}),
        [CHANNELS.OPEN_CHAT]: (id) => workspace.openChat(id),
        [CHANNELS.NEW_THREAD]: () => workspace.newThread(),
        [CHANNELS.PROJECTS]: () => workspace.listProjects(),
        [CHANNELS.SELECT_PROJECT]: (id) => workspace.selectProject(id),
        [CHANNELS.USAGE]: () => workspace.usage(),
        [CHANNELS.SKILLS]: () => workspace.listSkills(),
        [CHANNELS.TOGGLE_SKILL]: (id, enabled, shared) => workspace.toggleSkill(id, enabled, shared),
        [CHANNELS.SET_MODEL]: (id) => workspace.setModel(id),
        [CHANNELS.PICK_FILES]: () => pickFiles()
    };

    for (const [channel, handler] of Object.entries(handlers)) {
        ipcMain.handle(channel, guard(handler));
    }

    return {
        host,
        workspace,
        dispose() {
            for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel);
            host.dispose();
        }
    };
}

module.exports = { registerIpc };
