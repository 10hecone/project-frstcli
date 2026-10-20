"use strict";

const TOOL_LABELS = {
    list_directory: "Lister",
    read_file: "Lire",
    search_files: "Chercher",
    create_directory: "Créer le dossier",
    write_file: "Écrire",
    edit_file: "Éditer",
    multi_edit: "Éditer (multiple)",
    move_path: "Déplacer",
    copy_path: "Copier",
    delete_path: "Supprimer",
    remember: "Mémoriser",
    run_command: "Commande"
};

function toolLabel(name) {
    return TOOL_LABELS[name] || String(name ?? "");
}

module.exports = { TOOL_LABELS, toolLabel };
