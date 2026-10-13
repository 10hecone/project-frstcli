"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { state, resetConversation, setConversation } = require("../state");
const { ui } = require("../cli/ui");
const memory = require("../project/memory");
const projectContext = require("../project/project-context");
const conversations = require("../project/conversations");

const { TOOLS, validateToolCall, describeCall } = require("./registry");
const { listDirectory } = require("./fs/list-directory");
const { readFile } = require("./fs/read-file");
const { searchFiles } = require("./fs/search-files");
const { undoLast } = require("./core/journal");

/* ============================================================

    Affichage
    ============================================================ */

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
        case "run_command":
            return result.timed_out
                ? `${result.command} : délai dépassé`
                : `${result.command} : code ${result.exit_code}`;
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
