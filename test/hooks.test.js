"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-data-"));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fs-hooks-"));
const previousDataDir = process.env.FS_DATA_DIR;
process.env.FS_DATA_DIR = dataDir;

const hooks = require("../src/core/hooks");

const userSettings = path.join(dataDir, "settings.json");
const projectSettings = path.join(root, ".frst", "settings.json");
fs.mkdirSync(path.join(root, "src"), { recursive: true });
fs.writeFileSync(path.join(root, "src", "a.luau"), "local x = 1\n");

function writeSettings(file, list) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ hooks: { PostToolUse: list } }));
}

function reset() {
    for (const file of [userSettings, projectSettings, path.join(dataDir, hooks.APPROVALS_FILE)]) {
        fs.rmSync(file, { force: true });
    }
}

// Faux runProcess : mémorise les appels et renvoie la sortie donnée.
function fakeRun(result = { exit_code: 0, output: "" }) {
    const calls = [];
    const run = async options => {
        calls.push(options);
        return { timed_out: false, truncated: false, ...result };
    };
    return { run, calls };
}

const quietUi = (answer = true) => {
    const questions = [];
    return {
        questions,
        confirm: async text => {
            questions.push(text);
            return answer;
        },
        warn: () => {},
        result: () => {}
    };
};

test.after(() => {
    if (previousDataDir === undefined) delete process.env.FS_DATA_DIR;
    else process.env.FS_DATA_DIR = previousDataDir;
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
});

test("normalizeSettings accepte la forme plate et la forme imbriquée de Claude Code", () => {
    const list = hooks.normalizeSettings({
        hooks: {
            PostToolUse: [
                { matcher: "edit_file", glob: "*.luau", command: "selene {file}", timeout: 30 },
                { matcher: "write_file", hooks: [{ type: "command", command: "stylua {file}" }] }
            ]
        }
    }, "user");

    assert.equal(list.length, 2);
    assert.deepEqual(list[0], {
        event: "PostToolUse", scope: "user", matcher: "edit_file", glob: "*.luau", command: "selene {file}", timeout: 30
    });
    assert.equal(list[1].command, "stylua {file}");
    assert.equal(list[1].timeout, 60);
    assert.equal(list[1].glob, null);
});

test("normalizeSettings refuse les définitions invalides", () => {
    const bad = entry => () => hooks.normalizeSettings({ hooks: { PostToolUse: [entry] } }, "user");
    assert.throws(bad({ matcher: "(", command: "selene" }), /matcher/);
    assert.throws(bad({ command: "" }), /command/);
    assert.throws(bad({ command: "a && b" }), /Opérateur shell/);
    assert.throws(bad({ hooks: [{ type: "prompt", command: "x" }] }), /type "command"/);
    assert.throws(bad({ command: "selene", timeout: -1 }), /timeout/);
});

test("matches filtre sur l'outil et le glob ; buildCommand remplace {file} argument par argument", () => {
    const [hook] = hooks.normalizeSettings({
        hooks: { PostToolUse: [{ matcher: "edit_file|write_file", glob: "*.luau", command: "selene --display-style quiet {file}" }] }
    }, "user");

    assert.equal(hooks.matches(hook, "edit_file", "src/a.luau"), true);
    assert.equal(hooks.matches(hook, "edit_file", "src/a.lua"), false);
    assert.equal(hooks.matches(hook, "run_command", "src/a.luau"), false);

    const command = hooks.buildCommand(hook, "src/mon fichier.luau");
    assert.deepEqual(command, { file: "selene", args: ["--display-style", "quiet", "src/mon fichier.luau"] });
});

