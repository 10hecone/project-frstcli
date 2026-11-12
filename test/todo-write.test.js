"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { state } = require("../src/state");
const { TOOLS, validateToolCall, describeCall } = require("../src/tools/registry");
const todoWrite = require("../src/tools/todo-write");

const { normalizeTodos, summarizeTodos } = todoWrite;

function call(todos) {
    return { name: "todo_write", args: { todos } };
}

test("todo_write : enregistré dans le registre des outils", () => {
    assert.ok(Object.hasOwn(TOOLS, "todo_write"));
    assert.equal(describeCall(call([{ id: "1", content: "a", status: "pending" }])), "1 tâche(s)");
});

test("todo_write : liste valide normalisée et rangée dans l'état", async () => {
    const saved = state.todos;
    try {
        const result = await TOOLS.todo_write.run({
            todos: [
                { id: 1, content: "  Lire\t\n le code ", status: "done" },
                { id: "2", content: "Corriger", status: "in_progress" },
                { id: "3", content: "Tester", status: "pending" }
            ]
        });
        assert.deepEqual(state.todos, [
            { id: "1", content: "Lire le code", status: "done" },
            { id: "2", content: "Corriger", status: "in_progress" },
            { id: "3", content: "Tester", status: "pending" }
        ]);
        assert.equal(result.changed, false);
        assert.equal(result.message, "Tâches : 1 terminée(s) sur 3, en cours : Corriger.");
    } finally {
        state.todos = saved;
    }
});

test("todo_write : une liste vide vide les tâches", async () => {
    const saved = state.todos;
    try {
        const result = await TOOLS.todo_write.run({ todos: [] });
        assert.deepEqual(state.todos, []);
        assert.equal(result.message, "Liste de tâches vidée.");
    } finally {
        state.todos = saved;
    }
});

test("todo_write : validation des statuts et du contenu", () => {
    assert.throws(() => validateToolCall(call("x")), /todos doit être une liste/);
    assert.throws(() => validateToolCall(call([{ id: "1", content: "a", status: "fini" }])), /status doit valoir/);
    assert.throws(() => validateToolCall(call([{ id: "1", content: "   ", status: "pending" }])), /content doit être un texte non vide/);
    assert.throws(() => validateToolCall(call([{ content: "a", status: "pending" }])), /id doit être/);
    assert.throws(() => validateToolCall(call([null])), /doit être un objet/);
    assert.throws(
        () => validateToolCall(call([
            { id: "1", content: "a", status: "pending" },
            { id: "1", content: "b", status: "pending" }
        ])),
        /en double/
    );
});

test("todo_write : au plus une tâche in_progress", () => {
    assert.throws(
        () => normalizeTodos([
            { id: "1", content: "a", status: "in_progress" },
            { id: "2", content: "b", status: "in_progress" }
        ]),
        /Une seule tâche/
    );
});

test("todo_write : 20 tâches au maximum", () => {
    const make = n => Array.from({ length: n }, (_, i) => ({ id: String(i), content: `t${i}`, status: "pending" }));
    assert.equal(normalizeTodos(make(20)).length, 20);
    assert.throws(() => normalizeTodos(make(21)), /20 tâches au maximum/);
});

test("todo_write : résumé sans tâche en cours", () => {
    assert.equal(
        summarizeTodos([{ id: "1", content: "a", status: "done" }, { id: "2", content: "b", status: "pending" }]),
        "Tâches : 1 terminée(s) sur 2."
    );
});
