"use strict";

const { CONFIG } = require("../config");
const { auth, getAccessToken } = require("./auth");

const fmt = n => Number(n || 0).toLocaleString("fr-FR");
const pct = n => `${(Math.round(Number(n || 0) * 10) / 10).toLocaleString("fr-FR")} %`;
const when = iso => (iso ? String(iso).slice(0, 16).replace("T", " ") : "?");

/** GET JSON authentifié sur l'API (un seul nouvel essai après renouvellement du token sur 401). */
async function getJson(path, retried = false) {
    const token = await getAccessToken(retried);
    const response = await fetch(`${CONFIG.apiUrl}${path}`, {
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            "User-Agent": CONFIG.userAgent,
            "francestudent-client-platform": CONFIG.clientPlatform,
            "francestudent-client-version": CONFIG.clientVersion,
            "francestudent-device-id": auth.deviceId,
            Origin: CONFIG.origin,
            Referer: `${CONFIG.origin}/`
        },
        signal: AbortSignal.timeout(15_000)
    });

    if (response.status === 401 && !retried) return getJson(path, true);
    if (!response.ok) {
        const error = new Error(`HTTP ${response.status} sur ${path}`);
        error.status = response.status;
        throw error;
    }

    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        const error = new Error(`Réponse illisible sur ${path} (JSON attendu).`);
        error.status = response.status;
        throw error;
    }
}

/** GET /chats/{chatId}/usage -> ChatUsageDto { tokenUsage, contextUsagePercent }. */
const fetchChatUsage = chatId => getJson(`/chats/${encodeURIComponent(chatId)}/usage`);

/** GET /user/usage -> UserUsageDto { rateLimits[], rateLimitPowerUpActive, chatBudget }. */
const fetchUserUsage = () => getJson("/user/usage");

/** Pourcentage de contexte utilisé (0 à 100), ou null si le champ est absent, invalide ou en cas d'erreur. */
async function getContextUsage(chatId) {
    if (!chatId) return null;
    try {
        const dto = await fetchChatUsage(chatId);
        const raw = dto?.contextUsagePercent;
        if (raw === null || raw === undefined || raw === "") return null;
        const value = Number(raw);
        if (!Number.isFinite(value)) return null;
        return Math.min(100, Math.max(0, value));
    } catch {
        return null;
    }
}

/** Volume de la session locale (compteurs de api.usage). */
function describeSession(usage) {
    if (!usage || !usage.requests) return ["Session : aucune requête envoyée."];
    const tokens = usage.reported > 0
        ? `${fmt(usage.inputTokens)} tokens en entrée` +
          `${usage.cachedTokens > 0 ? ` dont ${fmt(usage.cachedTokens)} en cache` : ""}` +
          `, ${fmt(usage.outputTokens)} en sortie` +
          `${usage.reported < usage.requests ? ` (usage fourni pour ${usage.reported}/${usage.requests} réponse(s))` : ""}`
        : `≈ ${fmt(Math.round(usage.chars / 3.5))} tokens (estimation)`;
    return [`Session : ${usage.requests} requête(s), ${fmt(usage.chars)} caractères envoyés, ${tokens}`];
}

/** ChatUsageDto -> lignes lisibles. */
function describeChatUsage(label, dto) {
    if (!dto) return [`${label} : usage indisponible.`];
    const t = dto.tokenUsage || {};
    return [
        `${label} : ${fmt(t.totalTokenCount)} tokens au total ` +
            `(prompt ${fmt(t.promptTokenCount)}, réponse ${fmt(t.candidatesTokenCount)}, ` +
            `raisonnement ${fmt(t.reasoningTokenCount)}) ; contexte utilisé ${pct(dto.contextUsagePercent)}`
    ];
}

/** UserUsageDto -> lignes lisibles (limites par type et bucket). */
function describeUserUsage(dto) {
    if (!dto) return ["Compte : usage indisponible."];
    const lines = [];
    for (const rl of dto.rateLimits || []) {
        lines.push(
            `Limite ${rl.type ?? "?"}/${rl.bucket ?? "?"} : ${fmt(rl.used)}/${fmt(rl.limit)} ` +
                `(${pct(rl.usedPercent)} utilisés, ${fmt(rl.remaining)} restants), remise à zéro ${when(rl.resetAt)}`
        );
    }
    if (!lines.length) lines.push("Compte : aucune limite renvoyée.");
    if (dto.rateLimitPowerUpActive) lines.push("Power-up actif (limites doublées).");
    return lines;
}

module.exports = { getJson, fetchChatUsage, fetchUserUsage, getContextUsage, describeSession, describeChatUsage, describeUserUsage };
