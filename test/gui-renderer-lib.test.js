"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

/**
 * Les modules de src/gui/renderer sont en ESM (bundlés par esbuild pour la fenêtre).
 * On les empaquette ici en CommonJS, en mémoire, pour les tester avec node --test.
 */
function loadRendererModule(relative) {
    const esbuild = require("esbuild");
    const file = path.join(__dirname, "..", "src", "gui", "renderer", relative);
    const out = esbuild.buildSync({
        entryPoints: [file],
        bundle: true,
        format: "cjs",
        platform: "node",
        write: false,
        logLevel: "silent"
    });
    const mod = new Module(file);
    mod.filename = file;
    mod.paths = Module._nodeModulePaths(path.dirname(file));
    mod._compile(out.outputFiles[0].text, file);
    return mod.exports;
}

const entries = loadRendererModule("lib/entries.js");
const prompts = loadRendererModule("lib/prompts.js");
const client = loadRendererModule("api/client.js");

test("groupEntries : regroupe les lignes streamées consécutives", () => {
    const items = entries.groupEntries([
        { id: 1, type: "user", text: "q" },
        { id: 2, type: "assistant", text: "a", streamed: true },
        { id: 3, type: "assistant", text: "b", streamed: true },
        { id: 4, type: "tool", name: "read_file" },
        { id: 5, type: "assistant", text: "c", streamed: true }
    ]);
    assert.deepEqual(
        items.map((item) => item.type),
        ["user", "assistantBlock", "tool", "assistantBlock"]
    );
    assert.deepEqual(items[1].lines, ["a", "b"]);
});

test("groupEntries : la ligne en cours prolonge le dernier bloc ou en ouvre un", () => {
    const joined = entries.groupEntries([{ id: 1, type: "assistant", text: "a", streamed: true }], {
        id: 9,
        text: "b"
    });
    assert.deepEqual(joined[0].lines, ["a", "b"]);
    assert.equal(joined[0].live, true);

    const alone = entries.groupEntries([{ id: 1, type: "user", text: "q" }], { id: 9, text: "" });
    assert.equal(alone[1].type, "assistantBlock");
    assert.equal(alone[1].live, true);
});

test("toSegments : sépare texte et blocs de code, bloc non fermé compris", () => {
    const segments = entries.toSegments(["Intro", "```js", "const a = 1;", "```", "Fin", "~~~", "ouvert"]);
    assert.deepEqual(segments, [
        { kind: "text", lang: "", lines: ["Intro"] },
        { kind: "code", lang: "js", lines: ["const a = 1;"] },
        { kind: "text", lang: "", lines: ["Fin"] },
        { kind: "code", lang: "", lines: ["ouvert"] }
    ]);
});

test("displayText et baseName", () => {
    assert.equal(entries.displayText({ content: "étape" }), "étape");
    assert.equal(entries.displayText({ path: "a.js" }), '{"path":"a.js"}');
    assert.equal(entries.displayText(null), "");
    assert.equal(entries.baseName("C:\\Users\\moi\\projet"), "projet");
    assert.equal(entries.baseName("/home/moi/projet/"), "projet");
});

test("confirmOptions : mêmes réponses que la TUI", () => {
    assert.deepEqual(
        prompts.confirmOptions().map((o) => o.value),
        ["o", "n"]
    );
    assert.match(prompts.confirmOptions({ kind: "command", prefix: "npm test" })[2].label, /npm test/);
    assert.equal(prompts.isTextPrompt({ kind: "secret" }), true);
    assert.equal(prompts.isTextPrompt({ kind: "confirm" }), false);
});

test("client : window.frst utilisé s'il respecte le contrat, sinon client hors ligne", async () => {
    const frst = Object.fromEntries(client.CLIENT_METHODS.map((name) => [name, () => {}]));
    assert.equal(client.getClient({ frst }), frst);

    const offline = client.getClient({});
    assert.equal(offline.offline, true);
    const received = [];
    const off = offline.onAction((message) => received.push(message));
    assert.equal((await offline.start()).ok, false);
    off();
    await offline.submit("ignoré");
    assert.equal(received.length, 1);
    assert.equal(received[0].seq, 1);
});

test("client : les quatre méthodes MCP ont une valeur hors ligne", async () => {
    for (const name of ["listMcp", "setMcpEnabled", "connectMcp", "loginMcp"]) {
        assert.ok(client.WORKSPACE_METHODS.includes(name), name);
    }
    assert.ok(!client.WORKSPACE_METHODS.some((name) => /mcp/i.test(name) && /add|remove|call|config/i.test(name)));
    assert.deepEqual(await client.WORKSPACE_FALLBACKS.listMcp(), { servers: [], warnings: [] });
    for (const name of ["setMcpEnabled", "connectMcp", "loginMcp"]) {
        const result = await client.WORKSPACE_FALLBACKS[name]("serveur", true);
        assert.equal(result.ok, false, name);
        assert.equal(typeof result.reason, "string", name);
    }
    const frst = Object.fromEntries(client.CLIENT_METHODS.map((name) => [name, () => {}]));
    const completed = client.withWorkspace(frst);
    assert.equal(typeof completed.listMcp, "function");
    assert.deepEqual(await completed.listMcp(), { servers: [], warnings: [] });
});
