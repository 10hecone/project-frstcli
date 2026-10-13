"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
    createStore,
    decide,
    parseAnswer,
    suggestPrefix,
    normalizePrefix
} = require("../src/tools/command/permissions");

async function tempFile() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frst-perm-"));
    return path.join(dir, "sous", "permissions.json");
}

test("permissions : parseAnswer o / n / t", () => {
    assert.equal(parseAnswer("o"), "once");
    assert.equal(parseAnswer(" OUI "), "once");
    assert.equal(parseAnswer(" T "), "always");
    assert.equal(parseAnswer("n"), "no");
    assert.equal(parseAnswer(""), "no");
    assert.equal(parseAnswer(undefined), "no");
});

test("permissions : suggestPrefix et normalizePrefix", () => {
    assert.deepEqual(suggestPrefix("npm", ["test", "--", "x"]), ["npm", "test"]);
    assert.deepEqual(suggestPrefix("C:\\Tools\\NPM.CMD", ["test"]), ["npm", "test"]);
    assert.deepEqual(suggestPrefix("node", ["scripts/a.js"]), ["node"]);
    assert.deepEqual(suggestPrefix("git", ["-C", "x"]), ["git"]);
    assert.deepEqual(normalizePrefix("  Npm.exe   test "), ["npm", "test"]);
    assert.equal(normalizePrefix("   "), null);
    assert.equal(normalizePrefix(42), null);
});

test("permissions : decide ne lève jamais un deny", () => {
    const rules = [{ prefix: ["npm", "test"] }, { prefix: ["git"] }];
    assert.equal(decide({ verdict: { level: "deny" }, rules, file: "git", args: ["push"] }), "deny");
    assert.equal(decide({ verdict: null, rules, file: "npm", args: ["test"] }), "deny");
    assert.equal(decide({ verdict: { level: "safe" }, rules: [], file: "ls", args: [] }), "run");
    assert.equal(decide({ verdict: { level: "ask" }, rules: [], file: "npm", args: ["test"] }), "ask");
    assert.equal(decide({ verdict: { level: "ask" }, rules, file: "npm", args: ["test", "--watch"] }), "run");
    assert.equal(decide({ verdict: { level: "ask" }, rules, file: "npm", args: ["testx"] }), "ask");
    assert.equal(decide({ verdict: { level: "ask" }, rules, file: "npm", args: ["install"] }), "ask");
});

test("permissions : ajout, doublon, relecture, allows", async () => {
    const file = await tempFile();
    const store = createStore(file);
    assert.deepEqual(await store.load(), []);
    assert.equal(await store.add("npm test"), true);
    assert.equal(await store.add(["NPM.CMD", "test"]), false);
    assert.equal(await store.add(["git", "commit"]), true);
    await assert.rejects(store.add("  "), /vide/);

    const raw = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(raw.version, 1);
    assert.equal(raw.rules.length, 2);

    if (process.platform !== "win32") {
        const info = await fs.stat(file);
        assert.equal(info.mode & 0o777, 0o600);
    }

    const again = createStore(file);
    assert.deepEqual(again.list(), []);
    await again.load();
    assert.deepEqual(again.list().map(r => r.text), ["npm test", "git commit"]);
    assert.equal(await again.allows("npm", ["test", "--watch"]), true);
    assert.equal(await again.allows("npm", ["install"]), false);
    assert.deepEqual(await again.rules(), [{ prefix: ["npm", "test"] }, { prefix: ["git", "commit"] }]);
});

test("permissions : remove par numéro ou préfixe, puis clear", async () => {
    const file = await tempFile();
    const store = createStore(file);
    await store.add("npm test");
    await store.add("git commit");
    await store.add("npx eslint");

    assert.equal(await store.remove("2"), "git commit");
    assert.equal(await store.remove("npx eslint"), "npx eslint");
    assert.equal(await store.remove("9"), null);
    assert.equal(await store.remove("cargo build"), null);
    assert.deepEqual(store.list().map(r => r.text), ["npm test"]);

    assert.equal(await store.clear(), 1);
    const reloaded = createStore(file);
    assert.deepEqual(await reloaded.load(), []);
});

test("permissions : fichier JSON invalide ignoré", async () => {
    const file = await tempFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{ pas du json");
    const store = createStore(file);
    assert.deepEqual(await store.load(), []);
    assert.equal(await store.add("npm test"), true);
});
