"use strict";

const readline = require("node:readline");
const path = require("node:path");
const { CONFIG } = require("../config");
const { state } = require("../state");

const COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

const paint = code => text =>
    COLOR ? `\x1b[${code}m${text}\x1b[0m` : String(text);

const c = {
    bold: paint("1"),
    dim: paint("2"),
    red: paint("31"),
    green: paint("32"),
    yellow: paint("33"),
    cyan: paint("36"),
    gray: paint("90")
};

/* ---------- Entrée utilisateur ---------- */

let rl = null;
let closed = false;

function getInterface() {
    if (!rl) {
        rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.on("close", () => { closed = true; });
    }
    return rl;
}

/** Renvoie la réponse, ou null si l'entrée est fermée (Ctrl+D / Ctrl+C). */
function ask(question) {
    const r = getInterface();

    if (closed) return Promise.resolve(null);

    return new Promise(resolve => {
        const onClose = () => resolve(null);
        r.once("close", onClose);
        r.question(question, answer => {
            r.off("close", onClose);
            resolve(answer);
        });
    });
}

/** Comme ask, mais sans afficher la saisie (mot de passe). */
function askSecret(question) {
    const r = getInterface();

    if (closed) return Promise.resolve(null);

    if (!process.stdin.isTTY) return ask(question);

    const original = r._writeToOutput;
    let muted = false;

    r._writeToOutput = function (text) {
        if (!muted) original.call(this, text);
    };

    const pending = ask(question);

    muted = true;

    return pending.finally(() => {
        r._writeToOutput = original;
        process.stdout.write("\n");
    });
}

const CONTINUATION = "... ";
const BLOCK_FENCE = "\"\"\"";

/** Lit des lignes jusqu'à une ligne """ seule. Capte aussi les collages de plusieurs lignes. */
function readBlock(r) {
    return new Promise(resolve => {
        const lines = [];
        const cleanup = () => {
            r.off("line", onLine);
            r.off("close", onClose);
        };
        const onLine = line => {
            if (line.trim() === BLOCK_FENCE) {
                cleanup();
                resolve(lines.join("\n"));
                return;
            }
            lines.push(line);
            r.setPrompt(c.gray(CONTINUATION));
            r.prompt();
        };
        const onClose = () => {
            cleanup();
            resolve(lines.length ? lines.join("\n") : null);
        };
        r.on("line", onLine);
        r.once("close", onClose);
        r.setPrompt(c.gray(CONTINUATION));
    });
}

// Délai max entre deux lignes pour considérer qu'il s'agit d'un collage.
const PASTE_GAP_MS = 40;

/** Lit le texte du presse-papier du système, ou "" s'il est vide ou illisible. */
function readClipboard() {
    const { execFile } = require("node:child_process");
    const [cmd, args] = process.platform === "win32"
        ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
            "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Clipboard -Raw"]]
        : process.platform === "darwin"
            ? ["pbpaste", []]
            : ["sh", ["-c", "wl-paste --no-newline 2>/dev/null || xclip -selection clipboard -o 2>/dev/null || xsel -b -o"]];
    return new Promise(resolve => {
        execFile(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 10 * 1024 * 1024 },
            (error, stdout) => resolve(error ? "" : String(stdout || "")));
    });
}

/**
 * Lit un message sur r, ligne par ligne :
 * - les lignes reçues à moins de gapMs d'intervalle (collage) forment un seul message ;
 * - si un collage se termine sans retour à la ligne, on attend Entrée ;
 * - une ligne terminée par « \ » continue sur la ligne suivante ;
 * - Échap efface toute la saisie en cours.
 * Renvoie null si l'entrée est fermée.
 */
