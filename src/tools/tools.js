"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

const { CONFIG } = require("../config");
const { state, resetConversation, setConversation } = require("../state");
const { ui } = require("../cli/ui");
const { printDiff } = require("./diff");
const { normalizeRelative, resolveInWorkspace } = require("./security");
const memory = require("../project/memory");
const projectContext = require("../project/project-context");
const { runCommand } = require("./command/index");
const conversations = require("../project/conversations");

/* ============================================================

    Utilitaires
    ============================================================ */

const { newId, requireString, optionalString, optionalInt } = require("./core/args");
const {
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
} = require("./core/fs-utils");
const { readTextFile, assertFreshRead } = require("./core/freshness");
const { finishMutation, undoLast } = require("./core/journal");

/* ============================================================

    Lecture
    ============================================================ */

async function walkDirectory(absDir, relDir, depth, maxDepth, out) {
    const dirents = await fs.readdir(absDir, { withFileTypes: true });

    dirents.sort((a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) ||
        a.name.localeCompare(b.name, "fr")
    );

    for (const dirent of dirents) {
        if (out.length > CONFIG.maxDirectoryEntries) return;
        if (dirent.isSymbolicLink()) continue;

        const childRel = relDir === "." ? dirent.name : `${relDir}/${dirent.name}`;

        try {
            normalizeRelative(childRel);
        } catch {
            continue; // dossier ou fichier masqué (sensible, .git, node_modules...)
        }

        const isDir = dirent.isDirectory();
        out.push({ path: childRel, type: isDir ? "directory" : "file" });

        if (isDir && depth < maxDepth) {
            await walkDirectory(
                path.join(absDir, dirent.name),
                childRel,
                depth + 1,
                maxDepth,
                out
            );
        }
    }
}

async function listDirectory(args = {}) {
    const { rel, target } = await resolveInWorkspace(state.workspace, args.path ?? ".");
    const info = await fs.stat(target);

    if (!info.isDirectory()) throw new Error("Ce chemin n'est pas un dossier.");

    const entries = [];
    await walkDirectory(target, rel, 0, args.recursive === true ? 2 : 0, entries);

    const shown = entries.slice(0, CONFIG.maxDirectoryEntries);

    memory.rememberDir(rel, shown.length);

    return {
        path: rel,
        entries: shown,
        truncated: entries.length > shown.length,
        message: `${shown.length} élément(s).`
    };
}

async function readFile(args = {}) {
    requireString(args.path, "path");

    const { rel, target } = await resolveInWorkspace(state.workspace, args.path);
    const text = await readTextFile(target);
    const lines = text.split("\n");
    const total = lines.length;

    let content = text;
    let partial = false;
    let range = null;

    if (args.start_line !== undefined || args.end_line !== undefined) {
        const start = Math.max(1, Math.floor(args.start_line ?? 1));
        const end = Math.min(total, Math.floor(args.end_line ?? total));

        if (start > end) {
            throw new Error(`Plage invalide : le fichier a ${total} lignes.`);
        }

        content = lines.slice(start - 1, end).join("\n");
        partial = start > 1 || end < total;
        range = [start, end];
    }

    let truncated = false;

    if (content.length > CONFIG.maxReadChars) {
        content = content.slice(0, CONFIG.maxReadChars);
        truncated = true;
        partial = true;
    }

    // L'empreinte porte toujours sur le fichier COMPLET présent sur le disque.
    memory.rememberFile(rel, text, { partial });

    return {
        path: rel,
        total_lines: total,
        range,
        truncated,
        content,
        message: truncated
            ? "Fichier tronqué : utilise start_line/end_line pour lire la suite, et edit_file pour modifier."
            : "Fichier lu."
    };
}

async function searchFiles(args = {}) {
    const query = requireString(args.query, "query");
    const { rel, target } = await resolveInWorkspace(state.workspace, args.path ?? ".");
    const info = await fs.stat(target);

    if (!info.isDirectory()) throw new Error("search_files doit cibler un dossier.");

    const needle = query.toLowerCase();
    const matches = [];
    let scanned = 0;

    const full = () =>
        matches.length >= CONFIG.maxSearchResults || scanned >= CONFIG.maxSearchFiles;

    async function visit(dir, relDir) {
        const dirents = await fs.readdir(dir, { withFileTypes: true });

        for (const dirent of dirents) {
            if (full()) return;
            if (dirent.isSymbolicLink()) continue;

            const childRel = relDir === "." ? dirent.name : `${relDir}/${dirent.name}`;

            try {
                normalizeRelative(childRel);
            } catch {
                continue;
            }

            const childAbs = path.join(dir, dirent.name);

            if (dirent.isDirectory()) {
                await visit(childAbs, childRel);
                continue;
            }

            if (!dirent.isFile()) continue;

            scanned++;

            let text;

            try {
                text = await readTextFile(childAbs);
            } catch {
                continue; // binaire, trop grand ou illisible
            }

            const lines = text.split("\n");

            for (let i = 0; i < lines.length; i++) {
                if (lines[i].toLowerCase().includes(needle)) {
                    matches.push({
                        path: childRel,
                        line: i + 1,
                        text: lines[i].trim().slice(0, 200)
                    });

                    if (full()) return;
                }
            }
        }
    }

    await visit(target, rel);

    return {
        query,
        matches,
        truncated: full(),
        message: `${matches.length} résultat(s) dans ${scanned} fichier(s).`
    };
}

