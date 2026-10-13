"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
    MAX_SEGMENTS,
    splitPipeline,
    executePipeline,
    changeDirectory,
    resolveStartDir
} = require("../src/tools/command/pipeline");
const { CommandParseError } = require("../src/tools/command/parse");
const { runProcess } = require("../src/tools/command/runner");
const { ui } = require("../src/cli/ui");
const { state } = require("../src/state");
const { runCommand } = require("../src/tools/command/index");

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "fs-pipe-"));
fs.mkdirSync(path.join(workspace, "sub"));

test.after(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
});

test("splitPipeline découpe && || ; |", () => {
    const segments = splitPipeline("a && b || c ; d | e");
    assert.deepEqual(segments.map(s => s.file), ["a", "b", "c", "d", "e"]);
    assert.deepEqual(segments.map(s => s.op), ["&&", "||", ";", "|", null]);
});

test("splitPipeline garde les opérateurs entre guillemets et accepte un ; final", () => {
    const quoted = splitPipeline('echo "a && b | c"');
    assert.equal(quoted.length, 1);
    assert.deepEqual(quoted[0].args, ["a && b | c"]);
    const trailing = splitPipeline("node --version ;");
    assert.equal(trailing.length, 1);
    assert.equal(trailing[0].op, null);
});

test("splitPipeline limite le nombre de segments", () => {
    const ok = Array.from({ length: MAX_SEGMENTS }, () => "a").join(" && ");
    assert.equal(splitPipeline(ok).length, MAX_SEGMENTS);
    const tooMany = Array.from({ length: MAX_SEGMENTS + 1 }, () => "a").join(" && ");
    assert.throws(() => splitPipeline(tooMany), CommandParseError);
});

test("splitPipeline refuse & seul, substitutions, variables et redirections vers un fichier", () => {
    const refused = [
        "a & b",
        "echo $(whoami)",
        'echo "$(whoami)"',
        "echo `whoami`",
        "echo $HOME",
        "echo %PATH%",
        "echo a > out.txt",
        "echo a >> out.txt",
        "node x 2> err.txt",
        "sort < in.txt",
        "a &&",
        "&& a",
        "a | | b"
    ];
    for (const line of refused) {
        assert.throws(() => splitPipeline(line), CommandParseError, line);
    }
});

test("splitPipeline accepte 2>&1, >nul et >/dev/null", () => {
    const [merged] = splitPipeline("node x 2>&1");
    assert.deepEqual(merged.args, ["x"]);
    assert.equal(merged.stderrToStdout, true);

    const [nul] = splitPipeline("node x >nul");
    assert.deepEqual(nul.args, ["x"]);
    assert.equal(nul.discardStdout, true);

    const [both] = splitPipeline("node x >/dev/null 2>&1");
    assert.deepEqual(both.args, ["x"]);
    assert.equal(both.discardStdout, true);
    assert.equal(both.discardStderr, true);
});

test("executePipeline suit && || ; et transmet la sortie d'un |", async () => {
    const codes = { a: 1, b: 0, c: 0, d: 0, e: 3 };
    const calls = [];
    const run = async (segment, { input, pipeStdout }) => {
        calls.push({ file: segment.file, input, pipeStdout });
        return {
            exit_code: codes[segment.file],
            signal: null,
            timed_out: false,
            interrupted: false,
            duration_ms: 1,
            output: "",
            truncated: false,
            stdout: segment.file.toUpperCase()
        };
    };
    const result = await executePipeline(splitPipeline("a && b || c ; d | e"), { cwd: workspace, workspace, run });

    assert.deepEqual(calls.map(c => c.file), ["a", "c", "d", "e"]);
    assert.equal(result.entries[1].skipped, true);
    assert.equal(calls[2].pipeStdout, true);
    assert.equal(calls[3].input, "D");
    assert.deepEqual(result.pipe_status, [0, 3]);
    assert.equal(result.last.exit_code, 3);
});

test("cd interne : reste dans le projet", () => {
    const moved = changeDirectory({ file: "cd", args: ["sub"] }, workspace, workspace);
    assert.equal(moved.ok, true);
    assert.equal(moved.cwd, path.join(workspace, "sub"));
    assert.equal(changeDirectory({ file: "cd", args: [".."] }, workspace, workspace).ok, false);
    assert.equal(changeDirectory({ file: "cd", args: ["absent"] }, workspace, workspace).ok, false);
    assert.equal(changeDirectory({ file: "cd", args: [] }, path.join(workspace, "sub"), workspace).cwd, workspace);
});

test("resolveStartDir : paramètre cwd validé, state.cwd invalide ignoré", () => {
    assert.equal(resolveStartDir("sub", null, workspace), path.join(workspace, "sub"));
    assert.throws(() => resolveStartDir("..", null, workspace));
    assert.equal(resolveStartDir(undefined, os.tmpdir(), workspace), workspace);
});

test("runProcess écrit input sur stdin et capture stdout", async () => {
    const result = await runProcess({
        file: process.execPath,
        args: ["-e", "process.stdin.pipe(process.stdout)"],
        cwd: workspace,
        input: "bonjour",
        captureStdout: true
    });
    assert.equal(result.exit_code, 0);
    assert.equal(result.stdout, "bonjour");
});

test("runCommand : cd puis commande, champs cwd, segments et pipe_status", async () => {
    const saved = {
        commandLine: ui.commandLine,
        onInterrupt: ui.onInterrupt,
        workspace: state.workspace,
        cwd: state.cwd
    };
    ui.commandLine = () => {};
    ui.onInterrupt = () => () => {};
    state.workspace = workspace;
    state.cwd = undefined;
    try {
        const result = await runCommand({ command: "cd sub && node --version" });
        assert.equal(result.exit_code, 0);
        assert.equal(result.cwd, "sub");
        assert.equal(result.segments.length, 2);
        assert.deepEqual(result.pipe_status, [0]);
        assert.equal(state.cwd, path.join(workspace, "sub"));

        const denied = await runCommand({ command: "node --version && rm x" });
        assert.equal(denied.denied, true);
    } finally {
        ui.commandLine = saved.commandLine;
        ui.onInterrupt = saved.onInterrupt;
        state.workspace = saved.workspace;
        state.cwd = saved.cwd;
    }
});