function collectInput(r, question, { gapMs = PASTE_GAP_MS, keys = process.stdin, out = process.stdout, clipboard = readClipboard } = {}) {
    return new Promise(resolve => {
        const promptText = String(question).replace(/^\n+/, "");
        const leading = String(question).slice(0, String(question).length - promptText.length);
        const lines = [];
        let timer = null;

        const finish = value => {
            done = true;
            clearTimeout(timer);
            r.off("line", onLine);
            r.off("close", onClose);
            detachKeys();
            resolve(value);
        };

        const onClose = () => finish(null);

        const flush = () => {
            if (r.line) return;
            finish(lines.join("\n"));
        };

        const onLine = line => {
            clearTimeout(timer);
            if (line.endsWith("\\")) {
                lines.push(line.slice(0, -1));
                r.setPrompt(c.dim("... "));
                r.prompt();
                return;
            }
            lines.push(line);
            timer = setTimeout(flush, gapMs);
        };

        let allSelected = false;
        let internal = false;

        const send = key => {
            internal = true;
            try { r.write(null, key); } finally { internal = false; }
        };

        const clearAll = () => {
            clearTimeout(timer);
            send({ ctrl: true, name: "e" });
            send({ ctrl: true, name: "u" });
            if (lines.length) {
                lines.length = 0;
                r.setPrompt(promptText);
                out?.write(`\n${c.dim("(saisie effacée)")}\n`);
                r.prompt();
            }
        };

        let highlighted = false;

        const paintLine = inverse => {
            if (!r.line || !out || typeof r.getCursorPos !== "function") return;
            send({ ctrl: true, name: "e" });
            const { rows } = r.getCursorPos();
            if (rows) readline.moveCursor(out, 0, -rows);
            readline.cursorTo(out, 0);
            readline.clearScreenDown(out);
            const shown = typeof r.getPrompt === "function" ? r.getPrompt() : promptText;
            out.write(shown + (inverse ? `\x1b[7m${r.line}\x1b[27m` : r.line));
        };

        const redraw = on => {
            if (highlighted === on) return;
            highlighted = on;
            paintLine(on);
        };

        let done = false;

        const insertText = text => {
            internal = true;
            try { r.write(text); } finally { internal = false; }
        };

        const pasteClipboard = async () => {
            let text = "";
            try { text = await clipboard(); } catch { text = ""; }
            if (done) return;
            const parts = String(text || "").replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
            if (!parts.join("")) {
                out?.write(`\n${c.dim("(presse-papier vide)")}\n`);
                r.prompt();
                return;
            }
            if (allSelected) {
                allSelected = false;
                highlighted = false;
                clearAll();
            }
            insertText(parts[0]);
            if (parts.length === 1) return;
            const first = r.line;
            send({ ctrl: true, name: "e" });
            send({ ctrl: true, name: "u" });
            clearTimeout(timer);
            lines.push(first, ...parts.slice(1, -1));
            out?.write(`\n${c.dim(`(${parts.length} lignes collées, Entrée pour envoyer)`)}\n`);
            r.setPrompt(c.dim("... "));
            r.prompt();
            insertText(parts[parts.length - 1]);
        };

        const handleKey = (s, key) => {
            if (internal) return false;
            if (key?.ctrl && key.name === "v") {
                pasteClipboard();
                return true;
            }
            if (key?.ctrl && key.name === "a") {
                allSelected = true;
                redraw(true);
                return true;
            }
            if (key?.name === "escape") {
                allSelected = false;
                highlighted = false;
                clearAll();
                return true;
            }
            if (!allSelected) return false;
            allSelected = false;
            if (key?.name === "backspace" || key?.name === "delete") {
                highlighted = false;
                clearAll();
                return true;
            }
            const printable = typeof s === "string" && s.length > 0 && !key?.ctrl && !key?.meta &&
                !["return", "enter", "tab"].includes(key?.name);
            if (printable) {
                highlighted = false;
                clearAll();
                return false;
            }
            redraw(false);
            return false;
        };

        let detachKeys = () => {};

        r.on("line", onLine);
        r.once("close", onClose);
        if (typeof r._ttyWrite === "function") {
            const original = r._ttyWrite;
            r._ttyWrite = function (s, key) {
                if (!handleKey(s, key)) original.call(this, s, key);
            };
            detachKeys = () => { r._ttyWrite = original; };
        } else if (keys) {
            const onKey = (s, key) => { handleKey(s, key); };
            keys.on("keypress", onKey);
            detachKeys = () => keys.off("keypress", onKey);
        }
        if (leading) out?.write(leading);
        r.setPrompt(promptText);
        r.prompt();
    });
}

/**
 * Saisie multi-ligne :
 * - une ligne finissant par \ continue sur la ligne suivante ;
 * - """ seul ouvre un bloc (collage possible), fermé par """ seul.
 * Renvoie null si l'entrée est fermée.
 */
async function askMultiline(question) {
    const first = await ask(question);
    if (first === null) return null;

    if (first.trim() === BLOCK_FENCE) {
        if (closed) return null;
        return readBlock(getInterface());
    }

    const lines = [];
    let line = first;
    while (line !== null && line.endsWith("\\")) {
        lines.push(line.slice(0, -1));
        line = await ask(c.gray(CONTINUATION));
    }
    if (line !== null) lines.push(line);
    return lines.join("\n");
}

/** Saisie du prompt principal : collage multiligne, « \ » en fin de ligne, Échap pour effacer. */
function askInput(question) {
    const r = getInterface();

    if (closed) return Promise.resolve(null);

    if (!process.stdin.isTTY) return ask(question);

    return collectInput(r, question);
}

function closeInput() {
    rl?.close();
}

/* ---------- Rendu ---------- */

const { TOOL_LABELS } = require("../tool-labels");

/* ---------- Markdown léger : voir src/markdown.js ---------- */

const {
    renderInline,
    renderMarkdownLine,
    renderMarkdownLite,
    createMarkdownStream
} = require("../markdown");

