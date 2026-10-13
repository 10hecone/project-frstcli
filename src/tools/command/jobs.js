"use strict";

const { cleanOutput } = require("./output");

const MAX_JOBS = 3;
const MAX_BUFFER_CHARS = 200000;
const STOP_WAIT_MS = 5000;

// Gestionnaire de commandes lancées en arrière-plan (background:true).
// launch({ onLine, signalHandle }) doit renvoyer une promesse du résultat de runProcess.
function createJobManager({ maxJobs = MAX_JOBS, maxBufferChars = MAX_BUFFER_CHARS, now = Date.now } = {}) {
    const jobs = new Map();
    let nextId = 1;

    function isRunning(job) {
        return job.status === "running";
    }

    function summary(job) {
        return {
            id: job.id,
            command: job.command,
            description: job.description,
            cwd: job.cwd,
            status: job.status,
            exit_code: job.exit_code,
            signal: job.signal,
            duration_ms: (job.ended_at ?? now()) - job.started_at,
            unread_chars: job.total - job.read
        };
    }

    function append(job, text) {
        if (typeof text !== "string" || text === "") return;
        const chunk = text.endsWith("\n") ? text : `${text}\n`;
        job.buffer += chunk;
        job.total += chunk.length;
        if (job.buffer.length > maxBufferChars) job.buffer = job.buffer.slice(-maxBufferChars);
    }

    function finish(job, result) {
        job.ended_at = now();
        job.exit_code = result?.exit_code ?? null;
        job.signal = result?.signal ?? null;
        if (!job.received && result?.output) append(job, result.output);
        if (job.stopping) job.status = "stopped";
        else if (result?.timed_out) job.status = "timed_out";
        else job.status = job.exit_code === 0 ? "done" : "failed";
    }

    function get(id) {
        const job = jobs.get(String(id ?? "").trim());
        if (!job) {
            throw new Error(`Job inconnu : ${id}. Jobs existants : ${[...jobs.keys()].join(", ") || "aucun"}.`);
        }
        return job;
    }

    function runningCount() {
        return [...jobs.values()].filter(isRunning).length;
    }

    function start({ command, description = null, cwd = ".", launch }) {
        if (typeof launch !== "function") throw new Error("launch doit être une fonction.");
        const active = runningCount();
        if (active >= maxJobs) {
            throw new Error(`Déjà ${active} job(s) en cours (maximum ${maxJobs}). Arrête-en un avec job_stop.`);
        }

        const job = {
            id: `job-${nextId++}`,
            command,
            description,
            cwd,
            status: "running",
            started_at: now(),
            ended_at: null,
            exit_code: null,
            signal: null,
            buffer: "",
            total: 0,
            read: 0,
            received: false,
            stopping: false,
            handle: { kill() {} }
        };

        let promise;
        try {
            promise = Promise.resolve(launch({
                signalHandle: job.handle,
                onLine: (text) => {
                    job.received = true;
                    append(job, text);
                }
            }));
        } catch (error) {
            promise = Promise.reject(error);
        }

        job.done = promise.then(
            result => finish(job, result),
            error => {
                append(job, `Erreur : ${error?.message || error}`);
                finish(job, null);
            }
        );
        jobs.set(job.id, job);
        return summary(job);
    }

    // Renvoie la sortie produite depuis la dernière lecture (les plus anciennes lignes peuvent être perdues).
    function output(id) {
        const job = get(id);
        const kept = job.total - job.buffer.length;
        const from = Math.max(job.read, kept);
        const missed = from - job.read;
        const raw = job.buffer.slice(from - kept);
        job.read = job.total;
        const cleaned = cleanOutput(raw, { truncated: missed > 0 });
        return {
            ...summary(job),
            output: cleaned.output,
            truncated: cleaned.truncated,
            missed_chars: missed,
            error_lines: cleaned.error_lines
        };
    }

    async function stop(id, { waitMs = STOP_WAIT_MS } = {}) {
        const job = get(id);
        if (isRunning(job)) {
            job.stopping = true;
            try {
                job.handle.kill();
            } catch {
                // processus déjà terminé
            }
            let timer;
            await Promise.race([job.done, new Promise(resolve => { timer = setTimeout(resolve, waitMs); })]);
            clearTimeout(timer);
        }
        return summary(job);
    }

    function list() {
        return [...jobs.values()].map(summary);
    }

    async function stopAll() {
        await Promise.all([...jobs.values()].filter(isRunning).map(job => stop(job.id)));
    }

    function killAll() {
        for (const job of jobs.values()) {
            if (!isRunning(job)) continue;
            job.stopping = true;
            try {
                job.handle.kill();
            } catch {
                // processus déjà terminé
            }
        }
    }

    return { start, output, stop, list, stopAll, killAll, runningCount, get: id => summary(get(id)) };
}

function statusMessage(job) {
    const seconds = `${(Math.max(0, job.duration_ms) / 1000).toFixed(1).replace(".", ",")} s`;
    switch (job.status) {
        case "running": return `${job.id} en cours depuis ${seconds}.`;
        case "stopped": return `${job.id} arrêté après ${seconds}.`;
        case "timed_out": return `${job.id} : délai dépassé après ${seconds}.`;
        default: return `${job.id} terminé (code ${job.exit_code}) en ${seconds}.`;
    }
}

const manager = createJobManager();

// À la sortie du CLI, aucun job ne doit survivre : arrêt synchrone (process.on("exit") n'attend pas).
process.once("exit", () => manager.killAll());

function jobOutput(args = {}) {
    const result = manager.output(args.id);
    return { ...result, changed: false, message: statusMessage(result) };
}

async function jobStop(args = {}) {
    const result = await manager.stop(args.id);
    return { ...result, changed: false, message: statusMessage(result) };
}

module.exports = { MAX_JOBS, createJobManager, manager, jobOutput, jobStop, statusMessage };
