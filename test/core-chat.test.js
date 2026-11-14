"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { state, resetConversation } = require("../src/state");
const api = require("../src/api/api");
const projectContext = require("../src/project/project-context");
const conversations = require("../src/project/conversations");
const chat = require("../src/core/chat");
const compact = require("../src/core/compact");
const profile = require("../src/project/profile");
const registry = require("../src/tools/registry");
const { setUiBackend, UI_METHODS } = require("../src/ui-bridge");

/** Interface muette : les tests n'écrivent rien dans le terminal. */
function silentUi(log = []) {
    const impl = {};
    for (const name of UI_METHODS) impl[name] = (...args) => log.push([name, ...args]);
    impl.spinner = () => ({ update() {}, stop() {} });
    impl.confirm = async () => false;
    return impl;
}

function setup({ workspace = null, mode = "auto", chatIdToCreate = "chat-123", deltas = [] } = {}) {
    const original = {
        requestTurn: api.requestTurn,
        promptContext: projectContext.promptContext,
        touch: conversations.touch,
        buildPreprompt: profile.buildPreprompt,
        refreshContextUsage: compact.refreshContextUsage,
        workspace: state.workspace,
        mode: state.mode,
    };

    const calls = { requestTurn: [], options: [], promptContext: 0, touch: [], refresh: [], ui: [] };

    // Isole les tests du profil réel de l'utilisateur (~/.francestudent-cli/profile.json).
    profile.buildPreprompt = () => "";
    setUiBackend(silentUi(calls.ui));

    // Tour sans appel d'outil : le modèle répond directement.
    api.requestTurn = async (message, options = {}) => {
        calls.requestTurn.push(message);
        calls.options.push(options);
        for (const delta of deltas) {
            if (options.onDelta) options.onDelta(delta);
        }
        // Imite l'API : la première réponse crée la conversation.
        if (!state.chatId) {
            state.chatId = chatIdToCreate;
            state.chatIds.chat = chatIdToCreate;
        }
        return { text: `réponse ${calls.requestTurn.length}`, toolCalls: [], chatId: state.chatId };
    };
    projectContext.promptContext = () => {
        calls.promptContext += 1;
        return "CONTEXTE PROJET";
    };
    conversations.touch = async (entry) => {
        calls.touch.push(entry);
    };
    // Pas d'appel réseau pour le pourcentage de contexte.
    compact.refreshContextUsage = (chatId) => {
        calls.refresh.push(chatId === undefined ? state.chatIds.chat : chatId);
        return Promise.resolve(null);
    };

    resetConversation();
    state.workspace = workspace;
    state.mode = mode;

    function restore() {
        api.requestTurn = original.requestTurn;
        projectContext.promptContext = original.promptContext;
        conversations.touch = original.touch;
        profile.buildPreprompt = original.buildPreprompt;
        compact.refreshContextUsage = original.refreshContextUsage;
        state.workspace = original.workspace;
        state.mode = original.mode;
        setUiBackend(null);
        resetConversation();
    }

    return { calls, restore };
}

test("chat.send joint le contexte projet au premier message seulement", async () => {
    const { calls, restore } = setup({ workspace: "C:/projet" });
    try {
        const first = await chat.send("bonjour");
        assert.equal(calls.promptContext, 1);
        assert.equal(calls.requestTurn[0], "CONTEXTE PROJET\n\nQUESTION : bonjour");
        assert.equal(first.response, "réponse 1");
        assert.equal(first.newChatId, "chat-123");

        const second = await chat.send("encore");
        assert.equal(calls.promptContext, 1);
        assert.equal(calls.requestTurn[1], "encore");
        assert.equal(second.response, "réponse 2");
        assert.equal(second.newChatId, null);

        assert.deepEqual(
            state.history.map((entry) => entry.role),
            ["user", "assistant", "user", "assistant"],
        );
        assert.equal(state.history[0].content, "bonjour");
    } finally {
        restore();
    }
});

test("chat.send avec un projet propose les six outils client, toujours dans le même ordre", async () => {
    const { calls, restore } = setup({ workspace: "C:/projet" });
    try {
        await chat.send("bonjour");
        await chat.send("encore");
        assert.deepEqual(calls.options[0].clientTools, registry.CLIENT_TOOLS);
        assert.deepEqual(calls.options[1].clientTools, registry.CLIENT_TOOLS);
    } finally {
        restore();
    }
});

