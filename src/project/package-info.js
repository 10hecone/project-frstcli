"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");

// Ordre de priorité si plusieurs lockfiles sont présents.
const LOCKFILES = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"]
];

/**
 * Gestionnaire de paquets (lockfile) et commande de test (package.json scripts.test).
 * Renvoie { packageManager, testCommand, testScript } ; null pour ce qui est inconnu.
 */
async function detectPackageInfo(workspace) {
    const info = { packageManager: null, testCommand: null, testScript: null };
    if (!workspace) return info;

    for (const [file, manager] of LOCKFILES) {
        const found = await fsp.access(path.join(workspace, file)).then(() => true, () => false);
        if (found) {
            info.packageManager = manager;
            break;
        }
    }

    try {
        const pkg = JSON.parse(await fsp.readFile(path.join(workspace, "package.json"), "utf8"));
        const script = pkg?.scripts?.test;
        if (typeof script === "string" && script.trim() && !/no test specified/i.test(script)) {
            info.testScript = script.trim();
            info.testCommand = `${info.packageManager || "npm"} test`;
        }
    } catch {
        // Pas de package.json, ou JSON invalide : commande de test inconnue.
    }

    return info;
}

module.exports = { detectPackageInfo, LOCKFILES };
