"use strict";

const { CONFIG } = require("./config");

const state = {
    chatId: null,
    chatIds: { chat: null, agent: null },
    conversationSettings: { chat: null, agent: null },
    model: CONFIG.defaultAgentId,
    webSearch: false,
    private: true,
    incognito: false,
    workspace: null,
    history: [],
    mode: "auto",        // auto | agent | chat
    autoApprove: false   // true = plus de confirmation pour la session
};

function activateConversation(mode) {
    const key = mode === "agent" ? "agent" : "chat";
    state.chatId = state.chatIds[key];

    const settings = state.conversationSettings[key];
    if (settings) {
        for (const name of ["model", "webSearch", "private", "incognito", "autoApprove"]) {
            if (settings[name] !== undefined) state[name] = settings[name];
        }
    }

    return key;
}

function setConversation(mode, id, settings = null) {
    const key = mode === "agent" ? "agent" : "chat";
    state.chatIds[key] = id || null;
    state.conversationSettings[key] = settings ? { ...settings } : null;
    activateConversation(key);
}

function resetConversation(mode = null) {
    if (mode) {
        const key = mode === "agent" ? "agent" : "chat";
        state.chatIds[key] = null;
        state.conversationSettings[key] = null;
        activateConversation(key);
    } else {
        state.chatIds = { chat: null, agent: null };
        state.conversationSettings = { chat: null, agent: null };
        state.chatId = null;
    }

    state.history = [];
}

function record(role, content) {
    state.history.push({ role, content });

    if (state.history.length > 30) {
        state.history = state.history.slice(-30);
    }
}

module.exports = {
    state,
    activateConversation,
    setConversation,
    resetConversation,
    record
};
