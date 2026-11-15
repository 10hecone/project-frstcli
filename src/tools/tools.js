"use strict";

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

module.exports = {
    TOOLS,
    validateToolCall,
    describeCall,
    summarizeResult,
    undoLast,
    listDirectory,
    readFile,
    searchFiles
};
