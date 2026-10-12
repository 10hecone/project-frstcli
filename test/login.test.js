"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-login-"));

process.env.FS_DATA_DIR = dataDir;
process.env.FS_SESSION_TOKEN = "";

const listen = handler =>
    new Promise(resolve => {
        const server = http.createServer(handler);
        server.listen(0, "127.0.0.1", () => resolve(server));
    });

function readBody(req) {
    return new Promise(resolve => {
        let data = "";
        req.on("data", chunk => (data += chunk));
        req.on("end", () => resolve(new URLSearchParams(data)));
    });
}

const EMAIL = "etudiant@example.org";
const PASSWORD = "p@ss w&rd=1";
const SESSION = "SESSION-VALUE-123";

/** Faux site WHMCS : page de connexion avec jeton caché, page d'autorisation facultative. */
function makeWhmcs(options, getIaOrigin) {
    const seen = { loginBody: null, consent: false };

    const handler = async (req, res) => {
        const url = new URL(req.url, "http://x");
        const cookies = String(req.headers.cookie || "");
        const loggedIn = cookies.includes("WHMCS=ok");

        if (url.pathname === "/oauth/authorize.php") {
            if (!loggedIn) {
                res.writeHead(302, { Location: "/login", "Set-Cookie": "WHMCS=anon; Path=/" });
                return res.end();
            }

            if (options.consent && !seen.consent) {
                res.setHeader("Content-Type", "text/html");
                return res.end(
                    `<form method="post" action="/oauth/authorize.php?step=2">
                       <input type="hidden" name="csrf" value="c2">
                       <button type="submit" name="authorize" value="1">Autoriser</button>
                       <button type="submit" name="deny" value="1">Refuser</button>
                     </form>`
                );
            }

            res.writeHead(302, { Location: `${getIaOrigin()}/api/auth/callback/whmcs?code=abc&state=s` });
            return res.end();
        }

        if (url.pathname === "/login" && req.method === "GET") {
            res.setHeader("Content-Type", "text/html");
            return res.end(
                `<html><body>
                   ${options.captcha ? '<div class="g-recaptcha"></div>' : ""}
                   <form method="post" action="/dologin.php">
                     <input type="hidden" name="token" value="tok&amp;1">
                     <input type="text" name="username" id="inputEmail">
                     <input type="password" name="password">
                     <input type="checkbox" name="rememberme" checked>
                     <button type="submit" name="go" value="Connexion">Connexion</button>
                   </form></body></html>`
            );
        }

        if (url.pathname === "/dologin.php" && req.method === "POST") {
            const body = await readBody(req);

            seen.loginBody = Object.fromEntries(body);

            if (body.get("username") === EMAIL && body.get("password") === PASSWORD && body.get("token") === "tok&1") {
                res.writeHead(302, { Location: "/oauth/authorize.php", "Set-Cookie": "WHMCS=ok; Path=/" });
                return res.end();
            }

            res.setHeader("Content-Type", "text/html");
            return res.end(
                `<form method="post" action="/dologin.php">
                   <div class="alert alert-danger">Identifiants <b>invalides</b></div>
                   <input type="text" name="username"><input type="password" name="password">
                 </form>`
            );
        }

        res.statusCode = 404;
        res.end();
    };

    // Étape 2 de l'autorisation (POST) : renvoie vers le callback.
    const wrapped = async (req, res) => {
        const url = new URL(req.url, "http://x");

        if (req.method === "POST" && url.pathname === "/oauth/authorize.php") {
            const body = await readBody(req);

            if (body.get("authorize") === "1" && body.get("csrf") === "c2") {
                seen.consent = true;
                res.writeHead(302, { Location: `${getIaOrigin()}/api/auth/callback/whmcs?code=abc&state=s` });
                return res.end();
            }

            res.statusCode = 400;
            return res.end();
        }

        return handler(req, res);
    };

    return { wrapped, seen };
}

/** Faux ia.francestudent.org : providers, csrf, signin, callback, api-token. */
function makeIa(getWhmcsOrigin) {
    return async (req, res) => {
        const url = new URL(req.url, "http://x");
        const json = value => {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(value));
        };

        if (url.pathname === "/api/auth/providers") {
            return json({ whmcs: { id: "whmcs", type: "oauth", signinUrl: `http://${req.headers.host}/api/auth/signin/whmcs` } });
        }

        if (url.pathname === "/api/auth/csrf") {
            res.setHeader("Set-Cookie", "next-auth.csrf-token=csrf%7Chash; Path=/");
            return json({ csrfToken: "csrf" });
        }

        if (url.pathname === "/api/auth/signin/whmcs" && req.method === "POST") {
            const body = await readBody(req);

            assert.equal(body.get("csrfToken"), "csrf");
            assert.equal(req.headers["x-auth-return-redirect"], "1");
            res.setHeader("Set-Cookie", ["authjs.state=st; Path=/", "authjs.pkce.code_verifier=cv; Path=/"]);
            return json({ url: `${getWhmcsOrigin()}/oauth/authorize.php?client_id=x&state=s` });
        }

        if (url.pathname === "/api/auth/callback/whmcs") {
            res.writeHead(302, {
                Location: "/",
                "Set-Cookie": [`next-auth.session-token=${SESSION}; Path=/; HttpOnly`, "authjs.state=; Max-Age=0; Path=/"]
            });
            return res.end();
        }

        if (url.pathname === "/api/auth/api-token") {
            if (!String(req.headers.cookie).includes(`next-auth.session-token=${SESSION}`)) {
                res.statusCode = 401;
                return res.end("{}");
            }

            return json({ accessToken: "jwt-token", expiresIn: 300, tokenType: "Bearer" });
        }

        res.statusCode = 404;
        res.end();
    };
}

