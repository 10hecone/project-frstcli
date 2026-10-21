"use strict";

/**
 * Diagnostic du pourcentage de contexte (« ctx 0 % » dans la barre d'état).
 *
 * Usage :
 *   node scripts/debug-ctx.js            envoie un vrai message en mode agent, puis interroge l'usage
 *   node scripts/debug-ctx.js <chatId>   interroge seulement l'usage d'une conversation existante
 *
 * Affiche, à plusieurs instants, le DTO brut de GET /chats/{id}/usage
 * et la valeur normalisée renvoyée par getContextUsage.
 */

const { state } = require("../src/state");
const api = require("../src/api/api");
const account = require("../src/api/account");
const { loadSession } = require("../src/api/auth");

const DELAIS_MS = [0, 1000, 3000, 6000, 10000];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function interroger(chatId, depart) {
    const t = `${((Date.now() - depart) / 1000).toFixed(1)} s`;
    try {
        const dto = await account.fetchChatUsage(chatId);
        console.log(`[${t}] DTO brut :`, JSON.stringify(dto));
        const brut = dto?.contextUsagePercent;
        console.log(`[${t}] contextUsagePercent : ${JSON.stringify(brut)} (type ${typeof brut})`);
    } catch (error) {
        console.log(`[${t}] fetchChatUsage en erreur : ${error.message}`);
    }
    const valeur = await account.getContextUsage(chatId);
    console.log(`[${t}] getContextUsage -> ${JSON.stringify(valeur)} (type ${typeof valeur})`);
}

async function main() {
    // Charge la session enregistrée (cookie), comme initAuth le fait au démarrage du CLI.
    await loadSession();
    let chatId = process.argv[2] || null;

    if (!chatId) {
        console.log("Envoi d'un message de test en mode agent...");
        const reponse = await api.requestModel("Réponds seulement : OK.", {
            conversationMode: "agent",
            onInterrupt: () => null
        });
        console.log("Réponse du modèle :", String(reponse ?? "").slice(0, 200));
        chatId = state.chatIds?.agent || null;
        console.log("state.chatIds :", JSON.stringify(state.chatIds));
    }

    if (!chatId) {
        console.log("Aucun chatId disponible : impossible d'interroger l'usage.");
        process.exitCode = 1;
        return;
    }

    console.log(`chatId interrogé : ${chatId}`);
    const depart = Date.now();
    let attendu = 0;
    for (const delai of DELAIS_MS) {
        await pause(delai - attendu);
        attendu = delai;
        await interroger(chatId, depart);
    }
}

main().catch(error => {
    console.error("Échec du diagnostic :", error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
