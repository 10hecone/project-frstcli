"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { state, resetConversation, setConversation } = require("../state");
const { ui } = require("../ui-bridge");
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

async function setProject(directory, { newConv = false } = {}) {
    const projects = require("../project/projects");
    const real = await fs.realpath(path.resolve(directory));
    const info = await fs.stat(real);

    if (!info.isDirectory()) throw new Error("Le projet doit être un dossier.");

    state.workspace = real;
    resetConversation();
    // Le résumé /index du projet précédent ne doit pas s'afficher pour celui-ci.
    projectContext.clear();
    await memory.open(real);

    const { project, created } = await projects.open(real, { newConv });

    // Seule la conversation chat est reprise : l'ancienne conversation agent écraserait ses réglages.
    const saved = project.conversations.chat;
    if (saved && saved.id) setConversation("chat", saved.id, saved.settings);

    ui.info(`Projet : ${real}`);

    if (created) ui.info("Nouveau projet enregistré dans projects.json.");
    else if (newConv) ui.info("Projet existant : nouvelle conversation.");
    else ui.info("Projet existant : reprise de sa conversation (le contexte n'est pas renvoyé).");

    const notes = memory.listNotes().length;
    const undo = memory.listUndo().length;

    if (notes || undo) {
        ui.info(`Mémoire : ${notes} note(s), ${undo} modification(s) annulable(s).`);
    }

    // Plus d'indexation automatique : le premier message ne joint qu'un contexte court
    // (environnement, premier niveau du projet, FRSTCLI.md) et le modèle lit les fichiers
    // avec les outils. /index génère RESUME.md à la demande.
    ui.warn(
        "FRSTCLI.md, la liste du premier niveau du projet et ce que lit le modèle " +
        "(fichiers, sorties de commandes) sont envoyés à ton fournisseur API."
    );
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
