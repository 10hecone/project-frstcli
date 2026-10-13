"use strict";

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const IS_WINDOWS = process.platform === "win32";

const SENSITIVE_NAME = /TOKEN|SECRET|KEY|PASSWORD|PASSWD|CREDENTIAL/i;
const UNSAFE_CMD_ARG = /[\^%!&|<>"]/;

/** Copie de l'environnement sans les variables sensibles. */
function filterEnv(env = process.env) {
    const out = {};

    for (const [name, value] of Object.entries(env)) {
        if (/^FS_/i.test(name) || SENSITIVE_NAME.test(name)) continue;
        // FORCE_COLOR est retiré : avec NO_COLOR, Node afficherait un avertissement sur stderr.
        if (/^FORCE_COLOR$/i.test(name)) continue;
        out[name] = value;
    }

    // Sortie sans couleurs pour l'agent ; les séquences restantes sont retirées par output.js.
    out.NO_COLOR = "1";

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

module.exports = { IS_WINDOWS, filterEnv, getEnv, killTree, findOnWindows, resolveProgram };
