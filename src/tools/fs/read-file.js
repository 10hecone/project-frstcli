"use strict";

const { CONFIG } = require("../../config");
const { state } = require("../../state");
const { resolveInWorkspace } = require("../security");
const memory = require("../../project/memory");
const { requireString, optionalInt } = require("../core/args");
const { readTextFile } = require("../core/freshness");

async function readFile(args = {}) {
    requireString(args.path, "path");

    const { rel, target } = await resolveInWorkspace(state.workspace, args.path);
    const text = await readTextFile(target);
    const lines = text.split("\n");
    const total = lines.length;

    let content = text;
    let partial = false;
    let range = null;

    if (args.start_line !== undefined || args.end_line !== undefined) {
        const start = Math.max(1, Math.floor(args.start_line ?? 1));
        const end = Math.min(total, Math.floor(args.end_line ?? total));

        if (start > end) {
            throw new Error(`Plage invalide : le fichier a ${total} lignes.`);
        }

        content = lines.slice(start - 1, end).join("\n");
        partial = start > 1 || end < total;
        range = [start, end];
    }

    let truncated = false;

    if (content.length > CONFIG.maxReadChars) {
        content = content.slice(0, CONFIG.maxReadChars);
        truncated = true;
        partial = true;
    }

    // L'empreinte porte toujours sur le fichier COMPLET présent sur le disque.
    memory.rememberFile(rel, text, { partial });

    return {
        path: rel,
        total_lines: total,
        range,
        truncated,
        content,
        message: truncated
            ? "Fichier tronqué : utilise start_line/end_line pour lire la suite, et edit_file pour modifier."
            : "Fichier lu."
    };
}

function check(args) {
    requireString(args.path, "path");
    optionalInt(args.start_line, "start_line");
    optionalInt(args.end_line, "end_line");
}

function describe(a) {
    return a.start_line || a.end_line
        ? `${a.path} (lignes ${a.start_line ?? 1} à ${a.end_line ?? "fin"})`
        : a.path;
}

module.exports = { name: "read_file", run: readFile, check, describe, readFile };
