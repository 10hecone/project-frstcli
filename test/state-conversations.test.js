"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { state, setConversation, resetConversation } = require("../src/state");
const { migrateProject } = require("../src/project/projects");

test("une seule conversation : setConversation l'active, resetConversation l'oublie", () => {
    const model = state.model;
    resetConversation();

    setConversation("chat-1", { model: -1002 });
    assert.equal(state.chatId, "chat-1");
    assert.equal(state.model, -1002);
    assert.deepEqual(state.chatIds, { chat: "chat-1" });

    resetConversation();
    assert.equal(state.chatId, null);
    assert.deepEqual(state.chatIds, { chat: null });
    state.model = model;
});

test("projects.json : conversations.chat devient la première session, agent est oublié", () => {
    const project = {
        path: "/p",
        conversations: { chat: { id: "c1", settings: { model: 3 }, updatedAt: "2026-01-01" }, agent: { id: "a1" } }
    };
    assert.equal(migrateProject(project), true);
    assert.deepEqual(project.sessions, [{ id: "c1", title: null, settings: { model: 3 }, updatedAt: "2026-01-01" }]);
    assert.equal("conversations" in project, false);

    // Déjà migré : rien ne change.
    assert.equal(migrateProject(project), false);

    const empty = { path: "/q", conversations: { chat: null, agent: null } };
    migrateProject(empty);
    assert.deepEqual(empty.sessions, []);
});
