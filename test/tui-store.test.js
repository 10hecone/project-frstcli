"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createStore, ENTRY_TYPES } = require("../src/tui/store");

test("store : append ajoute les entrées dans l'ordre avec un id croissant", () => {
    const store = createStore();
    store.dispatch({ type: "append", entry: { type: "user", text: "a" } });
    store.dispatch({ type: "append", entry: { type: "info", text: "b" } });
    const { transcript } = store.getState();
    assert.deepEqual(transcript.map((e) => e.text), ["a", "b"]);
    assert.ok(transcript[0].id < transcript[1].id);
});

test("store : append refuse un type d'entrée inconnu", () => {
    const store = createStore();
    assert.throws(() => store.dispatch({ type: "append", entry: { type: "inconnu" } }), TypeError);
    assert.ok(ENTRY_TYPES.includes("welcome"));
});

test("store : liveStart / liveAppend / liveEnd déplacent le message dans transcript", () => {
    const store = createStore();
    store.dispatch({ type: "liveStart" });
    store.dispatch({ type: "liveAppend", text: "bon" });
    store.dispatch({ type: "liveAppend", text: "jour" });
    assert.equal(store.getState().live.text, "bonjour");
    store.dispatch({ type: "liveEnd" });
    const state = store.getState();
    assert.equal(state.live, null);
    assert.equal(state.transcript.length, 1);
    assert.equal(state.transcript[0].type, "assistant");
    assert.equal(state.transcript[0].text, "bonjour");
});

test("store : liveEnd sans texte n'ajoute rien", () => {
    const store = createStore();
    store.dispatch({ type: "liveStart" });
    store.dispatch({ type: "liveEnd" });
    assert.equal(store.getState().live, null);
    assert.equal(store.getState().transcript.length, 0);
});

test("store : spinner et status", () => {
    const store = createStore();
    store.dispatch({ type: "spinner", spinner: { id: 1, label: "Réflexion" } });
    assert.equal(store.getState().spinner.label, "Réflexion");
    store.dispatch({ type: "spinner", spinner: null });
    assert.equal(store.getState().spinner, null);

    store.dispatch({ type: "status", status: { mode: "auto" } });
    store.dispatch({ type: "status", status: { model: "m" } });
    assert.deepEqual(store.getState().status, { mode: "auto", model: "m" });
});

test("store : prompts en file, pendingPrompt = le premier", () => {
    const store = createStore();
    store.dispatch({ type: "prompt", prompt: { id: 1, kind: "confirm" } });
    store.dispatch({ type: "prompt", prompt: { id: 2, kind: "ask" } });
    assert.equal(store.getState().pendingPrompt.id, 1);
    store.dispatch({ type: "promptResolved", id: 1 });
    assert.equal(store.getState().pendingPrompt.id, 2);
    store.dispatch({ type: "promptResolved", id: 2 });
    assert.equal(store.getState().pendingPrompt, null);
});

test("store : subscribe notifie les changements et se désinscrit", () => {
    const store = createStore();
    let count = 0;
    const off = store.subscribe(() => count++);
    store.dispatch({ type: "append", entry: { type: "info", text: "x" } });
    store.dispatch({ type: "inconnue" });
    assert.equal(count, 1);
    off();
    store.dispatch({ type: "append", entry: { type: "info", text: "y" } });
    assert.equal(count, 1);
    assert.throws(() => store.subscribe("pas une fonction"), TypeError);
});
