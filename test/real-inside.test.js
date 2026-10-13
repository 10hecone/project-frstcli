"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { assertRealInside } = require("../src/tools/security");

async function withDirs(fn) {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "frst-ws-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "frst-out-"));
    try {
        await fn(workspace, outside);
    } finally {
        await fs.rm(workspace, { recursive: true, force: true });
        await fs.rm(outside, { recursive: true, force: true });
    }
}

test("assertRealInside accepte un fichier à créer dans le projet", async () => {
    await withDirs(async (workspace) => {
        await fs.mkdir(path.join(workspace, "src"));
        const target = path.join(workspace, "src", "nouveau", "a.js");
        await assertRealInside(workspace, target);
    });
});

test("assertRealInside refuse une cible hors du projet", async () => {
    await withDirs(async (workspace, outside) => {
        await assert.rejects(
            assertRealInside(workspace, path.join(outside, "x.txt")),
            /hors du projet/
        );
    });
});

test("assertRealInside refuse une jonction qui sort du projet", async (t) => {
    await withDirs(async (workspace, outside) => {
        const link = path.join(workspace, "lien");
        try {
            await fs.symlink(outside, link, "junction");
        } catch (error) {
            if (error.code === "EPERM" || error.code === "EACCES") {
                t.skip("création de lien non autorisée sur cette machine");
                return;
            }
            throw error;
        }
        await assert.rejects(
            assertRealInside(workspace, path.join(link, "x.txt")),
            /hors du projet/
        );
    });
});
