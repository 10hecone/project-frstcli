"use strict";

const fs = require("node:fs/promises");

const { CONFIG } = require("../../config");
const { state } = require("../../state");
const { resolveInWorkspace } = require("../security");
const { requireString, optionalString } = require("../core/args");
const { readTextFile } = require("../core/freshness");
const { walkFiles } = require("../core/walk");

// Nombre de fichiers lus en même temps.
const READ_CONCURRENCY = 8;

async function searchFiles(args = {}) {
    const query = requireString(args.query, "query");
    const { rel, target } = await resolveInWorkspace(state.workspace, args.path ?? ".");
    const info = await fs.stat(target);

    if (!info.isDirectory()) throw new Error("search_files doit cibler un dossier.");

    const needle = query.toLowerCase();
    const matches = [];
    let scanned = 0;

    const full = () =>
        matches.length >= CONFIG.maxSearchResults || scanned >= CONFIG.maxSearchFiles;

    const files = await walkFiles(target, rel, { maxFiles: CONFIG.maxSearchFiles });

    for (let i = 0; i < files.length && !full(); i += READ_CONCURRENCY) {
        const batch = files.slice(i, i + READ_CONCURRENCY);

        // binaire, trop grand ou illisible : null
        const texts = await Promise.all(
            batch.map(file => readTextFile(file.abs).catch(() => null))
        );

        for (let j = 0; j < batch.length; j++) {
            if (full()) break;

            scanned++;

            const text = texts[j];
            if (text === null) continue;

            const lower = text.toLowerCase();
            if (!lower.includes(needle)) continue;

            // toLowerCase ne crée ni ne supprime de \n : les lignes restent alignées.
            const lines = text.split("\n");
            const lowerLines = lower.split("\n");

            for (let k = 0; k < lowerLines.length; k++) {
                if (lowerLines[k].includes(needle)) {
                    matches.push({
                        path: batch[j].rel,
                        line: k + 1,
                        text: lines[k].trim().slice(0, 200)
                    });

                    if (matches.length >= CONFIG.maxSearchResults) break;
                }
            }
        }
    }

    return {
        query,
        matches,
        truncated: full(),
        message: `${matches.length} résultat(s) dans ${scanned} fichier(s).`
    };
}

function check(args) {
    requireString(args.query, "query");
    optionalString(args.path, "path");
}

function describe(a) {
    return `"${a.query}" dans ${a.path ?? "."}`;
}

module.exports = { name: "search_files", run: searchFiles, check, describe, searchFiles };