test("chat.send sans projet envoie le message brut, sans outil", async () => {
    const { calls, restore } = setup({ workspace: null });
    try {
        await chat.send("salut");
        assert.equal(calls.promptContext, 0);
        assert.equal(calls.requestTurn[0], "salut");
        assert.deepEqual(calls.options[0].clientTools, []);
    } finally {
        restore();
    }
});

test("toolsFor : mode chat sans outil, /plan en lecture seule, sinon le catalogue complet", () => {
    const { restore } = setup({ workspace: "C:/projet" });
    try {
        state.mode = "auto";
        assert.deepEqual(chat.toolsFor(), registry.CLIENT_TOOLS);
        assert.deepEqual(chat.toolsFor({ readOnly: true }), registry.READ_TOOLS);

        state.mode = "chat";
        assert.deepEqual(chat.toolsFor(), []);
        // /plan garde ses outils de lecture, même en mode chat.
        assert.deepEqual(chat.toolsFor({ readOnly: true }), registry.READ_TOOLS);

        state.workspace = null;
        assert.deepEqual(chat.toolsFor(), []);
        assert.deepEqual(chat.toolsFor({ readOnly: true }), []);
    } finally {
        restore();
    }
});

test("chat.send en mode chat avec un projet : contexte projet, mais aucun outil", async () => {
    const { calls, restore } = setup({ workspace: "C:/projet", mode: "chat" });
    try {
        await chat.send("question");
        assert.equal(calls.requestTurn[0], "CONTEXTE PROJET\n\nQUESTION : question");
        assert.deepEqual(calls.options[0].clientTools, []);
    } finally {
        restore();
    }
});

test("chat.send relaie les deltas et appelle conversations.touch", async () => {
    const { calls, restore } = setup({ workspace: "C:/projet", deltas: ["a", "b"] });
    try {
        const received = [];
        await chat.send("question", { onDelta: (text) => received.push(text) });
        assert.deepEqual(received, ["a", "b"]);

        assert.equal(calls.touch.length, 1);
        const entry = calls.touch[0];
        assert.equal(entry.id, "chat-123");
        assert.equal(entry.mode, "chat");
        assert.equal(entry.firstMessage, "question");
        assert.equal(entry.workspace, "C:/projet");
        assert.equal(entry.model, state.model);
        assert.deepEqual(state.conversationSettings.chat, entry.settings);
    } finally {
        restore();
    }
});

test("chat.send met à jour le pourcentage de contexte de la conversation", async () => {
    const { calls, restore } = setup({ workspace: "C:/projet" });
    try {
        await chat.send("question");
        assert.deepEqual(calls.refresh, ["chat-123"]);
    } finally {
        restore();
    }
});

test("chat.send sans onDelta ne plante pas", async () => {
    const { restore } = setup({ deltas: ["x"] });
    try {
        const result = await chat.send("ok");
        assert.equal(result.response, "réponse 1");
    } finally {
        restore();
    }
});

test("reportUsage : tokens fournis par l'API, sinon estimation", () => {
    const { calls, restore } = setup();
    const saved = { ...api.usage };
    try {
        const before = { requests: 0, chars: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, reported: 0 };

        Object.assign(api.usage, { ...before, requests: 2, chars: 7000, reported: 2, inputTokens: 1500, outputTokens: 200, cachedTokens: 1000 });
        chat.reportUsage(before);
        Object.assign(api.usage, { ...before, requests: 1, chars: 3500 });
        chat.reportUsage(before);
        Object.assign(api.usage, before);
        chat.reportUsage(before);

        const infos = calls.ui.filter(([method]) => method === "info").map(([, text]) => text);
        assert.equal(infos.length, 2);
        assert.match(infos[0], /^Coût de la demande : 2 requête\(s\)/);
        assert.match(infos[0], /dont 1\s000 en cache, 200 en sortie/);
        assert.match(infos[1], /≈ 1\s000 tokens/);
    } finally {
        Object.assign(api.usage, saved);
        restore();
    }
});
