"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { describeCall } = require("../src/tools/registry");
const { summarizeResult } = require("../src/tools/tools");
const { readTextFile } = require("../src/tools/core/freshness");

test("describeCall affiche la commande de run_command et son délai", () => {
    assert.equal(describeCall({ name: "run_command", args: { name: "npm-test" } }), "npm-test");
    assert.equal(
        describeCall({ name: "run_command", args: { command: "npm-test", timeout_ms: 5000 } }),
        "npm-test (délai 5000 ms)"
    );
    assert.equal(describeCall({ name: "read_file", args: { path: "a.js" } }), "a.js");
});

test("summarizeResult résume run_command, read_file et un refus", () => {
    assert.equal(
        summarizeResult("run_command", { command: "npm-test", exit_code: 0, timed_out: false }),
        "npm-test : code 0"
    );
    assert.equal(
        summarizeResult("run_command", { command: "npm-test", exit_code: null, timed_out: true }),
        "npm-test : délai dépassé"
    );
    assert.equal(
        summarizeResult("read_file", { total_lines: 10, range: [2, 4], truncated: false }),
        "10 lignes (lignes 2-4)"
    );
    assert.equal(summarizeResult("write_file", { denied: true }), "Refusé par l'utilisateur");
});

test("readTextFile lit un texte de plus de 4 Ko et refuse les binaires", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "result-shape-"));

    try {
        const big = "ligne de texte\n".repeat(1000);
        await fs.writeFile(path.join(dir, "big.txt"), big);
        assert.equal(await readTextFile(path.join(dir, "big.txt")), big);

        await fs.writeFile(path.join(dir, "empty.txt"), "");
        assert.equal(await readTextFile(path.join(dir, "empty.txt")), "");

        await fs.writeFile(path.join(dir, "early.bin"), Buffer.from([65, 0, 66]));
        await assert.rejects(readTextFile(path.join(dir, "early.bin")), /binaire/);

        const late = Buffer.concat([Buffer.alloc(5000, 65), Buffer.from([0])]);
        await fs.writeFile(path.join(dir, "late.bin"), late);
        await assert.rejects(readTextFile(path.join(dir, "late.bin")), /binaire/);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});
