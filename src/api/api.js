"use strict";

const { CONFIG } = require("../config");
const { state } = require("../state");
const { ui } = require("../ui-bridge");
const { auth, getAccessToken } = require("./auth");

const fmt = n => Number(n).toLocaleString("fr-FR");
const MAX_REQUEST_FAILURES = 2;
/** Limite du backend : 32 résultats au maximum par envoi. */
const MAX_TOOL_RESULTS = 32;

// Volume réellement envoyé (chaque tentative HTTP compte, relances comprises).
const usage = { requests: 0, chars: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, reported: 0 };

/** Ajoute à `usage` les tokens réels si l'événement fournit un bloc usage (Responses ou Chat Completions). */
function recordTokens(raw) {
    if (!raw || typeof raw !== "object") return;
    const input = Number(raw.input_tokens ?? raw.prompt_tokens);
    const output = Number(raw.output_tokens ?? raw.completion_tokens);
    if (!Number.isFinite(input) && !Number.isFinite(output)) return;
    const cached = Number(
        raw.input_tokens_details?.cached_tokens ??
        raw.prompt_tokens_details?.cached_tokens ??
        raw.cached_tokens
    );
    usage.inputTokens += Number.isFinite(input) ? input : 0;
    usage.outputTokens += Number.isFinite(output) ? output : 0;
    usage.cachedTokens += Number.isFinite(cached) ? cached : 0;
    usage.reported++;
}

async function apiHeaders() {
    const token = await getAccessToken();

    return {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": CONFIG.userAgent,
        "francestudent-client-platform": CONFIG.clientPlatform,
        "francestudent-client-version": CONFIG.clientVersion,
        "francestudent-device-id": auth.deviceId,
        Origin: CONFIG.origin,
        Referer: `${CONFIG.origin}/`
    };
}

