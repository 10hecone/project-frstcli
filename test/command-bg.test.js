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
const { judge, isWindowsSwitch } = require("../src/tools/command/policy");
const { decide, suggestPrefix } = require("../src/tools/command/permissions");
const jobs = require("../src/tools/command/jobs");
const { runCommand, getPermissionStore } = require("../src/tools/command/index");

const saved = { workspace: state.workspace };

let answers = [];
let questions = 0;
let lastQuestion = null;
let lastPrefix = null;

function verdict(file, args = []) {
    return judge({ file, args, cwd: ".", workspace });
}

test.before(async () => {
    // Faux serveur : affiche une ligne puis attend qu'on l'arrête.
    fs.writeFileSync(path.join(workspace, "server.js"), "console.log('serveur pret');\nsetInterval(() => {}, 1000);\n");
    fs.writeFileSync(path.join(workspace, "build.ps1"), "Write-Output 'build'\n");
    fs.writeFileSync(path.join(workspace, "big.ps1"), "#".repeat(20001));
    state.workspace = workspace;
    await memory.open(workspace);
    const cli = getUiBackend();
    setUiBackend({
        ...cli,
        askCommand: async (question, prefixText) => {
            questions += 1;
            lastQuestion = question;
            lastPrefix = prefixText;
            return answers.shift() ?? "n";
        },
        info() {},
        warn() {},
        commandLine() {},
        onInterrupt: () => () => {}
    });
});

