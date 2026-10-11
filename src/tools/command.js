"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");
const { ui } = require("../cli/ui");
const { state } = require("../state");

const TIMEOUT_MS = 60000;
const MAX_OUTPUT_CHARS = 8000;

const NPM_TEST = process.platform === "win32"
    ? {
        file: process.execPath,
        args: [path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), "test"]
    }
    : { file: "npm", args: ["test"] };

const ALLOWED_COMMANDS = {
    "npm-test": { label: "npm test", ...NPM_TEST },
    "git-status": { label: "git status --short", file: "git", args: ["status", "--short"] },
    "node-version": { label: "node --version", file: "node", args: ["--version"] }
};

function runProcess(file, args, cwd) {
    return new Promise(resolve => {
        const child = spawn(file, args, { cwd, shell: false, windowsHide: true });
        let output = "";
        let timedOut = false;

        const collect = chunk => {
            if (output.length <= MAX_OUTPUT_CHARS) output += chunk.toString("utf8");
        };

        child.stdout.on("data", collect);
        child.stderr.on("data", collect);

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, TIMEOUT_MS);

        child.on("error", error => {
            clearTimeout(timer);
            resolve({ code: null, timedOut, output: error.message });
        });

        child.on("close", code => {
            clearTimeout(timer);
            resolve({ code, timedOut, output });
        });
    });
}

async function runCommand(args = {}) {
    const spec = Object.hasOwn(ALLOWED_COMMANDS, args.name) ? ALLOWED_COMMANDS[args.name] : null;

    if (!spec) {
        throw new Error(`Commande non autorisée. Valeurs possibles : ${Object.keys(ALLOWED_COMMANDS).join(", ")}.`);
    }

    if (!state.workspace) throw new Error("Aucun projet sélectionné.");

    if (!(await ui.confirm(`Lancer « ${spec.label} » dans le projet ?`))) {
        return { command: args.name, changed: false, denied: true, message: "Action refusée par l'utilisateur. Ne la redemande pas." };
    }

    const result = await runProcess(spec.file, spec.args, state.workspace);
    const output = result.output.length > MAX_OUTPUT_CHARS
        ? `${result.output.slice(0, MAX_OUTPUT_CHARS)}\n…[sortie tronquée]`
        : result.output;

    return {
        command: args.name,
        changed: false,
        exit_code: result.code,
        timed_out: result.timedOut,
        output,
        message: result.timedOut ? "Délai dépassé." : `Terminé (code ${result.code}).`
    };
}

module.exports = { runCommand, ALLOWED_COMMANDS };
