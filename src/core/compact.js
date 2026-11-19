"use strict";

/**
 * Pourcentage de contexte et compaction de la conversation (/compact).
 *
 * - Compaction serveur (par défaut) : POST /chats/{id}/context fait résumer l'historique
 *   par le fournisseur ; la conversation (et son id) est conservée.
 * - Résumé local (repli, ou /compact <consigne>) : le modèle résume la session, puis le
 *   résumé est joint au premier message d'une conversation neuve (core/chat.js, buildMessage).
 * - Compaction automatique : avant un message, si le contexte mesuré atteint
 *   CONFIG.autoCompactPercent (FS_AUTO_COMPACT, 0 = désactivée), compaction serveur seulement.
 */

const { state, record, activateConversation, resetConversation } = require("../state");
const { CONFIG } = require("../config");
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

/* ---------- Compaction serveur (POST /chats/{id}/context) ---------- */

/**
 * Fait compacter la conversation chat par le serveur. La conversation est conservée ;
 * state.contextUsagePercent / contextDetails reçoivent l'occupation après compaction.
 * Les erreurs (403 si l'utilisateur n'est pas propriétaire, panne…) sont propagées.
 * Renvoie { mode: "server", chatId, before, details }.
 */
async function compactOnServer(chatId = state.chatIds.chat) {
    if (!chatId) throw new Error("Aucune conversation à compacter.");
    const before = state.contextUsagePercent;
    const details = await account.compactChatContext(chatId);
    if (state.chatIds.chat === chatId) {
        state.contextUsagePercent = details ? details.percent : null;
        state.contextDetails = details;
    }
    return { mode: "server", chatId, before, details };
}

/**
 * /compact : compaction serveur d'abord ; repli sur le résumé local (nouvelle conversation)
 * si elle échoue ou si une consigne de résumé est donnée (le serveur n'en accepte pas).
 * Renvoie le résultat de compactOnServer, ou celui de compactSession avec
 * { mode: "local", serverError } (serverError : message d'échec du serveur, ou null).
 */
async function compactConversation({ instruction = "" } = {}) {
    activateConversation();
    const chatId = state.chatIds.chat;
    if (!chatId) throw new Error("Aucune conversation à résumer.");

    let serverError = null;
    if (!String(instruction || "").trim()) {
        try {
            return await compactOnServer(chatId);
        } catch (error) {
            serverError = error.status === 403
                ? "réservée au propriétaire de la conversation (HTTP 403)"
                : error.message;
        }
    }
    const result = await compactSession({ instruction });
    return { mode: "local", ...result, serverError };
}

/** Seuil de compaction automatique en %, ou 0 si désactivée. */
function autoCompactLimit() {
    const value = Number(CONFIG.autoCompactPercent);
    return Number.isFinite(value) && value > 0 ? Math.min(100, value) : 0;
}

/**
 * Compaction automatique, appelée avant l'envoi d'un message : seulement si le contexte a
 * été mesuré par GET /context (state.contextDetails.measured) et atteint le seuil.
 * Ne lève jamais d'erreur. Renvoie le résultat de compactOnServer, ou null.
 */
async function autoCompact() {
    const limit = autoCompactLimit();
    const chatId = state.chatIds.chat;
    const details = state.contextDetails;
    if (!limit || !chatId || !details || !details.measured) return null;
    if (!(typeof state.contextUsagePercent === "number" && state.contextUsagePercent >= limit)) return null;
    try {
        return await compactOnServer(chatId);
    } catch {
        // Échec : on ne réessaie pas avant la prochaine mesure.
        if (state.contextDetails === details) state.contextDetails = { ...details, measured: false };
        return null;
    }
}

/* ---------- Changement de modèle ---------- */

// Consigne ajoutée à la demande de résumé : le lecteur est un autre modèle.
const SWITCH_INSTRUCTION =
    "Ce résumé sera lu par un autre modèle qui reprend la conversation sans rien connaître d'elle : " +
    "inclus le contexte nécessaire pour continuer sans reposer de questions.";

// Taille maximale d'un message repris dans le résumé de secours.
const FALLBACK_MESSAGE_CHARS = 800;

/** Résumé de secours : derniers échanges de la session, sans appel au modèle. "" si rien. */
function localSummary(history) {
    const lines = (Array.isArray(history) ? history : [])
        .filter(entry => entry && typeof entry.content === "string" && entry.content.trim())
        .map(entry => {
            const who = entry.role === "user" ? "Utilisateur" : "Assistant";
            return `${who} : ${clip(entry.content.trim(), FALLBACK_MESSAGE_CHARS)}`;
        });
    if (!lines.length) return "";
    return clip(
        "(Résumé automatique indisponible : voici les derniers échanges de la conversation.)\n" + lines.join("\n\n"),
        COMPACT_MAX_SUMMARY_CHARS
    );
}

/**
 * Change de modèle en gardant le fil de la conversation : le modèle actuel résume la
 * conversation (comme /compact), puis le nouveau modèle la reprend dans une conversation
 * neuve, le résumé étant joint à son premier message. Si le résumé échoue, les derniers
 * échanges locaux servent de résumé de secours.
 * Sans conversation en cours, seul le modèle change (un résumé /compact en attente est conservé).
 * Renvoie { changed, summarized, fallback, chars, previousChatId }.
 */
async function switchModel(agent) {
    const result = { changed: false, summarized: false, fallback: false, chars: 0, previousChatId: null };
    if (!agent || state.model === agent.id) return result;

    result.changed = true;
    const previousChatId = state.chatIds.chat;

    if (previousChatId) {
        result.previousChatId = previousChatId;
        let summary = "";
        try {
            ({ summary } = await compactSession({ instruction: SWITCH_INSTRUCTION }));
        } catch {
            // Le résumé a échoué (conversation conservée) : repli sur les derniers échanges locaux.
            summary = localSummary(state.history);
            result.fallback = true;
            resetConversation();
            if (summary) {
                state.compactSummary = summary;
                record("assistant", `Résumé de la session précédente :\n${summary}`);
            }
        }
        result.summarized = Boolean(summary);
        result.chars = summary.length;
    }

    state.model = agent.id;
    // Les réglages gardés par compactSession portent l'ancien modèle : activateConversation le remettrait.
    if (state.conversationSettings.chat) state.conversationSettings.chat.model = agent.id;
    state.contextUsagePercent = state.contextDetails = null;
    return result;
}

module.exports = {
    refreshContextUsage,
    compactSession,
    compactOnServer,
    compactConversation,
    autoCompact,
    autoCompactLimit,
    switchModel,
    localSummary,
    buildCompactPrompt,
    extractSummary,
    COMPACT_MAX_SUMMARY_CHARS
};
