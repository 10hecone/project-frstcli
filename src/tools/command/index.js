"use strict";

const path = require("node:path");

const { ui } = require("../../ui-bridge");
const { state } = require("../../state");
const memory = require("../../project/memory");
const { formatCommand } = require("./parse");
const { runProcess } = require("./runner");
const { judge, programName } = require("./policy");
const { describeMcpCall, parseMcpArgs } = require("../../mcp/policy");
const { runMcpCall } = require("../../mcp/call");
const { splitPipeline, executePipeline, resolveStartDir, isCd } = require("./pipeline");
const { cleanOutput, snapshotChanges, diffSnapshots, sanitizeDescription } = require("./output");
const {
    createStore,
    defaultFile,
    decide,
    parseAnswer,
    suggestPrefix,
    formatPrefix
} = require("./permissions");
const { workspace } = require("../../core/workspace");

let cachedStore = null;

// Règles du projet ouvert, ou null si aucun projet n'est ouvert dans la mémoire.
function getPermissionStore() {
    let file;
    try {
        file = defaultFile();
    } catch {
        return null;
    }
    if (!cachedStore || cachedStore.file !== file) cachedStore = createStore(file);
    return cachedStore;
}

// Anciens noms de l'outil (avant la refonte), conservés pour compatibilité.
const LEGACY_COMMANDS = new Map([
    ["npm-test", "npm test"],
    ["git-status", "git status --short"],
    ["node-version", "node --version"]
]);

const GIT_STATUS_TIMEOUT_MS = 10000;

const isMcpCall = segment => !isCd(segment) && programName(segment.file) === "mcp-call";

// Annotations de l'outil visé (cache du serveur déjà connecté), ou null : jamais de connexion ici.
function cachedAnnotations(args) {
    try {
        const parsed = parseMcpArgs(args);
        if (parsed.error || parsed.help || parsed.action !== "run" || !parsed.server) return null;
        const { getManager } = require("../../mcp/manager");
        const tools = getManager().peek(parsed.server)?.cache?.tools;
        const tool = Array.isArray(tools) ? tools.find(item => item?.name === parsed.target) : null;
        return tool?.annotations || null;
    } catch {
        return null;
    }
}

// Lance un segment : mcp-call est exécuté dans le processus, le reste par runProcess.
function runSegment(segment, options) {
    if (isMcpCall(segment)) {
        return runMcpCall({
            args: segment.args,
            cwd: options.cwd,
            workspace: workspace.root,
            timeoutMs: options.timeoutMs,
            signalHandle: options.signalHandle,
            onLine: options.onLine
        });
    }
    return runProcess({
        file: segment.file,
        args: segment.args,
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
        onLine: options.onLine,
        signalHandle: options.signalHandle,
        input: options.input,
        captureStdout: options.pipeStdout,
        discardStdout: segment.discardStdout,
        discardStderr: segment.discardStderr,
        stderrToStdout: segment.stderrToStdout
    });
}

