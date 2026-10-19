"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const api = require("../src/api/api");
const account = require("../src/api/account");
const conversations = require("../src/project/conversations");
const memory = require("../src/project/memory");
const { state } = require("../src/state");
const { compactSession, buildCompactPrompt, extractSummary } = require("../src/agent/agent");

const originals = {
    requestModel: api.requestModel,
    getContextUsage: account.getContextUsage,
    touch: conversations.touch
};

function saveState() {
    return {
        chatIds: { ...state.chatIds },
        chatId: state.chatId,
        conversationSettings: { ...state.conversationSettings },
        history: state.history,
        contextUsagePercent: state.contextUsagePercent
    };
}

function restoreState(saved) {
    state.chatIds = saved.chatIds;
    state.chatId = saved.chatId;
    state.conversationSettings = saved.conversationSettings;
    state.history = saved.history;
    state.contextUsagePercent = saved.contextUsagePercent;
    api.requestModel = originals.requestModel;
    account.getContextUsage = originals.getContextUsage;
    conversations.touch = originals.touch;
}

/** API simulée : comme le serveur, attribue un chatId à la première requête d'une conversation. */
function mockApi({ summary = "1. Objectif\nTester.", failSeed = false, newChatId = "agent-new" } = {}) {
    const calls = [];
    api.requestModel = async (message, options = {}) => {
        calls.push({ message, options, chatId: state.chatIds.agent });
        if (!state.chatIds.agent) {
            if (failSeed) throw new Error("panne serveur");
            state.chatIds.agent = newChatId;
            state.chatId = newChatId;
            return "Compris.";
        }
        return summary;
    };
    conversations.touch = async () => {};
    return calls;
}

test("buildCompactPrompt demande les rubriques et ajoute la consigne", () => {
    const prompt = buildCompactPrompt("insiste sur les tests");
    for (const part of ["Objectif", "Décisions prises", "Fichiers modifiés", "Tâches restantes", "français"]) {
        assert.ok(prompt.includes(part), part);
    }
    assert.match(prompt, /insiste sur les tests/);
    assert.doesNotMatch(buildCompactPrompt(""), /Consigne de l'utilisateur/);
});

test("extractSummary accepte du texte brut ou une réponse final en JSON", () => {
    assert.equal(extractSummary("  Résumé simple  "), "Résumé simple");
    assert.equal(extractSummary('{"type":"final","message":"Résumé JSON"}'), "Résumé JSON");
    assert.equal(extractSummary(""), "");
});

test("compactSession ouvre une nouvelle conversation amorcée par le résumé", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        state.chatIds.agent = "agent-old";
        state.history = [{ role: "user", content: "ancienne demande" }];
        const calls = mockApi();
        let askedFor = null;
        account.getContextUsage = async id => {
            askedFor = id;
            return 3;
        };
        const changesBefore = memory.sessionChanges();

        const result = await compactSession({ instruction: "garde les chemins" });

        assert.equal(calls.length, 2);
        assert.equal(calls[0].chatId, "agent-old");
        assert.match(calls[0].message, /garde les chemins/);
        assert.equal(calls[1].chatId, null);
        assert.match(calls[1].message, /1\. Objectif/);
        assert.equal(result.previousChatId, "agent-old");
        assert.equal(result.chatId, "agent-new");
        assert.equal(state.chatIds.agent, "agent-new");
        assert.equal(result.chars, result.summary.length);
        assert.equal(result.contextUsagePercent, 3);
        assert.equal(state.contextUsagePercent, 3);
        assert.equal(askedFor, "agent-new");
        assert.equal(state.history.length, 1);
        assert.match(state.history[0].content, /Résumé de la session précédente/);
        // Le journal local (/undo) n'est pas touché.
        assert.equal(memory.sessionChanges(), changesBefore);
    } finally {
        restoreState(saved);
    }
});

test("compactSession conserve la conversation si l'ouverture échoue", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        state.chatIds.agent = "agent-old";
        state.contextUsagePercent = 85;
        const history = [{ role: "user", content: "demande" }];
        state.history = history;
        mockApi({ failSeed: true });
        account.getContextUsage = async () => 1;

        await assert.rejects(compactSession(), /panne serveur/);
        assert.equal(state.chatIds.agent, "agent-old");
        assert.equal(state.history, history);
        assert.equal(state.contextUsagePercent, 85);
    } finally {
        restoreState(saved);
    }
});

test("compactSession refuse un résumé vide ou l'absence de conversation", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        state.chatIds.agent = null;
        mockApi();
        await assert.rejects(compactSession(), /Aucune conversation agent/);

        state.chatIds.agent = "agent-old";
        mockApi({ summary: "   " });
        await assert.rejects(compactSession(), /Résumé vide/);
        assert.equal(state.chatIds.agent, "agent-old");
    } finally {
        restoreState(saved);
    }
});
