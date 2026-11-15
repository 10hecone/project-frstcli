"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { findLoose } = require("../src/tools/fs/edit-file");

test("findLoose : tolère une indentation différente", () => {
    const text = "function f() {\n\tif (a) {\n\t\treturn 1;\n\t}\n}\n";
    assert.equal(findLoose(text, "    if (a) {\n        return 1;"), "\tif (a) {\n\t\treturn 1;");
});

test("findLoose : fichier CRLF et espaces de fin", () => {
    const text = "a  \r\nb\r\nc\r\n";
    assert.equal(findLoose(text, "a\nb"), "a  \r\nb");
    assert.equal(findLoose(text, "a\nb\n"), "a  \r\nb\r\n");
});

test("findLoose : refuse zéro ou plusieurs correspondances", () => {
    assert.equal(findLoose("x\ny\nx\n", "x"), null);
    assert.equal(findLoose("x\ny\n", "z"), null);
    assert.equal(findLoose("x\n", "   \n"), null);
});
