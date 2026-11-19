"use strict";

const { CONFIG } = require("./config");

const state = {
    chatId: null,
    chatIds: { chat: null },
    conversationSettings: { chat: null },
    model: CONFIG.defaultAgentId,
    webSearch: false,
    private: true,
    incognito: false,
    workspace: null,
    frProject: null,     // projet FranceStudent { id, name } rattaché aux nouvelles conversations
    history: [],
    contextUsagePercent: null, // contexte utilisé par la conversation chat (0 à 100), null si inconnu
    contextDetails: null, // détails de GET /chats/{id}/context (account.normalizeContext), null si inconnus
    compactSummary: null, // résumé de /compact, joint au premier message de la conversation suivante
    todos: [],    // liste de tâches de la session (core/todos.js, commande virtuelle todo), vidée par /new
    pendingFiles: []     // ids Files v2 joints au prochain message (consommés une seule fois)
};

/** Rend active la conversation enregistrée : son id et ses réglages. */
function activateConversation() {
    state.chatId = state.chatIds.chat;

    const settings = state.conversationSettings.chat;
    if (settings) {
        for (const name of ["model", "webSearch", "private", "incognito"]) {
            if (settings[name] !== undefined) state[name] = settings[name];
        }
    }
}

function setConversation(id, settings = null) {
    state.chatIds.chat = id || null;
    state.conversationSettings.chat = settings ? { ...settings } : null;
    state.compactSummary = null;
    activateConversation();
}

function resetConversation() {
    state.chatIds = { chat: null };
    state.conversationSettings = { chat: null };
    state.chatId = null;
    state.history = [];
    state.compactSummary = null;
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