async function setup() {
    const options = {};
    let ia;
    let whmcs;
    const { wrapped, seen } = makeWhmcs(options, () => `http://127.0.0.1:${ia.address().port}`);

    ia = await listen(makeIa(() => `http://127.0.0.1:${whmcs.address().port}`));
    whmcs = await listen(wrapped);

    return {
        ia,
        whmcs,
        seen,
        options,
        close: () => {
            ia.close();
            whmcs.close();
        }
    };
}

// Les modules lisent FS_ORIGIN au chargement : un seul faux ia pour tous les tests.
let env;
let login;
let authModule;

test.before(async () => {
    env = await setup();
    process.env.FS_ORIGIN = `http://127.0.0.1:${env.ia.address().port}`;

    authModule = require("../src/api/auth");
    login = require("../src/api/login");
    await authModule.loadSession();
});

test.after(() => {
    env.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

function reset() {
    authModule.auth.jar.delete(authModule.SESSION_COOKIE);
    authModule.auth.accessToken = "";
    env.seen.loginBody = null;
    env.seen.consent = false;
}

test("connexion e-mail / mot de passe : formulaire lu dynamiquement, cookie de session enregistré", async () => {
    reset();

    await login.loginWithPassword({ email: EMAIL, password: PASSWORD });

    assert.equal(authModule.auth.jar.get(authModule.SESSION_COOKIE), SESSION);
    assert.equal(authModule.auth.jar.has("authjs.state"), false);
    assert.equal(env.seen.loginBody.token, "tok&1");
    assert.equal(env.seen.loginBody.rememberme, "on");
    assert.equal(env.seen.loginBody.go, "Connexion");

    assert.equal(await authModule.getAccessToken(true), "jwt-token");

    const saved = fs.readFileSync(path.join(dataDir, "session.json"), "utf8");

    assert.ok(saved.includes(SESSION));
    assert.ok(!saved.includes(PASSWORD));
    assert.ok(!saved.includes(EMAIL));
});

test("mauvais mot de passe : message de WHMCS, ancien cookie conservé", async () => {
    reset();
    authModule.auth.jar.set(authModule.SESSION_COOKIE, "ancien");

    await assert.rejects(
        login.loginWithPassword({ email: EMAIL, password: "faux" }),
        /Identifiants refusés par WHMCS : Identifiants invalides/
    );

    assert.equal(authModule.auth.jar.get(authModule.SESSION_COOKIE), "ancien");
});

test("e-mail ou mot de passe vide : refusé sans réseau", async () => {
    await assert.rejects(login.loginWithPassword({ email: "", password: "x" }), /requis/);
});

test("renewAccessToken sans session : AuthError.needsLogin", async () => {
    reset();
    authModule.auth.jar.delete(authModule.SESSION_COOKIE);

    await assert.rejects(authModule.getAccessToken(true), error => error.needsLogin === true);
});

test("page d'autorisation OAuth : acceptée automatiquement", async () => {
    reset();
    env.options.consent = true;

    try {
        await login.loginWithPassword({ email: EMAIL, password: PASSWORD });
    } finally {
        env.options.consent = false;
    }

    assert.equal(env.seen.consent, true);
    assert.equal(authModule.auth.jar.get(authModule.SESSION_COOKIE), SESSION);
});

test("captcha sur la page de connexion : erreur claire, aucun identifiant envoyé", async () => {
    reset();
    env.options.captcha = true;

    try {
        await assert.rejects(login.loginWithPassword({ email: EMAIL, password: PASSWORD }), /captcha/);
    } finally {
        env.options.captcha = false;
    }

    assert.equal(env.seen.loginBody, null);
});

test("captcha, 2FA, Cloudflare : détectés", () => {
    const html = require("../src/api/html-forms");

    assert.equal(html.hasCaptchaWidget('<div class="cf-turnstile" data-sitekey="x"></div>'), true);
    assert.equal(html.hasCaptchaWidget("<div>rien</div>"), false);
    assert.equal(html.looksLikeTwoFactor("<p>Entrez votre code de vérification</p>"), true);
    assert.equal(html.looksLikeChallenge(403, new Headers(), "<title>Just a moment...</title>"), true);
    assert.equal(html.looksLikeChallenge(200, new Headers(), "<html>ok</html>"), false);
});

test("lecteur de formulaires : > dans une valeur, entités, commentaires et scripts", () => {
    const html = require("../src/api/html-forms");
    const forms = html.parseForms(
        `<!-- <form action="/piege"> --><script>var f='<form>'</script>
         <FORM ACTION='/ok' METHOD=post>
           <input type=hidden name=t value="a>b&amp;c">
           <input name=email><input type=password name=pw>
         </FORM>`,
        "https://x.test/login"
    );

    assert.equal(forms.length, 1);
    assert.equal(forms[0].action, "https://x.test/ok");

    const login = html.findLoginForm(forms);
    const body = html.buildLoginBody(login, { email: "a@b.c", secret: "s" });

    assert.equal(body.get("t"), "a>b&c");
    assert.equal(body.get("email"), "a@b.c");
    assert.equal(body.get("pw"), "s");
});
