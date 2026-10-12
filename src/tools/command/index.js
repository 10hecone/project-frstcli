"use strict";

const path = require("path");

const { ui } = require("../../cli/ui");
const { state } = require("../../state");
const { parseCommand, formatCommand } = require("./parse");
const { runProcess } = require("./runner");

// Anciens noms de l'outil (avant la refonte), conservés pour compatibilité.
const LEGACY_COMMANDS = new Map([
    ["npm-test", "npm test"],
    ["git-status", "git status --short"],
    ["node-version", "node --version"]
]);

// Programmes jamais lancés : shells (ils contourneraient l'analyse de la
// commande), suppression ou formatage, élévation de privilèges, exécution indirecte.
const DENIED_PROGRAMS = new Set([
    "bash", "sh", "zsh", "fish", "cmd", "powershell", "pwsh",
    "rm", "rmdir", "rd", "del", "erase", "format", "mkfs", "dd",
    "sudo", "su", "xargs", "eval", "env"
]);

const NODE_EVAL_FLAGS = new Set(["-e", "-p", "--eval", "--print"]);

// "C:\\Tools\\Node.EXE" -> "node", "/usr/bin/rm" -> "rm".
function programName(file) {
    const base = path.win32.basename(String(file)).toLowerCase();
    const ext = path.win32.extname(base);
    return ext ? base.slice(0, -ext.length) : base;
}

function isNodeEvalFlag(arg) {
    const a = String(arg);
    if (NODE_EVAL_FLAGS.has(a)) return true;
    if (a.startsWith("--eval=") || a.startsWith("--print=")) return true;
    // Options courtes groupées, par exemple -pe.
    return /^-[a-z]{2,}$/i.test(a) && /[ep]/i.test(a);
}

function denialReason(file, args) {
    const name = programName(file);
    if (DENIED_PROGRAMS.has(name)) {
        return `Programme interdit : ${name}. Utilise les outils de fichiers ou une commande plus ciblée.`;
    }
    if (name === "node" && args.some(isNodeEvalFlag)) {
        return "Exécution de code en ligne (node -e / -p) interdite. Écris un script avec write_file puis lance-le.";
    }
    return null;
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
