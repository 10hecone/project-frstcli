"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { CONFIG } = require("../../config");
const { state } = require("../../state");
const { normalizeRelative, resolveInWorkspace } = require("../security");
const memory = require("../../project/memory");
const { optionalString, optionalBool } = require("../core/args");

async function walkDirectory(absDir, relDir, depth, maxDepth, out) {
    const dirents = await fs.readdir(absDir, { withFileTypes: true });

    dirents.sort((a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) ||
        a.name.localeCompare(b.name, "fr")
    );

    for (const dirent of dirents) {
        if (out.length > CONFIG.maxDirectoryEntries) return;
        if (dirent.isSymbolicLink()) continue;

        const childRel = relDir === "." ? dirent.name : `${relDir}/${dirent.name}`;

        try {
            normalizeRelative(childRel);
        } catch {
            continue; // dossier ou fichier masqué (sensible, .git, node_modules...)
        }

        const isDir = dirent.isDirectory();
        out.push({ path: childRel, type: isDir ? "directory" : "file" });

        if (isDir && depth < maxDepth) {
            await walkDirectory(
                path.join(absDir, dirent.name),
                childRel,
                depth + 1,
                maxDepth,
                out
            );
        }
    }
}

async function listDirectory(args = {}) {
    const { rel, target } = await resolveInWorkspace(state.workspace, args.path ?? ".");
    const info = await fs.stat(target);

    if (!info.isDirectory()) throw new Error("Ce chemin n'est pas un dossier.");

    const entries = [];
    await walkDirectory(target, rel, 0, args.recursive === true ? 2 : 0, entries);

    const shown = entries.slice(0, CONFIG.maxDirectoryEntries);

    memory.rememberDir(rel, shown.length);

    return {
        path: rel,
        entries: shown,
        truncated: entries.length > shown.length,
        message: `${shown.length} élément(s).`
    };
}

function check(args) {
    optionalString(args.path, "path");
    optionalBool(args.recursive, "recursive");
}

function describe(a) {
    return a.path ?? ".";
}

module.exports = { name: "list_directory", run: listDirectory, check, describe, listDirectory };
