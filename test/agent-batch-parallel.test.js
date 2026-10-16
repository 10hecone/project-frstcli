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
const { TOOLS } = require("../src/tools/tools");
const { runAgent } = require("../src/agent/agent");

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test("runAgent : un lot calls est exécuté en parallèle, dans l'ordre, avec une erreur au milieu", { concurrency: false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fscli-proj-"));

    for (const name of ["a.js", "b.js", "c.js"]) {
        fs.writeFileSync(path.join(dir, name), "console.log(1);\n");
    }

    resetConversation();
    state.workspace = dir;
    state.autoApprove = true;

    // Délais inversés : c.js finit avant b.js, qui finit avant a.js.
    const delays = { "a.js": 40, "b.js": 20, "c.js": 1 };
    const started = [];
    const finished = [];
    let active = 0;
    let maxActive = 0;

    const originalRun = TOOLS.read_file.run;

    TOOLS.read_file.run = async args => {
        started.push(args.path);
        active++;
        maxActive = Math.max(maxActive, active);

        try {
            await delay(delays[args.path]);
        } finally {
            active--;
            finished.push(args.path);
        }

        if (args.path === "b.js") throw new Error("ECHEC_LECTURE_B");

        const marker = `CONTENU_${args.path[0].toUpperCase()}`;

        return { path: args.path, total_lines: 1, range: null, truncated: false, content: marker, message: "Fichier lu." };
    };

    const batch = JSON.stringify({
        type: "tool",
        calls: [
            { name: "read_file", args: { path: "a.js" } },
            { name: "read_file", args: { path: "b.js" } },
            { name: "read_file", args: { path: "c.js" } }
        ],
        reason: "Lire trois fichiers"
    });
    const answers = [batch, '{"type":"final","message":"Terminé."}'];
    const originalRequest = api.requestModel;
    const sent = [];

    api.requestModel = async (message, options) => {
        sent.push({ message, options });
        state.chatIds.agent = "agent-test";
        state.chatId = "agent-test";
        api.usage.requests++;
        api.usage.chars += message.length;
        return answers.shift();
    };

    const log = console.log;
    console.log = () => {};

    try {
        await runAgent("Lis a.js, b.js et c.js");
    } finally {
        console.log = log;
        api.requestModel = originalRequest;
        TOOLS.read_file.run = originalRun;
        state.workspace = null;
    }

    // Les trois lectures ont démarré ensemble et ne se sont pas terminées dans l'ordre des appels.
    assert.deepEqual(started, ["a.js", "b.js", "c.js"]);
    assert.equal(maxActive, 3);
    assert.deepEqual(finished, ["c.js", "b.js", "a.js"]);

    // Les observations envoyées au modèle restent dans l'ordre des appels, avec l'erreur au milieu.
    assert.equal(sent.length, 2);

    const followUp = sent[1].message;
    const posA = followUp.indexOf("CONTENU_A");
    const posB = followUp.indexOf("ECHEC_LECTURE_B");
    const posC = followUp.indexOf("CONTENU_C");

    assert.ok(posA !== -1 && posB !== -1 && posC !== -1, "les trois résultats doivent être présents");
    assert.ok(posA < posB && posB < posC, "ordre a.js, b.js, c.js attendu");
    assert.match(followUp, /"ok":\s*false/);
});
