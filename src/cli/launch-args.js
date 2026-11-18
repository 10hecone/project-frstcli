"use strict";

/**
 * Arguments de lancement de `frst` (hors `frst mcp …`, traité à part).
 * Aucun effet de bord : utilisé par bin/frst.js (aide, erreurs) et par la TUI (ouverture du dossier).
 */

const USAGE = [
    "Usage : frst [options] [dossier]",
    "",
    "Lance FranceStudent Code dans le dossier courant (ou <dossier>).",
    "Les fichiers FRSTCLI.md du dossier et de ses parents sont lus comme instructions.",
    "",
    "Options :",
    "  -c, --continue    Reprendre la dernière session du dossier",
    "  -r, --resume      Choisir une session du dossier à reprendre",
    "  --no-project      Chat sans dossier ni outils locaux",
    "  -h, --help        Afficher cette aide",
    "  -v, --version     Afficher la version",
    "",
    "Commandes :",
    "  frst mcp …        Gérer les serveurs MCP (frst mcp help)",
    "",
    "Dans la session : /help liste les commandes, Shift+Tab change de mode.",
].join("\n");

/**
 * argv sans « node » ni le script → { dir, continue, resume, noProject, help, version, error }.
 * dir vaut null quand aucun dossier n'est donné (la TUI prend alors process.cwd()).
 */
function parseLaunchArgs(argv = []) {
    const options = { dir: null, continue: false, resume: false, noProject: false, help: false, version: false, error: null };
    const fail = (message) => ({ ...options, error: message });

    for (const arg of argv) {
        const value = String(arg);
        if (value === "-h" || value === "--help") options.help = true;
        else if (value === "-v" || value === "--version") options.version = true;
        else if (value === "-c" || value === "--continue") options.continue = true;
        else if (value === "-r" || value === "--resume") options.resume = true;
        else if (value === "--no-project") options.noProject = true;
        else if (value.startsWith("-") && value !== "-") return fail(`Option inconnue : ${value} (frst --help).`);
        else if (options.dir !== null) return fail(`Un seul dossier attendu (reçu « ${options.dir} » et « ${value} »).`);
        else options.dir = value;
    }

    if (options.continue && options.resume) return fail("--continue et --resume ne peuvent pas être combinés.");
    if (options.noProject && (options.dir !== null || options.continue || options.resume)) {
        return fail("--no-project ne s'utilise ni avec un dossier, ni avec --continue / --resume.");
    }
    return options;
}

module.exports = { parseLaunchArgs, USAGE };
