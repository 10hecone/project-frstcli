"use strict";

/**
 * Pourcentage de contexte et compaction manuelle de la conversation (/compact).
 *
 * Pas de compaction automatique : l'API rejoue l'historique à chaque tour et les
 * fournisseurs le compactent eux-mêmes. /compact sert à repartir d'une conversation
 * neuve : le modèle résume la session, puis le résumé est joint au premier message
 * de la conversation suivante (core/chat.js, buildMessage), sans requête d'amorçage.
 */

const { state, record, activateConversation, resetConversation } = require("../state");
const api = require("../api/api");
const account = require("../api/account");

/* ---------- Pourcentage de contexte ---------- */

/**
 * Détails via GET /chats/{id}/context d'abord, repli sur le pourcentage de /usage.
 * Passe par l'objet account pour rester remplaçable dans les tests.
 */
async function loadContext(chatId) {
    const details = typeof account.getContextDetails === "function"
        ? await Promise.resolve(account.getContextDetails(chatId)).catch(() => null)
        : null;
    if (details) return { value: details.percent, details };
    return { value: await account.getContextUsage(chatId), details: null };
}

/**
 * Met à jour state.contextUsagePercent pour la conversation chat, sans bloquer l'appelant.
 * Renvoie la promesse (utile aux tests) ; ne lève jamais d'erreur.
 */
function refreshContextUsage(chatId = state.chatIds.chat) {
    if (!chatId) return Promise.resolve(null);
    return Promise.resolve()
        .then(() => loadContext(chatId))
        .then(({ value, details }) => {
            // La conversation a pu changer entre-temps : on ignore une valeur périmée.
            if (state.chatIds.chat === chatId) {
                state.contextUsagePercent = value;
                state.contextDetails = details;
            }
            return value;
        })
        .catch(() => null);
}

/* ---------- Compaction de la session (/compact) ---------- */

// Taille maximale du résumé joint au premier message de la conversation suivante.
const COMPACT_MAX_SUMMARY_CHARS = 20_000;

// Aucun outil n'est proposé pendant la compaction. Si le modèle en appelle quand même,
// l'API exige une réponse pour chaque appel : on les refuse au plus MAX_REFUSED_ROUNDS fois.
const MAX_REFUSED_ROUNDS = 2;
const NO_TOOLS_OUTPUT = "Outils indisponibles pendant la compaction : réponds directement en texte.";

function clip(text, max) {
    const value = String(text);
    return value.length <= max ? value : `${value.slice(0, max)}\n... [tronqué]`;
}

/** Demande de résumé structuré envoyée dans la conversation actuelle. */
function buildCompactPrompt(instruction = "") {
    const extra = String(instruction || "").trim();
    return (
        "Résume cette session de travail pour la poursuivre dans une nouvelle conversation. " +
        "Réponds en français, en texte simple (sans appel d'outil), avec ces rubriques :\n" +
        "1. Objectif\n2. Décisions prises\n3. Fichiers modifiés (chemins)\n4. Tâches restantes\n" +
        "Sois concis et précis : chemins, noms de fonctions, commandes utiles." +
        (extra ? `\n\nConsigne de l'utilisateur pour ce résumé : ${extra}` : "")
    );
}

/** Texte du résumé, limité à COMPACT_MAX_SUMMARY_CHARS. */
function extractSummary(raw) {
    return clip(String(raw || "").trim(), COMPACT_MAX_SUMMARY_CHARS);
}

/** Envoie un message sans outil dans la conversation chat et renvoie le texte complet. */
async function askText(message) {
    let turn = await api.requestTurn(message, {});
    const texts = [turn.text];

    for (let round = 0; turn.toolCalls?.length && round < MAX_REFUSED_ROUNDS; round++) {
        const results = turn.toolCalls.map(call => ({
            callId: call.callId,
            output: NO_TOOLS_OUTPUT,
            isError: true
        }));
        turn = await api.sendToolResults(turn.chatId ?? state.chatIds.chat, results);
        texts.push(turn.text);
    }

    if (turn.toolCalls?.length) {
        throw new Error("Le modèle demande des outils au lieu de répondre : compaction annulée.");
    }
    return texts.filter(text => text && text.trim()).join("\n\n");
}

/**
 * Résume la conversation chat, puis repart d'une conversation vide : le résumé
 * (state.compactSummary) sera joint au premier message suivant, qui crée la nouvelle
 * conversation. Aucune requête supplémentaire. Le journal local (/undo, /changes)
 * n'est pas touché. En cas d'échec, la conversation actuelle est conservée.
 * Renvoie { summary, chars, previousChatId }.
 */
async function compactSession({ instruction = "" } = {}) {
    activateConversation();
    const previousChatId = state.chatIds.chat;
    if (!previousChatId) {
        throw new Error("Aucune conversation à résumer.");
    }
    const previousSettings = state.conversationSettings.chat;

    const summary = extractSummary(await askText(buildCompactPrompt(instruction)));
    if (!summary) {
        throw new Error("Résumé vide : la session n'a pas été compactée.");
    }

    resetConversation();
    state.conversationSettings.chat = previousSettings ? { ...previousSettings } : null;
    activateConversation();
    state.contextUsagePercent = null;
    state.contextDetails = null;
    state.compactSummary = summary;
    record("assistant", `Résumé de la session précédente :\n${summary}`);

    return { summary, chars: summary.length, previousChatId };
}

module.exports = {
    refreshContextUsage,
    compactSession,
    buildCompactPrompt,
    extractSummary,
    COMPACT_MAX_SUMMARY_CHARS
};
