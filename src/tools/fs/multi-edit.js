"use strict";

const { CONFIG } = require("../../config");
const { state } = require("../../state");
const { ui } = require("../../ui-bridge");
const { buildDiff } = require("../diff");
const { resolveInWorkspace, assertRealInside } = require("../security");
const memory = require("../../project/memory");
const { newId, requireString } = require("../core/args");
const { statOrNull, denied } = require("../core/fs-utils");
const { readTextFile, assertFreshRead } = require("../core/freshness");
const { finishMutation } = require("../core/journal");
const { writeAtomic } = require("../core/atomic");

const MAX_EDITS = 20;

/** Vérifie la liste des remplacements. L'erreur donne le numéro du remplacement fautif. */
function checkEdits(edits) {
    if (!Array.isArray(edits) || edits.length === 0) {
        throw new Error(`edits doit être une liste de 1 à ${MAX_EDITS} remplacements.`);
    }

    if (edits.length > MAX_EDITS) {
        throw new Error(`Trop de remplacements : ${edits.length} (maximum ${MAX_EDITS}).`);
    }

    edits.forEach((edit, index) => {
        const n = index + 1;

        if (!edit || typeof edit !== "object" || Array.isArray(edit)) {
            throw new Error(`Remplacement ${n} : doit être un objet { old_string, new_string, replace_all }.`);
        }

        if (typeof edit.old_string !== "string" || edit.old_string.length === 0) {
            throw new Error(`Remplacement ${n} : old_string doit être une chaîne non vide.`);
        }

        if (typeof edit.new_string !== "string") {
            throw new Error(`Remplacement ${n} : new_string doit être une chaîne.`);
        }

        if (edit.old_string === edit.new_string) {
            throw new Error(`Remplacement ${n} : old_string et new_string sont identiques.`);
        }

        if (edit.new_string.length > CONFIG.maxWriteChars) {
            throw new Error(`Remplacement ${n} : new_string trop long (maximum ${CONFIG.maxWriteChars} caractères).`);
        }

        if (edit.replace_all !== undefined && typeof edit.replace_all !== "boolean") {
            throw new Error(`Remplacement ${n} : replace_all doit être true ou false.`);
        }
    });
}

/**
 * Applique les remplacements en mémoire, dans l'ordre, chacun sur le résultat
 * du précédent. Ne touche pas au disque : en cas d'échec, rien n'est écrit.
 */
function applyEdits(text, edits) {
    let current = text;
    let replacements = 0;

    edits.forEach((edit, index) => {
        const n = index + 1;
        let needle = edit.old_string;
        let replacement = edit.new_string;

        // Fichier Windows : tolère les \n envoyés par le modèle, comme edit_file.
        if (!current.includes(needle) && current.includes("\r\n")) {
            needle = needle.replace(/\r?\n/g, "\r\n");
            replacement = replacement.replace(/\r?\n/g, "\r\n");
        }

        const count = current.split(needle).length - 1;

        if (count === 0) {
            throw new Error(
                `Remplacement ${n} : old_string est introuvable (après les remplacements précédents). ` +
                "Relis le fichier et copie le texte exactement. Aucune modification n'a été écrite."
            );
        }

        const replaceAll = edit.replace_all === true;

        if (count > 1 && !replaceAll) {
            throw new Error(
                `Remplacement ${n} : old_string apparaît ${count} fois. Ajoute du contexte ou mets replace_all à true. ` +
                "Aucune modification n'a été écrite."
            );
        }

        current = replaceAll
            ? current.split(needle).join(replacement)
            : current.replace(needle, () => replacement);

        replacements += replaceAll ? count : 1;
    });

    return { text: current, replacements };
}

async function multiEdit(args = {}) {
    requireString(args.path, "path");
    checkEdits(args.edits);

    const { rel, target } = await resolveInWorkspace(state.workspace, args.path);

    if (!(await statOrNull(target))) {
        throw new Error(`Fichier introuvable : ${rel}. Utilise write_file pour le créer.`);
    }

    const previous = await readTextFile(target);
    assertFreshRead(rel, previous, { allowPartial: true });

    const { text: updated, replacements } = applyEdits(previous, args.edits);

    if (updated === previous) {
        return { path: rel, changed: false, replacements, message: "Aucun changement : le contenu est identique." };
    }

    if (Buffer.byteLength(updated, "utf8") > CONFIG.maxWriteBytes) {
        throw new Error("Le fichier modifié dépasserait la taille maximale autorisée.");
    }

    // Une seule confirmation, avec le diff complet de tous les remplacements.
    const { added, removed } = ui.diff(buildDiff(previous, updated));
    ui.result(`+${added} -${removed} (${args.edits.length} modification(s), ${replacements} remplacement(s))`);

    if (!(await ui.confirm("Autoriser ces modifications ?"))) return denied(rel);

    await resolveInWorkspace(state.workspace, rel);

    const now = await readTextFile(target);

    if (memory.hash(now) !== memory.hash(previous)) {
        throw new Error("Le fichier a changé pendant la confirmation. Modifications annulées.");
    }

    const id = newId();
    const backup = await memory.backupFile(id, previous);
    await assertRealInside(state.workspace, target);

    await writeAtomic(target, updated, { expected: previous, read: readTextFile });

    const wasPartial = memory.getFile(rel)?.partial ?? false;
    memory.rememberFile(rel, updated, { partial: wasPartial });

    // Une seule entrée de journal : /undo annule tous les remplacements d'un coup.
    await finishMutation(
        { kind: "edit", rel, backup, label: `fichier modifié (multi_edit) : ${rel}` },
        `fichier modifié (multi_edit) : ${rel}`
    );

    return {
        path: rel,
        changed: true,
        edits: args.edits.length,
        replacements,
        message: "Modifications enregistrées."
    };
}

function check(args) {
    requireString(args.path, "path");
    checkEdits(args.edits);
}

function describe(a) {
    const count = Array.isArray(a.edits) ? a.edits.length : 0;
    return `${a.path} : ${count} remplacement(s)`;
}

module.exports = { name: "multi_edit", run: multiEdit, check, describe, applyEdits, MAX_EDITS };
