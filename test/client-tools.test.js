"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    CLIENT_TOOLS,
    READ_TOOLS,
    normalizeArgs,
    describeClientCall,
    runClientTool,
    validateToolCall
} = require("../src/tools/registry");

test("CLIENT_TOOLS suit le catalogue de l'API, dans un ordre fixe", () => {
    assert.deepEqual([...CLIENT_TOOLS], [
        "list_directory",
        "read_file",
        "search_files",
        "edit_file",
        "write_file",
        "run_command"
    ]);
    assert.ok(Object.isFrozen(CLIENT_TOOLS));
    assert.deepEqual([...READ_TOOLS], ["list_directory", "read_file", "search_files"]);
});

test("normalizeArgs : edit_file renomme old_text/new_text", () => {
    assert.deepEqual(
        normalizeArgs("edit_file", { path: "a.js", old_text: "x", new_text: "y", replace_all: "true" }),
        { path: "a.js", old_string: "x", new_string: "y", replace_all: true }
    );
});

test("normalizeArgs : run_command convertit timeout_seconds et garde cwd", () => {
    assert.deepEqual(
        normalizeArgs("run_command", { command: "npm test", cwd: "web", timeout_seconds: 30 }),
        { command: "npm test", cwd: "web", timeout_ms: 30000 }
    );
    // Plafond à 600 s, valeurs invalides ignorées.
    assert.equal(normalizeArgs("run_command", { command: "x", timeout_seconds: 99999 }).timeout_ms, 600000);
    assert.equal(normalizeArgs("run_command", { command: "x", timeout_seconds: -1 }).timeout_ms, undefined);
    assert.equal(normalizeArgs("run_command", { command: "x", timeout_seconds: "20" }).timeout_ms, 20000);
});

test("normalizeArgs : run_command ignore les arguments hors catalogue", () => {
    assert.deepEqual(
        normalizeArgs("run_command", { command: "npm start", background: true, description: "x" }),
        { command: "npm start" }
    );
});

test("normalizeArgs : list_directory borne depth entre 1 et 3", () => {
    assert.deepEqual(normalizeArgs("list_directory", { path: "src", depth: 5 }), { path: "src", depth: 3 });
    assert.deepEqual(normalizeArgs("list_directory", { path: ".", depth: "0" }), { path: ".", depth: 1 });
    assert.deepEqual(normalizeArgs("list_directory", { path: ".", recursive: true }), { path: "." });
});

test("normalizeArgs : read_file accepte les numéros de ligne en chaîne", () => {
    assert.deepEqual(
        normalizeArgs("read_file", { path: "a.js", start_line: "10", end_line: 20 }),
        { path: "a.js", start_line: 10, end_line: 20 }
    );
});

test("normalizeArgs : search_files détecte les regex et garde max_results", () => {
    assert.deepEqual(
        normalizeArgs("search_files", { query: "function\\s+run", glob: "*.js", max_results: 5 }),
        { query: "function\\s+run", glob: "*.js", regex: true, max_results: 5 }
    );
    // Sans max_results, la valeur par défaut (DEFAULT_SEARCH_RESULTS = 50) est appliquée.
    assert.deepEqual(normalizeArgs("search_files", { query: "TODO" }), { query: "TODO", max_results: 50 });
    // Regex invalide : recherche littérale.
    assert.deepEqual(normalizeArgs("search_files", { query: "foo(" }), { query: "foo(", max_results: 50 });
});

test("normalizeArgs : outil inconnu", () => {
    assert.throws(() => normalizeArgs("delete_path", {}), /Outil client inconnu/);
});

test("les arguments normalisés passent la validation des outils locaux", () => {
    const calls = {
        list_directory: { path: "src", depth: 2 },
        read_file: { path: "a.js", start_line: 1, end_line: 80 },
        search_files: { query: "login", path: "src", glob: "*.ts", max_results: 10 },
        edit_file: { path: "a.js", old_text: "a", new_text: "b" },
        write_file: { path: "b.js", content: "x" },
        run_command: { command: "npm test", timeout_seconds: 60 }
    };

    for (const name of CLIENT_TOOLS) {
        validateToolCall({ name, args: normalizeArgs(name, calls[name]) });
    }
});

test("describeClientCall affiche les arguments du catalogue", () => {
    assert.equal(
        describeClientCall("edit_file", { path: "a.js", old_text: "x", new_text: "y" }),
        "a.js : \"x\" -> \"y\""
    );
    assert.equal(describeClientCall("read_file", { path: "a.js" }), "a.js");
    assert.equal(describeClientCall("list_directory", { path: "src", depth: 2 }), "src (profondeur 2)");
});

test("runClientTool refuse un outil hors de la liste autorisée", async () => {
    await assert.rejects(runClientTool("write_file", { path: "a", content: "b" }, READ_TOOLS), /non disponible/);
    await assert.rejects(runClientTool("web_fetch", { url: "https://x" }), /non disponible/);
});
