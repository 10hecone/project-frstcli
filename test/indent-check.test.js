"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { indentWarning, detectUnit, changedLines } = require("../src/tools/core/indent-check");

const FOUR = [
    "function a() {",
    "    if (x) {",
    "        un();",
    "        deux();",
    "    }",
    "    trois();",
    "    return 1;",
    "}"
].join("\n");

const TWO = FOUR.replace(/^( +)/gm, (s) => " ".repeat(s.length / 2));

test("detectUnit : 4 espaces, 2 espaces, ou rien si trop peu de lignes", () => {
    assert.equal(detectUnit(FOUR), 4);
    assert.equal(detectUnit(TWO), 2);
    assert.equal(detectUnit("a\n    b\n"), null);
});

test("changedLines : seules les lignes modifiées sont renvoyées", () => {
    assert.deepEqual(changedLines("a\nb\nc", "a\nB\nc"), [{ number: 2, text: "B" }]);
    assert.deepEqual(changedLines(null, "a\nb").map(l => l.number), [1, 2]);
});

test("indentWarning : lignes à 1 et 5 espaces signalées", () => {
    const after = FOUR.replace("        un();", " un();").replace("    trois();", "     trois();");
    const warning = indentWarning("src/a.js", FOUR, after);
    assert.match(warning, /4 espaces/);
    assert.match(warning, /ligne\(s\) 3 \(1 espaces\), 6 \(5 espaces\)/);
});

test("indentWarning : rien pour un fichier correct, en 2 espaces ou non-code", () => {
    assert.equal(indentWarning("src/a.js", FOUR, FOUR.replace("un()", "uno()")), null);
    assert.equal(indentWarning("src/a.js", TWO, TWO.replace("  trois();", "  quatre();")), null);
    assert.equal(indentWarning("README.md", FOUR, FOUR.replace("        un();", " un();")), null);
});

test("indentWarning : nouveau fichier jugé sur son propre contenu", () => {
    assert.equal(indentWarning("b.js", null, FOUR), null);
    assert.match(indentWarning("b.js", null, `${FOUR}\n   oups();`), /9 \(3 espaces\)/);
});
