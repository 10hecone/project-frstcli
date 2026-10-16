"use strict";

const { state } = require("../../state");
const { ui } = require("../../ui-bridge");
const { resolveInWorkspace } = require("../security");
const memory = require("../../project/memory");
const { requireString } = require("../core/args");
const { statOrNull, denied, countTree, moveToTrash } = require("../core/fs-utils");
const { finishMutation } = require("../core/journal");

async function deletePathTool(args = {}) {
    requireString(args.path, "path");

    const { rel, target } = await resolveInWorkspace(state.workspace, args.path);

    if (rel === ".") throw new Error("Impossible de supprimer la racine du projet.");

    const info = await statOrNull(target);

    if (!info) throw new Error(`Introuvable : ${rel}.`);

    if (info.isDirectory()) {
        const { files, dirs } = await countTree(target);
        ui.result(`Dossier : ${files} fichier(s), ${dirs} sous-dossier(s)`);
    }

    ui.result("Mis dans la corbeille du CLI (récupérable avec /undo)");

    if (!(await ui.confirm(`Supprimer ${rel} ?`))) return denied(rel);

    await resolveInWorkspace(state.workspace, rel);

    const trash = await moveToTrash(target);
    memory.dropPath(rel);

    await finishMutation(
        {
            kind: "delete",
            rel,
            trash,
            label: `supprimé : ${rel}`
        },
        `supprimé : ${rel}`
    );

    return {
        path: rel,
        changed: true,
        message: "Supprimé (corbeille du CLI, récupérable avec /undo)."
    };
}

function check(args) {
    requireString(args.path, "path");
}

function describe(a) {
    return a.path ?? ".";
}

module.exports = { name: "delete_path", run: deletePathTool, check, describe };
