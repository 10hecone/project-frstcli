"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Branche git courante, lue dans .git/HEAD (sans lancer git). Remonte les
 * dossiers parents ; gère le fichier .git des worktrees. null si inconnue.
 * Utilisée par la barre d'état de la TUI et par /status.
 */
function gitBranch(dir = process.cwd()) {
    try {
        let current = path.resolve(String(dir || process.cwd()));
        for (;;) {
            const dotGit = path.join(current, ".git");
            if (fs.existsSync(dotGit)) {
                let gitDir = dotGit;
                if (fs.statSync(dotGit).isFile()) {
                    const match = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, "utf8"));
                    if (!match) return null;
                    gitDir = path.resolve(current, match[1].trim());
                }
                const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
                const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
                if (ref) return ref[1];
                return head ? head.slice(0, 7) : null;
            }
            const parent = path.dirname(current);
            if (parent === current) return null;
            current = parent;
        }
    } catch {
        return null;
    }
}

module.exports = { gitBranch };
