"use strict";

// Défilement de la conversation en plein écran : molette (souris SGR) et PgUp/PgDn.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const BUNDLE = path.join(__dirname, "..", "dist", "tui.mjs");
const WHEEL_UP = "\u001b[<64;10;5M";
const WHEEL_DOWN = "\u001b[<65;10;5M";

async function load() {
    process.env.FRST_TUI_NO_START = "1";
    const bundle = await import(pathToFileURL(BUNDLE).href);
    const React = await import("react");
    const { render } = await import("ink-testing-library");
    return { bundle, h: React.createElement, render };
}

const tick = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));

// Attend qu'une condition sur le rendu soit vraie (la suite complète tourne en parallèle, un délai fixe ne suffit pas).
async function waitFor(check, timeout = 2000) {
    const start = Date.now();
    while (!check()) {
        if (Date.now() - start > timeout) return false;
        await tick(10);
    }
    return true;
}
const strip = (text) => String(text ?? "").replace(/\u001b\[[0-9;]*m/g, "");

function entries(n) {
    return Array.from({ length: n }, (_, i) => ({ id: i + 1, type: "info", text: `message-${String(i).padStart(2, "0")}` }));
}

test("parseWheel : haut, bas, plusieurs crans, clics et relâchements ignorés", async () => {
    const { bundle } = await load();
    const { parseWheel } = bundle;
    assert.equal(parseWheel(WHEEL_UP), 1);
    assert.equal(parseWheel("[<64;1;1M"), 1);
    assert.equal(parseWheel(WHEEL_DOWN), -1);
    assert.equal(parseWheel("[<65;1;1M"), -1);
    assert.equal(parseWheel(WHEEL_UP + WHEEL_UP + WHEEL_UP), 3);
    assert.equal(parseWheel(WHEEL_UP + WHEEL_DOWN), 0);
    assert.equal(parseWheel("[<0;3;4M"), 0);
    assert.equal(parseWheel("[<64;3;4m"), 0);
    assert.equal(parseWheel("bonjour"), 0);
    assert.equal(parseWheel(""), 0);
    assert.equal(parseWheel(undefined), 0);
});

test("isMouseInput : reconnaît les séquences souris, pas le texte normal", async () => {
    const { bundle } = await load();
    const { isMouseInput } = bundle;
    assert.equal(isMouseInput(WHEEL_UP), true);
    assert.equal(isMouseInput("[<0;3;4m"), true);
    assert.equal(isMouseInput("a"), false);
    assert.equal(isMouseInput("[<abc"), false);
    assert.equal(isMouseInput(null), false);
});

test("ConversationView : la molette remonte puis redescend la conversation", async () => {
    const { bundle, h, render } = await load();
    const view = render(h(bundle.ConversationView, { transcript: entries(10), rows: 3, color: false }));
    await tick();
    const frame = () => strip(view.lastFrame());

    assert.match(frame(), /message-09/);
    assert.doesNotMatch(frame(), /plus récente/);

    view.stdin.write(WHEEL_UP);
    await waitFor(() => /plus récente/.test(frame()));
    assert.match(frame(), /message-06/);
    assert.doesNotMatch(frame(), /message-09/);
    assert.match(frame(), /1 entrée\(s\) plus récente\(s\)/);

    view.stdin.write(WHEEL_DOWN);
    await waitFor(() => /message-09/.test(frame()));
    assert.match(frame(), /message-09/);
    assert.doesNotMatch(frame(), /plus récente/);

    view.stdin.write(WHEEL_DOWN);
    await tick();
    assert.match(frame(), /message-09/);
    view.unmount();
});

test("ConversationView : la molette ne dépasse pas la première entrée", async () => {
    const { bundle, h, render } = await load();
    const view = render(h(bundle.ConversationView, { transcript: entries(3), rows: 3, color: false }));
    await tick();
    for (let i = 0; i < 10; i += 1) {
        view.stdin.write(WHEEL_UP);
        await tick(5);
    }
    await tick();
    const frame = strip(view.lastFrame());
    assert.match(frame, /message-00/);
    assert.match(frame, /2 entrée\(s\) plus récente\(s\)/);
    view.unmount();
});

test("PromptInput : les séquences souris ne sont pas insérées dans la saisie", async () => {
    const { bundle, h, render } = await load();
    const submitted = [];
    const view = render(h(bundle.PromptInput, { onSubmit: (text) => submitted.push(text) }));
    await tick();
    view.stdin.write(WHEEL_UP);
    await tick();
    view.stdin.write("[<65;2;2M");
    await tick();
    view.stdin.write("ok");
    await tick();
    const frame = strip(view.lastFrame());
    assert.doesNotMatch(frame, /\[<6[45]/);
    assert.match(frame, /ok/);
    view.unmount();
});
