"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const api = require("../src/api/api");
const profile = require("../src/project/profile");
const chat = require("../src/core/chat");
const { state, activateConversation } = require("../src/state");
const { switchModel, localSummary, COMPACT_MAX_SUMMARY_CHARS } = require("../src/core/compact");

const originals = {
    requestTurn: api.requestTurn,
    sendToolResults: api.sendToolResults,
    buildPreprompt: profile.buildPreprompt
};

function saveState() {
    return {
        model: state.model,
        chatIds: { ...state.chatIds },
        chatId: state.chatId,
        conversationSettings: { ...state.conversationSettings },
        history: state.history,
        contextUsagePercent: state.contextUsagePercent,
        compactSummary: state.compactSummary,
        workspace: state.workspace
    };
}

function restoreState(saved) {
    Object.assign(state, saved);
    api.requestTurn = originals.requestTurn;
    api.sendToolResults = originals.sendToolResults;
    profile.buildPreprompt = originals.buildPreprompt;
}

/** Conversation chat en cours avec le modèle 1, hors projet. */
function prepare() {
    state.workspace = null;
    state.model = 1;
    state.chatIds.chat = "chat-old";
    state.chatId = "chat-old";
    state.conversationSettings.chat = { model: 1 };
    state.compactSummary = null;
    state.history = [
        { role: "user", content: "ancienne demande" },
        { role: "assistant", content: "ancienne réponse" }
    ];
}

/** API simulée : note le modèle actif et la conversation au moment de chaque requête. */
function mockApi({ text = "1. Objectif\nTester.", fail = false } = {}) {
    const calls = [];
    api.requestTurn = async (message) => {
        calls.push({ message, model: state.model, chatId: state.chatIds.chat });
        if (fail) throw new Error("panne serveur");
        return { text, toolCalls: [], chatId: state.chatIds.chat };
    };
    api.sendToolResults = async () => {
        throw new Error("sendToolResults ne devrait pas être appelé");
    };
    return calls;
}

test("switchModel : l'ancien modèle résume, le nouveau reçoit le résumé avec son premier message", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        prepare();
        profile.buildPreprompt = () => "";
        const calls = mockApi();

        const result = await switchModel({ id: 2, name: "autre" });

        // Une seule requête, faite dans l'ancienne conversation, par l'ancien modèle.
        assert.equal(calls.length, 1);
        assert.equal(calls[0].model, 1);
        assert.equal(calls[0].chatId, "chat-old");
        assert.match(calls[0].message, /autre modèle/);

        assert.deepEqual(result, { changed: true, summarized: true, fallback: false, chars: 19, previousChatId: "chat-old" });
        assert.equal(state.model, 2);
        assert.equal(state.chatIds.chat, null);
        assert.equal(state.compactSummary, "1. Objectif\nTester.");

        // Le modèle n'est pas remis à l'ancien par la réactivation de la conversation.
        activateConversation();
        assert.equal(state.model, 2);

        const message = await chat.buildMessage("on continue");
        assert.ok(message.startsWith("on continue\n\n---\n\n"));
        assert.ok(message.endsWith("1. Objectif\nTester."));
    } finally {
        restoreState(saved);
    }
});

test("switchModel : si le résumé échoue, les derniers échanges servent de résumé de secours", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        prepare();
        mockApi({ fail: true });

        const result = await switchModel({ id: 2, name: "autre" });

        assert.equal(result.changed, true);
        assert.equal(result.summarized, true);
        assert.equal(result.fallback, true);
        assert.equal(state.model, 2);
        assert.equal(state.chatIds.chat, null);
        assert.match(state.compactSummary, /Utilisateur : ancienne demande/);
        assert.match(state.compactSummary, /Assistant : ancienne réponse/);
    } finally {
        restoreState(saved);
    }
});

test("switchModel : même modèle, aucune requête et rien ne change", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        prepare();
        const calls = mockApi();

        const result = await switchModel({ id: 1, name: "même" });

        assert.equal(result.changed, false);
        assert.equal(calls.length, 0);
        assert.equal(state.chatIds.chat, "chat-old");
        assert.equal(state.compactSummary, null);
    } finally {
        restoreState(saved);
    }
});

test("switchModel : sans conversation, seul le modèle change et un résumé en attente est conservé", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        prepare();
        state.chatIds.chat = null;
        state.chatId = null;
        state.compactSummary = "résumé en attente";
        const calls = mockApi();

        const result = await switchModel({ id: 2, name: "autre" });

        assert.equal(result.changed, true);
        assert.equal(result.summarized, false);
        assert.equal(calls.length, 0);
        assert.equal(state.model, 2);
        assert.equal(state.compactSummary, "résumé en attente");
    } finally {
        restoreState(saved);
    }
});

test("localSummary : vide sans échange, borné en taille sinon", () => {
    assert.equal(localSummary([]), "");
    assert.equal(localSummary(null), "");
    assert.equal(localSummary([{ role: "user", content: "   " }]), "");

    const many = Array.from({ length: 100 }, () => ({ role: "user", content: "x".repeat(2000) }));
    const text = localSummary(many);
    assert.ok(text.length <= COMPACT_MAX_SUMMARY_CHARS + 20);
    assert.match(text, /^\(Résumé automatique indisponible/);
});
