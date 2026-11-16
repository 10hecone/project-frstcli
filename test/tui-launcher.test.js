"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { chooseInterface, isMcpCommand, runMcp, MISSING_BUNDLE_MESSAGE } = require("../bin/frst.js");

const BASE = { argv: [], env: {}, isTTY: true, hasBundle: true };

test("chooseInterface choisit la TUI avec un TTY et le bundle", () => {
    assert.equal(chooseInterface(BASE), "tui");
});

test("chooseInterface choisit classic avec --classic", () => {
    assert.equal(chooseInterface({ ...BASE, argv: ["--classic"] }), "classic");
    assert.equal(chooseInterface({ ...BASE, argv: ["--debug", "--classic"] }), "classic");
});

test("chooseInterface choisit classic avec FRST_UI=classic", () => {
    assert.equal(chooseInterface({ ...BASE, env: { FRST_UI: "classic" } }), "classic");
    assert.equal(chooseInterface({ ...BASE, env: { FRST_UI: " Classic " } }), "classic");
    assert.equal(chooseInterface({ ...BASE, env: { FRST_UI: "tui" } }), "tui");
});

test("chooseInterface choisit classic sans TTY", () => {
    assert.equal(chooseInterface({ ...BASE, isTTY: false }), "classic");
});

test("chooseInterface choisit classic et prévient si le bundle manque", () => {
    const messages = [];
    const choice = chooseInterface({ ...BASE, hasBundle: false, warn: (m) => messages.push(m) });
    assert.equal(choice, "classic");
    assert.deepEqual(messages, [MISSING_BUNDLE_MESSAGE]);
});

test("chooseInterface ne prévient pas pour le bundle si classic est demandé", () => {
    const messages = [];
    const choice = chooseInterface({ ...BASE, argv: ["--classic"], hasBundle: false, warn: (m) => messages.push(m) });
    assert.equal(choice, "classic");
    assert.deepEqual(messages, []);
});

test("chooseInterface sans argument renvoie classic", () => {
    assert.equal(chooseInterface(), "classic");
});

test("isMcpCommand reconnaît frst mcp seulement en premier argument", () => {
    assert.equal(isMcpCommand(["mcp", "list"]), true);
    assert.equal(isMcpCommand(["mcp"]), true);
    assert.equal(isMcpCommand(["--classic", "mcp"]), false);
    assert.equal(isMcpCommand([]), false);
});

test("runMcp transmet les arguments sans « mcp » et renvoie 0 ou 1", async () => {
    const calls = [];
    let stopped = 0;
    const stop = () => { stopped += 1; };
    const ok = await runMcp(["mcp", "get", "github"], { run: async (args) => { calls.push(args); return { ok: true, code: 0 }; }, stop });
    const ko = await runMcp(["mcp", "remove"], { run: async () => ({ ok: false, code: 2 }), stop });
    assert.equal(ok, 0);
    assert.equal(ko, 1);
    assert.deepEqual(calls, [["get", "github"]]);
    assert.equal(stopped, 2);
});

test("runMcp arrête les serveurs même si la commande lève une erreur", async () => {
    let stopped = false;
    await assert.rejects(runMcp(["mcp", "list"], { run: async () => { throw new Error("boum"); }, stop: () => { stopped = true; } }));
    assert.equal(stopped, true);
});

test("frst mcp list ne lance ni la TUI ni l'authentification", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "frst-mcp-home-"));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "frst-mcp-cwd-"));
    try {
        const bin = path.join(__dirname, "..", "bin", "frst.js");
        const env = { ...process.env, HOME: home, USERPROFILE: home, FRST_UI: "", NO_COLOR: "1" };
        const result = spawnSync(process.execPath, [bin, "mcp", "list"], { cwd, env, encoding: "utf8", timeout: 20000, input: "" });
        assert.equal(result.error, undefined);
        assert.equal(result.status, 0, result.stderr);
        const output = `${result.stdout}${result.stderr}`;
        assert.doesNotMatch(output, /TUI|interface classique|connexion|identifiant|mot de passe/i);
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
        fs.rmSync(cwd, { recursive: true, force: true });
    }
});
