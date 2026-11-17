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

// Commandes virtuelles exécutées dans le processus : toujours seules sur la ligne.
const VIRTUAL_COMMANDS = new Set(["mcp-call", "bg-run", "bg-output", "bg-stop"]);
const isVirtual = segment => !isCd(segment) && VIRTUAL_COMMANDS.has(programName(segment.file));

// Temps laissé à bg-run pour montrer les premières lignes (ou une erreur immédiate).
const BG_START_WAIT_MS = 2000;

// Question posée avant de lancer un segment ; prefixText vide = pas de réponse « Toujours ».
function confirmationOf(segment, verdict) {
    const name = programName(segment.file);
    const prefix = suggestPrefix(segment.file, segment.args);
    if (name === "mcp-call") {
        return { prefix, question: describeMcpCall(segment.args, { annotations: cachedAnnotations(segment.args) }) };
    }
    const background = name === "bg-run";
    const inner = background ? segment.display.replace(/^\S+\s+/, "") : segment.display;
    if (verdict?.alwaysAsk) {
        const where = background ? "en arrière-plan " : "";
        const script = verdict.script ? `\nScript complet :\n${verdict.script}` : "";
        return { prefix: null, question: `Lancer PowerShell ${where}dans le projet ? "${inner}"${script}` };
    }
    if (background) return { prefix, question: `Lancer en arrière-plan "${inner}" dans le projet ?` };
    return { prefix, question: `Lancer "${segment.display}" dans le projet ?` };
}

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
    if (result.timed_out) {
        return "Délai dépassé. Pour un serveur ou une commande longue (rojo serve, npm run dev), utilise bg-run <commande>.";
    }
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
        if (decision === "ask") pending.push({ segment, verdict });
    }

    // safe ou règle enregistrée : pas de question. Sinon o / n / t, jamais l'auto-approbation.
    // PowerShell (alwaysAsk) : o / n seulement, aucune règle possible.
    for (const { segment, verdict } of pending) {
        const { prefix, question } = confirmationOf(segment, verdict);
        const prefixText = prefix ? formatPrefix(prefix) : "";
        const answer = parseAnswer(await ui.askCommand(question, prefixText));
        if (answer === "no") {
            return { denied: true, message: "Action refusée par l'utilisateur. Ne la redemande pas." };
        }
        if (answer === "always" && prefix && store) {
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

// bg-run <commande> : lancée sans délai, arrêtée à la sortie du CLI ou au changement de projet.
async function startBackground(segment, cwd, description) {
    const jobs = require("./jobs");
    jobs.bindWorkspace();
    const [file, ...args] = segment.args;
    const command = segment.display.replace(/^\S+\s+/, "");
    let job;
    try {
        job = jobs.manager.start({
            command,
            description,
            cwd: relativeCwd(cwd),
            origin: "bg-run",
            launch: ({ onLine, signalHandle }) => runProcess({ file, args, cwd, noTimeout: true, onLine, signalHandle })
        });
    } catch (error) {
        return { command: segment.display, description, changed: false, denied: true, message: error.message };
    }
    await jobs.manager.wait(job.id, BG_START_WAIT_MS);
    const result = jobs.manager.output(job.id);
    const running = result.status === "running";
    const next = running
        ? `Lancé en arrière-plan : ${job.id}. Lis sa sortie avec bg-output ${job.id}, arrête-le avec bg-stop ${job.id}.`
        : `${jobs.statusMessage(result)} (lancé avec bg-run)`;
    return {
        command: segment.display,
        description,
        background: true,
        job_id: job.id,
        status: result.status,
        cwd: result.cwd,
        changed: false,
        exit_code: result.exit_code,
        truncated: result.truncated,
        error_lines: result.error_lines,
        output: result.output,
        message: next
    };
}

// bg-output / bg-stop : seulement pour les jobs lancés avec bg-run (pas ceux de l'utilisateur).
async function backgroundJob(name, segment, description) {
    const { manager: jobManager, statusMessage } = require("./jobs");
    const base = { command: segment.display, description, changed: false };
    const own = jobManager.list().filter(job => job.origin === "bg-run");
    const id = segment.args[0];
    if (!id) {
        const lines = own.map(job => `${job.id} ${job.status} : ${job.command}`);
        return { ...base, jobs: own, message: lines.length ? lines.join("\n") : "Aucun job lancé avec bg-run." };
    }
    if (!own.some(job => job.id === id)) {
        const known = own.map(job => job.id).join(", ") || "aucun";
        return { ...base, denied: true, message: `Job inconnu ou non lancé avec bg-run : ${id}. Jobs bg-run : ${known}.` };
    }
    if (name === "bg-stop") await jobManager.stop(id);
    const result = jobManager.output(id);
    return { ...base, ...result, command: segment.display, description, changed: false, message: statusMessage(result) };
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

    // mcp-call et bg-* ne sont pas de vrais programmes : ni tube, ni enchaînement, ni redirection.
    const virtual = segments.find(isVirtual);
    if (virtual && segments.length > 1) {
        return {
            command: display,
            description,
            changed: false,
            denied: true,
            message: `${programName(virtual.file)} se lance seul : pas de |, &&, || ni ; avec une autre commande.`
        };
    }
    const virtualName = virtual ? programName(virtual.file) : null;
    if (virtualName && virtualName !== "mcp-call" && (virtual.discardStdout || virtual.discardStderr || virtual.stderrToStdout)) {
        return { command: display, description, changed: false, denied: true, message: `${virtualName} : pas de redirection.` };
    }

    const permission = await confirmSegments(segments, startCwd);
    if (permission.denied) {
        return { command: display, description, changed: false, denied: true, message: permission.message };
    }

    if (virtualName === "bg-run") return startBackground(virtual, startCwd, description);
    if (virtualName === "bg-output" || virtualName === "bg-stop") return backgroundJob(virtualName, virtual, description);

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
