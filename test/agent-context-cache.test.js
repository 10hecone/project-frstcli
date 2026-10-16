"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Avant tout require du projet : la config lit l'environnement au chargement.
process.env.FS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fscli-data-"));

const { loadAgentContext, clearAgentContextCache } = require("../src/agent/agent");

function makeProject() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fscli-cache-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
    fs.writeFileSync(path.join(dir, "FRSTCLI.md"), "VERSION_1");
    return dir;
}

test("loadAgentContext réutilise le cache pour le même workspace", async () => {
    clearAgentContextCache();
    const dir = makeProject();

    const first = await loadAgentContext(dir);
    const second = await loadAgentContext(dir);

    assert.equal(first.instructions, "VERSION_1");
    assert.equal(first.env.testCommand, "npm test");
    assert.strictEqual(second, first);
});

test("loadAgentContext invalide l'entrée si le mtime de FRSTCLI.md change", async () => {
    clearAgentContextCache();
    const dir = makeProject();
    const file = path.join(dir, "FRSTCLI.md");

    const first = await loadAgentContext(dir);

    fs.writeFileSync(file, "VERSION_2");
    const stamp = new Date(Date.now() - 3_600_000);
    fs.utimesSync(file, stamp, stamp);

    const second = await loadAgentContext(dir);

    assert.notStrictEqual(second, first);
    assert.equal(second.instructions, "VERSION_2");
});

test("loadAgentContext invalide l'entrée si le mtime de package.json change", async () => {
    clearAgentContextCache();
    const dir = makeProject();
    const file = path.join(dir, "package.json");

    const first = await loadAgentContext(dir);

    fs.writeFileSync(file, JSON.stringify({ scripts: {} }));
    const stamp = new Date(Date.now() - 3_600_000);
    fs.utimesSync(file, stamp, stamp);

    const second = await loadAgentContext(dir);

    assert.notStrictEqual(second, first);
    assert.equal(second.env.testCommand, null);
});

test("loadAgentContext expire après 60 secondes et clearAgentContextCache vide le cache", async () => {
    clearAgentContextCache();
    const dir = makeProject();
    const now = Date.now();

    const first = await loadAgentContext(dir, now);
    const sameMinute = await loadAgentContext(dir, now + 59_000);
    const expired = await loadAgentContext(dir, now + 61_000);

    assert.strictEqual(sameMinute, first);
    assert.notStrictEqual(expired, first);

    clearAgentContextCache();
    const afterClear = await loadAgentContext(dir, now + 62_000);

    assert.notStrictEqual(afterClear, expired);
});
