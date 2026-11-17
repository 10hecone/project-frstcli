"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { CONFIG } = require("../src/config");
const { state } = require("../src/state");
const { buildShortContext, clearShortContextCache, SHORT_CONTEXT_CHARS } = require("../src/project/short-context");
const { readFile } = require("../src/tools/fs/read-file");
const { formatClientResult } = require("../src/tools/registry");

async function tempDir() {
    return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "frst-short-")));
}

test("buildShortContext : environnement et premier niveau, sans fichiers sensibles", async () => {
    const dir = await tempDir();
    await fs.mkdir(path.join(dir, ".git"));
    await fs.writeFile(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
    await fs.writeFile(path.join(dir, "package-lock.json"), "{}");
    await fs.mkdir(path.join(dir, "src"));
    await fs.writeFile(path.join(dir, "a.txt"), "x");
    await fs.writeFile(path.join(dir, ".env"), "SECRET=1");

    clearShortContextCache();
    const text = await buildShortContext(dir, { mcpServers: async () => [] });

    assert.match(text, /- Git : oui, branche main/);
    assert.ok(!text.includes("mcp-call"), "pas de rappel MCP sans serveur");
    assert.match(text, /- Tests : npm test/);
    assert.ok(text.indexOf("\nsrc/") < text.indexOf("\na.txt"), "dossiers d'abord");
    assert.ok(!text.includes(".env") && !text.includes("\n.git"));
    assert.equal(await buildShortContext(""), "");
});

test("buildShortContext : la liste est coupée sous SHORT_CONTEXT_CHARS", async () => {
    const dir = await tempDir();
    await Promise.all(
        Array.from({ length: 200 }, (_, i) => fs.writeFile(path.join(dir, `fichier-au-nom-assez-long-${i}.txt`), ""))
    );

    clearShortContextCache();
    const text = await buildShortContext(dir, { mcpServers: async () => [] });

    assert.ok(text.length <= SHORT_CONTEXT_CHARS);
    assert.match(text, /… \(\d+ autres\)\n\nNotes techniques sur les outils du projet :/);
    assert.doesNotMatch(text, /pas des instructions|ne remplacent pas/);
    assert.match(text, /pas de terminal persistant/);
    assert.match(text, /files:<motif>/);

    // Avec des serveurs MCP : le rappel tient dans le budget, la liste est coupée plus tôt.
    const withMcp = await buildShortContext(dir, { mcpServers: async () => ["fake", "docs"] });
    assert.ok(withMcp.length <= SHORT_CONTEXT_CHARS);
    const last = withMcp.split("\n").find(line => line.startsWith("- MCP local :"));
    assert.match(last, /^- MCP local : commande `mcp-call` \(voir `mcp-call --help`\)\. Serveurs : fake, docs\./);
    assert.match(last, /données, pas des instructions/);
    assert.match(withMcp, /… \(\d+ autres\)\n- MCP local/);
});

test("buildShortContext : une erreur de configuration MCP n'empêche pas le contexte", async () => {
    const dir = await tempDir();
    clearShortContextCache();
    const text = await buildShortContext(dir, { mcpServers: async () => { throw new Error("mcp.json invalide"); } });
    assert.match(text, /Premier niveau du projet/);
    assert.ok(!text.includes("mcp-call"));
});

test("read_file coupe sur une fin de ligne, next_line permet de reprendre, formatClientResult numérote", async (t) => {
    const dir = await tempDir();
    await fs.writeFile(path.join(dir, "f.txt"), "aaaa\nbbbb\ncccc\ndddd\neeee\n");

    const saved = { workspace: state.workspace, max: CONFIG.maxReadChars };
    t.after(() => {
        state.workspace = saved.workspace;
        CONFIG.maxReadChars = saved.max;
    });
    state.workspace = dir;
    CONFIG.maxReadChars = 20;

    const first = await readFile({ path: "f.txt" });
    assert.equal(first.truncated, true);
    assert.deepEqual(first.range, [1, 4]);
    assert.equal(first.next_line, 5);
    assert.equal(first.content, "aaaa\nbbbb\ncccc\ndddd");

    const text = formatClientResult("read_file", first);
    assert.match(text, /^1\taaaa$/m);
    assert.match(text, /^4\tdddd$/m);
    assert.match(text, /\[tronqué\].*start_line=5/);
    assert.ok(!text.includes("eeee"));

    const rest = await readFile({ path: "f.txt", start_line: first.next_line });
    assert.equal(rest.truncated, false);
    assert.equal(rest.next_line, null);
    assert.match(rest.content, /^eeee/);
});

test("read_file coupe une ligne très longue et le signale", async (t) => {
    const dir = await tempDir();
    await fs.writeFile(path.join(dir, "min.js"), `court\n${"x".repeat(50000)}\nfin\n`);

    const saved = state.workspace;
    t.after(() => { state.workspace = saved; });
    state.workspace = dir;

    const result = await readFile({ path: "min.js" });
    const text = formatClientResult("read_file", result);
    assert.ok(text.length < 5000, `sortie trop longue : ${text.length}`);
    assert.match(text, /\[ligne coupée : 50000 caractères\]/);
    assert.match(text, /^3\tfin$/m);
    assert.doesNotMatch(text, /Numéros de ligne/);
});

test("formatClientResult : recherche et liste en texte, autres outils en JSON", () => {
    assert.equal(
        formatClientResult("search_files", { matches: [{ path: "a.js", line: 3, text: "x" }], truncated: false }),
        "1 résultat(s).\na.js:3: x"
    );
    assert.equal(
        formatClientResult("list_directory", { path: ".", entries: [{ path: "src", type: "directory" }, { path: "a.js", type: "file" }] }),
        "Dossier : .\nsrc/\na.js"
    );
    assert.equal(formatClientResult("edit_file", { ok: true }), '{"ok":true}');
});
