"use strict";

const { state } = require("../../state");
const { ui } = require("../../cli/ui");
const { resolveInWorkspace } = require("../security");
const memory = require("../../project/memory");
const { requireString } = require("../core/args");
const { statOrNull, denied, ensureParent, moveAcross } = require("../core/fs-utils");
const { finishMutation } = require("../core/journal");
const { resolvePair } = require("./pair");

async function movePathTool(args = {}) {
    const { src, dst } = await resolvePair(args);

    // Renommage qui ne change que la casse (Windows) : même fichier.
    const caseOnly =
        src.target.toLowerCase() === dst.target.toLowerCase() && src.target !== dst.target;

    if (!caseOnly && (await statOrNull(dst.target))) {
        throw new Error(`${dst.rel} existe déjà.`);
    }

    if (!(await ui.confirm(`Déplacer ${src.rel} -> ${dst.rel} ?`))) return denied(src.rel);

    await resolveInWorkspace(state.workspace, src.rel);
    await resolveInWorkspace(state.workspace, dst.rel);

    const createdRoot = await ensureParent(dst.target);

    await moveAcross(src.target, dst.target);
    memory.movePath(src.rel, dst.rel);

    await finishMutation(
        {
            kind: "move",
            from: src.rel,
            to: dst.rel,
            createdDirs: createdRoot ? [createdRoot] : [],
            label: `déplacé : ${src.rel} -> ${dst.rel}`
        },
        `déplacé : ${src.rel} -> ${dst.rel}`
    );

    return { from: src.rel, to: dst.rel, changed: true, message: "Déplacé." };
}

function check(args) {
    requireString(args.from, "from");
    requireString(args.to, "to");
}

function describe(a) {
    return `${a.from} -> ${a.to}`;
}

module.exports = { name: "move_path", run: movePathTool, check, describe };
