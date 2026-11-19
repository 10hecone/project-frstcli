"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const { CONFIG } = require("../src/config");
const { state } = require("../src/state");
const memory = require("../src/project/memory");
const permissionsMode = require("../src/core/permissions-mode");
const { setUiBackend, UI_METHODS } = require("../src/ui-bridge");
const editFile = require("../src/tools/fs/edit-file");
const writeFile = require("../src/tools/fs/write-file");
const readFile = require("../src/tools/fs/read-file");

/** Projet temporaire ouvert, modifications acceptées sans confirmation. */
async function setup(t) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "frst-fresh-")));
    const saved = { dataDir: CONFIG.dataDir, workspace: state.workspace, mode: permissionsMode.get() };

    CONFIG.dataDir = path.join(root, ".data");
    state.workspace = root;
    await memory.open(root);
    permissionsMode.set("acceptEdits");

    const impl = {};
    for (const name of UI_METHODS) impl[name] = () => {};
    impl.spinner = () => ({ update() {}, stop() {} });
    impl.confirm = async () => true;
    impl.diff = () => ({ added: 0, removed: 0 });
    setUiBackend(impl);

    t.after(async () => {
        memory.close();
        CONFIG.dataDir = saved.dataDir;
        state.workspace = saved.workspace;
        permissionsMode.set(saved.mode);
        await fs.rm(root, { recursive: true, force: true });
    });

    const file = (name) => path.join(root, name);
    return { root, file };
}

test("edit_file : fonctionne sans lecture préalable", { concurrency: false }, async (t) => {
    const { file } = await setup(t);
    await fs.writeFile(file("a.txt"), "un\ndeux\n");

    const result = await editFile.run({ path: "a.txt", old_string: "deux", new_string: "trois" });

    assert.equal(result.changed, true);
    assert.equal(await fs.readFile(file("a.txt"), "utf8"), "un\ntrois\n");
    // Fichier jamais lu en entier : write_file ne doit pas l'écraser sur cette base.
    assert.equal(memory.getFile("a.txt").partial, true);
});

test("edit_file : old_string = new_string n'est pas une erreur si le texte est présent", { concurrency: false }, async (t) => {
    const { file } = await setup(t);
    await fs.writeFile(file("a.txt"), "un\ndeux\n");

    const result = await editFile.run({ path: "a.txt", old_string: "deux", new_string: "deux" });
    assert.equal(result.changed, false);
    assert.match(result.message, /déjà présent/);

    await assert.rejects(
        editFile.run({ path: "a.txt", old_string: "cinq", new_string: "cinq" }),
        /introuvable/
    );
});

test("write_file : fichier existant non lu → lu automatiquement, rien n'est écrit", { concurrency: false }, async (t) => {
    const { file } = await setup(t);
    await fs.writeFile(file("b.txt"), "ancien\n");

    const first = await writeFile.run({ path: "b.txt", content: "nouveau\n" });
    assert.equal(first.changed, false);
    assert.equal(first.written, false);
    assert.equal(first.content, "ancien\n");
    assert.match(first.message, /pas encore été lu.*Rien n'a été écrit/);
    assert.equal(await fs.readFile(file("b.txt"), "utf8"), "ancien\n");

    // La lecture automatique suffit : la relance écrit.
    const second = await writeFile.run({ path: "b.txt", content: "nouveau\n" });
    assert.equal(second.changed, true);
    assert.equal(await fs.readFile(file("b.txt"), "utf8"), "nouveau\n");
});

test("write_file : fichier modifié depuis la lecture → contenu actuel renvoyé", { concurrency: false }, async (t) => {
    const { file } = await setup(t);
    await fs.writeFile(file("c.txt"), "v1\n");
    await readFile.run({ path: "c.txt" });
    await fs.writeFile(file("c.txt"), "v2 externe\n");

    const result = await writeFile.run({ path: "c.txt", content: "v3\n" });
    assert.equal(result.written, false);
    assert.equal(result.content, "v2 externe\n");
    assert.match(result.message, /a changé depuis ta dernière lecture/);
    assert.equal(await fs.readFile(file("c.txt"), "utf8"), "v2 externe\n");
});
