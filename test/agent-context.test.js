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
const { runAgent, fitPrompt, compactObservations } = require("../src/agent/agent");

const baseContext = {
    workspace: "/tmp/projet",
    env: { git: true, branch: "dev", node: "v22" },
    task: "Explique src/main.js",
    history: [],
    memorySummary: "aucune note",
    projectContext: "",
    observations: [],
    turn: 1,
    maxTurns: 50,
    correction: null
};

const asText = value => (typeof value === "string" ? value : JSON.stringify(value));

function readObservation(i) {
    return {
        tool: "read_file",
        args: { path: `f${i}.js` },
        ok: true,
        result: { path: `f${i}.js`, content: `contenu-${i}-fin` }
    };
}

test("compactObservations : outil, arguments et statut, sans le contenu", () => {
    const compacted = compactObservations([
        { tool: "read_file", args: { path: "a.js" }, ok: true, result: { content: "SECRET-CONTENU" } },
        { tool: "run_command", args: { command: "npm" }, ok: false, error: "échec de la commande" }
    ]);
    const text = JSON.stringify(compacted);

    assert.equal(compacted.tool, "historique_compacté");
    assert.match(text, /read_file/);
    assert.match(text, /a\.js/);
    assert.match(text, /run_command/);
    assert.match(text, /erreur/);
    assert.ok(!text.includes("SECRET-CONTENU"));
});

test("fitPrompt résume les observations anciennes et garde la dernière en entier", () => {
    const max = CONFIG.maxObservationsInPrompt || 16;
    const count = max + 4;
    const observations = Array.from({ length: count }, (_, i) => readObservation(i));
    const prompt = asText(fitPrompt({ ...baseContext, observations }));

    assert.match(prompt, /historique_compacté/);
    assert.match(prompt, /f0\.js/);
    assert.ok(!prompt.includes("contenu-0-fin"));
    assert.ok(prompt.includes(`contenu-${count - 1}-fin`));
});

test("fitPrompt sans observation ancienne : pas d'historique compacté", () => {
    const observations = [readObservation(0), readObservation(1)];
    const prompt = asText(fitPrompt({ ...baseContext, observations }));

    assert.ok(!prompt.includes("historique_compacté"));
    assert.ok(prompt.includes("contenu-1-fin"));
});

test("runAgent : un lot répété 3 fois est bloqué par le garde-fou", { concurrency: false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fscli-proj-"));
    fs.writeFileSync(path.join(dir, "a.js"), "console.log(1);\n");

    resetConversation();
    state.workspace = dir;
    state.autoApprove = true;

    const batch = '{"type":"tool","calls":[{"name":"list_directory","args":{"path":"."}}],"reason":"Lister le dossier"}';
    const answers = [batch, batch, batch, '{"type":"final","message":"Terminé."}'];
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
        await runAgent("Liste les fichiers du dossier");
    } finally {
        console.log = log;
        api.requestModel = originalRequest;
        state.workspace = null;
    }

    assert.equal(sent.length, 4);
    assert.ok(!sent[2].message.includes("Action déjà exécutée plusieurs fois"));
    assert.match(sent[3].message, /Action déjà exécutée plusieurs fois/);
});