const ui = {
    banner() {
        const plain = [
            "✻ FranceStudent CLI",
            "/help pour l'aide | /project <dossier> pour coder",
            `agent ${state.model} | web ${state.webSearch ? "on" : "off"} | mode ${state.mode}`
        ];
        const styled = [
            `${c.cyan("✻")} ${c.bold("FranceStudent CLI")}`,
            c.dim(plain[1]),
            c.dim(plain[2])
        ];
        const width = Math.max(...plain.map(l => l.length)) + 2;

        console.log(c.gray(`╭${"─".repeat(width)}╮`));
        styled.forEach((line, i) => {
            const pad = " ".repeat(width - plain[i].length - 1);
            console.log(`${c.gray("│")} ${line}${pad}${c.gray("│")}`);
        });
        console.log(c.gray(`╰${"─".repeat(width)}╯`));
    },

    prompt() {
        const where = state.workspace
            ? c.dim(path.basename(state.workspace)) + " "
            : "";
        const auto = state.autoApprove ? c.yellow("auto ") : "";
        return `\n${where}${auto}> `;
    },

    tool(name, arg) {
        console.log(
            `\n${c.bold(TOOL_LABELS[name] || name)}` +
            c.gray(`(${arg ?? ""})`)
        );
    },

    result(text, { tone } = {}) {
        const body = tone === "error" ? c.red(text) : c.dim(text);
        console.log(`  ${c.gray("⎿")}  ${body}`);
    },

    info(text) {
        console.log(`${c.dim(text)}`);
    },

    debug(text) {
        if (CONFIG.debug) console.log(`${c.gray(text)}`);
    },

    warn(text) {
        console.log(`${c.yellow("!")} ${c.yellow(text)}`);
    },

    error(text) {
        console.error(`\n${c.red("Erreur :")} ${c.red(text)}`);
    },

    assistant(text) {
        console.log(`\n${renderMarkdownLite(text)}`);
    },

    plan(items) {
        console.log(`\n${c.bold("Plan")}`);
        items.forEach((item, i) => {
            console.log(`  ${c.gray(`${i + 1}.`)} ${c.dim(item)}`);
        });
    },

    spinner(label) {
        if (!process.stdout.isTTY) {
            return { update() {}, stop() {} };
        }

        const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
        const started = Date.now();
        let i = 0;
        let text = label;
        let active = true;

        const timer = setInterval(() => {
            const sec = Math.floor((Date.now() - started) / 1000);
            process.stdout.write(
                `\r\x1b[2K${c.cyan(frames[i++ % frames.length])} ` +
                `${c.dim(`${text}... (${sec}s)`)}` 
            );
        }, 80);

        return {
            update(next) { text = next; },
            stop() {
                if (!active) return;
                active = false;
                clearInterval(timer);
                process.stdout.write("\r\x1b[2K");
            }
        };
    },

    /**
     * Demande une confirmation. Réponses : o/oui, t = tout autoriser
     * pour le reste de la session. Toute autre réponse refuse.
     * Avec { force: true } : ignore l'auto-approbation et ne propose pas "t".
     */
    async confirm(question, { force = false } = {}) {
        if (!force && state.autoApprove) return true;

        const hint = force ? "[o/N]" : "[o/N | t = tout autoriser]";
        const raw = await ask(
            `\n${c.bold(question)} ${c.dim(hint)} `
        );
        const answer = String(raw ?? "").trim().toLowerCase();

        if (!force && ["t", "tout", "a", "all"].includes(answer)) {
            state.autoApprove = true;
            ui.warn("Auto-approbation activée pour cette session (/auto off pour la couper).");
            return true;
        }

        return ["o", "oui", "y", "yes"].includes(answer);
    },

    /**
     * Confirmation d'une commande : o = une fois, t = toujours (règle enregistrée
     * pour ce projet), toute autre réponse refuse. Renvoie la réponse brute.
     * N'utilise jamais l'auto-approbation.
     */
    async askCommand(question, prefixText) {
        const hint = `[o/N | t = toujours « ${prefixText} »]`;
        return ask(`\n${c.bold(question)} ${c.dim(hint)} `);
    },

    askSecret,

    /**
     * Ctrl+C pendant une commande : appelle handler au lieu de fermer le CLI.
     * Renvoie une fonction qui retire l'écouteur.
     */
    onInterrupt(handler) {
        const r = getInterface();
        r.on("SIGINT", handler);
        return () => r.off("SIGINT", handler);
    },

    /** Ligne de sortie d'une commande, affichée en direct. */
    commandLine(text) {
        console.log(c.gray(`    ${text}`));
    },

    /** Affiche une ligne ou un tableau de lignes, sans mise en forme. */
    print(lines) {
        const list = Array.isArray(lines) ? lines : [lines];
        for (const line of list) console.log(line == null ? "" : String(line));
    },

    /** Flux Markdown progressif : write(chunk) puis end() pour vider le tampon. */
    stream(options) {
        const md = createMarkdownStream(options);
        return {
            write: chunk => md.write(chunk),
            end: () => md.flush()
        };
    },

    /**
     * Affiche un diff produit par buildDiff({ lines, added, removed }).
     * Renvoie { added, removed }.
     */
    diff(data) {
        const { renderDiff } = require("../tools/diff");
        return renderDiff(data);
    },

    ask
};

module.exports = {
    ui, c, ask, askInput, collectInput, askSecret, askMultiline, closeInput,
    renderInline, renderMarkdownLine, renderMarkdownLite, createMarkdownStream
};
