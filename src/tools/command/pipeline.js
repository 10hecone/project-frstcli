"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { parseCommand, formatCommand, CommandParseError, MAX_COMMAND_CHARS } = require("./parse");

/*
 * Découpe une ligne en segments reliés par && || ; |, sans jamais passer par un shell.
 * Chaque segment est ensuite analysé par parseCommand.
 * Refusés : & seul, $( ), backtick, $VAR, %VAR%, < et toute redirection vers un fichier.
 * Acceptés : 2>&1, >nul, >/dev/null (aussi 1> 2> >>), gérés par le CLI lui-même.
 */

const MAX_SEGMENTS = 8;

function fail(message) {
    throw new CommandParseError(message);
}

function checkExpansion(line, i) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === "`") fail("Backtick (`) interdit : la substitution de commande n'est pas prise en charge.");
    if (ch === "$" && next === "(") fail("$( ) interdit : la substitution de commande n'est pas prise en charge.");
    if (ch === "$" && next !== undefined && /[A-Za-z_{]/.test(next)) {
        fail("Variable $VAR interdite : aucune variable n'est développée (pas de shell). Écris la valeur directement.");
    }
    if (ch === "%" && /^%[A-Za-z_][A-Za-z0-9_]*%/.test(line.slice(i))) {
        fail("Variable %VAR% interdite : aucune variable n'est développée (pas de shell). Écris la valeur directement.");
    }
}

function emptyRedirect() {
    return { discardStdout: false, discardStderr: false, stderrToStdout: false };
}

function splitPipeline(line) {
    if (typeof line !== "string" || !line.trim()) fail("La commande doit être une chaîne non vide.");
    if (line.length > MAX_COMMAND_CHARS) {
        fail(`Commande trop longue (${line.length} caractères, maximum ${MAX_COMMAND_CHARS}).`);
    }
    if (line.includes("\0")) fail("Caractère nul interdit.");
    if (/[\r\n]/.test(line)) fail("Retour à la ligne interdit : enchaîne les commandes avec && ou ;.");

    const segments = [];
    let text = "";
    let quote = null;
    let redirect = emptyRedirect();

    function close(op) {
        if (!text.trim()) fail(`Commande manquante avant ${op}.`);
        if (segments.length >= MAX_SEGMENTS) fail(`Trop de commandes enchaînées (maximum ${MAX_SEGMENTS}).`);
        const { file, args } = parseCommand(text);
        segments.push({ file, args, display: formatCommand(file, args), op, ...redirect });
        text = "";
        redirect = emptyRedirect();
    }

    // Lit une redirection qui commence au ">" d'indice i ; renvoie l'indice du dernier caractère lu.
    function readRedirect(i) {
        let fd = 1;
        const match = /(^|[ \t])([12])$/.exec(text);
        if (match) {
            fd = Number(match[2]);
            text = text.slice(0, -1);
        }

        let j = i + 1;
        if (line[j] === "&") {
            if (fd === 2 && line[j + 1] === "1") {
                if (redirect.discardStdout) redirect.discardStderr = true;
                else redirect.stderrToStdout = true;
                return j + 1;
            }
            fail("Redirection >& interdite : seul 2>&1 est accepté.");
        }
        if (line[j] === ">") j++;
        while (line[j] === " " || line[j] === "\t") j++;
        let k = j;
        while (k < line.length && !/[ \t;&|<>]/.test(line[k])) k++;
        const target = line.slice(j, k);

        if (!/^(nul|\/dev\/null)$/i.test(target)) {
            fail(
                `Redirection vers un fichier interdite (${target || "cible vide"}). ` +
                "Seuls 2>&1, >nul et >/dev/null sont acceptés ; utilise write_file pour écrire un fichier."
            );
        }
        if (fd === 1) redirect.discardStdout = true;
        else redirect.discardStderr = true;
        return k - 1;
    }

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        const next = line[i + 1];

        if (quote === "'") {
            text += ch;
            if (ch === "'") quote = null;
            continue;
        }

        if (quote === '"') {
            if (ch === "\\" && (next === '"' || next === "\\")) {
                text += ch + next;
                i++;
                continue;
            }
            if (ch === '"') quote = null;
            else checkExpansion(line, i);
            text += ch;
            continue;
        }

        if (ch === "\\" && (next === '"' || next === "'" || next === " ")) {
            text += ch + next;
            i++;
            continue;
        }

        if (ch === "'" || ch === '"') {
            quote = ch;
            text += ch;
            continue;
        }

        if (ch === "&") {
            if (next === "&") {
                close("&&");
                i++;
                continue;
            }
            fail("& seul interdit : pas d'exécution en arrière-plan par le shell. Utilise && pour enchaîner.");
        }
        if (ch === "|") {
            if (next === "|") {
                close("||");
                i++;
            } else {
                close("|");
            }
            continue;
        }
        if (ch === ";") {
            close(";");
            continue;
        }
        if (ch === "<") fail("Redirection d'entrée < interdite : lis le fichier avec read_file.");
        if (ch === ">") {
            i = readRedirect(i);
            continue;
        }

        checkExpansion(line, i);
        text += ch;
    }

    if (quote) fail(`Guillemet ${quote} non fermé.`);

    if (!text.trim()) {
        const last = segments[segments.length - 1];
        if (last && last.op === ";") last.op = null;
        else if (last) fail(`Commande manquante après ${last.op}.`);
        else fail("La commande doit être une chaîne non vide.");
    } else {
        close(null);
    }

    return segments;
}