/* ============================================================

    Écriture (toutes les actions demandent une confirmation)
    ============================================================ */

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
    await fs.mkdir(target, { recursive: true });

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

    try {
        // wx : n'écrase jamais un fichier apparu entre-temps.
        await fs.writeFile(
            target,
            content,
            existing ? "utf8" : { encoding: "utf8", flag: "wx" }
        );
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

    const { rel, target } = await resolveInWorkspace(state.workspace, args.path);

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

    const count = previous.split(needle).length - 1;

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

    const { added, removed } = printDiff(previous, updated);
    ui.result(`+${added} -${removed} (${replaceAll ? count : 1} remplacement(s))`);

    if (!(await ui.confirm("Autoriser cette modification ?"))) return denied(rel);

    await resolveInWorkspace(state.workspace, rel);

    const now = await readTextFile(target);

    if (memory.hash(now) !== memory.hash(previous)) {
        throw new Error("Le fichier a changé pendant la confirmation. Modification annulée.");
    }

    const id = newId();
    const backup = await memory.backupFile(id, previous);

    await fs.writeFile(target, updated, "utf8");

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
        message: "Modification enregistrée."
    };
}

async function resolvePair(args) {
    requireString(args.from, "from");
    requireString(args.to, "to");

    const src = await resolveInWorkspace(state.workspace, args.from);
    const dst = await resolveInWorkspace(state.workspace, args.to);

    if (src.rel === "." || dst.rel === ".") throw new Error("Chemin invalide.");

    if (src.rel === dst.rel) throw new Error("La source et la destination sont identiques.");

    if (dst.target.startsWith(src.target + path.sep)) {
        throw new Error("Impossible de placer un dossier à l'intérieur de lui-même.");
    }

    const info = await statOrNull(src.target);

    if (!info) throw new Error(`Introuvable : ${src.rel}.`);

    return { src, dst, info };
}

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

async function rememberTool(args = {}) {
    const note = requireString(args.note, "note").trim().slice(0, memory.LIMITS.noteChars);

    ui.result(`Note : ${note}`);

    if (!(await ui.confirm("Enregistrer cette note dans la mémoire du projet ?"))) {
        return denied(".");
    }

    memory.addNote(note);
    await memory.save();

    return { changed: true, message: "Note enregistrée." };
}

/* ============================================================

    Registre, validation, affichage
    ============================================================ */

const TOOLS = {
    list_directory: {
        run: listDirectory,
        check(args) {
            optionalString(args.path, "path");

            if (args.recursive !== undefined && typeof args.recursive !== "boolean") {
                throw new Error("recursive doit être un booléen.");
            }
        }
    },
    read_file: {
        run: readFile,
        check(args) {
            requireString(args.path, "path");
            optionalInt(args.start_line, "start_line");
            optionalInt(args.end_line, "end_line");
        }
    },
    search_files: {
        run: searchFiles,
        check(args) {
            requireString(args.query, "query");
            optionalString(args.path, "path");
        }
    },
    create_directory: {
        run: createDirectory,
        check(args) {
            requireString(args.path, "path");
        }
    },
    write_file: {
        run: writeFile,
        check(args) {
            requireString(args.path, "path");

            if (typeof args.content !== "string") {
                throw new Error("content doit être une chaîne.");
            }
        }
    },
    edit_file: {
        run: editFile,
        check(args) {
            requireString(args.path, "path");

            if (typeof args.old_string !== "string" || !args.old_string) {
                throw new Error("old_string doit être une chaîne non vide.");
            }

            if (typeof args.new_string !== "string") {
                throw new Error("new_string doit être une chaîne.");
            }

            if (args.replace_all !== undefined && typeof args.replace_all !== "boolean") {
                throw new Error("replace_all doit être un booléen.");
            }
        }
    },
    move_path: {
        run: movePathTool,
        check(args) {
            requireString(args.from, "from");
            requireString(args.to, "to");
        }
    },
    copy_path: {
        run: copyPathTool,
        check(args) {
            requireString(args.from, "from");
            requireString(args.to, "to");
        }
    },
    delete_path: {
        run: deletePathTool,
        check(args) {
            requireString(args.path, "path");
        }
    },
    remember: {
        run: rememberTool,
        check(args) {
            requireString(args.note, "note");
        }
    },
    run_command: {
        run: runCommand,
        check(args) {
            if (args.command !== undefined) {
                requireString(args.command, "command");
            } else {
                requireString(args.name, "name");
            }
            optionalInt(args.timeout_ms, "timeout_ms");
        }
    }
};

