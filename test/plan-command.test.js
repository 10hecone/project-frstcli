"use strict";

// /plan : chat avec les seuls outils de lecture (plus de runAgent).

const test = require("node:test");
const assert = require("node:assert/strict");

const { state, resetConversation } = require("../src/state");
const chat = require("../src/core/chat");
const commands = require("../src/cli/commands");
const { setUiBackend, UI_METHODS } = require("../src/ui-bridge");

function setup({ workspace = "C:/projet", response = "1. Modifier a.js", failure = null } = {}) {
    const original = { send: chat.send, workspace: state.workspace };
    const log = { send: [], ui: [], stops: 0 };

    chat.send = async (input, options = {}) => {
        log.send.push({ input, options });
        if (options.onToolCalls) options.onToolCalls([]);
        if (failure) throw failure;
        return { response, newChatId: null };
    };

    const impl = {};
    for (const name of UI_METHODS) {
        impl[name] = (...args) => {
            log.ui.push([name, ...args]);
        };
    }
    impl.spinner = () => ({
        update() {},
        stop() {
            log.stops += 1;
        },
    });
    setUiBackend(impl);

    resetConversation();
    state.workspace = workspace;

    function restore() {
        chat.send = original.send;
        state.workspace = original.workspace;
        setUiBackend(null);
        resetConversation();
    }

    return { log, restore };
}

test("/plan passe par chat.send en lecture seule et affiche le plan", async () => {
    const env = setup();
    try {
        assert.equal(await commands.handleCommand("/plan ajouter un test"), true);
        assert.equal(env.log.send.length, 1);

        const [{ input, options }] = env.log.send;
        assert.equal(options.readOnly, true);
        assert.equal(typeof options.onToolCalls, "function");
        assert.match(input, /^MODE PLAN \(lecture seule\)/);
        assert.match(input, /Demande : ajouter un test$/);

        assert.ok(env.log.stops >= 1);
        assert.deepEqual(
            env.log.ui.filter(([method]) => method === "assistant"),
            [["assistant", "1. Modifier a.js"]],
        );
    } finally {
        env.restore();
    }
});

test("/plan sans demande affiche l'usage, sans appel au modèle", async () => {
    const env = setup();
    try {
        await commands.handleCommand("/plan");
        assert.equal(env.log.send.length, 0);
        assert.ok(env.log.ui.some(([method, text]) => method === "info" && /Usage : \/plan/.test(text)));
    } finally {
        env.restore();
    }
});

test("/plan sans projet : aucun appel au modèle", async () => {
    const env = setup({ workspace: null });
    try {
        await commands.handleCommand("/plan quelque chose");
        assert.equal(env.log.send.length, 0);
        assert.ok(env.log.ui.some(([method, text]) => method === "info" && /Aucun projet sélectionné/.test(text)));
    } finally {
        env.restore();
    }
});

test("/plan : une erreur du modèle remonte et le spinner est arrêté", async () => {
    const env = setup({ failure: new Error("403 : outils client non activés") });
    try {
        await assert.rejects(commands.handleCommand("/plan x"), /outils client non activés/);
        assert.ok(env.log.stops >= 1);
        assert.equal(env.log.ui.some(([method]) => method === "assistant"), false);
    } finally {
        env.restore();
    }
});
