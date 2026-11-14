"use strict";

const { CONFIG } = require("./config");

const state = {
    chatId: null,
    // La case "agent" ne sert plus qu'à relire les anciennes données (projects.json, /chat-id).
    chatIds: { chat: null, agent: null },
    conversationSettings: { chat: null, agent: null },
    model: CONFIG.defaultAgentId,
    webSearch: false,
    private: true,
    incognito: false,
    workspace: null,
    frProject: null,     // projet FranceStudent { id, name } rattaché aux nouvelles conversations
    history: [],
    mode: "auto",        // auto (outils client) | chat (aucun outil)
    autoApprove: false,  // true = plus de confirmation pour la session
    contextUsagePercent: null, // contexte utilisé par la conversation chat (0 à 100), null si inconnu
    contextDetails: null, // détails de GET /chats/{id}/context (account.normalizeContext), null si inconnus
    compactSummary: null, // résumé de /compact, joint au premier message de la conversation suivante
    pendingFiles: []     // ids Files v2 joints au prochain message (consommés une seule fois)
};

function activateConversation(mode) {
    const key = mode === "agent" ? "agent" : "chat";
    state.chatId = state.chatIds[key];

    const settings = state.conversationSettings[key];
    if (settings) {
        for (const name of ["model", "webSearch", "private", "incognito"]) {
            if (settings[name] !== undefined) state[name] = settings[name];
        }
    }

    return key;
}

function setConversation(mode, id, settings = null) {
    const key = mode === "agent" ? "agent" : "chat";
    state.chatIds[key] = id || null;
    state.conversationSettings[key] = settings ? { ...settings } : null;
    state.compactSummary = null;
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
