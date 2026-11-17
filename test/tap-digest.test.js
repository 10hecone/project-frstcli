"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTapDigest, MAX_FAILURES_CHARS } = require("../src/tools/command/tap-digest");

const SAMPLE = [
    "> pretest",
    "> build de la TUI",
    "TAP version 13",
    "# Subtest: addition",
    "ok 1 - addition",
    "  ---",
    "  duration_ms: 1.2",
    "  ...",
    "# Subtest: division",
    "not ok 2 - division",
    "  ---",
    "  error: 'attendu 2, obtenu 3'",
    "  ...",
    "ok 3 - soustraction",
    "1..3",
    "# tests 3",
    "# pass 2",
    "# fail 1",
    "# duration_ms 42.5",
    ""
].join("\n");

test("sortie TAP condensée : préambule, échecs et bilan", () => {
    const digest = createTapDigest();
    // Découpage arbitraire : les lignes peuvent arriver coupées en plusieurs morceaux.
    for (let i = 0; i < SAMPLE.length; i += 7) digest.push(SAMPLE.slice(i, i + 7));
    const out = digest.render();

    assert.match(out, /> pretest/);
    assert.match(out, /2 test\(s\) réussi\(s\) non détaillé\(s\)/);
    assert.match(out, /Échecs :\nnot ok 2 - division/);
    assert.match(out, /attendu 2, obtenu 3/);
    assert.match(out, /# tests 3\n# pass 2\n# fail 1/);
    assert.doesNotMatch(out, /ok 1 - addition/);
    assert.doesNotMatch(out, /duration_ms: 1.2/);
});

test("sortie non TAP : render renvoie null", () => {
    const digest = createTapDigest();
    digest.push("Bonjour\nrien à voir avec TAP\n");
    assert.equal(digest.render(), null);
});

test("échecs trop longs : tronqués avec une mention", () => {
    const digest = createTapDigest();
    digest.push("TAP version 13\n");
    for (let i = 1; i <= 400; i++) {
        digest.push(`not ok ${i} - échec ${i}\n  error: '${"x".repeat(80)}'\n`);
    }
    digest.push("# fail 400\n");
    const out = digest.render();

    assert.match(out, /caractères d'échecs omis/);
    assert.ok(out.length < MAX_FAILURES_CHARS + 500);
    assert.match(out, /# fail 400$/);
});
