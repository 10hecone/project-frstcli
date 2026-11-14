/**
 * Auto-complétion de la barre de chat, sans DOM (testable) :
 * - « / » au début du message : commandes slash (liste partagée avec /help) ;
 * - « $ » au début d'un mot, n'importe où : skills de l'utilisateur.
 */
import commandList from "../../../cli/command-list.js";

export const COMMANDS = commandList.COMMAND_LIST;

const SKILL_CHARS = /[\w.-]/;

/** Nom inséré pour mentionner un skill : « Apple Design » → « Apple-Design ». */
export function skillMention(name) {
    return String(name || "").trim().replace(/\s+/g, "-");
}

/**
 * Jeton en cours de saisie sous le curseur, ou null.
 * Renvoie { kind: "command" | "skill", query, start, end } ; [start, end[ est
 * la partie du texte remplacée par la suggestion choisie.
 */
export function completionContext(text, caret = text.length) {
    const value = String(text || "");
    const position = Math.max(0, Math.min(caret, value.length));
    const before = value.slice(0, position);

    const command = /^\/([\w-]*)$/.exec(before);
    if (command) {
        let end = position;
        while (end < value.length && !/\s/.test(value[end])) end += 1;
        return { kind: "command", query: command[1].toLowerCase(), start: 0, end };
    }

    const skill = /(^|\s)\$([\w.-]*)$/.exec(before);
    if (skill) {
        const start = position - skill[2].length - 1;
        let end = position;
        while (end < value.length && SKILL_CHARS.test(value[end])) end += 1;
        return { kind: "skill", query: skill[2].toLowerCase(), start, end };
    }
    return null;
}

/**
 * Classe les éléments : nom qui commence par la saisie, puis nom qui la
 * contient, puis description qui la contient. L'ordre d'origine départage.
 */
export function rank(items, query, nameOf, descriptionOf, max = 8) {
    const q = String(query || "").toLowerCase();
    const scored = [];
    items.forEach((item, index) => {
        const name = String(nameOf(item) || "").toLowerCase();
        const description = String(descriptionOf(item) || "").toLowerCase();
        let score = -1;
        if (!q || name.startsWith(q)) score = 0;
        else if (name.includes(q)) score = 1;
        else if (description.includes(q)) score = 2;
        if (score >= 0) scored.push({ item, score, index });
    });
    scored.sort((a, b) => a.score - b.score || a.index - b.index);
    return scored.slice(0, max).map((entry) => entry.item);
}

/** Une commande sans argument obligatoire s'exécute directement avec Entrée. */
export function runsWithoutArgs(command) {
    const args = String((command && command.args) || "");
    return !args || args.startsWith("[");
}

export function commandSuggestions(query, commands = COMMANDS, max = 8) {
    return rank(commands, query, (command) => command.name.slice(1), (command) => command.description, max);
}

/** Skills actifs d'abord : un skill désactivé reste proposé, mais après. */
export function skillSuggestions(query, skills = [], max = 8) {
    const list = skills
        .filter((skill) => skill && skillMention(skill.name))
        .map((skill) => ({ ...skill, mention: skillMention(skill.name) }));
    const ordered = [...list.filter((skill) => skill.enabled !== false), ...list.filter((skill) => skill.enabled === false)];
    return rank(ordered, query, (skill) => skill.mention, (skill) => skill.description, max);
}

/**
 * Remplace le jeton par la suggestion, suivie d'une espace (une seule).
 * Renvoie { text, caret } avec le curseur juste après l'espace.
 */
export function applyCompletion(text, context, insertion) {
    const value = String(text || "");
    const head = value.slice(0, context.start) + insertion;
    const tail = value.slice(context.end);
    const next = tail.startsWith(" ") ? `${head}${tail}` : `${head} ${tail}`;
    return { text: next, caret: head.length + 1 };
}
