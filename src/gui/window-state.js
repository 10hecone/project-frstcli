"use strict";

/**
 * État de la fenêtre (taille, position, maximisée, zoom) : logique pure, sans Electron.
 * Le fichier est lu/écrit par electron/window.js ; ici on ne fait que valider.
 */

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

const MIN_WIDTH = 720;
const MIN_HEIGHT = 480;
// Surface minimale de la fenêtre qui doit rester visible sur un écran (en pixels).
const MIN_VISIBLE = 120;

function clampZoom(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 1;
    const rounded = Math.round(number * 100) / 100;
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, rounded));
}

/** Prochain facteur de zoom : action "in" | "out" | "reset". */
function nextZoom(current, action) {
    if (action === "reset") return 1;
    const base = clampZoom(current);
    if (action === "in") return clampZoom(base + ZOOM_STEP);
    if (action === "out") return clampZoom(base - ZOOM_STEP);
    return base;
}

/**
 * Action de zoom demandée par un raccourci clavier (événement « before-input-event »).
 * Ctrl (ou Cmd sur macOS) + « = » / « + » / « - » / « 0 », pavé numérique compris.
 * Renvoie "in" | "out" | "reset" | null.
 */
function zoomActionForInput(input) {
    if (!input || input.type !== "keyDown" || input.alt) return null;
    if (!input.control && !input.meta) return null;
    const key = String(input.key ?? "");
    const code = String(input.code ?? "");
    if (key === "=" || key === "+" || code === "NumpadAdd") return "in";
    if (key === "-" || code === "NumpadSubtract") return "out";
    if (key === "0" || code === "Numpad0") return "reset";
    return null;
}

function isInteger(value) {
    return Number.isFinite(value) && Math.abs(value) < 1e6;
}

/** Surface (px²) de l'intersection entre la fenêtre et la zone de travail d'un écran. */
function visibleWidth(bounds, area) {
    const width = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const height = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return { width, height };
}

/**
 * Vérifie qu'une fenêtre reste atteignable : une part suffisante doit apparaître sur un écran.
 * `displays` : liste d'objets { workArea: {x,y,width,height} }.
 */
function isVisible(bounds, displays) {
    return (displays || []).some((display) => {
        const area = display && display.workArea;
        if (!area) return false;
        const { width, height } = visibleWidth(bounds, area);
        return width >= MIN_VISIBLE && height >= MIN_VISIBLE;
    });
}

/**
 * Nettoie l'état lu sur le disque.
 * Renvoie { width, height, x?, y?, maximized, zoom } : x/y absents si la position n'est plus valable
 * (écran débranché) ; la taille est alors conservée et le système centre la fenêtre.
 */
function sanitizeState(raw, displays, defaults = {}) {
    const width = defaults.width ?? 1240;
    const height = defaults.height ?? 800;
    const state = { width, height, maximized: false, zoom: 1 };
    if (!raw || typeof raw !== "object") return state;

    state.zoom = clampZoom(raw.zoom ?? 1);
    state.maximized = raw.maximized === true;

    if (isInteger(raw.width) && isInteger(raw.height)) {
        state.width = Math.max(MIN_WIDTH, Math.round(raw.width));
        state.height = Math.max(MIN_HEIGHT, Math.round(raw.height));
    }

    if (isInteger(raw.x) && isInteger(raw.y)) {
        const bounds = { x: Math.round(raw.x), y: Math.round(raw.y), width: state.width, height: state.height };
        if (isVisible(bounds, displays)) {
            state.x = bounds.x;
            state.y = bounds.y;
        }
    }
    return state;
}

/** Sérialise l'état à écrire : bounds « normales » (hors maximisation) + indicateurs. */
function buildState({ bounds, maximized, zoom }) {
    return {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        maximized: Boolean(maximized),
        zoom: clampZoom(zoom)
    };
}

module.exports = {
    sanitizeState,
    buildState,
    nextZoom,
    zoomActionForInput,
    clampZoom,
    isVisible,
    ZOOM_MIN,
    ZOOM_MAX,
    ZOOM_STEP,
    MIN_WIDTH,
    MIN_HEIGHT
};
