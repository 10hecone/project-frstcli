#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const BUNDLE_PATH = path.join(__dirname, "..", "dist", "tui.mjs");
const MISSING_BUNDLE_MESSAGE = "TUI indisponible : dist/tui.mjs est absent (lance npm run build:tui).";
const NOT_TTY_MESSAGE = "La TUI demande un terminal interactif (entrée et sortie standard attachées à un terminal).";

// Vérifie que la TUI peut démarrer : renvoie { ok: true } ou { ok: false, message }.
function checkTui({ isTTY = false, hasBundle = false } = {}) {
    if (!isTTY) return { ok: false, message: NOT_TTY_MESSAGE };
    if (!hasBundle) return { ok: false, message: MISSING_BUNDLE_MESSAGE };
    return { ok: true };
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

// `frst --help`, `frst --version` ou arguments invalides : { code, message } à afficher sans lancer la TUI ;
// null quand la TUI doit démarrer (elle relit les arguments elle-même).
function launchInfo(argv = []) {
    const { parseLaunchArgs, USAGE } = require("../src/cli/launch-args");
    const options = parseLaunchArgs(argv);
    if (options.help) return { code: 0, message: USAGE };
    if (options.version) return { code: 0, message: `frst ${require("../package.json").version}` };
    if (options.error) return { code: 1, message: options.error };
    return null;
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

    // Aide, version et erreurs d'arguments : réponse immédiate, sans terminal interactif ni connexion.
    const early = launchInfo(args);
    if (early) {
        if (early.code === 0) console.log(early.message);
        else console.error(early.message);
        process.exitCode = early.code;
        return;
    }

    const check = checkTui({
        isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
        hasBundle: fs.existsSync(BUNDLE_PATH),
    });
    if (!check.ok) {
        console.error(check.message);
        process.exitCode = 1;
        return;
    }

    try {
        await import(pathToFileURL(BUNDLE_PATH).href);
    } catch (error) {
        restoreTerminal();
        console.error(`Impossible de lancer la TUI : ${error && error.message ? error.message : error}`);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch((error) => {
        restoreTerminal();
        console.error(error && error.message ? error.message : error);
        process.exitCode = 1;
    });
}

module.exports = { checkTui, restoreTerminal, isMcpCommand, runMcp, launchInfo, BUNDLE_PATH, MISSING_BUNDLE_MESSAGE, NOT_TTY_MESSAGE };
