"use strict";

// Historique persistant des saisies de la TUI (↑/↓ entre les sessions).
// Format : tableau JSON de chaînes, de la plus ancienne à la plus récente.

const fs = require("fs/promises");
const path = require("path");
const { writeAtomic } = require("../tools/core/atomic");

const HISTORY_LIMIT = 200;
const HISTORY_FILENAME = "input-history.json";
const MAX_RETRIES = 3;

function defaultFile() {
    const config = require("../config");
    const dataDir = (config.CONFIG || config).dataDir;
    return path.join(dataDir, HISTORY_FILENAME);
}

function resolveFile(options = {}) {
    if (options.file) return options.file;
    if (options.dir) return path.join(options.dir, HISTORY_FILENAME);
    return defaultFile();
}

async function readRaw(file) {
    try {
        return await fs.readFile(file, "utf8");
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }
}

function parse(raw) {
    if (raw == null) return [];
    try {
        const data = JSON.parse(raw);
        if (!Array.isArray(data)) return [];
        return data.filter((item) => typeof item === "string" && item.trim() !== "");
    } catch {
        return [];
    }
}

/** Ajoute `entry` à `entries` (sans doublon consécutif) puis tronque à `limit`. */
function appendEntry(entries, entry, limit = HISTORY_LIMIT) {
    if (typeof entry !== "string" || entry.trim() === "") return entries.slice(-limit);
    const next = entries[entries.length - 1] === entry ? entries.slice() : [...entries, entry];
    return next.slice(-limit);
}

function sameEntries(a, b) {
    return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** Charge l'historique. Si le fichier est absent ou illisible, renvoie un tableau vide. */
async function load(options = {}) {
    const limit = options.limit || HISTORY_LIMIT;
    try {
        return parse(await readRaw(resolveFile(options))).slice(-limit);
    } catch {
        return [];
    }
}

// Les ajouts faits par un même processus sont sérialisés.
let queue = Promise.resolve();

async function addNow(entry, options) {
    const file = resolveFile(options);
    const limit = options.limit || HISTORY_LIMIT;
    await fs.mkdir(path.dirname(file), { recursive: true });
    let lastError = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
        const raw = await readRaw(file);
        const current = parse(raw);
        const next = appendEntry(current, entry, limit);
        if (raw !== null && sameEntries(next, current)) return next;
        try {
            await writeAtomic(file, JSON.stringify(next, null, 2) + "\n", { expected: raw });
            return next;
        } catch (error) {
            // Un autre processus a écrit entre-temps : on relit puis on recommence.
            lastError = error;
            if (error.code !== "EEXIST" && !/a changé/.test(String(error.message))) throw error;
        }
    }
    throw lastError;
}

/** Ajoute une entrée et renvoie l'historique obtenu. */
function add(entry, options = {}) {
    const run = queue.then(() => addNow(entry, options));
    queue = run.catch(() => {});
    return run;
}

module.exports = { load, add, appendEntry, HISTORY_LIMIT, HISTORY_FILENAME };
