"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { createStore, reducer, initialState } = require("../src/tui/store");
const { createTuiBackend } = require("../src/tui/adapter");
const { UI_METHODS } = require("../src/ui-bridge");

const BUNDLE = path.join(__dirname, "..", "dist", "tui.mjs");

async function load() {
    process.env.FRST_TUI_NO_START = "1";
    const bundle = await import(pathToFileURL(BUNDLE).href);
    const React = await import("react");
    const { render } = await import("ink-testing-library");
    return { bundle, h: React.createElement, render };
}

async function frameOf(component, props) {
    const { h, render } = await load();
    const view = render(h(component, props));
    try {
        return view.lastFrame();
    } finally {
        view.unmount();
    }
}

const THREE = [
    { id: "1", content: "Lire le code", status: "done" },
    { id: "2", content: "Corriger le bug", status: "in_progress" },
    { id: "3", content: "Lancer les tests", status: "pending" }
];

function many(n, currentIndex) {
    return Array.from({ length: n }, (_, i) => ({
        id: String(i + 1),
        content: `Tâche ${i + 1}`,
        status: i < currentIndex ? "done" : i === currentIndex ? "in_progress" : "pending"
    }));
}

const tick = () => new Promise(resolve => setTimeout(resolve, 50));

test("port : todos fait partie de UI_METHODS", () => {
    assert.ok(UI_METHODS.includes("todos"));
});

test("store : l'action todos remplace la liste par une copie", () => {
    const start = initialState();
    assert.deepEqual(start.todos, []);
    const next = reducer(start, { type: "todos", todos: THREE });
    assert.deepEqual(next.todos, THREE);
    assert.notEqual(next.todos[0], THREE[0]);
    assert.deepEqual(next.transcript, []);
    assert.deepEqual(reducer(next, { type: "todos", todos: null }).todos, []);
});

test("adaptateur : todos met à jour le store sans rien ajouter au transcript", () => {
    const store = createStore();
    const backend = createTuiBackend(store);
    backend.todos(THREE);
    assert.deepEqual(store.getState().todos, THREE);
    assert.equal(store.getState().transcript.length, 0);
    backend.todos([]);
    assert.deepEqual(store.getState().todos, []);
});

test("TodoList : symboles ○ ◐ ● et compteur des tâches terminées", async () => {
    const { bundle } = await load();
    const frame = await frameOf(bundle.TodoList, { todos: THREE, color: false });
    assert.match(frame, /Tâches \(1\/3\)/);
    assert.match(frame, /● Lire le code/);
    assert.match(frame, /◐ Corriger le bug/);
    assert.match(frame, /○ Lancer les tests/);
});

test("TodoList : masquée si la liste est vide ou entièrement terminée", async () => {
    const { bundle } = await load();
    const allDone = THREE.map(todo => ({ ...todo, status: "done" }));
    assert.equal(await frameOf(bundle.TodoList, { todos: allDone, color: false }), "");
    assert.equal(await frameOf(bundle.TodoList, { todos: [], color: false }), "");
    assert.equal(bundle.todosVisible(allDone), false);
    assert.equal(bundle.todoRows(allDone), 0);
});

test("TodoList : 8 tâches au maximum, puis « + N autres »", async () => {
    const { bundle } = await load();
    assert.equal(bundle.TODO_MAX_ROWS, 8);
    const todos = many(11, 0);
    const frame = await frameOf(bundle.TodoList, { todos, color: false });
    assert.match(frame, /Tâche 8\b/);
    assert.doesNotMatch(frame, /Tâche 9\b/);
    assert.match(frame, /\+ 3 autres/);
    assert.equal(bundle.todoRows(todos), 1 + 8 + 1);
    assert.equal(bundle.todoRows(THREE), 1 + 3);
});

test("visibleTodos : la tâche en cours reste visible au-delà de 8", async () => {
    const { bundle } = await load();
    const { items, hidden } = bundle.visibleTodos(many(10, 9));
    assert.equal(items.length, 8);
    assert.equal(hidden, 2);
    assert.equal(items[items.length - 1].status, "in_progress");
});

test("tailLines : extra réserve des lignes en plus", async () => {
    const { bundle } = await load();
    const text = Array.from({ length: 30 }, (_, i) => `l${i}`).join("\n");
    assert.equal(bundle.tailLines(text, 24).length, 18);
    assert.equal(bundle.tailLines(text, 24, 4).length, 14);
    assert.equal(bundle.tailLines(text, 5, 10).length, 1);
});

test("App : la liste apparaît en direct puis disparaît quand tout est terminé", async () => {
    const { bundle, h, render } = await load();
    const store = createStore();
    const view = render(h(bundle.App, { store, color: false }));
    try {
        assert.doesNotMatch(view.lastFrame(), /Tâches \(/);
        store.dispatch({ type: "todos", todos: THREE });
        await tick();
        assert.match(view.lastFrame(), /◐ Corriger le bug/);
        store.dispatch({ type: "todos", todos: THREE.map(todo => ({ ...todo, status: "done" })) });
        await tick();
        assert.doesNotMatch(view.lastFrame(), /Tâches \(/);
    } finally {
        view.unmount();
    }
});

test("ui CLI : todos écrit la liste en texte, rien pour une liste vide", () => {
    const cliUi = require("../src/cli/ui").ui;
    const out = [];
    const original = console.log;
    console.log = (...args) => out.push(args.join(" "));
    try {
        cliUi.todos(THREE);
        cliUi.todos([]);
    } finally {
        console.log = original;
    }
    const text = out.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    assert.match(text, /Tâches \(1\/3\)/);
    assert.match(text, /● Lire le code/);
    assert.match(text, /◐ Corriger le bug/);
    assert.match(text, /○ Lancer les tests/);
    assert.equal(out.length, 4);
});
