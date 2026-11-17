"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { runProcess, filterEnv, createCollector } = require("../src/tools/command/runner");

test("collecteur : les lignes d'erreur du milieu omis sont conservées", () => {
    const collector = createCollector();
    const filler = (n) => Array.from({ length: n }, (_, i) => `compilation du module ${i}`).join("\n") + "\n";
    collector.push(filler(1000));
    collector.push("src/a.ts(12,5): error TS2322: Type 'string' is not assignable\n");
    collector.push(filler(1000));
    collector.push("Terminé.\n");

    const { output, truncated } = collector.render();
    assert.equal(truncated, true);
    assert.match(output, /lignes d'erreur de cette partie :\]\nsrc\/a\.ts\(12,5\): error TS2322/);
    assert.match(output, /Terminé\.\n?$/);
});

test("collecteur : sans erreur au milieu, marqueur simple", () => {
    const collector = createCollector();
    collector.push(Array.from({ length: 3000 }, (_, i) => `ligne ${i}`).join("\n"));
    const { output } = collector.render();
    assert.match(output, /\[\.\.\. \d+ caractères omis \.\.\.\]/);
    assert.doesNotMatch(output, /lignes d'erreur/);
});

const NODE = process.execPath;

test("filterEnv retire les variables sensibles", () => {
    const env = filterEnv({
        PATH: "p",
        HOME: "h",
        API_KEY: "k",
        FS_SESSION: "s",
        MY_SECRET: "x",
        GITHUB_TOKEN: "t",
        DB_PASSWORD: "w"
    });

    assert.deepEqual(env, { PATH: "p", HOME: "h", NO_COLOR: "1" });
});

test("runProcess renvoie la sortie et le code de sortie", async () => {
    const ok = await runProcess({ file: NODE, args: ["-e", "process.stdout.write('bonjour')"] });
    assert.equal(ok.exit_code, 0);
    assert.equal(ok.timed_out, false);
    assert.equal(ok.truncated, false);
    assert.match(ok.output, /bonjour/);

    const failed = await runProcess({ file: NODE, args: ["-e", "process.exit(3)"] });
    assert.equal(failed.exit_code, 3);
});

test("runProcess transmet les lignes à onLine", async () => {
    const lines = [];
    await runProcess({
        file: NODE,
        args: ["-e", "console.log('un'); console.log('deux')"],
        onLine: line => lines.push(line)
    });

    assert.deepEqual(lines, ["un", "deux"]);
});

test("runProcess tronque une sortie trop longue", async () => {
    const result = await runProcess({
        file: NODE,
        args: ["-e", "process.stdout.write('a'.repeat(20000))"]
    });

    assert.equal(result.exit_code, 0);
    assert.equal(result.truncated, true);
    assert.match(result.output, /caractères omis/);
});

test("runProcess arrête un programme qui dépasse le délai", async () => {
    const result = await runProcess({
        file: NODE,
        args: ["-e", "setTimeout(() => {}, 30000)"],
        timeoutMs: 1000
    });

    assert.equal(result.timed_out, true);
    assert.notEqual(result.exit_code, 0);
});

test("runProcess signale un programme introuvable", async () => {
    const result = await runProcess({ file: "programme-inexistant-frstcli" });

    assert.equal(result.exit_code, null);
    assert.match(result.output, /introuvable|Lancement impossible/);

    await assert.rejects(runProcess({ file: "" }), /non vide/);
});
