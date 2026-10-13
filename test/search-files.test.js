"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { state } = require("../src/state");
const { searchFiles } = require("../src/tools/fs/search-files");

async function withWorkspace(fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frst-search-"));
    const saved = state.workspace;
    state.workspace = dir;
    try {
        await fn(dir);
    } finally {
        state.workspace = saved;
        await fs.rm(dir, { recursive: true, force: true });
    }
}

async function fill(dir) {
    await fs.mkdir(path.join(dir, "sub"));
    await fs.writeFile(path.join(dir, "a.txt"), "Hello\nrien\n  world HELLO  \n", "utf8");
    await fs.writeFile(path.join(dir, "sub", "b.js"), "nothing here\n", "utf8");
    await fs.writeFile(path.join(dir, "sub", "c.txt"), "x\r\nhello there\r\n", "utf8");
    await fs.writeFile(path.join(dir, "bin.dat"), Buffer.from("hello\0binary"));
    await fs.writeFile(path.join(dir, ".env"), "HELLO=secret\n", "utf8");
}

const keys = result => result.matches.map(m => `${m.path}:${m.line}`).sort();

test("searchFiles trouve les lignes sans tenir compte de la casse", async () => {
    await withWorkspace(async (dir) => {
        await fill(dir);
        const result = await searchFiles({ query: "hello", path: "." });
        assert.deepEqual(keys(result), ["a.txt:1", "a.txt:3", "sub/c.txt:2"]);
        assert.equal(result.truncated, false);
        const line3 = result.matches.find(m => m.path === "a.txt" && m.line === 3);
        assert.equal(line3.text, "world HELLO");
    });
});

test("searchFiles ignore les fichiers binaires et sensibles", async () => {
    await withWorkspace(async (dir) => {
        await fill(dir);
        const result = await searchFiles({ query: "hello", path: "." });
        const paths = result.matches.map(m => m.path);
        assert.ok(!paths.includes("bin.dat"));
        assert.ok(!paths.includes(".env"));
    });
});

test("searchFiles limite la recherche au sous-dossier demandé", async () => {
    await withWorkspace(async (dir) => {
        await fill(dir);
        const result = await searchFiles({ query: "HELLO", path: "sub" });
        assert.deepEqual(keys(result), ["sub/c.txt:2"]);
    });
});

test("searchFiles refuse un fichier comme cible", async () => {
    await withWorkspace(async (dir) => {
        await fill(dir);
        await assert.rejects(
            searchFiles({ query: "hello", path: "a.txt" }),
            /doit cibler un dossier/
        );
    });
});