function validateToolCall(action) {
    if (!action || typeof action !== "object") {
        throw new Error("Action d'outil invalide.");
    }

    if (!Object.hasOwn(TOOLS, action.name)) {
        throw new Error(
            `Outil inconnu : ${action.name}. Outils valides : ${Object.keys(TOOLS).join(", ")}.`
        );
    }

    if (!action.args || typeof action.args !== "object" || Array.isArray(action.args)) {
        throw new Error("args doit être un objet.");
    }

    TOOLS[action.name].check(action.args);
}

const short = (value, max) => {
    const text = String(value ?? "").replace(/\s+/g, " ");
    return text.length > max ? `${text.slice(0, max)}...` : text;
};

/** Description lisible de l'action, affichée à côté du nom de l'outil. */
function describeCall(action) {
    const a = action.args || {};

    switch (action.name) {
        case "read_file":
            return a.start_line || a.end_line
                ? `${a.path} (lignes ${a.start_line ?? 1} à ${a.end_line ?? "fin"})`
                : a.path;
        case "edit_file":
            return `${a.path} : "${short(a.old_string, 40)}" -> "${short(a.new_string, 40)}"`;
        case "write_file":
            return `${a.path} (${String(a.content ?? "").length} caractères)`;
        case "move_path":
        case "copy_path":
            return `${a.from} -> ${a.to}`;
        case "search_files":
            return `"${a.query}" dans ${a.path ?? "."}`;
        case "remember":
            return `"${short(a.note, 60)}"`;
        default:
            return a.path ?? ".";
    }
}

function summarizeResult(name, result) {
    if (result.denied) return "Refusé par l'utilisateur";

    switch (name) {
        case "list_directory": {
            const dirs = result.entries.filter(e => e.type === "directory").length;
            return `${result.entries.length} éléments (${dirs} dossiers)` +
                (result.truncated ? ", liste tronquée" : "");
        }
        case "read_file": {
            const where = result.range ? ` (lignes ${result.range[0]}-${result.range[1]})` : "";
            return `${result.total_lines} lignes${where}` + (result.truncated ? ", tronqué" : "");
        }
        case "search_files":
            return result.message;
        default:
            return result.message || "OK";
    }
}

/* ============================================================

    Projet
    ============================================================ */

async function setProject(directory) {
    const real = await fs.realpath(path.resolve(directory));
    const info = await fs.stat(real);

    if (!info.isDirectory()) throw new Error("Le projet doit être un dossier.");

    state.workspace = real;
    resetConversation();
    await memory.open(real);

    for (const mode of ["chat", "agent"]) {
        const saved = await conversations.findForWorkspace(real, mode);
        if (saved) setConversation(mode, saved.id, saved.settings);
    }

    ui.info(`Projet : ${real}`);

    const notes = memory.listNotes().length;
    const undo = memory.listUndo().length;

    if (notes || undo) {
        ui.info(`Mémoire : ${notes} note(s), ${undo} modification(s) annulable(s).`);
    }

    ui.warn("Le contenu du projet (fichiers, RESUME.md) est envoyé à ton fournisseur API.");

    try {
        const report = await projectContext.load(real);
        ui.info(
            `${report.status} | ${report.files} fichier(s) indexé(s)` +
            (report.skipped ? `, ${report.skipped} ignoré(s)` : "")
        );
    } catch (error) {
        ui.warn(`Indexation impossible : ${error.message}`);
    }
}

function unsetProject() {
    state.workspace = null;
    resetConversation();
    memory.close();
    projectContext.clear();
}

module.exports = {
    TOOLS,
    validateToolCall,
    describeCall,
    summarizeResult,
    setProject,
    unsetProject,
    undoLast,
    listDirectory,
    readFile,
    searchFiles
};
