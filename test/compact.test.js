"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const api = require("../src/api/api");
const memory = require("../src/project/memory");
const profile = require("../src/project/profile");
const chat = require("../src/core/chat");
const { state } = require("../src/state");
const {
    compactSession,
    buildCompactPrompt,
    extractSummary,
    COMPACT_MAX_SUMMARY_CHARS
} = require("../src/core/compact");

const originals = {
    requestTurn: api.requestTurn,
    sendToolResults: api.sendToolResults,
    buildPreprompt: profile.buildPreprompt
};

function saveState() {
    return {
        chatIds: { ...state.chatIds },
        chatId: state.chatId,
        conversationSettings: { ...state.conversationSettings },
        history: state.history,
        contextUsagePercent: state.contextUsagePercent,
        compactSummary: state.compactSummary,
        workspace: state.workspace
    };
}

function restoreState(saved) {
    Object.assign(state, saved);
    api.requestTurn = originals.requestTurn;
    api.sendToolResults = originals.sendToolResults;
    profile.buildPreprompt = originals.buildPreprompt;
}

/** Conversation chat en cours, hors projet (pas de FRSTCLI.md ni de contexte court). */
function prepare({ percent = 70 } = {}) {
    state.workspace = null;
    state.chatIds.chat = "chat-old";
    state.chatId = "chat-old";
    state.conversationSettings.chat = null;
    state.contextUsagePercent = percent;
    state.compactSummary = null;
    const history = [{ role: "user", content: "ancienne demande" }];
    state.history = history;
    return history;
}

/**
 * API simulée : répond par le résumé dans la conversation en cours. Une requête
 * d'amorçage (sans conversation) serait enregistrée avec chatId null.
 */
function mockApi({ summary = "1. Objectif\nTester.", fail = false } = {}) {
    const calls = [];
    api.requestTurn = async (message, options = {}) => {
        calls.push({ message, options, chatId: state.chatIds.chat });
        if (fail) throw new Error("panne serveur");
        return { text: summary, toolCalls: [], chatId: state.chatIds.chat };
    };
    api.sendToolResults = async () => {
        throw new Error("sendToolResults ne devrait pas être appelé");
    };
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

test("extractSummary nettoie le texte et le limite en taille", () => {
    assert.equal(extractSummary("  Résumé simple  "), "Résumé simple");
    assert.equal(extractSummary(""), "");
    assert.equal(extractSummary(null), "");
    const long = extractSummary("x".repeat(COMPACT_MAX_SUMMARY_CHARS + 10));
    assert.ok(long.startsWith("x".repeat(COMPACT_MAX_SUMMARY_CHARS)));
    assert.match(long, /\[tronqué\]$/);
});

test("compactSession résume puis repart d'une conversation vide, sans requête d'amorçage", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        prepare();
        const settings = { model: state.model };
        state.conversationSettings.chat = settings;
        const calls = mockApi();
        const changesBefore = memory.sessionChanges();

        const result = await compactSession({ instruction: "garde les chemins" });

        // Une seule requête : la demande de résumé, dans l'ancienne conversation.
        assert.equal(calls.length, 1);
        assert.equal(calls[0].chatId, "chat-old");
        assert.match(calls[0].message, /garde les chemins/);
        // Aucun outil n'est proposé pendant la compaction.
        assert.equal(calls[0].options.clientTools, undefined);

        assert.deepEqual(result, { summary: "1. Objectif\nTester.", chars: 19, previousChatId: "chat-old" });

        // La conversation suivante sera créée par le prochain message, qui joindra le résumé.
        assert.equal(state.chatIds.chat, null);
        assert.equal(state.chatId, null);
        assert.equal(state.compactSummary, "1. Objectif\nTester.");
        assert.equal(state.contextUsagePercent, null);
        // Les réglages de la conversation (modèle, recherche web…) sont conservés.
        assert.deepEqual(state.conversationSettings.chat, settings);
        assert.equal(state.history.length, 1);
        assert.match(state.history[0].content, /^Résumé de la session précédente :\n1\. Objectif/);
        // Le journal local (/undo) n'est pas touché.
        assert.equal(memory.sessionChanges(), changesBefore);
    } finally {
        restoreState(saved);
    }
});

