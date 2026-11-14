"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { CONFIG } = require("../src/config");
const { state } = require("../src/state");
const { setUiBackend, UI_METHODS } = require("../src/ui-bridge");
const conversations = require("../src/project/conversations");
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
        chatId: state.chatId,
        chatIds: { ...state.chatIds },
        conversationSettings: { ...state.conversationSettings },
        history: state.history,
        mode: state.mode,
        model: state.model,
        contextUsagePercent: state.contextUsagePercent,
        autoCompact: CONFIG.autoCompact,
        threshold: CONFIG.autoCompactThreshold,
        find: conversations.find
    };
}

function restore(saved) {
    state.chatId = saved.chatId;
    state.chatIds = saved.chatIds;
    state.conversationSettings = saved.conversationSettings;
    state.history = saved.history;
    state.mode = saved.mode;
    state.model = saved.model;
    state.contextUsagePercent = saved.contextUsagePercent;
    CONFIG.autoCompact = saved.autoCompact;
    CONFIG.autoCompactThreshold = saved.threshold;
    conversations.find = saved.find;
    setUiBackend(null);
}

test("/context affiche le pourcentage, la conversation, les tours et le seuil", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        const lines = captureUi();
        state.chatIds = { chat: "chat-42", agent: null };
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
        assert.match(text, /Conversation : chat-42/);
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
        // Une ancienne conversation agent n'est plus prise en compte.
        state.chatIds = { chat: null, agent: "agent-1" };
        state.contextUsagePercent = null;
        state.history = [];
        CONFIG.autoCompact = false;

        await commands.handleCommand("/context");
        const text = lines.join("\n");
        assert.match(text, /Contexte : inconnu/);
        assert.match(text, /Conversation : aucune/);
        assert.doesNotMatch(text, /agent-1/);
        assert.match(text, /Tours \(session\) : 0/);
        assert.match(text, /désactivée/);
    } finally {
        restore(saved);
    }
});

test("/mode : auto et chat acceptés, agent devient un alias d'auto", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        const lines = captureUi();

        await commands.handleCommand("/mode chat");
        assert.equal(state.mode, "chat");

        await commands.handleCommand("/mode agent");
        assert.equal(state.mode, "auto");
        assert.match(lines.join("\n"), /Le mode agent n'existe plus/);

        state.mode = "chat";
        lines.length = 0;
        await commands.handleCommand("/mode inconnu");
        assert.equal(state.mode, "chat");
        assert.match(lines.join("\n"), /usage : \/mode auto\|chat/);
    } finally {
        restore(saved);
    }
});

test("/new vide la conversation chat et le pourcentage de contexte", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        captureUi();
        state.mode = "auto";
        state.chatIds = { chat: "chat-1", agent: null };
        state.chatId = "chat-1";
        state.contextUsagePercent = 55;
        state.history = [{ role: "user", content: "a" }];

        await commands.handleCommand("/new");
        assert.equal(state.chatIds.chat, null);
        assert.equal(state.chatId, null);
        assert.equal(state.contextUsagePercent, null);
        assert.deepEqual(state.history, []);
    } finally {
        restore(saved);
    }
});

test("/compact sans conversation chat : message, aucun appel", { concurrency: false }, async () => {
    const saved = saveState();
    const compact = require("../src/core/compact");
    const original = compact.compactSession;
    let called = false;
    compact.compactSession = async () => {
        called = true;
        return {};
    };
    try {
        const lines = captureUi();
        state.chatIds = { chat: null, agent: "agent-1" };

        await commands.handleCommand("/compact");
        assert.equal(called, false);
        assert.match(lines.join("\n"), /Aucune conversation à résumer/);
    } finally {
        compact.compactSession = original;
        restore(saved);
    }
});

test("/chat-id sans argument : seulement la conversation chat", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        const lines = captureUi();
        conversations.find = async (ref) => (ref === "chat-7" ? { id: "chat-7", title: "Titre" } : null);
        state.chatIds = { chat: "chat-7", agent: "agent-3" };

        await commands.handleCommand("/chat-id");
        const text = lines.join("\n");
        assert.match(text, /Chat : chat-7 \| "Titre"/);
        assert.match(text, /\/chat-id chat-7/);
        assert.doesNotMatch(text, /agent-3/);
    } finally {
        restore(saved);
    }
});

test("/chat-id <n> reprend une ancienne conversation agent comme conversation chat", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        const lines = captureUi();
        conversations.find = async (ref) =>
            ref === "2" ? { id: "agent-9", title: "Ancienne demande", mode: "agent", model: 5 } : null;
        state.mode = "auto";
        state.chatIds = { chat: "chat-1", agent: null };
        state.chatId = "chat-1";
        state.contextUsagePercent = 70;

        await commands.handleCommand("/chat-id 2");
        assert.equal(state.chatIds.chat, "agent-9");
        assert.equal(state.chatId, "agent-9");
        assert.equal(state.chatIds.agent, null);
        assert.equal(state.model, 5);
        assert.equal(state.contextUsagePercent, null);
        assert.match(lines.join("\n"), /Conversation reprise : "Ancienne demande" \(agent-9\)/);
    } finally {
        restore(saved);
    }
});
