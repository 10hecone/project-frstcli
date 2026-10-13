"use strict";

const fs = require("fs/promises");
const path = require("path");
const { randomBytes } = require("crypto");

// Mode des fichiers créés : lecture/écriture pour le propriétaire seulement.
const NEW_FILE_MODE = 0o600;

// Le fichier temporaire est créé dans le dossier de la cible, donc rename reste sur le même volume.
function tempPathFor(target) {
    const dir = path.dirname(target);
    const base = path.basename(target);
    return path.join(dir, `.${base}.${randomBytes(6).toString("hex")}.tmp`);
}

function readUtf8(target) {
    return fs.readFile(target, "utf8");
}

/**
 * Écrit `content` dans `target`.
 * - expected === null : création exclusive (flag wx). Renvoie EEXIST si le fichier existe déjà.
 * - sinon : écrit un fichier temporaire, vérifie que la cible contient toujours
 *   `expected` (lue avec `read`), puis remplace la cible avec rename.
 *   En cas d'erreur, le temporaire est supprimé et l'erreur est relancée.
 */
async function writeAtomic(target, content, { expected = null, read = readUtf8 } = {}) {
    if (expected === null) {
        await fs.writeFile(target, content, {
            encoding: "utf8",
            flag: "wx",
            mode: NEW_FILE_MODE,
        });
        return;
    }

    const info = await fs.stat(target);
    const tmp = tempPathFor(target);
    try {
        await fs.writeFile(tmp, content, {
            encoding: "utf8",
            flag: "wx",
            mode: info.mode & 0o777,
        });
        const current = await read(target);
        if (current !== expected) {
            throw new Error(
                "Le fichier a changé pendant l'écriture. Écriture annulée."
            );
        }
        await fs.rename(tmp, target);
    } catch (error) {
        await fs.rm(tmp, { force: true });
        throw error;
    }
}

module.exports = { writeAtomic, NEW_FILE_MODE };
