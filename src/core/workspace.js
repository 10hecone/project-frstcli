"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
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

function samePath(a, b) {
    const norm = (p) => path.resolve(p).replace(/[\\/]+$/, "");
    return process.platform === "win32" ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

// Message de confiance unique, réutilisé par la CLI, la TUI et la GUI.
function trustMessage(dir) {
    const lines = [
        `Faire confiance au dossier ${dir} ?`,
        "FRSTCLI.md, la liste du premier niveau du dossier et ce que lit le modèle " +
        "(fichiers, sorties de commandes) sont envoyés à ton fournisseur API."
    ];
    if (samePath(dir, os.homedir()) || path.dirname(dir) === dir) {
        lines.push(
            "ATTENTION : c'est ton dossier personnel ou la racine d'un disque. " +
            "Le modèle pourra y lire tous tes fichiers. Préfère ouvrir le dossier d'un projet précis."
        );
    }
    return lines.join("\n");
}

/** Ouvre un dossier. Renvoie false si l'utilisateur refuse de lui faire confiance (rien n'est ouvert). */
async function open(directory, { newConv = false } = {}) {
    const projects = require("../project/projects");
    const { ui } = require("../ui-bridge");
    const memory = require("../project/memory");
    const projectContext = require("../project/project-context");
    const real = await fs.realpath(path.resolve(directory));
    const info = await fs.stat(real);

    if (!info.isDirectory()) throw new Error("Le projet doit être un dossier.");

    const known = await projects.get(real);
    if (!(known && known.trusted) && !(await ui.confirm(trustMessage(real), { force: true }))) return false;

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

    emitChange();
    return true;
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

module.exports = { workspace, trustMessage };
