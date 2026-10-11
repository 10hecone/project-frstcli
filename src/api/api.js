"use strict";

const { CONFIG } = require("../config");
const { state } = require("../state");
const { ui } = require("../cli/ui");
const { auth, getAccessToken } = require("./auth");

const fmt = n => Number(n).toLocaleString("fr-FR");

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

/**
 * options.fresh   : true = nouvelle conversation à chaque appel (le chatId
 *                   n'est ni envoyé ni mémorisé). Indispensable en mode
 *                   agent : tout le contexte est renvoyé à chaque tour.
 * options.onDelta : callback appelé à chaque morceau de texte.
 *
 * Sur un 401, le token est renouvelé et la requête retentée une fois.
 */
async function requestModel(message, options = {}) {
    if (message.length > CONFIG.maxMessageChars) {
        throw new Error(
            `Message trop long : ${fmt(message.length)} caractères ` +
            `(limite ${fmt(CONFIG.maxMessageChars)}).`
        );
    }

    try {
        return await requestModelOnce(message, options);
    } catch (error) {
        if (error.status !== 401 || options.retried) throw error;

        ui.debug("401 reçu : renouvellement du token puis nouvel essai");

        await getAccessToken(true);

        return requestModelOnce(message, { ...options, retried: true });
    }
}

async function requestModelOnce(message, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.timeoutMs);

    let reader;

    try {
        const response = await fetch(`${CONFIG.apiUrl}/chats/stream`, {
            method: "POST",
            headers: await apiHeaders(),
            body: JSON.stringify({
                agentId: state.model,
                chatId: options.fresh ? null : state.chatId,
                enableCanvas: false,
                enableWebSearch: options.fresh ? false : state.webSearch,
                images: [],
                initialContent: message,
                isIncognito: state.incognito,
                isPrivate: state.private
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            const text = await response.text();
            const error = new Error(`HTTP ${response.status}: ${text.slice(0, 1200)}`);

            error.status = response.status;
            throw error;
        }

        if (!response.body) {
            throw new Error("L'API n'a pas fourni de flux SSE.");
        }

        reader = response.body.getReader();

        const decoder = new TextDecoder();

        let buffer = "";
        let eventName = "";
        let eventData = [];
        let output = "";
        let completed = false;
        let streamError = null;

        function appendText(text) {
            if (typeof text !== "string" || !text) return;
            output += text;
            options.onDelta?.(text);
        }

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

            if (data.chat_id && !options.fresh) {
                state.chatId = data.chat_id;
            }

            switch (name) {
                case "response.output_text.delta":
                    appendText(data.delta);
                    break;

                case "response.output_text.done":
                    if (!output) appendText(data.text);
                    break;

                case "response.failed":
                case "error":
                    streamError = data;
                    completed = true;
                    break;

                case "response.completed":
                    if (data.response?.error) {
                        streamError = data.response.error;
                        completed = true;
                    }
                    break;

                case "completed":
                    if (!output && typeof data.message?.content === "string") {
                        appendText(data.message.content);
                    }
                    completed = true;
                    break;

                default:
                    break;
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

                const separatorLength =
                    newline === "\r" && buffer[index + 1] === "\n" ? 2 : 1;

                const line = buffer.slice(0, index);
                buffer = buffer.slice(index + separatorLength);

                parseLine(line);
            }
        }

        while (!completed) {
            const { done, value } = await reader.read();

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
            throw new Error(`Erreur du flux : ${JSON.stringify(streamError)}`);
        }

        if (!output.trim()) {
            throw new Error(
                completed ? "Réponse vide du modèle." : "Flux interrompu sans réponse."
            );
        }

        return output;
    } finally {
        clearTimeout(timeout);

        if (reader) {
            await reader.cancel().catch(() => {});
            try { reader.releaseLock(); } catch { /* déjà libéré */ }
        }
    }
}

module.exports = { requestModel };