test.after(async () => {
    await jobs.manager.stopAll();
    setUiBackend(null);
    state.workspace = saved.workspace;
    if (previousDataDir === undefined) delete process.env.FS_DATA_DIR;
    else process.env.FS_DATA_DIR = previousDataDir;
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Politique
// ---------------------------------------------------------------------------

test("policy : start refusé avec un conseil bg-run", () => {
    const result = verdict("start", ["/min", "rojo", "serve"]);
    assert.equal(result.level, "deny");
    assert.match(result.reason, /bg-run <commande>/);
});

test("policy : options Windows longues (/min, /wait) mais un chemin existant reste un chemin", () => {
    assert.equal(isWindowsSwitch("/s", workspace), true);
    assert.equal(isWindowsSwitch("/?", workspace), true);
    assert.equal(isWindowsSwitch("/min", workspace), true);
    assert.equal(isWindowsSwitch("/wait", workspace), true);
    assert.equal(isWindowsSwitch("/abcdefghijk", workspace), false);
    assert.equal(isWindowsSwitch("/src/a", workspace), false);
    const existing = process.platform === "win32" ? "/users" : "/tmp";
    assert.equal(isWindowsSwitch(existing, workspace), false);
});

test("policy : PowerShell -Command demande à chaque fois et montre le script", () => {
    const result = verdict("PowerShell.EXE", ["-NoProfile", "-Command", "Get-ChildItem", "src"]);
    assert.equal(result.level, "ask");
    assert.equal(result.alwaysAsk, true);
    assert.equal(result.script, "Get-ChildItem src");
    assert.equal(verdict("pwsh", ["-nop", "-c", "Get-Date"]).level, "ask");
    assert.equal(verdict("pwsh", ["-ExecutionPolicy", "Bypass", "-c", "Get-Date"]).level, "ask");
});

test("policy : PowerShell encodé, interactif, NoExit ou script illisible refusé", () => {
    for (const args of [
        ["-EncodedCommand", "eAA="],
        ["-enc", "eAA="],
        ["-e", "eAA="],
        ["-EncodedArguments", "eAA="],
        ["-NoExit", "-Command", "x"],
        ["-Command", "-"],
        ["-Command"],
        [],
        ["script.ps1"],
        ["-WindowStyle", "Hidden", "-c", "x"],
        ["-File", "../x.ps1"],
        ["-File", ".env"],
        ["-File", "absent.ps1"],
        ["-File", "big.ps1"]
    ]) {
        assert.equal(verdict("powershell", args).level, "deny", args.join(" "));
    }
});

test("policy : PowerShell -File lit le script pour le montrer", () => {
    const result = verdict("powershell", ["-NoProfile", "-File", "build.ps1", "release"]);
    assert.equal(result.level, "ask");
    assert.equal(result.alwaysAsk, true);
    assert.match(result.script, /# build\.ps1 release/);
    assert.match(result.script, /Write-Output 'build'/);
});

test("policy : bg-run juge la commande lancée, bg-output et bg-stop sont sûrs", () => {
    assert.equal(verdict("bg-run", ["rojo", "serve"]).level, "ask");
    assert.equal(verdict("bg-run", ["ls"]).level, "ask");
    assert.equal(verdict("bg-run", ["rm", "-rf", "src"]).level, "deny");
    assert.equal(verdict("bg-run", ["cat", "../x"]).level, "deny");
    assert.equal(verdict("bg-run", []).level, "deny");
    assert.equal(verdict("bg-run", ["--help"]).level, "deny");
    assert.equal(verdict("bg-run", ["bg-run", "x"]).level, "deny");
    assert.equal(verdict("bg-run", ["mcp-call", "list"]).level, "deny");
    assert.equal(verdict("bg-run", ["start", "x"]).level, "deny");
    assert.equal(verdict("bg-run", ["pwsh", "-c", "x"]).alwaysAsk, true);

    assert.equal(verdict("bg-output", []).level, "safe");
    assert.equal(verdict("bg-output", ["job-2"]).level, "safe");
    assert.equal(verdict("bg-stop", ["job-2"]).level, "safe");
    assert.equal(verdict("bg-stop", []).level, "deny");
    assert.equal(verdict("bg-stop", ["job-1", "job-2"]).level, "deny");
    assert.equal(verdict("bg-output", ["../x"]).level, "deny");
});

// ---------------------------------------------------------------------------
// Règles
// ---------------------------------------------------------------------------

test("permissions : alwaysAsk ignore les règles, bg-run utilise celles de la commande lancée", () => {
    const rules = [{ prefix: ["powershell"] }, { prefix: ["rojo", "serve"] }];
    const ps = verdict("powershell", ["-c", "x"]);
    assert.equal(decide({ verdict: ps, rules, file: "powershell", args: ["-c", "x"] }), "ask");

    const bg = verdict("bg-run", ["rojo", "serve"]);
    assert.equal(decide({ verdict: bg, rules, file: "bg-run", args: ["rojo", "serve"] }), "run");
    assert.equal(decide({ verdict: bg, rules: [], file: "bg-run", args: ["rojo", "serve"] }), "ask");
    assert.deepEqual(suggestPrefix("bg-run", ["rojo", "serve", "default.project.json"]), ["rojo", "serve"]);
});

// ---------------------------------------------------------------------------
// Gestionnaire de jobs
// ---------------------------------------------------------------------------

test("jobs : changement de projet = arrêt de tous les jobs", async () => {
    const manager = jobs.createJobManager();
    const listeners = [];
    const fakeWorkspace = {
        root: "a",
        onChange(fn) {
            listeners.push(fn);
            return () => listeners.splice(listeners.indexOf(fn), 1);
        }
    };
    let killed = 0;
    manager.start({
        command: "serveur",
        launch: ({ signalHandle }) => new Promise(resolve => {
            signalHandle.kill = () => {
                killed += 1;
                resolve({ exit_code: null, signal: "SIGTERM" });
            };
        })
    });
    const off = jobs.watchWorkspace(manager, fakeWorkspace);
    listeners[0]({ root: "a" });
    assert.equal(killed, 0, "même projet : rien n'est arrêté");
    listeners[0]({ root: "b" });
    assert.equal(killed, 1);
    await manager.wait("job-1", 1000);
    assert.equal(manager.get("job-1").status, "stopped");
    off();
    assert.equal(listeners.length, 0);
});

// ---------------------------------------------------------------------------
// runCommand
// ---------------------------------------------------------------------------

test("bg-run : mélangé à une autre commande ou redirigé, refus sans question", async () => {
    questions = 0;
    for (const command of ["bg-run node server.js && node --version", "node --version | bg-output", "bg-stop job-1 2>&1"]) {
        const result = await runCommand({ command });
        assert.equal(result.denied, true, command);
        assert.equal(result.exit_code, undefined);
    }
    assert.equal(questions, 0);
});

test("bg-run : lancé après confirmation, lu avec bg-output, arrêté avec bg-stop", async () => {
    questions = 0;
    answers = ["t"];
    const started = await runCommand({ command: "bg-run node server.js" });
    assert.equal(questions, 1);
    assert.match(lastQuestion, /arrière-plan "node server\.js"/);
    assert.equal(lastPrefix, "node server.js");
    assert.equal(started.status, "running");
    assert.match(started.output, /serveur pret/);
    assert.match(started.message, /bg-output job-\d+/);
    const id = started.job_id;

    const listed = await runCommand({ command: "bg-output" });
    assert.match(listed.message, new RegExp(`${id} running`));

    const read = await runCommand({ command: `bg-output ${id}` });
    assert.equal(read.status, "running");
    assert.equal(read.output, "");

    const stopped = await runCommand({ command: `bg-stop ${id}` });
    assert.equal(stopped.status, "stopped");
    assert.equal(questions, 1, "bg-output et bg-stop sans question");

    // Règle « node server.js » enregistrée : le prochain bg-run ne pose plus de question.
    const rules = JSON.stringify(await getPermissionStore().list());
    assert.match(rules, /"node server\.js"/);
    const again = await runCommand({ command: "bg-run node server.js" });
    assert.equal(questions, 1);
    await runCommand({ command: `bg-stop ${again.job_id}` });
});

test("bg-output / bg-stop : refus pour un job qui n'a pas été lancé avec bg-run", async () => {
    const job = jobs.manager.start({
        command: "client",
        launch: ({ signalHandle }) => new Promise(resolve => {
            signalHandle.kill = () => resolve({ exit_code: null, signal: "SIGTERM" });
        })
    });
    for (const command of [`bg-output ${job.id}`, `bg-stop ${job.id}`]) {
        const result = await runCommand({ command });
        assert.equal(result.denied, true, command);
        assert.match(result.message, /non lancé avec bg-run/);
    }
    assert.equal(jobs.manager.get(job.id).status, "running");
    await jobs.manager.stop(job.id);
});

test("PowerShell : question avec le script complet, sans réponse « toujours »", async () => {
    questions = 0;
    answers = ["t"];
    const result = await runCommand({ command: "powershell -NoProfile -Command 'Get-Date'" });
    assert.equal(questions, 1);
    assert.match(lastQuestion, /Lancer PowerShell dans le projet/);
    assert.match(lastQuestion, /Script complet :\nGet-Date/);
    assert.equal(lastPrefix, "");
    // « t » vaut « o » : la commande est lancée (ou introuvable hors Windows), aucune règle.
    assert.notEqual(result.denied, true);
    const rules = JSON.stringify(await getPermissionStore().list());
    assert.doesNotMatch(rules, /powershell/);
});
