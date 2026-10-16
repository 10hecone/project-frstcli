"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { createStore } = require("../src/tui/store");
const { createTuiBackend } = require("../src/tui/adapter");

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

test("composants TUI : UserMessage affiche le préfixe >", async () => {
    const { bundle } = await load();
    const frame = await frameOf(bundle.UserMessage, { text: "bonjour" });
    assert.match(frame, /> bonjour/);
});

test("composants TUI : AssistantMessage rend le Markdown léger", async () => {
    const { bundle } = await load();
    const frame = await frameOf(bundle.AssistantMessage, { text: "- point", color: false });
    assert.match(frame, /• point/);
    const line = await frameOf(bundle.AssistantMessage, { text: "- ligne", line: true, color: false });
    assert.match(line, /• ligne/);
});

test("composants TUI : ToolCall et ToolResult", async () => {
    const { bundle } = await load();
    const call = await frameOf(bundle.ToolCall, { name: "read_file", arg: "src/a.js" });
    assert.match(call, /● Lire src\/a\.js/);
    const result = await frameOf(bundle.ToolResult, { text: "12 lignes" });
    assert.match(result, /⎿ 12 lignes/);
});

test("composants TUI : CommandOutput indique les lignes masquées", async () => {
    const { bundle } = await load();
    const frame = await frameOf(bundle.CommandOutput, { lines: ["aaa", "bbb"], hidden: 3 });
    assert.match(frame, /3 ligne\(s\) masquée\(s\)/);
    assert.match(frame, /aaa/);
    assert.match(frame, /bbb/);
});

test("composants TUI : Diff affiche ajouts, suppressions et compteurs", async () => {
    const { bundle } = await load();
    const frame = await frameOf(bundle.Diff, {
        lines: [
            { type: "-", num: 1, text: "ancien" },
            { type: "+", num: 1, text: "nouveau" }
        ],
        added: 1,
        removed: 1
    });
    assert.match(frame, /- ancien/);
    assert.match(frame, /\+ nouveau/);
    assert.match(frame, /\+1 -1/);
});

test("composants TUI : Plan numérote les étapes", async () => {
    const { bundle } = await load();
    const frame = await frameOf(bundle.Plan, { items: ["Lire", "Modifier"] });
    assert.match(frame, /Plan/);
    assert.match(frame, /1\. Lire/);
    assert.match(frame, /2\. Modifier/);
});

test("composants TUI : tailLines garde les dernières lignes", async () => {
    const { bundle } = await load();
    // 8 lignes de terminal - 6 réservées (spinner, marge, bordures haut/bas de la saisie, saisie, barre d'état) = 2 lignes visibles.
    const out = bundle.tailLines("l1\nl2\nl3\nl4", 8);
    const lines = Array.isArray(out) ? out : String(out).split("\n");
    assert.deepEqual(lines, ["l3", "l4"]);
});

test("submitInput : le flux du chat arrive ligne par ligne dans le transcript", async () => {
    const { bundle } = await load();
    const store = createStore();
    const backend = createTuiBackend(store);
    let busyDuring = null;

    const session = {
        async handleInput(text, { onChatDelta }) {
            busyDuring = Boolean(store.getState().status.busy);
            onChatDelta("Bon");
            onChatDelta("jour\nle ");
            onChatDelta("monde");
            return { exit: false };
        }
    };

    const outcome = await bundle.submitInput("bonjour", { store, backend, session });
    const state = store.getState();

    assert.deepEqual(outcome, { exit: false });
    assert.equal(busyDuring, true);
    assert.equal(state.status.busy, false);
    assert.equal(state.live, null);
    assert.equal(state.transcript[0].type, "user");
    assert.equal(state.transcript[0].text, "bonjour");
    const texts = state.transcript.filter((entry) => entry.type === "assistant").map((entry) => entry.text);
    assert.ok(texts.includes("Bonjour"), JSON.stringify(texts));
    assert.ok(texts.includes("le monde"), JSON.stringify(texts));
});

test("submitInput : erreur affichée, exit transmis, saisie vide ignorée", async () => {
    const { bundle } = await load();
    const store = createStore();
    const backend = createTuiBackend(store);

    const failing = { async handleInput() { throw new Error("panne"); } };
    await bundle.submitInput("x", { store, backend, session: failing });
    assert.ok(store.getState().transcript.some((entry) => entry.type === "error" && /panne/.test(String(entry.text))));
    assert.equal(store.getState().status.busy, false);

    const quitting = { async handleInput() { return { exit: true }; } };
    assert.deepEqual(await bundle.submitInput("/exit", { store, backend, session: quitting }), { exit: true });
    assert.deepEqual(await bundle.submitInput("   ", { store, backend, session: quitting }), { exit: false });
});
