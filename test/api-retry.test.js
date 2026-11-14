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

function successfulResponse(chatId = null) {
    const opening = chatId ? `event: chat\ndata: {"chat_id":"${chatId}"}\n\n` : "";
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(
                new TextEncoder().encode(
                    opening +
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

test("requestModel range la nouvelle conversation dans state.chatIds.chat", { concurrency: false }, async () => {
    prepareAuth();
    const savedProject = state.frProject;
    const savedAgent = state.chatIds.agent;
    state.frProject = null;
    state.chatIds.chat = null;
    state.chatIds.agent = "ancienne-conversation-agent";
    const bodies = [];
    global.fetch = async (url, init) => {
        bodies.push(JSON.parse(init.body));
        return successfulResponse("chat-neuf");
    };

    try {
        assert.equal(await requestModel("bonjour"), "ok");
        assert.equal(bodies[0].chatId, null);
        assert.equal(bodies[0].agentId, -1002);
        assert.equal("clientTools" in bodies[0], false);
        assert.equal(state.chatIds.chat, "chat-neuf");
        assert.equal(state.chatId, "chat-neuf");
        assert.equal(state.chatIds.agent, "ancienne-conversation-agent");

        // Tour suivant : la même conversation est reprise.
        await requestModel("suite");
        assert.equal(bodies[1].chatId, "chat-neuf");
    } finally {
        state.frProject = savedProject;
        state.chatIds.agent = savedAgent;
    }
});

test("requestModel fresh : conversation à part, state intact, ni recherche web ni projet", { concurrency: false }, async () => {
    prepareAuth();
    const saved = { project: state.frProject, webSearch: state.webSearch, chatId: state.chatId };
    state.frProject = { id: "projet-1" };
    state.webSearch = true;
    state.chatId = "chat-1";
    const bodies = [];
    global.fetch = async (url, init) => {
        bodies.push(JSON.parse(init.body));
        return successfulResponse("resume-projet");
    };

    try {
        assert.equal(await requestModel("résume le projet", { fresh: true, agentId: -2002 }), "ok");
        assert.equal(bodies.length, 1);
        assert.equal(bodies[0].chatId, null);
        assert.equal(bodies[0].agentId, -2002);
        assert.equal(bodies[0].enableWebSearch, false);
        assert.equal("projectId" in bodies[0], false);
        assert.equal(state.chatIds.chat, "chat-1");
        assert.equal(state.chatId, "chat-1");
    } finally {
        state.frProject = saved.project;
        state.webSearch = saved.webSearch;
        state.chatId = saved.chatId;
    }
});

test("requestModel ne propose jamais d'outils client", { concurrency: false }, async () => {
    prepareAuth();
    const bodies = [];
    global.fetch = async (url, init) => {
        bodies.push(JSON.parse(init.body));
        return successfulResponse();
    };

    assert.equal(await requestModel("bonjour", { clientTools: ["read_file"] }), "ok");
    assert.equal("clientTools" in bodies[0], false);
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

function sseErrorResponse(payload) {
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(`event: error\ndata: ${JSON.stringify(payload)}\n\n`));
            controller.close();
        },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

test("une erreur SSE retryable:false (violation de politique) n'est envoyée qu'une fois", { concurrency: false }, async () => {
    prepareAuth();
    let calls = 0;
    global.fetch = async () => {
        calls++;
        return sseErrorResponse({ code: "CONTENT_POLICY_VIOLATION", message: "refus", retryable: false });
    };

    await assert.rejects(requestModel("bonjour"), error => {
        assert.equal(error.code, "CONTENT_POLICY_VIOLATION");
        assert.equal(error.retryable, false);
        return true;
    });
    assert.equal(calls, 1);
});

test("une violation de politique sans champ retryable n'est pas relancée", { concurrency: false }, async () => {
    prepareAuth();
    let calls = 0;
    global.fetch = async () => {
        calls++;
        return sseErrorResponse({ error: { code: "CONTENT_POLICY_VIOLATION", message: "refus" } });
    };

    await assert.rejects(requestModel("bonjour"), /CONTENT_POLICY_VIOLATION/);
    assert.equal(calls, 1);
});

test("une erreur SSE retryable:true reste relancée", { concurrency: false }, async () => {
    prepareAuth();
    let calls = 0;
    global.fetch = async () => {
        calls++;
        if (calls === 1) return sseErrorResponse({ code: "UPSTREAM_ERROR", retryable: true });
        return successfulResponse();
    };

    assert.equal(await requestModel("bonjour"), "ok");
    assert.equal(calls, 2);
});
