"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildDiff, printDiff } = require("../src/tools/diff");
const { ui, setUiBackend, getUiBackend } = require("../src/ui-bridge");

const ANSI = /\u001b\[/;

function capture(fn) {
    const original = console.log;
    const out = [];
    console.log = (...args) => out.push(args.join(" "));
    try {
        return { value: fn(), out };
    } finally {
        console.log = original;
    }
}

test("création : toutes les lignes en +, numérotées à partir de 1", () => {
    const diff = buildDiff(null, "a\nb\nc");
    assert.deepEqual(diff.lines, [
        { type: "+", num: 1, text: "a" },
        { type: "+", num: 2, text: "b" },
        { type: "+", num: 3, text: "c" }
    ]);
    assert.equal(diff.added, 3);
    assert.equal(diff.removed, 0);
});

test("création longue : ligne « more » au-delà de maxLines", () => {
    const text = Array.from({ length: 15 }, (_, i) => `l${i + 1}`).join("\n");
    const diff = buildDiff(null, text, 10);
    assert.equal(diff.lines.length, 11);
    const last = diff.lines[10];
    assert.equal(last.type, "more");
    assert.equal(last.num, null);
    assert.match(last.text, /5 lignes de plus/);
    assert.equal(diff.added, 15);
});

test("modification simple : types -/+ et compteurs", () => {
    const diff = buildDiff("a\nb\nc", "a\nB\nc");
    assert.deepEqual(diff.lines, [
        { type: " ", num: 1, text: "a" },
        { type: "-", num: 2, text: "b" },
        { type: "+", num: 2, text: "B" },
        { type: " ", num: 3, text: "c" }
    ]);
    assert.equal(diff.added, 1);
    assert.equal(diff.removed, 1);
});

test("blocs éloignés : contexte de 2 lignes et séparateur gap", () => {
    const old = Array.from({ length: 20 }, (_, i) => `l${i + 1}`);
    const updated = [...old];
    updated[1] = "X2";
    updated[17] = "X18";
    const diff = buildDiff(old.join("\n"), updated.join("\n"));

    const gaps = diff.lines.filter(l => l.type === "gap");
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].num, null);
    assert.equal(gaps[0].text, "⋮");
    assert.ok(!diff.lines.some(l => l.text === "l10"), "les lignes lointaines sont masquées");
    assert.equal(diff.added, 2);
    assert.equal(diff.removed, 2);
});

test("diff long : ligne « more » quand le diff dépasse maxLines", () => {
    const old = Array.from({ length: 30 }, (_, i) => `a${i}`).join("\n");
    const updated = Array.from({ length: 30 }, (_, i) => `b${i}`).join("\n");
    const diff = buildDiff(old, updated, 10);
    const last = diff.lines[diff.lines.length - 1];
    assert.equal(last.type, "more");
    assert.match(last.text, /lignes de diff supplémentaires/);
    assert.equal(diff.lines.filter(l => l.type !== "more" && l.type !== "gap").length, 10);
    assert.equal(diff.added, 30);
    assert.equal(diff.removed, 30);
});

test("les \\r de fin de ligne sont retirés", () => {
    const diff = buildDiff(null, "a\r\nb\r\n");
    assert.ok(diff.lines.every(l => !l.text.includes("\r")));
    assert.equal(diff.lines[0].text, "a");
});

test("données pures : aucun code ANSI", () => {
    const diff = buildDiff("x\ny\nz", "x\nY\nz");
    assert.ok(!ANSI.test(JSON.stringify(diff)));
});

test("printDiff renvoie les mêmes compteurs que buildDiff", () => {
    const oldText = "a\nb\nc\nd";
    const newText = "a\nB\nc\nd\ne";
    const expected = buildDiff(oldText, newText);
    const { value, out } = capture(() => printDiff(oldText, newText));
    assert.deepEqual(value, { added: expected.added, removed: expected.removed });
    assert.equal(out.length, expected.lines.length);
});

test("ui.diff passe les données au backend actif", () => {
    const received = [];
    setUiBackend({ ...getUiBackend(), diff: data => { received.push(data); } });
    try {
        const diff = buildDiff(null, "a");
        ui.diff(diff);
        assert.equal(received.length, 1);
        assert.equal(received[0], diff);
    } finally {
        setUiBackend(null);
    }
});
