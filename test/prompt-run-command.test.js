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
    const end = TOOL_CATALOG.indexOf("12. job_output");
    assert.ok(start !== -1 && end > start);
    const tool = TOOL_CATALOG.slice(start, end);

    assert.match(tool, /"command"/);
    assert.match(tool, /timeout_ms/);
    assert.match(tool, /600000/);
    assert.match(tool, /"args":\{"command":"npm test"/);
    assert.match(tool, /"background"/);
});

test("le catalogue décrit job_output, job_stop, todo_write puis final", () => {
    const output = TOOL_CATALOG.indexOf("12. job_output");
    const stop = TOOL_CATALOG.indexOf("13. job_stop");
    const todo = TOOL_CATALOG.indexOf("14. todo_write");
    const final = TOOL_CATALOG.indexOf("15. final");
    assert.ok(output !== -1 && stop > output && todo > stop && final > todo);
    assert.match(TOOL_CATALOG, /"name":"job_output","args":\{"id":"job-1"\}/);
    assert.match(TOOL_CATALOG, /"name":"job_stop","args":\{"id":"job-1"\}/);
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

function promptWithEnv(env) {
    return buildAgentPrompt({
        workspace: "/projet",
        env,
        task: "lis README.md",
        history: [],
        memorySummary: "",
        observations: [],
        turn: 1,
        maxTurns: 15
    });
}

test("describeEnv affiche la commande de test et le gestionnaire de paquets", () => {
    const text = promptWithEnv({ packageManager: "pnpm", testCommand: "pnpm test", testScript: "vitest run" });

    assert.match(text, /- Gestionnaire de paquets : pnpm/);
    assert.match(text, /- Commande de test : pnpm test \(scripts\.test : vitest run\)/);
});

test("describeEnv indique « inconnue » sans package.json ni lockfile", () => {
    const text = promptWithEnv({});

    assert.match(text, /- Gestionnaire de paquets : inconnu \(aucun lockfile\)/);
    assert.match(text, /- Commande de test : inconnue/);
});
