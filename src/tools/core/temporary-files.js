"use strict";

const fs = require("node:fs/promises");
const { resolveInWorkspace } = require("../security");
const { readTextFile } = require("./freshness");
const { hash } = require("../../project/memory");

// Seuls les nouveaux fichiers explicitement placés ici sont temporaires.
// Aucun balayage par motif tmp-* et aucune suppression de fichier préexistant.
const tracked = new Map();

function trackTemporary(root, rel, content) {
    if (!rel.startsWith(".frst-tmp/")) return;
    tracked.set(`${root}\0${rel}`, { root, rel, hash: hash(content) });
}

async function cleanupTemporary(root) {
    const result = { removed: [], kept: [], errors: [] };
    for (const [key, item] of tracked) {
        if (item.root !== root) continue;
        tracked.delete(key);
        try {
            const { target } = await resolveInWorkspace(root, item.rel);
            const current = await readTextFile(target);
            if (hash(current) !== item.hash) {
                result.kept.push(item.rel);
                continue;
            }
            await fs.unlink(target);
            result.removed.push(item.rel);
        } catch (error) {
            if (error.code !== "ENOENT") result.errors.push(`${item.rel} : ${error.message}`);
        }
    }
    return result;
}

module.exports = { trackTemporary, cleanupTemporary };
