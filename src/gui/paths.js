"use strict";

/**
 * Ouverture de chemins depuis l'interface (réponses de l'agent, actions) :
 * validation côté processus principal, sans dépendance à Electron (testable).
 *
 * Règles : le chemin doit rester dans le projet (pas de lien symbolique, pas de
 * fichier sensible) ; les fichiers exécutables ne sont jamais lancés, on les montre
 * seulement dans l'explorateur.
 */

const path = require("node:path");
const fs = require("node:fs/promises");
const { resolveInWorkspace } = require("../tools/security");

// Extensions qui s'exécuteraient au lieu de s'ouvrir dans un éditeur.
const RISKY_EXTENSIONS = new Set([
    ".exe", ".bat", ".cmd", ".com", ".ps1", ".psm1", ".vbs", ".vbe", ".wsf", ".msi", ".msp",
    ".lnk", ".url", ".scr", ".hta", ".reg", ".jar", ".sh", ".command", ".app", ".dmg", ".pkg",
    ".js", ".mjs", ".cjs", ".jse", ".py", ".pl", ".rb", ".cpl", ".dll", ".appimage", ".desktop"
]);

/** Retire un suffixe « :ligne » ou « :ligne:colonne » (src/a.js:12:3). */
function stripLocation(input) {
    return String(input ?? "")
        .trim()
        .replace(/:\d+(?::\d+)?$/, "");
}

/** Vrai si l'ouverture directe risquerait d'exécuter le fichier. */
function isRisky(file) {
    return RISKY_EXTENSIONS.has(path.extname(String(file ?? "")).toLowerCase());
}

/** Convertit un chemin absolu situé dans le projet en chemin relatif ; sinon le renvoie tel quel. */
function toRelative(workspace, input) {
    const clean = stripLocation(input);
    if (!clean) return "";
    if (!path.isAbsolute(clean)) return clean;
    return path.relative(workspace, clean);
}

/**
 * Valide un chemin demandé par la page.
 * Renvoie { ok:true, rel, target, exists, directory, risky } ou { ok:false, reason }.
 */
async function resolveOpenTarget(workspace, input) {
    if (!workspace) return { ok: false, reason: "Aucun projet sélectionné." };
    const requested = toRelative(workspace, input);
    if (!requested) return { ok: false, reason: "Chemin vide." };

    let resolved;
    try {
        resolved = await resolveInWorkspace(workspace, requested.split(path.sep).join("/"));
    } catch (error) {
        return { ok: false, reason: error.message };
    }

    let info = null;
    try {
        info = await fs.stat(resolved.target);
    } catch {
        return { ok: false, reason: `Introuvable : ${resolved.rel}` };
    }

    return {
        ok: true,
        rel: resolved.rel,
        target: resolved.target,
        exists: true,
        directory: info.isDirectory(),
        risky: info.isFile() && isRisky(resolved.target)
    };
}

/**
 * Ouvre le chemin avec les fonctions fournies par Electron.
 * `shell` doit exposer openPath(chemin) (promesse, texte d'erreur ou "") et showItemInFolder(chemin).
 */
async function openWorkspacePath(workspace, input, shell) {
    const found = await resolveOpenTarget(workspace, input);
    if (!found.ok) return found;
    if (found.risky) {
        shell.showItemInFolder(found.target);
        return { ok: true, rel: found.rel, action: "reveal" };
    }
    const error = await shell.openPath(found.target);
    if (error) return { ok: false, reason: error };
    return { ok: true, rel: found.rel, action: "open" };
}

module.exports = { openWorkspacePath, resolveOpenTarget, stripLocation, isRisky, toRelative, RISKY_EXTENSIONS };
