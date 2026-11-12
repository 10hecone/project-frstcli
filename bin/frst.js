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
        require("dotenv").config();
    } catch {
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

module.exports = { chooseInterface, restoreTerminal, BUNDLE_PATH, MISSING_BUNDLE_MESSAGE };
