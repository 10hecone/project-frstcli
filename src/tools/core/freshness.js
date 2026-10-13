"use strict";

const fs = require("node:fs/promises");

const { CONFIG } = require("../../config");
const memory = require("../../project/memory");

async function readTextFile(target) {
    const info = await fs.stat(target);

    if (!info.isFile()) throw new Error("Ce chemin n'est pas un fichier.");

    if (info.size > CONFIG.maxReadBytes) {
        throw new Error(
            `Fichier trop grand (${info.size} octets, maximum ${CONFIG.maxReadBytes}).`
        );
    }

    const bytes = await fs.readFile(target);

    if (bytes.includes(0)) throw new Error("Fichier binaire non pris en charge.");

    try {
        // ignoreBOM : le BOM reste dans le texte et sera donc réécrit tel quel.
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
        throw new Error("Fichier non encodé en UTF-8.");
    }
}

/**
 * Refuse de modifier un fichier que le modèle n'a pas lu, qui a changé
 * depuis la lecture (modification externe), ou qu'il n'a lu que partiellement
 * (sauf pour edit_file, qui remplace un texte exact).
 */
function assertFreshRead(rel, currentText, { allowPartial = false } = {}) {
    const known = memory.getFile(rel);

    if (!known) {
        throw new Error(`Lis d'abord ${rel} avec read_file avant de le modifier.`);
    }

    if (known.hash !== memory.hash(currentText)) {
        throw new Error(
            `${rel} a changé depuis ta dernière lecture. Relis-le avant de le modifier.`
        );
    }

    if (known.partial && !allowPartial) {
        throw new Error(
            `${rel} n'a été lu que partiellement : relis-le en entier ou utilise edit_file.`
        );
    }
}

module.exports = { readTextFile, assertFreshRead };
