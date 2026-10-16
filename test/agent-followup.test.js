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
const { buildAgentPrompt, buildFollowUpPrompt } = require("../src/agent/prompt");
const api = require("../src/api/api");
const { runAgent } = require("../src/agent/agent");

const baseContext = {
    workspace: "/tmp/projet",
    env: { git: true, branch: "dev", node: "v22" },
    task: "Explique src/main.js",
    history: [],
    memorySummary: "aucune note",
    projectContext: "",
    observations: [],
    turn: 1,
    maxTurns: 15,
    correction: null
};

test("limites par défaut : contexte projet 30 000 et résultat d'outil 15 000 caractères", () => {
    assert.equal(CONFIG.agentContextChars, 30_000);
    assert.equal(CONFIG.maxObservationChars, 15_000);
});

test("le message « suite » ne contient que le dernier résultat, tronqué à maxObservationChars", () => {
    const observation = {
        tool: "read_file",
        args: { path: "a.js" },
        ok: true,
        result: { path: "a.js", content: "x".repeat(50_000) }
    };
    const prompt = buildFollowUpPrompt({ lastObservation: observation, turn: 3, maxTurns: 15, correction: null });

    assert.match(prompt, /SUITE DE LA TÂCHE/);
    assert.match(prompt, /RÉSULTAT DE L'OUTIL \(tour 2\)/);
    assert.match(prompt, /TOUR 3 —/);
    assert.ok(!prompt.includes("TOUR 3/15"));
    assert.match(prompt, /truncated_in_prompt/);
    assert.ok(prompt.length < CONFIG.maxObservationChars + 4_000);
    assert.ok(!prompt.includes("OUTILS — chemins relatifs"));
});

test("le message « suite » transmet la correction après une réponse invalide", () => {
    const prompt = buildFollowUpPrompt({
        lastObservation: null,
        turn: 2,
        maxTurns: 15,
        correction: { error: "JSON invalide", previousResponse: "bonjour" }
    });

    assert.match(prompt, /CORRECTION/);
    assert.match(prompt, /JSON invalide/);
});

test("l'avertissement de fin n'apparaît qu'à 2 tours ou moins du plafond", () => {
    const far = buildFollowUpPrompt({ lastObservation: null, turn: 10, maxTurns: 50, correction: null });
    const near = buildFollowUpPrompt({ lastObservation: null, turn: 48, maxTurns: 50, correction: null });
    const last = buildAgentPrompt({ ...baseContext, turn: 15, maxTurns: 15 });

    assert.ok(!far.includes("ATTENTION : plus que"));
    assert.match(near, /plus que 2 tour\(s\)/);
    assert.match(last, /plus que 0 tour\(s\)/);
    assert.ok(!last.includes("TOUR 15/15"));
});

test("projectOmitted remplace « aucun contexte chargé »", () => {
    const omitted = buildAgentPrompt({ ...baseContext, projectOmitted: true });
    const none = buildAgentPrompt({ ...baseContext });

    assert.match(omitted, /déjà été fourni au début de cette conversation/);
    assert.match(none, /aucun contexte chargé/);
});

test("runAgent : projet et instructions au tour 1, message court ensuite", { concurrency: false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fscli-proj-"));
    fs.writeFileSync(path.join(dir, "a.js"), "console.log(1);\n");

    resetConversation();
    state.workspace = dir;
    state.autoApprove = true;

    const originalRequest = api.requestModel;
    const sent = [];
    const answers = [
        '{"type":"tool","name":"list_directory","args":{"path":"."},"reason":"Lister le dossier"}',
        '{"type":"final","message":"Terminé."}'
    ];

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

    assert.equal(sent.length, 2);
    assert.match(sent[0].message, /OUTILS — chemins relatifs/);
    assert.match(sent[1].message, /^SUITE DE LA TÂCHE/);
    assert.match(sent[1].message, /list_directory/);
    assert.ok(sent[1].message.length < sent[0].message.length / 3);
    assert.equal(typeof sent[1].options.freshMessage, "function");
    assert.match(sent[1].options.freshMessage(), /OUTILS — chemins relatifs/);
});
