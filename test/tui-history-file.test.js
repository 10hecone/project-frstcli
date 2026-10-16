"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const history = require("../src/tui/history-file");

async function withTempDir(fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frst-history-"));
    try {
        await fn(dir);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}

test("HISTORY_LIMIT vaut 200", () => {
    assert.equal(history.HISTORY_LIMIT, 200);
});

test("appendEntry : doublon consécutif, entrée vide, limite", () => {
    assert.deepEqual(history.appendEntry(["a"], "b"), ["a", "b"]);
    assert.deepEqual(history.appendEntry(["a", "b"], "b"), ["a", "b"]);
    assert.deepEqual(history.appendEntry(["b", "a"], "b"), ["b", "a", "b"]);
    assert.deepEqual(history.appendEntry(["a"], "   "), ["a"]);
    assert.deepEqual(history.appendEntry(["a"], null), ["a"]);

    const full = Array.from({ length: 200 }, (_, i) => `e${i}`);
    const next = history.appendEntry(full, "nouveau");
    assert.equal(next.length, 200);
    assert.equal(next[0], "e1");
    assert.equal(next[199], "nouveau");
});

test("load renvoie [] si le fichier est absent ou invalide", async () => {
    await withTempDir(async (dir) => {
        assert.deepEqual(await history.load({ dir }), []);
        await fs.writeFile(path.join(dir, history.HISTORY_FILENAME), "pas du json", "utf8");
        assert.deepEqual(await history.load({ dir }), []);
        await fs.writeFile(path.join(dir, history.HISTORY_FILENAME), "{\"a\":1}", "utf8");
        assert.deepEqual(await history.load({ dir }), []);
    });
});

test("add persiste les entrées entre deux chargements", async () => {
    await withTempDir(async (dir) => {
        const sub = path.join(dir, "data");
        await history.add("un", { dir: sub });
        await history.add("deux\nlignes", { dir: sub });
        await history.add("deux\nlignes", { dir: sub });
        await history.add("", { dir: sub });
        assert.deepEqual(await history.load({ dir: sub }), ["un", "deux\nlignes"]);
        const leftovers = (await fs.readdir(sub)).filter((name) => name.endsWith(".tmp"));
        assert.deepEqual(leftovers, []);
    });
});

test("add respecte la limite", async () => {
    await withTempDir(async (dir) => {
        const file = path.join(dir, "h.json");
        for (const entry of ["a", "b", "c", "d"]) {
            await history.add(entry, { file, limit: 3 });
        }
        assert.deepEqual(await history.load({ file }), ["b", "c", "d"]);
    });
});

test("add en parallèle ne perd pas d'entrée", async () => {
    await withTempDir(async (dir) => {
        await Promise.all(["x", "y", "z"].map((entry) => history.add(entry, { dir })));
        assert.deepEqual(await history.load({ dir }), ["x", "y", "z"]);
    });
});
