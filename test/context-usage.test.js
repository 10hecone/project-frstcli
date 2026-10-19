"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { auth } = require("../src/api/auth");
const account = require("../src/api/account");
const { state } = require("../src/state");
const { refreshContextUsage } = require("../src/agent/agent");

const originalFetch = global.fetch;
const originalGetContextUsage = account.getContextUsage;

test.after(() => {
    global.fetch = originalFetch;
    account.getContextUsage = originalGetContextUsage;
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

test("refreshContextUsage range la valeur dans l'état de la session", { concurrency: false }, async () => {
    const previous = state.chatIds.agent;
    try {
        state.chatIds.agent = "agent-1";
        state.contextUsagePercent = null;
        account.getContextUsage = async chatId => (chatId === "agent-1" ? 37 : null);

        assert.equal(await refreshContextUsage(), 37);
        assert.equal(state.contextUsagePercent, 37);
    } finally {
        state.chatIds.agent = previous;
        account.getContextUsage = originalGetContextUsage;
    }
});

test("refreshContextUsage ne lève jamais d'erreur et ignore une valeur périmée", { concurrency: false }, async () => {
    const previous = state.chatIds.agent;
    try {
        state.chatIds.agent = "agent-1";
        state.contextUsagePercent = 10;
        account.getContextUsage = async () => {
            throw new Error("panne");
        };
        assert.equal(await refreshContextUsage(), null);
        assert.equal(state.contextUsagePercent, 10);

        // La conversation change pendant la requête : la valeur n'est pas rangée.
        account.getContextUsage = async () => {
            state.chatIds.agent = "agent-2";
            return 90;
        };
        await refreshContextUsage("agent-1");
        assert.equal(state.contextUsagePercent, 10);

        state.chatIds.agent = null;
        assert.equal(await refreshContextUsage(), null);
    } finally {
        state.chatIds.agent = previous;
        state.contextUsagePercent = null;
        account.getContextUsage = originalGetContextUsage;
    }
});
