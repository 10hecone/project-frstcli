"use strict";

const path = require("node:path");

const { state } = require("../../state");
const { resolveInWorkspace } = require("../security");
const { requireString } = require("../core/args");
const { statOrNull } = require("../core/fs-utils");

/**
 * Vrai si child est à l'intérieur du dossier parent.
 * Sous Windows, les chemins ne tiennent pas compte de la casse : « C:\\A » contient « c:\\a\\b ».
 */
function isInsideDir(parent, child, platform = process.platform) {
    const insensitive = platform === "win32";
    const p = insensitive ? parent.toLowerCase() : parent;
    const c = insensitive ? child.toLowerCase() : child;
    return c.startsWith(p + path.sep);
}

async function resolvePair(args) {
    requireString(args.from, "from");
    requireString(args.to, "to");

    const src = await resolveInWorkspace(state.workspace, args.from);
    const dst = await resolveInWorkspace(state.workspace, args.to);

    if (src.rel === "." || dst.rel === ".") throw new Error("Chemin invalide.");

    if (src.rel === dst.rel) throw new Error("La source et la destination sont identiques.");

    if (isInsideDir(src.target, dst.target)) {
        throw new Error("Impossible de placer un dossier à l'intérieur de lui-même.");
    }

    const info = await statOrNull(src.target);

    if (!info) throw new Error(`Introuvable : ${src.rel}.`);

    return { src, dst, info };
}

module.exports = { resolvePair, isInsideDir };
