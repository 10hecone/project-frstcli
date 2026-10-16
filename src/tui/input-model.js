"use strict";

/**
 * Modèle d'édition de la zone de saisie (étape 7) : fonctions pures sur
 * { lines, row, col }. Chaque fonction renvoie un nouvel objet, sans muter l'entrée.
 */

function empty() {
    return { lines: [""], row: 0, col: 0 };
}

function fromText(text) {
    const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
    const row = lines.length - 1;
    return { lines, row, col: lines[row].length };
}

function toText(model) {
    return model.lines.join("\n");
}

function isEmpty(model) {
    return model.lines.length === 1 && model.lines[0] === "";
}

/** Insère du texte au curseur ; un texte avec des retours à la ligne (collage) crée des lignes. */
function insert(model, text) {
    const parts = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
    const line = model.lines[model.row];
    const before = line.slice(0, model.col);
    const after = line.slice(model.col);
    if (parts.length === 1) {
        const lines = [...model.lines];
        lines[model.row] = before + parts[0] + after;
        return { lines, row: model.row, col: model.col + parts[0].length };
    }
    const last = parts[parts.length - 1];
    const inserted = [before + parts[0], ...parts.slice(1, -1), last + after];
    const lines = [...model.lines.slice(0, model.row), ...inserted, ...model.lines.slice(model.row + 1)];
    return { lines, row: model.row + parts.length - 1, col: last.length };
}

function newline(model) {
    return insert(model, "\n");
}

/** Retour arrière : efface le caractère avant le curseur, ou fusionne avec la ligne précédente. */
function backspace(model) {
    if (model.col > 0) {
        const lines = [...model.lines];
        const line = lines[model.row];
        lines[model.row] = line.slice(0, model.col - 1) + line.slice(model.col);
        return { lines, row: model.row, col: model.col - 1 };
    }
    if (model.row === 0) return model;
    const lines = [...model.lines];
    const previous = lines[model.row - 1];
    lines.splice(model.row - 1, 2, previous + lines[model.row]);
    return { lines, row: model.row - 1, col: previous.length };
}

/** Suppr : efface le caractère sous le curseur, ou fusionne avec la ligne suivante. */
function del(model) {
    const line = model.lines[model.row];
    if (model.col < line.length) {
        const lines = [...model.lines];
        lines[model.row] = line.slice(0, model.col) + line.slice(model.col + 1);
        return { ...model, lines };
    }
    if (model.row === model.lines.length - 1) return model;
    const lines = [...model.lines];
    lines.splice(model.row, 2, line + lines[model.row + 1]);
    return { ...model, lines };
}

function left(model) {
    if (model.col > 0) return { ...model, col: model.col - 1 };
    if (model.row === 0) return model;
    return { ...model, row: model.row - 1, col: model.lines[model.row - 1].length };
}

function right(model) {
    if (model.col < model.lines[model.row].length) return { ...model, col: model.col + 1 };
    if (model.row === model.lines.length - 1) return model;
    return { ...model, row: model.row + 1, col: 0 };
}

function home(model) {
    return { ...model, col: 0 };
}

function end(model) {
    return { ...model, col: model.lines[model.row].length };
}

/** Ligne précédente ; null si le curseur est déjà sur la première (l'appelant passe à l'historique). */
function up(model) {
    if (model.row === 0) return null;
    const row = model.row - 1;
    return { ...model, row, col: Math.min(model.col, model.lines[row].length) };
}

/** Ligne suivante ; null si le curseur est déjà sur la dernière. */
function down(model) {
    if (model.row === model.lines.length - 1) return null;
    const row = model.row + 1;
    return { ...model, row, col: Math.min(model.col, model.lines[row].length) };
}

/** Ctrl+U : efface du début de la ligne jusqu'au curseur. */
function killToStart(model) {
    const lines = [...model.lines];
    lines[model.row] = lines[model.row].slice(model.col);
    return { lines, row: model.row, col: 0 };
}

/** Ctrl+K : efface du curseur jusqu'à la fin de la ligne. */
function killToEnd(model) {
    const lines = [...model.lines];
    lines[model.row] = lines[model.row].slice(0, model.col);
    return { ...model, lines };
}

/** « \ » juste avant le curseur, en fin de ligne : Entrée doit ajouter une ligne. */
function endsWithContinuation(model) {
    const line = model.lines[model.row];
    return model.col === line.length && line.endsWith("\\");
}

/** Remplace le « \ » final par une nouvelle ligne. */
function continueLine(model) {
    return newline(backspace(model));
}

/* ---------- Historique (navigation pure) ---------- */

/**
 * nav = { entries, index, draft } : index === entries.length signifie « saisie en cours ».
 * historyPrev / historyNext renvoient { nav, text }, ou null si on ne peut pas aller plus loin.
 */
function createHistoryNav(entries = []) {
    return { entries: [...entries], index: entries.length, draft: "" };
}

function historyPrev(nav, currentText) {
    if (nav.index === 0) return null;
    const draft = nav.index === nav.entries.length ? String(currentText ?? "") : nav.draft;
    const index = nav.index - 1;
    return { nav: { ...nav, index, draft }, text: nav.entries[index] };
}

function historyNext(nav) {
    if (nav.index >= nav.entries.length) return null;
    const index = nav.index + 1;
    const text = index === nav.entries.length ? nav.draft : nav.entries[index];
    return { nav: { ...nav, index }, text };
}

/* ---------- Complétion des commandes slash ---------- */

/**
 * Tab : complète une commande « /xxx » sur une seule ligne, sans espace.
 * Renvoie { text, matches } : text est la complétion (préfixe commun), matches les candidats.
 */
function completeSlash(text, commands) {
    const value = String(text ?? "");
    if (!value.startsWith("/") || /\s/.test(value)) return { text: value, matches: [] };
    const matches = commands.filter((command) => command.startsWith(value.toLowerCase()));
    if (!matches.length) return { text: value, matches };
    if (matches.length === 1) return { text: `${matches[0]} `, matches };
    let prefix = matches[0];
    for (const command of matches) {
        while (!command.startsWith(prefix)) prefix = prefix.slice(0, -1);
    }
    return { text: prefix.length > value.length ? prefix : value, matches };
}

/**
 * Suggestions affichées sous la saisie pendant qu'on tape « /xxx » (une ligne, sans espace).
 * Renvoie au plus max commandes qui commencent par le texte saisi.
 */
function slashSuggestions(text, commands, max = 8) {
    const value = String(text ?? "");
    if (!value.startsWith("/") || /\s/.test(value)) return [];
    const lower = value.toLowerCase();
    return (commands || []).filter((command) => command.startsWith(lower)).slice(0, Math.max(1, max));
}

module.exports = {
    empty,
    fromText,
    toText,
    isEmpty,
    insert,
    newline,
    backspace,
    del,
    left,
    right,
    home,
    end,
    up,
    down,
    killToStart,
    killToEnd,
    endsWithContinuation,
    continueLine,
    createHistoryNav,
    historyPrev,
    historyNext,
    completeSlash,
    slashSuggestions
};
