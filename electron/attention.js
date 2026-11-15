"use strict";

/**
 * Alertes système quand l'agent a terminé ou attend une autorisation et que la fenêtre
 * n'a pas le focus : notification, clignotement de la barre des tâches, pastille.
 * Tout est effacé dès que la fenêtre reprend le focus.
 */

const { Notification, app, nativeImage } = require("electron");
const { normalizeAttention, dotBitmap } = require("../src/gui/attention");

const BADGE_SIZE = 16;

function createAttention(win) {
    // Référence gardée pour éviter que le ramasse-miettes ne ferme la notification.
    let current = null;
    let active = false;

    function showWindow() {
        if (win.isDestroyed()) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
    }

    function clear() {
        if (!active) return;
        active = false;
        if (current) {
            current.close();
            current = null;
        }
        if (win.isDestroyed()) return;
        win.flashFrame(false);
        if (process.platform === "win32") win.setOverlayIcon(null, "");
        else if (process.platform === "darwin" && app.dock) app.dock.setBadge("");
        else if (typeof app.setBadgeCount === "function") app.setBadgeCount(0);
    }

    function setBadge(request) {
        if (process.platform === "win32") {
            const image = nativeImage.createFromBitmap(dotBitmap(request.kind, BADGE_SIZE), {
                width: BADGE_SIZE,
                height: BADGE_SIZE
            });
            win.setOverlayIcon(image, request.description);
        } else if (process.platform === "darwin" && app.dock) {
            app.dock.setBadge("•");
            app.dock.bounce(request.kind === "permission" ? "critical" : "informational");
        } else if (typeof app.setBadgeCount === "function") {
            app.setBadgeCount(1);
        }
    }

    /** Signale l'événement si la fenêtre est en arrière-plan. Renvoie true si une alerte a été émise. */
    function notify(payload) {
        const request = normalizeAttention(payload);
        if (!request || win.isDestroyed() || win.isFocused()) return false;
        active = true;
        win.flashFrame(true);
        setBadge(request);
        if (Notification.isSupported()) {
            if (current) current.close();
            current = new Notification({ title: request.title, body: request.body, silent: false });
            current.on("click", showWindow);
            current.show();
        }
        return true;
    }

    win.on("focus", clear);
    win.on("restore", () => {
        if (win.isFocused()) clear();
    });

    return { notify, clear };
}

module.exports = { createAttention };
