"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

/** Charge un module ESM du renderer en CommonJS (comme gui-workspace.test.js). */
function loadRendererModule(relative) {
    const esbuild = require("esbuild");
    const file = path.join(__dirname, "..", "src", "gui", "renderer", relative);
    const out = esbuild.buildSync({ entryPoints: [file], bundle: true, format: "cjs", platform: "node", write: false, logLevel: "silent" });
    const mod = new Module(file);
    mod.filename = file;
    mod.paths = Module._nodeModulePaths(path.dirname(file));
    mod._compile(out.outputFiles[0].text, file);
    return mod.exports;
}

const { groupActivity, failedSteps } = loadRendererModule("lib/entries.js");

test("activité : outils consécutifs regroupés en étapes", () => {
    const items = groupActivity([
        { id: 1, type: "user", text: "lis" },
        { id: 2, type: "tool", name: "read_file", arg: "a.js" },
        { id: 3, type: "result", text: "10 lignes" },
        { id: 4, type: "tool", name: "run_command", arg: "npm test" },
        { id: 5, type: "print", command: true, lines: ["ok"] },
        { id: 6, type: "result", text: "échec", tone: "error" },
        { id: 7, type: "assistantBlock", lines: ["Voilà"] },
        { id: 8, type: "tool", name: "edit_file", arg: "b.js" },
        { id: 9, type: "diff", lines: [] },
    ]);
    assert.deepEqual(items.map((item) => item.type), ["user", "activity", "assistantBlock", "activity"]);
    assert.deepEqual(items[1].steps.map((step) => step.entries.map((entry) => entry.id)), [[2, 3], [4, 5, 6]]);
    assert.equal(items[1].id, "activity-2");
    assert.equal(failedSteps(items[1].steps), 1);
    assert.deepEqual(items[3].steps[0].entries.map((entry) => entry.id), [8, 9]);
});

test("activité : résultat ou sortie sans outil laissés tels quels", () => {
    const items = groupActivity([
        { id: 1, type: "result", text: "seul" },
        { id: 2, type: "print", lines: ["aide"] },
        { id: 3, type: "tool", name: "read_file" },
        { id: 4, type: "warn", text: "attention" },
        { id: 5, type: "result", text: "après" },
    ]);
    assert.deepEqual(items.map((item) => item.type), ["result", "print", "activity", "warn", "result"]);
});
