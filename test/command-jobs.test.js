"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createJobManager, MAX_JOBS, statusMessage } = require("../src/tools/command/jobs");
const { runProcess } = require("../src/tools/command/runner");

// Job factice : écrit des lignes, puis attend kill() ou finish().
function fakeLaunch(lines = []) {
    const control = {};
    const launch = ({ onLine, signalHandle }) => new Promise(resolve => {
        for (const line of lines) onLine(line);
        control.write = (text) => onLine(text);
        control.finish = (code) => resolve({ exit_code: code, signal: null, timed_out: false });
        signalHandle.kill = () => resolve({ exit_code: null, signal: "SIGTERM", timed_out: false });
    });
    return { launch, control };
}

test("jobs : au maximum 3 jobs en cours", async () => {
    assert.equal(MAX_JOBS, 3);
    const manager = createJobManager();
    const fakes = [fakeLaunch(), fakeLaunch(), fakeLaunch()];
    const ids = fakes.map((fake, i) => manager.start({ command: `cmd ${i}`, launch: fake.launch }).id);
    assert.deepEqual(ids, ["job-1", "job-2", "job-3"]);
    assert.equal(manager.runningCount(), 3);

    assert.throws(() => manager.start({ command: "cmd 4", launch: fakeLaunch().launch }), /maximum 3/);

    fakes[0].control.finish(0);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(manager.get("job-1").status, "done");
    const fourth = manager.start({ command: "cmd 4", launch: fakeLaunch().launch });
    assert.equal(fourth.id, "job-4");
    await manager.stopAll();
    assert.equal(manager.runningCount(), 0);
});

test("jobs : job_output ne renvoie que la sortie nouvelle", async () => {
    const manager = createJobManager();
    const fake = fakeLaunch(["ligne A", "ligne B"]);
    const { id } = manager.start({ command: "serveur", launch: fake.launch });

    const first = manager.output(id);
    assert.equal(first.status, "running");
    assert.match(first.output, /ligne A/);
    assert.match(first.output, /ligne B/);

    const empty = manager.output(id);
    assert.doesNotMatch(empty.output, /ligne A/);

    fake.control.write("ligne C");
    const next = manager.output(id);
    assert.match(next.output, /ligne C/);
    assert.doesNotMatch(next.output, /ligne B/);

    fake.control.finish(1);
    await new Promise(resolve => setImmediate(resolve));
    const done = manager.output(id);
    assert.equal(done.status, "failed");
    assert.equal(done.exit_code, 1);
});

test("jobs : tampon limité, missed_chars signale la perte", () => {
    const manager = createJobManager({ maxBufferChars: 20 });
    const fake = fakeLaunch(["0123456789", "abcdefghij", "KLMNOPQRST"]);
    const { id } = manager.start({ command: "bavard", launch: fake.launch });
    const out = manager.output(id);
    assert.ok(out.missed_chars > 0);
    assert.equal(out.truncated, true);
    assert.match(out.output, /KLMNOPQRST/);
    fake.control.finish(0);
});

test("jobs : job_stop appelle kill et marque le job arrêté", async () => {
    const manager = createJobManager();
    const fake = fakeLaunch(["démarré"]);
    const { id } = manager.start({ command: "watch", launch: fake.launch });
    const stopped = await manager.stop(id);
    assert.equal(stopped.status, "stopped");
    assert.match(statusMessage(stopped), /arrêté/);
    // Un second arrêt ne lève pas d'erreur.
    assert.equal((await manager.stop(id)).status, "stopped");
});

test("jobs : id inconnu et launch qui échoue", async () => {
    const manager = createJobManager();
    assert.throws(() => manager.output("job-99"), /Job inconnu/);
    const { id } = manager.start({ command: "x", launch: () => { throw new Error("introuvable"); } });
    await new Promise(resolve => setImmediate(resolve));
    const out = manager.output(id);
    assert.equal(out.status, "failed");
    assert.match(out.output, /introuvable/);
});

test("jobs : vrai processus node arrêté par job_stop", async () => {
    const manager = createJobManager();
    const { id } = manager.start({
        command: "node tick",
        launch: ({ onLine, signalHandle }) => runProcess({
            file: process.execPath,
            args: ["-e", "setInterval(() => console.log('tick'), 50)"],
            cwd: process.cwd(),
            timeoutMs: 20000,
            onLine,
            signalHandle
        })
    });
    let out = { output: "" };
    for (let i = 0; i < 40 && !/tick/.test(out.output); i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        out = manager.output(id);
    }
    assert.match(out.output, /tick/);
    const stopped = await manager.stop(id);
    assert.equal(stopped.status, "stopped");
    assert.equal(manager.runningCount(), 0);
});
