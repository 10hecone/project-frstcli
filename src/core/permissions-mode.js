"use strict";

/**
 * Modes de permission (comme Claude Code), pour la session en cours :
 * - default     : écritures de fichiers et commandes non sûres confirmées ;
 * - acceptEdits : écritures de fichiers acceptées, commandes non sûres confirmées ;
 * - plan        : seuls les outils de lecture sont proposés au modèle.
 * Le chat sans outils n'est pas un mode : c'est l'absence de dossier (--no-project).
 */
const MODES = ["default", "acceptEdits", "plan"];

let current = "default";

function get() {
    return current;
}

/** Change de mode (casse ignorée). Renvoie le mode retenu, ou null s'il est inconnu. */
function set(value) {
    const wanted = String(value ?? "").toLowerCase();
    const mode = MODES.find((m) => m.toLowerCase() === wanted) || null;
    if (mode) current = mode;
    return mode;
}

/** Vrai si les écritures de fichiers passent sans confirmation. */
function acceptsEdits() {
    return current === "acceptEdits";
}

/** Vrai si seuls les outils de lecture sont proposés au modèle. */
function readOnly() {
    return current === "plan";
}

module.exports = { MODES, get, set, acceptsEdits, readOnly };
