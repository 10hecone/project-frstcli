"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { SSEClientTransport } = require("@modelcontextprotocol/sdk/client/sse.js");
const {
    ToolListChangedNotificationSchema,
    ResourceListChangedNotificationSchema,
    PromptListChangedNotificationSchema
} = require("@modelcontextprotocol/sdk/types.js");

const { CONFIG } = require("../config");
const { IS_WINDOWS, filterEnv, getEnv, killTree, findOnWindows, resolveProgram } = require("../tools/command/program");
const { createRedactor, secretsOf } = require("./redact");

/*
 * Une connexion à un serveur MCP (SDK officiel) : transport, délais, reconnexion, arrêt.
 *
 * États : "idle" (pas démarré ou arrêté après inactivité), "connecting", "connected",
 * "failed" (échec mémorisé : pas de nouvel essai avant reset() ou reconnect()), "needs-auth"
 * (401), "closed" (fermeture définitive). Tout message qui sort d'ici passe par le masqueur.
 */

const STDERR_MAX_CHARS = 8000;
const IDLE_MS = { stdio: 30 * 60_000, http: 5 * 60_000, sse: 5 * 60_000 };
const RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_MS = 1000;
const MAX_PAGES = 20;
const MAX_ERROR_CHARS = 500;

const CLIENT_INFO = { name: "francestudent-cli", version: require("../../package.json").version };

class McpClientError extends Error {
    /** code : not-found, start, timeout, aborted, auth, closed, protocol, unknown, disabled, not-approved, config, busy. */
    constructor(message, { code = "protocol", cause } = {}) {
        super(message);
        this.name = "McpClientError";
        this.code = code;
        if (cause !== undefined) this.cause = cause;
    }
}

const sleep = ms => new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    if (timer.unref) timer.unref();
});

// Rejetée quand le signal est déclenché (Ctrl+C pendant le démarrage d'un serveur).
const whenAborted = signal => new Promise((_resolve, reject) => {
    const fail = () => reject(new McpClientError("appel interrompu", { code: "aborted" }));
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
});

// ---------------------------------------------------------------------------
// Programme d'un serveur stdio
// ---------------------------------------------------------------------------

function notFound(command) {
    let message = `« ${command} » est introuvable dans le PATH : installe-le ou corrige la commande`;
    if (!IS_WINDOWS && process.versions.electron) {
        message += " (une application lancée hors d'un terminal reçoit souvent un PATH réduit : " +
            "indique le chemin complet dans « command »)";
    }
    return new McpClientError(message, { code: "not-found" });
}

function isExecutable(target) {
    try {
        fs.accessSync(target, fs.constants.X_OK);
        return fs.statSync(target).isFile();
    } catch {
        return false;
    }
}

/**
 * Programme réellement lancé : { command, args }. Jamais de repli sur l'exécutable courant
 * (sous Electron, ce serait une seconde application). Un .cmd/.bat est confié au SDK
 * (cross-spawn l'échappe) après la vérification des caractères dangereux de resolveProgram.
 */
function locateProgram(command, args, cwd, env) {
    if (IS_WINDOWS) {
        const resolved = resolveProgram(command, args, cwd, env);
        if (!resolved.verbatim && resolved.file !== command) return { command: resolved.file, args: resolved.args };

        const found = findOnWindows(command, cwd, env);
        if (!found) throw notFound(command);
        return { command: found, args };
    }

    if (command.includes("/")) {
        const full = path.resolve(cwd, command);
        if (!isExecutable(full)) throw notFound(command);
        return { command: full, args };
    }

    const dirs = (getEnv(env, "PATH") || "").split(path.delimiter).filter(Boolean);
    if (!dirs.some(dir => isExecutable(path.join(dir, command)))) throw notFound(command);
    return { command, args };
}

// Jetons OAuth enregistrés par /mcp login (chargement paresseux : oauth.js n'est utile qu'en http/sse).
const defaultAuthProviderFor = server => require("./oauth").providerFor(server);

/** Transport du SDK pour un serveur déjà développé (variables remplacées). */
async function createTransport(server, { cwd = process.cwd(), env = process.env, authProviderFor = defaultAuthProviderFor } = {}) {
    if (server.type === "stdio") {
        // Seul l'env déclaré peut contenir des secrets : FS_* et *_TOKEN du parent sont retirés.
        const childEnv = { ...filterEnv(env), ...server.env };
        const program = locateProgram(server.command, server.args ?? [], cwd, childEnv);
        return new StdioClientTransport({
            command: program.command,
            args: program.args,
            env: childEnv,
            cwd,
            stderr: "pipe" // "inherit" (défaut du SDK) casserait l'affichage de la TUI
        });
    }

    const url = new URL(server.url);
    const requestInit = { headers: { ...server.headers } };
    const authProvider = authProviderFor ? await authProviderFor(server) : undefined;
    const transportOptions = authProvider ? { requestInit, authProvider } : { requestInit };
    if (server.type === "sse") return new SSEClientTransport(url, transportOptions);
    return new StreamableHTTPClientTransport(url, transportOptions);
}

