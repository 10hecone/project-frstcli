"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { TASKS, BUG, parseArgs, summarize } = require("../scripts/bench-conso");

test("bench-conso : --run exige des modèles et une variante", () => {
    assert.throws(() => parseArgs(["--run"]), /--models/);
    assert.throws(() => parseArgs(["--run", "--models=opus"]), /--variant/);
    assert.throws(() => parseArgs(["--variant=autre"]), /Variante inconnue/);
    const args = parseArgs(["--run", "--models=opus 5.5,sonnet 5.5", "--variant=avant", "--repeat=3"]);
    assert.deepEqual(args.models, ["opus 5.5", "sonnet 5.5"]);
    assert.equal(args.repeat, 3);
});

test("bench-conso : le bug injecté correspond encore au code", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", BUG.file), "utf8");
    assert.ok(source.includes(BUG.from));
});

test("bench-conso : moyennes sur les sessions complètes seulement", () => {
    const task = (ok, inputTokens) => ({ ok, inputTokens, requests: 2, reported: 2, ms: 1000, chars: 10, cachedTokens: 0, outputTokens: 5 });
    const full = n => TASKS.map(() => task(true, n));
    const summary = summarize([
        { model: "M", variant: "avant", tasks: full(100) },
        { model: "M", variant: "avant", tasks: full(300) },
        { model: "M", variant: "avant", tasks: [task(false, 9999)] }
    ]);
    assert.equal(summary.length, 1);
    assert.equal(summary[0].sessions, 2);
    assert.equal(summary[0].inputTokens, 200 * TASKS.length);
    assert.equal(summary[0].success, 1);
});
