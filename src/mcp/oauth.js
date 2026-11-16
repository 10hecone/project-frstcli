"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { CONFIG } = require("../config");
const { writeJsonFile } = require("../tools/core/atomic");
const { redact } = require("./redact");

/*
 * Authentification OAuth des serveurs MCP http et sse (/mcp login, /mcp logout).
 *
 * - Fournisseur du SDK (OAuthClientProvider) : PKCE, enregistrement dynamique, découverte et
 *   renouvellement des jetons sont faits par le SDK (fonction auth()).
 * - Retour d'autorisation : serveur HTTP lié à 127.0.0.1 seulement, port aléatoire (ou
 *   --callback-port), paramètre state vérifié, usage unique, abandon au bout de 5 minutes.
 * - Jetons : ~/.francestudent-cli/mcp-auth.json (0o600), clé = nom + empreinte de l'URL
 *   (changer l'URL invalide les jetons). L'IA ne voit jamais un jeton.
 * - Ouverture du navigateur : fonction remplaçable (setUrlOpener). L'URL est validée ici,
 *   avant l'appel de l'ouvreur, quel qu'il soit.
 */

const FILE_NAME = "mcp-auth.json";
const CALLBACK_PATH = "/callback";
const FLOW_TIMEOUT_MS = 5 * 60_000;
const MAX_URL_LENGTH = 2048;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const CLIENT_NAME = "France Student CLI";

class OAuthError extends Error {
    constructor(message, { code = "oauth" } = {}) {
        super(message);
        this.name = "OAuthError";
        this.code = code;
    }
}

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

// ---------------------------------------------------------------------------
// Stockage des jetons
// ---------------------------------------------------------------------------

const authFile = () => path.join(CONFIG.dataDir, FILE_NAME);

/** Clé d'un serveur : nom + empreinte de l'URL (l'URL elle-même n'est pas écrite). */
function keyOf(server) {
    const digest = crypto.createHash("sha256").update(String(server.url)).digest("hex").slice(0, 16);
    return `${server.name}#${digest}`;
}

async function readStore() {
    try {
        const raw = JSON.parse((await fs.readFile(authFile(), "utf8")).replace(/^\uFEFF/, ""));
        return { version: 1, servers: isObject(raw) && isObject(raw.servers) ? raw.servers : {} };
    } catch {
        return { version: 1, servers: {} };
    }
}

// Les écritures d'un même processus passent l'une après l'autre : pas de mise à jour perdue.
let chain = Promise.resolve();
function exclusive(task) {
    const run = chain.then(task);
    chain = run.catch(() => {});
    return run;
}

async function readEntry(server) {
    const entry = (await readStore()).servers[keyOf(server)];
    return isObject(entry) ? entry : null;
}

/** Modifie l'entrée d'un serveur ; `update` renvoie la nouvelle entrée ou null pour la supprimer. */
function updateEntry(server, update) {
    return exclusive(async () => {
        const store = await readStore();
        const key = keyOf(server);
        const current = isObject(store.servers[key]) ? store.servers[key] : {};
        const next = update({ ...current });
        if (next && Object.keys(next).length) store.servers[key] = next;
        else delete store.servers[key];
        await writeJsonFile(authFile(), store);
    });
}

/** Vrai si des jetons sont enregistrés pour ce serveur. */
async function hasTokens(server) {
    const entry = await readEntry(server);
    return Boolean(entry && isObject(entry.tokens));
}

// ---------------------------------------------------------------------------
// Validation et ouverture de l'URL d'autorisation
// ---------------------------------------------------------------------------

