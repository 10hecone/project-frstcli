"use strict";

const fs = require("node:fs/promises");

const { state } = require("../../state");
const { resolveInWorkspace } = require("../security");
const memory = require("../../project/memory");
const {
    statOrNull,
    ensureParent,
    moveAcross,
    moveToTrash,
    cleanCreatedDirs,
    isCaseOnlyRename
} = require("./fs-utils");

async function finishMutation(entry, journal) {
    memory.noteAction(journal);
    await memory.pushUndo(entry);
    await memory.save();
}

async function revert(entry) {
    const at = rel => resolveInWorkspace(state.workspace, rel);

    switch (entry.kind) {
        case "create": {
            const { target } = await at(entry.rel);

            if (!(await statOrNull(target))) {
                throw new Error(`${entry.rel} n'existe plus.`);
            }

            await fs.rm(target);
            memory.dropPath(entry.rel);
            await cleanCreatedDirs(entry);

            return `fichier ${entry.rel} supprimé.`;
        }

        case "write":
        case "edit": {
            const { target } = await at(entry.rel);

            if (!entry.backup || !(await statOrNull(entry.backup))) {
                throw new Error("Sauvegarde introuvable.");
            }

            await ensureParent(target);
            await fs.copyFile(entry.backup, target);
            memory.dropPath(entry.rel);

            return `${entry.rel} restauré.`;
        }

        case "mkdir": {
            await cleanCreatedDirs(entry);
            return `dossier ${entry.rel} retiré (s'il était vide).`;
        }

        case "move": {
            const from = await at(entry.to);
            const to = await at(entry.from);

            if (!(await statOrNull(from.target))) {
                throw new Error(`${entry.to} n'existe plus.`);
            }

            // Même fichier sur le disque (système insensible à la casse) : simple changement de casse.
            const caseOnly = await isCaseOnlyRename(from.target, to.target);

            if (!caseOnly && (await statOrNull(to.target))) {
                throw new Error(`${entry.from} existe déjà.`);
            }

            await ensureParent(to.target);
            await moveAcross(from.target, to.target);
            memory.movePath(entry.to, entry.from);
            await cleanCreatedDirs(entry);

            return `${entry.to} remis en ${entry.from}.`;
        }

        case "delete": {
            const { target } = await at(entry.rel);

            if (await statOrNull(target)) {
                throw new Error(`${entry.rel} existe déjà : impossible de restaurer.`);
            }

            if (!entry.trash || !(await statOrNull(entry.trash))) {
                throw new Error("Élément introuvable dans la corbeille.");
            }

            await ensureParent(target);
            await moveAcross(entry.trash, target);

            return `${entry.rel} restauré.`;
        }

        case "copy": {
            const { target } = await at(entry.rel);

            if (!(await statOrNull(target))) {
                throw new Error(`${entry.rel} n'existe plus.`);
            }

            const trash = await moveToTrash(target);
            memory.dropPath(entry.rel);
            await cleanCreatedDirs(entry);

            return `copie ${entry.rel} retirée (conservée dans ${trash}).`;
        }

        default:
            throw new Error(`Type d'annulation inconnu : ${entry.kind}`);
    }
}

/** Annule la dernière modification enregistrée. Renvoie un message. */
async function undoLast() {
    if (!state.workspace) throw new Error("Aucun projet sélectionné.");

    const entry = memory.popUndo();

    if (!entry) throw new Error("Rien à annuler.");

    let message;

    try {
        message = await revert(entry);
    } catch (error) {
        memory.unpopUndo(entry);
        throw new Error(`Annulation impossible : ${error.message}`);
    }

    memory.noteAction(`annulé : ${entry.label}`);

    if (entry.kind !== "copy") await memory.discard(entry);

    await memory.save();

    return `Annulé : ${message}`;
}

module.exports = { finishMutation, revert, undoLast };
