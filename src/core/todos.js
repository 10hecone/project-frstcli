"use strict";

/**
 * Liste de tâches de la session (équivalent de TodoWrite), pilotée par le modèle avec la
 * commande virtuelle `todo` de run_command (l'API n'accepte pas de nouvel outil) :
 *
 *   todo         liste
 *   todo set "t1" "t2" …       remplace la liste (tâches en attente)
 *   todo set '[{"content":"t1","status":"in_progress"}, …]'
 *   todo add <texte>    ajoute une tâche
 *   todo start <n>      passe la tâche n en cours (les autres en cours repassent en attente)
 *   todo done <n> [<n>…]       marque des tâches terminées
 *   todo remove <n>     supprime une tâche
 *   todo clear          vide la liste
 *
 * La liste vit dans state.todos (vidée par /new) et s'affiche avec ui.todos à chaque changement.
 */

const { state } = require("../state");
const { ui } = require("../ui-bridge");

const MAX_TODOS = 50;
const MAX_CONTENT_CHARS = 200;
const STATUSES = new Set(["pending", "in_progress", "done"]);
const STATUS_ALIASES = { completed: "done", complete: "done", todo: "pending", doing: "in_progress", "in-progress": "in_progress" };
const MARKS = { pending: "[ ]", in_progress: "[~]", done: "[x]" };

const USAGE =
    "Usage : todo | todo set \"tâche 1\" \"tâche 2\" | todo add <texte> | todo start <n> | " +
    "todo done <n> | todo remove <n> | todo clear";

class TodoError extends Error {}

function list() {
    return Array.isArray(state.todos) ? state.todos : [];
}

function normalizeStatus(value) {
    const raw = String(value ?? "pending").trim().toLowerCase();
    const status = STATUS_ALIASES[raw] || raw;
    if (!STATUSES.has(status)) throw new TodoError(`Statut inconnu : ${value} (pending, in_progress ou done).`);
    return status;
}

function cleanContent(value) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!text) throw new TodoError("Tâche vide.");
    return text.length <= MAX_CONTENT_CHARS ? text : `${text.slice(0, MAX_CONTENT_CHARS - 1)}…`;
}

/** Remplace la liste : renumérote les ids (1..n) et la publie. */
function publish(items) {
    if (items.length > MAX_TODOS) throw new TodoError(`Trop de tâches (${items.length}, ${MAX_TODOS} au maximum).`);
    state.todos = items.map((item, index) => ({ id: String(index + 1), content: item.content, status: item.status }));
    ui.todos(state.todos);
    return state.todos;
}

/** Élément JSON de `todo set` : "texte" ou { content, status }. */
function toItem(item) {
    if (typeof item === "string") return { content: cleanContent(item), status: "pending" };
    return { content: cleanContent(item?.content), status: normalizeStatus(item?.status) };
}

/** Arguments de `todo set` : une liste JSON, ou une tâche par argument. */
function parseSet(args) {
    const joined = args.join(" ").trim();
    if (joined.startsWith("[")) {
        let data;
        try {
            data = JSON.parse(joined);
        } catch {
            throw new TodoError("JSON illisible pour todo set (attendu : [{\"content\":\"…\",\"status\":\"pending\"}]).");
        }
        if (!Array.isArray(data)) throw new TodoError("todo set attend une liste JSON.");
        return data.map(toItem);
    }
    return args.map(arg => ({ content: cleanContent(arg), status: "pending" }));
}

/** Numéros de tâches (1..n) ; erreur claire sinon. */
function indexes(args) {
    if (!args.length) throw new TodoError(`Numéro de tâche manquant. ${USAGE}`);
    const items = list();
    return args.map(arg => {
        const n = Number(arg);
        if (!Number.isInteger(n) || n < 1 || n > items.length) {
            throw new TodoError(`Tâche inconnue : ${arg} (${items.length} tâche(s)).`);
        }
        return n - 1;
    });
}

/** Texte renvoyé au modèle. */
function format(items = list()) {
    if (!items.length) return "Liste de tâches vide.";
    const done = items.filter(item => item.status === "done").length;
    const lines = items.map((item, index) => `${index + 1}. ${MARKS[item.status] || "[ ]"} ${item.content}`);
    return `Tâches (${done}/${items.length} terminées) :\n${lines.join("\n")}`;
}

function setTodos(rest) {
    if (!rest.length) throw new TodoError(`Aucune tâche donnée. ${USAGE}`);
    publish(parseSet(rest));
}

function startTodo(rest, current) {
    const [target] = indexes(rest.slice(0, 1));
    // Une seule tâche en cours à la fois.
    for (const item of current) if (item.status === "in_progress") item.status = "pending";
    current[target].status = "in_progress";
    publish(current);
}

function doneTodos(rest, current) {
    for (const index of indexes(rest)) current[index].status = "done";
    publish(current);
}

function removeTodos(rest, current) {
    const drop = new Set(indexes(rest));
    publish(current.filter((_, index) => !drop.has(index)));
}

// Actions de `todo` : (arguments, copie de la liste) -> publie la nouvelle liste.
const ACTIONS = {
    list: () => {},
    ls: () => {},
    set: setTodos,
    add: (rest, current) => publish([...current, { content: cleanContent(rest.join(" ")), status: "pending" }]),
    start: startTodo,
    done: doneTodos,
    remove: removeTodos,
    rm: removeTodos,
    clear: () => publish([])
};

/** Exécute `todo <action> …` ; renvoie { message, todos, changed, error? }. Ne lève pas d'erreur. */
function runTodo(args = []) {
    const [action = "list", ...rest] = args.map(String);
    const handler = ACTIONS[action.toLowerCase()];
    try {
        if (!handler) throw new TodoError(`Action inconnue : ${action}. ${USAGE}`);
        handler(rest, list().map(item => ({ ...item })));
    } catch (error) {
        if (!(error instanceof TodoError)) throw error;
        return { message: error.message, todos: list(), changed: false, error: true };
    }
    return { message: format(), todos: list(), changed: false };
}

/** Vide la liste (nouvelle conversation). */
function resetTodos() {
    if (!list().length) return;
    state.todos = [];
    ui.todos([]);
}

module.exports = { runTodo, resetTodos, format, USAGE, MAX_TODOS, MAX_CONTENT_CHARS };
