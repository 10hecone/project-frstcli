"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { judge } = require("../src/tools/command/policy");
const { isInsideDir } = require("../src/tools/fs/pair");
const { isSameFile, isCaseOnlyRename } = require("../src/tools/core/fs-utils");
const { makeMatcher } = require("../src/tools/fs/search-files");

const workspace = path.join(os.tmpdir(), "frst-securite-ws");

function level(file, args = [], cwd) {
    return judge({ file, args, cwd, workspace }).level;
}

test("policy : option courte collée à un chemin hors du projet refusée", () => {
    assert.equal(level("grep", ["-f/etc/passwd", "x"]), "deny");
    assert.equal(level("grep", ["-f../secret.txt", "x"]), "deny");
    assert.equal(level("cat", ["-n.env"]), "deny");
    assert.equal(level("grep", ["-r", "token", "src"]), "safe");
    assert.equal(level("grep", ["-n5", "x", "src/app.js"]), "safe");
});

test("policy : python -c refusé, scripts et modules demandent confirmation", () => {
    assert.equal(level("python", ["-c", "print(1)"]), "deny");
    assert.equal(level("python3", ["-Ic", "print(1)"]), "deny");
    assert.equal(level("python3.12", ["-cprint(1)"]), "deny");
    assert.equal(level("py", ["-W", "ignore", "-c", "1"]), "deny");
    assert.equal(level("C:\\Python\\python.exe", ["-c", "1"]), "deny");
    assert.equal(level("python", ["script.py"]), "ask");
    assert.equal(level("python", ["-m", "pytest", "-c", "conf.ini"]), "ask");
});

test("policy : deno eval refusé", () => {
    assert.equal(level("deno", ["eval", "console.log(1)"]), "deny");
    assert.equal(level("deno", ["repl", "--eval=1"]), "deny");
    assert.equal(level("deno", ["run", "main.ts"]), "ask");
});

test("pair : test d'inclusion insensible à la casse sous Windows seulement", () => {
    const sep = path.sep;
    const parent = `${sep}Proj${sep}Src`;
    const child = `${sep}proj${sep}src${sep}x`;
    assert.equal(isInsideDir(parent, child, "win32"), true);
    assert.equal(isInsideDir(parent, child, "linux"), false);
    assert.equal(isInsideDir(parent, `${parent}${sep}x`, "linux"), true);
    assert.equal(isInsideDir(parent, `${parent}x`, "win32"), false);
});

test("fs-utils : caseOnly seulement si les deux chemins désignent le même fichier", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frst-case-"));
    try {
        const lower = path.join(dir, "a.txt");
        const upper = path.join(dir, "A.txt");
        await fs.writeFile(lower, "x", "utf8");

        const insensitive = await fs.stat(upper).then(() => true, () => false);

        if (insensitive) {
            assert.equal(await isCaseOnlyRename(lower, upper), true);
        } else {
            // Système sensible à la casse : A.txt est un autre fichier.
            assert.equal(await isCaseOnlyRename(lower, upper), false);
            await fs.writeFile(upper, "y", "utf8");
            assert.equal(await isSameFile(lower, upper), false);
            assert.equal(await isCaseOnlyRename(lower, upper), false);
        }

        assert.equal(await isCaseOnlyRename(lower, lower), false);
        assert.equal(await isCaseOnlyRename(lower, path.join(dir, "b.txt")), false);
        assert.equal(await isSameFile(lower, lower), true);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});

test("search-files : une regex catastrophique est interrompue (ReDoS)", () => {
    const matcher = makeMatcher("(a+)+$", true, 50);
    const text = `${"a".repeat(40)}!`;
    assert.throws(() => matcher.find(text, 10), /trop lente/);
});

test("search-files : find renvoie les lignes trouvées avec la limite", () => {
    const re = makeMatcher("^foo$", true);
    assert.deepEqual(re.find("foo\nbar\r\nfoo\r\n", 10), [0, 2]);
    assert.deepEqual(re.find("foo\nfoo\nfoo", 2), [0, 1]);

    const plain = makeMatcher("Hello", false);
    assert.deepEqual(plain.find("x\nHELLO\nhello", 10), [1, 2]);
});
