"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Avant tout require du projet : la config lit l'environnement au chargement.
process.env.FS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fscli-data-"));

const { state, resetConversation } = require("../src/state");
const api = require("../src/api/api");
const { setUiBackend } = require("../src/ui-bridge");
const subagent = require("../src/agent/subagent");
const { TOOLS } = require("../src/tools/tools");
const delegate = require("../src/tools/delegate");

/** Remplace subagent.runSubagent ; restore() remet l'original. */
function mockRun(impl) {
    const original = subagent.runSubagent;
    const calls = [];
    subagent.runSubagent = async opts => {
        calls.push(opts);
        return impl(opts, calls.length);
    };
    return {
        calls,
        restore() {
            subagent.runSubagent = original;
        }
    };
}

function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
}

const tick = () => new Promise(r => setImmediate(r));

test("delegate : refuse une liste vide, trop longue ou non conforme", async () => {
    await assert.rejects(delegate.run({ tasks: [] }), /1 à 3 consignes/);
    await assert.rejects(delegate.run({ tasks: ["a", "b", "c", "d"] }), /1 à 3 consignes/);
    await assert.rejects(delegate.run({}), /1 à 3 consignes/);
    await assert.rejects(delegate.run({ tasks: "cherche X" }), /1 à 3 consignes/);
    await assert.rejects(delegate.run({ tasks: ["ok", "   "] }), /tasks\[1\] doit être un texte non vide/);
    await assert.rejects(delegate.run({ tasks: [42] }), /tasks\[0\]/);
    await assert.rejects(
        delegate.run({ tasks: ["x".repeat(delegate.MAX_TASK_CHARS + 1)] }),
        /caractères au maximum/
    );
    assert.throws(() => delegate.check({ tasks: [] }), /1 à 3 consignes/);
    assert.doesNotThrow(() => delegate.check({ tasks: ["a"] }));
});

test("delegate : est enregistré dans le registre des outils", () => {
    assert.ok(TOOLS.delegate);
    assert.equal(typeof TOOLS.delegate.run, "function");
    assert.equal(delegate.MAX_SUBAGENTS, 3);
    assert.equal(delegate.describe({ tasks: ["a", "b"] }), "2 sous-agent(s)");
});

test("delegate : lance les sous-agents en parallèle et garde l'ordre", { concurrency: false }, async () => {
    const gates = [deferred(), deferred(), deferred()];
    const mock = mockRun(async (opts, n) => {
        await gates[n - 1].promise;
        return { status: "done", summary: `résumé de ${opts.task}`, turns: n, deleted: true };
    });

    try {
        const pending = delegate.run({ tasks: [" A ", "B", "C"] });
        await tick();

        // Les trois sous-agents ont démarré avant qu'aucun ne termine.
        assert.equal(mock.calls.length, 3);
        gates[2].resolve();
        gates[0].resolve();
        gates[1].resolve();

        const out = await pending;
        assert.equal(out.changed, false);
        assert.equal(out.message, "Sous-agents : 3 terminé(s) sur 3.");
        assert.deepEqual(out.results.map(r => r.task), ["A", "B", "C"]);
        assert.deepEqual(out.results.map(r => r.summary), ["résumé de A", "résumé de B", "résumé de C"]);
        assert.ok(out.results.every(r => r.ok && r.status === "done"));
    } finally {
        mock.restore();
    }
});

test("delegate : un échec n'empêche pas les autres", { concurrency: false }, async () => {
    const mock = mockRun(async opts => {
        if (opts.task === "plante") throw new Error("API indisponible");
        if (opts.task === "erreur") {
            return { status: "error", summary: "", turns: 1, deleted: true, error: "réponse illisible" };
        }
        return { status: "done", summary: "ok", turns: 2, deleted: true };
    });

    try {
        const out = await delegate.run({ tasks: ["plante", "réussit", "erreur"] });

        assert.equal(out.message, "Sous-agents : 1 terminé(s) sur 3.");
        assert.deepEqual(out.results[0], {
            task: "plante", ok: false, status: "error", summary: "", turns: 0, error: "API indisponible"
        });
        assert.equal(out.results[1].ok, true);
        assert.equal(out.results[1].summary, "ok");
        assert.equal(out.results[2].ok, false);
        assert.equal(out.results[2].status, "error");
        assert.equal(out.results[2].error, "réponse illisible");
    } finally {
        mock.restore();
    }
});

test("delegate : transmet le signal et numérote onTurn", { concurrency: false }, async () => {
    const controller = new AbortController();
    const seen = [];
    const mock = mockRun(async opts => {
        opts.onTurn({ turn: 1 });
        return { status: "done", summary: "s", turns: 1, deleted: true };
    });

    try {
        await delegate.run({ tasks: ["a", "b"] }, { signal: controller.signal, onTurn: info => seen.push(info) });

        assert.ok(mock.calls.every(c => c.signal === controller.signal));
        assert.deepEqual(
            seen.sort((x, y) => x.index - y.index),
            [{ index: 0, task: "a", turn: 1 }, { index: 1, task: "b", turn: 1 }]
        );
    } finally {
        mock.restore();
    }
});

test("delegate : limite globale de 3 sous-agents simultanés", { concurrency: false }, async () => {
    const gate = deferred();
    const mock = mockRun(async () => {
        await gate.promise;
        return { status: "done", summary: "s", turns: 1, deleted: true };
    });

    try {
        const first = delegate.run({ tasks: ["a", "b"] });
        await tick();

        await assert.rejects(
            delegate.run({ tasks: ["c", "d"] }),
            /Déjà 2 sous-agent\(s\) en cours \(maximum 3\)/
        );

        gate.resolve();
        await first;

        // Le compteur est libéré : trois nouveaux sous-agents passent.
        const out = await delegate.run({ tasks: ["x", "y", "z"] });
        assert.equal(out.results.length, 3);
    } finally {
        mock.restore();
    }
});

test("delegate : un sous-agent ne peut pas déléguer", { concurrency: false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fscli-deleg-"));
    resetConversation();
    setUiBackend(null);
    state.workspace = dir;

    const original = { requestModel: api.requestModel, deleteChat: api.deleteChat };
    const messages = [];
    const answers = [
        JSON.stringify({ type: "tool", name: "delegate", args: { tasks: ["x"] }, reason: "déléguer" }),
        JSON.stringify({ type: "final", message: "fini" })
    ];
    api.requestModel = async (message, options) => {
        messages.push(message);
        options.chat.id = "sub-1";
        return answers.shift();
    };
    api.deleteChat = async () => true;

    try {
        const out = await subagent.runSubagent({ task: "Essaie de déléguer" });

        assert.equal(out.status, "done");
        assert.equal(out.summary, "fini");
        assert.equal(messages.length, 2);
        assert.match(messages[1], /lecture seule : delegate refusé/);
    } finally {
        api.requestModel = original.requestModel;
        api.deleteChat = original.deleteChat;
        state.workspace = null;
    }
});