/** URL d'autorisation acceptable, ou OAuthError. Même règle que config.js pour http. */
function validateAuthUrl(value) {
    const text = String(value ?? "");
    if (!text || text.length > MAX_URL_LENGTH) {
        throw new OAuthError(`adresse d'autorisation refusée (vide ou plus de ${MAX_URL_LENGTH} caractères)`, { code: "url" });
    }
    let url;
    try {
        url = new URL(text);
    } catch {
        throw new OAuthError("adresse d'autorisation refusée (URL invalide)", { code: "url" });
    }
    if (url.username || url.password) {
        throw new OAuthError("adresse d'autorisation refusée (identifiants dans l'URL)", { code: "url" });
    }
    const local = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
    if (url.protocol !== "https:" && !local) {
        throw new OAuthError(
            "adresse d'autorisation refusée (https obligatoire, http seulement pour localhost, 127.0.0.1 et [::1])",
            { code: "url" }
        );
    }
    return url.href;
}

/** Ouvreur par défaut : programme fixe, sans shell (l'esperluette de l'URL casserait cmd /c start). */
function defaultOpener(url) {
    let command;
    let args;
    if (process.platform === "win32") {
        command = "rundll32";
        args = ["url.dll,FileProtocolHandler", url];
    } else if (process.platform === "darwin") {
        command = "open";
        args = [url];
    } else {
        command = "xdg-open";
        args = [url];
    }
    const child = spawn(command, args, { stdio: "ignore", detached: true, shell: false, windowsHide: true });
    child.on("error", () => {});
    child.unref();
}

let opener = defaultOpener;

/** Remplace l'ouvreur (la GUI passe shell.openExternal). null rétablit l'ouvreur par défaut. */
function setUrlOpener(fn) {
    if (fn != null && typeof fn !== "function") throw new TypeError("OAuth : l'ouvreur doit être une fonction.");
    opener = fn || defaultOpener;
}

/** Valide l'URL, l'affiche (pour l'ouvrir à la main) puis appelle l'ouvreur. */
async function openAuthorizationUrl(value, ui) {
    const url = validateAuthUrl(value);
    if (ui && typeof ui.info === "function") {
        ui.info(`Ouverture du navigateur pour la connexion. Si rien ne s'ouvre, copie cette adresse :\n${url}`);
    }
    try {
        await opener(url);
    } catch {
        if (ui && typeof ui.warn === "function") ui.warn("Le navigateur n'a pas pu être ouvert : copie l'adresse ci-dessus.");
    }
    return url;
}

// ---------------------------------------------------------------------------
// Serveur de retour d'autorisation (127.0.0.1)
// ---------------------------------------------------------------------------

const PAGE_OK = "<!doctype html><meta charset=\"utf-8\"><title>Connexion réussie</title>" +
    "<p>Connexion réussie. Tu peux fermer cette page et revenir dans France Student.</p>";
const PAGE_ERROR = "<!doctype html><meta charset=\"utf-8\"><title>Connexion refusée</title>" +
    "<p>La connexion a échoué. Reviens dans France Student pour plus de détails.</p>";

function reply(response, status, body) {
    response.writeHead(status, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'"
    });
    response.end(body);
}

/**
 * Démarre le serveur de retour. Renvoie { redirectUrl, code, cancel(error), close() } :
 * `code` est une promesse résolue avec le code d'autorisation (une seule fois).
 */
