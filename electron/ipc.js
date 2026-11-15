"use strict";

/**
 * Liaison IPC entre la fenêtre et l'hôte de session (src/gui/host.js), les services de
 * l'espace de travail (src/gui/workspace.js) et les modifications de fichiers (src/gui/changes.js).
 * Ce fichier ne contient presque aucune logique métier : il traduit les canaux
 * (src/gui/channels.js) en appels. Ce qui a besoin d'Electron (dialogue de fichiers, ouverture
 * de chemins, alertes, zoom, apparence) passe par des modules dédiés ou reste ici, en une ligne.
 */

const { dialog, ipcMain, shell } = require("electron");
const { CHANNELS } = require("../src/gui/channels");
const { createGuiHost } = require("../src/gui/host");
const { createWorkspace } = require("../src/gui/workspace");
const { createFolders } = require("../src/gui/folders");
const { createChanges } = require("../src/gui/changes");
const { openWorkspacePath } = require("../src/gui/paths");
const { nextZoom, zoomActionForInput } = require("../src/gui/window-state");
const { createAttention } = require("./attention");
const { applyAppearance, patchState } = require("./window");

const MAX_PICKED_FILES = 10;

function registerIpc(win, { onExit = null, initialFolder = null } = {}) {
    const send = (message) => {
        if (win.isDestroyed() || win.webContents.isDestroyed()) return;
        win.webContents.send(CHANNELS.ACTION, message);
    };

    // La branche git est lue par l'espace de travail, le bilan des modifications par `changes`
    // (tous deux créés juste après l'hôte).
    let workspace = null;
    let changes = null;
    const host = createGuiHost({
        send,
        onExit,
        statusExtra: async () => ({ branch: workspace ? await workspace.branch() : null }),
        summarizeChanges: (count) => (changes ? changes.summarize(count) : null)
    });
    workspace = createWorkspace({
        backend: host.backend,
        refresh: () => host.syncStatus(),
        isRunning: () => host.isRunning()
    });
    const folders = createFolders({
        backend: host.backend,
        refresh: () => host.syncStatus(),
        isRunning: () => host.isRunning()
    });
    changes = createChanges({
        isRunning: () => host.isRunning(),
        notify: (text) => host.backend.store.dispatch({ type: "append", entry: { type: "info", text } })
    });
    const attention = createAttention(win);

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

    /** Sélecteur de dossier natif puis ouverture : { ok, path } ou { needsTrust, path, message } ou { cancelled }. */
    async function pickFolder() {
        const result = await dialog.showOpenDialog(win, {
            title: "Ouvrir un dossier",
            buttonLabel: "Ouvrir",
            properties: ["openDirectory"]
        });
        if (result.canceled || !result.filePaths.length) return { ok: false, cancelled: true };
        return folders.open(result.filePaths[0]);
    }

    /** Ouvre un chemin du projet (jamais hors du projet ; les exécutables sont seulement montrés). */
    function openPath(input) {
        const root = require("../src/core/workspace").workspace.root;
        return openWorkspacePath(root, input, shell);
    }

    /** Applique un zoom (facteur borné, mémorisé) et le renvoie. */
    function applyZoom(action) {
        const contents = win.webContents;
        const factor = nextZoom(contents.getZoomFactor(), action);
        contents.setZoomFactor(factor);
        patchState({ zoom: factor });
        if (!contents.isDestroyed()) contents.send(CHANNELS.ZOOM_CHANGED, factor);
        return factor;
    }

    /** Thème et transparence : barre de titre, fond et matériau de la fenêtre ; mémorisés. */
    function setAppearance(options) {
        const theme = options && options.theme;
        const transparency = !options || options.transparency !== false;
        const look = applyAppearance(win, { theme, transparency });
        if (!look) return { ok: false };
        patchState({ appearance: { theme: look.theme, transparency } });
        return { ok: true, theme: look.theme, glass: look.glass };
    }

    // Les raccourcis de zoom sont interceptés ici pour ne pas être traités deux fois
    // (menu par défaut d'Electron + page).
    const onInput = (event, input) => {
        const action = zoomActionForInput(input);
        if (!action) return;
        event.preventDefault();
        applyZoom(action);
    };
    win.webContents.on("before-input-event", onInput);

    // Dossier demandé au lancement : envoyé une fois la session démarrée (la page écoute alors déjà).
    let pendingFolder = initialFolder;

    /** Demande à la page d'ouvrir un dossier : même parcours que le sélecteur, confiance comprise. */
    function requestFolder(dir) {
        if (!dir || win.isDestroyed() || win.webContents.isDestroyed()) return;
        win.webContents.send(CHANNELS.FOLDER_REQUESTED, String(dir));
    }

    async function start() {
        const result = await host.start();
        if (pendingFolder) {
            requestFolder(pendingFolder);
            pendingFolder = null;
        }
        return result;
    }

    const handlers = {
        [CHANNELS.START]: () => start(),
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
        [CHANNELS.PICK_FILES]: () => pickFiles(),
        [CHANNELS.PASTE_IMAGE]: (data, mime) => workspace.uploadImage(data, mime),

        [CHANNELS.PICK_FOLDER]: () => pickFolder(),
        [CHANNELS.OPEN_FOLDER]: (dir) => folders.open(dir),
        [CHANNELS.CLOSE_FOLDER]: () => folders.close(),
        [CHANNELS.RECENT_FOLDERS]: () => folders.recent(),
        [CHANNELS.TRUST_FOLDER]: (dir) => folders.trust(dir),
        [CHANNELS.FOLDER_SESSIONS]: (dir) => folders.sessions(dir),
        [CHANNELS.SET_PERMISSION_MODE]: (mode) => workspace.setPermissionMode(mode),

        [CHANNELS.CHANGES]: () => changes.list(),
        [CHANNELS.UNDO_CHANGE]: (id) => changes.undoFile(id),
        [CHANNELS.UNDO_TURN]: (turn) => changes.undoTurn(turn || {}),
        [CHANNELS.OPEN_PATH]: (input) => openPath(input),
        [CHANNELS.ATTENTION]: (payload) => ({ shown: attention.notify(payload) }),
        [CHANNELS.ZOOM]: (action) => applyZoom(action),
        [CHANNELS.APPEARANCE]: (options) => setAppearance(options)
    };

    for (const [channel, handler] of Object.entries(handlers)) {
        ipcMain.handle(channel, guard(handler));
    }

    return {
        host,
        workspace,
        folders,
        changes,
        requestFolder,
        dispose() {
            for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel);
            if (!win.isDestroyed()) win.webContents.removeListener("before-input-event", onInput);
            host.dispose();
        }
    };
}

module.exports = { registerIpc };
