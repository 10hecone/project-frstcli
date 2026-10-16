"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { state } = require("../src/state");
const { UI_METHODS } = require("../src/ui-bridge");
const { createStore } = require("../src/tui/store");
const { createTuiBackend, STREAM_INTERVAL_MS } = require("../src/tui/adapter");

function fakeClock() {
    const clock = { time: 0, timers: [] };
    clock.now = () => clock.time;
    clock.setTimer = (fn, delay) => {
        const timer = { fn, at: clock.time + delay, done: false };
        clock.timers.push(timer);
        return timer;
    };
    clock.clearTimer = (timer) => {
        if (timer) timer.done = true;
    };
    clock.advance = (ms) => {
        clock.time += ms;
        for (const timer of clock.timers) {
            if (!timer.done && timer.at <= clock.time) {
                timer.done = true;
                timer.fn();
            }
        }
    };
    return clock;
}

function setup() {
    const store = createStore();
    const clock = fakeClock();
    const backend = createTuiBackend(store, clock);
    const previousAuto = state.autoApprove;
    state.autoApprove = false;
    return { store, clock, backend, restore: () => { state.autoApprove = previousAuto; } };
}

test("adaptateur : implémente toutes les méthodes du port", () => {
    const { backend, restore } = setup();
    try {
        for (const name of UI_METHODS) {
            assert.equal(typeof backend[name], "function", `méthode ${name} manquante`);
        }
    } finally {
        restore();
    }
});

test("adaptateur : les méthodes d'affichage poussent les entrées dans l'ordre", () => {
    const { store, backend, restore } = setup();
    try {
        backend.banner();
        backend.info("i");
        backend.tool("read_file", "src/a.js");
        backend.result("ko", { tone: "error" });
        backend.plan(["un", "deux"]);
        const counts = backend.diff({ lines: [{ type: "add", text: "x" }], added: 1, removed: 0 });
        backend.warn("w");
        backend.error("e");
        backend.assistant("a");
        backend.print(["p1", "p2"]);
        backend.commandLine("sortie");

        assert.deepEqual(counts, { added: 1, removed: 0 });
        const types = store.getState().transcript.map((entry) => entry.type);
        assert.deepEqual(types, [
            "welcome", "info", "tool", "result", "plan", "diff",
            "warn", "error", "assistant", "print"
        ]);
        assert.deepEqual(store.getState().command, { lines: ["sortie"], total: 1 });
        backend.info("suite");
        const folded = store.getState().transcript.at(-2);
        assert.equal(folded.type, "print");
        assert.equal(folded.command, true);
        assert.deepEqual(folded.lines, ["sortie"]);
        assert.equal(store.getState().command, null);
        const result = store.getState().transcript[3];
        assert.equal(result.tone, "error");
        assert.equal(store.getState().transcript[0].model, state.model);
    } finally {
        restore();
    }
});

test("adaptateur : confirm crée un pendingPrompt résolu par resolvePrompt", async () => {
    const { store, backend, restore } = setup();
    try {
        const answer = backend.confirm("Autoriser ?");
        const pending = store.getState().pendingPrompt;
        assert.equal(pending.kind, "confirm");
        assert.equal(pending.question, "Autoriser ?");

        assert.equal(backend.resolvePrompt(pending.id, "o"), true);
        assert.equal(await answer, true);
        assert.equal(store.getState().pendingPrompt, null);
        assert.equal(backend.resolvePrompt(pending.id, "o"), false);

        const refused = backend.confirm("Encore ?");
        backend.resolvePrompt(store.getState().pendingPrompt.id, "n");
        assert.equal(await refused, false);
        assert.equal(state.autoApprove, false);
    } finally {
        restore();
    }
});

test("adaptateur : t active autoApprove, puis confirm répond oui sans prompt", async () => {
    const { store, backend, restore } = setup();
    try {
        const answer = backend.confirm("Autoriser ?");
        backend.resolvePrompt(store.getState().pendingPrompt.id, "t");
        assert.equal(await answer, true);
        assert.equal(state.autoApprove, true);
        assert.ok(store.getState().transcript.some((entry) => entry.type === "warn"));

        assert.equal(await backend.confirm("Sans prompt ?"), true);
        assert.equal(store.getState().pendingPrompt, null);
    } finally {
        restore();
    }
});

