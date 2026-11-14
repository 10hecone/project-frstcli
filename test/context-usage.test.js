"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { auth } = require("../src/api/auth");
const account = require("../src/api/account");
const { state } = require("../src/state");
const { refreshContextUsage } = require("../src/core/compact");

const originalFetch = global.fetch;
const originalGetContextUsage = account.getContextUsage;
const originalGetContextDetails = account.getContextDetails;

test.after(() => {
    global.fetch = originalFetch;
    account.getContextUsage = originalGetContextUsage;
    account.getContextDetails = originalGetContextDetails;
});

// Les tests de repli sur /usage ne doivent pas dépendre de /context.
test.beforeEach(() => {
    account.getContextDetails = async () => null;
});

function prepareAuth() {
    auth.accessToken = "test-token";
    auth.expiresAt = Date.now() + 300_000;
    auth.deviceId = "test-device";
}

function respondWith(body, status = 200) {
    global.fetch = async () => new Response(JSON.stringify(body), { status });
}

test("getContextUsage renvoie contextUsagePercent", { concurrency: false }, async () => {
    prepareAuth();
    let seenUrl;
    global.fetch = async url => {
        seenUrl = url;
        return new Response(JSON.stringify({ tokenUsage: {}, contextUsagePercent: 42.5 }), { status: 200 });
    };

    assert.equal(await account.getContextUsage("chat-1"), 42.5);
    assert.match(seenUrl, /\/chats\/chat-1\/usage$/);
});

test("getContextUsage borne la valeur entre 0 et 100", { concurrency: false }, async () => {
    prepareAuth();
    respondWith({ contextUsagePercent: 130 });
    assert.equal(await account.getContextUsage("chat-1"), 100);
    respondWith({ contextUsagePercent: -5 });
    assert.equal(await account.getContextUsage("chat-1"), 0);
});

test("getContextUsage renvoie null si le champ est absent ou invalide", { concurrency: false }, async () => {
    prepareAuth();
    respondWith({ tokenUsage: { totalTokenCount: 3 } });
    assert.equal(await account.getContextUsage("chat-1"), null);
    respondWith({ contextUsagePercent: null });
    assert.equal(await account.getContextUsage("chat-1"), null);
    respondWith({ contextUsagePercent: "abc" });
    assert.equal(await account.getContextUsage("chat-1"), null);
});

test("getContextUsage renvoie null en cas d'erreur réseau ou HTTP", { concurrency: false }, async () => {
    prepareAuth();
    global.fetch = async () => {
        throw new TypeError("fetch failed");
    };
    assert.equal(await account.getContextUsage("chat-1"), null);

    respondWith({ message: "erreur" }, 500);
    assert.equal(await account.getContextUsage("chat-1"), null);
});

test("getContextUsage renvoie null sans chatId, sans appel réseau", { concurrency: false }, async () => {
    let called = false;
    global.fetch = async () => {
        called = true;
        return new Response("{}", { status: 200 });
    };
    assert.equal(await account.getContextUsage(null), null);
    assert.equal(called, false);
});

test("refreshContextUsage range la valeur de la conversation chat dans l'état", { concurrency: false }, async () => {
    const previous = { chat: state.chatIds.chat, agent: state.chatIds.agent };
    try {
        state.chatIds.chat = "chat-1";
        state.chatIds.agent = "agent-ignore";
        state.contextUsagePercent = null;
        account.getContextUsage = async chatId => (chatId === "chat-1" ? 37 : null);

        assert.equal(await refreshContextUsage(), 37);
        assert.equal(state.contextUsagePercent, 37);
    } finally {
        state.chatIds.chat = previous.chat;
        state.chatIds.agent = previous.agent;
        state.contextUsagePercent = null;
        account.getContextUsage = originalGetContextUsage;
    }
});

