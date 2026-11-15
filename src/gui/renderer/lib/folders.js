import { baseName } from "./entries.js";

/**
 * Logique pure des dossiers de travail pour la fenêtre (sans React).
 */

/** Modes de permission, dans l'ordre du cycle Maj+Tab (voir src/core/permissions-mode.js). */
const MODES = ["default", "acceptEdits", "plan"];

const MODE_LABELS = {
    default: "standard",
    acceptEdits: "modifs auto",
    plan: "plan"
};

/** Dossier actif { name, path, branch } à partir du chemin du statut ; null sans dossier. */
export function activeFolder(workspacePath, branch = null, recent = []) {
    if (!workspacePath) return null;
    const known = (recent || []).find((folder) => folder && folder.path === workspacePath);
    return {
        name: (known && known.name) || baseName(workspacePath) || workspacePath,
        path: workspacePath,
        branch: branch || (known && known.branch) || null
    };
}

/** Demande de confiance { path, message } si l'ouverture l'exige, sinon null. */
export function trustRequest(result) {
    if (!result || !result.needsTrust || !result.path) return null;
    return { path: result.path, message: result.message || "" };
}

/** Mode suivant dans le cycle default → acceptEdits → plan → default (inconnu : default). */
export function nextPermissionMode(mode) {
    const index = MODES.indexOf(mode);
    return MODES[(index + 1) % MODES.length];
}

/** Libellé français d'un mode de permission (inconnu : renvoyé tel quel). */
export function modeLabel(mode) {
    return MODE_LABELS[mode] || String(mode || "");
}
