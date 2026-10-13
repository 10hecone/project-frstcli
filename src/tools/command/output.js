"use strict";

const fs = require("node:fs");
const path = require("node:path");

/*
 * Nettoyage de la sortie d'une commande avant de la renvoyer à l'agent :
 * séquences ANSI retirées, barres de progression et spinners supprimés,
 * lignes identiques consécutives repliées en [xN], lignes d'erreur placées en tête
 * quand la sortie doit être coupée. Aussi : détection des fichiers modifiés
 * (git status --porcelain avant / après) et champ description.
 */

const MAX_CLEAN_CHARS = 8000;
const MAX_ERROR_LINES = 20;
const MAX_DESCRIPTION_CHARS = 120;

const ANSI_PATTERN = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -\/]*[@-~]|\x1b[@-Z\\-_]|\x9b[0-?]*[ -\/]*[@-~]/g;
const PERCENT_OR_COUNT = /\d{1,3}(?:[.,]\d+)?\s?%|\b\d+\s?\/\s?\d+\b/;
const BAR = /[█▓▒░■□▰▱]{2,}|\[[=#>\-. ]{4,}\]/;
const SPINNER = /^[\u2800-\u28ff]/;
const ERROR_LINE = /\b(?:error|erreur|failed|failure|fatal|traceback|panic|not ok)\b|\b\w+(?:Error|Exception)\b|npm ERR!|[✖✗]/i;

function stripAnsi(text) {
    return String(text ?? "").replace(ANSI_PATTERN, "");
}

/** Une ligne réécrite avec \r (progression) : on ne garde que son dernier état. */
function lastCarriageSegment(line) {
    if (!line.includes("\r")) return line;
    const parts = line.split("\r").filter(part => part !== "");
    return parts.length ? parts[parts.length - 1] : "";
}

function isProgressLine(line) {
    const text = String(line).trim();
    if (!text) return false;
    if (SPINNER.test(text)) return true;
    return BAR.test(text) && PERCENT_OR_COUNT.test(text);
}

function isErrorLine(line) {
    return ERROR_LINE.test(String(line));
}

function collapseRepeats(lines) {
    const out = [];
    let previous = null;
    let count = 0;

    const flush = () => {
        if (previous === null) return;
        if (previous === "") out.push("");
        else out.push(count > 1 ? `${previous} [x${count}]` : previous);
    };

    for (const line of lines) {
        if (line === previous) {
            count++;
            continue;
        }
        flush();
        previous = line;
        count = 1;
    }
    flush();
    return out;
}

/**
 * Renvoie { output, truncated, error_lines }.
 * options.truncated : la sortie reçue était déjà coupée par le runner.
 */
function cleanOutput(text, { maxChars = MAX_CLEAN_CHARS, maxErrorLines = MAX_ERROR_LINES, truncated = false } = {}) {
    const lines = [];
    for (const raw of stripAnsi(text).split("\n")) {
        const line = lastCarriageSegment(raw).trimEnd();
        if (isProgressLine(line)) continue;
        lines.push(line);
    }

    const collapsed = collapseRepeats(lines);
    const cleaned = collapsed.join("\n").replace(/^\n+|\n+$/g, "");
    const errors = collapsed.filter(isErrorLine).slice(0, maxErrorLines);

    if (cleaned.length <= maxChars) {
        if (truncated && errors.length) {
            const header = `[lignes d'erreur]\n${errors.join("\n")}\n[sortie]\n`;
            return { output: header + cleaned, truncated: true, error_lines: errors.length };
        }
        return { output: cleaned, truncated, error_lines: errors.length };
    }

    const header = errors.length ? `[lignes d'erreur]\n${errors.join("\n")}\n[sortie]\n` : "";
    const budget = Math.max(200, maxChars - header.length);
    const headSize = Math.floor(budget * 0.3);
    const tailSize = budget - headSize;
    const omitted = cleaned.length - headSize - tailSize;

    return {
        output: `${header}${cleaned.slice(0, headSize)}\n[... ${omitted} caractères omis ...]\n${cleaned.slice(-tailSize)}`,
        truncated: true,
        error_lines: errors.length
    };
}

function parsePorcelain(text) {
    const entries = [];
    for (const line of String(text ?? "").split(/\r?\n/)) {
        if (line.length < 4) continue;
        let rel = line.slice(3);
        const arrow = rel.indexOf(" -> ");
        if (arrow !== -1) rel = rel.slice(arrow + 4);
        if (rel.startsWith('"') && rel.endsWith('"')) {
            try { rel = JSON.parse(rel); } catch { /* nom gardé tel quel */ }
        }
        entries.push({ status: line.slice(0, 2), rel });
    }
    return entries;
}

/** Empreinte des fichiers non propres selon git (statut + taille + date). null si git indisponible. */
async function snapshotChanges(runGit, root) {
    let result;
    try {
        result = await runGit(["--no-optional-locks", "status", "--porcelain", "--untracked-files=all"]);
    } catch {
        return null;
    }
    if (!result || result.exit_code !== 0) return null;

    const map = new Map();
    for (const { status, rel } of parsePorcelain(result.stdout ?? result.output)) {
        let signature = status;
        try {
            const info = fs.statSync(path.join(root, rel));
            signature += `:${info.size}:${info.mtimeMs}`;
        } catch {
            signature += ":absent";
        }
        map.set(rel, signature);
    }
    return map;
}

function diffSnapshots(before, after) {
    if (!before || !after) return null;
    const changed = new Set();
    for (const [rel, signature] of after) if (before.get(rel) !== signature) changed.add(rel);
    for (const rel of before.keys()) if (!after.has(rel)) changed.add(rel);
    return [...changed].sort();
}

function sanitizeDescription(value) {
    if (typeof value !== "string") return null;
    const text = value.replace(/\s+/g, " ").trim();
    return text ? text.slice(0, MAX_DESCRIPTION_CHARS) : null;
}

module.exports = {
    MAX_CLEAN_CHARS,
    MAX_ERROR_LINES,
    MAX_DESCRIPTION_CHARS,
    stripAnsi,
    lastCarriageSegment,
    isProgressLine,
    isErrorLine,
    collapseRepeats,
    cleanOutput,
    parsePorcelain,
    snapshotChanges,
    diffSnapshots,
    sanitizeDescription
};
