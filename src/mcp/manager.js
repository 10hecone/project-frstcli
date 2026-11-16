"use strict";

const config = require("./config");
const approvals = require("./approvals");
const { McpConnection, McpClientError } = require("./client");
const { redact } = require("./redact");

/*
 * Gestionnaire des serveurs MCP du dossier ouvert.
 *
 * - Démarrage paresseux : un serveur ne se connecte qu'au premier usage.
 * - 8 serveurs connectés au maximum : au-delà, le moins récemment utilisé (et inactif) est arrêté.
 * - Serveurs du projet (.mcp.json) : approbation obligatoire (approvals.js) avant tout démarrage.
 * - Changement de dossier : les serveurs du dossier précédent sont arrêtés.
 * - Sortie du CLI : tous les processus sont arrêtés (killAll, synchrone).
 */

const MAX_CONNECTED = 8;

function unknownServer(name, names) {
    const list = names.length ? `serveurs configurés : ${names.join(", ")}` : "aucun serveur configuré (ajoute-en un avec /mcp add)";
    const error = new McpClientError(`serveur MCP inconnu : « ${name} » (${list})`, { code: "unknown" });
    error.names = names;
    return error;
}

function createMcpManager(options = {}) {
    const {
        loadServers = config.loadServers,
        expandServer = config.expandServer,
        ensureApproved = approvals.ensureApproved,
        statusOf = approvals.statusOf,
        fingerprint = approvals.fingerprint,
        isDisabled = async () => false,
        createConnection = (server, connectionOptions) => new McpConnection(server, connectionOptions),
        connectionOptions = {},
        maxConnected = MAX_CONNECTED,
        env = process.env,
        ui = null
    } = options;

    let root = options.root !== undefined ? options.root : null;
    const connections = new Map(); // nom -> { connection, fingerprint }
    const preparing = new Map(); // nom -> promesse (un seul préparatif à la fois par serveur)

    async function servers() {
        return loadServers(root);
    }

    async function findServer(name) {
        const { servers: list } = await loadServers(root);
        const server = list.find(item => item.name === name);
        if (!server) throw unknownServer(name, list.map(item => item.name));
        return server;
    }

    function isActive(entry) {
        const state = entry.connection.state;
        return state === "connected" || state === "connecting";
    }

    /** Libère une place si 8 serveurs sont déjà connectés (le moins récemment utilisé, s'il est inactif). */
    async function makeRoom(except) {
        const active = [...connections.entries()].filter(([name, entry]) => name !== except && isActive(entry));
        if (active.length < maxConnected) return;

        const idle = active
            .filter(([, entry]) => !entry.connection.busy)
            .sort(([, a], [, b]) => a.connection.lastUsed - b.connection.lastUsed);
        if (!idle.length) {
            throw new McpClientError(`${maxConnected} serveurs MCP sont déjà en cours d'utilisation : réessaie dans un instant`, { code: "busy" });
        }
        await idle[0][1].connection.close();
    }

    async function prepare(name, callUi) {
        const server = await findServer(name);

        if (await isDisabled(server, root)) {
            throw new McpClientError(`le serveur « ${name} » est désactivé (/mcp enable ${name} pour le réactiver)`, { code: "disabled" });
        }

        const decision = await ensureApproved(root, server, { ui: callUi });
        if (decision !== approvals.STATUS.approved) {
            const reason = {
                rejected: `tu as refusé le serveur « ${name} » du projet (/mcp reset-project-choices pour revenir sur ce choix)`,
                untrusted: `le serveur « ${name} » du projet demande un dossier de confiance`,
                pending: `le serveur « ${name} » du projet attend ton approbation (/mcp list dans une session)`
            }[decision] || `le serveur « ${name} » n'est pas approuvé`;
            throw new McpClientError(reason, { code: "not-approved" });
        }

        // L'empreinte porte sur la définition stockée : une modification remplace la connexion.
        const print = fingerprint(server);
        const existing = connections.get(name);
        if (existing && existing.fingerprint === print && existing.connection.state !== "closed") return existing.connection;
        if (existing) {
            connections.delete(name);
            await existing.connection.close({ final: true });
        }

        let expanded;
        try {
            expanded = expandServer(server, env);
        } catch (error) {
            throw new McpClientError(redact(error.message), { code: "config", cause: error });
        }

        const connection = createConnection(expanded, { cwd: root || process.cwd(), env, ...connectionOptions });
        connections.set(name, { connection, fingerprint: print });
        return connection;
    }

    /** Connexion (non démarrée) d'un serveur : vérifie l'existence, l'activation et l'approbation. */
    function get(name, { ui: callUi = ui } = {}) {
        if (preparing.has(name)) return preparing.get(name);
        const pending = prepare(name, callUi).finally(() => preparing.delete(name));
        preparing.set(name, pending);
        return pending;
    }

    /** Connexion démarrée (un seul connect() en vol par serveur, partagé). */
    async function connect(name, opts = {}) {
        const connection = await get(name, opts);
        if (connection.state !== "connected") await makeRoom(name);
        await connection.connect();
        return connection;
    }

    /** État de chaque serveur sans rien démarrer ni rien demander. */
    async function list() {
        const { servers: all, warnings } = await loadServers(root);
        const items = [];

        for (const server of all) {
            const entry = connections.get(server.name);
            const item = { name: server.name, scope: server.scope, type: server.type, status: "idle", error: null, toolCount: null };

            if (await isDisabled(server, root)) {
                item.status = "disabled";
            } else {
                const approval = await statusOf(root, server);
                if (approval !== approvals.STATUS.approved) {
                    item.status = approval === approvals.STATUS.rejected ? "rejected" : "needs-approval";
                } else if (entry && entry.fingerprint === fingerprint(server)) {
                    const status = entry.connection.status();
                    item.status = status.state;
                    item.error = status.error;
                    item.toolCount = status.toolCount;
                }
            }
            items.push(item);
        }
        return { servers: items, warnings };
    }

    /** Connexion existante (sans rien démarrer), ou null. */
    function peek(name) {
        const entry = connections.get(name);
        return entry ? entry.connection : null;
    }

    async function reconnect(name, opts = {}) {
        const entry = connections.get(name);
        if (entry) {
            connections.delete(name);
            await entry.connection.close({ final: true });
        }
        return connect(name, opts);
    }

    async function close(name) {
        const entry = connections.get(name);
        if (!entry) return false;
        connections.delete(name);
        await entry.connection.close({ final: true });
        return true;
    }

    async function closeAll() {
        const entries = [...connections.values()];
        connections.clear();
        await Promise.all(entries.map(entry => entry.connection.close({ final: true }).catch(() => {})));
    }

    /** Arrêt synchrone de tous les processus (process.on("exit") n'attend pas). */
    function killAll() {
        for (const entry of connections.values()) {
            try {
                entry.connection.killSync();
            } catch {
                // déjà arrêté
            }
        }
        connections.clear();
    }

    /** Change de dossier : les serveurs du précédent sont arrêtés, les scopes sont relus au prochain usage. */
    function setRoot(next) {
        const value = next || null;
        if (value === root) return Promise.resolve();
        root = value;
        return closeAll();
    }

    return {
        get root() {
            return root;
        },
        servers,
        list,
        get,
        connect,
        peek,
        reconnect,
        close,
        closeAll,
        killAll,
        setRoot,
        connectionCount: () => [...connections.values()].filter(isActive).length
    };
}

// ---------------------------------------------------------------------------
// Instance partagée par le CLI, la TUI et la GUI
// ---------------------------------------------------------------------------

let shared = null;

/** Suit le dossier ouvert : chaque changement arrête les serveurs du précédent. Renvoie le désabonnement. */
function bindWorkspace(manager, workspace) {
    return workspace.onChange(({ root } = {}) => {
        manager.setRoot(root).catch(() => {});
    });
}

function getManager() {
    if (shared) return shared;

    const { workspace } = require("../core/workspace");
    const { ui } = require("../ui-bridge");

    const { isDisabled } = require("./disabled");

    shared = createMcpManager({ root: workspace.root, ui, isDisabled });
    bindWorkspace(shared, workspace);
    // À la sortie du CLI, aucun serveur ne doit survivre.
    process.once("exit", () => shared.killAll());
    return shared;
}

module.exports = { MAX_CONNECTED, createMcpManager, bindWorkspace, getManager };
