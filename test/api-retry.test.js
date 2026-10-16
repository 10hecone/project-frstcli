"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { state } = require("../src/state");
const { auth } = require("../src/api/auth");
const { requestModel, MAX_REQUEST_FAILURES } = require("../src/api/api");

const originalFetch = global.fetch;

test.after(() => {
    global.fetch = originalFetch;
});

test("requestModel additionne les tokens fournis par response.completed", { concurrency: false }, async () => {
    prepareAuth();
    const { usage } = require("../src/api/api");
    const before = { ...usage };
    global.fetch = async () => new Response(
        new ReadableStream({
            start(controller) {
                controller.enqueue(
                    new TextEncoder().encode(
                        'event: response.output_text.delta\ndata: {"delta":"ok"}\n\n' +
                        'event: response.completed\ndata: {"response":{"usage":{"input_tokens":120,"output_tokens":7,"input_tokens_details":{"cached_tokens":100}}}}\n\n' +
                        "data: [DONE]\n\n",
                    ),
                );
                controller.close();
            },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
    );

    assert.equal(await requestModel("bonjour"), "ok");
    assert.equal(usage.inputTokens - before.inputTokens, 120);
    assert.equal(usage.outputTokens - before.outputTokens, 7);
    assert.equal(usage.cachedTokens - before.cachedTokens, 100);
    assert.equal(usage.reported - before.reported, 1);
});

test("sans champ usage, les compteurs de tokens ne bougent pas", { concurrency: false }, async () => {
    prepareAuth();
    const { usage } = require("../src/api/api");
    const before = { ...usage };
    global.fetch = async () => successfulResponse();

    assert.equal(await requestModel("bonjour"), "ok");
    assert.equal(usage.reported, before.reported);
    assert.equal(usage.inputTokens, before.inputTokens);
});

function successfulResponse() {
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(
                new TextEncoder().encode(
                    'event: response.output_text.delta\ndata: {"delta":"ok"}\n\n' +
                    "data: [DONE]\n\n",
                ),
            );
            controller.close();
        },
    });

    return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
    });
}

function prepareAuth() {
    auth.accessToken = "test-token";
    auth.expiresAt = Date.now() + 300_000;
    auth.deviceId = "test-device";
    state.chatIds.chat = "chat-1";
    state.model = -1002;
}

test("requestModel retente puis réussit après deux échecs", { concurrency: false }, async () => {
    prepareAuth();
    let calls = 0;
    global.fetch = async () => {
        calls++;
        if (calls <= 2) throw new Error(`échec ${calls}`);
        return successfulResponse();
    };

    assert.equal(await requestModel("bonjour"), "ok");
    assert.equal(calls, 3);
});

test("requestModel abandonne après deux échecs", { concurrency: false }, async () => {
    prepareAuth();
    let calls = 0;
    global.fetch = async () => {
        calls++;
        throw new Error("service indisponible");
    };

    await assert.rejects(requestModel("bonjour"), /service indisponible/);
    assert.equal(calls, MAX_REQUEST_FAILURES + 1);
});

test("requestModel ouvre une nouvelle conversation agent après un 409", { concurrency: false }, async () => {
    prepareAuth();
    state.chatId = "agent-1";
    state.chatIds.agent = "agent-1";
    const chatIds = [];
    let calls = 0;
    global.fetch = async (url, init) => {
        calls++;
        chatIds.push(JSON.parse(init.body).chatId);
        if (calls === 1) return new Response("A stream is already active for this chat", { status: 409 });
        return successfulResponse();
    };

    assert.equal(await requestModel("bonjour", { conversationMode: "agent" }), "ok");
    assert.equal(calls, 2);
    assert.equal(chatIds[0], "agent-1");
    assert.ok(chatIds[1] == null);
});

test("après un 409 agent, le message complet remplace le message « suite »", { concurrency: false }, async () => {
    prepareAuth();
    state.chatId = "agent-1";
    state.chatIds.agent = "agent-1";
    const sent = [];
    let calls = 0;
    global.fetch = async (url, init) => {
        calls++;
        sent.push(JSON.parse(init.body).initialContent);
        if (calls === 1) return new Response("A stream is already active for this chat", { status: 409 });
        return successfulResponse();
    };

    await requestModel("suite courte", { conversationMode: "agent", freshMessage: () => "message complet" });
    assert.deepEqual(sent, ["suite courte", "message complet"]);
});

test("un 429 « budget épuisé » n'est pas relancé et indique l'heure de reprise", { concurrency: false }, async () => {
    prepareAuth();
    let calls = 0;
    global.fetch = async () => {
        calls++;
        return new Response(
            '{"status":429,"message":"Chat budget exhausted. Reset at 2026-10-13T02:59:59.999087269Z."}',
            { status: 429 },
        );
    };

    await assert.rejects(requestModel("bonjour"), /Budget de chat épuisé jusqu'au/);
    assert.equal(calls, 1);
});

test("Ctrl+C coupe le flux, appelle stream/cancel et ne relance pas", { concurrency: false }, async () => {
    prepareAuth();
    const streamCalls = [];
    const cancelCalls = [];
    global.fetch = async (url, init) => {
        if (String(url).endsWith("/stream/cancel")) {
            cancelCalls.push({ url: String(url), method: init.method });
            return new Response(null, { status: 200 });
        }
        streamCalls.push(String(url));
        const body = new ReadableStream({
            start(controller) {
                controller.enqueue(
                    new TextEncoder().encode(
                        'event: stream.open\ndata: {"chat_id":"chat-9","first_response_timeout_ms":300000}\n\n',
                    ),
                );
                init.signal.addEventListener("abort", () => controller.error(new Error("aborted")));
            },
        });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    };

    let interrupt = null;
    let removed = false;
    const pending = requestModel("bonjour", {
        fresh: true,
        onInterrupt: handler => { interrupt = handler; return () => { removed = true; }; },
    });

    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(typeof interrupt, "function");
    interrupt();

    await assert.rejects(pending, /Génération annulée/);
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.equal(streamCalls.length, 1);
    assert.equal(cancelCalls.length, 1);
    assert.ok(cancelCalls[0].url.endsWith("/chats/chat-9/stream/cancel"));
    assert.equal(cancelCalls[0].method, "POST");
    assert.equal(removed, true);
});

test("cancelStream sans chatId ne fait aucun appel", { concurrency: false }, async () => {
    const { cancelStream } = require("../src/api/api");
    let calls = 0;
    global.fetch = async () => { calls++; return new Response(null, { status: 200 }); };

    assert.equal(await cancelStream(null), false);
    assert.equal(calls, 0);
});
