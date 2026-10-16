"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    renderMarkdownLine,
    renderMarkdownLite,
    createMarkdownStream
} = require("../src/cli/ui");

const plain = { color: false };
const colored = { color: true };

test("markdown : titres en gras et en couleur", () => {
    assert.equal(renderMarkdownLine("## Titre", { inCode: false }, colored), "\x1b[1;35mTitre\x1b[0m");
    assert.equal(renderMarkdownLine("### Sous-titre", { inCode: false }, colored), "\x1b[1;36mSous-titre\x1b[0m");
    assert.equal(renderMarkdownLine("# Titre", { inCode: false }, plain), "Titre");
});

test("markdown : listes à puces indentées", () => {
    assert.equal(renderMarkdownLine("- élément", { inCode: false }, plain), "  • élément");
    assert.equal(renderMarkdownLine("* autre", { inCode: false }, plain), "  • autre");
    assert.equal(renderMarkdownLine("  - sous", { inCode: false }, plain), "    • sous");
});

test("markdown : listes numérotées indentées", () => {
    assert.equal(renderMarkdownLine("1. un", { inCode: false }, plain), "  1. un");
    assert.equal(renderMarkdownLine("2) deux", { inCode: false }, plain), "  2. deux");
});

test("markdown : citations en gris", () => {
    assert.equal(renderMarkdownLine("> cité", { inCode: false }, colored), "\x1b[90m│ cité\x1b[0m");
    assert.equal(renderMarkdownLine("> cité", { inCode: false }, plain), "│ cité");
});

test("markdown : blocs de code avec couleur distincte et état conservé", () => {
    const state = { inCode: false };
    assert.equal(renderMarkdownLine("```js", state, colored), "\x1b[90m```js\x1b[0m");
    assert.equal(state.inCode, true);
    assert.equal(renderMarkdownLine("# pas un titre", state, colored), "\x1b[33m  # pas un titre\x1b[0m");
    assert.equal(renderMarkdownLine("- pas une puce", state, plain), "  - pas une puce");
    renderMarkdownLine("```", state, colored);
    assert.equal(state.inCode, false);
});

test("markdown : streaming avec un bloc de code réparti sur plusieurs morceaux", () => {
    let out = "";
    const md = createMarkdownStream({ color: false, write: s => { out += s; } });
    md.write("```");
    assert.equal(out, "");
    md.write("js\nconst a");
    assert.equal(md.state.inCode, true);
    md.write(" = 1;\n``");
    md.write("`\n- fin");
    assert.equal(md.state.inCode, false);
    md.flush();
    assert.equal(out, "```js\n  const a = 1;\n```\n  • fin");
});

test("markdown : sans couleur, aucune séquence ANSI", () => {
    const text = "# T\n**gras** et `code`\n- a\n> q\n```\nx\n```";
    const out = renderMarkdownLite(text, plain);
    assert.ok(!out.includes("\x1b"));
    assert.equal(out, "T\ngras et code\n  • a\n│ q\n```\n  x\n```");
});
