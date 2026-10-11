"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const { CONFIG } = require("../config");
const { ui } = require("../cli/ui");

/*
 * Authentification (constatée sur ia.francestudent.org) :
 *
 *   1. Le navigateur possède un cookie de session longue durée
 *      "next-auth.session-token".
 *   2. Il appelle GET {origin}/api/auth/api-token (Cookie: session)
 *      et reçoit { accessToken, expiresAt, expiresIn, tokenType }.
 *   3. accessToken est un JWT de courte durée, envoyé en
 *      « Authorization: Bearer … » à api.francestudent.ai.
 *
 * Pas de refresh token : on redemande un JWT avec le cookie de session,
 * 60 s avant l'expiration et sur toute réponse 401.
 */

const SESSION_COOKIE = "next-auth.session-token";
const SESSION_FILE = path.join(CONFIG.dataDir, "session.json");
const TOKEN_REFRESH_MARGIN_MS = 60_000;

const ENV_SESSION = (process.env.FS_SESSION_TOKEN || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^[\w.-]*session-token=/i, "")
    .trim();

const auth = {
    jar: new Map(),
    deviceId: process.env.FS_DEVICE_ID || null,
    accessToken: "",
    expiresAt: 0,
    pending: null,
    lastSaved: ""
};

class AuthError extends Error {
    constructor(message, status) {
        super(message);
        this.name = "AuthError";
        this.status = status;
    }
}

function serializeSession() {
    return JSON.stringify({
        deviceId: auth.deviceId,
        cookies: Object.fromEntries(auth.jar)
    });
}

async function loadSession() {
    try {
        const saved = JSON.parse(await fs.readFile(SESSION_FILE, "utf8"));

        for (const [name, value] of Object.entries(saved.cookies || {})) {
            if (typeof value === "string" && value) auth.jar.set(name, value);
        }

        auth.deviceId ??= saved.deviceId || null;
        auth.lastSaved = serializeSession();
    } catch {
        // première utilisation ou fichier illisible
    }

    auth.deviceId ??= randomUUID();

    if (!auth.jar.has("francestudent-device-id")) {
        auth.jar.set("francestudent-device-id", auth.deviceId);
    }
}

async function saveSession() {
    const data = serializeSession();

    if (data === auth.lastSaved) return;

    try {
        await fs.mkdir(path.dirname(SESSION_FILE), { recursive: true });

        const tmp = `${SESSION_FILE}.${process.pid}.tmp`;

        await fs.writeFile(tmp, data, { mode: 0o600 });
        await fs.rename(tmp, SESSION_FILE);

        auth.lastSaved = data;
    } catch (error) {
        ui.debug(`Session non sauvegardée : ${error.message}`);
    }
}