// Renvoie le motif de refus de judge(), ou null si la commande n'est pas interdite.
function denialReason(file, args = [], cwd = workspace.root) {
    const verdict = judge({ file, args, cwd, workspace: workspace.root || cwd });
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

function relativeCwd(cwd) {
    const rel = path.relative(workspace.root, cwd);
    return rel === "" ? "." : rel.split(path.sep).join("/");
}

// git status interne (sans questionni affichage) ; null si git est absent ou hors dépôt.
function runGitStatus(args) {
    return runProcess({
        file: "git",
        args,
        cwd: workspace.root,
        timeoutMs: GIT_STATUS_TIMEOUT_MS,
        captureStdout: true
    });
}

// Vérifie chaque segment avant de lancer quoi que ce soit : un seul deny bloque toute la ligne.
async function confirmSegments(segments, cwd) {
    const store = getPermissionStore();
    const rules = store ? await store.rules() : [];
    const pending = [];
    const several = segments.length > 1;

    for (const segment of segments) {
        if (isCd(segment)) continue;
        const verdict = judge({ file: segment.file, args: segment.args, cwd, workspace: workspace.root });
        const decision = decide({ verdict, rules, file: segment.file, args: segment.args });
        if (decision === "deny") {
            const reason = verdict?.reason || "Commande interdite.";
            return { denied: true, message: several ? `${segment.display} : ${reason}` : reason };
        }
        if (decision === "ask") pending.push(segment);
    }

    // safe ou règle enregistrée : pas de question. Sinon o / n / t, jamais l'auto-approbation.
    for (const segment of pending) {
        const prefix = suggestPrefix(segment.file, segment.args);
        const prefixText = formatPrefix(prefix);
        const question = programName(segment.file) === "mcp-call"
            ? describeMcpCall(segment.args, { annotations: cachedAnnotations(segment.args) })
            : `Lancer "${segment.display}" dans le projet ?`;
        const answer = parseAnswer(await ui.askCommand(question, prefixText));
        if (answer === "no") {
            return { denied: true, message: "Action refusée par l'utilisateur. Ne la redemande pas." };
        }
        if (answer === "always" && store) {
            try {
                await store.add(prefix);
                ui.info(`Règle ajoutée : « ${prefixText} » (/permissions pour la gérer).`);
            } catch (error) {
                ui.warn(`Règle non enregistrée : ${error.message}`);
            }
        }
    }

    return { denied: false };
}

async function runCommand(toolArgs = {}) {
    if (!workspace.root) {
        throw new Error("Aucun projet sélectionné.");
    }

    const line = resolveCommandLine(toolArgs);
    const description = sanitizeDescription(toolArgs.description);

    // Les CommandParseError remontent telles quelles (message destiné à l'agent).
    const segments = splitPipeline(line);
    const startCwd = resolveStartDir(toolArgs.cwd, state.cwd, workspace.root);
    const display = segments.length === 1 ? segments[0].display : line.trim();

    // mcp-call n'est pas un vrai programme : ni tube, ni enchaînement, ni redirection.
    if (segments.length > 1 && segments.some(isMcpCall)) {
        return {
            command: display,
            description,
            changed: false,
            denied: true,
            message: "mcp-call se lance seul : pas de |, &&, || ni ; avec une autre commande."
        };
    }

    const permission = await confirmSegments(segments, startCwd);
    if (permission.denied) {
        return { command: display, description, changed: false, denied: true, message: permission.message };
    }

    if (toolArgs.background === true) {
        const { manager: jobManager } = require("./jobs");
        const job = jobManager.start({
            command: display,
            description,
            cwd: relativeCwd(startCwd),
            launch: ({ onLine, signalHandle }) => executePipeline(segments, {
                cwd: startCwd,
                workspace: workspace.root,
                run: (segment, { cwd, input, pipeStdout }) => runSegment(segment, {
                    cwd,
                    timeoutMs: toolArgs.timeout_ms ?? 600000,
                    onLine,
                    signalHandle,
                    input,
                    pipeStdout
                })
            }).then(run => run.last)
        });
        return {
            command: display,
            description,
            background: true,
            job_id: job.id,
            status: job.status,
            cwd: job.cwd,
            changed: false,
            message: `Lancé en arrière-plan : ${job.id}. Suis-le avec /jobs, arrête-le avec /jobs stop ${job.id}.`
        };
    }

    const before = await snapshotChanges(runGitStatus, workspace.root);

    // runProcess remplace signalHandle.kill par la fonction d'arrêt réelle de chaque segment.
    const signalHandle = { kill() {} };
    const off = ui.onInterrupt(() => signalHandle.kill());

    let run;
    try {
        run = await executePipeline(segments, {
            cwd: startCwd,
            workspace: workspace.root,
            run: (segment, { cwd, input, pipeStdout }) => runSegment(segment, {
                cwd,
                timeoutMs: toolArgs.timeout_ms,
                onLine: (text) => ui.commandLine(text),
                signalHandle,
                input,
                pipeStdout
            })
        });
    } finally {
        off();
    }

    // Le cd interne est conservé pour les commandes suivantes.
    state.cwd = run.cwd;

    // Fichiers modifiés par la commande : leurs lectures ne sont plus valables (relecture obligatoire).
    const after = before ? await snapshotChanges(runGitStatus, workspace.root) : null;
    const filesChanged = diffSnapshots(before, after);
    if (filesChanged) {
        for (const rel of filesChanged) memory.dropPath(rel);
    }

    const last = run.last;
    const executed = run.entries.filter(entry => !entry.skipped);
    const totalMs = executed.reduce((sum, entry) => sum + (entry.duration_ms || 0), 0);

    let output;
    let truncated;
    let errorLines;
    if (segments.length === 1) {
        const cleaned = cleanOutput(last.output, { truncated: last.truncated });
        output = cleaned.output;
        truncated = cleaned.truncated;
        errorLines = cleaned.error_lines;
    } else {
        const raw = run.entries
            .map(entry => (entry.skipped
                ? `$ ${entry.command}\n[non lancée]`
                : `$ ${entry.command}\n${entry.output || ""}`.trimEnd()))
            .join("\n");
        const cleaned = cleanOutput(raw, { truncated: executed.some(entry => entry.truncated) });
        output = cleaned.output;
        truncated = cleaned.truncated;
        errorLines = cleaned.error_lines;
    }

    return {
        command: display,
        description,
        changed: Array.isArray(filesChanged) && filesChanged.length > 0,
        files_changed: filesChanged,
        cwd: relativeCwd(run.cwd),
        exit_code: last.exit_code,
        signal: last.signal,
        timed_out: last.timed_out,
        interrupted: last.interrupted,
        duration_ms: totalMs,
        truncated,
        error_lines: errorLines,
        output,
        segments: run.entries.map(entry => (entry.skipped
            ? { command: entry.command, skipped: true }
            : { command: entry.command, exit_code: entry.exit_code ?? null, duration_ms: entry.duration_ms })),
        pipe_status: run.pipe_status,
        message: buildMessage({ ...last, output, duration_ms: totalMs })
    };
}

module.exports = { runCommand, formatCommand, denialReason, getPermissionStore };