// ---------------------------------------------------------------------------
// Connexion
// ---------------------------------------------------------------------------

class McpConnection {
    /**
     * `server` : définition développée ({ name, scope, type, command, args, env, url, headers, timeout }).
     * Le champ `timeout` du serveur remplace le délai d'un appel (FS_MCP_TOOL_TIMEOUT_MS), 10 min au plus.
     */
    constructor(server, options = {}) {
        this.server = server;
        this.name = server.name;
        this.cwd = options.cwd ?? process.cwd();
        this.env = options.env ?? process.env;
        this.connectTimeoutMs = options.connectTimeoutMs ?? CONFIG.mcpTimeoutMs;
        this.toolTimeoutMs = Math.min(600_000, server.timeout ?? options.toolTimeoutMs ?? CONFIG.mcpToolTimeoutMs);
        this.idleMs = options.idleMs ?? IDLE_MS[server.type] ?? IDLE_MS.http;
        this.reconnectAttempts = options.reconnectAttempts ?? RECONNECT_ATTEMPTS;
        this.reconnectBaseMs = options.reconnectBaseMs ?? RECONNECT_BASE_MS;
        this.createTransport = options.createTransport ?? createTransport;
        this.onStateChange = options.onStateChange ?? null;
        this.redact = createRedactor(secretsOf(server));

        this.state = "idle";
        this.error = null;
        this.lastUsed = 0;
        this.client = null;
        this.transport = null;
        this.pid = null;
        this.connecting = null;
        this.generation = 0;
        this.busy = 0;
        this.idleTimer = null;
        this.stderr = "";
        this.stderrTruncated = false;
        this.cache = { tools: null, resources: null, prompts: null };
        this.stale = { tools: false, resources: false, prompts: false };
    }

    setState(state, error = null) {
        this.state = state;
        this.error = error;
        if (this.onStateChange) {
            try {
                this.onStateChange(this);
            } catch {
                // un abonné défaillant ne casse pas la connexion
            }
        }
    }

    status() {
        return {
            name: this.name,
            type: this.server.type,
            state: this.state,
            error: this.error ? this.error.message : null,
            toolCount: this.cache.tools ? this.cache.tools.length : null,
            pid: this.pid
        };
    }

    /** Dernières lignes de stderr, masquées (la première ligne tronquée est retirée). */
    stderrTail(maxChars = STDERR_MAX_CHARS) {
        let text = this.stderr;
        if (text.length > maxChars) text = text.slice(-maxChars);
        if ((this.stderrTruncated || text.length < this.stderr.length) && text.includes("\n")) {
            text = text.slice(text.indexOf("\n") + 1);
        }
        return this.redact(text);
    }

