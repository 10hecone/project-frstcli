"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { createStore, reducer, initialState } = require("../src/tui/store");
const { createTuiBackend } = require("../src/tui/adapter");
const { UI_METHODS, setUiBackend, getUiBackend } = require("../src/ui-bridge");

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

const tick = () => new Promise(resolve => setTimeout(resolve, 50));

const TWO = [
    { task: "Lire src/api", turns: 2, status: "running" },
    { task: "Lire src/tools", turns: 1, status: "done" }
];

function fakeUi() {
    const calls = { subagents: [], interrupt: null, off: 0 };
    const backend = {};
    for (const name of UI_METHODS) backend[name] = () => {};
    backend.subagents = list => calls.subagents.push(list);
    backend.onInterrupt = handler => {
        calls.interrupt = handler;
        return () => { calls.off += 1; };
    };
    return { backend, calls };
}

test("port : subagents fait partie de UI_METHODS", () => {
    assert.ok(UI_METHODS.includes("subagents"));
});

test("store : l'action subagents remplace la liste par une copie", () => {
    const start = initialState();
    assert.deepEqual(start.subagents, []);
    const next = reducer(start, { type: "subagents", subagents: TWO });
    assert.deepEqual(next.subagents, TWO);
    assert.notEqual(next.subagents[0], TWO[0]);
    assert.deepEqual(next.transcript, []);
    assert.deepEqual(reducer(next, { type: "subagents", subagents: null }).subagents, []);
});

test("adaptateur : subagents met à jour le store sans toucher au transcript", () => {
    const store = createStore();
    const backend = createTuiBackend(store);
    backend.subagents(TWO);
    assert.deepEqual(store.getState().subagents, TWO);
    assert.equal(store.getState().transcript.length, 0);
    backend.subagents([]);
    assert.deepEqual(store.getState().subagents, []);
});

test("SubagentList : une ligne par sous-agent avec tours et statut", async () => {
    const { bundle } = await load();
    const frame = await frameOf(bundle.SubagentList, { subagents: TWO, color: false });
    assert.match(frame, /Sous-agents \(2\) · Échap pour annuler/);
    assert.match(frame, /◐ Lire src\/api · 2 tour\(s\) · en cours/);
    assert.match(frame, /● Lire src\/tools · 1 tour\(s\) · terminé/);
    assert.equal(bundle.subagentRows(TWO), 3);
});

test("SubagentList : masquée si vide, sans Échap quand tout est fini", async () => {
    const { bundle } = await load();
    assert.equal(await frameOf(bundle.SubagentList, { subagents: [], color: false }), "");
    assert.equal(bundle.subagentRows([]), 0);
    const ended = [{ task: "a", turns: 3, status: "cancelled" }, { task: "b", turns: 10, status: "limit" }];
    const frame = await frameOf(bundle.SubagentList, { subagents: ended, color: false });
    assert.doesNotMatch(frame, /Échap/);
    assert.match(frame, /✕ a · 3 tour\(s\) · annulé/);
    assert.match(frame, /✕ b · 10 tour\(s\) · limite atteinte/);
});

test("shortTask : consigne sur une ligne, raccourcie à 60 caractères", async () => {
    const { bundle } = await load();
    assert.equal(bundle.SUBAGENT_TASK_CHARS, 60);
    assert.equal(bundle.shortTask("  lire\n  le   code "), "lire le code");
    const long = bundle.shortTask("x".repeat(100));
    assert.equal(long.length, 60);
    assert.ok(long.endsWith("…"));
});

test("App : les sous-agents apparaissent en direct puis disparaissent", async () => {
    const { bundle, h, render } = await load();
    const store = createStore();
    const view = render(h(bundle.App, { store, color: false }));
    try {
        assert.doesNotMatch(view.lastFrame(), /Sous-agents/);
        store.dispatch({ type: "subagents", subagents: TWO });
        await tick();
        assert.match(view.lastFrame(), /◐ Lire src\/api/);
        store.dispatch({ type: "subagents", subagents: [] });
        await tick();
        assert.doesNotMatch(view.lastFrame(), /Sous-agents/);
    } finally {
        view.unmount();
    }
});

