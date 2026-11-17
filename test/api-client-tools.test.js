"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { state } = require("../src/state");
const { auth } = require("../src/api/auth");
const { requestTurn, sendToolResults, extractToolCalls, MAX_TOOL_RESULTS } = require("../src/api/api");

const originalFetch = global.fetch;
const TOOLS = ["list_directory", "read_file", "search_files", "edit_file", "write_file", "run_command"];

test.after(() => {
    global.fetch = originalFetch;
});

function prepareAuth() {
    auth.accessToken = "test-token";
    auth.expiresAt = Date.now() + 300_000;
    auth.deviceId = "test-device";
    state.chatIds.chat = null;
    state.chatId = null;
    state.model = -1002;
    state.frProject = null;
}

function sse(events) {
    const text = events
        .map(([name, data]) => `${name ? `event: ${name}\n` : ""}` +
            `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`)
        .join("");
    return new Response(
        new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(text));
                controller.close();
            }
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } }
    );
}

/** Remplace fetch ; renvoie la liste des requêtes reçues ({ url, body }). */
function mockFetch(respond) {
    const calls = [];
    global.fetch = async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(init.body) });
        return respond(calls.length, String(url));
    };
    return calls;
}

test("requestTurn envoie clientTools et lit uniquement completed.message.toolCalls", { concurrency: false }, async () => {
    prepareAuth();
    const calls = mockFetch(() => sse([
        ["response.output_text.delta", { chat_id: "c-1", delta: "Je regarde." }],
        // function_call de la plateforme relayé pendant le flux : doit être ignoré.
        ["response.output_item.added", { item: { type: "function_call", name: "weather", call_id: "plat-1" } }],
        ["completed", {
            chat_id: "c-1",
            message: {
                role: "assistant",
                content: "Je regarde.",
                toolCalls: [
                    { callId: "call_a", name: "read_file", arguments: { path: "src/a.js", start_line: 1 } },
                    { call_id: "call_b", name: "search_files", arguments: "{\"query\":\"login\"}" }
                ]
            }
        }]
    ]));

    const turn = await requestTurn("Corrige le bug", { clientTools: TOOLS });

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/chats\/stream$/);
    assert.deepEqual(calls[0].body.clientTools, TOOLS);
    assert.equal(calls[0].body.initialContent, "Corrige le bug");
    assert.equal(turn.text, "Je regarde.");
    assert.equal(turn.chatId, "c-1");
    assert.equal(state.chatIds.chat, "c-1");
    assert.deepEqual(turn.toolCalls, [
        { callId: "call_a", name: "read_file", arguments: { path: "src/a.js", start_line: 1 } },
        { callId: "call_b", name: "search_files", arguments: { query: "login" } }
    ]);
});

test("sans clientTools, le corps ne contient pas le champ", { concurrency: false }, async () => {
    prepareAuth();
    const calls = mockFetch(() => sse([["response.output_text.delta", { delta: "ok" }], [null, "[DONE]"]]));
    const turn = await requestTurn("bonjour");
    assert.equal("clientTools" in calls[0].body, false);
    assert.deepEqual(turn.toolCalls, []);
});

test("un tour avec seulement des appels d'outils (texte vide) n'est pas une erreur", { concurrency: false }, async () => {
    prepareAuth();
    mockFetch(() => sse([
        ["completed", { chat_id: "c-2", message: { content: "", toolCalls: [{ callId: "x", name: "list_directory", arguments: { path: "." } }] } }]
    ]));
    const turn = await requestTurn("liste", { clientTools: TOOLS });
    assert.equal(turn.text, "");
    assert.equal(turn.toolCalls.length, 1);
});

test("extractToolCalls signale les arguments invalides sans perdre l'appel", () => {
    const calls = extractToolCalls({
        toolCalls: [
            { callId: "a", name: "read_file", arguments: "{pas du json" },
            { callId: "b", name: "read_file", arguments: [1, 2] },
            { name: "read_file", arguments: {} }
        ]
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].argsError, "Arguments JSON invalides.");
    assert.equal(calls[1].argsError, "Les arguments doivent être un objet JSON.");
    assert.deepEqual(extractToolCalls({ content: "rien" }), []);
});

