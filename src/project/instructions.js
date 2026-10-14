"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const INSTRUCTIONS_NAME = "FRSTCLI.md";
const MAX_INSTRUCTIONS_CHARS = 8_000;

function template({ testCommand } = {}) {
    return [
        "# Instructions du projet pour FranceStudent Code",
        "",
        "Ce fichier est lu à chaque demande et ajouté aux consignes de l'agent.",
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

/** Texte de FRSTCLI.md à la racine du projet, ou "" s'il n'existe pas. */
async function loadInstructions(workspace, maxChars = MAX_INSTRUCTIONS_CHARS) {
    if (!workspace) return "";

    let text;

    try {
        text = await fs.readFile(path.join(workspace, INSTRUCTIONS_NAME), "utf8");
    } catch {
        return "";
    }

    const value = text.replace(/^\uFEFF/, "").trim();

    return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n... [tronqué]`;
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
    loadInstructions,
    initInstructions,
    template
};
