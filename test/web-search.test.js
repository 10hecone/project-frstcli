"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { CONFIG } = require("../src/config");
const { webSearch, resolveEngine, parseDuckHtml } = require("../src/tools/web/web-search");
const { TOOLS, validateToolCall, describeCall } = require("../src/tools/registry");
const { WEB_CATALOG } = require("../src/agent/prompt");

const KEY = "cle-secrete-123";

const jsonResponse = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const BRAVE_DATA = {
    web: {
        results: [
            { title: "Doc <b>fs</b>", url: "https://nodejs.org/api/fs.html", description: "Le module <strong>fs</strong> &amp; ses options." },
            { title: "Doublon", url: "https://nodejs.org/api/fs.html", description: "ignoré" },
            { title: "Pas http", url: "javascript:alert(1)", description: "ignoré" },
            { title: "Second", url: "https://exemple.fr/b", description: "Deuxième résultat" }
        ]
    }
};

const DUCK_HTML = `<html><body>
<div class="result result--ad"><a class="result__a" href="https://pub.exemple/">Publicité</a></div>
<div class="result results_links web-result"><div class="result__body">
<h2><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexemple.fr%2Fa&amp;rut=abc"><b>Node</b> fs</a></h2>
<a class="result__snippet" href="#">Extrait <b>utile</b></a>
</div></div>
<div class="result results_links web-result"><div class="result__body">
<h2><a class="result__a" href="https://direct.exemple/page">Direct</a></h2>
</div></div>
</body></html>`;

test("web_search : résultats normaux (brave), nettoyés et dédoublonnés", async () => {
    let seen;
    const fakeFetch = async (url, init) => {
        seen = { url: String(url), headers: init.headers };
        return jsonResponse(BRAVE_DATA);
    };
    const result = await webSearch({ query: "node fs", max_results: 5 }, { provider: "brave", apiKey: KEY, fetch: fakeFetch });

    assert.equal(result.provider, "brave");
    assert.equal(result.count, 2);
    assert.deepEqual(result.results[0], {
        title: "Doc fs",
        url: "https://nodejs.org/api/fs.html",
        snippet: "Le module fs & ses options."
    });
    assert.equal(result.results[1].url, "https://exemple.fr/b");
    assert.match(seen.url, /q=node\+fs/);
    assert.equal(seen.headers["x-subscription-token"], KEY);
    assert.ok(!JSON.stringify(result).includes(KEY));
});

test("web_search : max_results limite la liste (10 au maximum)", async () => {
    const many = { web: { results: Array.from({ length: 15 }, (_, i) => ({ title: `R${i}`, url: `https://e.fr/${i}`, description: "" })) } };
    const fakeFetch = async () => jsonResponse(many);
    const one = await webSearch({ query: "x", max_results: 1 }, { provider: "brave", apiKey: KEY, fetch: fakeFetch });
    assert.equal(one.count, 1);
    const capped = await webSearch({ query: "x", max_results: 50 }, { provider: "brave", apiKey: KEY, fetch: fakeFetch });
    assert.equal(capped.count, 10);
    const byDefault = await webSearch({ query: "x" }, { provider: "brave", apiKey: KEY, fetch: fakeFetch });
    assert.equal(byDefault.count, 5);
});

test("web_search : aucun résultat", async () => {
    const result = await webSearch({ query: "introuvable" }, {
        provider: "brave", apiKey: KEY, fetch: async () => jsonResponse({ web: { results: [] } })
    });
    assert.equal(result.count, 0);
    assert.deepEqual(result.results, []);
    assert.match(result.message, /Aucun résultat/);
});

test("web_search : erreur du moteur, sans fuite de la clé", async () => {
    await assert.rejects(
        webSearch({ query: "x" }, { provider: "brave", apiKey: KEY, fetch: async () => jsonResponse({}, 403) }),
        /refusé la requête \(HTTP 403\)/
    );
    await assert.rejects(
        webSearch({ query: "x" }, { provider: "brave", apiKey: KEY, fetch: async () => jsonResponse({}, 429) }),
        /quota/
    );
    await assert.rejects(
        webSearch({ query: "x" }, { provider: "brave", apiKey: KEY, fetch: async () => { throw new Error(`échec avec ${KEY}`); } }),
        error => !error.message.includes(KEY) && error.message.includes("***")
    );
});

test("web_search : clé absente ou aucun moteur configuré", async () => {
    await assert.rejects(webSearch({ query: "x" }, { provider: "brave", apiKey: "" }), /Clé d'API absente/);
    await assert.rejects(webSearch({ query: "x" }, { provider: "none" }), /Aucun moteur/);
    await assert.rejects(webSearch({ query: "x" }, { provider: "inconnu" }), /Moteur de recherche inconnu/);
    assert.equal(resolveEngine({ provider: "", apiKey: KEY }).engine.name, "brave");
    assert.equal(resolveEngine({ provider: "", apiKey: "" }).engine.name, "duckduckgo");
});

test("web_search : page HTML de DuckDuckGo (publicités ignorées, lien uddg décodé)", async () => {
    const parsed = parseDuckHtml(DUCK_HTML);
    assert.equal(parsed.length, 2);

    const result = await webSearch({ query: "node fs" }, {
        provider: "duckduckgo", apiKey: "",
        fetch: async () => new Response(DUCK_HTML, { status: 200, headers: { "content-type": "text/html" } })
    });
    assert.deepEqual(result.results, [
        { title: "Node fs", url: "https://exemple.fr/a", snippet: "Extrait utile" },
        { title: "Direct", url: "https://direct.exemple/page", snippet: "" }
    ]);

    await assert.rejects(
        webSearch({ query: "x" }, { provider: "duckduckgo", apiKey: "", fetch: async () => new Response("", { status: 202 }) }),
        /anti-robot/
    );
});

const hanging = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("annulé", "AbortError")), { once: true });
});

test("web_search : délai dépassé", async () => {
    await assert.rejects(
        webSearch({ query: "x" }, { provider: "brave", apiKey: KEY, fetch: hanging, timeoutMs: 100 }),
        /Délai dépassé/
    );
});

test("web_search : annulation par signal", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(
        webSearch({ query: "x" }, { provider: "brave", apiKey: KEY, fetch: hanging, signal: controller.signal }),
        /annulée/
    );
});

test("web_search : registre, validation, prompt et FS_WEB=0", () => {
    assert.ok(TOOLS.web_search);
    validateToolCall({ name: "web_search", args: { query: "node fs" } });
    assert.throws(() => validateToolCall({ name: "web_search", args: {} }), /query/);
    assert.throws(() => validateToolCall({ name: "web_search", args: { query: "   " } }), /vide/);
    assert.throws(() => validateToolCall({ name: "web_search", args: { query: "x".repeat(401) } }), /trop longue/);
    assert.equal(describeCall({ name: "web_search", args: { query: "node fs" } }), "\"node fs\"");
    assert.match(WEB_CATALOG, /"name":"web_search"/);
    assert.match(WEB_CATALOG, /web_search, puis lis les pages utiles avec web_fetch/);

    const saved = CONFIG.web;
    CONFIG.web = false;
    try {
        assert.throws(() => validateToolCall({ name: "web_search", args: { query: "x" } }), /désactivés/);
    } finally {
        CONFIG.web = saved;
    }
});
