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
