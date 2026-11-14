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

const completion = loadRendererModule("lib/completion.js");
const usage = loadRendererModule("lib/usage.js");

test("completion : contexte de commande et de skill", () => {
    assert.deepEqual(completion.completionContext("/he"), { kind: "command", query: "he", start: 0, end: 3 });
    const skill = completion.completionContext("fais $app");
    assert.equal(skill.kind, "skill");
    assert.equal(skill.query, "app");
    assert.equal(skill.start, 5);
    assert.equal(completion.completionContext("/model "), null);
    assert.equal(completion.completionContext("prix 5$"), null);
});

test("completion : classement des commandes", () => {
    const list = completion.commandSuggestions("he");
    assert.equal(list[0].name, "/help");
    assert.ok(completion.commandSuggestions("").length > 0);
});

test("completion : skills désactivés en dernier, mention avec tirets", () => {
    const skills = [
        { name: "Apple Design", description: "interfaces", enabled: false },
        { name: "ponytail", description: "app", enabled: true },
    ];
    const list = completion.skillSuggestions("", skills);
    assert.deepEqual(list.map((skill) => skill.mention), ["ponytail", "Apple-Design"]);
    assert.equal(completion.skillMention("  Apple   Design "), "Apple-Design");
});

test("completion : insertion et position du curseur", () => {
    const text = "fais $app merci";
    const context = completion.completionContext(text, 9);
    const result = completion.applyCompletion(text, context, "$apple-design");
    assert.equal(result.text, "fais $apple-design merci");
    assert.equal(result.caret, "fais $apple-design ".length);
    const command = completion.applyCompletion("/he", completion.completionContext("/he"), "/help");
    assert.deepEqual(command, { text: "/help ", caret: 6 });
});

test("completion : exécution directe sans argument obligatoire", () => {
    assert.equal(completion.runsWithoutArgs({ name: "/help", args: "" }), true);
    assert.equal(completion.runsWithoutArgs({ name: "/model", args: "[nom]" }), true);
    assert.equal(completion.runsWithoutArgs({ name: "/read", args: "<fichier>" }), false);
});

test("completion : liste partagée avec /help du CLI", () => {
    const { COMMAND_LIST } = require("../src/cli/command-list");
    assert.deepEqual(completion.COMMANDS.map((command) => command.name), COMMAND_LIST.map((command) => command.name));
});

test("usage : budget de chat, contexte et niveau", () => {
    assert.deepEqual(usage.chatBudget({ limits: { chatBudget: { usedPercent: 42, resetAt: "x" } } }), { percent: 42, resetAt: "x" });
    assert.equal(usage.chatBudget(null), null);
    assert.equal(usage.contextPercent({ context: 55 }), 55);
    assert.equal(usage.level(95), "high");
});
