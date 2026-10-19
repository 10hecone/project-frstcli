"use strict";

const { state } = require("../state");

// Statuts possibles d'une tâche.
const STATUSES = ["pending", "in_progress", "done"];

// Nombre maximal de tâches dans la liste.
const MAX_TODOS = 20;

// Longueur maximale du texte d'une tâche.
const MAX_CONTENT = 200;

/**
 * Valide la liste de tâches et la renvoie normalisée ({ id, content, status }).
 * Lève une erreur claire si la liste est invalide.
 */
function normalizeTodos(todos) {
    if (!Array.isArray(todos)) {
        throw new Error("todos doit être une liste de { id, content, status }.");
    }

    if (todos.length > MAX_TODOS) {
        throw new Error(`todos : ${MAX_TODOS} tâches au maximum (reçu ${todos.length}).`);
    }

    const ids = new Set();
    let inProgress = 0;

    const list = todos.map((item, index) => {
        const where = `todos[${index}]`;

        if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw new Error(`${where} doit être un objet { id, content, status }.`);
        }

        let id = item.id;
        if (typeof id === "number" && Number.isInteger(id)) id = String(id);
        if (typeof id !== "string" || !id.trim()) {
            throw new Error(`${where}.id doit être une chaîne non vide ou un entier.`);
        }
        id = id.trim();
        if (ids.has(id)) throw new Error(`${where}.id : identifiant « ${id} » en double.`);
        ids.add(id);

        if (typeof item.content !== "string" || !item.content.trim()) {
            throw new Error(`${where}.content doit être un texte non vide.`);
        }
        const content = item.content.replace(/\s+/g, " ").trim().slice(0, MAX_CONTENT);

        if (!STATUSES.includes(item.status)) {
            throw new Error(`${where}.status doit valoir ${STATUSES.join(", ")}.`);
        }
        if (item.status === "in_progress") inProgress += 1;

        return { id, content, status: item.status };
    });

    if (inProgress > 1) {
        throw new Error(`Une seule tâche peut être in_progress à la fois (reçu ${inProgress}).`);
    }

    return list;
}

/** Résumé court : « Tâches : 1 terminée(s) sur 3, en cours : … ». */
function summarizeTodos(todos) {
    if (!todos.length) return "Liste de tâches vidée.";

    const done = todos.filter(t => t.status === "done").length;
    const current = todos.find(t => t.status === "in_progress");

    return `Tâches : ${done} terminée(s) sur ${todos.length}` +
        (current ? `, en cours : ${current.content}` : "") + ".";
}

/** Remplace la liste de tâches de la session. N'écrit rien sur le disque, sans confirmation. */
async function todoWriteTool(args = {}) {
    const todos = normalizeTodos(args.todos);

    state.todos = todos;

    return { todos, changed: false, message: summarizeTodos(todos) };
}

function check(args) {
    normalizeTodos(args.todos);
}

function describe(a) {
    const n = Array.isArray(a.todos) ? a.todos.length : 0;
    return `${n} tâche(s)`;
}

module.exports = {
    name: "todo_write",
    run: todoWriteTool,
    check,
    describe,
    normalizeTodos,
    summarizeTodos,
    STATUSES,
    MAX_TODOS
};