test("hook utilisateur : lancé sans question, sortie ajoutée au résultat", async () => {
    reset();
    writeSettings(userSettings, [{ matcher: "edit_file|write_file", glob: "*.luau", command: "selene {file}", timeout: 5 }]);
    const { run, calls } = fakeRun({ exit_code: 1, output: "src/a.luau:1:7: warning[unused_variable]: x\n" });
    const ui = quietUi();

    const { runs, text } = await hooks.runPostToolUse("edit_file", { path: "src/a.luau", changed: true }, { root, ui, run });

    assert.equal(ui.questions.length, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].file, "selene");
    assert.deepEqual(calls[0].args, ["src/a.luau"]);
    assert.equal(calls[0].timeoutMs, 5000);
    assert.equal(runs[0].status, "failed");
    assert.match(text, /^\[hook PostToolUse\] selene src\/a\.luau : échec \(code 1\)/);
    assert.match(text, /unused_variable/);
});

test("aucun hook pour un autre outil, une écriture refusée ou un fichier inchangé", async () => {
    reset();
    writeSettings(userSettings, [{ command: "selene {file}" }]);
    const { run, calls } = fakeRun();
    const options = { root, ui: quietUi(), run };

    assert.equal((await hooks.runPostToolUse("read_file", { path: "src/a.luau" }, options)).text, "");
    assert.equal((await hooks.runPostToolUse("edit_file", { path: "src/a.luau", denied: true }, options)).text, "");
    assert.equal((await hooks.runPostToolUse("write_file", { path: "src/a.luau", changed: false }, options)).text, "");
    assert.equal(calls.length, 0);
});

test("hook du projet : ignoré hors dossier de confiance, puis approuvé une seule fois", async () => {
    reset();
    writeSettings(projectSettings, [{ glob: "*.luau", command: "selene {file}" }]);
    const result = { path: "src/a.luau", changed: true };

    const untrusted = fakeRun();
    const ignored = await hooks.runPostToolUse("edit_file", result, {
        root, ui: quietUi(), run: untrusted.run, isTrusted: async () => false
    });
    assert.equal(untrusted.calls.length, 0);
    assert.equal(ignored.runs[0].status, "skipped");
    assert.equal(ignored.text, "");

    const { run, calls } = fakeRun();
    const ui = quietUi(true);
    const options = { root, ui, run, isTrusted: async () => true };
    await hooks.runPostToolUse("edit_file", result, options);
    await hooks.runPostToolUse("edit_file", result, options);

    assert.equal(ui.questions.length, 1);
    assert.match(ui.questions[0], /selene \{file\}/);
    assert.equal(calls.length, 2);
});

test("hook du projet refusé : mémorisé, plus de question ni d'exécution", async () => {
    reset();
    writeSettings(projectSettings, [{ command: "selene {file}" }]);
    const { run, calls } = fakeRun();
    const ui = quietUi(false);
    const options = { root, ui, run, isTrusted: async () => true };
    const result = { path: "src/a.luau", changed: true };

    await hooks.runPostToolUse("write_file", result, options);
    const second = await hooks.runPostToolUse("write_file", result, options);

    assert.equal(ui.questions.length, 1);
    assert.equal(calls.length, 0);
    assert.equal(second.runs[0].status, "skipped");
});

test("un programme interdit par judge() n'est jamais lancé", async () => {
    reset();
    writeSettings(userSettings, [{ command: "node -e process.exit(0)" }]);
    const { run, calls } = fakeRun();

    const { runs, text } = await hooks.runPostToolUse("edit_file", { path: "src/a.luau", changed: true }, { root, ui: quietUi(), run });

    assert.equal(calls.length, 0);
    assert.equal(runs[0].status, "denied");
    assert.match(text, /refusé/);
});

test("un fichier de configuration invalide est signalé et ignoré", async () => {
    reset();
    fs.writeFileSync(userSettings, "{ pas du json");
    const warnings = [];
    const ui = { ...quietUi(), warn: text => warnings.push(text) };

    const { runs } = await hooks.runPostToolUse("edit_file", { path: "src/a.luau", changed: true }, { root, ui, run: fakeRun().run });

    assert.equal(runs.length, 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Hooks ignorés/);
});
