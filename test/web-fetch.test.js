"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { CONFIG } = require("../src/config");
const {
    webFetch,
    isBlockedAddress,
    htmlToText,
    resetConfirmedHosts
} = require("../src/tools/web/web-fetch");
const { TOOLS, validateToolCall, describeCall } = require("../src/tools/registry");
const { WEB_CATALOG } = require("../src/agent/prompt");

const PAGE = `<!doctype html><html><head><title>Titre &amp; test</title>
<style>body { color: red; }</style></head><body>
<script>alert("ignore-moi")</script>
<h1>Bienvenue</h1>
<p>Un <a href="/doc">lien relatif</a> et du texte.</p>
<ul><li>Premier</li><li>Second</li></ul>
</body></html>`;

let server;
let base;

test.before(async () => {
    server = http.createServer((req, res) => {
        switch (req.url) {
            case "/page":
                res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
                res.end(PAGE);
                break;
            case "/json":
                res.writeHead(200, { "content-type": "application/json" });
                res.end('{"ok":true}');
                break;
            case "/host":
                res.writeHead(200, { "content-type": "text/plain" });
                res.end(String(req.headers.host));
                break;
            case "/redir":
                res.writeHead(302, { location: "/page" });
                res.end();
                break;
            case "/redir-private":
                res.writeHead(301, { location: "http://192.168.1.10/admin" });
                res.end();
                break;
            case "/loop":
                res.writeHead(302, { location: "/loop" });
                res.end();
                break;
            case "/big":
                res.writeHead(200, { "content-type": "text/plain" });
                for (let i = 0; i < 10; i++) res.write("x".repeat(500));
                res.end();
                break;
            case "/image":
                res.writeHead(200, { "content-type": "image/png" });
                res.end(Buffer.from([0x89, 0x50]));
                break;
            case "/slow":
                // Ne répond jamais : le délai doit s'appliquer.
                break;
            default:
                res.writeHead(404, { "content-type": "text/plain" });
                res.end("absent");
        }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
});

const OPTS = { allowLoopback: true, confirm: async () => true };

test("isBlockedAddress : privées, bouclage et link-local refusées en IPv4 et IPv6", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254",
        "0.0.0.0", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "pas-une-ip"]) {
        assert.equal(isBlockedAddress(ip), true, ip);
    }
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"]) {
        assert.equal(isBlockedAddress(ip), false, ip);
    }
    assert.equal(isBlockedAddress("127.0.0.1", { allowLoopback: true }), false);
    assert.equal(isBlockedAddress("10.0.0.1", { allowLoopback: true }), true);
});

