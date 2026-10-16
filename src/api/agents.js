"use strict";

/**
 * Agents (modèles) disponibles sur l'API FranceStudent.
 *
 *   GET {apiUrl}/chats/agents -> Agent[]
 *   Agent : { id: int32, name, namespace, description, model, modelProvider, isActive, isDefault }
 *
 * La liste est mise en cache 5 minutes. Si l'API ne répond pas, on se replie sur
 * KNOWN_MODELS (src/config.js).
 */

const { KNOWN_MODELS } = require("../config");
const account = require("./account");

const TTL_MS = 5 * 60_000;
let cache = null; // { agents, at }

function normalize(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = Number(raw.id);
    if (!Number.isInteger(id)) return null;
    return {
        id,
        name: String(raw.name || raw.model || id),
        model: raw.model ? String(raw.model) : "",
        provider: raw.modelProvider ? String(raw.modelProvider) : "",
        description: raw.description ? String(raw.description) : "",
        isDefault: raw.isDefault === true,
        isActive: raw.isActive !== false
    };
}

const fallbackAgents = () => KNOWN_MODELS.map(normalize).filter(Boolean);

/** Appel direct de l'API (agents actifs seulement). */
async function fetchAgents() {
    const data = await account.getJson("/chats/agents");
    const list = Array.isArray(data) ? data : data && Array.isArray(data.agents) ? data.agents : [];
    return list.map(normalize).filter(agent => agent && agent.isActive);
}

/** { agents, source: "api" | "local", error? } ; ne lève jamais. */
async function listAgents({ refresh = false } = {}) {
    if (!refresh && cache && Date.now() - cache.at < TTL_MS) return { agents: cache.agents, source: "api" };
    try {
        const agents = await fetchAgents();
        if (!agents.length) throw new Error("liste d'agents vide");
        cache = { agents, at: Date.now() };
        return { agents, source: "api" };
    } catch (error) {
        return { agents: cache ? cache.agents : fallbackAgents(), source: cache ? "api" : "local", error };
    }
}

const norm = s => String(s || "").toLowerCase().replace(/[\s_.-]+/g, " ").trim();

/**
 * Trouve un agent par identifiant, nom ou nom de modèle (insensible à la casse,
 * espaces / tirets / points ignorés, préfixe ou fragment unique accepté).
 * -> { agent, matches }
 */
function resolveAgent(query, agents) {
    const q = String(query || "").trim();
    if (!q) return { agent: null, matches: [] };

    if (/^-?\d+$/.test(q)) {
        const agent = agents.find(a => a.id === Number(q)) || null;
        return { agent, matches: agent ? [agent] : [] };
    }

    const nq = norm(q);
    const exact = agents.filter(a => norm(a.name) === nq || (a.model && norm(a.model) === nq));
    if (exact.length === 1) return { agent: exact[0], matches: exact };
    if (exact.length > 1) return { agent: null, matches: exact };

    const partial = agents.filter(a => norm(a.name).includes(nq) || (a.model && norm(a.model).includes(nq)));
    return { agent: partial.length === 1 ? partial[0] : null, matches: partial };
}

/** Nom lisible d'un agent (cache API, sinon KNOWN_MODELS, sinon l'identifiant). */
function agentName(id) {
    const all = cache ? cache.agents : fallbackAgents();
    const agent = all.find(a => a.id === Number(id));
    return agent ? agent.name : String(id);
}

function resetCache() {
    cache = null;
}

module.exports = { fetchAgents, listAgents, resolveAgent, agentName, normalize, resetCache };
