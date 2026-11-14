"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const api = require("../src/api/api");
const account = require("../src/api/account");
const conversations = require("../src/project/conversations");
const memory = require("../src/project/memory");
const { state } = require("../src/state");
const {
    compactSession,
    buildCompactPrompt,
    buildCompactSeed,
    extractSummary,
    COMPACT_MAX_SUMMARY_CHARS
} = require("../src/core/compact");

const originals = {
    requestTurn: api.requestTurn,
    sendToolResults: api.sendToolResults,
    getContextUsage: account.getContextUsage,
    touch: conversations.touch
};

function saveState() {
    return {
        chatIds: { ...state.chatIds },
        chatId: state.chatId,
        conversationSettings: { ...state.conversationSettings },
        history: state.history,
        contextUsagePercent: state.contextUsagePercent,
        workspace: state.workspace
    };
}

function restoreState(saved) {
    state.chatIds = saved.chatIds;
    state.chatId = saved.chatId;
    state.conversationSettings = saved.conversationSettings;
    state.history = saved.history;
    state.contextUsagePercent = saved.contextUsagePercent;
    state.workspace = saved.workspace;
    api.requestTurn = originals.requestTurn;
    api.sendToolResults = originals.sendToolResults;
    account.getContextUsage = originals.getContextUsage;
    conversations.touch = originals.touch;
}

/**
 * API simulée : comme le serveur (streamOnce), attribue un chatId à la première
 * requête d'une conversation et le range dans state.chatIds.chat.
 */
function mockApi({ summary = "1. Objectif\nTester.", failSeed = false, newChatId = "chat-new" } = {}) {
    const calls = [];
    api.requestTurn = async (message, options = {}) => {
        calls.push({ message, options, chatId: state.chatIds.chat });
        if (!state.chatIds.chat) {
            if (failSeed) throw new Error("panne serveur");
            state.chatIds.chat = newChatId;
            state.chatId = newChatId;
            return { text: "Compris.", toolCalls: [], chatId: newChatId };
        }
        return { text: summary, toolCalls: [], chatId: state.chatIds.chat };
    };
    api.sendToolResults = async () => {
        throw new Error("sendToolResults ne devrait pas être appelé");
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

test("extractSummary nettoie le texte et le limite en taille", () => {
    assert.equal(extractSummary("  Résumé simple  "), "Résumé simple");
    assert.equal(extractSummary(""), "");
    assert.equal(extractSummary(null), "");
    const long = extractSummary("x".repeat(COMPACT_MAX_SUMMARY_CHARS + 10));
    assert.ok(long.startsWith("x".repeat(COMPACT_MAX_SUMMARY_CHARS)));
    assert.match(long, /\[tronqué\]$/);
});

test("buildCompactSeed ajoute le bloc d'instructions seulement s'il existe", () => {
    assert.doesNotMatch(buildCompactSeed("RÉSUMÉ"), /INSTRUCTIONS/);
    const seed = buildCompactSeed("RÉSUMÉ", "INSTRUCTIONS DU PROJET\nrègle");
    assert.ok(seed.indexOf("RÉSUMÉ") < seed.indexOf("INSTRUCTIONS DU PROJET"));
});

test("compactSession ouvre une nouvelle conversation amorcée par le résumé", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        state.workspace = null;
        state.chatIds.chat = "chat-old";
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
        assert.equal(calls[0].chatId, "chat-old");
        assert.match(calls[0].message, /garde les chemins/);
        // Aucun outil n'est proposé pendant la compaction.
        assert.equal(calls[0].options.clientTools, undefined);
        assert.equal(calls[1].chatId, null);
        assert.match(calls[1].message, /1\. Objectif/);
        assert.doesNotMatch(calls[1].message, /INSTRUCTIONS DU PROJET/);
        assert.equal(result.previousChatId, "chat-old");
        assert.equal(result.chatId, "chat-new");
        assert.equal(state.chatIds.chat, "chat-new");
        assert.equal(result.chars, result.summary.length);
        assert.equal(result.contextUsagePercent, 3);
        assert.equal(state.contextUsagePercent, 3);
        assert.equal(askedFor, "chat-new");
        assert.equal(state.history.length, 1);
        assert.match(state.history[0].content, /Résumé de la session précédente/);
        // Le journal local (/undo) n'est pas touché.
        assert.equal(memory.sessionChanges(), changesBefore);
    } finally {
        restoreState(saved);
    }
});

test("compactSession réinjecte FRSTCLI.md dans la nouvelle conversation", { concurrency: false }, async () => {
    const saved = saveState();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fscli-compact-"));
    try {
        fs.writeFileSync(path.join(dir, "FRSTCLI.md"), "Toujours répondre en français.\n");
        state.workspace = dir;
        state.chatIds.chat = "chat-old";
        state.history = [];
        const calls = mockApi();
        account.getContextUsage = async () => null;

        await compactSession();

        assert.equal(calls.length, 2);
        assert.doesNotMatch(calls[0].message, /INSTRUCTIONS DU PROJET/);
        assert.match(calls[1].message, /INSTRUCTIONS DU PROJET \(FRSTCLI\.md/);
        assert.match(calls[1].message, /Toujours répondre en français\./);
    } finally {
        restoreState(saved);
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("compactSession refuse les appels d'outils puis annule si le modèle insiste", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        state.workspace = null;
        state.chatIds.chat = "chat-old";
        const history = [{ role: "user", content: "demande" }];
        state.history = history;
        state.contextUsagePercent = 70;
        conversations.touch = async () => {};
        account.getContextUsage = async () => 1;

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
        // Échec avant l'ouverture de la nouvelle conversation : rien n'a changé.
        assert.equal(state.chatIds.chat, "chat-old");
        assert.equal(state.history, history);
        assert.equal(state.contextUsagePercent, 70);
    } finally {
        restoreState(saved);
    }
});

test("compactSession accepte un résumé obtenu après un refus d'outil", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        state.workspace = null;
        state.chatIds.chat = "chat-old";
        state.history = [];
        conversations.touch = async () => {};
        account.getContextUsage = async () => null;

        api.requestTurn = async () => {
            if (!state.chatIds.chat) {
                state.chatIds.chat = "chat-new";
                state.chatId = "chat-new";
                return { text: "Compris.", toolCalls: [], chatId: "chat-new" };
            }
            return {
                text: "",
                toolCalls: [{ callId: "call-1", name: "list_directory", arguments: {} }],
                chatId: "chat-old"
            };
        };
        api.sendToolResults = async () => ({ text: "1. Objectif\nFinir.", toolCalls: [], chatId: "chat-old" });

        const result = await compactSession();
        assert.equal(result.summary, "1. Objectif\nFinir.");
        assert.equal(state.chatIds.chat, "chat-new");
    } finally {
        restoreState(saved);
    }
});

test("compactSession conserve la conversation si l'ouverture échoue", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        state.workspace = null;
        state.chatIds.chat = "chat-old";
        state.contextUsagePercent = 85;
        const history = [{ role: "user", content: "demande" }];
        state.history = history;
        mockApi({ failSeed: true });
        account.getContextUsage = async () => 1;

        await assert.rejects(compactSession(), /panne serveur/);
        assert.equal(state.chatIds.chat, "chat-old");
        assert.equal(state.history, history);
        assert.equal(state.contextUsagePercent, 85);
    } finally {
        restoreState(saved);
    }
});

test("compactSession refuse un résumé vide ou l'absence de conversation", { concurrency: false }, async () => {
    const saved = saveState();
    try {
        state.workspace = null;
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
    } finally {
        restoreState(saved);
    }
});
