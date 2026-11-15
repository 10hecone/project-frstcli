"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { state } = require("../src/state");
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

const tick = () => new Promise((resolve) => setTimeout(resolve, 25));
const strip = (text) => String(text ?? "").replace(/\u001b\[[0-9;]*m/g, "");

const ENTER = "\r";
const ESC = "\u001b";
const UP = "\u001b[A";
const DOWN = "\u001b[B";
const CTRL_C = "\u0003";

async function mount(component, props = {}) {
    const { bundle, h, render } = await load();
    const answers = [];
    const view = render(h(bundle[component], { onAnswer: (value) => answers.push(value), ...props }));
    await tick();
    const press = async (...keys) => {
        for (const key of keys) {
            view.stdin.write(key);
            await tick();
        }
    };
    return { view, answers, press, frame: () => strip(view.lastFrame()) };
}

function setupBackend() {
    const store = createStore();
    const backend = createTuiBackend(store);
    return { store, backend, restore: () => {} };
}

async function mountApp(store, backend) {
    const { bundle, h, render } = await load();
    const view = render(
        h(bundle.App, {
            store,
            onSubmit: () => {},
            onAnswer: (id, value) => backend.resolvePrompt(id, value),
            color: false
        })
    );
    await tick();
    const press = async (...keys) => {
        for (const key of keys) {
            view.stdin.write(key);
            await tick();
        }
    };
    return { view, press, frame: () => strip(view.lastFrame()) };
}

test("ConfirmDialog : affiche la question et les options o/n", async () => {
    const { view, frame } = await mount("ConfirmDialog", { question: "Autoriser cette écriture ?" });
    try {
        const out = frame();
        assert.match(out, /Autoriser cette écriture \?/);
        assert.match(out, /o — Oui \(une fois\)/);
        assert.match(out, /n — Non/);
        assert.doesNotMatch(out, /Toujours/);
    } finally {
        view.unmount();
    }
});

test("ConfirmDialog : touches directes o et n", async () => {
    for (const [key, expected] of [["o", "o"], ["n", "n"], ["O", "o"]]) {
        const { view, answers, press } = await mount("ConfirmDialog", { question: "Q ?" });
        try {
            await press(key);
            assert.deepEqual(answers, [expected], `touche ${key}`);
        } finally {
            view.unmount();
        }
    }
});

test("ConfirmDialog : Entrée sans navigation répond non (sélection par défaut)", async () => {
    const { view, answers, press } = await mount("ConfirmDialog", { question: "Q ?" });
    try {
        await press(ENTER);
        assert.deepEqual(answers, ["n"]);
    } finally {
        view.unmount();
    }
});

test("ConfirmDialog : flèches puis Entrée", async () => {
    const first = await mount("ConfirmDialog", { question: "Q ?" });
    try {
        await first.press(UP, ENTER);
        assert.deepEqual(first.answers, ["o"]);
    } finally {
        first.view.unmount();
    }
});

test("ConfirmDialog : Échap et Ctrl+C répondent non, une seule fois", async () => {
    const esc = await mount("ConfirmDialog", { question: "Q ?" });
    try {
        await esc.press(ESC, "o");
        assert.deepEqual(esc.answers, ["n"]);
    } finally {
        esc.view.unmount();
    }
    const ctrl = await mount("ConfirmDialog", { question: "Q ?" });
    try {
        await ctrl.press(CTRL_C);
        assert.deepEqual(ctrl.answers, ["n"]);
    } finally {
        ctrl.view.unmount();
    }
});

test("ConfirmDialog : pas d'option t pour une écriture", async () => {
    const { view, answers, press, frame } = await mount("ConfirmDialog", { question: "Continuer ?" });
    try {
        assert.doesNotMatch(frame(), /Toujours/);
        await press("t");
        assert.deepEqual(answers, []);
        await press(DOWN, DOWN, ENTER);
        assert.deepEqual(answers, ["n"]);
    } finally {
        view.unmount();
    }
});

test("ConfirmDialog : une commande propose « toujours » avec son préfixe", async () => {
    const { view, answers, press, frame } = await mount("ConfirmDialog", {
        question: "Lancer \"npm test\" ?",
        kind: "command",
        prefix: "npm test"
    });
    try {
        assert.match(frame(), /Toujours « npm test »/);
        await press("t");
        assert.deepEqual(answers, ["t"]);
    } finally {
        view.unmount();
    }
});

test("TextPrompt : saisie libre, retour arrière et Entrée", async () => {
    const { view, answers, press, frame } = await mount("TextPrompt", { question: "E-mail : " });
    try {
        await press("a", "@", "b", "x", "\u007f", ".", "f", "r");
        assert.match(frame(), /E-mail : a@b\.fr/);
        await press(ENTER);
        assert.deepEqual(answers, ["a@b.fr"]);
    } finally {
        view.unmount();
    }
});

test("TextPrompt : Échap annule avec une réponse vide", async () => {
    const { view, answers, press } = await mount("TextPrompt", { question: "E-mail : " });
    try {
        await press("x", ESC);
        assert.deepEqual(answers, [""]);
    } finally {
        view.unmount();
    }
});

test("TextPrompt secret : le mot de passe n'apparaît jamais dans lastFrame()", async () => {
    const secret = "hunter2";
    const { view, answers, press, frame } = await mount("TextPrompt", { question: "Mot de passe : ", secret: true });
    try {
        for (const ch of secret) {
            await press(ch);
            assert.ok(!frame().includes("hunter"), "aucun fragment du secret à l'écran");
            for (const output of view.frames) assert.ok(!strip(output).includes("hunter"));
        }
        assert.match(frame(), /•{7}/);
        await press(ENTER);
        assert.deepEqual(answers, [secret]);
        assert.ok(!frame().includes(secret));
        for (const output of view.frames) assert.ok(!strip(output).includes(secret));
    } finally {
        view.unmount();
    }
});

test("App : un confirm affiche le dialogue à la place de la saisie et résout la promesse", async () => {
    const { store, backend, restore } = setupBackend();
    const app = await mountApp(store, backend);
    try {
        assert.match(app.frame(), /^\s*>/m);
        const answer = backend.confirm("Autoriser cette écriture ?");
        await tick();
        assert.match(app.frame(), /Autoriser cette écriture \?/);
        assert.doesNotMatch(app.frame(), /Toujours/);
        await app.press("o");
        assert.equal(await answer, true);
        assert.equal(store.getState().pendingPrompt, null);
        assert.doesNotMatch(app.frame(), /Autoriser cette écriture/);
    } finally {
        app.view.unmount();
        restore();
    }
});

test("App : Échap refuse, t est ignoré", async () => {
    const { store, backend, restore } = setupBackend();
    const app = await mountApp(store, backend);
    try {
        const refused = backend.confirm("Supprimer a.txt ?");
        await tick();
        await app.press(ESC);
        assert.equal(await refused, false);

        const second = backend.confirm("Supprimer b.txt ?");
        await tick();
        await app.press("t", "o");
        assert.equal(await second, true);
    } finally {
        app.view.unmount();
        restore();
    }
});

test("App : la prolongation des tours n'offre pas t", async () => {
    const { store, backend, restore } = setupBackend();
    const app = await mountApp(store, backend);
    try {
        const more = backend.confirm("Limite de 30 tours atteinte. Continuer 20 tours de plus ?");
        await tick();
        assert.match(app.frame(), /Limite de 30 tours atteinte/);
        assert.doesNotMatch(app.frame(), /Toujours/);
        await app.press("o");
        assert.equal(await more, true);
    } finally {
        app.view.unmount();
        restore();
    }
});

test("App : askCommand renvoie t pour « toujours »", async () => {
    const { store, backend, restore } = setupBackend();
    const app = await mountApp(store, backend);
    try {
        const answer = backend.askCommand("Lancer \"npm test\" dans le projet ?", "npm test");
        await tick();
        assert.match(app.frame(), /Toujours « npm test »/);
        await app.press("t");
        assert.equal(await answer, "t");
    } finally {
        app.view.unmount();
        restore();
    }
});

test("App : connexion (ask puis askSecret) sans afficher le mot de passe", async () => {
    const { store, backend, restore } = setupBackend();
    const app = await mountApp(store, backend);
    const secret = "s3cretPwd";
    try {
        const email = backend.ask("E-mail : ");
        const password = backend.askSecret("Mot de passe (saisie masquée) : ");
        await tick();
        assert.match(app.frame(), /E-mail :/);
        await app.press(..."a@b.fr", ENTER);
        assert.equal(await email, "a@b.fr");

        assert.match(app.frame(), /Mot de passe \(saisie masquée\)/);
        for (const ch of secret) {
            await app.press(ch);
            assert.ok(!app.frame().includes("s3cret"));
        }
        await app.press(ENTER);
        assert.equal(await password, secret);
        for (const output of app.view.frames) assert.ok(!strip(output).includes(secret));
    } finally {
        app.view.unmount();
        restore();
    }
});
