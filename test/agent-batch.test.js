"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseAgentResponse } = require("../src/agent/agent");

test("parseAgentResponse accepte calls avec plusieurs lectures", () => {
    const action = parseAgentResponse(JSON.stringify({
        type: "tool",
        calls: [
            { name: "read_file", args: { path: "src/a.js" } },
            { name: "list_directory", args: { path: "." } },
            { name: "search_files", args: { query: "login", path: "src" } }
        ],
        reason: "Lire plusieurs fichiers"
    }));

    assert.equal(action.calls.length, 3);
    assert.deepEqual(action.calls.map(call => call.name), ["read_file", "list_directory", "search_files"]);
});

test("parseAgentResponse refuse un outil d'écriture dans calls", () => {
    assert.throws(
        () => parseAgentResponse(JSON.stringify({
            type: "tool",
            calls: [{ name: "write_file", args: { path: "a.js", content: "x" } }],
            reason: "Écrire"
        })),
        /calls n'accepte que/
    );
});

test("parseAgentResponse refuse plus de 5 appels ou une liste vide", () => {
    const call = { name: "read_file", args: { path: "a.js" } };

    assert.throws(
        () => parseAgentResponse(JSON.stringify({ type: "tool", calls: Array(6).fill(call), reason: "x" })),
        /1 à 5/
    );
    assert.throws(
        () => parseAgentResponse(JSON.stringify({ type: "tool", calls: [], reason: "x" })),
        /1 à 5/
    );
});