/** POST /chats/{chatId}/stream/cancel : arrête la génération côté serveur (idempotent). */
async function cancelStream(chatId) {
    if (!chatId) return false;
    try {
        const response = await fetch(`${CONFIG.apiUrl}/chats/${encodeURIComponent(chatId)}/stream/cancel`, {
            method: "POST",
            headers: { ...(await apiHeaders()), Accept: "application/json" },
            signal: AbortSignal.timeout(10_000)
        });
        return response.ok;
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Outils client : format des appels et des résultats
// ---------------------------------------------------------------------------

/**
 * Normalise un appel de `completed.message.toolCalls`.
 * Accepte callId / call_id ; `arguments` peut arriver en objet ou en chaîne JSON.
 * Un argument illisible donne `argsError` : la boucle renverra alors un résultat isError
 * (il faut répondre à tous les callId, même aux appels invalides).
 */
function normalizeToolCall(raw) {
    if (!raw || typeof raw !== "object") return null;
    const callId = raw.callId ?? raw.call_id;
    const name = raw.name;
    if (typeof callId !== "string" || !callId || typeof name !== "string" || !name) return null;

    let args = raw.arguments ?? {};
    let argsError = null;
    if (typeof args === "string") {
        try {
            args = args.trim() ? JSON.parse(args) : {};
        } catch {
            argsError = "Arguments JSON invalides.";
            args = {};
        }
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) {
        argsError ??= "Les arguments doivent être un objet JSON.";
        args = {};
    }
    const call = { callId, name, arguments: args };
    if (argsError) call.argsError = argsError;
    return call;
}

/** Appels à exécuter. Seule source de vérité : completed.message.toolCalls. */
function extractToolCalls(message) {
    const list = message?.toolCalls;
    if (!Array.isArray(list)) return [];
    return list.map(normalizeToolCall).filter(Boolean);
}

/** Met un résultat au format attendu par POST /chats/{chatId}. */
function normalizeToolResult(result) {
    const callId = result?.callId ?? result?.call_id;
    if (typeof callId !== "string" || !callId) {
        throw new Error("Résultat d'outil sans callId.");
    }
    let output = result.output;
    if (output === undefined || output === null) output = "";
    else if (typeof output !== "string" && typeof output !== "object") output = String(output);
    const isError = result.isError === true || result.is_error === true;
    return isError ? { callId, output, isError: true } : { callId, output };
}

/** Messages clairs pour les erreurs propres aux outils client (pas de repli silencieux). */
function explainClientToolsError(error) {
    const text = String(error.message);
    if (error.status === 403) {
        error.message = `Outils client non activés pour ce compte (flag 2026_11_client_tools). ${text}`;
    } else if (error.status === 400 && /client tools are not supported/i.test(text)) {
        error.message =
            "Ce modèle ne prend pas en charge les outils client (Gemini). " +
            `Choisissez un modèle OpenAI ou Claude. ${text}`;
    } else if (error.status === 400 && /missing:|unknown:/i.test(text)) {
        error.message = `Résultats d'outils incohérents avec les appels en attente (bug du client). ${text}`;
    }
    return error;
}

// ---------------------------------------------------------------------------
// Relances
// ---------------------------------------------------------------------------

/**
 * Exécute `attempt()` avec la politique de relance commune (au plus MAX_REQUEST_FAILURES) :
 * - erreurs réseau ou de flux (sans statut) et 5xx : relance immédiate ;
 * - 401 : jeton renouvelé puis relance ;
 * - 408, 409, 429 : relance après un délai croissant, sauf statut listé dans `noRetry` ;
 * - autres 4xx, annulation, erreur non réessayable, budget épuisé : erreur définitive.
 */
async function withRetry(attempt, { noRetry = new Set() } = {}) {
    const retryableClientStatuses = new Set([401, 408, 409, 429]);
    const waitDelaysMs = [3000, 8000, 15000];
    let failures = 0;

    while (true) {
        try {
            return await attempt();
        } catch (error) {
            // Annulation volontaire (Ctrl+C) : jamais de relance.
            if (error.cancelled) throw error;
            // Ex. CONTENT_POLICY_VIOLATION : un nouvel envoi peut aggraver la situation.
            if (error.retryable === false) throw error;

            const status = error.status;
            const isClientError = status >= 400 && status < 500;

            if (isClientError && (!retryableClientStatuses.has(status) || noRetry.has(status))) {
                throw error;
            }
            // Budget de chat épuisé : inutile de relancer avant la réinitialisation.
            if (status === 429 && /budget exhausted/i.test(String(error.message))) {
                const reset = /Reset at (\S+?Z)/.exec(String(error.message))?.[1];
                const when = reset ? new Date(reset) : null;
                const label = when && !Number.isNaN(when.getTime())
                    ? ` jusqu'au ${when.toLocaleString("fr-FR")}`
                    : "";
                error.message = `Budget de chat épuisé${label}. ${error.message}`;
                throw error;
            }
            if (failures >= MAX_REQUEST_FAILURES) throw error;

            failures++;
            ui.debug(
                `Requête échouée (${failures}/${MAX_REQUEST_FAILURES})` +
                `${status ? ` [HTTP ${status}]` : ""} : ${error.message}`
            );

            if (status === 401) {
                await getAccessToken(true);
            } else if (status === 408 || status === 409 || status === 429) {
                const delay = waitDelaysMs[Math.min(failures, waitDelaysMs.length) - 1];
                ui.debug(`Attente de ${delay / 1000} s avant le nouvel essai`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }

            ui.debug("Nouvel essai de la requête");
        }
    }
}

// ---------------------------------------------------------------------------
// Points d'entrée
// ---------------------------------------------------------------------------

function checkLength(message) {
    if (typeof message === "string" && message.length > CONFIG.maxMessageChars) {
        throw new Error(
            `Message trop long : ${fmt(message.length)} caractères ` +
            `(limite ${fmt(CONFIG.maxMessageChars)}).`
        );
    }
}

/**
 * Envoie un message et renvoie le tour complet : { text, toolCalls, chatId }.
 *
 * options.clientTools : noms d'outils client proposés au modèle (ordre stable = cache).
 * options.onDelta     : callback appelé à chaque morceau de texte.
 * options.fresh       : conversation neuve, jamais rangée dans state (ex. résumé du projet).
 * options.agentId     : modèle à utiliser (défaut : state.model).
 * options.signal      : annulation demandée par le code appelant.
 * options.onInterrupt : remplace l'enregistrement du gestionnaire Ctrl+C de l'interface.
 */
async function requestTurn(message, options = {}) {
    checkLength(message);
    try {
        const turn = await withRetry(() => streamOnce({ kind: "message", message }, options));
        // Pièces jointes envoyées : elles ne sont pas renvoyées avec le message suivant.
        if (!options.fresh) state.pendingFiles = [];
        return turn;
    } catch (error) {
        throw options.clientTools?.length ? explainClientToolsError(error) : error;
    }
}

/**
 * POST /chats/{chatId} avec toolResults : renvoie les résultats de TOUS les appels en
 * attente (une seule fois chacun), puis lit la suite du tour : { text, toolCalls, chatId }.
 *
 * options.content     : texte facultatif joint aux résultats (« et ajoute un test »).
 * options.clientTools : facultatif ; sans lui, le backend garde les outils du tour précédent.
 *
 * 409 (aucun appel en attente) et 400 (missing / unknown) ne sont jamais relancés :
 * ce sont des bugs du client.
 */
async function sendToolResults(chatId, results, options = {}) {
    if (!chatId) throw new Error("sendToolResults : chatId manquant.");
    if (!Array.isArray(results) || results.length === 0) {
        throw new Error("sendToolResults : aucun résultat à envoyer.");
    }
    if (results.length > MAX_TOOL_RESULTS) {
        throw new Error(
            `sendToolResults : ${results.length} résultats (maximum ${MAX_TOOL_RESULTS} par envoi).`
        );
    }
    const toolResults = results.map(normalizeToolResult);
    if (new Set(toolResults.map(r => r.callId)).size !== toolResults.length) {
        throw new Error("sendToolResults : callId en double.");
    }
    checkLength(options.content);

    try {
        return await withRetry(
            () => streamOnce({ kind: "results", chatId, toolResults }, options),
            { noRetry: new Set([409]) }
        );
    } catch (error) {
        if (error.status === 409) {
            error.message = `Aucun appel d'outil en attente sur ce chat (bug du client). ${error.message}`;
            throw error;
        }
        throw explainClientToolsError(error);
    }
}

/**
 * Raccourci sans outils client : renvoie uniquement le texte de la réponse.
 * Utilisé par project-context.js (résumé du projet, avec fresh: true).
 */
async function requestModel(message, options = {}) {
    const turn = await requestTurn(message, { ...options, clientTools: undefined });
    return turn.text;
}

// ---------------------------------------------------------------------------
// Une requête HTTP + lecture de la réponse
// ---------------------------------------------------------------------------

/**
 * request.kind === "message" : POST /chats/stream (texte, éventuellement clientTools).
 * request.kind === "results" : POST /chats/{chatId} avec toolResults.
 * Renvoie { text, toolCalls, chatId }.
 */
async function streamOnce(request, options) {
    const isResults = request.kind === "results";
    const sentChars = isResults
        ? JSON.stringify(request.toolResults).length + (options.content?.length ?? 0)
        : request.message.length;

    usage.requests++;
    usage.chars += sentChars;
    ui.debug(
        `${isResults ? `Résultats d'outils (${request.toolResults.length})` : "Requête"} : ` +
        `${fmt(sentChars)} caractères (~${fmt(Math.round(sentChars / 3.5))} tokens)`
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.timeoutMs);
    let idle;
    const armIdle = ms => { clearTimeout(idle); idle = setTimeout(() => controller.abort(), ms); };
    armIdle(CONFIG.firstByteTimeoutMs);

    // Une seule conversation suivie : state.chatIds.chat. options.fresh ouvre une conversation à part.
    const storeChatId = !options.fresh;
    const currentChatId = options.fresh ? null : state.chatIds.chat;

    let streamChatId = isResults ? request.chatId : currentChatId;

    // Ctrl+C : coupe le flux local et demande l'arrêt de la génération côté serveur.
    let cancelled = false;
    const interrupt = (notice = true) => {
        if (cancelled) return;
        cancelled = true;
        controller.abort();
        if (streamChatId) {
            if (notice) ui.warn("Ctrl+C : arrêt de la génération en cours.");
            cancelStream(streamChatId).then(ok => {
                if (!ok) ui.debug(`Annulation du flux ${streamChatId} non confirmée par l'API.`);
            });
        }
    };
    const registerInterrupt = options.onInterrupt ??
        (process.stdin.isTTY ? handler => ui.onInterrupt(handler) : null);
    const offInterrupt = registerInterrupt ? registerInterrupt(() => interrupt()) : null;

    // options.signal : annulation demandée par le code appelant.
    const onAbort = () => interrupt(false);
    if (options.signal?.aborted) interrupt(false);
    else options.signal?.addEventListener("abort", onAbort, { once: true });

    const clientTools = Array.isArray(options.clientTools) && options.clientTools.length
        ? { clientTools: options.clientTools }
        : {};

    // Pièces jointes Files v2 (interface graphique) : seulement sur la conversation suivie.
    const attachedFiles = storeChatId && Array.isArray(state.pendingFiles) && state.pendingFiles.length
        ? { files: [...state.pendingFiles] }
        : {};

    let url;
    let body;
    if (isResults) {
        url = `${CONFIG.apiUrl}/chats/${encodeURIComponent(request.chatId)}`;
        body = {
            toolResults: request.toolResults,
            ...(options.content ? { content: options.content } : {}),
            ...clientTools
        };
    } else {
        url = `${CONFIG.apiUrl}/chats/stream`;
        body = {
            agentId: options.agentId ?? state.model,
            chatId: currentChatId,
            enableCanvas: false,
            enableWebSearch: options.fresh ? false : state.webSearch,
            images: [],
            initialContent: request.message,
            ...attachedFiles,
            isIncognito: state.incognito,
            isPrivate: state.private,
            ...clientTools,
            ...(state.frProject?.id && storeChatId && !currentChatId
                ? { projectId: state.frProject.id }
                : {})
        };
    }

    let reader;
    let output = "";
    let toolCalls = [];
    let completed = false;

    function rememberChatId(id) {
        if (!id) return;
        streamChatId = id;
        if (storeChatId) {
            state.chatIds.chat = id;
            state.chatId = id;
        }
    }

    function appendText(text) {
        if (typeof text !== "string" || !text) return;
        output += text;
        options.onDelta?.(text);
    }

    /** Événement final : texte de secours + appels d'outils à exécuter. */
    function handleCompleted(data) {
        if (!output && typeof data.message?.content === "string") {
            appendText(data.message.content);
        }
        toolCalls = extractToolCalls(data.message);
    }

    function onEvent(name, data) {
        if (data.chat_id) rememberChatId(data.chat_id);

        if (name === "response.completed" || name === "completed") {
            recordTokens(data.response?.usage ?? data.usage ?? data.message?.usage);
        }

        switch (name) {
            case "response.output_text.delta":
                appendText(data.delta);
                return false;
            case "response.output_text.done":
                if (!output) appendText(data.text);
                return false;
            case "response.failed":
            case "error":
                return { error: data };
            case "response.completed":
                return data.response?.error ? { error: data.response.error } : false;
            case "completed":
                handleCompleted(data);
                return true;
            // Les function_call relayés pendant le flux (outils de la plateforme compris)
            // sont ignorés : seul completed.message.toolCalls doit être exécuté.
            default:
                return false;
        }
    }

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: await apiHeaders(),
            body: JSON.stringify(body),
            signal: controller.signal
        });

        if (!response.ok) {
            const text = await response.text();
            const error = new Error(`HTTP ${response.status}: ${text.slice(0, 1200)}`);
            error.status = response.status;
            throw error;
        }

        // POST /chats/{chatId} n'est pas confirmé en SSE : une réponse JSON est aussi acceptée.
        const contentType = response.headers?.get?.("content-type") ?? "";
        if (/application\/json/i.test(contentType)) {
            const data = await response.json();
            rememberChatId(data.chat_id ?? data.chatId);
            recordTokens(data.usage ?? data.message?.usage);
            handleCompleted(data.message ? data : { message: data });
            completed = true;
        } else {
            if (!response.body) throw new Error("L'API n'a pas fourni de flux SSE.");
            reader = response.body.getReader();
            ({ completed } = await readSse(reader, { armIdle, onEvent }));
        }

        if (!output.trim() && toolCalls.length === 0) {
            throw new Error(completed ? "Réponse vide du modèle." : "Flux interrompu sans réponse.");
        }

        // Rattache explicitement la conversation au projet FranceStudent sélectionné
        // (le champ projectId de POST /chats/stream ne suffit pas côté site).
        if (!isResults && storeChatId && state.frProject?.id && state.chatIds.chat) {
            await require("./fr-projects").ensureAttached(state.chatIds.chat);
        }

        return { text: output, toolCalls, chatId: streamChatId };
    } catch (error) {
        if (cancelled) {
            const interrupted = new Error("Génération annulée (Ctrl+C).");
            interrupted.cancelled = true;
            throw interrupted;
        }
        throw error;
    } finally {
        offInterrupt?.();
        options.signal?.removeEventListener("abort", onAbort);
        clearTimeout(timeout);
        clearTimeout(idle);

        if (reader) {
            await reader.cancel().catch(() => {});
            try { reader.releaseLock(); } catch { /* déjà libéré */ }
        }
    }
}