test("sendToolResults poste sur /chats/{id} et normalise les résultats", { concurrency: false }, async () => {
    prepareAuth();
    const calls = mockFetch(() => sse([
        ["response.output_text.delta", { chat_id: "c-3", delta: "Corrigé." }],
        ["completed", { chat_id: "c-3", message: { content: "Corrigé." } }]
    ]));

    const turn = await sendToolResults("c-3", [
        { callId: "call_a", output: "1: import x" },
        { call_id: "call_b", output: "Refusé par l'utilisateur", is_error: true },
        { callId: "call_c", output: { files: 2 } }
    ], { content: "et ajoute un test" });

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/chats\/c-3$/);
    assert.deepEqual(calls[0].body, {
        toolResults: [
            { callId: "call_a", output: "1: import x" },
            { callId: "call_b", output: "Refusé par l'utilisateur", isError: true },
            { callId: "call_c", output: { files: 2 } }
        ],
        content: "et ajoute un test"
    });
    assert.equal(turn.text, "Corrigé.");
    assert.deepEqual(turn.toolCalls, []);
});

test("sendToolResults accepte aussi une réponse JSON", { concurrency: false }, async () => {
    prepareAuth();
    mockFetch(() => new Response(
        JSON.stringify({ chat_id: "c-4", message: { content: "", toolCalls: [{ callId: "n", name: "run_command", arguments: { command: "npm test" } }] } }),
        { status: 200, headers: { "content-type": "application/json" } }
    ));
    const turn = await sendToolResults("c-4", [{ callId: "p", output: "ok" }]);
    assert.deepEqual(turn.toolCalls, [{ callId: "n", name: "run_command", arguments: { command: "npm test" } }]);
});

test("sendToolResults : 409 n'est jamais relancé", { concurrency: false }, async () => {
    prepareAuth();
    const calls = mockFetch(() => new Response("no pending tool calls", { status: 409 }));
    await assert.rejects(
        sendToolResults("c-5", [{ callId: "a", output: "x" }]),
        /Aucun appel d'outil en attente/
    );
    assert.equal(calls.length, 1);
});

test("sendToolResults : 400 missing n'est pas relancé et est expliqué", { concurrency: false }, async () => {
    prepareAuth();
    const calls = mockFetch(() => new Response("missing: call_b", { status: 400 }));
    await assert.rejects(
        sendToolResults("c-6", [{ callId: "a", output: "x" }]),
        /bug du client/
    );
    assert.equal(calls.length, 1);
});

test("sendToolResults : flux coupé après acceptation, pas de nouvel envoi", { concurrency: false }, async () => {
    prepareAuth();
    const calls = mockFetch(() => new Response(
        new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode("event: response.output_text.delta\ndata: {\"delta\":\"Je\"}\n\n"));
                controller.error(new Error("socket hang up"));
            }
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } }
    ));
    await assert.rejects(
        sendToolResults("c-7", [{ callId: "a", output: "x" }]),
        /pas de nouvel envoi/
    );
    assert.equal(calls.length, 1);
});

test("sendToolResults : erreur réseau avant acceptation, nouvel essai", { concurrency: false }, async () => {
    prepareAuth();
    const calls = mockFetch((n) => {
        if (n === 1) throw new TypeError("fetch failed");
        return new Response(JSON.stringify({ chat_id: "c-8", message: { content: "ok" } }), {
            status: 200, headers: { "content-type": "application/json" }
        });
    });
    const turn = await sendToolResults("c-8", [{ callId: "a", output: "x" }]);
    assert.equal(turn.text, "ok");
    assert.equal(calls.length, 2);
});

test("requestTurn : 403 et modèle Gemini donnent un message clair", { concurrency: false }, async () => {
    prepareAuth();
    mockFetch(() => new Response("forbidden", { status: 403 }));
    await assert.rejects(requestTurn("x", { clientTools: TOOLS }), /2026_11_client_tools/);

    mockFetch(() => new Response("Client tools are not supported by this model.", { status: 400 }));
    await assert.rejects(requestTurn("x", { clientTools: TOOLS }), /OpenAI ou Claude/);
});

test("sendToolResults valide les résultats avant tout envoi", { concurrency: false }, async () => {
    prepareAuth();
    const calls = mockFetch(() => sse([["completed", { message: { content: "ok" } }]]));

    await assert.rejects(sendToolResults(null, [{ callId: "a", output: "" }]), /chatId manquant/);
    await assert.rejects(sendToolResults("c", []), /aucun résultat/);
    await assert.rejects(sendToolResults("c", [{ output: "x" }]), /sans callId/);
    await assert.rejects(
        sendToolResults("c", [{ callId: "a", output: "1" }, { callId: "a", output: "2" }]),
        /en double/
    );
    const tooMany = Array.from({ length: MAX_TOOL_RESULTS + 1 }, (_, i) => ({ callId: `c${i}`, output: "" }));
    await assert.rejects(sendToolResults("c", tooMany), /maximum 32/);
    assert.equal(calls.length, 0);
});
