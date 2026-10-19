"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Avant tout require du projet : la config lit l'environnement au chargement.
process.env.FS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fscli-data-"));

const { CONFIG } = require("../src/config");
const { state, resetConversation } = require("../src/state");
const api = require("../src/api/api");
const { setUiBackend } = require("../src/ui-bridge");
const { runSubagent, buildSubagentPrompt, READ_ONLY_TOOLS } = require("../src/agent/subagent");

const FINAL = JSON.stringify({ type: "final", message: "Conclusion : voir src/a.js ligne 1." });

function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fscli-sub-"));
    resetConversation();
    setUiBackend(null);
    state.workspace = dir;
    state.chatIds.agent = "main-agent";
    state.chatId = "main-agent";
    return dir;
}

/** Remplace api.requestModel et api.deleteChat ; restore() remet les originaux. */
function mockApi(respond, del = async () => true) {
    const original = { requestModel: api.requestModel, deleteChat: api.deleteChat };
    const calls = [];
    const deletes = [];

    api.requestModel = async (message, options) => {
        calls.push({ message, agentId: options.agentId, options });
        return respond(message, options, calls.length);
    };
    api.deleteChat = async id => {
        deletes.push(id);
        return del(id);
    };

    return {
        calls,
        deletes,
        restore() {
            api.requestModel = original.requestModel;
            api.deleteChat = original.deleteChat;
            state.workspace = null;
        }
    };
}

test("sous-agent : lecture puis final, conversation isolée supprimée", { concurrency: false }, async () => {
    const dir = setup();
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "a.js"), "const marqueur = 42;\n");

    const answers = [
        JSON.stringify({ type: "tool", name: "read_file", args: { path: "src/a.js" }, reason: "lire" }),
        FINAL
    ];
    const mock = mockApi((message, options) => {
        options.chat.id = "sub-1";
        return answers.shift();
    });

    try {
        const out = await runSubagent({ task: "Trouve le marqueur" });

        assert.equal(out.status, "done");
        assert.equal(out.summary, "Conclusion : voir src/a.js ligne 1.");
        assert.equal(out.turns, 2);
        assert.equal(out.deleted, true);
        assert.equal(out.error, undefined);
        assert.deepEqual(mock.deletes, ["sub-1"]);

        // Modèle Haiku par défaut et conversation isolée.
        assert.equal(mock.calls[0].agentId, -2002);
        assert.equal(mock.calls[0].options.conversationMode, "agent");
        assert.ok(mock.calls[0].options.signal);
        assert.match(mock.calls[0].message, /LECTURE SEULE/);
        assert.match(mock.calls[0].message, /Trouve le marqueur/);

        // Avec un chat serveur, le second tour n'envoie que le dernier résultat.
        assert.match(mock.calls[1].message, /marqueur = 42/);
        assert.doesNotMatch(mock.calls[1].message, /LECTURE SEULE/);

        // La conversation principale n'est pas touchée.
        assert.equal(state.chatIds.agent, "main-agent");
        assert.equal(state.chatId, "main-agent");
    } finally {
        mock.restore();
    }
});

test("sous-agent : un outil d'écriture est refusé sans exécution", { concurrency: false }, async () => {
    const dir = setup();
    const answers = [
        JSON.stringify({ type: "tool", name: "write_file", args: { path: "pirate.txt", content: "x" } }),
        FINAL
    ];
    const mock = mockApi((message, options) => {
        options.chat.id = "sub-1";
        return answers.shift();
    });

    try {
        const out = await runSubagent({ task: "Écris un fichier" });

        assert.equal(out.status, "done");
        assert.equal(fs.existsSync(path.join(dir, "pirate.txt")), false);
        assert.match(mock.calls[1].message, /lecture seule : write_file refusé/);
    } finally {
        mock.restore();
    }
});

test("sous-agent : limite de tours atteinte, conversation quand même supprimée", { concurrency: false }, async () => {
    setup();
    const mock = mockApi((message, options) => {
        options.chat.id = "sub-1";
        return JSON.stringify({ type: "tool", name: "list_directory", args: { path: "." } });
    });

    try {
        const out = await runSubagent({ task: "Explore", maxTurns: 2 });

        assert.equal(out.status, "limit");
        assert.equal(out.turns, 2);
        assert.equal(out.deleted, true);
        assert.match(out.summary, /Limite de 2 tour/);
        assert.match(mock.calls[1].message, /Dernier tour/);
        assert.deepEqual(mock.deletes, ["sub-1"]);
    } finally {
        mock.restore();
    }
});

