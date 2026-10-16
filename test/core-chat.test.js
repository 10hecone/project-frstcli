"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { state, resetConversation } = require("../src/state");
const api = require("../src/api/api");
const projectContext = require("../src/project/project-context");
const conversations = require("../src/project/conversations");
const chat = require("../src/core/chat");

function setup({ workspace = null, chatIdToCreate = "chat-123", deltas = [] } = {}) {
    const original = {
        requestModel: api.requestModel,
        promptContext: projectContext.promptContext,
        touch: conversations.touch,
        workspace: state.workspace,
        mode: state.mode,
    };

    const calls = { requestModel: [], promptContext: 0, touch: [] };

    api.requestModel = async (message, options = {}) => {
        calls.requestModel.push(message);
        for (const delta of deltas) {
            if (options.onDelta) options.onDelta(delta);
        }
        // Imite l'API : la première réponse crée la conversation.
        if (!state.chatId) {
            state.chatId = chatIdToCreate;
            state.chatIds.chat = chatIdToCreate;
        }
        return `réponse ${calls.requestModel.length}`;
    };
    projectContext.promptContext = () => {
        calls.promptContext += 1;
        return "CONTEXTE PROJET";
    };
    conversations.touch = async (entry) => {
        calls.touch.push(entry);
    };

    resetConversation();
    state.workspace = workspace;
    state.mode = "chat";

    function restore() {
        api.requestModel = original.requestModel;
        projectContext.promptContext = original.promptContext;
        conversations.touch = original.touch;
        state.workspace = original.workspace;
        state.mode = original.mode;
        resetConversation();
    }

    return { calls, restore };
}

test("chat.send joint le contexte projet au premier message seulement", async () => {
    const { calls, restore } = setup({ workspace: "C:/projet" });
    try {
        const first = await chat.send("bonjour");
        assert.equal(calls.promptContext, 1);
        assert.equal(calls.requestModel[0], "CONTEXTE PROJET\n\nQUESTION : bonjour");
        assert.equal(first.response, "réponse 1");
        assert.equal(first.newChatId, "chat-123");

        const second = await chat.send("encore");
        assert.equal(calls.promptContext, 1);
        assert.equal(calls.requestModel[1], "encore");
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

test("chat.send sans projet envoie le message brut", async () => {
    const { calls, restore } = setup({ workspace: null });
    try {
        await chat.send("salut");
        assert.equal(calls.promptContext, 0);
        assert.equal(calls.requestModel[0], "salut");
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

test("chat.send sans onDelta ne plante pas", async () => {
    const { restore } = setup({ deltas: ["x"] });
    try {
        const result = await chat.send("ok");
        assert.equal(result.response, "réponse 1");
    } finally {
        restore();
    }
});
