"use strict";

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

// Le dossier de données doit être fixé AVANT de charger la configuration.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-data-oauth-"));
const previousDataDir = process.env.FS_DATA_DIR;
process.env.FS_DATA_DIR = dataDir;

const oauth = require("../src/mcp/oauth");

test.after(() => {
    oauth.setUrlOpener(null);
    if (previousDataDir === undefined) delete process.env.FS_DATA_DIR;
    else process.env.FS_DATA_DIR = previousDataDir;
});

const SERVER = { name: "web", type: "http", url: "https://mcp.exemple.fr/mcp?cle=secrete", headers: {} };

function silentUi() {
    const lines = [];
    return { lines, info: text => lines.push(String(text)), warn: text => lines.push(String(text)) };
}

// Vrai si le port est libre (on peut écouter dessus).
function portIsFree(port) {
    return new Promise(resolve => {
        const probe = net.createServer();
        probe.once("error", () => resolve(false));
        probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
    });
}

// Faux auth() du SDK : 1er appel → redirection vers une URL donnée ; 2e appel (avec code) → jetons.
function fakeAuth(authorizationUrl) {
    const calls = [];
    const authFn = async (provider, options) => {
        calls.push(options);
        if (options.authorizationCode) {
            assert.equal(provider.codeVerifier(), "verificateur");
            await provider.saveTokens({ access_token: "jeton-acces", token_type: "Bearer", refresh_token: "jeton-renouv" });
            return "AUTHORIZED";
        }
        provider.saveCodeVerifier("verificateur");
        await provider.saveClientInformation({ client_id: "client-dyn" });
        const url = typeof authorizationUrl === "function" ? authorizationUrl(provider) : authorizationUrl;
        await provider.redirectToAuthorization(new URL(url));
        return "REDIRECT";
    };
    return { authFn, calls };
}

const authorizeUrl = provider =>
    `https://auth.exemple.fr/authorize?state=${provider.state()}&redirect_uri=${encodeURIComponent(provider.redirectUrl)}`;

// Ouvreur qui joue le navigateur : renvoie le code (et le state demandé) à l'adresse de retour.
function browserOpener({ state } = {}) {
    const opened = [];
    const opener = async url => {
        opened.push(url);
        const target = new URL(url);
        const back = new URL(target.searchParams.get("redirect_uri"));
        back.searchParams.set("code", "code-autorisation");
        back.searchParams.set("state", state ?? target.searchParams.get("state"));
        const response = await fetch(back);
        await response.text();
    };
    return { opener, opened };
}

// ---------------------------------------------------------------------------
// URL d'autorisation
// ---------------------------------------------------------------------------

test("validateAuthUrl : https accepté, http seulement en local", () => {
    assert.equal(oauth.validateAuthUrl("https://auth.exemple.fr/a?b=1&c=2"), "https://auth.exemple.fr/a?b=1&c=2");
    assert.ok(oauth.validateAuthUrl("http://localhost:8080/authorize"));
    assert.ok(oauth.validateAuthUrl("http://127.0.0.1/authorize"));
    assert.ok(oauth.validateAuthUrl("http://[::1]:9000/authorize"));
});

const BAD_URLS = [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "http://exemple.com/authorize",
    "https://moi:mdp@auth.exemple.fr/authorize",
    "vscode://ouvrir",
    `https://auth.exemple.fr/${"a".repeat(2050)}`,
    ""
];

test("validateAuthUrl : file:, javascript:, http distant, identifiants, protocole personnalisé et URL trop longue refusés", () => {
    for (const url of BAD_URLS) {
        assert.throws(() => oauth.validateAuthUrl(url), error => error.code === "url", url);
    }
});

test("login : URL refusée avant l'ouvreur, même remplacé", async () => {
    let called = 0;
    oauth.setUrlOpener(() => {
        called += 1;
    });
    try {
        for (const url of BAD_URLS.filter(Boolean)) {
            const { authFn } = fakeAuth(url);
            await assert.rejects(oauth.login(SERVER, { ui: silentUi(), authFn }), error => error.code === "url", url);
        }
        assert.equal(called, 0);
    } finally {
        oauth.setUrlOpener(null);
        await oauth.logout(SERVER);
    }
});

test("setUrlOpener refuse autre chose qu'une fonction", () => {
    assert.throws(() => oauth.setUrlOpener("calc.exe"), TypeError);
});

// ---------------------------------------------------------------------------
// Serveur de retour
// ---------------------------------------------------------------------------

