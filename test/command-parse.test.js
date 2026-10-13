"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    parseCommand,
    formatCommand,
    CommandParseError,
    MAX_COMMAND_CHARS
} = require("../src/tools/command/parse");

test("parseCommand découpe une commande simple", () => {
    assert.deepEqual(parseCommand("npm test"), { file: "npm", args: ["test"] });
    assert.deepEqual(parseCommand("  node\t-v  "), { file: "node", args: ["-v"] });
});

test("parseCommand gère les guillemets et les échappements", () => {
    assert.deepEqual(parseCommand(`node "a b.js" 'c d'`), { file: "node", args: ["a b.js", "c d"] });
    assert.deepEqual(parseCommand('echo "a\\"b"'), { file: "echo", args: ['a"b'] });
    assert.deepEqual(parseCommand("echo a\\ b"), { file: "echo", args: ["a b"] });
    assert.deepEqual(parseCommand('echo ""'), { file: "echo", args: [""] });
    assert.deepEqual(parseCommand("type C:\\dir\\f.txt"), { file: "type", args: ["C:\\dir\\f.txt"] });
    assert.deepEqual(parseCommand("echo ';'"), { file: "echo", args: [";"] });
    assert.deepEqual(parseCommand("echo $HOME %PATH%"), { file: "echo", args: ["$HOME", "%PATH%"] });
});

test("parseCommand refuse les opérateurs shell", () => {
    const refused = [
        "a; b", "a && b", "a & b", "a | b", "a || b", "a > f", "a < f",
        "a `b`", "a $(b)", "a\nb", 'echo "`x`"', 'echo "$(x)"'
    ];

    for (const line of refused) {
        assert.throws(() => parseCommand(line), CommandParseError, line);
    }
});

test("parseCommand refuse les commandes vides, trop longues ou mal fermées", () => {
    assert.throws(() => parseCommand(""), CommandParseError);
    assert.throws(() => parseCommand("   "), CommandParseError);
    assert.throws(() => parseCommand('echo "abc'), /non fermé/);
    assert.throws(() => parseCommand("a\0b"), /nul/);
    assert.throws(() => parseCommand("a".repeat(MAX_COMMAND_CHARS + 1)), /trop longue/);
});

test("formatCommand met entre guillemets les arguments ambigus", () => {
    assert.equal(formatCommand("node", ["a b", "", 'x"y', "plain"]), 'node "a b" "" "x\\"y" plain');
    assert.equal(formatCommand("npm"), "npm");
});