test("sous-agent : erreur du modèle, conversation supprimée", { concurrency: false }, async () => {
    setup();
    const mock = mockApi((message, options) => {
        options.chat.id = "sub-1";
        throw new Error("panne serveur");
    });

    try {
        const out = await runSubagent({ task: "Explore" });

        assert.equal(out.status, "error");
        assert.equal(out.error, "panne serveur");
        assert.equal(out.deleted, true);
        assert.match(out.summary, /panne serveur/);
    } finally {
        mock.restore();
    }
});

test("sous-agent : annulation par signal, conversation supprimée", { concurrency: false }, async () => {
    setup();
    const controller = new AbortController();
    const mock = mockApi((message, options) => {
        options.chat.id = "sub-1";
        controller.abort();
        throw Object.assign(new Error("Interrompu"), { name: "AbortError" });
    });

    try {
        const out = await runSubagent({ task: "Explore", signal: controller.signal });

        assert.equal(out.status, "cancelled");
        assert.equal(out.deleted, true);
        assert.deepEqual(mock.deletes, ["sub-1"]);
    } finally {
        mock.restore();
    }
});

test("sous-agent : échec de deleteChat sans perdre le résumé", { concurrency: false }, async () => {
    for (const del of [async () => { throw new Error("réseau"); }, async () => false]) {
        setup();
        const mock = mockApi((message, options) => {
            options.chat.id = "sub-1";
            return FINAL;
        }, del);

        try {
            const out = await runSubagent({ task: "Explore" });

            assert.equal(out.status, "done");
            assert.equal(out.summary, "Conclusion : voir src/a.js ligne 1.");
            assert.equal(out.deleted, false);
        } finally {
            mock.restore();
        }
    }
});

test("sous-agent : conversation gardée avec subagentKeepChats ou debug", { concurrency: false }, async () => {
    const saved = { keep: CONFIG.subagentKeepChats, debug: CONFIG.debug };

    for (const [keep, debug] of [[true, false], [false, true]]) {
        setup();
        CONFIG.subagentKeepChats = keep;
        CONFIG.debug = debug;
        const mock = mockApi((message, options) => {
            options.chat.id = "sub-1";
            return FINAL;
        });

        try {
            const out = await runSubagent({ task: "Explore" });

            assert.equal(out.status, "done");
            assert.equal(out.deleted, false);
            assert.deepEqual(mock.deletes, []);
        } finally {
            mock.restore();
            CONFIG.subagentKeepChats = saved.keep;
            CONFIG.debug = saved.debug;
        }
    }
});

test("sous-agent : repli sur le modèle courant après une erreur 404", { concurrency: false }, async () => {
    setup();
    const savedModel = state.model;
    state.model = 7;

    const mock = mockApi((message, options, n) => {
        if (n === 1) throw Object.assign(new Error("modèle inconnu"), { status: 404 });
        options.chat.id = "sub-1";
        return FINAL;
    });

    try {
        const out = await runSubagent({ task: "Explore" });

        assert.equal(out.status, "done");
        assert.deepEqual(mock.calls.map(c => c.agentId), [-2002, 7]);
        assert.equal(out.deleted, true);
    } finally {
        mock.restore();
        state.model = savedModel;
    }
});

test("sous-agent : tâche vide refusée et prompt limité aux outils de lecture", { concurrency: false }, async () => {
    await assert.rejects(runSubagent({ task: "  " }), /vide/);

    assert.deepEqual(READ_ONLY_TOOLS, ["list_directory", "read_file", "search_files", "glob"]);
    assert.match(buildSubagentPrompt("Analyse", 4), /glob/);
    const prompt = buildSubagentPrompt("Analyse", 4);
    assert.match(prompt, /4 tour/);
    assert.match(prompt, /search_files/);
    assert.match(prompt, /refusé/);
});
