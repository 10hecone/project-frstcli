"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { writeAtomic } = require("../src/tools/core/atomic");

async function withTempDir(fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frst-atomic-"));
    try {
        await fn(dir);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}

async function tmpLeftovers(dir) {
    return (await fs.readdir(dir)).filter((name) => name.endsWith(".tmp"));
}

test("writeAtomic crée un nouveau fichier", async () => {
    await withTempDir(async (dir) => {
        const target = path.join(dir, "new.txt");
        await writeAtomic(target, "bonjour", { expected: null });
        assert.equal(await fs.readFile(target, "utf8"), "bonjour");
    });
});

test("writeAtomic remplace un fichier sans laisser de .tmp", async () => {
    await withTempDir(async (dir) => {
        const target = path.join(dir, "a.txt");
        await fs.writeFile(target, "avant\r\n", "utf8");
        await writeAtomic(target, "après\r\n", { expected: "avant\r\n" });
        assert.equal(await fs.readFile(target, "utf8"), "après\r\n");
        assert.deepEqual(await tmpLeftovers(dir), []);
    });
});

test("writeAtomic refuse si le contenu a changé et ne modifie rien", async () => {
    await withTempDir(async (dir) => {
        const target = path.join(dir, "b.txt");
        await fs.writeFile(target, "changed elsewhere", "utf8");
        await assert.rejects(
            writeAtomic(target, "nouveau", { expected: "original" }),
            /a changé pendant l'écriture/
        );
        assert.equal(await fs.readFile(target, "utf8"), "changed elsewhere");
        assert.deepEqual(await tmpLeftovers(dir), []);
    });
});

test("writeAtomic lève EEXIST si le nouveau fichier existe déjà", async () => {
    await withTempDir(async (dir) => {
        const target = path.join(dir, "c.txt");
        await fs.writeFile(target, "déjà là", "utf8");
        await assert.rejects(
            writeAtomic(target, "autre", { expected: null }),
            (error) => error.code === "EEXIST"
        );
        assert.equal(await fs.readFile(target, "utf8"), "déjà là");
    });
});

test("writeAtomic utilise le lecteur fourni pour la comparaison", async () => {
    await withTempDir(async (dir) => {
        const target = path.join(dir, "d.txt");
        await fs.writeFile(target, "x", "utf8");
        const read = async () => "valeur du lecteur";
        await writeAtomic(target, "y", { expected: "valeur du lecteur", read });
        assert.equal(await fs.readFile(target, "utf8"), "y");
    });
});
