"use strict";

/**
 * Masquage des secrets des serveurs MCP.
 *
 * Toute chaîne qui sort du module MCP (erreur, stderr, affichage, résultat renvoyé à l'IA)
 * passe par un masqueur : les valeurs développées d'`env` et d'en-têtes deviennent `***`,
 * les URL perdent leurs identifiants et leurs paramètres sensibles, et les clés sensibles
 * d'un objet affiché sont masquées.
 */

const MASK = "***";

// Clés dont la valeur n'est jamais affichée (env, en-têtes, JSON, paramètres d'URL).
const SENSITIVE_KEY_RE = /token|secret|key|password|passwd|authorization|credential|cookie|session/i;

// Une valeur trop courte (« 1 », « on ») masquée partout rendrait la sortie illisible.
const MIN_SECRET_CHARS = 4;

const URL_RE = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>`]+/g;
const BEARER_RE = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const escapeRe = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Valeurs secrètes d'un serveur développé : valeurs d'env et d'en-têtes (et le jeton d'un « Bearer xxx »). */
function secretsOf(server) {
    const values = new Set();
    const add = value => {
        if (typeof value !== "string") return;
        const trimmed = value.trim();
        if (trimmed.length >= MIN_SECRET_CHARS) values.add(trimmed);
        const scheme = /^\S+\s+(\S{4,})$/.exec(trimmed);
        if (scheme) values.add(scheme[1]);
    };

    for (const value of Object.values(server?.env ?? {})) add(value);
    for (const value of Object.values(server?.headers ?? {})) add(value);

    return [...values];
}

/** URL sans identifiants (`user:mdp@`) ni valeur de paramètre sensible. */
function redactUrl(text) {
    let url;
    try {
        url = new URL(text);
    } catch {
        return String(text).replace(/\/\/[^/@\s]*@/, `//${MASK}@`);
    }

    if (url.username || url.password) {
        url.username = MASK;
        url.password = "";
    }
    for (const name of [...url.searchParams.keys()]) {
        if (SENSITIVE_KEY_RE.test(name)) url.searchParams.set(name, MASK);
    }

    return url.toString().replace(/%2A%2A%2A/g, MASK);
}

/** Masqueur de texte pour une liste de secrets (les plus longs d'abord). */
function createRedactor(secrets = []) {
    const list = [...new Set(secrets.filter(value => typeof value === "string" && value.length >= MIN_SECRET_CHARS))]
        .sort((a, b) => b.length - a.length);
    const pattern = list.length ? new RegExp(list.map(escapeRe).join("|"), "g") : null;

    return function redact(value) {
        let text = value === undefined || value === null ? "" : String(value);
        if (pattern) text = text.replace(pattern, MASK);
        text = text.replace(URL_RE, match => redactUrl(match));
        text = text.replace(BEARER_RE, (_match, scheme) => `${scheme} ${MASK}`);
        return text;
    };
}

/** Masqueur sans secret connu : URL et jetons « Bearer » seulement. */
const redact = createRedactor();

/** Copie d'une valeur JSON dont les clés sensibles sont masquées (les chaînes passent par `redactText`). */
function redactJson(value, redactText = redact, depth = 0) {
    if (depth > 20) return MASK;
    if (typeof value === "string") return redactText(value);
    if (Array.isArray(value)) return value.map(item => redactJson(item, redactText, depth + 1));
    if (!isObject(value)) return value;

    const out = {};
    for (const [key, item] of Object.entries(value)) {
        out[key] = SENSITIVE_KEY_RE.test(key) && item !== null && item !== "" ? MASK : redactJson(item, redactText, depth + 1);
    }
    return out;
}

module.exports = { MASK, SENSITIVE_KEY_RE, secretsOf, redactUrl, createRedactor, redact, redactJson };
