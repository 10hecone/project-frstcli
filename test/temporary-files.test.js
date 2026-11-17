"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { trackTemporary, cleanupTemporary } = require("../src/tools/core/temporary-files");

test("temporaires : supprimer seulement les créations suivies et inchangées", async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "frst-temp-test-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(path.join(root, ".frst-tmp"));
    for (const name of ["owned.js", "changed.js", "existing.js"]) {
        await fs.writeFile(path.join(root, ".frst-tmp", name), "initial");
    }
    await fs.writeFile(path.join(root, "tmp-user.js"), "initial");
    trackTemporary(root, ".frst-tmp/owned.js", "initial");
    trackTemporary(root, ".frst-tmp/changed.js", "initial");
    trackTemporary(root, "tmp-user.js", "initial");
    await fs.writeFile(path.join(root, ".frst-tmp/changed.js"), "modifié");
    const result = await cleanupTemporary(root);
    assert.deepEqual(result.removed, [".frst-tmp/owned.js"]);
    assert.deepEqual(result.kept, [".frst-tmp/changed.js"]);
    assert.deepEqual(result.errors, []);
    await assert.rejects(fs.stat(path.join(root, ".frst-tmp/owned.js")), { code: "ENOENT" });
    assert.equal(await fs.readFile(path.join(root, ".frst-tmp/existing.js"), "utf8"), "initial");
    assert.equal(await fs.readFile(path.join(root, "tmp-user.js"), "utf8"), "initial");
    assert.deepEqual(await cleanupTemporary(root), { removed: [], kept: [], errors: [] });
});