/** Regroupe les segments reliés par | ; op = opérateur qui suit la chaîne. */
function groupChains(segments) {
    const chains = [];
    let current = [];
    for (const segment of segments) {
        current.push(segment);
        if (segment.op !== "|") {
            chains.push({ segments: current, op: segment.op });
            current = [];
        }
    }
    if (current.length) chains.push({ segments: current, op: null });
    return chains;
}

function isInside(root, target) {
    const rel = path.relative(root, target);
    return rel === "" || (rel.split(path.sep)[0] !== ".." && !path.isAbsolute(rel));
}

/** Résout un dossier de travail ; il doit exister et rester dans le projet (liens résolus). */
function resolveDirectory(base, value, workspace) {
    const target = path.resolve(base, value);
    let stat;
    try {
        stat = fs.statSync(target);
    } catch {
        return { ok: false, message: `Dossier introuvable : ${value}` };
    }
    if (!stat.isDirectory()) return { ok: false, message: `Pas un dossier : ${value}` };

    let real;
    let realRoot;
    try {
        real = fs.realpathSync(target);
        realRoot = fs.realpathSync(workspace);
    } catch {
        return { ok: false, message: `Dossier illisible : ${value}` };
    }
    if (!isInside(realRoot, real)) return { ok: false, message: `Dossier hors du projet : ${value}` };
    return { ok: true, cwd: target };
}

function isCd(segment) {
    return String(segment.file).toLowerCase() === "cd";
}

function changeDirectory(segment, cwd, workspace) {
    if (segment.args.length > 1) return { ok: false, message: "cd : un seul argument (le dossier) est accepté." };
    if (segment.args.length === 0) return { ok: true, cwd: workspace };
    const result = resolveDirectory(cwd, segment.args[0], workspace);
    return result.ok ? result : { ok: false, message: `cd : ${result.message}` };
}

/** Dossier de départ : paramètre cwd (relatif au projet), sinon state.cwd s'il est valide, sinon le projet. */
function resolveStartDir(requested, remembered, workspace) {
    if (typeof requested === "string" && requested.trim()) {
        const result = resolveDirectory(workspace, requested.trim(), workspace);
        if (!result.ok) throw new Error(`Paramètre cwd refusé : ${result.message}`);
        return result.cwd;
    }
    if (typeof remembered === "string" && remembered) {
        const result = resolveDirectory(workspace, remembered, workspace);
        if (result.ok) return result.cwd;
    }
    return workspace;
}

/**
 * Exécute les segments dans l'ordre (|| et && sautent la chaîne suivante comme un shell).
 * run(segment, { cwd, input, pipeStdout }) lance un programme et renvoie un résultat de runProcess.
 * Les | sont séquentiels : la sortie complète d'un segment devient l'entrée du suivant.
 */
async function executePipeline(segments, { cwd, workspace, run }) {
    let current = cwd;
    let lastStatus = 0;
    let pipeStatus = [];
    let previousOp = null;
    let stopped = false;
    let last = null;
    const entries = [];

    for (const chain of groupChains(segments)) {
        const skip = stopped
            || (previousOp === "&&" && lastStatus !== 0)
            || (previousOp === "||" && lastStatus === 0);

        if (skip) {
            for (const segment of chain.segments) entries.push({ command: segment.display, skipped: true });
            previousOp = chain.op;
            continue;
        }

        pipeStatus = [];
        let input;
        for (let k = 0; k < chain.segments.length; k++) {
            const segment = chain.segments[k];
            const piped = k < chain.segments.length - 1;
            let result;

            if (isCd(segment)) {
                const moved = changeDirectory(segment, current, workspace);
                if (moved.ok) current = moved.cwd;
                result = {
                    exit_code: moved.ok ? 0 : 1,
                    signal: null,
                    timed_out: false,
                    interrupted: false,
                    duration_ms: 0,
                    output: moved.ok ? "" : moved.message,
                    truncated: false,
                    stdout: ""
                };
            } else {
                result = await run(segment, { cwd: current, input, pipeStdout: piped });
            }

            input = piped ? (result.stdout || "") : undefined;
            pipeStatus.push(result.exit_code ?? null);
            last = { command: segment.display, ...result };
            delete last.stdout;
            entries.push(last);

            if (result.timed_out || result.interrupted || result.exit_code === null || result.exit_code === undefined) {
                stopped = true;
                break;
            }
        }

        const status = pipeStatus[pipeStatus.length - 1];
        lastStatus = Number.isInteger(status) ? status : 1;
        previousOp = chain.op;
    }

    return { cwd: current, entries, pipe_status: pipeStatus, last, stopped };
}

module.exports = {
    MAX_SEGMENTS,
    splitPipeline,
    groupChains,
    executePipeline,
    changeDirectory,
    resolveStartDir,
    isCd,
    isInside
};
