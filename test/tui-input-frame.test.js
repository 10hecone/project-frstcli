"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const BUNDLE = path.join(__dirname, "..", "dist", "tui.mjs");

async function load() {
    process.env.FRST_TUI_NO_START = "1";
    const bundle = await import(pathToFileURL(BUNDLE).href);
    const React = await import("react");
    const { render } = await import("ink-testing-library");
    return { bundle, h: React.createElement, render };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 25));
const strip = (text) => String(text ?? "").replace(/\u001b\[[0-9;]*m/g, "");
const lines = (frame) => strip(frame).split("\n").map((line) => line.trimEnd());
const isRule = (line) => /^─+$/.test(line || "");

async function mount(props = {}) {
    const { bundle, h, render } = await load();
    const view = render(h(bundle.PromptInput, { onSubmit: () => {}, ...props }));
    await tick();
    const press = async (...keys) => {
        for (const key of keys) {
            view.stdin.write(key);
            await tick();
        }
    };
    return { view, press };
}

test("Zone de saisie : une ligne horizontale au-dessus et une en dessous (style Claude Code)", async () => {
    const { view, press } = await mount();
    try {
        await press("bonjour");
        const rows = lines(view.lastFrame());
        const at = rows.findIndex((line) => line.startsWith("> "));
        assert.ok(at > 0, `ligne de saisie introuvable :\n${rows.join("\n")}`);
        assert.ok(isRule(rows[at - 1]), `pas de ligne au-dessus :\n${rows.join("\n")}`);
        assert.ok(isRule(rows[at + 1]), `pas de ligne en dessous :\n${rows.join("\n")}`);
        assert.ok(!rows.some((line) => /[│|]\s*>/.test(line)), "pas de bordure verticale attendue");
    } finally {
        view.unmount();
    }
});

test("Zone de saisie multiligne : les deux lignes restent entre les bordures", async () => {
    const { view, press } = await mount();
    try {
        await press("a", "\n", "b");
        const rows = lines(view.lastFrame());
        const first = rows.findIndex((line) => line.startsWith("> a"));
        assert.ok(first > 0);
        assert.ok(isRule(rows[first - 1]));
        assert.match(rows[first + 1], /^\s+b/);
        assert.ok(isRule(rows[first + 2]));
    } finally {
        view.unmount();
    }
});

test("Zone de saisie : une seule ligne horizontale au-dessus et une seule en dessous", async () => {
    const { view } = await mount();
    try {
        const rows = lines(view.lastFrame());
        assert.equal(rows.filter(isRule).length, 2, rows.join("\n"));
    } finally {
        view.unmount();
    }
});
