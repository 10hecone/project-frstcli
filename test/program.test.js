"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
    filterEnv,
    getEnv,
    findOnWindows,
    resolveProgram
} = require("../src/tools/command/program");

const windowsOnly = { skip: process.platform !== "win32" && "Windows uniquement" };

/** Dossier temporaire avec outil.cmd et outil.exe (vide), supprimé après le test. */
function makeDir(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frst-program-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, "outil.cmd"), "@echo off\r\necho ok\r\n");
    fs.writeFileSync(path.join(dir, "outil.exe"), "");
    return dir;
}

const samePath = (actual, expected) =>
    assert.equal(String(actual).toLowerCase(), expected.toLowerCase());

test("getEnv ignore la casse du nom", () => {
    assert.equal(getEnv({ Path: "C:\\bin" }, "PATH"), "C:\\bin");
    assert.equal(getEnv({ PATH: "x" }, "PATHEXT"), undefined);
});

test("filterEnv retire les variables sensibles et FS_*", () => {
    const env = {
        HOME: "h",
        PATH: "p",
        GITHUB_TOKEN: "t",
        api_key: "k",
        DB_PASSWORD: "x",
        FS_ROOT: "r",
        fs_debug: "d"
    };
    assert.deepEqual(filterEnv(env), { HOME: "h", PATH: "p", NO_COLOR: "1" });
});

test("resolveProgram lance npm et npx via node", windowsOnly, () => {
    const npm = resolveProgram("npm", ["test"], process.cwd(), process.env);
    assert.equal(npm.file, process.execPath);
    assert.equal(path.basename(npm.args[0]), "npm-cli.js");
    assert.deepEqual(npm.args.slice(1), ["test"]);
    assert.equal(npm.verbatim, false);

    const npx = resolveProgram("NPX", [], process.cwd(), process.env);
    assert.equal(npx.file, process.execPath);
    assert.equal(path.basename(npx.args[0]), "npx-cli.js");
});

test("findOnWindows suit l'ordre de PATHEXT", windowsOnly, t => {
    const dir = makeDir(t);

    samePath(findOnWindows("outil", dir, { PATH: dir, PATHEXT: ".EXE;.CMD" }), path.join(dir, "outil.exe"));
    samePath(findOnWindows("outil", dir, { PATH: dir, PATHEXT: ".CMD;.EXE" }), path.join(dir, "outil.cmd"));
    samePath(findOnWindows("outil.cmd", dir, { PATH: dir, PATHEXT: ".EXE" }), path.join(dir, "outil.cmd"));
    assert.equal(findOnWindows("absent", dir, { PATH: dir, PATHEXT: ".EXE;.CMD" }), null);
});

test("findOnWindows cherche dans cwd si le nom contient un séparateur", windowsOnly, t => {
    const dir = makeDir(t);

    samePath(findOnWindows(".\\outil", dir, { PATH: "", PATHEXT: ".CMD" }), path.join(dir, "outil.cmd"));
    assert.equal(findOnWindows("outil", dir, { PATH: "", PATHEXT: ".CMD" }), null);
});

test("resolveProgram passe un .cmd par cmd.exe", windowsOnly, t => {
    const dir = makeDir(t);
    const env = { PATH: dir, PATHEXT: ".CMD", COMSPEC: "cmd.exe" };
    const r = resolveProgram("outil", ["a b", "c"], dir, env);

    assert.equal(r.file, "cmd.exe");
    assert.equal(r.verbatim, true);
    assert.equal(r.args.length, 4);
    assert.deepEqual(r.args.slice(0, 3), ["/d", "/s", "/c"]);
    assert.match(r.args[3], /^".*outil\.cmd.* "a b" c"$/i);
});

test("resolveProgram refuse les métacaractères cmd.exe pour un .cmd", windowsOnly, t => {
    const dir = makeDir(t);
    const env = { PATH: dir, PATHEXT: ".CMD", COMSPEC: "cmd.exe" };

    for (const arg of ["a&b", "%PATH%", "x|y", 'a"b', "^", "!v!", "<f", ">f"]) {
        assert.throws(() => resolveProgram("outil", [arg], dir, env), /cmd\.exe/, arg);
    }
});

test("resolveProgram laisse un .exe et un programme introuvable tels quels", windowsOnly, t => {
    const dir = makeDir(t);
    const env = { PATH: dir, PATHEXT: ".EXE" };

    const exe = resolveProgram("outil", ["a&b"], dir, env);
    samePath(exe.file, path.join(dir, "outil.exe"));
    assert.deepEqual(exe.args, ["a&b"]);
    assert.equal(exe.verbatim, false);

    assert.deepEqual(
        resolveProgram("absent", ["x"], dir, env),
        { file: "absent", args: ["x"], verbatim: false }
    );
});
