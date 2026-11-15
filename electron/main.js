"use strict";

/**
 * Point d'entrée Electron (processus principal) de FranceStudent Code.
 *
 * Rôle limité au cycle de vie de l'application : la fenêtre est créée par
 * window.js, la communication par ipc.js, et toute la logique métier reste
 * dans src/ (cœur partagé avec le CLI et la TUI).
 */

try {
    require("dotenv").config({ quiet: true });
} catch {
    // dotenv est facultatif.
}

const { app, BrowserWindow, dialog } = require("electron");
const { createMainWindow, guiBuilt, GUI_DIR } = require("./window");
const { registerIpc } = require("./ipc");
const { folderFromArgv } = require("../src/gui/folders");

/** Dossier passé en ligne de commande (en mode développement, argv commence par l'exécutable et le script). */
const requestedFolder = (argv, cwd) => folderFromArgv(argv, { defaultApp: process.defaultApp, cwd });

let mainWindow = null;
let ipc = null;

function boot() {
    if (!guiBuilt()) {
        dialog.showErrorBox(
            "Interface non construite",
            `Fichiers introuvables dans ${GUI_DIR}.\nLance « npm run build:gui » puis relance l'application.`
        );
        app.quit();
        return;
    }

    mainWindow = createMainWindow();
    ipc = registerIpc(mainWindow, {
        onExit: () => app.quit(),
        initialFolder: requestedFolder(process.argv, process.cwd())
    });

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

// Une seule instance : la session (jetons, mémoire du projet, jobs) n'est pas partagée entre processus.
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on("second-instance", (_event, argv, workingDirectory) => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        // Le dossier reçu s'ouvre dans la session existante ; la page demande la confiance si besoin.
        const dir = requestedFolder(argv, workingDirectory);
        if (dir && ipc) ipc.requestFolder(dir);
    });

    app.whenReady().then(boot);

    // Une seule session par application : fermer la fenêtre quitte l'application (macOS compris).
    app.on("window-all-closed", () => app.quit());

    app.on("before-quit", () => {
        if (ipc) ipc.dispose();
        ipc = null;
    });

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0 && !ipc) boot();
    });
}
