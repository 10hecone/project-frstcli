"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");

const { judge } = require("../src/tools/command/policy");
const {
    parseMcpArgs,
    canonicalMcpArgs,
    judgeMcpCall,
    describeMcpCall,
    QUESTION_ARGS_CHARS
} = require("../src/mcp/policy");

const workspace = path.join(os.tmpdir(), "frst-mcp-policy-ws");

function level(args, cwd) {
    return judge({ file: "mcp-call", args, cwd, workspace }).level;
}

test("mcp policy : lecture seule sans confirmation", () => {
    assert.equal(level([]), "safe");
    assert.equal(level(["--help"]), "safe");
    assert.equal(level(["list"]), "safe");
    assert.equal(level(["tools", "github"]), "safe");
    assert.equal(level(["describe", "github", "create_issue"]), "safe");
    assert.equal(level(["resources", "github"]), "safe");
    assert.equal(level(["prompts", "github"]), "safe");
    assert.equal(level(["run", "github", "create_issue", "--help"]), "safe");
});

test("mcp policy : run, read et prompt demandent une confirmation", () => {
    assert.equal(level(["run", "github", "create_issue", '{"title":"a/b"}']), "ask");
    assert.equal(level(["github", "create_issue", '{"path":"../../etc/passwd"}']), "ask");
    assert.equal(level(["read", "files", "file:///etc/passwd"]), "ask");
    assert.equal(level(["prompt", "github", "review", '{"pr":"12"}']), "ask");
    assert.equal(level(["run", "github", "create_issue", "--args-file", "tmp/args.json"]), "ask");
});

test("mcp policy : refus d'un nom de serveur invalide ou d'un --args-file hors du projet", () => {
    assert.equal(level(["tools", "../evil"]), "deny");
    assert.equal(level(["run", "a b", "x"]), "deny");
    assert.equal(level(["run", "a;b", "x"]), "deny");
    assert.equal(level(["run", "..", "x"]), "deny");
    assert.equal(level(["tools", "a;b"]), "deny");
    assert.equal(level(["run", "__proto__", "x"]), "deny");
    assert.equal(level(["run", "github", "x", "--args-file", "../args.json"]), "deny");
    assert.equal(level(["run", "github", "x", "--args-file=~/args.json"]), "deny");
    assert.equal(level(["run", "github", "x", "--args-file", ".env"]), "deny");
    assert.equal(level(["run", "github", "x", "--args-file", path.join(os.homedir(), "a.json")]), "deny");
    assert.equal(level(["run", "github", "x", "--args-file", "../../outside.json"], "sous"), "deny");
    assert.equal(level(["run", "github", "x", "--args-file", "../dans-le-projet.json"], "sous"), "ask");
});

test("mcp policy : une erreur d'usage n'est pas refusée (call.js affiche l'usage)", () => {
    assert.equal(level(["run"]), "safe");
    assert.equal(level(["tools"]), "safe");
    assert.equal(level(["describe", "github"]), "safe");
    assert.equal(level(["run", "github", "x", "{}", "en-trop"]), "safe");
    assert.equal(level(["--inconnue"]), "safe");
});

test("mcp policy : analyse de la grammaire", () => {
    assert.deepEqual(parseMcpArgs(["github", "create_issue", "{}"]), {
        action: "run", server: "github", target: "create_issue", json: "{}", argsFile: null, help: false, shortcut: true
    });
    const parsed = parseMcpArgs(["prompt", "github", "review", "--args-file=a.json"]);
    assert.equal(parsed.action, "prompt");
    assert.equal(parsed.argsFile, "a.json");

    const missing = parseMcpArgs(["describe", "github"]);
    assert.match(missing.error, /<outil>/);
    assert.equal(missing.usage, "usage : mcp-call describe <serveur> <outil>");

    assert.match(parseMcpArgs(["tools", "github", "--args-file", "a.json"]).error, /--args-file/);
    assert.match(parseMcpArgs(["run", "github", "x", "{}", "--args-file", "a.json"]).error, /pas les deux/);
    assert.match(parseMcpArgs(["run", "github", "x", "{", "}"]).error, /un seul argument/);
    assert.equal(parseMcpArgs(["constructor"]).action, "run");
    assert.equal(parseMcpArgs(["tools", "--help"]).help, true);
});

test("mcp policy : forme complète pour les permissions", () => {
    assert.deepEqual(canonicalMcpArgs(["github", "create_issue", "{}"]), ["run", "github", "create_issue", "{}"]);
    assert.deepEqual(
        canonicalMcpArgs(["run", "--args-file", "a.json", "github", "create_issue"]),
        ["run", "github", "create_issue", "--args-file", "a.json"]
    );
    assert.deepEqual(canonicalMcpArgs(["run", "github"]), ["run", "github"]);
});

test("mcp policy : question affichée, arguments masqués puis tronqués", () => {
    const question = describeMcpCall(
        ["github", "create_issue", JSON.stringify({ title: "Bug", token: "ghp_secret_value_123", body: "x".repeat(1000) })],
        { annotations: { destructiveHint: true } }
    );
    assert.match(question, /outil « create_issue » du serveur MCP « github »/);
    assert.ok(!question.includes("ghp_secret_value_123"));
    assert.match(question, /"token":"\*\*\*"/);
    const argsLine = question.split("\n").find(line => line.startsWith("Arguments : "));
    assert.ok(argsLine.length <= "Arguments : ".length + QUESTION_ARGS_CHARS);
    assert.match(question, /peut supprimer ou écraser/);

    const read = describeMcpCall(["read", "docs", "https://exemple.fr/a?api_key=abcdef123456"]);
    assert.match(read, /Lire la ressource/);
    assert.ok(!read.includes("abcdef123456"));
});

test("mcp policy : judgeMcpCall seul (sans judge)", () => {
    assert.equal(judgeMcpCall(["run", "x", "y"], { workspace }).level, "ask");
    assert.match(judgeMcpCall(["run", "x", "y"], { workspace }).reason, /outil « y » du serveur MCP « x »/);
});
