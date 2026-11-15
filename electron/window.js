"use strict";

/**
 * Création de la fenêtre principale, avec une configuration sécurisée :
 * isolation du contexte, pas de Node dans la page, bac à sable activé.
 * La page n'accède au système que via l'API exposée par preload.js.
 *
 * Barre de titre personnalisée (titleBarStyle "hidden" + titleBarOverlay : les boutons système
 * restent natifs, la page dessine le reste) ; taille, position, état maximisé, zoom et apparence
 * sont mémorisés dans <userData>/window-state.json.
 */

const fs = require("node:fs");
const path = require("node:path");
const { BrowserWindow, app, screen, shell } = require("electron");
const { sanitizeState, buildState, clampZoom } = require("../src/gui/window-state");
const { windowAppearance, normalizeTheme } = require("../src/gui/appearance");

// Fichiers produits par scripts/build-gui.js.
const GUI_DIR = path.join(__dirname, "..", "dist", "gui");
const INDEX_HTML = path.join(GUI_DIR, "index.html");
const PRELOAD = path.join(GUI_DIR, "preload.js");

// Logo de l'application : barre des tâches, Alt+Tab, fenêtre (Windows et Linux).
const ICON_PATH = path.join(__dirname, "..", "assets", "logo.png");

const DEFAULT_SIZE = { width: 1240, height: 800 };
const SAVE_DELAY_MS = 400;

function guiBuilt() {
    return fs.existsSync(INDEX_HTML) && fs.existsSync(PRELOAD);
}

function stateFile() {
    return path.join(app.getPath("userData"), "window-state.json");
}

function readRaw() {
    try {
        return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    } catch {
        return null;
    }
}

function writeRaw(data) {
    try {
        fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
        fs.writeFileSync(stateFile(), JSON.stringify(data, null, 2));
    } catch {
        // Mémoriser la fenêtre n'est jamais bloquant.
    }
}

/** Apparence mémorisée (thème + transparence), pour créer la fenêtre sans flash de couleur. */
function readAppearance(raw) {
    const saved = raw && typeof raw.appearance === "object" && raw.appearance ? raw.appearance : {};
    return { theme: normalizeTheme(saved.theme), transparency: saved.transparency !== false };
}

/** Applique l'apparence à une fenêtre existante (appelé aussi depuis l'IPC). */
function applyAppearance(win, options) {
    if (!win || win.isDestroyed()) return null;
    const look = windowAppearance(options);
    win.setBackgroundColor(look.backgroundColor);
    if (process.platform === "win32") {
        if (typeof win.setBackgroundMaterial === "function") win.setBackgroundMaterial(look.backgroundMaterial);
        if (typeof win.setTitleBarOverlay === "function") win.setTitleBarOverlay(look.titleBarOverlay);
    }
    return look;
}

/** Mémorise un fragment de l'état (zoom, apparence) en conservant le reste du fichier. */
function patchState(patch) {
    writeRaw({ ...(readRaw() || {}), ...patch });
}

function getSavedZoom() {
    const raw = readRaw();
    return clampZoom(raw ? raw.zoom : 1);
}

function createMainWindow() {
    const raw = readRaw();
    const displays = screen.getAllDisplays();
    const saved = sanitizeState(raw, displays, DEFAULT_SIZE);
    const look = windowAppearance(readAppearance(raw));

    const win = new BrowserWindow({
        width: saved.width,
        height: saved.height,
        ...(saved.x !== undefined ? { x: saved.x, y: saved.y } : {}),
        minWidth: 720,
        minHeight: 480,
        title: "FranceStudent Code",
        ...(fs.existsSync(ICON_PATH) ? { icon: ICON_PATH } : {}),
        // Windows 11 : matériau acrylique sous la page (thème verre) ; ailleurs, fond plein.
        backgroundColor: look.backgroundColor,
        ...(process.platform === "win32" ? { backgroundMaterial: look.backgroundMaterial } : {}),
        // Barre de titre dessinée par la page ; boutons système natifs en surimpression.
        titleBarStyle: "hidden",
        ...(process.platform === "darwin" ? { trafficLightPosition: { x: 14, y: 13 } } : { titleBarOverlay: look.titleBarOverlay }),
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            preload: PRELOAD,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    if (saved.maximized) win.maximize();

    // Taille et position « normales » : on ignore les valeurs pendant la maximisation ou le plein écran.
    let timer = null;
    const persist = () => {
        if (win.isDestroyed()) return;
        const bounds = win.isMaximized() || win.isFullScreen() || win.isMinimized() ? win.getNormalBounds() : win.getBounds();
        const zoom = win.webContents.isDestroyed() ? 1 : win.webContents.getZoomFactor();
        patchState(buildState({ bounds, maximized: win.isMaximized(), zoom }));
    };
    const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(persist, SAVE_DELAY_MS);
    };
    win.on("resize", schedule);
    win.on("move", schedule);
    win.on("maximize", schedule);
    win.on("unmaximize", schedule);
    win.on("close", () => {
        clearTimeout(timer);
        persist();
    });

    // Le zoom mémorisé est réappliqué à chaque chargement de la page.
    win.webContents.on("did-finish-load", () => win.webContents.setZoomFactor(saved.zoom));

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

    module.exports = { createMainWindow, guiBuilt, applyAppearance, patchState, getSavedZoom, GUI_DIR, ICON_PATH };
