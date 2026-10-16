"use strict";

// Menu des commandes slash sous la saisie (comme Claude Code).

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { slashSuggestions } = require("../src/tui/input-model");

const BUNDLE = path.join(__dirname, "..", "dist", "tui.mjs");
const DOWN = "\u001b[B";
const UP = "\u001b[A";

async function load() {
    process.env.FRST_TUI_NO_START = "1";
    const bundle = await import(pathToFileURL(BUNDLE).href);
    const React = await import("react");
    const { render } = await import("ink-testing-library");
    return { bundle, h: React.createElement, render };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 25));
const strip = (text) => String(text ?? "").replace(/\u001b\[[0-9;]*m/g, "");

async function mount(props = {}) {
    const { bundle, h, render } = await load();
    const calls = { submit: [] };
    const view = render(h(bundle.PromptInput, { onSubmit: (text) => calls.submit.push(text), ...props }));
    await tick();
    const press = async (...keys) => {
        for (const key of keys) {
            view.stdin.write(key);
            await tick();
        }
    };
    return { view, calls, press, frame: () => strip(view.lastFrame()) };
}

const COMMANDS = ["/help", "/changes", "/chat-id", "/clear", "/exit"];

test("slashSuggestions : filtre par préfixe, rien hors d'une commande slash", () => {
    assert.deepEqual(slashSuggestions("/c", COMMANDS), ["/changes", "/chat-id", "/clear"]);
    assert.deepEqual(slashSuggestions("/CL", COMMANDS), ["/clear"]);
    assert.deepEqual(slashSuggestions("/", COMMANDS, 2), ["/help", "/changes"]);
    assert.deepEqual(slashSuggestions("/x", COMMANDS), []);
    assert.deepEqual(slashSuggestions("bonjour", COMMANDS), []);
    assert.deepEqual(slashSuggestions("/clear maintenant", COMMANDS), []);
});

test("PromptInput : taper « /c » affiche les commandes correspondantes sous la saisie", async () => {
    const { view, press, frame } = await mount({ commands: COMMANDS });
    try {
        await press("/c");
        const rows = frame().split("\n");
        const input = rows.findIndex((line) => line.startsWith("> /c"));
        assert.ok(input >= 0, frame());
        const below = rows.slice(input + 1).join("\n");
        assert.match(below, /› \/changes/);
        assert.match(below, /\/chat-id/);
        assert.match(below, /\/clear/);
        assert.doesNotMatch(below, /\/help|\/exit/);

        await press("l");
        assert.match(frame(), /› \/clear/);
        assert.doesNotMatch(frame(), /\/changes/);
    } finally {
        view.unmount();
    }
});

test("PromptInput : ↓ puis Entrée lance la commande sélectionnée", async () => {
    const { view, calls, press, frame } = await mount({ commands: COMMANDS });
    try {
        await press("/c", DOWN);
        assert.match(frame(), /› \/chat-id/);
        await press(DOWN, UP);
        assert.match(frame(), /› \/chat-id/);
        await press("\r");
        assert.deepEqual(calls.submit, ["/chat-id"]);
        assert.doesNotMatch(frame(), /\/changes/);
    } finally {
        view.unmount();
    }
});

test("PromptInput : Tab complète une commande unique etferme le menu", async () => {
    const { view, press, frame } = await mount({ commands: COMMANDS });
    try {
        await press("/he", "\t");
        assert.match(frame(), /> \/help/);
        assert.doesNotMatch(frame(), /› /);
    } finally {
        view.unmount();
    }
});

test("PromptInput : pas de menu pour un texte normal", async () => {
    const { view, press, frame } = await mount({ commands: COMMANDS });
    try {
        await press("bonjour");
        assert.doesNotMatch(frame(), /› /);
    } finally {
        view.unmount();
    }
});
