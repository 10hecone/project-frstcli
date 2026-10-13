"use strict";

const path = require("node:path");

const { state } = require("../../state");
const { resolveInWorkspace } = require("../security");
const { requireString } = require("../core/args");
const { statOrNull } = require("../core/fs-utils");

async function resolvePair(args) {
    requireString(args.from, "from");
    requireString(args.to, "to");

    const src = await resolveInWorkspace(state.workspace, args.from);
    const dst = await resolveInWorkspace(state.workspace, args.to);

    if (src.rel === "." || dst.rel === ".") throw new Error("Chemin invalide.");

    if (src.rel === dst.rel) throw new Error("La source et la destination sont identiques.");

    if (dst.target.startsWith(src.target + path.sep)) {
        throw new Error("Impossible de placer un dossier à l'intérieur de lui-même.");
    }

    const info = await statOrNull(src.target);

    if (!info) throw new Error(`Introuvable : ${src.rel}.`);

    return { src, dst, info };
}

module.exports = { resolvePair };
