"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createMcpPanel, detailOf, urlDetail, NAME_RE } = require("../src/gui/mcp");

const ENV_SECRET = "valeur-env-tres-secrete";
const HEADER_SECRET = "jeton-entete-secret-123";

/** Définitions telles que config.loadServers les renvoie (non développées). */
function definitions() {
    return [
        {
            name: "fichiers",
            scope: "user",
            type: "stdio",
            command: "npx",
            args: ["-y", "serveur-fichiers", "--api-key=abcdef123456"],
            env: { API_KEY: ENV_SECRET }
        },
        {
            name: "distant",
            scope: "project",
            type: "http",
            url: "https://user:mdp@exemple.test/mcp?token=abc123&x=1#frag",
            headers: { "X-Api-Key": HEADER_SECRET }
        },
        { name: "oauth", scope: "local", type: "http", url: "https://oauth.exemple.test/mcp" },
        { name: "porteur", scope: "user", type: "http", url: "https://p.test/mcp", headers: { Authorization: "Bearer abcdefgh1234" } },
        { name: "eteint", scope: "user", type: "stdio", command: "node", args: ["serveur.js"] }
    ];
}

/** Gestionnaire simulé : enregistre les appels. */
function fakeManager(overrides = {}) {
    const calls = [];
    const manager = {
        root: "C:/projet",
        calls,
        async list() {
            return {
                servers: [
                    { name: "fichiers", scope: "user", type: "stdio", status: "connected", toolCount: 3 },
                    {
                        name: "distant",
                        scope: "project",
                        type: "http",
                        status: "failed",
                        error: `échec avec ${HEADER_SECRET} et Bearer zzzzzzzzzzzz sur https://exemple.test/mcp?token=abc123`
                    },
                    { name: "oauth", scope: "local", type: "http", status: "needs-auth" },
                    { name: "porteur", scope: "user", type: "http", status: "closed" },
                    { name: "eteint", scope: "user", type: "stdio", status: "disabled" }
                ],
                warnings: ["Fichier .mcp.json illisible : https://a.test/?secret=s3cr3t"]
            };
        },
        async close(name) {
            calls.push(["close", name]);
        },
        async reconnect(name, options) {
            calls.push(["reconnect", name, Boolean(options && options.ui)]);
            return { listTools: async () => [{ name: "a" }, { name: "b" }] };
        },
        ...overrides
    };
    return manager;
}

function setup(options = {}) {
    const manager = options.manager || fakeManager();
    const disabledCalls = [];
    const loginCalls = [];
    const config = {
        loadServers: async () => ({ servers: definitions(), warnings: [] }),
        expandServer: (server) => server
    };
    const panel = createMcpPanel({
        manager,
        config,
        setDisabled: async (root, name, disabled) => disabledCalls.push([root, name, disabled]),
        oauth: {
            login: async (server) => {
                loginCalls.push(server.name);
                if (options.loginError) throw new Error(options.loginError);
            }
        },
        ui: { confirm: async () => true },
        env: {},
        isRunning: options.isRunning || (() => false)
    });
    return { panel, manager, disabledCalls, loginCalls };
}

test("list() expose les états attendus", async () => {
    const { panel } = setup();
    const { servers, warnings } = await panel.list();
    const byName = Object.fromEntries(servers.map((server) => [server.name, server]));
    assert.equal(byName.fichiers.status, "connected");
    assert.equal(byName.fichiers.toolCount, 3);
    assert.equal(byName.fichiers.enabled, true);
    assert.equal(byName.distant.status, "failed");
    assert.equal(byName.oauth.status, "needs-auth");
    assert.equal(byName.porteur.status, "idle", "closed devient idle");
    assert.equal(byName.eteint.status, "disabled");
    assert.equal(byName.eteint.enabled, false);
    assert.equal(byName.distant.scope, "project");
    assert.equal(byName.distant.transport, "http");
    assert.equal(warnings.length, 1);
});

test("list() ne contient ni valeur d'env, ni en-tête, ni jeton", async () => {
    const { panel } = setup();
    const text = JSON.stringify(await panel.list());
    for (const secret of [ENV_SECRET, HEADER_SECRET, "abc123", "abcdef123456", "zzzzzzzzzzzz", "abcdefgh1234", "s3cr3t", "mdp", "frag"]) {
        assert.ok(!text.includes(secret), `secret visible : ${secret}`);
    }
});

test("le message d'un serveur en échec est masqué", async () => {
    const { panel } = setup();
    const { servers } = await panel.list();
    const failed = servers.find((server) => server.name === "distant");
    assert.ok(failed.reason.includes("***"));
    assert.ok(!failed.reason.includes(HEADER_SECRET));
});

test("l'URL affichée perd identifiants, paramètres et fragment", async () => {
    const { panel } = setup();
    const { servers } = await panel.list();
    assert.equal(servers.find((server) => server.name === "distant").detail, "https://exemple.test/mcp");
    assert.equal(urlDetail("https://a:b@h.test/p?q=1#f"), "https://h.test/p");
    assert.equal(urlDetail("pas une url"), "URL invalide");
});

test("detailOf montre la commande et masque les arguments sensibles", () => {
    const detail = detailOf(definitions()[0]);
    assert.ok(detail.startsWith("npx -y serveur-fichiers"));
    assert.ok(!detail.includes("abcdef123456"));
    assert.ok(!detail.includes(ENV_SECRET));
    assert.equal(detailOf(null), "");
});

