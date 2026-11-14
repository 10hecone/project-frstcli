"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { reducer, initialState } = require("../src/tui/store");
const { createTuiBackend } = require("../src/tui/adapter");
const { createRemoteStore } = require("../src/gui/remote-store");
const { createGuiHost } = require("../src/gui/host");
const { CHANNELS } = require("../src/gui/channels");

/** Hôte complet avec un cœur simulé : aucun accès réseau, aucun Electron. */
function setup({ bootstrap, handleInput } = {}) {
    const sent = [];
    const calls = { bootstrap: 0, inputs: [], killAll: 0, close: 0, exit: 0 };
    const bridge = {
        current: undefined,
        setUiBackend(backend) {
            this.current = backend;
        }
    };
    const session = {
        async bootstrap() {
            calls.bootstrap += 1;
            return bootstrap ? bootstrap() : { ok: true };
        },
        async handleInput(text, options) {
            calls.inputs.push(text);
            return handleInput ? handleInput(text, options) : { exit: false };
        }
    };
    const host = createGuiHost({
        send: (message) => sent.push(message),
        onExit: () => {
            calls.exit += 1;
        },
        session,
        bridge,
        createBackend: (store) => createTuiBackend(store, { jobs: { runningCount: () => 0 }, usage: {} }),
        jobs: { killAll: () => (calls.killAll += 1) },
        memory: { close: () => (calls.close += 1) }
    });
    return { host, sent, calls, bridge };
}

/** Rejoue les messages reçus par la fenêtre, comme hooks/useSession.js. */
function replay(messages) {
    return messages.reduce((state, { action }) => reducer(state, action), initialState());
}

const entriesOf = (host, type) => host.store.getState().transcript.filter((entry) => entry.type === type);

test("canaux IPC : noms uniques et préfixés", () => {
    const names = Object.values(CHANNELS);
    assert.equal(new Set(names).size, names.length);
    assert.ok(names.every((name) => name.startsWith("frst:")));
});

test("store distant : numérote les actions et n'envoie que les changements", () => {
    const sent = [];
    const store = createRemoteStore((message) => sent.push(message));

    store.dispatch({ type: "append", entry: { type: "info", text: "a" } });
    store.dispatch({ type: "inconnue" });
    store.dispatch({ type: "status", status: { busy: true } });

    assert.deepEqual(
        sent.map((message) => message.seq),
        [1, 2]
    );
    assert.equal(store.snapshot().seq, 2);
    assert.deepEqual(replay(sent), store.getState());
});

test("store distant : une fenêtre fermée ne casse pas le store", () => {
    const store = createRemoteStore(() => {
        throw new Error("fenêtre détruite");
    });
    assert.doesNotThrow(() => store.dispatch({ type: "append", entry: { type: "info", text: "x" } }));
    assert.equal(store.getState().transcript.length, 1);
});

test("hôte : branche son backend sur le port d'interface", () => {
    const { host, bridge } = setup();
    assert.equal(bridge.current, host.backend);
});

test("hôte : démarrage unique, même appelé plusieurs fois", async () => {
    const { host, calls } = setup();
    const [first, second] = await Promise.all([host.start(), host.start()]);
    assert.deepEqual(first, { ok: true });
    assert.equal(second, first);
    assert.equal(calls.bootstrap, 1);
    assert.equal(entriesOf(host, "welcome").length, 1);
});

test("hôte : échec du démarrage affiché, saisie refusée", async () => {
    const { host, calls } = setup({ bootstrap: () => ({ ok: false, reason: "Pas de session." }) });
    assert.deepEqual(await host.start(), { ok: false, reason: "Pas de session." });
    assert.equal(entriesOf(host, "error")[0].text, "Pas de session.");

    const result = await host.submit("bonjour");
    assert.equal(result.ok, false);
    assert.equal(calls.inputs.length, 0);
});

test("hôte : une saisie ajoute le message et diffuse la réponse streamée", async () => {
    const { host, sent, calls } = setup({
        handleInput: (_text, { onChatDelta }) => {
            onChatDelta("Bon");
            onChatDelta("jour\nsuite");
            return { exit: false };
        }
    });

    const result = await host.submit("salut");

    assert.deepEqual(result, { ok: true, exit: false });
    assert.deepEqual(calls.inputs, ["salut"]);
    assert.equal(entriesOf(host, "user")[0].text, "salut");
    assert.deepEqual(
        entriesOf(host, "assistant").map((entry) => entry.text),
        ["Bonjour", "suite"]
    );
    assert.equal(host.store.getState().status.busy, false);
    assert.equal(host.isRunning(), false);
    // La fenêtre obtient exactement le même état en rejouant les actions.
    assert.deepEqual(replay(sent), host.store.getState());
});

test("hôte : saisie vide ou concurrente refusée", async () => {
    let release;
    const { host, calls } = setup({
        handleInput: () => new Promise((resolve) => (release = () => resolve({ exit: false })))
    });

    assert.equal((await host.submit("   ")).ok, false);

    const pending = host.submit("première");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(host.isRunning(), true);
    assert.equal((await host.submit("seconde")).ok, false);

    release();
    await pending;
    assert.deepEqual(calls.inputs, ["première"]);
});

test("hôte : une erreur du cœur est affichée et libère la saisie", async () => {
    const { host } = setup({
        handleInput: () => {
            throw new Error("API indisponible");
        }
    });
    assert.deepEqual(await host.submit("x"), { ok: true, exit: false });
    assert.equal(entriesOf(host, "error")[0].text, "API indisponible");
    assert.equal(host.isRunning(), false);
});

test("hôte : /exit déclenche onExit", async () => {
    const { host, calls } = setup({ handleInput: () => ({ exit: true }) });
    assert.deepEqual(await host.submit("/exit"), { ok: true, exit: true });
    assert.equal(calls.exit, 1);
});

test("hôte : answer résout la question en attente", async () => {
    const { host } = setup();
    const question = host.backend.ask("Ton nom ?");
    const { pendingPrompt } = host.store.getState();
    assert.equal(pendingPrompt.kind, "ask");

    assert.equal(host.answer(String(pendingPrompt.id), "Paul"), true);
    assert.equal(await question, "Paul");
    assert.equal(host.store.getState().pendingPrompt, null);
    assert.equal(host.answer(pendingPrompt.id, "encore"), false);
});

test("hôte : interrupt seulement pendant une tâche", async () => {
    let interrupted = 0;
    let release;
    const { host } = setup({
        handleInput: () =>
            new Promise((resolve) => {
                const off = host.backend.onInterrupt(() => {
                    interrupted += 1;
                    off();
                    resolve({ exit: false });
                });
                release = resolve;
            })
    });

    assert.equal(host.interrupt(), false);
    const pending = host.submit("longue tâche");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(host.interrupt(), true);
    await pending;
    assert.equal(interrupted, 1);
    assert.equal(typeof release, "function");
});

test("hôte : dispose arrête les jobs, ferme la mémoire et débranche le port une seule fois", async () => {
    const { host, calls, bridge } = setup();
    host.dispose();
    host.dispose();
    assert.equal(calls.killAll, 1);
    assert.equal(calls.close, 1);
    assert.equal(bridge.current, null);
    assert.equal((await host.submit("après")).ok, false);
});
