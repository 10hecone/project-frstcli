"use strict";

const fs = require("node:fs/promises");

const { CONFIG } = require("../../config");
const { state } = require("../../state");
const { resolveInWorkspace } = require("../security");
const { requireString, optionalString, optionalBool } = require("../core/args");
const { readTextFile } = require("../core/freshness");
const { walkFiles } = require("../core/walk");

// Nombre de fichiers lus en même temps.
const READ_CONCURRENCY = 8;

// Longueur maximale d'une regex ou d'un glob.
const MAX_PATTERN_LENGTH = 500;

function compileRegex(query) {
    if (query.length > MAX_PATTERN_LENGTH) {
        throw new Error(`query : regex trop longue (${MAX_PATTERN_LENGTH} caractères au maximum).`);
    }

    try {
        return new RegExp(query, "i");
    } catch (error) {
        throw new Error(`query n'est pas une regex valide : ${error.message}`);
    }
}

/** Glob vers RegExp : ** (tous niveaux), * (sans /), ? (un caractère), {a,b} (alternatives). */
function globToRegExp(glob) {
    const source = glob.trim().replace(/\\/g, "/").replace(/^\.\//, "");

    if (source.length > MAX_PATTERN_LENGTH) {
        throw new Error(`glob trop long (${MAX_PATTERN_LENGTH} caractères au maximum).`);
    }

    let out = "";
    let depth = 0;

    for (let i = 0; i < source.length; i++) {
        const ch = source[i];

        if (ch === "*") {
            if (source[i + 1] === "*") {
                i++;
                if (source[i + 1] === "/") {
                    i++;
                    out += "(?:.*/)?";
                } else {
                    out += ".*";
                }
            } else {
                out += "[^/]*";
            }
        } else if (ch === "?") {
            out += "[^/]";
        } else if (ch === "{") {
            depth++;
            out += "(?:";
        } else if (ch === "}" && depth > 0) {
            depth--;
            out += ")";
        } else if (ch === "," && depth > 0) {
            out += "|";
        } else {
            out += ch.replace(/[.+^$()|[\]\\{}]/g, "\\$&");
        }
    }

    if (depth > 0) throw new Error("glob : accolade « { » non fermée.");

    return new RegExp(`^${out}$`, "i");
}

/** Sans « / », le glob porte sur le nom du fichier ; sinon sur le chemin depuis la racine du projet. */
function makeGlobFilter(glob) {
    const re = globToRegExp(glob);
    const byName = !glob.replace(/\\/g, "/").includes("/");

    return rel => re.test(byName ? rel.slice(rel.lastIndexOf("/") + 1) : rel);
}

function makeMatcher(query, regex) {
    if (regex) {
        const re = compileRegex(query);
        return { quick: () => true, line: text => re.test(text) };
    }

    const needle = query.toLowerCase();
    return {
        quick: text => text.toLowerCase().includes(needle),
        line: text => text.toLowerCase().includes(needle)
    };
}

async function searchFiles(args = {}) {
    const query = requireString(args.query, "query");
    const regex = args.regex === true;
    const glob = typeof args.glob === "string" && args.glob.trim() ? args.glob : null;

    const matcher = makeMatcher(query, regex);
    const accept = glob ? makeGlobFilter(glob) : () => true;

    const { rel, target } = await resolveInWorkspace(state.workspace, args.path ?? ".");
    const info = await fs.stat(target);

    if (!info.isDirectory()) throw new Error("search_files doit cibler un dossier.");

    const matches = [];
    let scanned = 0;

    const full = () =>
        matches.length >= CONFIG.maxSearchResults || scanned >= CONFIG.maxSearchFiles;

    const all = await walkFiles(target, rel, { maxFiles: CONFIG.maxSearchFiles });
    const files = all.filter(file => accept(file.rel));

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
            if (text === null || !matcher.quick(text)) continue;

            const lines = text.split("\n");

            for (let k = 0; k < lines.length; k++) {
                const line = lines[k].replace(/\r$/, "");

                if (matcher.line(line)) {
                    matches.push({
                        path: batch[j].rel,
                        line: k + 1,
                        text: line.trim().slice(0, 200)
                    });

                    if (matches.length >= CONFIG.maxSearchResults) break;
                }
            }
        }
    }

    return {
        query,
        ...(regex ? { regex: true } : {}),
        ...(glob ? { glob } : {}),
        matches,
        truncated: full(),
        message: `${matches.length} résultat(s) dans ${scanned} fichier(s).`
    };
}

function check(args) {
    requireString(args.query, "query");
    optionalString(args.path, "path");
    optionalBool(args.regex, "regex");
    optionalString(args.glob, "glob");

    if (args.regex === true) compileRegex(args.query);
    if (args.glob !== undefined) globToRegExp(args.glob);
}

function describe(a) {
    const what = a.regex === true ? `/${a.query}/` : `"${a.query}"`;
    const filter = a.glob ? ` (${a.glob})` : "";
    return `${what} dans ${a.path ?? "."}${filter}`;
}

module.exports = {
    name: "search_files",
    run: searchFiles,
    check,
    describe,
    searchFiles,
    globToRegExp
};
