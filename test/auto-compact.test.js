"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { CONFIG } = require("../src/config");
const api = require("../src/api/api");
const account = require("../src/api/account");
const conversations = require("../src/project/conversations");
const { state } = require("../src/state");
const compact = require("../src/core/compact");
const chat = require("../src/core/chat");
const session = require("../src/core/session");

const originals = {
    requestTurn: api.requestTurn,
    getContextUsage: account.getContextUsage,
    touch: conversations.touch,
    autoCompact: CONFIG.autoCompact,
    threshold: CONFIG.autoCompactThreshold,
    maybeAutoCompact: compact.maybeAutoCompact,
    send: chat.send
};

function saveState() {
    return {
        chatIds: { ...state.chatIds },
        chatId: state.chatId,
        conversationSettings: { ...state.conversationSettings },
        history: state.history,
        contextUsagePercent: state.contextUsagePercent,
        workspace: state.workspace,
        mode: state.mode
    };
}

function restore(saved) {
    Object.assign(state, saved);
    api.requestTurn = originals.requestTurn;
    account.getContextUsage = originals.getContextUsage;
    conversations.touch = originals.touch;
    CONFIG.autoCompact = originals.autoCompact;
    CONFIG.autoCompactThreshold = originals.threshold;
    compact.maybeAutoCompact = originals.maybeAutoCompact;
    chat.send = originals.send;
}

/** API simulée : résumé dans l'ancienne conversation, chatId neuf pour la nouvelle. */
function mockApi() {
    const calls = [];
    api.requestTurn = async message => {
        calls.push({ message, chatId: state.chatIds.chat });
        if (!state.chatIds.chat) {
            state.chatIds.chat = "chat-new";
            state.chatId = "chat-new";
            return { text: "Compris.", toolCalls: [], chatId: "chat-new" };
        }
        return { text: "1. Objectif\nContinuer la mission.", toolCalls: [], chatId: state.chatIds.chat };
    };
    account.getContextUsage = async () => 4;
    conversations.touch = async () => {};
    return calls;
}

function prepare(percent) {
    state.workspace = null;
    state.chatIds.chat = "chat-old";
    state.history = [];
    state.contextUsagePercent = percent;
}

test("le seuil de compaction vaut 80 % par défaut et la compaction est active", () => {
    if (process.env.FS_COMPACT_THRESHOLD === undefined) assert.equal(CONFIG.autoCompactThreshold, 80);
    if (process.env.FS_AUTO_COMPACT === undefined) assert.equal(CONFIG.autoCompact, true);
});

test("maybeAutoCompact ne fait rien sous le seuil", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        const calls = mockApi();
        CONFIG.autoCompact = true;
        CONFIG.autoCompactThreshold = 80;
        prepare(79);

        assert.equal(await compact.maybeAutoCompact(), null);
        assert.equal(calls.length, 0);
        assert.equal(state.chatIds.chat, "chat-old");

        state.contextUsagePercent = null;
        assert.equal(await compact.maybeAutoCompact(), null);
        assert.equal(calls.length, 0);
    } finally {
        restore(saved);
    }
});

test("maybeAutoCompact compacte la conversation chat au-dessus du seuil", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        const calls = mockApi();
        CONFIG.autoCompact = true;
        CONFIG.autoCompactThreshold = 80;
        prepare(85);

        const result = await compact.maybeAutoCompact();
        assert.ok(result);
        assert.equal(calls.length, 2);
        assert.equal(result.previousChatId, "chat-old");
        assert.equal(state.chatIds.chat, "chat-new");
        assert.equal(state.contextUsagePercent, 4);
    } finally {
        restore(saved);
    }
});

test("maybeAutoCompact ignore une ancienne conversation agent", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        const calls = mockApi();
        CONFIG.autoCompact = true;
        CONFIG.autoCompactThreshold = 80;
        prepare(95);
        state.chatIds.chat = null;
        state.chatIds.agent = "agent-old";

        assert.equal(await compact.maybeAutoCompact(), null);
        assert.equal(calls.length, 0);
    } finally {
        restore(saved);
    }
});

test("maybeAutoCompact ne fait rien si la compaction automatique est désactivée", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        const calls = mockApi();
        CONFIG.autoCompact = false;
        prepare(95);

        assert.equal(await compact.maybeAutoCompact(), null);
        assert.equal(calls.length, 0);
        assert.equal(state.chatIds.chat, "chat-old");
    } finally {
        restore(saved);
    }
});

test("maybeAutoCompact ne lève pas d'erreur si l'API échoue", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        mockApi();
        api.requestTurn = async () => {
            throw new Error("panne");
        };
        CONFIG.autoCompact = true;
        CONFIG.autoCompactThreshold = 80;
        prepare(90);

        assert.equal(await compact.maybeAutoCompact(), null);
        assert.equal(state.chatIds.chat, "chat-old");
    } finally {
        restore(saved);
    }
});

test("handleInput lance la compaction avant la demande, pas pendant la boucle", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        const order = [];
        state.workspace = process.cwd();
        state.mode = "auto";
        compact.maybeAutoCompact = async () => {
            order.push("compact");
            return null;
        };
        chat.send = async input => {
            order.push(`chat:${input}`);
        };

        await session.handleInput("corrige le test");
        assert.deepEqual(order, ["compact", "chat:corrige le test"]);
    } finally {
        restore(saved);
    }
});
