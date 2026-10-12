"use strict";

/*
 * Découpe une ligne de commande en { file, args }, sans passer par un shell.
 * La commande est toujours lancée avec spawn et shell:false : les opérateurs
 * shell n'auraient pas l'effet attendu, ils sont donc refusés avec une erreur claire.
 *
 * Règles :
 *  - séparateurs : espace et tabulation ;
 *  - '...' : texte littéral ;
 *  - "..." : texte littéral, \" et \\ y sont échappés ;
 *  - hors guillemets, \ suivi d'un guillemet ou d'un espace l'échappe ;
 *    sinon \ est gardé tel quel (chemins Windows) ;
 *  - refusés : ; & && | || > < ` $( et les retours à la ligne
 *    (` et $( aussi entre guillemets doubles, où un shell les interpréterait).
 *  - $VAR et %VAR% ne sont pas développés : ils sont transmis tels quels.
 */

const MAX_COMMAND_CHARS = 4000;

class CommandParseError extends Error {
    constructor(message) {
        super(message);
        this.name = "CommandParseError";
    }
}

function refuse(operator) {
    throw new CommandParseError(
        `Opérateur shell interdit : ${operator}. Lance une seule commande simple, ` +
        "sans ; && || | > < ` $( ni retour à la ligne."
    );
}

function parseCommand(line) {
    if (typeof line !== "string" || !line.trim()) {
        throw new CommandParseError("La commande doit être une chaîne non vide.");
    }

    if (line.length > MAX_COMMAND_CHARS) {
        throw new CommandParseError(
            `Commande trop longue (${line.length} caractères, maximum ${MAX_COMMAND_CHARS}).`
        );
    }

    if (line.includes("\0")) throw new CommandParseError("Caractère nul interdit.");
    if (/[\r\n]/.test(line)) refuse("retour à la ligne");

    const tokens = [];
    let current = "";
    let inToken = false;
    let quote = null;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        const next = line[i + 1];

        if (quote === "'") {
            if (ch === "'") quote = null;
            else current += ch;
            continue;
        }

        if (quote === '"') {
            if (ch === '"') quote = null;
            else if (ch === "\\" && (next === '"' || next === "\\")) {
                current += next;
                i++;
            } else if (ch === "`") refuse("`");
            else if (ch === "$" && next === "(") refuse("$(");
            else current += ch;
            continue;
        }

        if (ch === " " || ch === "\t") {
            if (inToken) {
                tokens.push(current);
                current = "";
                inToken = false;
            }
            continue;
        }

        if (ch === "'" || ch === '"') {
            quote = ch;
            inToken = true;
            continue;
        }

        if (ch === ";") refuse(";");
        if (ch === "&") refuse(next === "&" ? "&&" : "&");
        if (ch === "|") refuse(next === "|" ? "||" : "|");
        if (ch === ">") refuse(">");
        if (ch === "<") refuse("<");
        if (ch === "`") refuse("`");
        if (ch === "$" && next === "(") refuse("$(");

        if (ch === "\\" && (next === '"' || next === "'" || next === " ")) {
            current += next;
            i++;
            inToken = true;
            continue;
        }

        current += ch;
        inToken = true;
    }

    if (quote) throw new CommandParseError(`Guillemet ${quote} non fermé.`);
    if (inToken) tokens.push(current);

    const [file, ...args] = tokens;

    if (!file) throw new CommandParseError("Nom de programme vide.");

    return { file, args };
}

/** Forme lisible d'une commande (affichage, résultats). */
function formatCommand(file, args = []) {
    return [file, ...args]
        .map(part => (part === "" || /[\s"']/.test(part) ? JSON.stringify(part) : part))
        .join(" ");
}

module.exports = { parseCommand, formatCommand, CommandParseError, MAX_COMMAND_CHARS };
