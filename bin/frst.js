#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const BUNDLE_PATH = path.join(__dirname, "..", "dist", "tui.mjs");
const MISSING_BUNDLE_MESSAGE = "TUI indisponible : dist/tui.mjs est absent (lance npm run build:tui). Ouverture de l'interface classique.";

// Décide quelle interface lancer : "classic" (ancien CLI) ou "tui" (Ink).
function chooseInterface({ argv = [], env = {}, isTTY = false, hasBundle = false, warn } = {}) {
    if (argv.includes("--classic")) return "classic";
    if (String(env.FRST_UI || "").trim().toLowerCase() === "classic") return "classic";
    if (!isTTY) return "classic";
    if (!hasBundle) {
        if (typeof warn === "function") warn(MISSING_BUNDLE_MESSAGE);
        return "classic";
    }
    return "tui";
}

// `frst mcp …` : gestion des serveurs MCP hors session (ni TUI ni connexion France Student).
function isMcpCommand(argv = []) {
    return argv[0] === "mcp";
}

// Exécute `frst mcp …` et renvoie le code de sortie (0 si réussi, 1 sinon).
// `run` et `stop` sont injectables pour les tests.
async function runMcp(argv = [], { run, stop } = {}) {
    const execute = run ?? require("../src/mcp/cli").runMcpCommand;
    let code = 1;
    try {
        const result = await execute(argv.slice(1));
        code = result && result.ok ? 0 : 1;
    } finally {
        try {
            const halt = typeof stop === "function" ? stop : () => require("../src/mcp/manager").getManager().killAll();
            halt();
        } catch {
        }
    }
    return code;
}

function runClassic() {
    const index = process.argv.indexOf("--classic");
    if (index !== -1) process.argv.splice(index, 1);
    const { run } = require("../src/main");
    return run();
}

// Restaure le terminal après un plantage de la TUI : mode brut désactivé, curseur visible.
function restoreTerminal({ stdin = process.stdin, stdout = process.stdout } = {}) {
    try {
        if (stdin && stdin.isTTY && typeof stdin.setRawMode === "function") stdin.setRawMode(false);
    } catch {
    }
    try {
        if (stdout && typeof stdout.write === "function") stdout.write("\u001b[?25h");
    } catch {
    }
}

async function main() {
    try {
        require("dotenv").config({ quiet: true });
    } catch {
    }

    const args = process.argv.slice(2);
    if (isMcpCommand(args)) {
        // Sortie explicite : un serveur stdio ou readline ne doit pas garder le processus en vie.
        process.exit(await runMcp(args));
    }

    const choice = chooseInterface({
        argv: process.argv.slice(2),
        env: process.env,
        isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
        hasBundle: fs.existsSync(BUNDLE_PATH),
        warn: (message) => console.error(message),
    });

    if (choice === "classic") return runClassic();

    try {
        await import(pathToFileURL(BUNDLE_PATH).href);
    } catch (error) {
        restoreTerminal();
        console.error(`Impossible de lancer la TUI : ${error && error.message ? error.message : error}`);
        console.error("Ouverture de l'interface classique.");
        return runClassic();
    }
}

if (require.main === module) {
    main().catch((error) => {
        restoreTerminal();
        console.error(error && error.message ? error.message : error);
        process.exitCode = 1;
    });
}

module.exports = { chooseInterface, restoreTerminal, isMcpCommand, runMcp, BUNDLE_PATH, MISSING_BUNDLE_MESSAGE };
