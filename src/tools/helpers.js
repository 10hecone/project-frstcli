"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

const { CONFIG } = require("../config");
const { state } = require("../state");
const { resolveInWorkspace } = require("./security");
const memory = require("../project/memory");

const newId = () => Date.now().toString(36) + randomBytes(3).toString("hex");

function requireString(value, name) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${name} doit être une chaîne non vide.`);
    }
    return value;
}

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

async function finishMutation(entry, journal) {
    memory.noteAction(journal);
    await memory.pushUndo(entry);
    await memory.save();
}

module.exports = {
    newId,
    requireString,
    statOrNull,
    toRel,
    denied,
    readTextFile,
    assertFreshRead,
    firstMissingAncestor,
    ensureParent,
    treeHasFiles,
    removeEmptyTree,
    countTree,
    moveAcross,
    moveToTrash,
    cleanCreatedDirs,
    finishMutation
};
