"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

/** Charge un module ESM du renderer en CommonJS (comme gui-activity.test.js). */
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

const queue = loadRendererModule("lib/queue.js");
const entries = loadRendererModule("lib/entries.js");
const usage = loadRendererModule("lib/usage.js");

/* ---------- File d'attente ---------- */

test("file : ajout dans l'ordre, texte vide ignoré, retrait par id", () => {
    let q = queue.enqueue([], "  premier ");
    q = queue.enqueue(q, "   ");
    q = queue.enqueue(q, "second", [{ id: "f1", name: "a.txt" }]);
    assert.deepEqual(q.map((item) => item.text), ["premier", "second"]);
    assert.notEqual(q[0].id, q[1].id);
    assert.deepEqual(q[1].files.map((file) => file.id), ["f1"]);

    const { next, rest } = queue.takeNext(q);
    assert.equal(next.text, "premier");
    assert.deepEqual(rest.map((item) => item.text), ["second"]);
    assert.deepEqual(queue.takeNext([]), { next: null, rest: [] });

    assert.deepEqual(queue.removeQueued(q, q[0].id).map((item) => item.text), ["second"]);
});

test("file : restauration après interruption (textes, brouillon, pièces jointes sans doublon)", () => {
    let q = queue.enqueue([], "un", [{ id: "f1" }]);
    q = queue.enqueue(q, "deux", [{ id: "f2" }]);
    const restored = queue.restoreQueue(q, "brouillon", [{ id: "f2" }, { id: "f3" }]);
    assert.equal(restored.text, "un\n\ndeux\n\nbrouillon");
    assert.deepEqual(restored.files.map((file) => file.id), ["f1", "f2", "f3"]);
    assert.equal(queue.restoreQueue(q, "  ").text, "un\n\ndeux");
});

test("file : aperçu sur une ligne, tronqué", () => {
    assert.equal(queue.preview("a\n  b"), "a b");
    assert.equal(queue.preview("x".repeat(80), 10), `${"x".repeat(9)}…`);
});

/* ---------- Actions ---------- */

test("actions : famille et libellé par outil", () => {
    assert.deepEqual(entries.toolKind("read_file"), { kind: "read", label: "Lecture" });
    assert.equal(entries.toolKind("run_command").kind, "command");
    assert.equal(entries.toolKind("search_files").kind, "search");
    assert.deepEqual(entries.toolKind("outil_x"), { kind: "other", label: "outil_x" });
});

test("actions : état d'une étape", () => {
    const tool = { id: 1, type: "tool", name: "read_file" };
    assert.equal(entries.stepStatus({ entries: [tool] }), "running");
    assert.equal(entries.stepStatus({ entries: [tool, { type: "result", text: "ok" }] }), "done");
    assert.equal(entries.stepStatus({ entries: [tool, { type: "result", tone: "error" }] }), "error");
});

test("confirmation : diff en attente après le dernier outil", () => {
    const diff = { id: 3, type: "diff", lines: ["+a"] };
    assert.equal(entries.pendingDiff([{ id: 1, type: "user" }, { id: 2, type: "tool" }, diff]), diff);
    assert.equal(entries.pendingDiff([diff, { id: 4, type: "tool" }]), null);
    assert.equal(entries.pendingDiff([diff, { id: 4, type: "user" }]), null);
    assert.equal(entries.pendingDiff([]), null);
});

test("indicateur : caractères streamés depuis le dernier message", () => {
    const transcript = [
        { id: 1, type: "assistant", streamed: true, text: "ancien" },
        { id: 2, type: "user", text: "q" },
        { id: 3, type: "assistant", streamed: true, text: "abcd" },
        { id: 4, type: "tool", name: "read_file" }
    ];
    assert.equal(entries.streamedChars(transcript, { id: 5, text: "xy" }), 4 + 1 + 2);
    assert.equal(entries.streamedChars([], null), 0);
});

/* ---------- Contexte ---------- */

test("contexte : détails lus depuis status.contextDetails", () => {
    const details = usage.contextDetails({
        contextDetails: {
            usedTokens: 50000,
            contextWindow: 200000,
            measured: false,
            compactThreshold: 80,
            categories: [{ key: "tools", tokens: 20000 }, { key: "mcp", tokens: 0 }, { key: "autre", tokens: 5 }]
        }
    });
    assert.equal(details.usedTokens, 50000);
    assert.equal(details.measured, false);
    assert.deepEqual(details.categories.map((c) => [c.key, c.label, c.share]), [
        ["tools", "Outils", 10],
        ["autre", "autre", 0.0025]
    ]);
    assert.equal(usage.contextDetails({}), null);
    assert.equal(usage.contextDetails(null), null);
});

test("contexte : format des tokens et seuil de compaction", () => {
    assert.equal(usage.formatTokens(950), "950");
    assert.equal(usage.formatTokens(12345), "12,3 k");
    assert.equal(usage.formatTokens(1_200_000), "1,2 M");
    assert.equal(usage.formatTokens(null), "—");
    assert.equal(usage.compactThresholdLabel({ compactThreshold: 80 }), "Compaction vers 80 %");
    assert.equal(usage.compactThresholdLabel({ compactThreshold: 160000 }), "Compaction vers 160 k tokens");
    assert.equal(usage.compactThresholdLabel({ compactThreshold: null }), null);
});