test("après /compact, le premier message de la conversation suivante porte le résumé", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        prepare();
        mockApi();
        profile.buildPreprompt = () => "";

        await compactSession();
        const message = await chat.buildMessage("on continue");

        // La demande d'abord, le résumé ensuite en annexe.
 assert.ok(message.startsWith("on continue\n\n---\n\n"));
        assert.match(message, /\nRÉSUMÉ DE LA SESSION PRÉCÉDENTE \(écrit par \/compact/);
        assert.ok(message.endsWith("1. Objectif\nTester."));
    } finally {
        restoreState(saved);
    }
});

test("compactSession refuse les appels d'outils puis annule si le modèle insiste", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        const history = prepare();

        const toolTurn = id => ({
            text: "",
            toolCalls: [{ callId: `call-${id}`, name: "read_file", arguments: { path: "a.js" } }],
            chatId: "chat-old"
        });
        let requests = 0;
        const sent = [];
        api.requestTurn = async () => {
            requests++;
            return toolTurn(0);
        };
        api.sendToolResults = async (chatId, results) => {
            sent.push({ chatId, results });
            return toolTurn(sent.length);
        };

        await assert.rejects(compactSession(), /demande des outils au lieu de répondre/);

        assert.equal(requests, 1);
        assert.equal(sent.length, 2);
        assert.equal(sent[0].chatId, "chat-old");
        assert.deepEqual(sent[0].results.map(r => r.callId), ["call-0"]);
        assert.equal(sent[0].results[0].isError, true);
        // Échec : la conversation actuelle est conservée telle quelle.
        assert.equal(state.chatIds.chat, "chat-old");
        assert.equal(state.history, history);
        assert.equal(state.contextUsagePercent, 70);
        assert.equal(state.compactSummary, null);
    } finally {
        restoreState(saved);
    }
});

test("compactSession accepte un résumé obtenu après un refus d'outil", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        prepare();
        api.requestTurn = async () => ({
            text: "",
            toolCalls: [{ callId: "call-1", name: "list_directory", arguments: {} }],
            chatId: "chat-old"
        });
        api.sendToolResults = async () => ({ text: "1. Objectif\nFinir.", toolCalls: [], chatId: "chat-old" });

        const result = await compactSession();
        assert.equal(result.summary, "1. Objectif\nFinir.");
        assert.equal(state.chatIds.chat, null);
        assert.equal(state.compactSummary, "1. Objectif\nFinir.");
    } finally {
        restoreState(saved);
    }
});

test("compactSession conserve la conversation si la demande de résumé échoue", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        const history = prepare({ percent: 85 });
        mockApi({ fail: true });

        await assert.rejects(compactSession(), /panne serveur/);
        assert.equal(state.chatIds.chat, "chat-old");
        assert.equal(state.history, history);
        assert.equal(state.contextUsagePercent, 85);
        assert.equal(state.compactSummary, null);
    } finally {
        restoreState(saved);
    }
});

test("compactSession refuse un résumé vide ou l'absence de conversation", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        prepare();
        state.chatIds.chat = null;
        state.chatIds.agent = "agent-old";
        const calls = mockApi();
        await assert.rejects(compactSession(), /Aucune conversation à résumer/);
        // Une ancienne conversation agent n'est jamais compactée.
        assert.equal(calls.length, 0);

        state.chatIds.chat = "chat-old";
        mockApi({ summary: "   " });
        await assert.rejects(compactSession(), /Résumé vide/);
        assert.equal(state.chatIds.chat, "chat-old");
        assert.equal(state.compactSummary, null);
    } finally {
        restoreState(saved);
    }
});
