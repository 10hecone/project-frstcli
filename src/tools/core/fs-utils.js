"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { state } = require("../../state");
const { resolveInWorkspace } = require("../security");
const memory = require("../../project/memory");
const { newId } = require("./args");

async function statOrNull(target) {
    try {
        return await fs.stat(target);
    } catch (error) {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
        throw error;
    }
}

const toRel = abs => path.relative(state.workspace, abs).split(path.sep).join("/");

function denied(rel) {
    return { path: rel, changed: false, denied: true, message: "Action refusée par l'utilisateur. Ne la redemande pas." };
}

/** Premier ancêtre inexistant de dirPath (ou null s'il existe déjà). */
async function firstMissingAncestor(dirPath) {
    let current = dirPath;
    let missing = null;

    while (true) {
        if (await statOrNull(current)) return missing;

        missing = current;

        const parent = path.dirname(current);
        if (parent === current) return missing;

        current = parent;
    }
}

/** Crée le dossier parent de target. Renvoie le chemin relatif du premier dossier créé. */
async function ensureParent(target) {
    const parent = path.dirname(target);
    const created = await firstMissingAncestor(parent);

    if (created) await fs.mkdir(parent, { recursive: true });

    return created ? toRel(created) : null;
}

async function treeHasFiles(abs) {
    const info = await statOrNull(abs);

    if (!info) return false;
    if (!info.isDirectory()) return true;

    for (const entry of await fs.readdir(abs, { withFileTypes: true })) {
        if (!entry.isDirectory()) return true;
        if (await treeHasFiles(path.join(abs, entry.name))) return true;
    }

    return false;
}

/** Supprime un dossier seulement s'il ne contient aucun fichier. */
async function removeEmptyTree(abs) {
    if (!(await treeHasFiles(abs))) {
        await fs.rm(abs, { recursive: true, force: true });
    }
}

async function countTree(abs, acc = { files: 0, dirs: 0 }) {
    if (acc.files + acc.dirs > 10_000) return acc;

    for (const entry of await fs.readdir(abs, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            acc.dirs++;
            await countTree(path.join(abs, entry.name), acc);
        } else {
            acc.files++;
        }
    }

    return acc;
}

/** rename, avec repli copie + suppression entre deux disques (EXDEV). */
async function moveAcross(src, dst) {
    try {
        await fs.rename(src, dst);
    } catch (error) {
        if (error.code !== "EXDEV") throw error;

        await fs.cp(src, dst, { recursive: true, errorOnExist: true, force: false });
        await fs.rm(src, { recursive: true, force: true });
    }
}

async function moveToTrash(abs) {
    const dest = path.join(memory.trashDir(), newId(), path.basename(abs));

    await fs.mkdir(path.dirname(dest), { recursive: true });
    await moveAcross(abs, dest);

    return dest;
}

async function cleanCreatedDirs(entry) {
    for (const rel of entry.createdDirs || []) {
        const { target } = await resolveInWorkspace(state.workspace, rel);
        await removeEmptyTree(target);
    }
}

module.exports = {
    statOrNull,
    toRel,
    denied,
    firstMissingAncestor,
    ensureParent,
    treeHasFiles,
    removeEmptyTree,
    countTree,
    moveAcross,
    moveToTrash,
    cleanCreatedDirs
};
