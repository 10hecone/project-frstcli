"use strict";

const TOOL_LABELS = {
    list_directory: "Lister",
    read_file: "Lire",
    search_files: "Chercher",
    write_file: "Écrire",
    edit_file: "Éditer",
    run_command: "Commande"
};

function toolLabel(name) {
    return TOOL_LABELS[name] || String(name ?? "");
}

module.exports = { TOOL_LABELS, toolLabel };
