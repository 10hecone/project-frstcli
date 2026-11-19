"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { state } = require("../src/state");
const { setUiBackend, UI_METHODS } = require("../src/ui-bridge");
const conversations = require("../src/project/conversations");
const compact = require("../src/core/compact");
const commands = require("../src/cli/commands");
const permissionsMode = require("../src/core/permissions-mode");

function captureUi() {
    const lines = [];
    const fakeUi = {};
    for (const name of UI_METHODS) {
        fakeUi[name] = (...args) => {
            if (name === "info" || name === "warn") lines.push(String(args[0]));
        };
    }
    // /compact affiche un indicateur d'attente pendant le résumé.
    fakeUi.spinner = () => ({ update() {}, stop() {} });
    setUiBackend(fakeUi);
    return lines;
}

function saveState() {
    return {
        chatId: state.chatId,
        chatIds: { ...state.chatIds },
        conversationSettings: { ...state.conversationSettings },
        history: state.history,
        model: state.model,
        contextUsagePercent: state.contextUsagePercent,
        compactSummary: state.compactSummary,
        find: conversations.find,
        compactConversation: compact.compactConversation
    };
}

function restore(saved) {
    state.chatId = saved.chatId;
    state.chatIds = saved.chatIds;
    state.conversationSettings = saved.conversationSettings;
    state.history = saved.history;
    state.model = saved.model;
    state.contextUsagePercent = saved.contextUsagePercent;
    state.compactSummary = saved.compactSummary;
    conversations.find = saved.find;
    compact.compactConversation = saved.compactConversation;
    setUiBackend(null);
}

test("/context affiche le pourcentage, la conversation et les tours", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        const lines = captureUi();
        state.chatIds = { chat: "chat-42", agent: null };
        state.contextUsagePercent = 42.4;
        state.compactSummary = null;
        state.history = [
            { role: "user", content: "a" },
            { role: "assistant", content: "b" },
            { role: "user", content: "c" }
        ];

        await commands.handleCommand("/context");
        const text = lines.join("\n");
        assert.match(text, /Contexte : 42 %/);
        assert.match(text, /Conversation : chat-42/);
        assert.match(text, /Tours \(session\) : 2/);
        assert.doesNotMatch(text, /en attente/);
        // Seuil de compaction automatique (FS_AUTO_COMPACT, 85 % par défaut).
        assert.match(text, /Compaction automatique (dès \d+ %|désactivée)/);
    } finally {
        restore(saved);
    }
});

test("/context sans valeur ni conversation, avec un résumé /compact en attente", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        const lines = captureUi();
        // Une ancienne conversation agent n'est plus prise en compte.
        state.chatIds = { chat: null, agent: "agent-1" };
        state.contextUsagePercent = null;
        state.history = [];
        state.compactSummary = "x".repeat(120);

        await commands.handleCommand("/context");
        const text = lines.join("\n");
        assert.match(text, /Contexte : inconnu/);
        assert.match(text, /Conversation : aucune/);
        assert.doesNotMatch(text, /agent-1/);
        assert.match(text, /Tours \(session\) : 0/);
        assert.match(text, /Résumé \/compact en attente : 120 caractères, joint au prochain message/);
    } finally {
        restore(saved);
    }
});

test("/mode : default, acceptEdits et plan ; usage si le mode est inconnu", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        const lines = captureUi();

        await commands.handleCommand("/mode acceptedits");
        assert.equal(permissionsMode.get(), "acceptEdits");
        assert.match(lines.join("\n"), /SANS confirmation/);

        await commands.handleCommand("/mode plan");
        assert.equal(permissionsMode.get(), "plan");

        lines.length = 0;
        await commands.handleCommand("/mode chat");
        assert.equal(permissionsMode.get(), "plan");
        assert.match(lines.join("\n"), /usage : \/mode default\|acceptEdits\|plan/);
    } finally {
        permissionsMode.set("default");
        restore(saved);
    }
});

test("/new vide la conversation chat et le pourcentage de contexte", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        captureUi();
        state.chatIds = { chat: "chat-1" };
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
    let called = false;
    compact.compactConversation = async () => {
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
        restore(saved);
    }
});

test("/compact : consigne transmise, résumé joint au prochain message, ancienne conversation indiquée", { concurrency: false }, async () => {
    const saved = saveState();
    const received = [];
    compact.compactConversation = async (options) => {
        received.push(options);
        return { mode: "local", summary: "x".repeat(42), chars: 42, previousChatId: "chat-old", serverError: null };
    };
    try {
        const lines = captureUi();
        state.chatIds = { chat: "chat-old", agent: null };

        await commands.handleCommand("/compact garde les chemins");
        assert.deepEqual(received, [{ instruction: "garde les chemins" }]);
        const text = lines.join("\n");
        assert.match(text, /Session compactée : résumé de 42 caractères/);
        assert.match(text, /joint à ton prochain message/);
        assert.match(text, /\/chat-id chat-old pour y revenir/);
    } finally {
        restore(saved);
    }
});

test("/compact : compaction serveur, même conversation, pourcentage avant et après", { concurrency: false }, async () => {
    const saved = saveState();
    compact.compactConversation = async () => ({
        mode: "server",
        chatId: "chat-old",
        before: 82,
        details: { percent: 12.4, measured: false }
    });
    try {
        const lines = captureUi();
        state.chatIds = { chat: "chat-old", agent: null };

        await commands.handleCommand("/compact");
        const text = lines.join("\n");
        assert.match(text, /compactée par le serveur \(contexte : 82 % → 12 %\)/);
        assert.match(text, /Même conversation conservée/);
        assert.doesNotMatch(text, /Ancienne conversation/);
    } finally {
        restore(saved);
    }
});

test("/compact : repli local signalé quand le serveur refuse", { concurrency: false }, async () => {
    const saved = saveState();
    compact.compactConversation = async () => ({
        mode: "local",
        summary: "abc",
        chars: 3,
        previousChatId: "chat-old",
        serverError: "réservée au propriétaire de la conversation (HTTP 403)"
    });
    try {
        const lines = captureUi();
        state.chatIds = { chat: "chat-old", agent: null };

        await commands.handleCommand("/compact");
        const text = lines.join("\n");
        assert.match(text, /Compaction serveur impossible \(réservée au propriétaire.*\) : résumé local/);
        assert.match(text, /Session compactée : résumé de 3 caractères/);
    } finally {
        restore(saved);
    }
});

test("/compact : un échec est signalé sans lever d'erreur", { concurrency: false }, async () => {
    const saved = saveState();
    compact.compactConversation = async () => {
        throw new Error("Résumé vide : la session n'a pas été compactée.");
    };
    try {
        const lines = captureUi();
        state.chatIds = { chat: "chat-old", agent: null };

        await commands.handleCommand("/compact");
        assert.match(lines.join("\n"), /Compaction impossible : Résumé vide/);
    } finally {
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
        state.chatIds = { chat: "chat-1" };
        state.chatId = "chat-1";
        state.contextUsagePercent = 70;

        await commands.handleCommand("/chat-id 2");
        assert.equal(state.chatIds.chat, "agent-9");
        assert.equal(state.chatId, "agent-9");
        assert.equal(state.model, 5);
        assert.equal(state.contextUsagePercent, null);
        assert.match(lines.join("\n"), /Conversation reprise : "Ancienne demande" \(agent-9\)/);
    } finally {
        restore(saved);
    }
});
