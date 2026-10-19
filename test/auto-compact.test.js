"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { CONFIG } = require("../src/config");
const api = require("../src/api/api");
const account = require("../src/api/account");
const conversations = require("../src/project/conversations");
const { state } = require("../src/state");
const agent = require("../src/agent/agent");
const router = require("../src/cli/router");
const session = require("../src/core/session");

const originals = {
    requestModel: api.requestModel,
    getContextUsage: account.getContextUsage,
    touch: conversations.touch,
    autoCompact: CONFIG.autoCompact,
    threshold: CONFIG.autoCompactThreshold,
    maybeAutoCompact: agent.maybeAutoCompact,
    runAgent: agent.runAgent,
    shouldUseAgent: router.shouldUseAgent
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
    api.requestModel = originals.requestModel;
    account.getContextUsage = originals.getContextUsage;
    conversations.touch = originals.touch;
    CONFIG.autoCompact = originals.autoCompact;
    CONFIG.autoCompactThreshold = originals.threshold;
    agent.maybeAutoCompact = originals.maybeAutoCompact;
    agent.runAgent = originals.runAgent;
    router.shouldUseAgent = originals.shouldUseAgent;
}

/** API simulée : résumé dans l'ancienne conversation, chatId neuf pour la nouvelle. */
function mockApi() {
    const calls = [];
    api.requestModel = async message => {
        calls.push({ message, chatId: state.chatIds.agent });
        if (!state.chatIds.agent) {
            state.chatIds.agent = "agent-new";
            state.chatId = "agent-new";
            return "Compris.";
        }
        return "1. Objectif\nContinuer la mission.";
    };
    account.getContextUsage = async () => 4;
    conversations.touch = async () => {};
    return calls;
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
        state.chatIds.agent = "agent-old";
        state.contextUsagePercent = 79;

        assert.equal(await agent.maybeAutoCompact(), null);
        assert.equal(calls.length, 0);
        assert.equal(state.chatIds.agent, "agent-old");

        state.contextUsagePercent = null;
        assert.equal(await agent.maybeAutoCompact(), null);
        assert.equal(calls.length, 0);
    } finally {
        restore(saved);
    }
});

test("maybeAutoCompact compacte au-dessus du seuil", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        const calls = mockApi();
        CONFIG.autoCompact = true;
        CONFIG.autoCompactThreshold = 80;
        state.chatIds.agent = "agent-old";
        state.contextUsagePercent = 85;

        const result = await agent.maybeAutoCompact();
        assert.ok(result);
        assert.equal(calls.length, 2);
        assert.equal(result.previousChatId, "agent-old");
        assert.equal(state.chatIds.agent, "agent-new");
        assert.equal(state.contextUsagePercent, 4);
    } finally {
        restore(saved);
    }
});

test("maybeAutoCompact ne fait rien si la compaction automatique est désactivée", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        const calls = mockApi();
        CONFIG.autoCompact = false;
        state.chatIds.agent = "agent-old";
        state.contextUsagePercent = 95;

        assert.equal(await agent.maybeAutoCompact(), null);
        assert.equal(calls.length, 0);
        assert.equal(state.chatIds.agent, "agent-old");
    } finally {
        restore(saved);
    }
});

test("maybeAutoCompact ne lève pas d'erreur si l'API échoue", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        mockApi();
        api.requestModel = async () => {
            throw new Error("panne");
        };
        CONFIG.autoCompact = true;
        CONFIG.autoCompactThreshold = 80;
        state.chatIds.agent = "agent-old";
        state.contextUsagePercent = 90;

        assert.equal(await agent.maybeAutoCompact(), null);
        assert.equal(state.chatIds.agent, "agent-old");
    } finally {
        restore(saved);
    }
});

test("handleInput lance la compaction avant la demande, pas pendant la boucle", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        const order = [];
        router.shouldUseAgent = () => true;
        state.workspace = process.cwd();
        agent.maybeAutoCompact = async () => {
            order.push("compact");
            return null;
        };
        agent.runAgent = async input => {
            order.push(`agent:${input}`);
        };

        await session.handleInput("corrige le test");
        assert.deepEqual(order, ["compact", "agent:corrige le test"]);
    } finally {
        restore(saved);
    }
});