    pushStderr(chunk) {
        const next = this.stderr + (Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
        if (next.length > STDERR_MAX_CHARS) {
            this.stderr = next.slice(-STDERR_MAX_CHARS);
            this.stderrTruncated = true;
        } else {
            this.stderr = next;
        }
    }

    /** Erreur lisible et masquée. */
    wrap(error, { signal } = {}) {
        if (error instanceof McpClientError) return error;
        if (signal && signal.aborted) return new McpClientError("appel interrompu", { code: "aborted", cause: error });

        const status = error && (error.code === 401 || error.status === 401);
        if (status || (error && error.name === "UnauthorizedError")) {
            return new McpClientError(
                `authentification requise par « ${this.name} » (401) : ajoute un en-tête Authorization ou connecte-toi avec /mcp login`,
                { code: "auth", cause: error }
            );
        }
        if (error && error.code === "ENOENT" && this.server.type === "stdio") return notFound(this.server.command);
        if (error && error.code === -32001) {
            return new McpClientError(`délai dépassé (« ${this.name} » n'a pas répondu à temps)`, { code: "timeout", cause: error });
        }
        if (error && error.name === "AbortError") return new McpClientError("appel interrompu", { code: "aborted", cause: error });

        const message = this.redact(error && error.message ? error.message : String(error)).slice(0, MAX_ERROR_CHARS);
        return new McpClientError(message, { code: "protocol", cause: error });
    }

    /** Connexion paresseuse : les appels simultanés partagent la même promesse. */
    connect() {
        if (this.state === "connected" && this.client) return Promise.resolve(this);
        if (this.connecting) return this.connecting;
        if (this.state === "closed") return Promise.reject(new McpClientError(`« ${this.name} » est fermé`, { code: "closed" }));
        if ((this.state === "failed" || this.state === "needs-auth") && this.error) return Promise.reject(this.error);

        const pending = this.attempt().catch(error => {
            if (error.code !== "closed") this.setState(error.code === "auth" ? "needs-auth" : "failed", error);
            throw error;
        });
        this.connecting = pending.finally(() => {
            if (this.connecting === tracked) this.connecting = null;
        });
        const tracked = this.connecting;
        return tracked;
    }

    async attempt() {
        const generation = ++this.generation;
        this.setState("connecting");
        this.stderr = "";
        this.stderrTruncated = false;

        let transport;
        try {
            transport = await this.createTransport(this.server, { cwd: this.cwd, env: this.env });
        } catch (error) {
            throw this.wrap(error);
        }

        if (transport.stderr && typeof transport.stderr.on === "function") {
            transport.stderr.on("data", chunk => this.pushStderr(chunk));
        }

        const client = new Client(CLIENT_INFO, { capabilities: {} });
        let timer;
        const timeout = new Promise((_resolve, reject) => {
            timer = setTimeout(() => {
                const seconds = Math.round(this.connectTimeoutMs / 1000);
                reject(new McpClientError(`démarrage de « ${this.name} » trop long (plus de ${seconds} s)`, { code: "timeout" }));
            }, this.connectTimeoutMs);
            if (timer.unref) timer.unref();
        });

        try {
            await Promise.race([client.connect(transport, { timeout: this.connectTimeoutMs }), timeout]);
        } catch (error) {
            clearTimeout(timer);
            this.killProcess(transport.pid);
            client.close().catch(() => {});
            const wrapped = this.wrap(error);
            const tail = this.stderrTail(400).trim();
            if (tail && wrapped.code !== "auth" && wrapped.code !== "not-found") {
                wrapped.message += `\nstderr : ${tail}`;
            }
            throw wrapped;
        }
        clearTimeout(timer);

        if (generation !== this.generation || this.state === "closed") {
            this.killProcess(transport.pid);
            client.close().catch(() => {});
            throw new McpClientError(`« ${this.name} » a été fermé pendant le démarrage`, { code: "closed" });
        }

        client.onerror = () => {
            // les erreurs remontent par les requêtes ; rien n'est écrit sur la console
        };
        client.onclose = () => this.onUnexpectedClose(client);

        const invalidate = kind => () => {
            this.stale[kind] = true;
        };
        client.setNotificationHandler(ToolListChangedNotificationSchema, invalidate("tools"));
        client.setNotificationHandler(ResourceListChangedNotificationSchema, invalidate("resources"));
        client.setNotificationHandler(PromptListChangedNotificationSchema, invalidate("prompts"));

        this.client = client;
        this.transport = transport;
        this.pid = transport.pid ?? null;
        this.cache = { tools: null, resources: null, prompts: null };
        this.stale = { tools: false, resources: false, prompts: false };
        this.setState("connected");
        this.touch();
        return this;
    }

    onUnexpectedClose(client) {
        if (this.client !== client) return; // fermeture voulue (close) ou ancienne connexion
        this.client = null;
        this.transport = null;
        this.pid = null;
        this.clearIdle();

        if (this.server.type === "stdio") {
            // Le prochain appel relance le processus (démarrage paresseux).
            const tail = this.stderrTail(400).trim();
            this.setState("idle", new McpClientError(
                `le serveur « ${this.name} » s'est arrêté${tail ? `\nstderr : ${tail}` : ""}`,
                { code: "closed" }
            ));
            return;
        }
        this.reconnectLoop();
    }

    /** http/sse : jusqu'à 5 essais, attente doublée à partir de 1 s ; arrêt sur une erreur d'authentification. */
    reconnectLoop() {
        let generation = this.generation;
        this.setState("connecting");
        const loop = (async () => {
            let delay = this.reconnectBaseMs;
            let lastError = null;
            for (let attempt = 1; attempt <= this.reconnectAttempts; attempt++) {
                await sleep(delay);
                if (this.generation !== generation || this.state === "closed") {
                    throw new McpClientError(`« ${this.name} » est fermé`, { code: "closed" });
                }
                try {
                    await this.attempt();
                    return this;
                } catch (error) {
                    lastError = error;
                    if (error.code === "auth" || error.code === "closed") break;
                    // attempt() a incrémenté la génération : c'est la nôtre, pas une fermeture
                    generation = this.generation;
                    delay *= 2;
                }
            }
            throw lastError;
        })().catch(error => {
            if (error.code !== "closed") this.setState(error.code === "auth" ? "needs-auth" : "failed", error);
            throw error;
        });
        this.connecting = loop.finally(() => {
            if (this.connecting === tracked) this.connecting = null;
        });
        const tracked = this.connecting;
        tracked.catch(() => {});
    }

    clearIdle() {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = null;
    }

    touch() {
        this.lastUsed = Date.now();
        this.clearIdle();
        if (this.busy > 0 || !this.idleMs || this.state !== "connected") return;
        this.idleTimer = setTimeout(() => {
            this.close().catch(() => {});
        }, this.idleMs);
        if (this.idleTimer.unref) this.idleTimer.unref();
    }

    async request(task, { signal, timeoutMs } = {}) {
        if (signal && signal.aborted) throw new McpClientError("appel interrompu", { code: "aborted" });
        this.busy++;
        this.clearIdle();
        try {
            await (signal ? Promise.race([this.connect(), whenAborted(signal)]) : this.connect());
            return await task(this.client, { signal, timeout: timeoutMs ?? this.toolTimeoutMs });
        } catch (error) {
            throw this.wrap(error, { signal });
        } finally {
            this.busy--;
            this.touch();
        }
    }

    supports(capability) {
        const caps = this.client && this.client.getServerCapabilities();
        return Boolean(caps && caps[capability]);
    }

    async cached(kind, fetch, options = {}) {
        if (this.state === "connected" && this.cache[kind] && !this.stale[kind]) {
            this.touch();
            return this.cache[kind];
        }
        const previous = this.cache[kind];
        try {
            const items = await this.request(async (client, requestOptions) => {
                if (!this.supports(kind)) return [];
                const all = [];
                let cursor;
                for (let page = 0; page < MAX_PAGES; page++) {
                    const result = await fetch(client, cursor ? { cursor } : undefined, requestOptions);
                    all.push(...(result[kind] ?? []));
                    cursor = result.nextCursor;
                    if (!cursor) break;
                }
                return all;
            }, { timeoutMs: this.connectTimeoutMs, ...options });
            this.cache[kind] = items;
            this.stale[kind] = false;
            return items;
        } catch (error) {
            // Rafraîchissement raté après list_changed : l'ancien cache reste utilisable.
            if (previous && this.state === "connected") return previous;
            throw error;
        }
    }

    listTools(options) {
        return this.cached("tools", (client, params, opts) => client.listTools(params, opts), options);
    }

    listResources(options) {
        return this.cached("resources", (client, params, opts) => client.listResources(params, opts), options);
    }

    listPrompts(options) {
        return this.cached("prompts", (client, params, opts) => client.listPrompts(params, opts), options);
    }

    callTool(name, args = {}, options = {}) {
        return this.request((client, opts) => client.callTool({ name, arguments: args }, undefined, opts), options);
    }

    readResource(uri, options = {}) {
        return this.request((client, opts) => client.readResource({ uri }, opts), options);
    }

    getPrompt(name, args = {}, options = {}) {
        return this.request((client, opts) => client.getPrompt({ name, arguments: args }, opts), options);
    }

    /** Arrêt forcé du processus et de ses descendants (Windows : taskkill /T). */
    killProcess(pid) {
        if (!pid) return;
        killTree({
            pid,
            kill: signal => process.kill(pid, signal)
        });
    }

    /** Ferme la connexion. `final` : plus aucune reconnexion (sortie du CLI, serveur retiré). */
    async close({ final = false } = {}) {
        this.generation++;
        this.clearIdle();
        const client = this.client;
        const pid = this.pid;
        this.client = null;
        this.transport = null;
        this.pid = null;
        this.connecting = null;

        this.killProcess(pid);
        if (client) {
            try {
                await client.close();
            } catch {
                // déjà fermé
            }
        }
        this.setState(final ? "closed" : "idle");
    }

    /** Version synchrone pour process.on("exit") : seul le processus est arrêté. */
    killSync() {
        this.generation++;
        this.clearIdle();
        this.killProcess(this.pid);
        this.client = null;
        this.transport = null;
        this.pid = null;
        this.state = "closed";
    }

    /** Oublie un échec mémorisé (le prochain appel réessaie). */
    reset() {
        if (this.state === "failed" || this.state === "needs-auth") this.setState("idle");
    }

    async reconnect() {
        await this.close();
        this.error = null;
        return this.connect();
    }
}

module.exports = {
    STDERR_MAX_CHARS,
    IDLE_MS,
    RECONNECT_ATTEMPTS,
    McpClientError,
    McpConnection,
    createTransport,
    locateProgram
};
