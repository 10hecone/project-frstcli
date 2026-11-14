"use strict";

const { state, record, activateConversation } = require("../state");
const { CONFIG } = require("../config");
const { ui } = require("../ui-bridge");
const api = require("../api/api");
const projectContext = require("../project/project-context");
const conversations = require("../project/conversations");
const memory = require("../project/memory");
const { instructionsBlock } = require("../project/instructions");
const registry = require("../tools/registry");
const { summarizeResult } = require("../tools/tools");
const compact = require("./compact");

// Limites de l'API pour les résultats d'outils (client-tools.md).
const MAX_RESULT_CHARS = 40_000;
const MAX_RESULTS_CHARS = 120_000;

// Rondes d'outils accordées en plus quand l'utilisateur accepte de continuer.
const ROUND_EXTENSION = 20;

const fmt = n => Number(n).toLocaleString("fr-FR");

/**
 * Outils client proposés au modèle. La liste est figée (ordre du catalogue) : elle doit
 * rester identique d'un message à l'autre pour garder le cache de prompt.
 * - Sans projet sélectionné : aucun outil, le modèle répond comme un chat simple.
 * - /plan (readOnly) : seulement les outils de lecture, quel que soit le mode.
 * - Mode chat (/mode chat) : aucun outil.
 */
function toolsFor({ readOnly = false } = {}) {
    if (!state.workspace) return [];
    if (readOnly) return registry.READ_TOOLS;
    if (state.mode === "chat") return [];
    return registry.CLIENT_TOOLS;
}

/**
 * Premier message d'une conversation : pré-prompt, FRSTCLI.md et contexte projet.
 * Ensuite : le message seul (le modèle a déjà reçu le reste, le début de la conversation
 * ne change plus et reste dans le cache de prompt).
 */
