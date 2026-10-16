"use strict";

const { state, record, activateConversation } = require("../state");
const api = require("../api/api");
const projectContext = require("../project/project-context");
const conversations = require("../project/conversations");

/**
 * Logique métier d'un message en mode chat, sans aucun affichage.
 * onDelta reçoit chaque morceau de texte pendant le streaming.
 * Renvoie { response, newChatId } : newChatId est l'identifiant de la
 * conversation si elle vient d'être créée par ce message, sinon null.
 */
async function send(input, { onDelta } = {}) {
    activateConversation("chat");
    const hadChat = Boolean(state.chatIds.chat);

    // Premier message d'une conversation dans un projet : on y joint le contexte.
    const context =
        state.workspace && !state.chatId
            ? projectContext.promptContext(150_000)
            : "";

    // Premier message d'une conversation : pré-prompt utilisateur/projet et faits appris.
    let preprompt = "";
    if (!state.chatId) {
        try {
            preprompt = require("../project/profile").buildPreprompt();
        } catch {
            preprompt = "";
        }
    }

    const body = context ? `${context}\n\nQUESTION : ${input}` : input;
    const message = preprompt ? `${preprompt}\n\n${body}` : body;

    const response = await api.requestModel(message, {
        onDelta(text) {
            if (onDelta) onDelta(text);
        }
    });

    record("user", input);
    record("assistant", response);

    let newChatId = null;

    if (state.chatId) {
        const settings = {
            model: state.model,
            webSearch: state.webSearch,
            private: state.private,
            incognito: state.incognito,
            autoApprove: state.autoApprove
        };
        state.conversationSettings.chat = settings;
        await conversations.touch({
            id: state.chatId,
            firstMessage: input,
            model: state.model,
            workspace: state.workspace,
            mode: "chat",
            settings
        });

        if (!hadChat) newChatId = state.chatId;
    }

    return { response, newChatId };
}

module.exports = { send };