function startCallbackServer({ port = 0, state, timeoutMs = FLOW_TIMEOUT_MS } = {}) {
    if (!state) throw new OAuthError("state manquant");
    return new Promise((resolveStart, rejectStart) => {
        let settled = false;
        let resolveCode;
        let rejectCode;
        const code = new Promise((resolve, reject) => {
            resolveCode = resolve;
            rejectCode = reject;
        });
        code.catch(() => {});

        const server = http.createServer((request, response) => {
            let url;
            try {
                url = new URL(request.url, "http://127.0.0.1");
            } catch {
                reply(response, 400, PAGE_ERROR);
                return;
            }
            if (request.method !== "GET" || url.pathname !== CALLBACK_PATH || settled) {
                reply(response, 404, PAGE_ERROR);
                return;
            }
            // Un state faux est refusé sans arrêter l'attente : seule la vraie réponse compte.
            if (url.searchParams.get("state") !== state) {
                reply(response, 400, PAGE_ERROR);
                return;
            }
            const error = url.searchParams.get("error");
            const value = url.searchParams.get("code");
            if (error || !value) {
                reply(response, 400, PAGE_ERROR);
                const detail = String(url.searchParams.get("error_description") || error || "code absent").slice(0, 200);
                finish(new OAuthError(`autorisation refusée : ${redact(detail)}`, { code: "denied" }));
                return;
            }
            reply(response, 200, PAGE_OK);
            finish(null, value);
        });

        const timer = setTimeout(() => {
            finish(new OAuthError(`connexion abandonnée : pas de réponse au bout de ${Math.round(timeoutMs / 60_000) || 1} min`, { code: "timeout" }));
        }, timeoutMs);
        if (timer.unref) timer.unref();

        function close() {
            clearTimeout(timer);
            server.close();
            if (typeof server.closeAllConnections === "function") server.closeAllConnections();
        }

        function finish(error, value) {
            if (settled) return;
            settled = true;
            close();
            if (error) rejectCode(error);
            else resolveCode(value);
        }

        server.on("error", error => {
            clearTimeout(timer);
            if (!server.listening) {
                rejectStart(new OAuthError(`port de retour indisponible (${error.code || error.message})`, { code: "port" }));
            }
        });

        server.listen(port, "127.0.0.1", () => {
            const address = server.address();
            resolveStart({
                redirectUrl: `http://127.0.0.1:${address.port}${CALLBACK_PATH}`,
                port: address.port,
                code,
                cancel: (error = new OAuthError("connexion annulée", { code: "cancelled" })) => finish(error),
                close: () => finish(new OAuthError("connexion terminée", { code: "closed" }))
            });
        });
    });
}

// ---------------------------------------------------------------------------
// Fournisseur OAuth du SDK
// ---------------------------------------------------------------------------

/**
 * Fournisseur pour un serveur (définition développée : URL réelle).
 * interactive=false : connexion ordinaire, jamais de navigateur (un 401 donne « authentification requise »).
 */
function createProvider(server, { interactive = false, redirectUrl, state, onRedirect } = {}) {
    let verifier = null;
    const callbackUrl = () => redirectUrl || `http://127.0.0.1${CALLBACK_PATH}`;

    return {
        get redirectUrl() {
            return callbackUrl();
        },
        get clientMetadata() {
            return {
                client_name: CLIENT_NAME,
                redirect_uris: [callbackUrl()],
                grant_types: ["authorization_code", "refresh_token"],
                response_types: ["code"],
                token_endpoint_auth_method: "none"
            };
        },
        state: () => state,
        async clientInformation() {
            const entry = await readEntry(server);
            if (!entry || !isObject(entry.client)) return undefined;
            // Client enregistré pour une autre adresse de retour : nouvel enregistrement.
            if (interactive && !entry.staticClient && entry.redirectUri !== callbackUrl()) return undefined;
            return entry.client;
        },
        async saveClientInformation(info) {
            await updateEntry(server, entry => ({ ...entry, client: info, redirectUri: callbackUrl(), staticClient: false }));
        },
        async tokens() {
            const entry = await readEntry(server);
            return entry && isObject(entry.tokens) ? entry.tokens : undefined;
        },
        async saveTokens(tokens) {
            await updateEntry(server, entry => ({ ...entry, tokens, savedAt: new Date().toISOString() }));
        },
        async redirectToAuthorization(url) {
            if (!interactive) return; // le transport lève UnauthorizedError : statut « authentification requise »
            await onRedirect(url);
        },
        saveCodeVerifier(value) {
            verifier = value;
        },
        codeVerifier() {
            if (!verifier) throw new OAuthError("vérificateur PKCE absent");
            return verifier;
        },
        async invalidateCredentials(scope) {
            if (scope === "verifier") {
                verifier = null;
                return;
            }
            await updateEntry(server, entry => {
                if (scope === "all") return null;
                if (scope === "client" && !entry.staticClient) delete entry.client;
                if (scope === "tokens") delete entry.tokens;
                return entry;
            });
        }
    };
}

