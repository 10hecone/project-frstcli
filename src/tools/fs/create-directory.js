"use strict";

const fs = require("node:fs/promises");

const { state } = require("../../state");
const { ui } = require("../../cli/ui");
const { resolveInWorkspace } = require("../security");
const { requireString } = require("../core/args");
const { statOrNull, toRel, denied, firstMissingAncestor } = require("../core/fs-utils");
const { finishMutation } = require("../core/journal");

async function createDirectory(args = {}) {
    requireString(args.path, "path");

    const { rel, target } = await resolveInWorkspace(state.workspace, args.path);

    if (rel === ".") throw new Error("Chemin invalide.");

    const existing = await statOrNull(target);

    if (existing) {
        if (existing.isDirectory()) {
            return { path: rel, changed: false, message: "Le dossier existe déjà." };
        }

        throw new Error(`Un fichier existe déjà à ${rel}.`);
    }

    if (!(await ui.confirm(`Autoriser la création du dossier ${rel} ?`))) {
        return denied(rel);
    }

    await resolveInWorkspace(state.workspace, rel);

    const created = await firstMissingAncestor(target);
    await fs.mkdir(target, { recursive: true, mode: 0o700 });

    await finishMutation(
        {
            kind: "mkdir",
            rel,
            createdDirs: created ? [toRel(created)] : [],
            label: `dossier créé : ${rel}`
        },
        `dossier créé : ${rel}`
    );

    return { path: rel, changed: true, message: "Dossier créé." };
}

function check(args) {
    requireString(args.path, "path");
}

function describe(a) {
    return a.path ?? ".";
}

module.exports = { name: "create_directory", run: createDirectory, check, describe };
