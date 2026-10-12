"use strict";

const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Lance un programme sans shell et collecte sa sortie de façon bornée.
 * Résultat : { exit_code, signal, timed_out, interrupted, duration_ms, output, truncated }.
 */

const IS_WINDOWS = process.platform === "win32";

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
const SENSITIVE_NAME = /TOKEN|SECRET|KEY|PASSWORD|PASSWD|CREDENTIAL/i;
const UNSAFE_CMD_ARG = /[\^%!&|<>"]/;

/** Copie de l'environnement sans les variables sensibles. */
function filterEnv(env = process.env) {
    const out = {};

    for (const [name, value] of Object.entries(env)) {
        if (/^FS_/i.test(name) || SENSITIVE_NAME.test(name)) continue;
        out[name] = value;
    }

    return out;
}

function getEnv(env, name) {
    const key = Object.keys(env).find(k => k.toUpperCase() === name);
    return key === undefined ? undefined : env[key];
}

/** Arrête le processus et ses descendants (Unix : groupe, Windows : taskkill /T). */
function killTree(child) {
    if (!child || !child.pid) return;

    if (IS_WINDOWS) {
        execFile(
            "taskkill",
            ["/pid", String(child.pid), "/T", "/F"],
            { windowsHide: true },
            error => {
                if (error) {
                    try { child.kill(); } catch { /* déjà arrêté */ }
                }
            }
        );
        return;
    }

    try {
        process.kill(-child.pid, "SIGKILL");
    } catch {
        try { child.kill("SIGKILL"); } catch { /* déjà arrêté */ }
    }
}

function isFile(target) {
    try {
        return fs.statSync(target).isFile();
    } catch {
        return false;
    }
}

/** Cherche un programme comme Windows : PATH + PATHEXT. */
function findOnWindows(name, cwd, env) {
    const exts = (getEnv(env, "PATHEXT") || ".COM;.EXE;.BAT;.CMD")
        .split(";")
        .filter(Boolean);
    const names = path.extname(name)
        ? [name, ...exts.map(e => name + e)]
        : exts.map(e => name + e);
    const hasDir = name.includes("/") || name.includes("\\");
    const dirs = hasDir
        ? [cwd]
        : (getEnv(env, "PATH") || "").split(";").filter(Boolean);

    for (const dir of dirs) {
        for (const candidate of names) {
            const full = path.resolve(dir, candidate);
            if (isFile(full)) return full;
        }
    }

    return null;
}

const quoteForCmd = arg => (arg === "" || /\s/.test(arg) ? `"${arg}"` : arg);

/** Programme réellement lancé : { file, args, verbatim }. */
function resolveProgram(file, args, cwd, env) {
    if (!IS_WINDOWS) return { file, args, verbatim: false };

    const lower = file.toLowerCase();

    if (lower === "npm" || lower === "npx") {
        const cli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", `${lower}-cli.js`);
        return { file: process.execPath, args: [cli, ...args], verbatim: false };
    }

    const resolved = findOnWindows(file, cwd, env);

    if (!resolved) return { file, args, verbatim: false };

    if (/\.(cmd|bat)$/i.test(resolved)) {
        const unsafe = [resolved, ...args].find(arg => UNSAFE_CMD_ARG.test(arg));

        if (unsafe !== undefined) {
            throw new Error(
                `${path.basename(resolved)} est un script .cmd/.bat lancé via cmd.exe : ` +
                `les caractères ^ % ! & | < > " sont interdits dans ses arguments (reçu : ${unsafe}).`
            );
        }

        const line = [resolved, ...args].map(quoteForCmd).join(" ");

        return {
            file: getEnv(env, "COMSPEC") || "cmd.exe",
            args: ["/d", "/s", "/c", `"${line}"`],
            verbatim: true
        };
    }

    return { file: resolved, args, verbatim: false };
}

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

async function runProcess({ file, args = [], cwd = process.cwd(), timeoutMs, onLine, signalHandle } = {}) {
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
                ...rendered
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
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true,
                detached: !IS_WINDOWS,
                windowsVerbatimArguments: target.verbatim
            });
        } catch (error) {
            finish(null, null, launchError(file, error));
            return;
        }

        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", text => collector.push(text));
        child.stderr?.on("data", text => collector.push(text));

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
