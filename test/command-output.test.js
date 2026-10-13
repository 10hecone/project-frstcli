"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
    stripAnsi,
    isProgressLine,
    isErrorLine,
    collapseRepeats,
    cleanOutput,
    parsePorcelain,
    snapshotChanges,
    diffSnapshots,
    sanitizeDescription,
    MAX_DESCRIPTION_CHARS
} = require("../src/tools/command/output");
const { filterEnv } = require("../src/tools/command/program");

test("stripAnsi retire les séquences de couleur", () => {
    assert.equal(stripAnsi("\x1b[31mrouge\x1b[0m normal"), "rouge normal");
});

test("collapseRepeats replie les lignes identiques en [xN]", () => {
    assert.deepEqual(collapseRepeats(["a", "a", "a", "b"]), ["a [x3]", "b"]);
});

test("barres de progression et lignes d'erreur reconnues", () => {
    assert.equal(isProgressLine("[=====>    ] 45%"), true);
    assert.equal(isProgressLine("Tests: 3 passed"), false);
    assert.equal(isErrorLine("TypeError: x is undefined"), true);
    assert.equal(isErrorLine("tout va bien"), false);
});

test("cleanOutput garde le dernier état d'une ligne réécrite avec \\r", () => {
    const result = cleanOutput("ligne\rprogress 10%\rfin\nok");
    assert.equal(result.output, "fin\nok");
    assert.equal(result.truncated, false);
});

test("cleanOutput place les lignes d'erreur en tête quand la sortie est coupée", () => {
    const lines = [];
    for (let i = 0; i < 400; i++) lines.push(`ligne numéro ${i} ${"-".repeat(30)}`);
    lines.splice(200, 0, "Error: boom");
    const result = cleanOutput(lines.join("\n"), { maxChars: 2000 });
    assert.equal(result.truncated, true);
    assert.ok(result.output.startsWith("[lignes d'erreur]\nError: boom"));
    assert.equal(result.error_lines, 1);
});

test("parsePorcelain lit les statuts, renommages compris", () => {
    assert.deepEqual(parsePorcelain(" M src/a.js\n?? new.txt\nR  old.js -> neu.js\n"), [
        { status: " M", rel: "src/a.js" },
        { status: "??", rel: "new.txt" },
        { status: "R ", rel: "neu.js" }
    ]);
});

test("snapshotChanges et diffSnapshots détectent les fichiers modifiés", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fs-out-"));
    try {
        fs.writeFileSync(path.join(root, "f.txt"), "x");
        const snap = await snapshotChanges(async () => ({ exit_code: 0, stdout: "?? f.txt\n" }), root);
        assert.ok(snap.get("f.txt").startsWith("??:"));
        assert.equal(await snapshotChanges(async () => ({ exit_code: 128, stdout: "" }), root), null);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
    const before = new Map([["a", "M:1"]]);
    const after = new Map([["a", "M:2"], ["b", "??:1"]]);
    assert.deepEqual(diffSnapshots(before, after), ["a", "b"]);
    assert.equal(diffSnapshots(null, after), null);
});

test("sanitizeDescription nettoie et limite la description", () => {
    assert.equal(sanitizeDescription("  lancer   les tests "), "lancer les tests");
    assert.equal(sanitizeDescription(123), null);
    assert.equal(sanitizeDescription("a".repeat(500)).length, MAX_DESCRIPTION_CHARS);
});

test("filterEnv ajoute NO_COLOR et retire FORCE_COLOR et les secrets", () => {
    const env = filterEnv({ FORCE_COLOR: "1", PATH: "x", API_TOKEN: "s" });
    assert.equal(env.NO_COLOR, "1");
    assert.equal(env.FORCE_COLOR, undefined);
    assert.equal(env.API_TOKEN, undefined);
    assert.equal(env.PATH, "x");
});
