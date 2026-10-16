"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { auth } = require("../src/api/auth");
const agents = require("../src/api/agents");

const originalFetch = global.fetch;

test.after(() => {
    global.fetch = originalFetch;
    agents.resetCache();
});

function prepareAuth() {
    auth.accessToken = "test-token";
    auth.expiresAt = Date.now() + 300_000;
    auth.deviceId = "test-device";
}

const API_AGENTS = [
    { id: -1002, name: "GPT 6 Luna", namespace: "fs", description: "", model: "gpt-6-luna", modelProvider: "openai", isActive: true, isDefault: true },
    { id: -3001, name: "Mistral Large 4", namespace: "fs", description: "", model: "mistral-large-4", modelProvider: "mistral", isActive: true, isDefault: false },
    { id: -9999, name: "Ancien modèle", namespace: "fs", description: "", model: "old", modelProvider: "x", isActive: false, isDefault: false },
];

test("listAgents se replie sur KNOWN_MODELS si l'API échoue", { concurrency: false }, async () => {
    agents.resetCache();
    prepareAuth();
    global.fetch = async () => new Response("non", { status: 500 });

    const result = await agents.listAgents();
    assert.equal(result.source, "local");
    assert.ok(result.error);
    assert.ok(result.agents.some((a) => a.id === -2001 && a.name === "Claude Opus 5.5"));
    assert.equal(agents.agentName(-1003), "GPT 6.1 Sol");
    assert.equal(agents.agentName(12345), "12345");
});

test("listAgents appelle GET /chats/agents avec le token et filtre les agents inactifs", { concurrency: false }, async () => {
    agents.resetCache();
    prepareAuth();
    let seen;
    global.fetch = async (url, init) => {
        seen = { url, init };
        return new Response(JSON.stringify(API_AGENTS), { status: 200 });
    };

    const result = await agents.listAgents();
    assert.match(seen.url, /\/chats\/agents$/);
    assert.equal(seen.init.headers.Authorization, "Bearer test-token");
    assert.equal(result.source, "api");
    assert.deepEqual(result.agents.map((a) => a.id), [-1002, -3001]);
    assert.equal(result.agents[0].provider, "openai");
    assert.equal(result.agents[0].isDefault, true);

    // Le cache sert le nom renvoyé par l'API ; un nouvel échec conserve la liste en cache.
    assert.equal(agents.agentName(-3001), "Mistral Large 4");
    global.fetch = async () => new Response("non", { status: 503 });
    const again = await agents.listAgents({ refresh: true });
    assert.equal(again.source, "api");
    assert.deepEqual(again.agents.map((a) => a.id), [-1002, -3001]);
});

test("resolveAgent accepte un nom, un fragment, un nom de modèle ou un identifiant", () => {
    const list = [
        { id: -1002, name: "GPT 6 Luna", model: "gpt-6-luna" },
        { id: -1003, name: "GPT 6.1 Sol", model: "gpt-6.1-sol" },
        { id: -2002, name: "Claude Haiku 5.5", model: "" },
        { id: -2001, name: "Claude Opus 5.5", model: "" },
    ];

    assert.equal(agents.resolveAgent("Claude Opus 5.5", list).agent.id, -2001);
    assert.equal(agents.resolveAgent("claude opus", list).agent.id, -2001);
    assert.equal(agents.resolveAgent("sol", list).agent.id, -1003);
    assert.equal(agents.resolveAgent("gpt-6-luna", list).agent.id, -1002);
    assert.equal(agents.resolveAgent("-2002", list).agent.id, -2002);

    const ambiguous = agents.resolveAgent("claude", list);
    assert.equal(ambiguous.agent, null);
    assert.equal(ambiguous.matches.length, 2);

    assert.deepEqual(agents.resolveAgent("inexistant", list), { agent: null, matches: [] });
    assert.deepEqual(agents.resolveAgent("", list), { agent: null, matches: [] });
});
