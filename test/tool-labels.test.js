"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { toolLabel, TOOL_LABELS } = require("../src/tool-labels");
const { CLIENT_TOOLS } = require("../src/tools/registry");

test("un libellé court par outil client, et seulement eux", () => {
    assert.deepEqual(Object.keys(TOOL_LABELS).sort(), [...CLIENT_TOOLS].sort());
    assert.equal(toolLabel("run_command"), "Commande");
});

test("outil inconnu : le nom brut est affiché", () => {
    assert.equal(toolLabel("glob"), "glob");
    assert.equal(toolLabel(undefined), "");
});