async function buildMessage(input) {
    if (state.chatId) return input;

    const context = state.workspace ? projectContext.promptContext(150_000) : "";
    const instructions = state.workspace ? await instructionsBlock(state.workspace) : "";

    let preprompt = "";
    try {
        preprompt = require("../project/profile").buildPreprompt();
    } catch {
        preprompt = "";
    }

    const body = context ? `${context}\n\nQUESTION : ${input}` : input;
    return [preprompt, instructions, body].filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------------------
// Résultats d'outils
// ---------------------------------------------------------------------------

/** Résultat brut d'un outil → texte envoyé au modèle. */
function toOutput(result) {
    if (typeof result === "string") return result;
    if (result === undefined || result === null) return "";
    try {
        return JSON.stringify(result);
    } catch {
        return String(result);
    }
}

/** Coupe un texte à `max` caractères, marque de troncature comprise. */
function clip(text, max) {
    if (text.length <= max) return text;
    const marker = `\n... [tronqué : ${text.length} caractères au total]`;
    return text.slice(0, Math.max(0, max - marker.length)) + marker;
}

/**
 * Applique les limites de l'API : 40 000 caractères par résultat, 120 000 par envoi.
 * Les résultats courts restent entiers ; les longs se partagent le budget restant.
 */
function fitOutputs(results, { perResult = MAX_RESULT_CHARS, total = MAX_RESULTS_CHARS } = {}) {
    const fitted = results.slice();
    const order = results
        .map((_, index) => index)
        .sort((a, b) => results[a].output.length - results[b].output.length);

    let remaining = total;
    order.forEach((index, rank) => {
        const share = Math.floor(remaining / (order.length - rank));
        const output = clip(results[index].output, Math.min(perResult, share));
        fitted[index] = { ...results[index], output };
        remaining -= output.length;
    });
    return fitted;
}

function summarize(name, result) {
    try {
        return summarizeResult(name, result ?? {});
    } catch {
        return "OK";
    }
}

/** Affiche le résultat d'un appel et le met au format de l'API ({ callId, output, isError? }). */
function report(call, outcome) {
    if (outcome.status === "rejected") {
        const message = outcome.reason?.message || String(outcome.reason);
        ui.result(message, { tone: "error" });
        return { callId: call.callId, output: `Erreur : ${message}`, isError: true };
    }

    const result = outcome.value;
    ui.result(summarize(call.name, result));

    if (result?.denied) {
        return {
            callId: call.callId,
            output: result.message || "Action refusée par l'utilisateur. Ne la redemande pas.",
            isError: true
        };
    }
    return { callId: call.callId, output: toOutput(result) };
}

/**
 * Exécute les appels d'un tour et renvoie exactement un résultat par callId, dans l'ordre.
 * - Lectures consécutives (list_directory, read_file, search_files) : en parallèle.
 * - edit_file, write_file, run_command : une par une. L'outil demande lui-même la
 *   confirmation et reste limité au projet. Ces appels séparent les groupes de lectures :
 *   une lecture voit toujours les modifications demandées avant elle.
 * - Refus de l'utilisateur, arguments invalides, outil non proposé ou erreur : isError.
 */
async function executeCalls(calls, allowed) {
    const results = [];
    let reads = [];

    async function flushReads() {
        if (!reads.length) return;
        const group = reads;
        reads = [];

        const settled = await Promise.allSettled(
            group.map(call => registry.runClientTool(call.name, call.arguments, allowed))
        );
        group.forEach((call, i) => {
            ui.tool(call.name, registry.describeClientCall(call.name, call.arguments));
            results.push(report(call, settled[i]));
        });
    }

    for (const call of calls) {
        if (!call.argsError && registry.READ_TOOLS.includes(call.name)) {
            reads.push(call);
            continue;
        }

        await flushReads();
        ui.tool(call.name, registry.describeClientCall(call.name, call.arguments));

        let outcome;
        if (call.argsError) {
            outcome = { status: "rejected", reason: new Error(call.argsError) };
        } else {
            try {
                const value = await registry.runClientTool(call.name, call.arguments, allowed);
                outcome = { status: "fulfilled", value };
            } catch (error) {
                outcome = { status: "rejected", reason: error };
            }
        }
        results.push(report(call, outcome));
    }

    await flushReads();
    return results;
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

/** Envoie les résultats d'une ronde ; spinner jusqu'au premier morceau de texte. */
async function sendResults(chatId, results, onDelta) {
    const spin = ui.spinner("Réflexion");
    try {
        return await api.sendToolResults(chatId, results, {
            onDelta(text) {
                spin.stop();
                if (onDelta) onDelta(text);
            }
        });
    } finally {
        spin.stop();
    }
}

/** Enregistre la conversation dans l'historique local. Renvoie son id si elle vient d'être créée. */
async function saveConversation(input, hadChat) {
    if (!state.chatId) return null;

    const settings = {
        model: state.model,
        webSearch: state.webSearch,
        private: state.private,
        incognito: state.incognito,
        autoApprove: state.autoApprove
    };
    state.conversationSettings.chat = settings;

    try {
        await conversations.touch({
            id: state.chatId,
            firstMessage: input,
            model: state.model,
            workspace: state.workspace,
            mode: "chat",
            settings
        });
    } catch (error) {
        // Historique local indisponible : sans effet sur la réponse.
        ui.debug(`Historique local non mis à jour : ${error.message}`);
    }

    return hadChat ? null : state.chatId;
}

function reportChanges(before) {
    const changed = memory.sessionChanges() - before;
    if (changed > 0) {
        ui.info(
            `${changed} modification(s) enregistrée(s) | /undo annule la dernière | /changes en liste l'historique`
        );
    }
}

/** Coût d'une demande depuis `before` (copie de api.usage prise avant le premier envoi). */
function reportUsage(before) {
    const requests = api.usage.requests - before.requests;
    const chars = api.usage.chars - before.chars;

    if (!(requests > 0)) return;

    const reported = (api.usage.reported ?? 0) - (before.reported ?? 0);
    let tokens;

    if (reported > 0) {
        const input = (api.usage.inputTokens ?? 0) - (before.inputTokens ?? 0);
        const output = (api.usage.outputTokens ?? 0) - (before.outputTokens ?? 0);
        const cached = (api.usage.cachedTokens ?? 0) - (before.cachedTokens ?? 0);
        tokens =
            `${fmt(input)} tokens en entrée` +
            `${cached > 0 ? ` dont ${fmt(cached)} en cache` : ""}, ${fmt(output)} en sortie` +
            `${reported < requests ? ` ; usage fourni pour ${reported}/${requests} réponse(s)` : ""}`;
    } else {
        tokens = `≈ ${fmt(Math.round(chars / 3.5))} tokens`;
    }

    ui.info(
        `Coût de la demande : ${requests} requête(s), ${fmt(chars)} caractères envoyés (${tokens})`
    );
}

/**
 * Traite un message utilisateur jusqu'à la réponse finale du modèle.
 *
 * Boucle des outils client : tant que la réponse contient des appels
 * (completed.message.toolCalls), ils sont exécutés en local, puis tous les résultats
 * partent en un seul envoi (POST /chats/{chatId}). Chaque envoi compte comme une requête.
 *
 * options.onDelta     : texte du modèle pendant le streaming (toutes les rondes).
 * options.onToolCalls : appelé avant chaque ronde d'outils (ex. vider l'affichage en cours).
 * options.readOnly    : seulement list_directory, read_file et search_files (/plan).
 *
 * Renvoie { response, newChatId } : newChatId est l'identifiant de la conversation
 * si elle vient d'être créée par ce message, sinon null.
 * Les erreurs (Ctrl+C compris) remontent après l'enregistrement de la conversation.
 */
async function send(input, { onDelta, onToolCalls, readOnly = false } = {}) {
    activateConversation("chat");
    const hadChat = Boolean(state.chatIds.chat);
    const clientTools = toolsFor({ readOnly });
    const changesBefore = memory.sessionChanges();
    const usageBefore = { ...api.usage };
    const texts = [];
    let rounds = 0;
    let failure = null;

    try {
        const message = await buildMessage(input);
        let turn = await api.requestTurn(message, { clientTools, onDelta });
        texts.push(turn.text);

        let maxRounds = CONFIG.maxAgentTurns;
        for (let round = 1; turn.toolCalls?.length; round++) {
            if (round > maxRounds) {
                const more = await ui.confirm(
                    `Limite de ${maxRounds} rondes d'outils atteinte. Continuer ${ROUND_EXTENSION} rondes de plus ?`,
                    { force: true }
                );
                if (!more) {
                    // Les appels restent en attente côté API : au prochain message,
                    // elle les rejoue au modèle comme « non exécutés ».
                    ui.warn("Arrêt demandé : les derniers appels d'outils n'ont pas été exécutés.");
                    break;
                }
                maxRounds += ROUND_EXTENSION;
            }

            if (onToolCalls) onToolCalls(turn.toolCalls);
            const results = fitOutputs(await executeCalls(turn.toolCalls, clientTools));
            rounds++;
            turn = await sendResults(turn.chatId ?? state.chatId, results, onDelta);
            texts.push(turn.text);
        }
    } catch (error) {
        failure = error;
    }

    const response = texts.filter(text => text && text.trim()).join("\n\n");

    if (!failure) {
        record("user", input);
        record("assistant", response);
    }

    // Même après une erreur ou un Ctrl+C, la conversation et les modifications existent déjà.
    const newChatId = await saveConversation(input, hadChat);
    // Pourcentage de contexte (barre d'état, compaction automatique) : mis à jour sans attendre.
    compact.refreshContextUsage();
    reportChanges(changesBefore);
    // Le coût n'est affiché que si des outils ont multiplié les requêtes.
    if (rounds > 0) reportUsage(usageBefore);

    if (failure) throw failure;
    return { response, newChatId };
}

module.exports = { send, executeCalls, fitOutputs, toolsFor, reportUsage, buildMessage };
