"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { parseAgentResponse, extractJsonObject } = require("../src/agent/agent");

test("extractJsonObject lit un objet JSON nu", () => {
    const obj = extractJsonObject('{"type":"final","message":"ok"}');
    assert.deepEqual(obj, { type: "final", message: "ok" });
});

test("extractJsonObject lit un objet dans un bloc de code", () => {
    const fence = "\u0060\u0060\u0060";
    const text = `${fence}json\n{"type":"final","message":"ok"}\n${fence}`;
    assert.equal(extractJsonObject(text).message, "ok");
});

test("extractJsonObject ignore le texte autour de l'objet", () => {
    const text = 'Voici : {"type":"final","message":"ok"} merci';
    assert.equal(extractJsonObject(text).message, "ok");
});

test("extractJsonObject renvoie null sans type valide", () => {
    assert.equal(extractJsonObject('{"foo":1}'), null);
});

test("parseAgentResponse accepte une réponse finale", () => {
    assert.equal(parseAgentResponse('{"type":"final","message":"fait"}').message, "fait");
});

test("parseAgentResponse rejette un final dont message n'est pas une chaîne", () => {
    assert.throws(
        () => parseAgentResponse('{"type":"final","message":3}'),
        /message doit être une chaîne/
    );
});

test("parseAgentResponse rejette un outil inconnu", () => {
    assert.throws(
        () => parseAgentResponse('{"type":"tool","name":"inconnu","args":{}}'),
        /Outil inconnu/
    );
});

test("parseAgentResponse limite le plan à 8 étapes et reason à 200 caractères", () => {
    const plan = Array.from({ length: 10 }, (_, i) => `étape ${i}`);
    const action = parseAgentResponse(JSON.stringify({
        type: "tool",
        name: "list_directory",
        args: { path: "." },
        plan,
        reason: "x".repeat(300)
    }));

    assert.equal(action.plan.length, 8);
    assert.equal(action.reason.length, 200);
});

test("parseAgentResponse lève une erreur sans objet JSON", () => {
    assert.throws(() => parseAgentResponse("pas de json"), /Aucun objet JSON/);
});
