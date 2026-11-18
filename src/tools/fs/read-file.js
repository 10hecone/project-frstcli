"use strict";

const { CONFIG } = require("../../config");
const { state } = require("../../state");
const { resolveInWorkspace } = require("../security");
const memory = require("../../project/memory");
const { requireString, optionalInt } = require("../core/args");
const { readTextFile } = require("../core/freshness");
const { workspace } = require("../../core/workspace");

// Au-delà, une ligne est coupée (fichier minifié, JSON sur une seule ligne...).
const MAX_LINE_CHARS = 2000;

/** Dernière lecture complète renvoyée au modèle, par fichier : { chatId, hash }. */
const sentReads = new Map();

function countLines(text) {
    let count = 1;
    let i = -1;
    while ((i = text.indexOf("\n", i + 1)) !== -1) count++;
    return count;
}

/**
 * Lit un fichier du projet (en entier ou les lignes start_line à end_line).
 * Au-delà de CONFIG.maxReadChars, le texte est coupé sur une fin de ligne et next_line
 * indique où reprendre : aucune ligne n'est perdue ni lue deux fois. Une ligne seule
 * plus longue que la limite est coupée en son milieu (next_line = ligne suivante).
 *
 * Renvoie { path, total_lines, range, truncated, next_line, content, message } ;
 * range = [première, dernière] ligne renvoyée, ou null pour le fichier entier.
 */
async function readFile(args = {}) {
    requireString(args.path, "path");

    const { rel, target } = await resolveInWorkspace(workspace.root, args.path);
    const text = await readTextFile(target);
    const total = countLines(text);

    let content = text;
    let partial = false;
    let range = null;
    let first = 1;
    let last = total;

    if (args.start_line !== undefined || args.end_line !== undefined) {
        first = Math.max(1, Math.floor(args.start_line ?? 1));
        last = Math.min(total, Math.floor(args.end_line ?? total));

        if (first > last) {
            throw new Error(`Plage invalide : le fichier a ${total} lignes.`);
        }

        const lines = text.split("\n");
        content = lines.slice(first - 1, last).join("\n");
        partial = first > 1 || last < total;
        range = [first, last];
    }

    let truncated = false;
    let nextLine = null;
    let message = "Fichier lu.";

    // Lignes très longues (fichier minifié, JSON sur une ligne) : coupées pour ne pas remplir le contexte.
    let longLines = 0;
    content = content.split("\n").map(line => {
        if (line.length <= MAX_LINE_CHARS) return line;
        longLines++;
        return `${line.slice(0, MAX_LINE_CHARS)} [ligne coupée : ${line.length} caractères]`;
    }).join("\n");
    if (longLines) {
        // Vue incomplète : write_file ne doit pas écraser le fichier sur cette base.
        partial = true;
        message = `${longLines} ligne(s) de plus de ${MAX_LINE_CHARS} caractères coupée(s).`;
    }

    if (content.length > CONFIG.maxReadChars) {
        const cut = content.lastIndexOf("\n", CONFIG.maxReadChars - 1);
        let shownLast;

        if (cut >= 0) {
            // Lignes complètes seulement.
            content = content.slice(0, cut);
            shownLast = first + countLines(content) - 1;
            message = `Fichier tronqué à la ligne ${shownLast}.`;
        } else {
            // Une seule ligne dépasse la limite : elle est coupée.
            content = content.slice(0, CONFIG.maxReadChars);
            shownLast = first;
            message = `La ligne ${first} dépasse ${CONFIG.maxReadChars} caractères : elle est coupée.`;
        }

        truncated = true;
        partial = true;
        range = [first, shownLast];
        nextLine = shownLast < last ? shownLast + 1 : null;
        if (nextLine) message += ` Suite : read_file avec start_line=${nextLine}.`;
    }

    // L'empreinte porte toujours sur le fichier COMPLET présent sur le disque.
    memory.rememberFile(rel, text, { partial });

    // Fichier déjà renvoyé en entier dans cette conversation et inchangé : contenu non renvoyé.
    // Une lecture avec start_line/end_line renvoie toujours le texte (échappatoire du modèle).
    const chatId = state.chatIds?.chat ?? null;
    if (CONFIG.optim && chatId && !partial && !truncated) {
        const hash = memory.hash(text);
        const last = sentReads.get(rel);
        if (range === null && last?.chatId === chatId && last.hash === hash) {
            return {
                path: rel,
                total_lines: total,
                range: null,
                truncated: false,
                next_line: null,
                content: "",
                unchanged: true,
                message: "Fichier inchangé depuis ta dernière lecture complète dans cette conversation : contenu non renvoyé. " +
                    "Relis une plage (start_line/end_line) si tu ne l'as plus."
            };
        }
        sentReads.set(rel, { chatId, hash });
    }

    return {
        path: rel,
        total_lines: total,
        range,
        truncated,
        next_line: nextLine,
        content,
        message
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

module.exports = { name: "read_file", run: readFile, check, describe, readFile, sentReads };
