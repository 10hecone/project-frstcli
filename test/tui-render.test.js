"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { createStore } = require("../src/tui/store");

const BUNDLE = path.join(__dirname, "..", "dist", "tui.mjs");

async function load() {
    process.env.FRST_TUI_NO_START = "1";
    const bundle = await import(pathToFileURL(BUNDLE).href);
    const React = await import("react");
    const { render } = await import("ink-testing-library");
    return { App: bundle.App, h: React.createElement, render };
}

test("rendu TUI : le bundle exporte App", async () => {
    const { App } = await load();
    assert.equal(typeof App, "function");
});

test("rendu TUI : le Welcome affiche le cadre, le modèle et le dossier", async () => {
    const { App, h, render } = await load();
    const store = createStore();
    store.dispatch({
        type: "append",
        entry: { type: "welcome", model: "modele-test", workspace: "C:/projets/demo" }
    });

    const view = render(h(App, { store, version: "9.9.9", cwd: "C:/ailleurs" }));
    try {
        const frame = view.lastFrame();
        assert.match(frame, /╭/);
        assert.match(frame, /╰/);
        assert.match(frame, /FranceStudent Code/);
        assert.match(frame, /v9\.9\.9/);
        assert.match(frame, /modele-test/);
        assert.match(frame, /C:\/projets\/demo/);
        assert.match(frame, /\/help/);
        assert.match(frame, /frst --classic/);
    } finally {
        view.unmount();
    }
});

test("rendu TUI : sans projet, le dossier courant est affiché", async () => {
    const { App, h, render } = await load();
    const store = createStore();
    store.dispatch({ type: "append", entry: { type: "welcome", model: "m", workspace: null } });

    const view = render(h(App, { store, version: "1.0.0", cwd: "C:/dossier-courant" }));
    try {
        assert.match(view.lastFrame(), /C:\/dossier-courant/);
    } finally {
        view.unmount();
    }
});
