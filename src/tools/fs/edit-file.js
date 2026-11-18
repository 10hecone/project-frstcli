"use strict";

const { CONFIG } = require("../../config");
const { state } = require("../../state");
const { ui } = require("../../ui-bridge");
const { buildDiff } = require("../diff");
const { resolveInWorkspace, assertRealInside } = require("../security");
const memory = require("../../project/memory");
const { newId, requireString, optionalBool } = require("../core/args");
const { statOrNull, denied } = require("../core/fs-utils");
const { readTextFile, assertFreshRead } = require("../core/freshness");
const { finishMutation } = require("../core/journal");
const { writeAtomic } = require("../core/atomic");
const { workspace } = require("../../core/workspace");
const permissionsMode = require("../../core/permissions-mode");
const { indentWarning } = require("../core/indent-check");

async function editFile(args = {}) {
    requireString(args.path, "path");

    if (typeof args.old_string !== "string" || args.old_string.length === 0) {
        throw new Error("old_string doit être une chaîne non vide.");
    }

    if (typeof args.new_string !== "string") {
        throw new Error("new_string doit être une chaîne.");
    }

    if (args.old_string === args.new_string) {
        throw new Error("old_string et new_string sont identiques.");
    }

    const { rel, target } = await resolveInWorkspace(workspace.root, args.path);

    if (!(await statOrNull(target))) {
        throw new Error(`Fichier introuvable : ${rel}. Utilise write_file pour le créer.`);
    }

    const previous = await readTextFile(target);
    assertFreshRead(rel, previous, { allowPartial: true });

    let needle = args.old_string;
    let replacement = args.new_string;

    // Fichier Windows : tolère les \n envoyés par le modèle.
    if (!previous.includes(needle) && previous.includes("\r\n")) {
        needle = needle.replace(/\r?\n/g, "\r\n");
        replacement = replacement.replace(/\r?\n/g, "\r\n");
    }

    let count = previous.split(needle).length - 1;
    let wanted = args.old_string;

    // Numéros de ligne de read_file recopiés (« 12\t... ») : on les retire.
    if (count === 0) {
        const bare = stripLineNumbers(needle);
        if (bare !== null) {
            needle = bare;
            wanted = stripLineNumbers(wanted) ?? wanted;
            replacement = stripLineNumbers(replacement) ?? replacement;
            count = previous.split(needle).length - 1;
        }
    }

    if (count === 0) {
        const loose = findLoose(previous, wanted);
        if (loose) {
            needle = loose;
            count = previous.split(needle).length - 1;
        }
    }

    if (count === 0) {
        throw new Error(
            "old_string est introuvable. Relis le fichier et copie le texte exactement (indentation comprise)."
        );
    }

    const replaceAll = args.replace_all === true;

    if (count > 1 && !replaceAll) {
        throw new Error(
            `old_string apparaît ${count} fois. Ajoute du contexte autour ou mets replace_all à true.`
        );
    }

    const updated = replaceAll
        ? previous.split(needle).join(replacement)
        : previous.replace(needle, () => replacement);

    if (Buffer.byteLength(updated, "utf8") > CONFIG.maxWriteBytes) {
        throw new Error("Le fichier modifié dépasserait la taille maximale autorisée.");
    }

    const { added, removed } = ui.diff(buildDiff(previous, updated));
    ui.result(`+${added} -${removed} (${replaceAll ? count : 1} remplacement(s))`);

    if (!permissionsMode.acceptsEdits() && !(await ui.confirm("Autoriser cette modification ?"))) return denied(rel);

    await resolveInWorkspace(workspace.root, rel);

    const now = await readTextFile(target);

    if (memory.hash(now) !== memory.hash(previous)) {
        throw new Error("Le fichier a changé pendant la confirmation. Modification annulée.");
    }

    const id = newId();
    const backup = await memory.backupFile(id, previous);
    await assertRealInside(workspace.root, target);

    // Écriture atomique : fichier temporaire, contrôle du contenu attendu, puis rename.
    await writeAtomic(target, updated, { expected: previous, read: readTextFile });

    // Après une édition, le modèle connaît le fichier tel qu'il est maintenant
    // uniquement si sa lecture précédente était complète.
    const wasPartial = memory.getFile(rel)?.partial ?? false;
    memory.rememberFile(rel, updated, { partial: wasPartial });

    await finishMutation(
        { kind: "edit", rel, backup, label: `fichier modifié : ${rel}` },
        `fichier modifié : ${rel}`
    );

    return {
        path: rel,
        changed: true,
        replacements: replaceAll ? count : 1,
        message: "Modification enregistrée.",
        ...withIndentWarning(rel, previous, updated),
        ...(CONFIG.optim ? withExcerpt(previous, updated, needle, replacement) : {})
    };
}

