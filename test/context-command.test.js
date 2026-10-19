"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { CONFIG } = require("../src/config");
const { state } = require("../src/state");
const { setUiBackend, UI_METHODS } = require("../src/ui-bridge");
const commands = require("../src/cli/commands");

function captureUi() {
    const lines = [];
    const fakeUi = {};
    for (const name of UI_METHODS) {
        fakeUi[name] = (...args) => {
            if (name === "info" || name === "warn") lines.push(String(args[0]));
        };
    }
    setUiBackend(fakeUi);
    return lines;
}

function saveState() {
    return {
        chatIds: { ...state.chatIds },
        history: state.history,
        contextUsagePercent: state.contextUsagePercent,
        autoCompact: CONFIG.autoCompact,
        threshold: CONFIG.autoCompactThreshold
    };
}

function restore(saved) {
    state.chatIds = saved.chatIds;
    state.history = saved.history;
    state.contextUsagePercent = saved.contextUsagePercent;
    CONFIG.autoCompact = saved.autoCompact;
    CONFIG.autoCompactThreshold = saved.threshold;
    setUiBackend(null);
}

test("/context affiche le pourcentage, le chat ID, les tours et le seuil", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        const lines = captureUi();
        state.chatIds = { chat: null, agent: "agent-42" };
        state.contextUsagePercent = 42.4;
        state.history = [
            { role: "user", content: "a" },
            { role: "assistant", content: "b" },
            { role: "user", content: "c" }
        ];
        CONFIG.autoCompact = true;
        CONFIG.autoCompactThreshold = 80;

        await commands.handleCommand("/context");
        const text = lines.join("\n");
        assert.match(text, /Contexte : 42 %/);
        assert.match(text, /agent-42/);
        assert.match(text, /Tours \(session\) : 2/);
        assert.match(text, /à partir de 80 %/);
    } finally {
        restore(saved);
    }
});

test("/context sans valeur ni conversation, compaction désactivée", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        const lines = captureUi();
        state.chatIds = { chat: null, agent: null };
        state.contextUsagePercent = null;
        state.history = [];
        CONFIG.autoCompact = false;

        await commands.handleCommand("/context");
        const text = lines.join("\n");
        assert.match(text, /Contexte : inconnu/);
        assert.match(text, /Conversation agent : aucune/);
        assert.match(text, /Tours \(session\) : 0/);
        assert.match(text, /désactivée/);
    } finally {
        restore(saved);
    }
});