test("normalizeContext lit ChatContextUsageDto et borne le pourcentage", () => {
    const details = account.normalizeContext({
        model: "m-1",
        modelName: "Modèle",
        contextWindow: 200000,
        usedTokens: 50000,
        freeTokens: 150000,
        usagePercent: 25,
        compactThreshold: 80,
        measured: false,
        categories: [{ key: "tools", tokens: 1200 }, { key: "conversation", tokens: "800" }, { tokens: 3 }]
    });
    assert.equal(details.percent, 25);
    assert.equal(details.usedTokens, 50000);
    assert.equal(details.contextWindow, 200000);
    assert.equal(details.freeTokens, 150000);
    assert.equal(details.compactThreshold, 80);
    assert.equal(details.measured, false);
    assert.equal(details.modelName, "Modèle");
    assert.deepEqual(details.categories, [
        { key: "tools", tokens: 1200 },
        { key: "conversation", tokens: 800 }
    ]);

    assert.equal(account.normalizeContext({ usagePercent: 140 }).percent, 100);
    assert.equal(account.normalizeContext({ usedTokens: 10, contextWindow: 40 }).percent, 25);
    assert.equal(account.normalizeContext({ usagePercent: 10 }).measured, true);
    assert.equal(account.normalizeContext({ model: "m" }), null);
    assert.equal(account.normalizeContext(null), null);
});

test("getContextDetails appelle /chats/{id}/context et renvoie null en cas d'erreur", { concurrency: false }, async () => {
    account.getContextDetails = originalGetContextDetails;
    prepareAuth();
    let seenUrl;
    global.fetch = async url => {
        seenUrl = url;
        return new Response(JSON.stringify({ usagePercent: 12.5, usedTokens: 25, contextWindow: 200 }), { status: 200 });
    };
    assert.equal((await account.getContextDetails("chat 1")).percent, 12.5);
    assert.match(seenUrl, /\/chats\/chat%201\/context$/);

    respondWith({ message: "erreur" }, 404);
    assert.equal(await account.getContextDetails("chat-1"), null);
    assert.equal(await account.getContextDetails(null), null);
});

test("refreshContextUsage préfère /context et range les détails", { concurrency: false }, async () => {
    const previous = state.chatIds.chat;
    let usageCalled = false;
    try {
        state.chatIds.chat = "chat-1";
        account.getContextDetails = async () => ({ percent: 61, usedTokens: 610, contextWindow: 1000, categories: [] });
        account.getContextUsage = async () => {
            usageCalled = true;
            return 5;
        };
        assert.equal(await refreshContextUsage(), 61);
        assert.equal(state.contextUsagePercent, 61);
        assert.equal(state.contextDetails.usedTokens, 610);
        assert.equal(usageCalled, false);

        // /context indisponible : repli sur /usage, détails effacés.
        account.getContextDetails = async () => null;
        assert.equal(await refreshContextUsage(), 5);
        assert.equal(state.contextDetails, null);
    } finally {
        state.chatIds.chat = previous;
        state.contextUsagePercent = null;
        state.contextDetails = null;
        account.getContextUsage = originalGetContextUsage;
    }
});

test("refreshContextUsage ne lève jamais d'erreur et ignore une valeur périmée", { concurrency: false }, async () => {
    const previous = state.chatIds.chat;
    try {
        state.chatIds.chat = "chat-1";
        state.contextUsagePercent = 10;
        account.getContextUsage = async () => {
            throw new Error("panne");
        };
        assert.equal(await refreshContextUsage(), null);
        assert.equal(state.contextUsagePercent, 10);

        // La conversation change pendant la requête : la valeur n'est pas rangée.
        account.getContextUsage = async () => {
            state.chatIds.chat = "chat-2";
            return 90;
        };
        await refreshContextUsage("chat-1");
        assert.equal(state.contextUsagePercent, 10);

        state.chatIds.chat = null;
        assert.equal(await refreshContextUsage(), null);
    } finally {
        state.chatIds.chat = previous;
        state.contextUsagePercent = null;
        account.getContextUsage = originalGetContextUsage;
    }
});
