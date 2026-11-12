"use strict";

const fs = require("node:fs/promises");

const { CONFIG } = require("../../config");
const { state } = require("../../state");
const { resolveInWorkspace } = require("../security");
const { requireString, optionalString } = require("../core/args");
const { walkFiles } = require("../core/walk");
const { globToRegExp } = require("./search-files");

// Nombre maximal de fichiers renvoyés.
const MAX_GLOB_RESULTS = 200;

// Nombre de fichiers dont la date est lue en même temps.
const STAT_CONCURRENCY = 32;

/** Sans « / », le motif porte sur le nom du fichier ; sinon sur le chemin depuis le dossier de départ. */
function makeMatcher(pattern) {
    const re = globToRegExp(pattern);
    const byName = !pattern.replace(/\\/g, "/").includes("/");

    return relToBase => re.test(byName ? relToBase.slice(relToBase.lastIndexOf("/") + 1) : relToBase);
}

async function glob(args = {}) {
    const pattern = requireString(args.pattern, "pattern");
    const matches = makeMatcher(pattern);

    const { rel, target } = await resolveInWorkspace(state.workspace, args.path ?? ".");
    const info = await fs.stat(target);

    if (!info.isDirectory()) throw new Error("glob doit cibler un dossier.");

    const maxFiles = CONFIG.maxSearchFiles;
    const all = await walkFiles(target, rel, { maxFiles });
    const prefix = rel === "." ? "" : `${rel}/`;

    const found = all.filter(file => matches(file.rel.slice(prefix.length)));

    const dated = [];
    for (let i = 0; i < found.length; i += STAT_CONCURRENCY) {
        const batch = found.slice(i, i + STAT_CONCURRENCY);
        const stats = await Promise.all(batch.map(file => fs.stat(file.abs).catch(() => null)));

        stats.forEach((stat, j) => {
            if (stat) dated.push({ path: batch[j].rel, mtime: stat.mtimeMs });
        });
    }

    // Du plus récent au plus ancien, puis par chemin pour un ordre stable.
    dated.sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path));

    const files = dated.slice(0, MAX_GLOB_RESULTS).map(file => file.path);
    const truncated = dated.length > files.length || all.length >= maxFiles;

    return {
        pattern,
        path: rel,
        files,
        truncated,
        message: `${files.length} fichier(s)` + (truncated ? " (liste tronquée)." : ".")
    };
}

function check(args) {
    requireString(args.pattern, "pattern");
    optionalString(args.path, "path");
    globToRegExp(args.pattern);
}

function describe(a) {
    return `${a.pattern ?? "?"} dans ${a.path ?? "."}`;
}

module.exports = { name: "glob", run: glob, check, describe, glob, MAX_GLOB_RESULTS };
