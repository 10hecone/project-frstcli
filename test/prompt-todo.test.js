"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { TOOL_CATALOG, buildAgentPrompt } = require("../src/agent/prompt");

function todoSection() {
    const start = TOOL_CATALOG.indexOf("14. todo_write");
    const end = TOOL_CATALOG.indexOf("15. delegate");
    assert.ok(start !== -1 && end > start, "todo_write doit être le n° 14, avant delegate (n° 15)");
    return TOOL_CATALOG.slice(start, end);
}

test("le catalogue décrit todo_write avec ses statuts et la règle d'une seule tâche en cours", () => {
    const section = todoSection();

    assert.match(section, /pending/);
    assert.match(section, /in_progress/);
    assert.match(section, /done/);
    assert.match(section, /Une seule tâche in_progress/);
    assert.match(section, /3 étapes ou plus/);
    assert.match(section, /liste complète/);
});

test("l'exemple todo_write du catalogue est un JSON valide et cohérent", () => {
    const line = todoSection().split(/\r?\n/).find(l => l.trim().startsWith("{\"type\":\"tool\",\"name\":\"todo_write\""));
    assert.ok(line, "exemple JSON introuvable");

    const action = JSON.parse(line.trim());
    assert.equal(action.type, "tool");
    assert.equal(action.name, "todo_write");
    assert.ok(action.reason);
    assert.ok(Array.isArray(action.args.todos) && action.args.todos.length === 3);

    const allowed = ["pending", "in_progress", "done"];
    for (const todo of action.args.todos) {
        assert.equal(typeof todo.id, "string");
        assert.ok(todo.content.length > 0);
        assert.ok(allowed.includes(todo.status));
    }
    assert.equal(action.args.todos.filter(t => t.status === "in_progress").length, 1);
});

test("le prompt complet garde la règle plan et ajoute le suivi avec todo_write", () => {
    const text = buildAgentPrompt({
        workspace: "/projet",
        env: {},
        task: "modifie src/app.js",
        history: [],
        memorySummary: "",
        observations: [],
        turn: 1,
        maxTurns: 15
    });

    assert.match(text, /"plan" \(3 à 6 étapes courtes\) seulement au premier tour/);
    assert.match(text, /utilise todo_write et mets la liste à jour à chaque étape/);
    assert.match(text, /14\. todo_write/);
    assert.match(text, /15\. delegate/);
    assert.match(text, /16\. glob/);
    assert.match(text, /17\. final/);
});