// Au-delà, pas d'extrait : le modèle relira la plage s'il en a besoin.
const MAX_EXCERPT_LINES = 40;
const EXCERPT_CONTEXT = 2;

/**
 * Extrait numéroté (« N<tab>texte ») autour du premier remplacement, dans le fichier modifié :
 * le modèle vérifie son édition sans relire le fichier. { excerpt } ou {} si trop long.
 */
function withExcerpt(previous, updated, needle, replacement) {
    const index = previous.indexOf(needle);
    if (index < 0) return {};
    const start = previous.slice(0, index).split("\n").length;
    const span = replacement.split("\n").length;
    const lines = updated.split("\n");
    const first = Math.max(1, start - EXCERPT_CONTEXT);
    const last = Math.min(lines.length, start + span - 1 + EXCERPT_CONTEXT);
    if (last - first + 1 > MAX_EXCERPT_LINES) return {};
    const text = lines.slice(first - 1, last).map((line, i) => `${first + i}\t${line.replace(/\r$/, "")}`).join("\n");
    return { excerpt: { first, last, text } };
}

function withIndentWarning(rel, before, after) {
    const warning = indentWarning(rel, before, after);
    return warning ? { warning } : {};
}

/**
 * Repli quand old_string n'est pas trouvé tel quel : compare ligne à ligne en ignorant
 * les espaces de début/fin et les \r (indentation ou fins de ligne recopiées de travers).
 * Renvoie le texte exact du fichier, ou null si zéro ou plusieurs correspondances.
 */
function findLoose(text, needle) {
    const want = needle.replace(/\r?\n$/, "").split(/\r?\n/).map((l) => l.trim());
    if (!want.some(Boolean)) return null;

    const lines = text.split("\n");
    const found = [];

    for (let i = 0; i + want.length <= lines.length; i++) {
        if (want.every((w, j) => lines[i + j].trim() === w)) found.push(i);
    }

    if (found.length !== 1) return null;

    const end = found[0] + want.length;
    const span = lines.slice(found[0], end).join("\n");

    // Garde le saut de ligne final seulement si old_string en avait un.
    return /\n$/.test(needle) && end < lines.length ? `${span}\n` : span.replace(/\r$/, "");
}

/**
 * Retire les préfixes « 12\t » de read_file si toutes les lignes non vides en ont un,
 * avec des numéros croissants. Sinon null (texte laissé tel quel).
 */
function stripLineNumbers(text) {
    const prefix = /^[ \t]*(\d+)\t/;
    const lines = text.split("\n");
    let last = -1;

    for (const line of lines) {
        if (!line.trim()) continue;
        const m = prefix.exec(line);
        if (!m || Number(m[1]) <= last) return null;
        last = Number(m[1]);
    }

    return last < 0 ? null : lines.map((l) => l.replace(prefix, "")).join("\n");
}

function check(args) {
    requireString(args.path, "path");

    if (typeof args.old_string !== "string" || !args.old_string) {
        throw new Error("old_string doit être une chaîne non vide.");
    }

    if (typeof args.new_string !== "string") {
        throw new Error("new_string doit être une chaîne.");
    }

    if (args.new_string.length > CONFIG.maxWriteChars) {
        throw new Error(`new_string trop long : maximum ${CONFIG.maxWriteChars} caractères.`);
    }

    optionalBool(args.replace_all, "replace_all");
}

const short = (value, max) => {
    const text = String(value ?? "").replace(/\s+/g, " ");
    return text.length > max ? `${text.slice(0, max)}...` : text;
};

function describe(a) {
    return `${a.path} : \"${short(a.old_string, 40)}\" -> \"${short(a.new_string, 40)}\"`;
}

module.exports = { name: "edit_file", run: editFile, check, describe, findLoose, stripLineNumbers, withExcerpt };