test("l'interrupteur désactive puis réactive un serveur", async () => {
    const { panel, manager, disabledCalls } = setup();
    assert.deepEqual(await panel.setEnabled("fichiers", false), { ok: true, enabled: false });
    assert.deepEqual(disabledCalls[0], ["C:/projet", "fichiers", true]);
    assert.deepEqual(manager.calls[0], ["close", "fichiers"]);

    assert.deepEqual(await panel.setEnabled("fichiers", true), { ok: true, enabled: true });
    assert.deepEqual(disabledCalls[1], ["C:/projet", "fichiers", false]);
    assert.equal(manager.calls.length, 1, "réactiver ne ferme rien");
});

test("seul true active : une valeur non booléenne désactive", async () => {
    const { panel, disabledCalls } = setup();
    await panel.setEnabled("fichiers", "oui");
    assert.equal(disabledCalls[0][2], true);
});

test("un serveur inconnu est refusé", async () => {
    const { panel, disabledCalls } = setup();
    const result = await panel.setEnabled("absent", true);
    assert.equal(result.ok, false);
    assert.match(result.reason, /inconnu/);
    assert.equal(disabledCalls.length, 0);
});

test("les actions sont refusées pendant un tour", async () => {
    const { panel, manager, disabledCalls, loginCalls } = setup({ isRunning: () => true });
    for (const result of [await panel.setEnabled("fichiers", false), await panel.connect("fichiers"), await panel.login("oauth")]) {
        assert.equal(result.ok, false);
        assert.match(result.reason, /demande est en cours/);
    }
    assert.equal(manager.calls.length, 0);
    assert.equal(disabledCalls.length, 0);
    assert.equal(loginCalls.length, 0);
});

test("un nom invalide est refusé sans rien appeler", async () => {
    const { panel, manager, disabledCalls } = setup();
    for (const name of ["a b", "a;b", "..", "../x", "", 42, null, "x".repeat(65), "<img src=x onerror=alert(1)>"]) {
        assert.equal((await panel.setEnabled(name, true)).ok, false, String(name));
        assert.equal((await panel.connect(name)).ok, false, String(name));
        assert.equal((await panel.login(name)).ok, false, String(name));
    }
    assert.equal(manager.calls.length, 0);
    assert.equal(disabledCalls.length, 0);
    assert.ok(NAME_RE.test("serveur_1-a"));
});

test("connect reconnecte et compte les outils", async () => {
    const { panel, manager } = setup();
    assert.deepEqual(await panel.connect("fichiers"), { ok: true, toolCount: 2 });
    assert.deepEqual(manager.calls[0], ["reconnect", "fichiers", true]);
});

test("une erreur de connexion est renvoyée masquée", async () => {
    const manager = fakeManager({
        async reconnect() {
            throw new Error("refusé : Bearer abcdefghijklmnop sur https://h.test/?token=t0k3n");
        }
    });
    const { panel } = setup({ manager });
    const result = await panel.connect("distant");
    assert.equal(result.ok, false);
    assert.ok(!result.reason.includes("abcdefghijklmnop"));
    assert.ok(!result.reason.includes("t0k3n"));
});

test("login est refusé pour stdio et avec un en-tête Authorization", async () => {
    const { panel, loginCalls } = setup();
    const stdio = await panel.login("fichiers");
    assert.equal(stdio.ok, false);
    assert.match(stdio.reason, /http/);
    const bearer = await panel.login("porteur");
    assert.equal(bearer.ok, false);
    assert.match(bearer.reason, /Authorization/);
    assert.equal(loginCalls.length, 0);
});

test("login lance OAuth puis reconnecte", async () => {
    const { panel, manager, loginCalls } = setup();
    assert.deepEqual(await panel.login("oauth"), { ok: true, toolCount: 2 });
    assert.deepEqual(loginCalls, ["oauth"]);
    assert.deepEqual(manager.calls[0], ["reconnect", "oauth", true]);
});

test("un échec OAuth est renvoyé sans reconnexion", async () => {
    const { panel, manager } = setup({ loginError: "annulé" });
    assert.deepEqual(await panel.login("oauth"), { ok: false, reason: "annulé" });
    assert.equal(manager.calls.length, 0);
});

test("un message contenant du HTML ressort tel quel, sans interprétation", async () => {
    const html = "<img src=x onerror=alert(1)>";
    const manager = fakeManager({
        async list() {
            return {
                servers: [{ name: "distant", scope: "project", type: "http", status: "failed", error: `refus ${html}` }],
                warnings: [`avertissement ${html}`]
            };
        }
    });
    const { panel } = setup({ manager });
    const { servers, warnings } = await panel.list();
    assert.equal(servers[0].reason, `refus ${html}`);
    assert.equal(warnings[0], `avertissement ${html}`);

    const refused = await panel.connect(html);
    assert.equal(refused.ok, false);
    assert.ok(!refused.reason.includes("onerror"), "le nom refusé n'est pas renvoyé");
});

test("seuls quatre canaux MCP existent : ni ajout, ni config, ni appel d'outil", () => {
    const { CHANNELS } = require("../src/gui/channels");
    const mcp = Object.entries(CHANNELS).filter(([key, value]) => /mcp/i.test(key) || /mcp/i.test(String(value)));
    assert.deepEqual(mcp.map(([key]) => key).sort(), ["MCP_CONNECT", "MCP_LIST", "MCP_LOGIN", "MCP_SET_ENABLED"]);
});
