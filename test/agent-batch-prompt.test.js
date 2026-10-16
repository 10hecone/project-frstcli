"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildFollowUpPrompt } = require("../src/agent/prompt");
const { CONFIG } = require("../src/config");

test("le message suite garde tous les résultats d'un lot, chacun tronqué à sa part", () => {
    const big = "x".repeat(CONFIG.maxObservationChars);
    const paths = ["a.js", "b.js", "c.js"];
    const results = paths.map(p => ({
        tool: "read_file",
        args: { path: p },
        ok: true,
        result: { path: p, content: big }
    }));

    const prompt = buildFollowUpPrompt({
        lastObservation: { tool: "batch", args: { calls: results.length }, ok: true, result: { results } },
        turn: 2,
        maxTurns: 15
    });

    for (const p of paths) {
        assert.ok(prompt.includes(`\"path\":\"${p}\"`), `résultat manquant : ${p}`);
    }

    assert.equal((prompt.match(/truncated_in_prompt/g) || []).length, paths.length);
    assert.ok(!prompt.includes("...[tronqué,"), "le JSON du lot ne doit pas être coupé en entier");
});
