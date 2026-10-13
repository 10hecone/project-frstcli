"use strict";

const fs = require("node:fs/promises");

const { CONFIG } = require("../../config");
const memory = require("../../project/memory");

// Taille du premier bloc lu pour repérer vite un fichier binaire.
const SNIFF_BYTES = 4096;

async function readTextFile(target) {
    const info = await fs.stat(target);

    if (!info.isFile()) throw new Error("Ce chemin n'est pas un fichier.");

    if (info.size > CONFIG.maxReadBytes) {
        throw new Error(
            `Fichier trop grand (${info.size} octets, maximum ${CONFIG.maxReadBytes}).`
        );
    }

    const buffer = Buffer.alloc(info.size);
    let filled = 0;
const handle = await fs.open(target, "r");

    try {
        // Premier bloc : un octet nul dans les 4 premiers Ko suffit à refuser le fichier.
        if (info.size > 0) {
            const first = Math.min(SNIFF_BYTES, info.size);
            const { bytesRead } = await handle.read(buffer, 0, first, 0);
            filled = bytesRead;

            if (buffer.subarray(0, filled).includes(0)) {
                throw new Error("Fichier binaire non pris en charge.");
            }
        }

        while (filled < info.size) {
            const { bytesRead } = await handle.read(buffer, filled, info.size - filled, filled);
            if (bytesRead === 0) break;
            filled += bytesRead;
        }
    } finally {
        await handle.close();
    }

    const bytes = buffer.subarray(0, filled);

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
