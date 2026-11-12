"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

// Le dossier de données doit être fixé AVANT de charger la configuration.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-data-"));
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fs-ws-")));
const previousDataDir = process.env.FS_DATA_DIR;
process.env.FS_DATA_DIR = dataDir;

const { setUiBackend, getUiBackend } = require("../src/ui-bridge");
const { state } = require("../src/state");
const memory = require("../src/project/memory");
const multiEdit = require("../src/tools/fs/multi-edit");
const { undoLast } = require("../src/tools/core/journal");
const { TOOLS, validateToolCall, describeCall } = require("../src/tools/registry");

const saved = { workspace: state.workspace, autoApprove: state.autoApprove };

let answers = [];
let confirms = 0;

function setup(rel, content) {
    fs.writeFileSync(path.join(workspace, rel), content, "utf8");
    memory.rememberFile(rel, content);
}

const read = rel => fs.readFileSync(path.join(workspace, rel), "utf8");

test.before(async () => {
    state.workspace = workspace;
    state.autoApprove = false;
    await memory.open(workspace);
    const cli = getUiBackend();
    setUiBackend({
        ...cli,
        diff: () => ({ added: 0, removed: 0 }),
        result() {},
        info() {},
        warn() {},
        confirm: async () => {
            confirms += 1;
            return answers.shift() ?? false;
        }
    });
});

test.after(() => {
    setUiBackend(null);
    memory.close();
    state.workspace = saved.workspace;
    state.autoApprove = saved.autoApprove;
    if (previousDataDir === undefined) delete process.env.FS_DATA_DIR;
    else process.env.FS_DATA_DIR = previousDataDir;
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test("multi_edit : est enregistré dans le registre", () => {
    assert.ok(TOOLS.multi_edit);
    const call = { name: "multi_edit", args: { path: "a.js", edits: [{ old_string: "a", new_string: "b" }] } };
    validateToolCall(call);
    assert.equal(describeCall(call), "a.js : 1 remplacement(s)");
});

test("multi_edit : validation de edits avec le numéro du remplacement fautif", () => {
    const check = edits => validateToolCall({ name: "multi_edit", args: { path: "a.js", edits } });
    assert.throws(() => check([]), /1 à 20/);
    assert.throws(() => check("x"), /1 à 20/);
    const many = Array.from({ length: 21 }, (_, i) => ({ old_string: `a${i}`, new_string: "b" }));
    assert.throws(() => check(many), /maximum 20/);
    assert.throws(() => check([{ old_string: "a", new_string: "b" }, { old_string: "", new_string: "c" }]), /Remplacement 2 : old_string/);
    assert.throws(() => check([{ old_string: "a", new_string: 3 }]), /Remplacement 1 : new_string/);
    assert.throws(() => check([{ old_string: "a", new_string: "a" }]), /identiques/);
    assert.throws(() => check([{ old_string: "a", new_string: "b", replace_all: "oui" }]), /replace_all/);
});

test("applyEdits : chaque remplacement porte sur le résultat du précédent", () => {
    const { text, replacements } = multiEdit.applyEdits("un deux", [
        { old_string: "un", new_string: "trois" },
        { old_string: "trois deux", new_string: "fin" }
    ]);
    assert.equal(text, "fin");
    assert.equal(replacements, 2);
});

test("multi_edit : succès avec une seule confirmation, puis /undo annule tout d'un coup", async () => {
    const original = "var a = 1;\nvar b = 2;\nconst PORT = 3000;\n";
    setup("app.js", original);
    confirms = 0;
    answers = [true];

    const result = await multiEdit.run({
        path: "app.js",
        edits: [
            { old_string: "const PORT = 3000;", new_string: "const PORT = process.env.PORT || 3000;" },
            { old_string: "var ", new_string: "let ", replace_all: true }
        ]
    });

    assert.equal(result.changed, true);
    assert.equal(result.edits, 2);
    assert.equal(result.replacements, 3);
    assert.equal(confirms, 1);
    assert.equal(read("app.js"), "let a = 1;\nlet b = 2;\nconst PORT = process.env.PORT || 3000;\n");

    const message = await undoLast();
    assert.match(message, /Annulé/);
    assert.equal(read("app.js"), original);
    await assert.rejects(undoLast(), /Rien à annuler/);
});

test("multi_edit : échec au milieu, rien n'est écrit et l'erreur donne le numéro", async () => {
    const original = "alpha\nbeta\ngamma\n";
    setup("b.txt", original);
    confirms = 0;
    answers = [true];

    await assert.rejects(
        multiEdit.run({
            path: "b.txt",
            edits: [
                { old_string: "alpha", new_string: "ALPHA" },
                { old_string: "absent", new_string: "x" },
                { old_string: "gamma", new_string: "GAMMA" }
            ]
        }),
        /Remplacement 2 : old_string est introuvable/
    );

    assert.equal(read("b.txt"), original);
    assert.equal(confirms, 0);
    await assert.rejects(undoLast(), /Rien à annuler/);
});

test("multi_edit : texte non unique sans replace_all refusé", async () => {
    const original = "x\nx\n";
    setup("c.txt", original);
    await assert.rejects(
        multiEdit.run({ path: "c.txt", edits: [{ old_string: "x", new_string: "y" }] }),
        /Remplacement 1 : old_string apparaît 2 fois/
    );
    assert.equal(read("c.txt"), original);
});

test("multi_edit : fichier non lu refusé", async () => {
    fs.writeFileSync(path.join(workspace, "d.txt"), "texte\n", "utf8");
    memory.forgetFile("d.txt");
    await assert.rejects(
        multiEdit.run({ path: "d.txt", edits: [{ old_string: "texte", new_string: "autre" }] }),
        /Lis d'abord d\.txt/
    );
    assert.equal(read("d.txt"), "texte\n");
});

test("multi_edit : refus de l'utilisateur, rien n'est écrit", async () => {
    const original = "bonjour\n";
    setup("e.txt", original);
    confirms = 0;
    answers = [false];
    await multiEdit.run({ path: "e.txt", edits: [{ old_string: "bonjour", new_string: "salut" }] });
    assert.equal(confirms, 1);
    assert.equal(read("e.txt"), original);
    await assert.rejects(undoLast(), /Rien à annuler/);
});
