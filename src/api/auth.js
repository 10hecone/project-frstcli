"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const { CONFIG } = require("../config");
const { ui } = require("../ui-bridge");

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
    constructor(message, status, needsLogin = false) {
        super(message);
        this.name = "AuthError";
        this.status = status;
        this.needsLogin = needsLogin;
    }
}

function serializeSession() {
    const cookies = Object.fromEntries(auth.jar);

    // Le cookie venu de FS_SESSION_TOKEN reste dans l'environnement : on ne le
    // recopie pas sur disque. S'il est renouvelé par le serveur (valeur différente),
    // la nouvelle valeur est une vraie session et peut être enregistrée.
    if (ENV_SESSION && cookies[SESSION_COOKIE] === ENV_SESSION) {
        delete cookies[SESSION_COOKIE];
    }

    return JSON.stringify({
        deviceId: auth.deviceId,
        cookies
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

function cookieHeader(jar = auth.jar) {
    return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

function captureCookies(response, jar = auth.jar) {
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

        if (dead) jar.delete(name);
        else jar.set(name, value);
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

    if (!attempts.length) {
        throw new AuthError(
            "Aucune session : connecte-toi avec /login (e-mail et mot de passe)\n" +
            `  ou mets le cookie "${SESSION_COOKIE}" du navigateur dans FS_SESSION_TOKEN.`,
            undefined,
            true
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
        "\n  Si ta session a expiré, reconnecte-toi avec /login.",
        undefined,
        true
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
    authStatus,
    SESSION_COOKIE,
    cookieHeader,
    captureCookies,
    saveSession
};
