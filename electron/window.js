"use strict";

/**
 * Création de la fenêtre principale, avec une configuration sécurisée :
 * isolation du contexte, pas de Node dans la page, bac à sable activé.
 * La page n'accède au système que via l'API exposée par preload.js.
 */

const fs = require("node:fs");
const path = require("node:path");
const { BrowserWindow, shell } = require("electron");

// Fichiers produits par scripts/build-gui.js.
const GUI_DIR = path.join(__dirname, "..", "dist", "gui");
const INDEX_HTML = path.join(GUI_DIR, "index.html");
const PRELOAD = path.join(GUI_DIR, "preload.js");

function guiBuilt() {
    return fs.existsSync(INDEX_HTML) && fs.existsSync(PRELOAD);
}

function createMainWindow() {
    const win = new BrowserWindow({
        width: 1100,
        height: 760,
        minWidth: 720,
        minHeight: 480,
        title: "FranceStudent Code",
        backgroundColor: "#0f1115",
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            preload: PRELOAD,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    win.once("ready-to-show", () => win.show());

    // Liens externes : navigateur par défaut, jamais dans la fenêtre de l'application.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) shell.openExternal(url);
        return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event) => event.preventDefault());

    // Outils de développement : FRST_GUI_DEVTOOLS=1.
    if (process.env.FRST_GUI_DEVTOOLS === "1") {
        win.webContents.once("did-finish-load", () => win.webContents.openDevTools({ mode: "detach" }));
    }

    win.loadFile(INDEX_HTML);
    return win;
}

module.exports = { createMainWindow, guiBuilt, GUI_DIR };
