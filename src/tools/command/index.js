"use strict";

const { ui } = require("../../cli/ui");
const { state } = require("../../state");
const { parseCommand, formatCommand } = require("./parse");
const { runProcess } = require("./runner");
const { judge } = require("./policy");

// Anciens noms de l'outil (avant la refonte), conservés pour compatibilité.
const LEGACY_COMMANDS = new Map([
    ["npm-test", "npm test"],
    ["git-status", "git status --short"],
    ["node-version", "node --version"]
]);

// Renvoie le motif de refus de judge(), ou null si la commande n'est pas interdite.
function denialReason(file, args = [], cwd = state.workspace) {
    const verdict = judge({ file, args, cwd, workspace: state.workspace || cwd });
    return verdict.level === "deny" ? verdict.reason : null;
}

function resolveCommandLine(toolArgs) {
    const command = toolArgs?.command;
    if (typeof command === "string" && command.trim() !== "") return command;

    const name = toolArgs?.name;
    if (typeof name === "string" && name.trim() !== "") {
        const legacy = LEGACY_COMMANDS.get(name.trim());
        if (!legacy) {
            throw new Error(`Commande inconnue : ${name}. Utilise le paramètre "command" (ex. "npm test").`);
        }
        return legacy;
    }

    throw new Error('Paramètre "command" manquant.');
}

function formatDuration(ms) {
    const seconds = Math.max(0, Number(ms) || 0) / 1000;
    return `${seconds.toFixed(1).replace(".", ",")} s`;
}

function buildMessage(result) {
    if (result.timed_out) return "Délai dépassé.";
    if (result.interrupted) return "Interrompu par l'utilisateur.";
    if (result.exit_code === null || result.exit_code === undefined) {
        if (result.signal) return `Arrêté par le signal ${result.signal}.`;
        return result.output || "Impossible de lancer la commande.";
    }
    return `Terminé (code ${result.exit_code}) en ${formatDuration(result.duration_ms)}.`;
}

async function runCommand(toolArgs = {}) {
    if (!state.workspace) {
        throw new Error("Aucun projet sélectionné.");
    }

    const line = resolveCommandLine(toolArgs);

    // Les CommandParseError remontent telles quelles (message destiné à l'agent).
    const { file, args } = parseCommand(line);
    const display = formatCommand(file, args);

    const reason = denialReason(file, args);
    if (reason) {
        return { command: display, changed: false, denied: true, message: reason };
    }

    // Toujours demander, même si l'utilisateur a choisi "tout autoriser".
    const approved = await ui.confirm(`Lancer "${display}" dans le projet ?`, { force: true });
    if (!approved) {
        return {
            command: display,
            changed: false,
            denied: true,
            message: "Action refusée par l'utilisateur. Ne la redemande pas."
        };
    }

    // runProcess remplace signalHandle.kill par la fonction d'arrêt réelle.
    const signalHandle = { kill() {} };
    const off = ui.onInterrupt(() => signalHandle.kill());

    let result;
    try {
        result = await runProcess({
            file,
            args,
            cwd: state.workspace,
            timeoutMs: toolArgs.timeout_ms,
            onLine: (text) => ui.commandLine(text),
            signalHandle
        });
    } finally {
        off();
    }

    return {
        command: display,
        changed: false,
        exit_code: result.exit_code,
        signal: result.signal,
        timed_out: result.timed_out,
        interrupted: result.interrupted,
        duration_ms: result.duration_ms,
        truncated: result.truncated,
        output: result.output,
        message: buildMessage(result)
    };
}

module.exports = { runCommand, formatCommand, denialReason };
