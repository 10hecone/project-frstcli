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
const { judge } = require("../src/tools/command/policy");
const { runCommand } = require("../src/tools/command/index");
const { runTodo, resetTodos, MAX_TODOS } = require("../src/core/todos");

const saved = { workspace: state.workspace, todos: state.todos };
const published = [];
let questions = 0;

test.before(async () => {
    state.workspace = workspace;
    await memory.open(workspace);
    const cli = getUiBackend();
    setUiBackend({
        ...cli,
        askCommand: async () => {
            questions += 1;
            return "n";
        },
        todos: list => published.push(list.map(item => ({ ...item }))),
        info() {},
        warn() {},
        commandLine() {},
        onInterrupt: () => () => {}
    });
});

test.beforeEach(() => {
    state.todos = [];
    published.length = 0;
    questions = 0;
});

test.after(() => {
    setUiBackend(null);
    state.workspace = saved.workspace;
    state.todos = saved.todos;
    if (previousDataDir === undefined) delete process.env.FS_DATA_DIR;
    else process.env.FS_DATA_DIR = previousDataDir;
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
});

const statuses = () => state.todos.map(item => item.status);

test("todo set : une tâche par argument, ids renumérotés, liste publiée", () => {
    const result = runTodo(["set", "Lire le code", "Écrire  les\ntests"]);
    assert.equal(result.error, undefined);
    assert.deepEqual(state.todos, [
        { id: "1", content: "Lire le code", status: "pending" },
        { id: "2", content: "Écrire les tests", status: "pending" }
    ]);
    assert.equal(published.length, 1);
    assert.match(result.message, /Tâches \(0\/2 terminées\)/);
    assert.match(result.message, /1\. \[ \] Lire le code/);
});

test("todo set : liste JSON avec statuts (alias completed accepté)", () => {
    runTodo(["set", '[{"content":"a","status":"completed"},{"content":"b","status":"in_progress"},"c"]']);
    assert.deepEqual(statuses(), ["done", "in_progress", "pending"]);

    const bad = runTodo(["set", '[{"content":"a","status":"fini"}]']);
    assert.equal(bad.error, true);
    assert.match(bad.message, /Statut inconnu : fini/);
    // Une erreur ne touche pas la liste.
    assert.deepEqual(statuses(), ["done", "in_progress", "pending"]);

    assert.match(runTodo(["set", "[pas du json"]).message, /JSON illisible/);
});

test("todo start / done / add / remove / clear", () => {
    runTodo(["set", "a", "b", "c"]);
    runTodo(["start", "1"]);
    runTodo(["start", "2"]);
    // Une seule tâche en cours à la fois.
    assert.deepEqual(statuses(), ["pending", "in_progress", "pending"]);

    runTodo(["done", "1", "2"]);
    assert.deepEqual(statuses(), ["done", "done", "pending"]);

    runTodo(["add", "d", "en", "plus"]);
    assert.equal(state.todos[3].content, "d en plus");

    runTodo(["remove", "1"]);
    assert.deepEqual(state.todos.map(item => [item.id, item.content]), [["1", "b"], ["2", "c"], ["3", "d en plus"]]);

    const list = runTodo([]);
    assert.match(list.message, /1\. \[x\] b/);

    runTodo(["clear"]);
    assert.deepEqual(state.todos, []);
    assert.equal(runTodo(["list"]).message, "Liste de tâches vide.");
});

test("todo : erreurs claires (numéro, action, limite)", () => {
    runTodo(["set", "a"]);
    assert.match(runTodo(["done", "3"]).message, /Tâche inconnue : 3 \(1 tâche\(s\)\)/);
    assert.match(runTodo(["start"]).message, /Numéro de tâche manquant/);
    assert.match(runTodo(["finir", "1"]).message, /Action inconnue : finir/);
    assert.match(runTodo(["add"]).message, /Tâche vide/);
    const many = Array.from({ length: MAX_TODOS + 1 }, (_, i) => `t${i}`);
    assert.match(runTodo(["set", ...many]).message, /Trop de tâches/);
    assert.equal(state.todos.length, 1);
});

test("resetTodos vide la liste et l'affichage", () => {
    runTodo(["set", "a"]);
    published.length = 0;
    resetTodos();
    assert.deepEqual(state.todos, []);
    assert.deepEqual(published, [[]]);
    // Liste déjà vide : rien n'est republié.
    resetTodos();
    assert.equal(published.length, 1);
});

test("policy : todo est sans risque, interdit dans bg-run", () => {
    assert.equal(judge({ file: "todo", args: ["set", "../hors/projet"], cwd: ".", workspace }).level, "safe");
    assert.equal(judge({ file: "bg-run", args: ["todo", "list"], cwd: ".", workspace }).level, "deny");
});

test("run_command todo : exécuté sans confirmation, seul sur la ligne", async () => {
    const result = await runCommand({ command: 'todo set "Analyser" "Corriger"' });
    assert.equal(questions, 0);
    assert.equal(result.changed, false);
    assert.match(result.message, /1\. \[ \] Analyser\n2\. \[ \] Corriger/);
    assert.equal(state.todos.length, 2);

    const chained = await runCommand({ command: "todo done 1 && git status" });
    assert.equal(chained.denied, true);
    assert.match(chained.message, /todo se lance seul/);
    assert.deepEqual(statuses(), ["pending", "pending"]);
});
