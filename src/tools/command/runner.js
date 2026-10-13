"use strict";

const { spawn } = require("node:child_process");

const { IS_WINDOWS, filterEnv, killTree, resolveProgram } = require("./program");

/*
 * Lance un programme sans shell et collecte sa sortie de façon bornée.
 * Résultat : { exit_code, signal, timed_out, interrupted, duration_ms, output, truncated }.
 */

const DEFAULT_TIMEOUT_MS = 120000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 600000;

const HEAD_CHARS = 3000;
const TAIL_CHARS = 5000;
const MAX_OUTPUT_CHARS = HEAD_CHARS + TAIL_CHARS;
const MAX_LIVE_LINES = 200;
const MAX_PENDING_LINE = 4000;
const FORCE_FINISH_MS = 5000;

const LIVE_SUSPENDED = "[affichage direct suspendu, sortie complète renvoyée à l'agent]";

/** Garde le début, un tampon glissant de la fin et le total ; affiche les lignes en direct. */
function createCollector(onLine) {
    let head = "";
    let tail = "";
    let total = 0;
    let pending = "";
    let shown = 0;
    let live = typeof onLine === "function";

    function emit(line) {
        if (!live) return;

        if (shown >= MAX_LIVE_LINES) {
            live = false;
            pending = "";
            try { onLine(LIVE_SUSPENDED); } catch { /* affichage seulement */ }
            return;
        }

        shown++;
        try { onLine(line); } catch { /* affichage seulement */ }
    }

    return {
        push(text) {
            total += text.length;

            if (head.length < HEAD_CHARS) head += text.slice(0, HEAD_CHARS - head.length);

            tail = text.length >= TAIL_CHARS
                ? text.slice(-TAIL_CHARS)
                : (tail + text).slice(-TAIL_CHARS);

            if (!live) return;

            pending += text;
            const parts = pending.split("\n");
            pending = parts.pop();

            for (const part of parts) emit(part.replace(/\r$/, ""));

            if (live && pending.length > MAX_PENDING_LINE) {
                emit(pending);
                pending = "";
            }
        },

        flush() {
            if (live && pending) emit(pending.replace(/\r$/, ""));
            pending = "";
        },

        render() {
            if (total <= MAX_OUTPUT_CHARS) {
                const rest = total - head.length;
                return { output: head + (rest > 0 ? tail.slice(-rest) : ""), truncated: false };
            }

            const omitted = total - head.length - tail.length;

            return {
                output: `${head}\n[... ${omitted} caractères omis ...]\n${tail}`,
                truncated: true
            };
        }
    };
}

const clampTimeout = ms =>
    Number.isFinite(ms)
        ? Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(ms)))
        : DEFAULT_TIMEOUT_MS;

function launchError(name, error) {
    return error && error.code === "ENOENT"
        ? `Programme introuvable : ${name}`
        : `Lancement impossible (${name}) : ${error ? error.message : "erreur inconnue"}`;
}

async function runProcess({
    file,
    args = [],
    cwd = process.cwd(),
    timeoutMs,
    onLine,
    signalHandle,
    input,
    captureStdout = false,
    discardStdout = false,
    discardStderr = false,
    stderrToStdout = false
} = {}) {
    const MAX_PIPE_CHARS = 1000000;
    let stdoutText = "";
    if (typeof file !== "string" || !file) throw new Error("file doit être une chaîne non vide.");

    const env = filterEnv();
    const target = resolveProgram(file, args, cwd, env);
    const limit = clampTimeout(timeoutMs);
    const collector = createCollector(onLine);
    const started = Date.now();

    return new Promise(resolve => {
        let child = null;
        let timer = null;
        let forceTimer = null;
        let settled = false;
        let timedOut = false;
        let interrupted = false;

        function finish(exitCode, signal, message) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            clearTimeout(forceTimer);
            if (signalHandle) signalHandle.kill = () => {};
            collector.flush();

            const rendered = message === undefined
                ? collector.render()
                : { output: message, truncated: false };

            resolve({
                exit_code: exitCode,
                signal: signal || null,
                timed_out: timedOut,
                interrupted,
                duration_ms: Date.now() - started,
                ...rendered,
                stdout: stdoutText
            });
        }

        function stop() {
            if (settled) return;
            killTree(child);
            // Un petit-enfant peut garder les tubes ouverts : on n'attend pas indéfiniment.
            clearTimeout(forceTimer);
            forceTimer = setTimeout(() => finish(null, "SIGKILL"), FORCE_FINISH_MS);
        }

        try {
            child = spawn(target.file, target.args, {
                cwd,
                env,
                shell: false,
                stdio: [typeof input === "string" ? "pipe" : "ignore", "pipe", "pipe"],
                windowsHide: true,
                detached: !IS_WINDOWS,
                windowsVerbatimArguments: target.verbatim
            });
        } catch (error) {
            finish(null, null, launchError(file, error));
            return;
        }

        if (typeof input === "string" && child.stdin) {
            // Le programme peut fermer stdin sans tout lire (EPIPE) : ce n'est pas une erreur de la commande.
            child.stdin.on("error", () => {});
            child.stdin.end(input);
        }

        const capture = text => {
            if (stdoutText.length < MAX_PIPE_CHARS) stdoutText += text.slice(0, MAX_PIPE_CHARS - stdoutText.length);
        };

        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", text => {
            if (discardStdout) return;
            if (captureStdout) capture(text);
            else collector.push(text);
        });
        child.stderr?.on("data", text => {
            if (discardStderr) return;
            if (stderrToStdout && captureStdout && !discardStdout) capture(text);
            else collector.push(text);
        });

        child.on("error", error => finish(null, null, launchError(file, error)));
        child.on("close", (code, signal) => finish(code, signal));

        timer = setTimeout(() => {
            timedOut = true;
            stop();
        }, limit);

        if (signalHandle) {
            signalHandle.kill = () => {
                if (settled) return;
                interrupted = true;
                stop();
            };
        }
    });
}

module.exports = {
    runProcess,
    filterEnv,
    killTree,
    resolveProgram,
    DEFAULT_TIMEOUT_MS,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS
};