test("retour : écoute sur 127.0.0.1, state faux refusé, usage unique", async () => {
    const callback = await oauth.startCallbackServer({ state: "bon-state" });
    try {
        const redirect = new URL(callback.redirectUrl);
        assert.equal(redirect.hostname, "127.0.0.1");
        assert.equal(redirect.pathname, oauth.CALLBACK_PATH);

        const wrong = await fetch(`${callback.redirectUrl}?code=x&state=faux`);
        assert.equal(wrong.status, 400);
        await wrong.text();

        const other = await fetch(`http://127.0.0.1:${callback.port}/ailleurs?code=x&state=bon-state`);
        assert.equal(other.status, 404);
        await other.text();

        const good = await fetch(`${callback.redirectUrl}?code=le-code&state=bon-state`);
        assert.equal(good.status, 200);
        await good.text();
        assert.equal(await callback.code, "le-code");

        // Le serveur est fermé après la réponse : le port est libéré.
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.equal(await portIsFree(callback.port), true);
    } finally {
        callback.close();
    }
});

test("retour : une erreur du serveur d'autorisation rejette le flux", async () => {
    const callback = await oauth.startCallbackServer({ state: "s" });
    const response = await fetch(`${callback.redirectUrl}?error=access_denied&state=s`);
    assert.equal(response.status, 400);
    await response.text();
    await assert.rejects(callback.code, error => error.code === "denied");
});

test("retour : abandon après le délai, port libéré", async () => {
    const callback = await oauth.startCallbackServer({ state: "s", timeoutMs: 50 });
    await assert.rejects(callback.code, error => error.code === "timeout" && /abandonnée/.test(error.message));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(await portIsFree(callback.port), true);
});

// ---------------------------------------------------------------------------
// Flux complet, stockage, logout
// ---------------------------------------------------------------------------

test("login : jetons enregistrés dans mcp-auth.json (0o600), sans l'URL en clair", async () => {
    const { opener, opened } = browserOpener();
    oauth.setUrlOpener(opener);
    const { authFn, calls } = fakeAuth(authorizeUrl);
    const ui = silentUi();
    try {
        const result = await oauth.login(SERVER, { ui, authFn });
        assert.equal(result.ok, true);
        assert.equal(opened.length, 1);
        assert.equal(calls[1].authorizationCode, "code-autorisation");
        assert.match(ui.lines.join("\n"), /copie cette adresse/);

        const file = oauth.authFile();
        const text = fs.readFileSync(file, "utf8");
        assert.match(text, /jeton-acces/);
        assert.doesNotMatch(text, /cle=secrete/);
        assert.doesNotMatch(text, /mcp\.exemple\.fr/);
        if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);

        assert.equal(await oauth.hasTokens(SERVER), true);
        const provider = await oauth.providerFor(SERVER);
        assert.equal((await provider.tokens()).access_token, "jeton-acces");

        // Changer l'URL invalide les jetons.
        assert.equal(await oauth.providerFor({ ...SERVER, url: "https://autre.exemple.fr/mcp" }), undefined);
        // Un en-tête Authorization passe avant OAuth.
        assert.equal(await oauth.providerFor({ ...SERVER, headers: { authorization: "Bearer x" } }), undefined);

        assert.equal(await oauth.logout(SERVER), true);
        assert.equal(await oauth.hasTokens(SERVER), false);
        assert.equal(await oauth.providerFor(SERVER), undefined);
        assert.equal(await oauth.logout(SERVER), false);
    } finally {
        oauth.setUrlOpener(null);
    }
});

test("login : un state faux ne termine pas le flux", async () => {
    const { opener } = browserOpener({ state: "pirate" });
    oauth.setUrlOpener(opener);
    const { authFn } = fakeAuth(authorizeUrl);
    try {
        await assert.rejects(oauth.login(SERVER, { ui: silentUi(), authFn, timeoutMs: 300 }), error => error.code === "timeout");
    } finally {
        oauth.setUrlOpener(null);
        await oauth.logout(SERVER);
    }
});

test("fournisseur non interactif : jamais de navigateur", async () => {
    let called = 0;
    oauth.setUrlOpener(() => {
        called += 1;
    });
    try {
        const provider = oauth.createProvider(SERVER);
        await provider.redirectToAuthorization(new URL("https://auth.exemple.fr/authorize"));
        assert.equal(called, 0);
    } finally {
        oauth.setUrlOpener(null);
    }
});

test("cancelPending : promesse rejetée, port libéré, second appel sans erreur", async () => {
    let port = null;
    oauth.setUrlOpener(url => {
        port = Number(new URL(new URL(url).searchParams.get("redirect_uri")).port);
    });
    const { authFn } = fakeAuth(authorizeUrl);
    try {
        const flow = oauth.login(SERVER, { ui: silentUi(), authFn });
        while (port === null) await new Promise(resolve => setTimeout(resolve, 10));

        oauth.cancelPending();
        await assert.rejects(flow, error => error.code === "cancelled");
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(await portIsFree(port), true);

        assert.doesNotThrow(() => oauth.cancelPending());
    } finally {
        oauth.setUrlOpener(null);
        await oauth.logout(SERVER);
    }
});

test("login : refusé pour un serveur stdio", async () => {
    await assert.rejects(oauth.login({ name: "x", type: "stdio", command: "node" }), /http et sse/);
});
