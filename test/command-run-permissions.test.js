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

const { setUiBackend, getUiBackend } = require("../src/ui-bridge");
const { state } = require("../src/state");
const memory = require("../src/project/memory");
const { runCommand, getPermissionStore } = require("../src/tools/command/index");

const saved = {
    workspace: state.workspace
};

let answers = [];
let questions = 0;
let lastQuestion = null;

const FIXTURE = path.join(__dirname, "fixtures", "fake-mcp-server.js");

test.before(async () => {
    fs.writeFileSync(path.join(workspace, "script.js"), "console.log('ok');\n");
    state.workspace = workspace;
    await memory.open(workspace);
    const cli = getUiBackend();
    setUiBackend({
        ...cli,
        askCommand: async (question) => {
            questions += 1;
            lastQuestion = question;
            return answers.shift() ?? "n";
        },
        info() {},
        warn() {},
        commandLine() {},
        onInterrupt: () => () => {}
    });
});

test.after(async () => {
    await require("../src/mcp/manager").getManager().closeAll();
    setUiBackend(null);
    state.workspace = saved.workspace;
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

// ---------------------------------------------------------------------------
// mcp-call (exécuté dans le processus, avec le faux serveur MCP)
// ---------------------------------------------------------------------------

test("mcp-call mélangé à une autre commande : refus sans question ni lancement", async () => {
    questions = 0;
    for (const command of ["mcp-call list && node --version", "node --version | mcp-call list", "cd . && mcp-call list"]) {
        const result = await runCommand({ command });
        assert.equal(result.denied, true, command);
        assert.match(result.message, /mcp-call se lance seul/);
        assert.equal(result.exit_code, undefined);
    }
    assert.equal(questions, 0);
});

test("mcp-call list : lecture seule, sans question, exécuté sans processus", async () => {
    const { addServer } = require("../src/mcp/config");
    await addServer("user", workspace, "fake", { type: "stdio", command: process.execPath, args: [FIXTURE] });

    questions = 0;
    const result = await runCommand({ command: "mcp-call list" });
    assert.equal(questions, 0);
    assert.equal(result.exit_code, 0);
    assert.match(result.output, /fake/);
});

test("mcp-call run : confirmation avec les indications du serveur, puis résultat étiqueté", async () => {
    // tools remplit le cache : la question peut alors citer les annotations de l'outil.
    const listed = await runCommand({ command: "mcp-call tools fake" });
    assert.equal(listed.exit_code, 0);
    assert.match(listed.output, /echo/);

    questions = 0;
    answers = ["o"];
    const result = await runCommand({ command: "mcp-call run fake echo '{\"text\":\"bonjour\"}'" });
    assert.equal(questions, 1);
    assert.match(lastQuestion, /Appeler l'outil « echo » du serveur MCP « fake »/);
    assert.match(lastQuestion, /lecture seule/);
    assert.equal(result.exit_code, 0);
    assert.match(result.output, /serveur MCP "fake", outil "echo"/);
    assert.match(result.output, /bonjour/);
});

test("mcp-call run refusé : rien n'est appelé", async () => {
    questions = 0;
    answers = ["n"];
    const result = await runCommand({ command: "mcp-call fake echo '{\"text\":\"non\"}'" });
    assert.equal(questions, 1);
    assert.equal(result.denied, true);
    assert.equal(result.exit_code, undefined);
});

test("mcp-call run : la règle « t » évite la question suivante, pas celle d'un autre serveur", async () => {
    questions = 0;
    answers = ["t"];
    const first = await runCommand({ command: "mcp-call run fake echo '{\"text\":\"un\"}'" });
    assert.equal(questions, 1);
    assert.equal(first.exit_code, 0);

    const rules = JSON.stringify(await getPermissionStore().list());
    assert.match(rules, /mcp-call/);

    questions = 0;
    const second = await runCommand({ command: "mcp-call fake echo '{\"text\":\"deux\"}'" });
    assert.equal(questions, 0);
    assert.equal(second.exit_code, 0);
    assert.match(second.output, /deux/);

    // Autre serveur : nouvelle question (refusée ici).
    answers = ["n"];
    const other = await runCommand({ command: "mcp-call run autre echo" });
    assert.equal(questions, 1);
    assert.equal(other.denied, true);
});
