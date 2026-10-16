"use strict";

const { CONFIG } = require("../config");
const { ui } = require("../ui-bridge");
const {
    auth,
    AuthError,
    SESSION_COOKIE,
    browserHeaders,
    cookieHeader,
    captureCookies,
    saveSession,
    getAccessToken
} = require("./auth");
const html = require("./html-forms");

/*
 * Connexion par e-mail et mot de passe (constatée dans une capture réseau) :
 *
 *   1. GET  {origin}/api/auth/providers : un seul fournisseur, type "oauth" (WHMCS).
 *   2. GET  {origin}/api/auth/csrf : jeton CSRF + cookie.
 *   3. POST {origin}/api/auth/signin/whmcs (csrfToken, callbackUrl) avec
 *      "X-Auth-Return-Redirect: 1" : renvoie l'adresse d'autorisation OAuth (PKCE),
 *      et pose les cookies state et pkce.code_verifier.
 *   4. Sur WHMCS : page de connexion, puis envoi des identifiants.
 *      NON CAPTURÉ : le formulaire est donc lu dynamiquement (champs cachés,
 *      noms des champs, adresse d'envoi), sans noms codés en dur.
 *   5. Retour sur {origin}/api/auth/callback/whmcs : pose "next-auth.session-token".
 *
 * Le mot de passe reste en mémoire le temps de la connexion. Seul le cookie de
 * session est enregistré (voir saveSession dans auth.js).
 */

const MAX_REDIRECTS = 15;
const MAX_PAGE_STEPS = 6;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PAGE_CHARS = 2_000_000;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function describeUrl(url) {
    const parsed = new URL(url);

    return `${parsed.host}${parsed.pathname}`;
}

/** Un pot de cookies par site : celui de ia.francestudent.org est celui du CLI. */
function createSession() {
    const iaHost = new URL(CONFIG.origin).host;
    const jars = new Map([[iaHost, auth.jar]]);

    const jarFor = host => {
        if (!jars.has(host)) jars.set(host, new Map());
        return jars.get(host);
    };

    async function request(url, { method = "GET", body, headers = {}, referer } = {}) {
        const target = new URL(url);
        const jar = jarFor(target.host);
        const cookie = cookieHeader(jar);

        const response = await fetch(target, {
            method,
            body,
            redirect: "manual",
            headers: {
                ...(target.host === iaHost ? browserHeaders() : { "User-Agent": CONFIG.userAgent }),
                Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
                "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
                Referer: referer ?? `${CONFIG.origin}/`,
                ...(cookie ? { Cookie: cookie } : {}),
                ...headers
            },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });

        captureCookies(response, jar);
        ui.debug(`Login ${method} ${describeUrl(target)} -> HTTP ${response.status}`);

        return response;
    }

    return { request };
}

async function readPage(response) {
    return (await response.text()).slice(0, MAX_PAGE_CHARS);
}

async function drain(response) {
    await response.arrayBuffer().catch(() => {});
}

/** Suit les redirections à la main, pour garder chaque pot de cookies à jour. */
async function follow(session, response, from, stopWhen) {
    let current = response;
    let currentUrl = from;
    let hops = 0;

    while (!stopWhen() && REDIRECT_STATUSES.has(current.status)) {
        const location = current.headers.get("location");

        if (!location) break;
        if (++hops > MAX_REDIRECTS) throw new AuthError("Trop de redirections pendant la connexion.");

        const next = new URL(location, currentUrl).toString();

        await drain(current);
        current = await session.request(next, { referer: currentUrl });
        currentUrl = next;
    }

    return { response: current, url: currentUrl };
}

/** Étapes 1 à 3 : renvoie l'adresse d'autorisation OAuth. */
async function startOAuth(session) {
    const origin = CONFIG.origin;
    let signinUrl = `${origin}/api/auth/signin/whmcs`;

    try {
        const response = await session.request(`${origin}/api/auth/providers`, {
            headers: { Accept: "application/json" }
        });

        if (response.ok) {
            const providers = await response.json();
            const oauth = Object.values(providers ?? {}).find(
                p => p?.type === "oauth" && typeof p.signinUrl === "string"
            );

            if (oauth && oauth.signinUrl.startsWith(origin)) signinUrl = oauth.signinUrl;
        } else {
            await drain(response);
        }
    } catch (error) {
        ui.debug(`Login : fournisseurs illisibles (${error.message}), adresse par défaut`);
    }

    const csrfResponse = await session.request(`${origin}/api/auth/csrf`, {
        headers: { Accept: "application/json" }
    });

    if (!csrfResponse.ok) {
        throw new AuthError(`csrf : HTTP ${csrfResponse.status}`, csrfResponse.status);
    }

    const { csrfToken } = await csrfResponse.json();

    if (!csrfToken) throw new AuthError("csrf : aucun jeton reçu.");

    const response = await session.request(signinUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Origin: origin,
            "X-Auth-Return-Redirect": "1"
        },
        body: new URLSearchParams({ csrfToken, callbackUrl: "/" }).toString()
    });

    let target = response.headers.get("location");

    if (!target) {
        try {
            target = (await response.json()).url;
        } catch {
            // pas de JSON
        }
    } else {
        await drain(response);
    }

    if (!target) {
        throw new AuthError(`signin : aucune adresse d'autorisation reçue (HTTP ${response.status}).`);
    }

    return new URL(target, origin).toString();
}

