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

function closeInput() {
    rl?.close();
}

/* ---------- Rendu ---------- */

const TOOL_LABELS = {
    list_directory: "Lister",
    read_file: "Lire",
    search_files: "Chercher",
    create_directory: "Créer le dossier",
    write_file: "Écrire",
    edit_file: "Éditer",
    move_path: "Déplacer",
    copy_path: "Copier",
    delete_path: "Supprimer",
    remember: "Mémoriser",
    run_command: "Commande"
};

function renderMarkdownLite(text) {
    return String(text)
        .replace(/\*\*(.+?)\*\*/g, (_, t) => c.bold(t))
        .replace(/`([^`\n]+)`/g, (_, t) => c.cyan(t));
}

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

    result(text) {
        console.log(`  ${c.gray("⎿")}  ${c.dim(text)}`);
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
    }
};

module.exports = { ui, c, ask, askSecret, askMultiline, closeInput };
