"use strict";

/**
 * Alertes « l'agent a besoin de vous » : normalisation de la demande venue de la page
 * et génération de la pastille de la barre des tâches. Logique pure, sans Electron.
 */

const KINDS = {
    done: { color: [46, 160, 67], description: "Tâche terminée" },
    permission: { color: [227, 155, 20], description: "Autorisation demandée" }
};

const MAX_TITLE = 80;
const MAX_BODY = 200;

function clip(value, max) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Valide la demande : { kind, title, body } ou null si le type est inconnu. */
function normalizeAttention(payload) {
    const kind = payload && typeof payload === "object" ? payload.kind : null;
    if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) return null;
    return {
        kind,
        title: clip(payload.title, MAX_TITLE) || "FranceStudent Code",
        body: clip(payload.body, MAX_BODY),
        description: KINDS[kind].description
    };
}

/**
 * Pastille ronde pleine au format bitmap BGRA (Electron : nativeImage.createFromBitmap),
 * avec un bord légèrement adouci. `size` en pixels.
 */
function dotBitmap(kind, size = 16) {
    const spec = KINDS[kind] || KINDS.done;
    const [red, green, blue] = spec.color;
    const buffer = Buffer.alloc(size * size * 4);
    const center = (size - 1) / 2;
    const radius = size / 2 - 0.5;
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const distance = Math.hypot(x - center, y - center);
            const coverage = Math.max(0, Math.min(1, radius + 0.5 - distance));
            const offset = (y * size + x) * 4;
            buffer[offset] = blue;
            buffer[offset + 1] = green;
            buffer[offset + 2] = red;
            buffer[offset + 3] = Math.round(coverage * 255);
        }
    }
    return buffer;
}

module.exports = { normalizeAttention, dotBitmap, KINDS, MAX_TITLE, MAX_BODY };
