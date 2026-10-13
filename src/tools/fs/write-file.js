"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { CONFIG } = require("../../config");
const { state } = require("../../state");
const { ui } = require("../../cli/ui");
const { printDiff } = require("../diff");
const { resolveInWorkspace, assertRealInside } = require("../security");
const memory = require("../../project/memory");
const { newId, requireString } = require("../core/args");
const { statOrNull, toRel, denied, firstMissingAncestor, ensureParent } = require("../core/fs-utils");
const { readTextFile, assertFreshRead } = require("../core/freshness");
const { finishMutation } = require("../core/journal");
const { writeAtomic } = require("../core/atomic");

async function writeFile(args = {}) {
    requireString(args.path, "path");

    if (typeof args.content !== "string") {
        throw new Error("content doit être une chaîne.");
    }

    if (args.content.includes("\0")) throw new Error("Contenu binaire interdit.");

    const { rel, target } = await resolveInWorkspace(state.workspace, args.path);

    if (rel === ".") throw new Error("Chemin invalide.");

    const existing = await statOrNull(target);

    let previous = null;
    let content = args.content;

    if (existing) {
        if (!existing.isFile()) throw new Error("Ce chemin est un dossier.");

        previous = await readTextFile(target);
        assertFreshRead(rel, previous);

        // Fichier Windows : on garde les fins de ligne CRLF.
        if (previous.includes("\r\n") && !content.includes("\r\n")) {
            content = content.replace(/\n/g, "\r\n");
        }

        if (previous === content) {
            return { path: rel, changed: false, message: "Contenu déjà identique." };
        }
    }

    const bytes = Buffer.byteLength(content, "utf8");

    if (bytes > CONFIG.maxWriteBytes) {
        throw new Error(`Écriture trop volumineuse : maximum ${CONFIG.maxWriteBytes} octets.`);
    }

    const missing = await firstMissingAncestor(path.dirname(target));

    if (missing) ui.result(`Crée aussi le dossier ${toRel(missing)}`);

    const { added, removed } = printDiff(previous, content);
    ui.result(`+${added} -${removed}`);

    if (!(await ui.confirm("Autoriser cette écriture ?"))) return denied(rel);

    // Revalidation après confirmation.
    await resolveInWorkspace(state.workspace, rel);

    if (existing) {
        const now = await readTextFile(target);

        if (memory.hash(now) !== memory.hash(previous)) {
            throw new Error("Le fichier a changé pendant la confirmation. Écriture annulée.");
        }
    }

    const id = newId();
    const backup = existing ? await memory.backupFile(id, previous) : null;
    const createdRoot = await ensureParent(target);
    await assertRealInside(state.workspace, target);

    try {
        // Nouveau fichier : création exclusive (wx, 0o600), donc jamais d'écrasement d'un fichier apparu entre-temps.
        // Fichier existant : écriture dans un temporaire, contrôle du contenu attendu, puis rename.
        await writeAtomic(target, content, {
            expected: existing ? previous : null,
            read: readTextFile,
        });
    } catch (error) {
        if (error.code === "EEXIST") {
            throw new Error("Un fichier est apparu pendant la confirmation. Écriture annulée.");
        }
        throw error;
    }

    memory.rememberFile(rel, content);

    const verb = existing ? "modifié" : "créé";

    await finishMutation(
        {
            kind: existing ? "write" : "create",
            rel,
            backup,
            createdDirs: createdRoot ? [createdRoot] : [],
            label: `fichier ${verb} : ${rel}`
        },
        `fichier ${verb} : ${rel}`
    );

    return {
        path: rel,
        changed: true,
        created: !existing,
        bytes,
        lines: memory.countLines(content),
        message: existing ? "Fichier modifié." : "Fichier créé."
    };
}

function check(args) {
    requireString(args.path, "path");

    if (typeof args.content !== "string") {
        throw new Error("content doit être une chaîne.");
    }

    if (args.content.length > CONFIG.maxWriteChars) {
        throw new Error(`content trop long : maximum ${CONFIG.maxWriteChars} caractères.`);
    }
}

function describe(a) {
    return `${a.path} (${String(a.content ?? "").length} caractères)`;
}

module.exports = { name: "write_file", run: writeFile, check, describe };