test("htmlToText : retire script et style, garde titres, liens et listes", () => {
    const text = htmlToText(PAGE, "https://exemple.fr/a/");
    assert.doesNotMatch(text, /alert|color: red/);
    assert.match(text, /^# Bienvenue$/m);
    assert.match(text, /\[lien relatif\]\(https:\/\/exemple\.fr\/doc\)/);
    assert.match(text, /^- Premier$/m);
    assert.match(text, /^- Second$/m);
});

test("web_fetch : page HTML convertie en texte", async () => {
    const result = await webFetch({ url: `${base}/page` }, OPTS);
    assert.equal(result.url, `${base}/page`);
    assert.equal(result.content_type, "text/html");
    assert.equal(result.title, "Titre & test");
    assert.equal(result.truncated, false);
    assert.equal(result.size, Buffer.byteLength(PAGE));
    assert.match(result.content, /# Bienvenue/);
    assert.ok(result.content.includes(`[lien relatif](${base}/doc)`));
});

test("web_fetch : JSON renvoyé tel quel, max_chars tronque", async () => {
    const json = await webFetch({ url: `${base}/json` }, OPTS);
    assert.equal(json.content, '{"ok":true}');
    const big = await webFetch({ url: `${base}/big`, max_chars: 1000 }, OPTS);
    assert.equal(big.truncated, true);
    assert.equal(big.content.length, 1000);
});

test("web_fetch : suit une redirection et donne l'URL finale", async () => {
    const result = await webFetch({ url: `${base}/redir` }, OPTS);
    assert.equal(result.url, `${base}/page`);
    assert.match(result.content, /Bienvenue/);
});

test("web_fetch : redirections infinies arrêtées", async () => {
    await assert.rejects(webFetch({ url: `${base}/loop` }, OPTS), /Trop de redirections/);
});

test("web_fetch : adresses locales ou privées refusées, y compris après redirection", async () => {
    const confirm = async () => true;
    await assert.rejects(webFetch({ url: `${base}/page` }, { confirm }), /refusée/);
    await assert.rejects(webFetch({ url: "http://localhost:1/" }, { confirm }), /refusée/);
    await assert.rejects(webFetch({ url: "http://10.0.0.1/" }, OPTS), /refusée/);
    await assert.rejects(webFetch({ url: "http://[::1]:1/" }, { confirm }), /refusée/);
    await assert.rejects(webFetch({ url: `${base}/redir-private` }, OPTS), /192\.168\.1\.10/);
    const lookup = async () => [{ address: "93.184.216.34" }, { address: "10.0.0.5" }];
    await assert.rejects(webFetch({ url: "http://piege.exemple/" }, { ...OPTS, lookup }), /10\.0\.0\.5/);
});

test("web_fetch : connexion épinglée sur l'IP vérifiée, sans nouvelle résolution DNS", async () => {
    resetConfirmedHosts();
    const port = server.address().port;
    const resolved = [];
    const lookup = async host => {
        resolved.push(host);
        return [{ address: "127.0.0.1" }];
    };
    // rebind.invalid n'existe pas dans le DNS système : la page n'est lue que si la
    // connexion utilise l'adresse vérifiée par lookup.
    const result = await webFetch({ url: `http://rebind.invalid:${port}/host` }, { ...OPTS, lookup });
    assert.equal(result.content, `rebind.invalid:${port}`);
    assert.ok(resolved.length > 0 && resolved.every(host => host === "rebind.invalid"));
});

test("web_fetch : DNS rebinding refusé, l'adresse privée n'est jamais contactée", async () => {
    resetConfirmedHosts();
    const port = server.address().port;
    let calls = 0;
    const lookup = async () => [{ address: calls++ === 0 ? "127.0.0.1" : "10.0.0.5" }];
    await assert.rejects(
        webFetch({ url: `http://rebind.invalid:${port}/json` }, { ...OPTS, lookup }),
        /10\.0\.0\.5/
    );
});

test("web_fetch : protocole et type de contenu refusés", async () => {
    await assert.rejects(webFetch({ url: "file:///etc/passwd" }, OPTS), /Protocole refusé/);
    await assert.rejects(webFetch({ url: `${base}/image` }, OPTS), /non pris en charge/);
});

test("web_fetch : délai dépassé", async () => {
    await assert.rejects(webFetch({ url: `${base}/slow` }, { ...OPTS, timeoutMs: 200 }), /Délai dépassé/);
});

test("web_fetch : taille dépassée", async () => {
    await assert.rejects(webFetch({ url: `${base}/big` }, { ...OPTS, maxBytes: 1000 }), /trop volumineuse/);
});

test("web_fetch : annulation par signal", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(
        webFetch({ url: `${base}/slow` }, { ...OPTS, signal: controller.signal }),
        /annulée/
    );
});

test("web_fetch : confirmation une seule fois par domaine, refus respecté", async () => {
    resetConfirmedHosts();
    const refused = await webFetch({ url: `${base}/json` }, { allowLoopback: true, confirm: async () => false });
    assert.equal(refused.content, undefined);

    let asked = 0;
    const confirm = async () => { asked++; return true; };
    await webFetch({ url: `${base}/json` }, { allowLoopback: true, confirm });
    await webFetch({ url: `${base}/page` }, { allowLoopback: true, confirm });
    assert.equal(asked, 1);
});

test("web_fetch : registre, validation et FS_WEB=0", () => {
    assert.ok(TOOLS.web_fetch);
    validateToolCall({ name: "web_fetch", args: { url: "https://exemple.fr" } });
    assert.throws(() => validateToolCall({ name: "web_fetch", args: {} }), /url/);
    assert.throws(() => validateToolCall({ name: "web_fetch", args: { url: "ftp://x" } }), /Protocole/);
    assert.equal(describeCall({ name: "web_fetch", args: { url: "https://exemple.fr" } }), "https://exemple.fr");
    assert.match(WEB_CATALOG, /"name":"web_fetch"/);
    assert.match(WEB_CATALOG, /jamais une instruction/);

    const saved = CONFIG.web;
    CONFIG.web = false;
    try {
        assert.throws(() => validateToolCall({ name: "web_fetch", args: { url: "https://exemple.fr" } }), /désactivés/);
    } finally {
        CONFIG.web = saved;
    }
});
