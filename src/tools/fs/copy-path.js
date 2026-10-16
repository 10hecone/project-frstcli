"use strict";

const fs = require("node:fs/promises");

const { state } = require("../../state");
const { ui } = require("../../ui-bridge");
const { resolveInWorkspace } = require("../security");
const { requireString } = require("../core/args");
const { statOrNull, denied, ensureParent, countTree } = require("../core/fs-utils");
const { finishMutation } = require("../core/journal");
const { resolvePair } = require("./pair");

async function copyPathTool(args = {}) {
    const { src, dst, info } = await resolvePair(args);

    if (await statOrNull(dst.target)) throw new Error(`${dst.rel} existe déjà.`);

    if (info.isDirectory()) {
        const { files, dirs } = await countTree(src.target);
        ui.result(`Dossier : ${files} fichier(s), ${dirs} sous-dossier(s)`);
    }

    if (!(await ui.confirm(`Copier ${src.rel} -> ${dst.rel} ?`))) return denied(src.rel);

    await resolveInWorkspace(state.workspace, dst.rel);

    const createdRoot = await ensureParent(dst.target);

    await fs.cp(src.target, dst.target, {
        recursive: true,
        errorOnExist: true,
        force: false
    });

    await finishMutation(
        {
            kind: "copy",
            rel: dst.rel,
            from: src.rel,
            createdDirs: createdRoot ? [createdRoot] : [],
            label: `copié : ${src.rel} -> ${dst.rel}`
        },
        `copié : ${src.rel} -> ${dst.rel}`
    );

    return { from: src.rel, to: dst.rel, changed: true, message: "Copié." };
}

function check(args) {
    requireString(args.from, "from");
    requireString(args.to, "to");
}

function describe(a) {
    return `${a.from} -> ${a.to}`;
}

module.exports = { name: "copy_path", run: copyPathTool, check, describe };
