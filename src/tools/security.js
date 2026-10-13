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
    ".config",
    ".kube"
]);

const BLOCKED_FILES = new Set([".npmrc", ".netrc", ".pgpass"]);

const BLOCKED_PATHS = [".docker/config.json"];

const PATH_LIMITS = { maxChars: 1024, maxSegments: 40 };

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

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

    if (relativePath.length > PATH_LIMITS.maxChars) {
        throw new Error(`Chemin trop long : maximum ${PATH_LIMITS.maxChars} caractères.`);
    }

    const segments = relativePath
        .split(/[\\/]+/)
        .filter(segment => segment && segment !== ".");

    if (segments.length > PATH_LIMITS.maxSegments) {
        throw new Error(`Chemin trop profond : maximum ${PATH_LIMITS.maxSegments} segments.`);
    }

    for (const segment of segments) {
        const lower = segment.toLowerCase();

        if (segment === "..") {
            throw new Error("Le segment '..' est interdit.");
        }

        if (segment.includes(":")) {
            throw new Error("Le caractère ':' est interdit dans un chemin.");
        }

        if (WINDOWS_RESERVED.test(segment)) {
            throw new Error(`Nom réservé par Windows : ${segment}`);
        }

        if (/[. ]$/.test(segment)) {
            throw new Error(`Nom invalide (point ou espace final) : ${segment}`);
        }

        if (BLOCKED_SEGMENTS.has(lower)) {
            throw new Error(`Accès interdit : ${segment}`);
        }

        if (
            lower.startsWith(".env") ||
            BLOCKED_FILES.has(lower) ||
            /\.(pem|key|p12|pfx|kdbx|keystore|jks)$/i.test(lower) ||
            /^(id_rsa|id_ed25519|credentials|secrets?)(\.|$)/i.test(lower)
        ) {
            throw new Error(`Fichier sensible interdit : ${segment}`);
        }
    }

    const joinedLower = segments.join("/").toLowerCase();

    for (const blocked of BLOCKED_PATHS) {
        if (joinedLower === blocked || joinedLower.endsWith(`/${blocked}`)) {
            throw new Error(`Fichier sensible interdit : ${blocked}`);
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

/**
 * Vérifie, juste avant l'écriture, que le chemin réel de target (ou de son
 * premier ancêtre existant) reste dans le projet. Protège contre un lien ou
 * une jonction créés après resolveInWorkspace (TOCTOU).
 */
async function assertRealInside(workspace, target) {
    const root = await fs.realpath(workspace);
    let current = target;

    while (true) {
        let real;

        try {
            real = await fs.realpath(current);
        } catch (error) {
            if (error.code !== "ENOENT") throw error;

            const parent = path.dirname(current);
            if (parent === current) throw error;

            current = parent;
            continue;
        }

        const inside = path.relative(root, real);

        if (
            inside === ".." ||
            inside.startsWith(`..${path.sep}`) ||
            path.isAbsolute(inside)
        ) {
            throw new Error("Accès hors du projet interdit (chemin réel).");
        }

        return real;
    }
}

module.exports = {
    normalizeRelative,
    resolveInWorkspace,
    assertRealInside,
    BLOCKED_SEGMENTS,
    BLOCKED_FILES,
    BLOCKED_PATHS,
    PATH_LIMITS
};