const hasAuthorizationHeader = server =>
    Object.keys(server.headers ?? {}).some(name => name.toLowerCase() === "authorization");

/**
 * Fournisseur à passer au transport, ou undefined : seulement pour un serveur http/sse
 * sans en-tête Authorization et après un /mcp login.
 */
async function providerFor(server) {
    if (!server || server.type === "stdio" || hasAuthorizationHeader(server)) return undefined;
    const entry = await readEntry(server);
    if (!entry || !isObject(entry.tokens)) return undefined;
    return createProvider(server);
}

// ---------------------------------------------------------------------------
// Flux de connexion
// ---------------------------------------------------------------------------

let pending = null;
let exitHooked = false;

/** Annule le flux en cours (serveur de retour fermé, promesse rejetée). Idempotente. */
function cancelPending() {
    const flow = pending;
    pending = null;
    if (flow) flow.cancel();
}

/**
 * /mcp login : ouvre le navigateur et attend le retour. `server` : définition développée.
 * Options : ui, clientId, clientSecret, callbackPort, timeoutMs ; authFn, fetchFn (tests).
 */
async function login(server, options = {}) {
    if (!server || server.type === "stdio") throw new OAuthError("OAuth ne concerne que les serveurs http et sse");
    const { ui = null, clientId, clientSecret, callbackPort = 0, timeoutMs = FLOW_TIMEOUT_MS, fetchFn } = options;
    const authFn = options.authFn ?? require("@modelcontextprotocol/sdk/client/auth.js").auth;

    cancelPending();
    if (!exitHooked) {
        exitHooked = true;
        process.once("exit", cancelPending);
    }

    const state = crypto.randomBytes(24).toString("base64url");
    const callback = await startCallbackServer({ port: callbackPort, state, timeoutMs });
    const flow = { cancel: () => callback.cancel() };
    pending = flow;

    try {
        if (clientId) {
            const client = { client_id: String(clientId) };
            if (clientSecret) client.client_secret = String(clientSecret);
            await updateEntry(server, entry => ({ ...entry, client, staticClient: true, redirectUri: callback.redirectUrl }));
        }

        const provider = createProvider(server, {
            interactive: true,
            redirectUrl: callback.redirectUrl,
            state,
            onRedirect: url => openAuthorizationUrl(url, ui)
        });
        if (clientSecret) {
            const metadata = provider.clientMetadata;
            Object.defineProperty(provider, "clientMetadata", { get: () => ({ ...metadata, token_endpoint_auth_method: "client_secret_post" }) });
        }

        const serverUrl = new URL(server.url);
        const first = await Promise.race([authFn(provider, { serverUrl, fetchFn }), callback.code.then(() => "REDIRECT")]);
        if (first === "AUTHORIZED") return { ok: true, renewed: true };

        const code = await callback.code;
        const second = await authFn(provider, { serverUrl, authorizationCode: code, fetchFn });
        if (second !== "AUTHORIZED") throw new OAuthError("le serveur n'a pas délivré de jeton");
        return { ok: true, renewed: false };
    } finally {
        callback.close();
        if (pending === flow) pending = null;
    }
}

/** /mcp logout : annule un flux en cours et supprime les jetons. Renvoie true si quelque chose a été supprimé. */
async function logout(server) {
    cancelPending();
    const existed = Boolean(await readEntry(server));
    if (existed) await updateEntry(server, () => null);
    return existed;
}

module.exports = {
    FILE_NAME,
    CALLBACK_PATH,
    FLOW_TIMEOUT_MS,
    MAX_URL_LENGTH,
    OAuthError,
    authFile,
    keyOf,
    hasTokens,
    validateAuthUrl,
    setUrlOpener,
    openAuthorizationUrl,
    startCallbackServer,
    createProvider,
    providerFor,
    cancelPending,
    login,
    logout
};
