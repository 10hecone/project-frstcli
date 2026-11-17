"use strict";

/*
 * Signale les lignes écrites par edit_file / write_file dont l'indentation ne respecte pas
 * l'unité du fichier (2 ou 4 espaces). Seulement un avertissement dans le résultat : rien
 * n'est corrigé automatiquement. Pour limiter les fausses alertes :
 * - seuls les fichiers de code connus sont vérifiés ;
 * - l'unité est déduite du fichier d'origine (ou du nouveau contenu s'il n'existait pas),
 *   et aucune alerte n'est émise si elle n'est pas nette ;
 * - seules les lignes modifiées sont examinées ; lignes vides, tabulations et lignes « * »
 *   des commentaires JSDoc ignorées.
 */

const CODE_FILE = /\.(c|m)?(j|t)sx?$|\.(json|css|scss|less|py|java|cs|go|rs|php|rb|vue|svelte)$/i;
const MIN_SHARE = 0.8;      // part minimale de lignes conformes pour retenir une unité
const MIN_INDENTED = 5;     // en dessous, l'unité n'est pas fiable
const MAX_REPORTED = 10;

function indentOf(line) {
    return line.match(/^ */)[0].length;
}

function ignored(line) {
    const trimmed = line.trim();
    return !trimmed || /^\t/.test(line) || /^\*/.test(trimmed);
}

/** Unité d'indentation (4 ou 2), ou null si elle n'est pas nette. */
function detectUnit(text) {
    const sizes = String(text).split(/\r?\n/)
        .filter(line => !ignored(line))
        .map(indentOf)
        .filter(n => n > 0);
    if (sizes.length < MIN_INDENTED) return null;
    for (const unit of [4, 2]) {
        const share = sizes.filter(n => n % unit === 0).length / sizes.length;
        if (share >= MIN_SHARE) return unit;
    }
    return null;
}

/** Numéros (à partir de 1) des lignes de after qui diffèrent de before (préfixe et suffixe communs exclus). */
function changedLines(before, after) {
    const a = String(before ?? "").split(/\r?\n/);
    const b = String(after).split(/\r?\n/);
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length - 1;
    let endB = b.length - 1;
    while (endA >= start && endB >= start && a[endA] === b[endB]) {
        endA--;
        endB--;
    }
    const lines = [];
    for (let i = start; i <= endB; i++) lines.push({ number: i + 1, text: b[i] });
    return lines;
}

/** Message d'avertissement, ou null si rien de suspect. */
function indentWarning(rel, before, after) {
    if (!CODE_FILE.test(String(rel))) return null;
    const unit = detectUnit(before ?? after);
    if (!unit) return null;

    const bad = changedLines(before, after)
        .filter(({ text }) => !ignored(text) && indentOf(text) % unit !== 0);
    if (!bad.length) return null;

    const shown = bad.slice(0, MAX_REPORTED).map(({ number, text }) => `${number} (${indentOf(text)} espaces)`);
    const more = bad.length > MAX_REPORTED ? `, et ${bad.length - MAX_REPORTED} autre(s)` : "";
    return `Indentation suspecte (le fichier utilise ${unit} espaces) : ligne(s) ${shown.join(", ")}${more}. ` +
        "À corriger maintenant si ce n'est pas une ligne de continuation voulue.";
}

module.exports = { indentWarning, detectUnit, changedLines };
