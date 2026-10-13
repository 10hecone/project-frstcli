"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { CONFIG } = require("../../config");
const { state } = require("../../state");
const { normalizeRelative, resolveInWorkspace } = require("../security");
const { requireString, optionalString } = require("../core/args");
const { readTextFile } = require("../core/freshness");

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

    async function visit(dir, relDir) {
        const dirents = await fs.readdir(dir, { withFileTypes: true });

        for (const dirent of dirents) {
            if (full()) return;
            if (dirent.isSymbolicLink()) continue;

            const childRel = relDir === "." ? dirent.name : `${relDir}/${dirent.name}`;

            try {
                normalizeRelative(childRel);
            } catch {
                continue;
            }

            const childAbs = path.join(dir, dirent.name);

            if (dirent.isDirectory()) {
                await visit(childAbs, childRel);
                continue;
            }

            if (!dirent.isFile()) continue;

            scanned++;

            let text;

            try {
                text = await readTextFile(childAbs);
            } catch {
                continue; // binaire, trop grand ou illisible
            }

            const lines = text.split("\n");

            for (let i = 0; i < lines.length; i++) {
                if (lines[i].toLowerCase().includes(needle)) {
                    matches.push({
                        path: childRel,
                        line: i + 1,
                        text: lines[i].trim().slice(0, 200)
                    });

                    if (full()) return;
                }
            }
        }
    }

    await visit(target, rel);

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
