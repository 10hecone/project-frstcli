"use strict";

/**
 * Panneau MCP de l'interface graphique (barre latérale).
 *
 * Ce module ne dépend pas d'Electron, comme workspace.js : testable avec node --test.
 * La page peut seulement lister, activer ou désactiver, connecter et lancer une connexion OAuth.
 * Ajouter, retirer un serveur ou appeler un outil passe par une saisie visible (/mcp …) ou par l'IA,
 * avec confirmation : aucun canal ne le permet ici.
 *
 * Rien de secret ne sort de list() : ni valeur d'env, ni en-tête, ni jeton. Les URL perdent
 * identifiants, paramètres et fragment ; les messages d'erreur passent par redact().
 *
 * Dépendances injectables (tests) : manager, config, setDisabled, oauth, ui, env, isRunning.
 */

const mcpConfig = require("../mcp/config");
const { redact, createRedactor, secretsOf } = require("../mcp/redact");
const { maskArg } = require("../mcp/cli");

// Même règle que config.js : le nom reçu de la page est revalidé ici.
const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_DETAIL = 300;
const MAX_REASON = 300;
const BUSY_REASON = "Une demande est en cours : attends la fin ou interromps-la.";

// États exposés à la page (le reste est ramené à « idle »).
const STATUSES = new Set(["connected", "connecting", "idle", "failed", "needs-approval", "needs-auth", "rejected", "disabled"]);

const short = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** URL affichable : schéma, hôte et chemin seulement (ni identifiants, ni paramètres, ni fragment). */
function urlDetail(value) {
    try {
        const url = new URL(String(value ?? ""));
        return `${url.protocol}//${url.host}${url.pathname}`;
    } catch {
        return "URL invalide";
    }
}

/** Commande et arguments (jamais les valeurs d'env), ou URL nettoyée. */
function detailOf(server) {
    if (!server) return "";
    if (server.type === "stdio") {
        const args = Array.isArray(server.args) ? server.args : [];
        return short([redact(server.command), ...args.map(maskArg)].join(" "), MAX_DETAIL);
    }
    return short(urlDetail(server.url), MAX_DETAIL);
}

function statusOf(item) {
    if (item.status === "closed") return "idle";
    return STATUSES.has(item.status) ? item.status : "idle";
}

function createMcpPanel({
    manager = null,
    config = mcpConfig,
    setDisabled = null,
    oauth = null,
    ui = null,
    env = process.env,
    isRunning = () => false
} = {}) {
    const mgr = () => manager || require("../mcp/manager").getManager();
    const disable = () => setDisabled || require("../mcp/disabled").setDisabled;
    const auth = () => oauth || require("../mcp/oauth");
    const port = () => ui || require("../ui-bridge").ui;

    const refuse = (reason) => ({ ok: false, reason: redact(reason) });

    /** Nom revalidé et action refusée pendant un tour : null si tout va bien, sinon le refus. */
    function check(name) {
        if (typeof name !== "string" || !NAME_RE.test(name)) return refuse("Nom de serveur MCP invalide.");
        if (isRunning()) return refuse(BUSY_REASON);
        return null;
    }

    async function findServer(name) {
        const { servers } = await config.loadServers(mgr().root);
        return servers.find((item) => item.name === name) || null;
    }

    /** { servers: [{ name, scope, transport, detail, status, reason, toolCount, enabled }], warnings } */
    async function list() {
        const current = mgr();
        const [{ servers: items, warnings = [] }, { servers: definitions }] = await Promise.all([
            current.list(),
            config.loadServers(current.root)
        ]);
        const byName = new Map(definitions.map((server) => [server.name, server]));
        // Masqueur propre à chaque serveur : ses valeurs d'env et d'en-têtes développées.
        const redactorOf = (server) => {
            try {
                return server ? createRedactor(secretsOf(config.expandServer(server, env))) : redact;
            } catch {
                return redact;
            }
        };
        return {
            servers: items.map((item) => {
                const status = statusOf(item);
                const hide = redactorOf(byName.get(item.name));
                return {
                    name: String(item.name),
                    scope: String(item.scope),
                    transport: String(item.type),
                    detail: detailOf(byName.get(item.name)),
                    status,
                    reason: item.error ? short(hide(item.error), MAX_REASON) : null,
                    toolCount: Number.isInteger(item.toolCount) ? item.toolCount : null,
                    enabled: status !== "disabled"
                };
            }),
            warnings: warnings.map((warning) => short(redact(warning), MAX_REASON))
        };
    }

    async function setEnabled(name, enabled) {
        const refused = check(name);
        if (refused) return refused;
        const on = enabled === true;
        try {
            if (!(await findServer(name))) return refuse(`Serveur MCP inconnu : « ${name} ».`);
            const current = mgr();
            await disable()(current.root, name, !on);
            if (!on) await current.close(name);
            return { ok: true, enabled: on };
        } catch (error) {
            return refuse(error.message);
        }
    }

    /** Connecte ou reconnecte ; un serveur du projet en attente ouvre la question d'approbation. */
    async function connect(name) {
        const refused = check(name);
        if (refused) return refused;
        try {
            const connection = await mgr().reconnect(name, { ui: port() });
            let toolCount = null;
            if (connection && typeof connection.listTools === "function") {
                try {
                    toolCount = (await connection.listTools()).length;
                } catch {
                    // Le serveur ne propose pas d'outils.
                }
            }
            return { ok: true, toolCount };
        } catch (error) {
            return refuse(error.message);
        }
    }

    /** Connexion OAuth (navigateur), puis reconnexion. */
    async function login(name) {
        const refused = check(name);
        if (refused) return refused;
        try {
            const server = await findServer(name);
            if (!server) return refuse(`Serveur MCP inconnu : « ${name} ».`);
            if (server.type === "stdio") return refuse("OAuth ne concerne que les serveurs http et sse.");
            if (Object.keys(server.headers || {}).some((header) => header.toLowerCase() === "authorization")) {
                return refuse("Ce serveur a déjà un en-tête Authorization : OAuth n'est pas utilisé.");
            }
            await auth().login(config.expandServer(server, env), { ui: port() });
        } catch (error) {
            return refuse(error.message);
        }
        return connect(name);
    }

    return { list, setEnabled, connect, login };
}

module.exports = { NAME_RE, createMcpPanel, detailOf, urlDetail };
