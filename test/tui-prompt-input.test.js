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

async function mount(props = {}) {
    const { bundle, h, render } = await load();
    const calls = { submit: [], history: [], exit: 0, clear: 0 };
    const view = render(
        h(bundle.PromptInput, {
            onSubmit: (text) => calls.submit.push(text),
            onHistoryAdd: (text) => calls.history.push(text),
            onExit: () => { calls.exit += 1; },
            onClear: () => { calls.clear += 1; },
            ...props
        })
    );
    await tick();
    const press = async (...keys) => {
        for (const key of keys) {
            view.stdin.write(key);
            await tick();
        }
    };
    return { view, calls, press, frame: () => strip(view.lastFrame()) };
}

test("PromptInput : saisie puis Entrée envoie et ajoute à l'historique", async () => {
    const { view, calls, press, frame } = await mount();
    try {
        await press("bonjour");
        assert.match(frame(), /> bonjour/);
        await press("\r");
        assert.deepEqual(calls.submit, ["bonjour"]);
        assert.deepEqual(calls.history, ["bonjour"]);
        assert.doesNotMatch(frame(), /bonjour/);
    } finally {
        view.unmount();
    }
});

test("PromptInput : « \\ » + Entrée et Ctrl+J ajoutent une ligne", async () => {
    const { view, calls, press, frame } = await mount();
    try {
        await press("a\\", "\r", "b", "\n", "c");
        assert.equal(calls.submit.length, 0);
        const shown = frame();
        assert.match(shown, /> a/);
        assert.match(shown, /b/);
        await press("\r");
        assert.deepEqual(calls.submit, ["a\nb\nc"]);
    } finally {
        view.unmount();
    }
});

test("PromptInput : ↑ rappelle l'historique", async () => {
    const { view, calls, press, frame } = await mount({ history: ["premier", "second"] });
    try {
        await press("\u001b[A");
        assert.match(frame(), /second/);
        await press("\u001b[A");
        assert.match(frame(), /premier/);
        await press("\u001b[B");
        assert.match(frame(), /second/);
        await press("\r");
        assert.deepEqual(calls.submit, ["second"]);
    } finally {
        view.unmount();
    }
});

test("PromptInput : Tab complète une commande slash", async () => {
    const { view, press, frame } = await mount({ commands: ["/help", "/history"] });
    try {
        await press("/he", "\t");
        assert.match(frame(), /\/help/);
        await press("\u001b");
        await press("/h", "\t");
        assert.match(frame(), /\/help {2}\/history/);
    } finally {
        view.unmount();
    }
});

test("PromptInput : Ctrl+C efface, puis un second Ctrl+C quitte", async () => {
    let interrupts = 0;
    const { view, calls, press, frame } = await mount({ onInterrupt: () => { interrupts += 1; return false; } });
    try {
        await press("texte", "\u0003");
        assert.equal(interrupts, 1);
        assert.doesNotMatch(frame(), /texte/);
        assert.match(frame(), /Ctrl\+C à nouveau pour quitter/);
        assert.equal(calls.exit, 0);
        await press("\u0003");
        assert.equal(calls.exit, 1);
    } finally {
        view.unmount();
    }
});

test("PromptInput : Ctrl+C ne quitte pas si une tâche a été interrompue", async () => {
    const { view, calls, press } = await mount({ onInterrupt: () => true });
    try {
        await press("\u0003", "\u0003");
        assert.equal(calls.exit, 0);
    } finally {
        view.unmount();
    }
});

test("PromptInput : Ctrl+D sur saisie vide quitte, Ctrl+L appelle onClear", async () => {
    const { view, calls, press } = await mount();
    try {
        await press("x", "\u0004");
        assert.equal(calls.exit, 0);
        await press("\u001b", "\u0004");
        assert.equal(calls.exit, 1);
        await press("\u000c");
        assert.equal(calls.clear, 1);
    } finally {
        view.unmount();
    }
});

test("PromptInput : Ctrl+V colle le presse-papiers (multiligne)", async () => {
    const { view, calls, press } = await mount({ clipboard: async () => "un\ndeux" });
    try {
        await press("\u0016");
        await tick();
        await press("\r");
        assert.deepEqual(calls.submit, ["un\ndeux"]);
    } finally {
        view.unmount();
    }
});

test("PromptInput : mode secret masque la saisie et n'alimente pas l'historique", async () => {
    const { view, calls, press, frame } = await mount({ secret: true, label: "Clé : " });
    try {
        await press("abc");
        assert.doesNotMatch(frame(), /abc/);
        assert.match(frame(), /•••/);
        await press("\r");
        assert.deepEqual(calls.submit, ["abc"]);
        assert.deepEqual(calls.history, []);
    } finally {
        view.unmount();
    }
});
