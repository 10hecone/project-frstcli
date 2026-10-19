"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { state } = require("../src/state");
const { auth } = require("../src/api/auth");
const { requestModel, deleteChat } = require("../src/api/api");

const originalFetch = global.fetch;

test.after(() => {
    global.fetch = originalFetch;
});

function prepareAuth() {
    auth.accessToken = "test-token";
    auth.expiresAt = Date.now() + 300_000;
    auth.deviceId = "test-device";
    state.model = -1002;
}

function streamWithChatId(chatId) {
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(
                new TextEncoder().encode(
                    `event: chat\ndata: {"chat_id":"${chatId}"}\n\n` +
                    'event: response.output_text.delta\ndata: {"delta":"ok"}\n\n' +
                    "data: [DONE]\n\n"
                )
            );
            controller.close();
        }
    });

    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

test("requestModel avec options.chat : conversation isolée, state intact", { concurrency: false }, async () => {
    prepareAuth();
    const savedProject = state.frProject;
    state.chatIds.agent = "main-agent";
    state.chatId = "main-agent";
    state.frProject = { id: "projet-1" };

    const bodies = [];
    global.fetch = async (url, init) => {
        bodies.push(JSON.parse(init.body));
        return streamWithChatId("sub-42");
    };

    try {
        const chat = { id: null };
        const answer = await requestModel("bonjour", { conversationMode: "agent", chat, agentId: -2002 });

        assert.equal(answer, "ok");
        assert.equal(chat.id, "sub-42");
        assert.equal(state.chatIds.agent, "main-agent");
        assert.equal(state.chatId, "main-agent");

        assert.equal(bodies[0].agentId, -2002);
        assert.equal(bodies[0].chatId, null);
        assert.equal(bodies[0].enableWebSearch, false);
        assert.equal("projectId" in bodies[0], false);

        // Tour suivant : la conversation isolée est réutilisée.
        await requestModel("suite", { conversationMode: "agent", chat, agentId: -2002 });
        assert.equal(bodies[1].chatId, "sub-42");
        assert.equal(state.chatIds.agent, "main-agent");
    } finally {
        state.frProject = savedProject;
    }
});

test("requestModel sans agentId garde le modèle courant", { concurrency: false }, async () => {
    prepareAuth();
    const bodies = [];
    global.fetch = async (url, init) => {
        bodies.push(JSON.parse(init.body));
        return streamWithChatId("sub-43");
    };

    await requestModel("bonjour", { conversationMode: "agent", chat: { id: null } });
    assert.equal(bodies[0].agentId, -1002);
});

test("deleteChat envoie DELETE /chats/{id} et ne lève jamais d'erreur", { concurrency: false }, async () => {
    prepareAuth();
    const seen = [];

    global.fetch = async (url, init) => {
        seen.push({ url: String(url), method: init.method });
        return new Response(null, { status: 204 });
    };
    assert.equal(await deleteChat("sub-42"), true);
    assert.equal(seen[0].method, "DELETE");
    assert.match(seen[0].url, /\/chats\/sub-42$/);

    global.fetch = async () => new Response("introuvable", { status: 404 });
    assert.equal(await deleteChat("sub-42"), false);

    global.fetch = async () => { throw new Error("réseau"); };
    assert.equal(await deleteChat("sub-42"), false);

    let called = false;
    global.fetch = async () => { called = true; return new Response(null, { status: 204 }); };
    assert.equal(await deleteChat(null), false);
    assert.equal(called, false);
});
