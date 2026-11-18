"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const INSTRUCTIONS_NAME = "FRSTCLI.md";
const MAX_INSTRUCTIONS_CHARS = 8_000;

function template({ testCommand } = {}) {
    return [
        "# Instructions du projet",
        "",
        "Ce fichier est lu au début de chaque conversation (et après /compact) et transmis au modèle.",
        "Garde-le court : seulement ce qui doit être respecté à chaque fois.",
        "",
        "## Commandes",
        `- Tests : ${testCommand || "(à compléter)"}`,
        "",
        "## Conventions",
        "- Langue des messages et commentaires : français",
        "- Format des commits : `prefixe: description en minuscules`",
        "",
        "## À éviter",
        "- (à compléter)",
        ""
    ].join("\n");
}

async function readInstructions(file) {
    try {
        return (await fs.readFile(file, "utf8")).replace(/^\uFEFF/, "").trim();
    } catch {
        return "";
    }
}

/**
 * FRSTCLI.md non vides du dossier et de ses parents : [{ path, text }],
 * le plus éloigné en premier, le plus proche (celui du dossier) en dernier.
 */
async function instructionFiles(workspace) {
    if (!workspace) return [];

    const found = [];
    let dir = path.resolve(workspace);
    for (;;) {
        const file = path.join(dir, INSTRUCTIONS_NAME);
        const text = await readInstructions(file);
        if (text) found.unshift({ path: file, text });
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return found;
}

/**
 * Texte des FRSTCLI.md (dossier et parents, le plus proche en dernier pour primer), ou "" s'il n'y en a pas.
 * Un seul fichier : son texte tel quel ; plusieurs : chacun précédé de son chemin.
 */
async function loadInstructions(workspace, maxChars = MAX_INSTRUCTIONS_CHARS) {
    const files = await instructionFiles(workspace);
    if (!files.length) return "";

    const value = files.length === 1
        ? files[0].text
        : files.map((file) => `[${file.path}]\n${file.text}`).join("\n\n");

    return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n... [tronqué]`;
}

/**
 * Bloc FRSTCLI.md à placer dans le premier message d'une conversation,
 * ou "" si le projet n'a pas de FRSTCLI.md (ou s'il est vide).
 */
async function instructionsBlock(workspace) {
    const text = await loadInstructions(workspace);
    return text
        ? `Conventions du dépôt (${INSTRUCTIONS_NAME}, à appliquer aux tâches concernant ce projet) :\n${text}`
        : "";
}

/** Crée FRSTCLI.md s'il n'existe pas. Ne remplace jamais un fichier existant. */
async function initInstructions(workspace, options = {}) {
    if (!workspace) throw new Error("Aucun projet sélectionné.");

    const target = path.join(workspace, INSTRUCTIONS_NAME);

    try {
        await fs.writeFile(target, template(options), { encoding: "utf8", flag: "wx" });
        return { created: true, path: target };
    } catch (error) {
        if (error.code === "EEXIST") return { created: false, path: target };
        throw error;
    }
}

module.exports = {
    INSTRUCTIONS_NAME,
    MAX_INSTRUCTIONS_CHARS,
    instructionFiles,
    loadInstructions,
    instructionsBlock,
    initInstructions,
    template
};
