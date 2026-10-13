"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");

const { judge, programName } = require("../src/tools/command/policy");

const workspace = path.join(os.tmpdir(), "frst-policy-ws");

function level(file, args = [], cwd) {
    return judge({ file, args, cwd, workspace }).level;
}

test("policy : programmes interdits, quel que soit le chemin ou l'extension", () => {
    assert.equal(level("rm", ["-rf", "src"]), "deny");
    assert.equal(level("PowerShell.EXE", ["-Command", "x"]), "deny");
    assert.equal(level("C:\\Windows\\System32\\cmd.exe", ["/c", "dir"]), "deny");
    assert.equal(level("node", ["-e", "1"]), "deny");
    assert.equal(level("node", ["-pe", "1"]), "deny");
    assert.equal(level("", []), "deny");
    assert.equal(programName("C:\\Program Files\\Git\\bin\\git.exe"), "git");
});

test("policy : arguments qui ressemblent à des chemins", () => {
    assert.equal(level("cat", [".env"]), "deny");
    assert.equal(level("cat", ["config/.env.local"]), "deny");
    assert.equal(level("cat", ["../secret.txt"]), "deny");
    assert.equal(level("cat", ["~/.ssh/id_rsa"]), "deny");
    assert.equal(level("cat", ["node_modules/x/package.json"]), "deny");
    assert.equal(level("grep", ["-r", "token", ".git"]), "deny");
    assert.equal(level("cat", ["--file=../x"]), "deny");
    assert.equal(level("cat", ["server.key"]), "deny");
    assert.equal(level("cat", ["src/app.js"]), "safe");
    assert.equal(level("ls", ["src"]), "safe");
});

test("policy : dossier courant hors du projet refusé", () => {
    assert.equal(level("ls", [], ".."), "deny");
    assert.equal(level("ls", [], "src"), "safe");
    assert.equal(level("cat", ["../app.js"], "src"), "safe");
});

test("policy : git", () => {
    assert.equal(level("git", ["status", "--short"]), "safe");
    assert.equal(level("git", ["log", "--oneline"]), "safe");
    assert.equal(level("git", ["diff", "HEAD:src/a.js"]), "safe");
    assert.equal(level("git", ["branch", "-a"]), "safe");
    assert.equal(level("git", ["commit", "-m", "x"]), "ask");
    assert.equal(level("git", ["branch", "nouvelle"]), "ask");
    assert.equal(level("git", ["push"]), "deny");
    assert.equal(level("git", ["clean", "-fd"]), "deny");
    assert.equal(level("git", ["reset", "--hard"]), "deny");
    assert.equal(level("git", ["-c", "core.pager=x", "log"]), "deny");
    assert.equal(level("git", ["config", "alias.x", "!rm"]), "deny");
    assert.equal(level("git", ["config", "--get", "user.name"]), "ask");
    assert.equal(level("git", ["rebase", "--exec", "x", "main"]), "deny");
    assert.equal(level("git", ["fetch", "--upload-pack=x"]), "deny");
    assert.equal(level("git", ["diff", "--output=out.txt"]), "ask");
});

test("policy : find", () => {
    assert.equal(level("find", [".", "-name", "*.js"]), "safe");
    assert.equal(level("find", [".", "-delete"]), "deny");
    assert.equal(level("find", [".", "-exec", "cat", "{}", ";"]), "deny");
});

test("policy : npm, npx et autres gestionnaires", () => {
    assert.equal(level("npm", ["test"]), "ask");
    assert.equal(level("npm", ["ls"]), "safe");
    assert.equal(level("npm", ["--version"]), "safe");
    assert.equal(level("npm", ["publish"]), "deny");
    assert.equal(level("npm", ["install", "-g", "x"]), "deny");
    assert.equal(level("npm", ["install", "x"]), "ask");
    assert.equal(level("npm", ["config", "set", "registry", "x"]), "deny");
    assert.equal(level("npm", ["exec", "-c", "x"]), "deny");
    assert.equal(level("npm", ["test", "--script-shell=bash"]), "deny");
    assert.equal(level("npx", ["-c", "x"]), "deny");
    assert.equal(level("npx", ["eslint"]), "ask");
    assert.equal(level("pnpm", ["publish"]), "deny");
});

test("policy : autres programmes", () => {
    assert.equal(level("node", ["--version"]), "safe");
    assert.equal(level("node", ["scripts/build.js"]), "ask");
    assert.equal(level("curl", ["https://example.com/a/b"]), "ask");
    assert.equal(level("echo", ["bonjour"]), "safe");
});

test("policy : denialReason d'index.js délègue à judge", () => {
    const { denialReason } = require("../src/tools/command/index");
    assert.match(denialReason("rm", ["x"], workspace), /Programme interdit : rm/);
    assert.match(denialReason("git", ["push"], workspace), /git push/);
    assert.equal(denialReason("npm", ["test"], workspace), null);
});
