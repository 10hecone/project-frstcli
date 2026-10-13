"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

// Le dossier de données doit être fixé AVANT de charger la configuration.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-data-"));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "fs-ws-"));
const previousDataDir = process.env.FS_DATA_DIR;
process.env.FS_DATA_DIR = dataDir;

const { ui } = require("../src/cli/ui");
const { state } = require("../src/state");
const memory = require("../src/project/memory");
const { runCommand, getPermissionStore } = require("../src/tools/command/index");

const saved = {
    askCommand: ui.askCommand,
    info: ui.info,
    warn: ui.warn,
    commandLine: ui.commandLine,
    onInterrupt: ui.onInterrupt,
    workspace: state.workspace,
    autoApprove: state.autoApprove
};

let answers = [];
let questions = 0;

test.before(async () => {
    fs.writeFileSync(path.join(workspace, "script.js"), "console.log('ok');\n");
    state.workspace = workspace;
    state.autoApprove = false;
    await memory.open(workspace);
    ui.askCommand = async () => {
        questions += 1;
        return answers.shift() ?? "n";
    };
    ui.info = () => {};
    ui.warn = () => {};
    ui.commandLine = () => {};
    ui.onInterrupt = () => () => {};
});

test.after(() => {
    ui.askCommand = saved.askCommand;
    ui.info = saved.info;
    ui.warn = saved.warn;
    ui.commandLine = saved.commandLine;
    ui.onInterrupt = saved.onInterrupt;
    state.workspace = saved.workspace;
    state.autoApprove = saved.autoApprove;
    if (previousDataDir === undefined) delete process.env.FS_DATA_DIR;
    else process.env.FS_DATA_DIR = previousDataDir;
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test("commande interdite : refus sans question", async () => {
    questions = 0;
    const result = await runCommand({ command: "rm x" });
    assert.equal(result.denied, true);
    assert.equal(questions, 0);
});

test("commande sûre : lancée sans question", async () => {
    questions = 0;
    const result = await runCommand({ command: "node --version" });
    assert.equal(questions, 0);
    assert.equal(result.exit_code, 0);
});

test("réponse n : commande refusée", async () => {
    questions = 0;
    answers = ["n"];
    const result = await runCommand({ command: "node script.js" });
    assert.equal(questions, 1);
    assert.equal(result.denied, true);
    assert.equal(result.exit_code, undefined);
});

test("réponse t : commande lancée et règle enregistrée", async () => {
    questions = 0;
    answers = ["t"];
    const result = await runCommand({ command: "node script.js" });
    assert.equal(questions, 1);
    assert.equal(result.exit_code, 0);

    const store = getPermissionStore();
    assert.ok(store, "le store doit exister quand un projet est ouvert");
    const rules = await store.list();
    assert.match(JSON.stringify(rules), /node/);
    assert.ok(fs.existsSync(store.file), "permissions.json doit exister");
    assert.equal(path.basename(store.file), "permissions.json");
});

test("règle enregistrée : plus de question", async () => {
    questions = 0;
    const result = await runCommand({ command: "node script.js" });
    assert.equal(questions, 0);
    assert.equal(result.exit_code, 0);
});

test("une règle git n'autorise jamais git push", async () => {
    questions = 0;
    const store = getPermissionStore();
    await store.add(["git"]);
    const result = await runCommand({ command: "git push" });
    assert.equal(result.denied, true);
    assert.equal(questions, 0);
});
