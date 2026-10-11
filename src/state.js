"use strict";

const { CONFIG } = require("./config");

const state = {
    chatId: null,
    model: CONFIG.defaultAgentId,
    webSearch: false,
    private: true,
    incognito: false,
    workspace: null,
    history: [],
    mode: "auto",        // auto | agent | chat
    autoApprove: false   // true = plus de confirmation pour la session
};

function resetConversation() {
    state.chatId = null;
    state.history = [];
}

function record(role, content) {
    state.history.push({ role, content });

    if (state.history.length > 30) {
        state.history = state.history.slice(-30);
    }
}

module.exports = { state, resetConversation, record };