/**
 * Lit un flux SSE et appelle onEvent(name, data) pour chaque événement JSON.
 * onEvent renvoie true (fin normale), { error } (fin en erreur) ou false (continuer).
 * Lève une erreur si le flux signale un échec. Renvoie { completed }.
 */
async function readSse(reader, { armIdle, onEvent }) {
    const decoder = new TextDecoder();
    let buffer = "";
    let eventName = "";
    let eventData = [];
    let completed = false;
    let streamError = null;

    function dispatchEvent() {
        const name = eventName;
        const payload = eventData.join("\n");
        eventName = "";
        eventData = [];

        if (!payload) return;
        if (payload === "[DONE]") {
            completed = true;
            return;
        }

        let data;
        try {
            data = JSON.parse(payload);
        } catch {
            throw new Error(`Événement SSE JSON invalide : ${name || "message"}`);
        }

        const result = onEvent(name, data);
        if (result === true) {
            completed = true;
        } else if (result && result.error) {
            streamError = result.error;
            completed = true;
        }
    }

    function parseLine(line) {
        if (line === "") {
            dispatchEvent();
            return;
        }
        if (line.startsWith(":")) return;

        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);

        if (field === "event") eventName = value;
        else if (field === "data") eventData.push(value);
    }

    function consumeLines(final = false) {
        while (!completed) {
            const index = buffer.search(/[\r\n]/);
            if (index === -1) break;

            const newline = buffer[index];
            // "\r" en fin de buffer : peut-être un "\r\n" coupé en deux.
            if (newline === "\r" && index === buffer.length - 1 && !final) break;

            const separatorLength = newline === "\r" && buffer[index + 1] === "\n" ? 2 : 1;
            const line = buffer.slice(0, index);
            buffer = buffer.slice(index + separatorLength);
            parseLine(line);
        }
    }

    while (!completed) {
        const { done, value } = await reader.read();
        armIdle(CONFIG.idleTimeoutMs);

        if (done) {
            buffer += decoder.decode();
            consumeLines(true);
            if (!completed && buffer) {
                parseLine(buffer);
                buffer = "";
            }
            if (!completed) dispatchEvent();
            break;
        }

        buffer += decoder.decode(value, { stream: true });
        consumeLines();
    }

    if (streamError) {
        const details = typeof streamError.error === "object" && streamError.error
            ? streamError.error
            : streamError;
        const error = new Error(`Erreur du flux : ${JSON.stringify(streamError)}`);
        const code = details?.code ?? streamError?.code;
        if (code) error.code = code;
        const retryable = details?.retryable ?? streamError?.retryable;
        if (typeof retryable === "boolean") error.retryable = retryable;
        // Violation de politique : jamais de relance (risque de suspension du compte).
        if (/POLICY/i.test(String(code ?? ""))) error.retryable = false;
        throw error;
    }

    return { completed };
}

module.exports = {
    requestTurn,
    sendToolResults,
    requestModel,
    cancelStream,
    extractToolCalls,
    MAX_REQUEST_FAILURES,
    MAX_TOOL_RESULTS,
    usage
};
