"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { normalizeRelative } = require("../security");

/**
 * Parcourt dir en profondeur, dans l'ordre renvoyé par readdir.
 * Renvoie la liste des fichiers { abs, rel } dont le chemin relatif est autorisé.
 * Ignore les liens symboliques et s'arrête après maxFiles fichiers.
 */
async function walkFiles(dir, relDir, { maxFiles = Infinity } = {}) {
    const files = [];

    async function visit(current, currentRel) {
        const dirents = await fs.readdir(current, { withFileTypes: true });

        for (const dirent of dirents) {
            if (files.length >= maxFiles) return;
            if (dirent.isSymbolicLink()) continue;

            const childRel = currentRel === "." ? dirent.name : `${currentRel}/${dirent.name}`;

            try {
                normalizeRelative(childRel);
            } catch {
                continue;
            }

            const childAbs = path.join(current, dirent.name);

            if (dirent.isDirectory()) {
                await visit(childAbs, childRel);
                continue;
            }

            if (dirent.isFile()) files.push({ abs: childAbs, rel: childRel });
        }
    }

    await visit(dir, relDir);

    return files;
}

module.exports = { walkFiles };
