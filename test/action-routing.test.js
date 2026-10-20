"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { state } = require("../src/state");
const router = require("../src/cli/router");
const { detectIntent } = require("../src/agent/prompt");
const { normalizeTodos } = require("../src/tools/todo-write");

function withMode(mode, fn) {
    const saved = { workspace: state.workspace, mode: state.mode };
    state.workspace = "C:/projet";
    state.mode = mode;
    try {
        fn();
    } finally {
        state.workspace = saved.workspace;
        state.mode = saved.mode;
    }
}

test("routeur : les demandes d'action sur le projet passent par l'agent en mode automatique", () => {
    withMode("auto", () => {
        assert.equal(router.shouldUseAgent("commence la mission 4"), true);
        assert.equal(router.shouldUseAgent("finis la tâche 4.1"), true);
        assert.equal(router.shouldUseAgent("lance les tests"), true);
        assert.equal(router.shouldUseAgent("continue l'étape suivante du plan"), true);
        assert.equal(router.shouldUseAgent("fais le commit"), true);
    });
});

test("routeur : une simple conversation reste en mode chat", () => {
    withMode("auto", () => {
        assert.equal(router.shouldUseAgent("bonjour, comment vas-tu ?"), false);
        assert.equal(router.shouldUseAgent("quelle est la capitale de la France ?"), false);
    });
});

test("routeur : les modes forcés et l'absence de projet sont respectés", () => {
    withMode("chat", () => assert.equal(router.shouldUseAgent("commence la mission 4"), false));
    withMode("agent", () => assert.equal(router.shouldUseAgent("bonjour"), true));

    const saved = state.workspace;
    state.workspace = "";
    try {
        assert.equal(router.shouldUseAgent("commence la mission 4"), false);
    } finally {
        state.workspace = saved;
    }
});

test("detectIntent : les demandes d'action donnent edit et non general", () => {
    assert.equal(detectIntent("commence la mission 4"), "edit");
    assert.equal(detectIntent("termine la tâche 4.1"), "edit");
    assert.equal(detectIntent("écris une fonction de tri"), "edit");
    assert.equal(detectIntent("update the README"), "edit");
    assert.equal(detectIntent("bonjour"), "general");
});

test("todo_write : les synonymes de statut sont acceptés", () => {
    const list = normalizeTodos([
        { id: 1, content: "Lire", status: "completed" },
        { id: 2, content: "Écrire", status: "In-Progress" },
        { id: 3, content: "Tester", status: "terminé" },
        { id: 4, content: "Commiter", status: "todo" }
    ]);

    assert.deepEqual(list.map(t => t.status), ["done", "in_progress", "done", "pending"]);
    assert.throws(() => normalizeTodos([{ id: 1, content: "x", status: "inconnu" }]), /status doit valoir/);
});
