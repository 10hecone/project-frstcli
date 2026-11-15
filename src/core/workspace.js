"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { state, resetConversation, setConversation } = require("../state");

// ui-bridge, memory et project-context sont chargés dans open() et close() : les outils et la
// sécurité lisent `workspace.root`, et ce chargement différé évite tout import circulaire.

/*
 * Cœur commun CLI / TUI / GUI : le dossier ouvert.
 *
 * La racine reste stockée dans `state.workspace` (source unique) : `workspace.root`
 * en est la lecture. Les interfaces ne l'écrivent pas : elles passent par `open()` et `close()`.
 */

const listeners = new Set();

function emitChange() {
    for (const listener of [...listeners]) {
        try {
            listener({ root: state.workspace });
        } catch {
            // Un abonné défaillant ne doit pas empêcher l'ouverture ou la fermeture.
        }
    }
}

// Chemin relatif à la racine (séparateurs "/"), ou null si le chemin est hors du dossier ouvert.
function relative(target) {
    const root = state.workspace;
    if (!root || typeof target !== "string" || !target) return null;

    const rel = path.relative(root, path.resolve(root, target));
    if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) return null;

    return rel.split(path.sep).join("/");
}

// Vérification purement lexicale (les liens symboliques sont traités par les outils fichiers).
function contains(target) {
    return relative(target) !== null;
}

function onChange(listener) {
    if (typeof listener !== "function") throw new TypeError("onChange attend une fonction.");
    listeners.add(listener);
    return () => listeners.delete(listener);
}

async function open(directory, { newConv = false } = {}) {
    const projects = require("../project/projects");
    const { ui } = require("../ui-bridge");
    const memory = require("../project/memory");
    const projectContext = require("../project/project-context");
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

    emitChange();
}

function close() {
    const memory = require("../project/memory");
    const projectContext = require("../project/project-context");

    state.workspace = null;
    resetConversation();
    memory.close();
    projectContext.clear();
    emitChange();
}

const workspace = {
    // Dossiers supplémentaires (/add-dir) : vide pour l'instant.
    extraDirs: [],
    get root() {
        return state.workspace;
    },
    open,
    close,
    contains,
    relative,
    onChange
};

module.exports = { workspace };
