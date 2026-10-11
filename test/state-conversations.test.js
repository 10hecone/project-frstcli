"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    state,
    setConversation,
    activateConversation,
    resetConversation,
} = require("../src/state");

test("les conversations normal et agent restent indépendantes", () => {
    resetConversation();

    setConversation("chat", "chat-1", { model: -1002 });
    setConversation("agent", "agent-1", { model: -2001 });

    activateConversation("chat");
    assert.equal(state.chatId, "chat-1");
    assert.equal(state.model, -1002);

    activateConversation("agent");
    assert.equal(state.chatId, "agent-1");
    assert.equal(state.model, -2001);
    assert.deepEqual(state.chatIds, { chat: "chat-1", agent: "agent-1" });

    resetConversation("agent");
    assert.deepEqual(state.chatIds, { chat: "chat-1", agent: null });
});
