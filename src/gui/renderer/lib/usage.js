/**
 * Lecture défensive des données d'usage affichées dans la barre de chat :
 * contexte de la conversation (store.status.context, en %) et budget de chat
 * (GET /user/usage → chatBudget).
 */
import { percent } from "./format.js";

const unwrap = (value) => (value && typeof value === "object" && value.data && !Array.isArray(value.data) ? value.data : value);

/** Niveau d'alerte d'un pourcentage : low, medium (≥ 70) ou high (≥ 90). */
export function level(value) {
    const p = percent(value);
    if (p == null) return "";
    return p >= 90 ? "high" : p >= 70 ? "medium" : "low";
}

/** Budget de chat : { percent, resetAt } ou null s'il n'est pas fourni. */
export function chatBudget(usageData) {
    const limits = unwrap(usageData && usageData.limits) || {};
    const budget = limits.chatBudget;
    if (!budget || typeof budget !== "object") return null;
    const used = percent(budget.usedPercent);
    if (used == null) return null;
    return { percent: used, resetAt: budget.resetAt || null };
}

const CATEGORY_LABELS = {
    system_prompt: "Prompt système",
    tools: "Outils",
    rules: "Règles",
    skills: "Skills",
    mcp: "MCP",
    conversation: "Conversation"
};

const count = (value) => {
    const n = Number(value);
    return value != null && value !== "" && Number.isFinite(n) && n >= 0 ? n : null;
};

/** Nombre de tokens lisible : 950, 12,3 k, 1,2 M. */
export function formatTokens(value) {
    const n = count(value);
    if (n == null) return "—";
    const fr = (x) => x.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
    if (n >= 1_000_000) return `${fr(n / 1_000_000)} M`;
    if (n >= 1000) return `${fr(n / 1000)} k`;
    return String(Math.round(n));
}

/**
 * Détails du contexte (GET /chats/{id}/context, via store.status.contextDetails) :
 * { usedTokens, contextWindow, freeTokens, measured, modelName, compactThreshold,
 *   categories: [{ key, label, tokens, share }] } ou null.
 */
export function contextDetails(status) {
    const d = status && status.contextDetails;
    if (!d || typeof d !== "object") return null;
    const windowSize = count(d.contextWindow) || null;
    const categories = (Array.isArray(d.categories) ? d.categories : [])
        .map((c) => ({ key: String((c && c.key) || ""), tokens: count(c && c.tokens) || 0 }))
        .filter((c) => c.key && c.tokens > 0)
        .map((c) => ({
            ...c,
            label: CATEGORY_LABELS[c.key] || c.key,
            share: windowSize ? Math.min(100, (c.tokens / windowSize) * 100) : null
        }));
    return {
        usedTokens: count(d.usedTokens),
        contextWindow: windowSize,
        freeTokens: count(d.freeTokens),
        measured: d.measured !== false,
        modelName: d.modelName || null,
        compactThreshold: count(d.compactThreshold),
        categories
    };
}

/**
 * Seuil de compaction lisible. L'unité n'est pas documentée : une valeur ≤ 100
 * est lue comme un pourcentage, au-delà comme un nombre de tokens.
 */
export function compactThresholdLabel(details) {
    const t = details ? details.compactThreshold : null;
    if (!t) return null;
    return t <= 100 ? `Compaction vers ${Math.round(t)} %` : `Compaction vers ${formatTokens(t)} tokens`;
}

/** Contexte utilisé (0 à 100) ou null. */
export function contextPercent(status) {
    return status && typeof status.context === "number" ? percent(status.context) : null;
}
