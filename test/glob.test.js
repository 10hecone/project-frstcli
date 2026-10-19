"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { CONFIG } = require("../src/config");
const { state } = require("../src/state");
const { glob, MAX_GLOB_RESULTS } = require("../src/tools/fs/glob");
const { TOOLS, validateToolCall, describeCall } = require("../src/tools/registry");

async function withWorkspace(fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frst-glob-"));
    const saved = state.workspace;
    state.workspace = dir;
    try {
        await fn(dir);
    } finally {
        state.workspace = saved;
        await fs.rm(dir, { recursive: true, force: true });
    }
}

async function write(dir, rel, content = "x\n") {
    const abs = path.join(dir, ...rel.split("/"));
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    return abs;
}

async function fill(dir) {
    await write(dir, "a.js");
    await write(dir, "b.ts");
    await write(dir, "c1.txt");
    await write(dir, "c22.txt");
    await write(dir, "src/x.js");
    await write(dir, "src/deep/y.test.js");
    await write(dir, "src/deep/z.ts");
    await write(dir, "node_modules/pkg/index.js");
    await write(dir, ".env", "SECRET=1\n");
}

const sorted = result => [...result.files].sort();

test("glob : * sans « / » porte sur le nom, à tous les niveaux", async () => {
    await withWorkspace(async (dir) => {
        await fill(dir);
        const result = await glob({ pattern: "*.js" });
        assert.deepEqual(sorted(result), ["a.js", "src/deep/y.test.js", "src/x.js"]);
        assert.equal(result.truncated, false);
    });
});

test("glob : ** et chemin depuis la racine", async () => {
    await withWorkspace(async (dir) => {
        await fill(dir);
        const direct = await glob({ pattern: "src/*.js" });
        assert.deepEqual(sorted(direct), ["src/x.js"]);
        const deep = await glob({ pattern: "src/**/*.js" });
        assert.deepEqual(sorted(deep), ["src/deep/y.test.js", "src/x.js"]);
    });
});

test("glob : ? et {a,b}", async () => {
    await withWorkspace(async (dir) => {
        await fill(dir);
        const one = await glob({ pattern: "c?.txt" });
        assert.deepEqual(sorted(one), ["c1.txt"]);
        const alt = await glob({ pattern: "*.{js,ts}", path: "src" });
        assert.deepEqual(sorted(alt), ["src/deep/y.test.js", "src/deep/z.ts", "src/x.js"]);
    });
});

test("glob : motif avec « / » relatif au dossier de départ", async () => {
    await withWorkspace(async (dir) => {
        await fill(dir);
        const result = await glob({ pattern: "deep/*.ts", path: "src" });
        assert.deepEqual(result.files, ["src/deep/z.ts"]);
        assert.equal(result.path, "src");
    });
});

test("glob : ignore node_modules et les fichiers sensibles", async () => {
    await withWorkspace(async (dir) => {
        await fill(dir);
        const result = await glob({ pattern: "**" });
        assert.ok(!result.files.some(f => f.startsWith("node_modules")));
        assert.ok(!result.files.includes(".env"));
});
});

test("glob : trie du plus récent au plus ancien", async () => {
    await withWorkspace(async (dir) => {
        const old = await write(dir, "old.md");
        const mid = await write(dir, "mid.md");
        const recent = await write(dir, "recent.md");
        await fs.utimes(old, new Date(2020, 0, 1), new Date(2020, 0, 1));
        await fs.utimes(mid, new Date(2022, 0, 1), new Date(2022, 0, 1));
        await fs.utimes(recent, new Date(2024, 0, 1), new Date(2024, 0, 1));
        const result = await glob({ pattern: "*.md" });
        assert.deepEqual(result.files, ["recent.md", "mid.md", "old.md"]);
    });
});

test("glob : limite le nombre de fichiers renvoyés", async () => {
    await withWorkspace(async (dir) => {
        for (let i = 0; i < MAX_GLOB_RESULTS + 5; i++) await write(dir, `f${i}.txt`);
        const result = await glob({ pattern: "*.txt" });
        assert.equal(result.files.length, Math.min(MAX_GLOB_RESULTS, CONFIG.maxSearchFiles));
        assert.equal(result.truncated, true);
    });
});

test("glob : refuse un chemin hors du projet et un fichier comme cible", async () => {
    await withWorkspace(async (dir) => {
        await fill(dir);
        await assert.rejects(glob({ pattern: "*", path: ".." }));
        await assert.rejects(glob({ pattern: "*", path: "a.js" }), /dossier/);
    });
});

test("glob : enregistré dans le registre avec validation", () => {
    assert.ok(Object.hasOwn(TOOLS, "glob"));
    assert.throws(() => validateToolCall({ name: "glob", args: {} }), /pattern/);
    assert.throws(() => validateToolCall({ name: "glob", args: { pattern: "{a,b" } }), /accolade/);
    validateToolCall({ name: "glob", args: { pattern: "src/**/*.js" } });
    assert.equal(describeCall({ name: "glob", args: { pattern: "*.js", path: "src" } }), "*.js dans src");
});
