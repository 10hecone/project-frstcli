"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { TOOL_CATALOG, buildAgentPrompt } = require("../src/agent/prompt");

function prompt(task) {
    return buildAgentPrompt({
        workspace: "/projet",
        env: {},
        task,
        history: [],
        memorySummary: "",
        observations: [],
        turn: 1,
        maxTurns: 15
    });
}

test("le catalogue décrit run_command avec command et timeout_ms", () => {
    const start = TOOL_CATALOG.indexOf("11. run_command");
    const end = TOOL_CATALOG.indexOf("12. final");
    assert.ok(start !== -1 && end > start);
    const tool = TOOL_CATALOG.slice(start, end);

    assert.match(tool, /"command"/);
    assert.match(tool, /timeout_ms/);
    assert.match(tool, /600000/);
    assert.match(tool, /"args":\{"command":"npm test"/);
});

test("le catalogue n'impose plus npm-test, git-status ni node-version", () => {
    assert.doesNotMatch(TOOL_CATALOG, /npm-test/);
    assert.doesNotMatch(TOOL_CATALOG, /git-status/);
    assert.doesNotMatch(TOOL_CATALOG, /node-version/);
    assert.doesNotMatch(TOOL_CATALOG, /"name":"npm-test"/);
});

test("le prompt complet : consigne edit, règle truncated et exemple run_command", () => {
    const text = prompt("modifie src/app.js");

    assert.match(text, /run_command avec la commande de test du projet/);
    assert.doesNotMatch(text, /run_command npm-test/);
    assert.match(text, /lis exit_code, timed_out et truncated/);
    assert.match(text, /"exit_code":1/);
    assert.match(text, /"exit_code":0/);
    assert.doesNotMatch(text, /npm-test/);
});
