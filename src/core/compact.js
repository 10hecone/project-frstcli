"use strict";

/**
 * Pourcentage de contexte et compaction de la conversation (/compact, compaction automatique).
 * Repris de l'ancien agent (src/agent/agent.js) pour la conversation unique « chat ».
 */

const { CONFIG } = require("../config");
const { state, record, activateConversation, setConversation, resetConversation } = require("../state");
const { ui } = require("../ui-bridge");
const api = require("../api/api");
const account = require("../api/account");
const conversations = require("../project/conversations");
const { instructionsBlock } = require("../project/instructions");

/* ---------- Pourcentage de contexte ---------- */

/**
 * Met à jour state.contextUsagePercent pour la conversation chat, sans bloquer l'appelant.
 * Renvoie la promesse (utile aux tests) ; ne lève jamais d'erreur.
 */
function refreshContextUsage(chatId = state.chatIds.chat) {
    if (!chatId) return Promise.resolve(null);
    return Promise.resolve()
        .then(() => account.getContextUsage(chatId))
        .then(value => {
            // La conversation a pu changer entre-temps : on ignore une valeur périmée.
            if (state.chatIds.chat === chatId) state.contextUsagePercent = value;
            return value;
        })
        .catch(() => null);
}

/* ---------- Compaction de la session ---------- */

// Taille maximale du résumé gardé pour la nouvelle conversation.
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

/**
 * Premier message de la nouvelle conversation : le résumé sert de contexte de départ.
 * `instructions` : bloc FRSTCLI.md (instructionsBlock), repris car la nouvelle
 * conversation ne passe pas par le premier message habituel de core/chat.js.
 */
function buildCompactSeed(summary, instructions = "") {
    return (
        "Reprise de session : voici le résumé de la conversation précédente. " +
        "Garde-le comme contexte pour les prochaines demandes. Réponds seulement « Compris. ».\n\n" +
        summary +
        (instructions ? `\n\n${instructions}` : "")
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
 * Résume la conversation chat puis ouvre une nouvelle conversation (chatId neuf)
 * qui commence par ce résumé. Le journal local (/undo, /changes) n'est pas touché.
 * En cas d'échec, la conversation précédente est conservée.
 * Renvoie { summary, chars, previousChatId, chatId, contextUsagePercent }.
 */
async function compactSession({ instruction = "" } = {}) {
    activateConversation("chat");
    const previousChatId = state.chatIds.chat;
    if (!previousChatId) {
        throw new Error("Aucune conversation à résumer.");
    }
    const previousSettings = state.conversationSettings.chat;
    const previousHistory = state.history;
    const previousPercent = state.contextUsagePercent;

    const summary = extractSummary(await askText(buildCompactPrompt(instruction)));
    if (!summary) {
        throw new Error("Résumé vide : la session n'a pas été compactée.");
    }

    const instructions = state.workspace ? await instructionsBlock(state.workspace) : "";

    resetConversation("chat");
    state.contextUsagePercent = null;

    try {
        await askText(buildCompactSeed(summary, instructions));
    } catch (error) {
        setConversation("chat", previousChatId, previousSettings);
        state.history = previousHistory;
        state.contextUsagePercent = previousPercent;
        throw error;
    }

    state.conversationSettings.chat = previousSettings ? { ...previousSettings } : null;
    activateConversation("chat");
    record("assistant", `Résumé de la session précédente :\n${summary}`);

    if (state.chatIds.chat) {
        try {
            await conversations.touch({
                id: state.chatIds.chat,
                firstMessage: "Session compactée (/compact)",
                model: state.model,
                workspace: state.workspace,
                mode: "chat",
                settings: state.conversationSettings.chat
            });
        } catch {
            // Historique local indisponible : sans effet sur la compaction.
        }
    }

    const contextUsagePercent = await refreshContextUsage();

    return {
        summary,
        chars: summary.length,
        previousChatId,
        chatId: state.chatIds.chat,
        contextUsagePercent
    };
}

/**
 * Compaction automatique, appelée entre deux demandes (jamais pendant une ronde d'outils).
 * Se déclenche si le contexte atteint CONFIG.autoCompactThreshold (%), sauf si
 * CONFIG.autoCompact est désactivé. Renvoie le résultat de compactSession,
 * ou null si rien n'a été fait. Ne lève jamais d'erreur.
 */
async function maybeAutoCompact() {
    if (!CONFIG.autoCompact) return null;
    const threshold = Number(CONFIG.autoCompactThreshold);
    const percent = state.contextUsagePercent;
    if (!state.chatIds.chat || typeof percent !== "number") return null;
    if (!(threshold > 0) || percent < threshold) return null;

    ui.warn(
        `Contexte à ${Math.round(percent)} % (seuil ${threshold} %) : compaction automatique de la session. ` +
        "FS_AUTO_COMPACT=0 pour la désactiver."
    );

    try {
        const result = await compactSession();
        ui.info(
            `Session compactée : résumé de ${result.chars} caractères` +
            (result.contextUsagePercent == null ? "." : `, contexte à ${Math.round(result.contextUsagePercent)} %.`)
        );
        return result;
    } catch (error) {
        ui.warn(`Compaction automatique impossible : ${error.message}`);
        return null;
    }
}

module.exports = {
    refreshContextUsage,
    compactSession,
    maybeAutoCompact,
    buildCompactPrompt,
    buildCompactSeed,
    extractSummary,
    COMPACT_MAX_SUMMARY_CHARS
};
