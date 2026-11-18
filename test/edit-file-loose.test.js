"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { findLoose, stripLineNumbers } = require("../src/tools/fs/edit-file");

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

test("stripLineNumbers : retire les numéros recopiés de read_file", () => {
    assert.equal(stripLineNumbers("12\t    if (a) {\n13\t        return 1;\n14\t"), "    if (a) {\n        return 1;\n");
    assert.equal(stripLineNumbers("  9\tx\r\n10\ty"), "x\r\ny");
    // Combiné au repli : indentation recopiée de travers en plus des numéros.
    const text = "function f() {\n    if (a) {\n        return 1;\n    }\n}\n";
    assert.equal(findLoose(text, stripLineNumbers("2\tif (a) {\n3\t  return 1;")), "    if (a) {\n        return 1;");
});

test("stripLineNumbers : laisse le texte sans numéros sur toutes les lignes", () => {
    assert.equal(stripLineNumbers("12\tx\ny"), null);
    assert.equal(stripLineNumbers("x\ny"), null);
    // Numéros non croissants : sans doute des données (TSV), pas des numéros de ligne.
    assert.equal(stripLineNumbers("5\ta\n3\tb"), null);
});