test("adaptateur : confirm avec force ignore autoApprove et refuse t", async () => {
    const { store, backend, restore } = setup();
    try {
        state.autoApprove = true;
        const answer = backend.confirm("Vraiment ?", { force: true });
        const pending = store.getState().pendingPrompt;
        assert.ok(pending);
        assert.equal(pending.force, true);
        backend.resolvePrompt(pending.id, "t");
        assert.equal(await answer, false);
    } finally {
        restore();
    }
});

test("adaptateur : askCommand n'est jamais auto-approuvé et renvoie la réponse brute", async () => {
    const { store, backend, restore } = setup();
    try {
        state.autoApprove = true;
        const answer = backend.askCommand("Lancer npm test ?", "npm test");
        const pending = store.getState().pendingPrompt;
        assert.equal(pending.kind, "command");
        assert.equal(pending.prefix, "npm test");
        backend.resolvePrompt(pending.id, "t");
        assert.equal(await answer, "t");
    } finally {
        restore();
    }
});

test("adaptateur : ask et askSecret renvoient la valeur saisie", async () => {
    const { store, backend, restore } = setup();
    try {
        const email = backend.ask("E-mail : ");
        const secret = backend.askSecret("Mot de passe : ");
        const first = store.getState().pendingPrompt;
        assert.equal(first.kind, "ask");
        backend.resolvePrompt(first.id, "a@b.fr");
        const second = store.getState().pendingPrompt;
        assert.equal(second.kind, "secret");
        assert.equal(second.secret, true);
        backend.resolvePrompt(second.id, "motdepasse");
        assert.equal(await email, "a@b.fr");
        assert.equal(await secret, "motdepasse");
    } finally {
        restore();
    }
});

test("adaptateur : stream regroupe les deltas (horloge injectée) et end vide le tampon", () => {
    const { store, clock, backend, restore } = setup();
    try {
        const appends = [];
        store.subscribe((_, action) => {
            if (action.type === "liveAppend") appends.push(action.text);
        });

        const s = backend.stream();
        s.write("a");
        assert.deepEqual(appends, ["a"]);

        clock.advance(10);
        s.write("b");
        clock.advance(10);
        s.write("c");
        assert.deepEqual(appends, ["a"]);

        clock.advance(STREAM_INTERVAL_MS);
        assert.deepEqual(appends, ["a", "bc"]);

        clock.advance(5);
        s.write("d");
        s.end();
        assert.deepEqual(appends, ["a", "bc", "d"]);

        const state = store.getState();
        assert.equal(state.live, null);
        assert.equal(state.transcript[state.transcript.length - 1].text, "abcd");

        s.write("ignoré");
        assert.deepEqual(appends, ["a", "bc", "d"]);
    } finally {
        restore();
    }
});

test("adaptateur : spinner update et stop", () => {
    const { store, backend, restore } = setup();
    try {
        const spin = backend.spinner("Réflexion");
        assert.equal(store.getState().spinner.label, "Réflexion");
        spin.update("Réflexion (tour 2)");
        assert.equal(store.getState().spinner.label, "Réflexion (tour 2)");
        spin.stop();
        spin.stop();
        assert.equal(store.getState().spinner, null);
    } finally {
        restore();
    }
});

test("adaptateur : onInterrupt gère une pile et se désinscrit", () => {
    const { backend, restore } = setup();
    try {
        const calls = [];
        const offA = backend.onInterrupt(() => calls.push("A"));
        const offB = backend.onInterrupt(() => calls.push("B"));

        assert.equal(backend.interrupt(), true);
        offB();
        assert.equal(backend.interrupt(), true);
        offA();
        assert.equal(backend.interrupt(), false);
        assert.deepEqual(calls, ["B", "A"]);
    } finally {
        restore();
    }
});

test("adaptateur : refuse de se créer sans store", () => {
    assert.throws(() => createTuiBackend(null), TypeError);
});
