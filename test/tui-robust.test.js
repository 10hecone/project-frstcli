"use strict";

// Étape 10 : /clear, sortie propre, NO_COLOR, redimensionnement.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { createStore, reducer, initialState } = require("../src/tui/store");
const { createTuiBackend } = require("../src/tui/adapter");
const { restoreTerminal } = require("../bin/frst.js");

const BUNDLE = path.join(__dirname, "..", "dist", "tui.mjs");
const CTRL_C = "\u0003";
const CTRL_D = "\u0004";

async function load() {
    process.env.FRST_TUI_NO_START = "1";
    const bundle = await import(pathToFileURL(BUNDLE).href);
    const React = await import("react");
    const { render } = await import("ink-testing-library");
    return { bundle, h: React.createElement, render };
}

const tick = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));
const strip = (text) => String(text ?? "").replace(/\u001b\[[0-9;]*m/g, "");

function fakeBackend(store, extra = {}) {
    return createTuiBackend(store, {
        jobs: { runningCount: () => 0 },
        usage: { inputTokens: 0, outputTokens: 0 },
        ...extra
    });
}

// ---- Store et adaptateur : /clear ----

test("store : l'action clear vide l'affichage et garde status, prompts et nextId", () => {
    let s = initialState();
    s = reducer(s, { type: "append", entry: { type: "info", text: "a" } });
    s = reducer(s, { type: "commandLine", text: "sortie" });
    s = reducer(s, { type: "liveAppend", text: "en cours" });
    s = reducer(s, { type: "status", status: { mode: "code" } });
    s = reducer(s, { type: "prompt", prompt: { id: 7, kind: "ask", question: "?" } });
    const before = s.nextId;

    const after = reducer(s, { type: "clear" });
    assert.deepEqual(after.transcript, []);
    assert.equal(after.live, null);
    assert.equal(after.command, null);
    assert.equal(after.epoch, 1);
    assert.equal(after.nextId, before);
    assert.deepEqual(after.status, { mode: "code" });
    assert.equal(after.pendingPrompt.id, 7);
    assert.equal(reducer(after, { type: "clear" }).epoch, 2);
});

test("adaptateur : clear() efface l'écran, vide le store et réaffiche l'accueil", () => {
    const store = createStore();
    let screens = 0;
    const backend = fakeBackend(store, { onClearScreen: () => { screens += 1; } });
    backend.banner();
    backend.info("avant");
    backend.clear();

    const { transcript, epoch } = store.getState();
    assert.equal(screens, 1);
    assert.equal(epoch, 1);
    assert.equal(transcript.length, 1);
    assert.equal(transcript[0].type, "welcome");
});

test("adaptateur : clear() fonctionne même si l'effacement de l'écran échoue", () => {
    const store = createStore();
    const backend = fakeBackend(store, { onClearScreen: () => { throw new Error("tty"); } });
    backend.info("avant");
    assert.doesNotThrow(() => backend.clear());
    assert.deepEqual(store.getState().transcript.map((e) => e.type), ["welcome"]);
});

test("ui CLI : clear() appelle console.clear", () => {
    const cliUi = require("../src/cli/ui").ui;
    const original = console.clear;
    let calls = 0;
    console.clear = () => { calls += 1; };
    try {
        cliUi.clear();
    } finally {
        console.clear = original;
    }
    assert.equal(calls, 1);
});

test("App : après /clear, les nouvelles entrées s'affichent (Static remonté)", async () => {
    const { bundle, h, render } = await load();
    const store = createStore();
    const backend = fakeBackend(store);
    backend.info("AVANT-CLEAR");
    const view = render(h(bundle.App, { store, color: false }));
    await tick();
    assert.match(strip(view.lastFrame()), /AVANT-CLEAR/);

    backend.clear();
    await tick();
    backend.info("APRES-CLEAR");
    await tick();
    assert.match(strip(view.lastFrame()), /APRES-CLEAR/);
    view.unmount();
});

// ---- Sortie propre ----

function fakeStream({ tty = true } = {}) {
    const calls = [];
    return {
        calls,
        stdin: { isTTY: tty, setRawMode: (v) => calls.push(["rawMode", v]) },
        stdout: { write: (s) => { calls.push(["write", s]); return true; } }
    };
}

test("cleanExit : arrête les jobs, ferme la mémoire, démonte et restaure le terminal", async () => {
    const { bundle } = await load();
    const order = [];
    const io = fakeStream();
    const done = bundle.cleanExit({
        jobs: { killAll: () => order.push("jobs") },
        memory: { close: () => order.push("memory") },
        instance: { unmount: () => order.push("unmount") },
        stdin: io.stdin,
        stdout: io.stdout
    });
    assert.deepEqual(order, ["jobs", "memory", "unmount"]);
    assert.deepEqual(done, ["jobs", "memory", "unmount", "rawMode", "cursor"]);
    assert.deepEqual(io.calls, [["rawMode", false], ["write", bundle.SHOW_CURSOR]]);
    assert.equal(bundle.SHOW_CURSOR, "\u001b[?25h");
});

test("cleanExit : une étape en erreur n'empêche pas la restauration du terminal", async () => {
    const { bundle } = await load();
    const io = fakeStream();
    const done = bundle.cleanExit({
        jobs: { killAll: () => { throw new Error("boom"); } },
        memory: { close: () => { throw new Error("boom"); } },
        instance: null,
        stdin: io.stdin,
        stdout: io.stdout
    });
    assert.deepEqual(done, ["rawMode", "cursor"]);
    assert.deepEqual(io.calls.at(-1), ["write", "\u001b[?25h"]);
});

test("cleanExit : ne touche pas au mode brut hors TTY", async () => {
    const { bundle } = await load();
    const io = fakeStream({ tty: false });
    const done = bundle.cleanExit({ stdin: io.stdin, stdout: io.stdout });
    assert.deepEqual(done, ["cursor"]);
});

test("restoreTerminal (bin/frst.js) : désactive le mode brut et réaffiche le curseur", () => {
    const io = fakeStream();
    restoreTerminal({ stdin: io.stdin, stdout: io.stdout });
    assert.deepEqual(io.calls, [["rawMode", false], ["write", "\u001b[?25h"]]);
    assert.doesNotThrow(() => restoreTerminal({
        stdin: { isTTY: true, setRawMode: () => { throw new Error("x"); } },
        stdout: { write: () => { throw new Error("x"); } }
    }));
});

test("App : double Ctrl+C appelle onExit", async () => {
    const { bundle, h, render } = await load();
    const store = createStore();
    let exits = 0;
    const view = render(h(bundle.App, {
        store,
        color: false,
        onSubmit: () => {},
        onInterrupt: () => false,
        onExit: () => { exits += 1; }
    }));
    await tick();
    view.stdin.write(CTRL_C);
    await tick();
    assert.equal(exits, 0);
    view.stdin.write(CTRL_C);
    await tick();
    assert.equal(exits, 1);
    view.unmount();
});

test("App : Ctrl+D sur une saisie vide appelle onExit", async () => {
    const { bundle, h, render } = await load();
    const store = createStore();
    let exits = 0;
    const view = render(h(bundle.App, {
        store,
        color: false,
        onSubmit: () => {},
        onInterrupt: () => false,
        onExit: () => { exits += 1; }
    }));
    await tick();
    view.stdin.write(CTRL_D);
    await tick();
    assert.equal(exits, 1);
    view.unmount();
});

// ---- NO_COLOR ----

test("colorEnabled : NO_COLOR non vide désactive les couleurs", async () => {
    const { bundle } = await load();
    assert.equal(bundle.colorEnabled({}), true);
    assert.equal(bundle.colorEnabled({ NO_COLOR: "" }), true);
    assert.equal(bundle.colorEnabled({ NO_COLOR: "1" }), false);
});

test("adaptateur sous NO_COLOR : le rendu ne contient aucune séquence de couleur", async () => {
    const { bundle, h, render } = await load();
    const store = createStore();
    const backend = fakeBackend(store);
    backend.info("information");
    const stream = backend.stream();
    stream.write("Du **gras** et du `code`\nligne en cours");
    backend.refreshStatus({ branch: "dev" });
    const color = bundle.colorEnabled({ NO_COLOR: "1" });
    const view = render(h(bundle.App, { store, color }));
    await tick(80);
    const frame = String(view.lastFrame());
    assert.match(frame, /information/);
    assert.doesNotMatch(frame, /\u001b\[/);
    stream.end();
    view.unmount();
});

// ---- Redimensionnement ----

test("LiveMessage : la hauteur suit l'événement resize de stdout", async () => {
    const { bundle, h, render } = await load();
    const text = Array.from({ length: 30 }, (_, i) => `ligne-${String(i).padStart(2, "0")}`).join("\n");
    const view = render(h(bundle.LiveMessage, { live: { id: 1, text }, color: false }));
    view.stdout.rows = 30;
    view.stdout.emit("resize");
    await tick();
    let frame = strip(view.lastFrame());
    assert.match(frame, /ligne-04/);
    assert.doesNotMatch(frame, /ligne-03/);

    view.stdout.rows = 10;
    view.stdout.emit("resize");
    await tick();
    frame = strip(view.lastFrame());
    assert.match(frame, /ligne-29/);
    assert.match(frame, /ligne-24/);
    assert.doesNotMatch(frame, /ligne-23/);
    view.unmount();
});