function withQuery(action, body) {
    const url = new URL(action);

    for (const [name, value] of body) url.searchParams.set(name, value);

    return url.toString();
}

async function submitForm(session, form, body, referer, stopWhen) {
    const post = form.method === "POST";
    const target = post ? form.action : withQuery(form.action, body);

    const response = await session.request(target, {
        method: post ? "POST" : "GET",
        referer,
        body: post ? body.toString() : undefined,
        headers: post
            ? { "Content-Type": "application/x-www-form-urlencoded", Origin: new URL(referer).origin }
            : {}
    });

    return follow(session, response, target, stopWhen);
}

function guardPage(response, page, url) {
    if (html.looksLikeChallenge(response.status, response.headers, page)) {
        throw new AuthError(
            "Cloudflare bloque la connexion automatique. Utilise FS_SESSION_TOKEN (cookie du navigateur)."
        );
    }

    if (response.status >= 400) {
        throw new AuthError(`La page de connexion a répondu HTTP ${response.status} (${describeUrl(url)}).`);
    }
}

/** Étapes 4 et 5 : page de connexion WHMCS, envoi des identifiants, retour sur le callback. */
async function completeAuthorization(session, authorizeUrl, { email, secret }) {
    const stopWhen = () => auth.jar.has(SESSION_COOKIE);

    let { response, url } = await follow(
        session,
        await session.request(authorizeUrl),
        authorizeUrl,
        stopWhen
    );

    let submitted = false;

    for (let step = 0; step < MAX_PAGE_STEPS && !stopWhen(); step++) {
        const page = await readPage(response);

        guardPage(response, page, url);

        const forms = html.parseForms(page, url);
        const login = html.findLoginForm(forms);

        if (login) {
            if (submitted) {
                const alert = html.extractAlert(page);

                throw new AuthError(`Identifiants refusés par WHMCS${alert ? ` : ${alert}` : "."}`);
            }

            if (html.hasCaptchaWidget(page)) {
                throw new AuthError(
                    "La page de connexion demande un captcha : connexion automatique impossible. " +
                    "Utilise FS_SESSION_TOKEN (cookie du navigateur)."
                );
            }

            submitted = true;

            ({ response, url } = await submitForm(
                session,
                login.form,
                html.buildLoginBody(login, { email, secret }),
                url,
                stopWhen
            ));
            continue;
        }

        if (submitted && html.looksLikeTwoFactor(page)) {
            throw new AuthError(
                "Double authentification requise : non prise en charge. " +
                "Utilise FS_SESSION_TOKEN (cookie du navigateur)."
            );
        }

        const consent = html.findConsentForm(forms);

        if (consent) {
            ({ response, url } = await submitForm(
                session,
                consent.form,
                html.buildConsentBody(consent),
                url,
                stopWhen
            ));
            continue;
        }

        const title = html.pageTitle(page);

        throw new AuthError(
            `Page inattendue pendant la connexion (${describeUrl(url)}, HTTP ${response.status}` +
            `${title ? `, « ${title} »` : ""}).`
        );
    }

    if (!stopWhen()) {
        throw new AuthError(
            `Connexion incomplète : le cookie "${SESSION_COOKIE}" n'a pas été reçu ` +
            `(cookies reçus : ${[...auth.jar.keys()].join(", ") || "aucun"}).`
        );
    }
}

/** Les cookies de transition d'Auth.js (state, PKCE) ne servent plus une fois connecté. */
function dropTransientCookies() {
    for (const name of [...auth.jar.keys()]) {
        if (/authjs\.(state|pkce)/i.test(name)) auth.jar.delete(name);
    }
}

/**
 * Connexion complète. En cas d'échec, l'ancien cookie de session (s'il y en avait un)
 * est remis en place. Le mot de passe n'est ni journalisé ni enregistré.
 */
async function loginWithPassword({ email, password }) {
    if (!email || !password) throw new AuthError("E-mail et mot de passe requis.");

    const session = createSession();
    const previous = auth.jar.get(SESSION_COOKIE);

    auth.jar.delete(SESSION_COOKIE);

    try {
        const authorizeUrl = await startOAuth(session);

        await completeAuthorization(session, authorizeUrl, { email, secret: password });
        dropTransientCookies();
        await saveSession();
    } catch (error) {
        if (previous) auth.jar.set(SESSION_COOKIE, previous);
        throw error;
    }
}

/**
 * Saisie interactive puis connexion. useEnv : reprend FS_EMAIL / FS_PASSWORD s'ils existent
 * (démarrage sans session). Renvoie true si le CLI est connecté.
 */
async function promptAndLogin({ useEnv = false } = {}) {
    let email = useEnv ? (process.env.FS_EMAIL || "") : "";
    let password = useEnv ? (process.env.FS_PASSWORD || "") : "";

    if (!email) email = String((await ui.ask("E-mail : ")) ?? "").trim();
    if (!email) return false;

    if (!password) password = String((await ui.askSecret("Mot de passe (saisie masquée) : ")) ?? "");
    if (!password) return false;

    const spin = ui.spinner("Connexion");

    try {
        await loginWithPassword({ email, password });
        await getAccessToken(true);
    } catch (error) {
        spin.stop();
        ui.error(error.message);
        return false;
    } finally {
        spin.stop();
        password = "";
    }

    ui.info("Connecté. Seul le cookie de session est enregistré : ton mot de passe n'est jamais stocké.");

    return true;
}

module.exports = { loginWithPassword, promptAndLogin };
