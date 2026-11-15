"use strict";

/**
 * Apparence de la fenêtre côté processus principal (barre de titre, fond) :
 * logique pure, sans Electron. Le thème de la page est géré par le CSS (data-theme).
 */

const THEMES = ["dark", "light"];
const TITLEBAR_HEIGHT = 40;

const PALETTE = {
    dark: { solid: "#0f1115", symbol: "#e6e8ee" },
    light: { solid: "#f3f4f7", symbol: "#1c1f26" }
};

function normalizeTheme(theme) {
    return THEMES.includes(theme) ? theme : "dark";
}

/**
 * Calcule les paramètres de la fenêtre pour un thème et un mode de transparence.
 * Avec l'acrylique (Windows 11), le fond doit être transparent et l'overlay des boutons aussi ;
 * sans transparence, tout est opaque.
 */
function windowAppearance({ theme, transparency, platform = process.platform } = {}) {
    const name = normalizeTheme(theme);
    const palette = PALETTE[name];
    const glass = transparency !== false && platform === "win32";
    return {
        theme: name,
        glass,
        backgroundColor: glass ? "#00000000" : palette.solid,
        backgroundMaterial: glass ? "acrylic" : "none",
        titleBarOverlay: {
            color: glass ? "#00000000" : palette.solid,
            symbolColor: palette.symbol,
            height: TITLEBAR_HEIGHT
        }
    };
}

module.exports = { windowAppearance, normalizeTheme, THEMES, TITLEBAR_HEIGHT, PALETTE };
