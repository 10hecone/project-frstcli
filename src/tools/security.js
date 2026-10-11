"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const BLOCKED_SEGMENTS = new Set([
    ".git",
    "node_modules",
    ".ssh",
    ".aws",
    ".azure",
    ".gnupg",
    ".config"
]);

/**
 * Valide un chemin relatif et renvoie sa forme normalisée avec "/".
 * "." désigne la racine du projet.
 */
function normalizeRelative(relativePath) {
    if (
        typeof relativePath !== "string" ||
        !relativePath.trim() ||
        relativePath.includes("\0") ||
        path.isAbsolute(relativePath) ||
        path.win32.isAbsolute(relativePath)
    ) {
        throw new Error("Chemin relatif invalide.");
    }

    const segments = relativePath
        .split(/[\\/]+/)
        .filter(segment => segment && segment !== ".");

    for (const segment of segments) {
        const lower = segment.toLowerCase();

        if (segment === "..") {
            throw new Error("Le segment '..' est interdit.");
        }

        if (segment.includes(":")) {
            throw new Error("Le caractère ':' est interdit dans un chemin.");
        }

        if (BLOCKED_SEGMENTS.has(lower)) {
            throw new Error(`Accès interdit : ${segment}`);
        }

        if (
            lower.startsWith(".env") ||
            /\.(pem|key|p12|pfx)$/i.test(lower) ||
            /^(id_rsa|id_ed25519|credentials|secrets?)(\.|$)/i.test(lower)
        ) {
            throw new Error(`Fichier sensible interdit : ${segment}`);
        }
    }

    return segments.length ? segments.join("/") : ".";
}

/**
 * Résout un chemin relatif dans le projet et refuse les liens symboliques.
 * Renvoie { rel, target }.
 */
async function resolveInWorkspace(workspace, relativePath) {
    if (!workspace) {
        throw new Error("Aucun projet sélectionné. Utilise /project <dossier>.");
    }

    const rel = normalizeRelative(relativePath);
    const target = path.resolve(
        workspace,
        ...rel.split("/").filter(segment => segment !== ".")
    );

    const inside = path.relative(workspace, target);

    if (
        inside === ".." ||
        inside.startsWith(`..${path.sep}`) ||
        path.isAbsolute(inside)
    ) {
        throw new Error("Accès hors du projet interdit.");
    }

    let current = workspace;

    for (const segment of inside.split(path.sep).filter(Boolean)) {
        current = path.join(current, segment);

        let info;

        try {
            info = await fs.lstat(current);
        } catch (error) {
            // Le chemin peut désigner un élément qui n'existe pas encore.
            if (error.code === "ENOENT") break;
            throw error;
        }

        if (info.isSymbolicLink()) {
            throw new Error(`Lien symbolique interdit : ${segment}`);
        }
    }

    return { rel, target };
}

module.exports = { normalizeRelative, resolveInWorkspace };