function cookieHeader() {
    return [...auth.jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

function captureCookies(response) {
    const list = response.headers.getSetCookie?.() ?? [];

    for (const raw of list) {
        const [pair, ...attrs] = raw.split(";");
        const eq = pair.indexOf("=");

        if (eq <= 0) continue;

        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();

        const maxAge = attrs.map(a => a.trim()).find(a => /^max-age=/i.test(a));
        const expires = attrs.map(a => a.trim()).find(a => /^expires=/i.test(a));

        const dead =
            !value ||
            (maxAge && Number(maxAge.split("=")[1]) <= 0) ||
            (expires && Date.parse(expires.slice(expires.indexOf("=") + 1)) < Date.now());

        if (dead) auth.jar.delete(name);
        else auth.jar.set(name, value);
    }
}

function browserHeaders(extra = {}) {
    return {
        Accept: "*/*",
        "User-Agent": CONFIG.userAgent,
        Referer: `${CONFIG.origin}/`,
        "francestudent-client-platform": CONFIG.clientPlatform,
        "francestudent-client-version": CONFIG.clientVersion,
        "francestudent-device-id": auth.deviceId,
        ...extra
    };
}

async function fetchAccessToken() {
    const response = await fetch(`${CONFIG.origin}/api/auth/api-token`, {
        headers: browserHeaders({ Cookie: cookieHeader() }),
        signal: AbortSignal.timeout(30_000)
    });

    captureCookies(response);

    if (!response.ok) {
        throw new AuthError(
            `api-token a répondu HTTP ${response.status}`,
            response.status
        );
    }

    let data;

    try {
        data = await response.json();
    } catch {
        throw new AuthError("api-token : réponse non JSON (session invalide ?)");
    }

    if (!data || typeof data.accessToken !== "string" || !data.accessToken) {
        throw new AuthError("api-token : aucun accessToken (session expirée ?)");
    }

    auth.accessToken = data.accessToken;
    auth.expiresAt = data.expiresAt
        ? Number(data.expiresAt) * 1000
        : Date.now() + (Number(data.expiresIn) || 300) * 1000;

    ui.debug(
        `Token renouvelé, valable ${Math.round((auth.expiresAt - Date.now()) / 1000)} s`
    );
}

/**
 * Login email / mot de passe via les routes standard Auth.js.
 * NON CONFIRMÉ : la capture ne contient pas de login. Si le site n'utilise
 * que OAuth / lien magique, cette voie échouera : utilise FS_SESSION_TOKEN.
 */
async function loginWithCredentials() {
    const email = process.env.FS_EMAIL;
    const password = process.env.FS_PASSWORD;

    if (!email || !password) {
        throw new AuthError("FS_EMAIL / FS_PASSWORD absents");
    }

    const csrfResponse = await fetch(`${CONFIG.origin}/api/auth/csrf`, {
        headers: browserHeaders({ Cookie: cookieHeader() }),
        signal: AbortSignal.timeout(30_000)
    });

    captureCookies(csrfResponse);

    if (!csrfResponse.ok) {
        throw new AuthError(`csrf : HTTP ${csrfResponse.status}`, csrfResponse.status);
    }

    const { csrfToken } = await csrfResponse.json();

    const loginResponse = await fetch(
        `${CONFIG.origin}/api/auth/callback/credentials`,
        {
            method: "POST",
            redirect: "manual",
            headers: browserHeaders({
                "Content-Type": "application/x-www-form-urlencoded",
                Origin: CONFIG.origin,
                Cookie: cookieHeader()
            }),
            body: new URLSearchParams({
                csrfToken,
                email,
                password,
                callbackUrl: `${CONFIG.origin}/`,
                json: "true"
            }),
            signal: AbortSignal.timeout(30_000)
        }
    );

    captureCookies(loginResponse);

    if (!auth.jar.has(SESSION_COOKIE)) {
        throw new AuthError(
            `login email/mot de passe refusé ou indisponible (HTTP ${loginResponse.status})`,
            loginResponse.status
        );
    }
}

async function renewAccessToken() {
    const attempts = [];

    if (auth.jar.has(SESSION_COOKIE)) {
        attempts.push(["session enregistrée", () => fetchAccessToken()]);
    }

    if (ENV_SESSION && auth.jar.get(SESSION_COOKIE) !== ENV_SESSION) {
        attempts.push([
            "FS_SESSION_TOKEN",
            () => {
                auth.jar.set(SESSION_COOKIE, ENV_SESSION);
                return fetchAccessToken();
            }
        ]);
    }

    if (process.env.FS_EMAIL && process.env.FS_PASSWORD) {
        attempts.push([
            "email / mot de passe",
            async () => {
                auth.jar.delete(SESSION_COOKIE);
                await loginWithCredentials();
                return fetchAccessToken();
            }
        ]);
    }

    if (!attempts.length) {
        throw new AuthError(
            "Aucune session configurée.\n" +
            "  Dans ton navigateur : F12 -> Stockage (Application) -> Cookies ->\n" +
            `  ${CONFIG.origin} -> copie la valeur de "${SESSION_COOKIE}",\n` +
            "  puis mets-la dans .env : FS_SESSION_TOKEN=<valeur>\n" +
            "  (une seule fois : le CLI renouvelle ensuite tout seul)."
        );
    }

    const failures = [];

    for (const [label, attempt] of attempts) {
        try {
            await attempt();
            await saveSession();
            return;
        } catch (error) {
            failures.push(`${label} : ${error.message}`);
            ui.debug(`Auth via ${label} échouée : ${error.message}`);
        }
    }

    throw new AuthError(
        "Connexion impossible.\n  " + failures.join("\n  ") +
        "\n  Si ta session a expiré, recopie une nouvelle valeur de " +
        `"${SESSION_COOKIE}" dans FS_SESSION_TOKEN.`
    );
}

async function getAccessToken(force = false) {
    const fresh =
        auth.accessToken &&
        auth.expiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS;

    if (fresh && !force) return auth.accessToken;

    auth.pending ??= renewAccessToken().finally(() => {
        auth.pending = null;
    });

    await auth.pending;

    return auth.accessToken;
}

async function initAuth() {
    await loadSession();

    const spin = ui.spinner("Connexion");

    try {
        await getAccessToken(true);
    } finally {
        spin.stop();
    }
}

function authStatus() {
    const left = Math.round((auth.expiresAt - Date.now()) / 1000);

    ui.info(
        auth.accessToken
            ? `Token ${left > 0 ? `valide encore ${left} s` : "expiré"} (renouvelé automatiquement)`
            : "Pas de token"
    );
    ui.info(`Cookies : ${[...auth.jar.keys()].join(", ") || "aucun"}`);
    ui.info(`Fichier de session : ${SESSION_FILE}`);
}

module.exports = {
    auth,
    AuthError,
    initAuth,
    loadSession,
    getAccessToken,
    browserHeaders,
    authStatus
};
