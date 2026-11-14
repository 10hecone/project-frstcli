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

const md = loadRendererModule("lib/markdown.js");

test("markdown : titres, paragraphes et séparateur", () => {
                const blocks = md.parseMarkdown("# Titre\n\nUne ligne\nla suite\n\n---\n### Petit");
                assert.deepEqual(blocks.map((block) => block.type), ["heading", "paragraph", "hr", "heading"]);
                assert.equal(blocks[0].level, 1);
                assert.equal(md.plainText(blocks[0].children), "Titre");
                assert.equal(md.plainText(blocks[1].children), "Une ligne\nla suite");
                assert.equal(blocks[3].level, 3);
                assert.equal(md.parseMarkdown("#hashtag")[0].type, "paragraph");
});

test("markdown : blocs de code fermés et ouverts (streaming)", () => {
                const [closed] = md.parseMarkdown(["```js", "const a = '**pas du gras**';", "```"]);
                assert.deepEqual(closed, { type: "code", lang: "js", text: "const a = '**pas du gras**';", open: false });
                const [open] = md.parseMarkdown(["~~~", "ligne"]);
                assert.equal(open.type, "code");
                assert.equal(open.open, true);
                assert.equal(open.text, "ligne");
});

test("markdown : en ligne (gras, italique, barré, code, échappement)", () => {
                const nodes = md.parseInline("a **gras** et *ital* et _sous_ et ~~barré~~ et `x * y` \\*pas\\*");
                const types = nodes.filter((node) => node.type !== "text").map((node) => node.type);
                assert.deepEqual(types, ["strong", "em", "em", "del", "code"]);
                assert.equal(md.plainText(nodes), "a gras et ital et sous et barré et x * y *pas*");
                assert.equal(md.parseInline("***fort***")[0].children[0].type, "em");
                assert.deepEqual(md.parseInline("2 * 3 * 4"), [{ type: "text", value: "2 * 3 * 4" }]);
                assert.deepEqual(md.parseInline("snake_case_name"), [{ type: "text", value: "snake_case_name" }]);
                assert.deepEqual(md.parseInline("**ouvert"), [{ type: "text", value: "**ouvert" }]);
                assert.equal(md.parseInline("*a **b** c*")[0].children[1].type, "strong");
});

test("markdown : liens, URL nues et filtrage des protocoles", () => {
                const [link] = md.parseInline("[doc](https://exemple.fr/a_(b) \"titre\")");
                assert.equal(link.type, "link");
                assert.equal(link.href, "https://exemple.fr/a_(b)");
                assert.equal(md.plainText(link.children), "doc");
                const bare = md.parseInline("voir https://exemple.fr/page. Fin");
                assert.equal(bare[1].href, "https://exemple.fr/page");
                assert.equal(bare[2].value, ". Fin");
                assert.equal(md.parseInline("<mailto:a@b.fr>")[0].href, "mailto:a@b.fr");
                assert.equal(md.safeHref("javascript:alert(1)"), null);
                assert.equal(md.safeHref("src/app.js"), null);
                assert.equal(md.safeHref("https://exemple.fr"), "https://exemple.fr");
});

test("markdown : listes imbriquées, numérotées et cases à cocher", () => {
                const [list] = md.parseMarkdown(["- un", "  - sous-élément", "- [x] fait", "- [ ] à faire", "", "3. trois", "4. quatre"].join("\n").split("\n").slice(0, 4));
                assert.equal(list.type, "list");
                assert.equal(list.ordered, false);
                assert.equal(list.items.length, 3);
                assert.equal(list.items[0].children[1].type, "list");
                assert.equal(list.items[1].checked, true);
                assert.equal(list.items[2].checked, false);
                assert.equal(md.plainText(list.items[2].children[0].children), "à faire");

                const [ordered] = md.parseMarkdown("3. trois\n\n4. quatre\nsuite paresseuse\n\nAprès");
                assert.equal(ordered.ordered, true);
                assert.equal(ordered.start, 3);
                assert.equal(ordered.items.length, 2);
                assert.equal(md.plainText(ordered.items[1].children[0].children), "quatre\nsuite paresseuse");
                assert.equal(md.parseMarkdown("1. a\n\nAprès")[1].type, "paragraph");
});

test("markdown : code dans une liste et citation", () => {
                const [list] = md.parseMarkdown("1. Lancer :\n   ```sh\n   npm test\n   ```\n2. Fin");
                assert.equal(list.items.length, 2);
                assert.deepEqual(list.items[0].children[1], { type: "code", lang: "sh", text: "npm test", open: false });
                const [quote] = md.parseMarkdown("> **Note**\n> suite");
                assert.equal(quote.type, "blockquote");
                assert.equal(quote.children[0].children[0].type, "strong");
});

test("markdown : tableaux avec alignement", () => {
                const [table] = md.parseMarkdown("| Nom | Valeur |\n|:--|--:|\n| a | `x \\| y` |\n| b |");
                assert.equal(table.type, "table");
                assert.deepEqual(table.align, ["left", "right"]);
                assert.equal(table.rows.length, 2);
                assert.equal(table.rows[0][1][0].type, "code");
                assert.deepEqual(table.rows[1][1], []);
                assert.deepEqual(md.splitRow("| a | b \\| c |"), ["a", "b | c"]);
});