test("ui CLI : affiche le début et la fin de chaque sous-agent, rien entre les deux", () => {
    const cliUi = require("../src/cli/ui").ui;
    const out = [];
    const original = console.log;
    console.log = (...args) => out.push(args.join(" "));
    let atStart = 0;
    let afterTurn = 0;
    try {
        cliUi.subagents([
            { task: "Lire src/api", turns: 0, status: "running" },
            { task: "Lire src/tools", turns: 0, status: "running" }
        ]);
        atStart = out.length;
        cliUi.subagents([
            { task: "Lire src/api", turns: 1, status: "running" },
            { task: "Lire src/tools", turns: 0, status: "running" }
        ]);
        afterTurn = out.length;
        cliUi.subagents([
            { task: "Lire src/api", turns: 2, status: "done" },
            { task: "Lire src/tools", turns: 1, status: "cancelled" }
        ]);
        cliUi.subagents([]);
    } finally {
        console.log = original;
    }
    assert.ok(atStart > 0);
    assert.equal(afterTurn, atStart);
    const text = out.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    assert.match(text, /Sous-agents \(2\)/);
    assert.match(text, /◐ Lire src\/api/);
    assert.match(text, /● Lire src\/api \(terminé, 2 tour\(s\)\)/);
    assert.match(text, /✕ Lire src\/tools \(annulé, 1 tour\(s\)\)/);
});

test("runDelegate : affiche les tours, annule via onInterrupt et vide la liste", async () => {
    const { runDelegate } = require("../src/agent/agent");
    const { TOOLS } = require("../src/tools/tools");
    const previousUi = getUiBackend();
    const previousRun = TOOLS.delegate.run;
    const { backend, calls } = fakeUi();
    let seenSignal = null;
    setUiBackend(backend);
    TOOLS.delegate.run = async (args, { signal, onTurn }) => {
        seenSignal = signal;
        onTurn({ index: 0, task: args.tasks[0], turn: 1 });
        calls.interrupt();
        return {
            results: [
                { task: args.tasks[0], ok: false, status: "cancelled", summary: "", turns: 1 },
                { task: args.tasks[1], ok: true, status: "done", summary: "ok", turns: 2 }
            ],
            changed: false,
            message: "fini"
        };
    };
    try {
        const result = await runDelegate({ tasks: ["A", "B"] });
        assert.equal(result.message, "fini");
        assert.equal(seenSignal.aborted, true);
        assert.equal(calls.off, 1);
        assert.deepEqual(calls.subagents[0].map(s => [s.task, s.turns, s.status]), [["A", 0, "running"], ["B", 0, "running"]]);
        assert.equal(calls.subagents[1][0].turns, 1);
        const last = calls.subagents[calls.subagents.length - 2];
        assert.deepEqual(last.map(s => s.status), ["cancelled", "done"]);
        assert.deepEqual(calls.subagents[calls.subagents.length - 1], []);
    } finally {
        TOOLS.delegate.run = previousRun;
        setUiBackend(previousUi);
    }
});

test("runDelegate : la liste est vidée même si delegate échoue", async () => {
    const { runDelegate } = require("../src/agent/agent");
    const { TOOLS } = require("../src/tools/tools");
    const previousUi = getUiBackend();
    const previousRun = TOOLS.delegate.run;
    const { backend, calls } = fakeUi();
    setUiBackend(backend);
    TOOLS.delegate.run = async () => { throw new Error("boum"); };
    try {
        await assert.rejects(runDelegate({ tasks: ["A"] }), /boum/);
        assert.equal(calls.off, 1);
        assert.deepEqual(calls.subagents[calls.subagents.length - 1], []);
    } finally {
        TOOLS.delegate.run = previousRun;
        setUiBackend(previousUi);
    }
});
