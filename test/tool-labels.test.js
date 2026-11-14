"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { toolLabel, TOOL_LABELS } = require("../src/tool-labels");

test("libellés courts des outils", () => {
    assert.equal(toolLabel("glob"), "Trouver");
    assert.equal(toolLabel("multi_edit"), "Éditer (multiple)");
    assert.equal(toolLabel("web_search"), "Chercher sur le web");
    assert.equal(toolLabel("web_fetch"), "Lire le web");
    assert.equal(toolLabel("todo_write"), "Tâches");
    assert.equal(toolLabel("inconnu"), "inconnu");
    assert.equal(toolLabel(undefined), "");
});

test("delegate n'existe plus : pas de libellé dédié", () => {
    assert.ok(!Object.prototype.hasOwnProperty.call(TOOL_LABELS, "delegate"));
    assert.equal(toolLabel("delegate"), "delegate");
});
