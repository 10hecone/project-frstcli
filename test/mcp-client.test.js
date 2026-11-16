"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const { McpConnection, McpClientError, STDERR_MAX_CHARS } = require("../src/mcp/client");
const { createMcpManager } = require("../src/mcp/manager");
const { STATUS } = require("../src/mcp/approvals");

const FIXTURE = path.join(__dirname, "fixtures", "fake-mcp-server.js");

function fakeServer(overrides = {}) {
    return {
        name: "fake",
        scope: "user",
        type: "stdio",
        command: process.execPath,
        args: [FIXTURE],
        env: {},
        ...overrides
    };
}

function open(t, server = fakeServer(), options = {}) {
    const connection = new McpConnection(server, { connectTimeoutMs: 10_000, ...options });
    t.after(() => connection.close({ final: true }));
    return connection;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(check, timeoutMs = 5000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        if (await check()) return true;
        await delay(25);
    }
    return false;
}

function isAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

const textOf = result => result.content.map(block => block.text).join("");

test("connexion paresseuse, liste des outils et appel", async t => {
    const connection = open(t);
    assert.equal(connection.state, "idle");

    const tools = await connection.listTools();
    assert.ok(tools.some(tool => tool.name === "echo"));
    assert.equal(connection.state, "connected");
    assert.equal(typeof connection.pid, "number");

    const result = await connection.callTool("echo", { text: "bonjour" });
    assert.equal(textOf(result), "bonjour");

    const failed = await connection.callTool("fail");
    assert.equal(failed.isError, true);
});

test("les connexions simultanées partagent un seul démarrage", async t => {
    const connection = open(t);
    const [a, b] = await Promise.all([connection.connect(), connection.connect()]);
    assert.equal(a, b);
    assert.equal(connection.generation, 1);
});

test("le serveur ne reçoit ni FS_* ni *_TOKEN du parent, mais reçoit son env déclaré", async t => {
    const env = { ...process.env, FS_SECRET_TEST: "1", MY_API_TOKEN: "jeton-parent", OTHER_VISIBLE: "oui" };
    const connection = open(t, fakeServer({ env: { DECLARED_TOKEN: "jeton-déclaré" } }), { env });

    const keys = JSON.parse(textOf(await connection.callTool("env_keys")));
    assert.ok(keys.includes("DECLARED_TOKEN"));
    assert.ok(keys.includes("OTHER_VISIBLE"));
    assert.ok(!keys.includes("FS_SECRET_TEST"));
    assert.ok(!keys.includes("MY_API_TOKEN"));
});

test("délai d'appel dépassé", async t => {
    const connection = open(t);
    await assert.rejects(
        connection.callTool("slow", { ms: 5000 }, { timeoutMs: 200 }),
        error => error instanceof McpClientError && error.code === "timeout"
    );
    // La connexion reste utilisable.
    assert.equal(textOf(await connection.callTool("echo", { text: "encore" })), "encore");
});

test("Ctrl+C interrompt l'appel", async t => {
    const connection = open(t);
    await connection.connect();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(
        connection.callTool("slow", { ms: 5000 }, { signal: controller.signal }),
        error => error.code === "aborted"
    );
});

test("la fermeture arrête le processus", async t => {
    const connection = open(t);
    await connection.connect();
    const pid = connection.pid;
    assert.ok(isAlive(pid));

    await connection.close();
    assert.equal(connection.state, "idle");
    assert.ok(await waitFor(() => !isAlive(pid)), "le processus du serveur doit être arrêté");
});

test("stderr est masqué", async t => {
    const secret = "valeur-tres-secrete-42";
    const connection = open(t, fakeServer({ env: { FAKE_MCP_SECRET: secret } }));
    await connection.connect();
    assert.ok(await waitFor(() => connection.stderr.includes("secret reçu")));
    const tail = connection.stderrTail();
    assert.ok(tail.includes("secret reçu : ***"));
    assert.ok(!tail.includes(secret));
});

test("stderr est plafonné à 8 000 caractères", async t => {
    const connection = open(t, fakeServer({ env: { FAKE_MCP_STDERR_FLOOD: "40000" } }));
    await connection.connect();
    assert.ok(await waitFor(() => connection.stderrTruncated));
    assert.ok(connection.stderr.length <= STDERR_MAX_CHARS);
    assert.ok(connection.stderrTail().startsWith("ligne "), "la première ligne tronquée est retirée");
});

test("programme introuvable : échec lisible, mémorisé sans nouvel essai", async t => {
    const connection = open(t, fakeServer({ command: "programme-mcp-inexistant-xyz", args: [] }));
    await assert.rejects(connection.connect(), error => error.code === "not-found" && /introuvable dans le PATH/.test(error.message));
    assert.equal(connection.state, "failed");
    await assert.rejects(connection.connect(), error => error.code === "not-found");
    assert.equal(connection.generation, 1, "pas de nouvel essai automatique");

    connection.reset();
    assert.equal(connection.state, "idle");
});

test("démarrage trop long", async t => {
    const connection = open(t, fakeServer({ args: ["-e", "setInterval(() => {}, 1000)"] }), { connectTimeoutMs: 300 });
    await assert.rejects(connection.connect(), error => error.code === "timeout" && /trop long/.test(error.message));
    assert.equal(connection.state, "failed");
});

test("list_changed invalide le cache des outils", async t => {
    const connection = open(t);
    const before = await connection.listTools();
    assert.ok(!before.some(tool => tool.name === "extra"));

    await connection.callTool("add_tool");
    assert.ok(await waitFor(() => connection.stale.tools));
    const after = await connection.listTools();
    assert.ok(after.some(tool => tool.name === "extra"));
});

test("ressources et prompts", async t => {
    const connection = open(t);
    const resources = await connection.listResources();
    assert.equal(resources[0].uri, "fake://note");
    const read = await connection.readResource("fake://note");
    assert.equal(read.contents[0].text, "contenu de la note");

    const prompts = await connection.listPrompts();
    assert.equal(prompts[0].name, "greet");
    const prompt = await connection.getPrompt("greet", { who: "Ada" });
    assert.equal(prompt.messages[0].content.text, "Bonjour Ada");
});

test("stdio arrêté de lui-même : le prochain appel relance le processus", async t => {
    const connection = open(t);
    await connection.connect();
    const firstPid = connection.pid;

    await connection.callTool("crash");
    assert.ok(await waitFor(() => connection.state === "idle"));
    assert.match(connection.error.message, /s'est arrêté/);

    assert.equal(textOf(await connection.callTool("echo", { text: "relancé" })), "relancé");
    assert.notEqual(connection.pid, firstPid);
});

// Transport réel (stdio) déclaré comme http : on teste la boucle de reconnexion sans réseau.
function httpLike(overrides = {}) {
    return fakeServer({ type: "http", url: "http://127.0.0.1:1/mcp", headers: {}, ...overrides });
}
const stdioTransport = () => new StdioClientTransport({ command: process.execPath, args: [FIXTURE], stderr: "pipe" });

test("http/sse : reconnexion automatique après une coupure", async t => {
    const connection = open(t, httpLike(), { createTransport: stdioTransport, reconnectBaseMs: 20 });
    await connection.connect();
    await connection.callTool("crash");

    assert.ok(await waitFor(() => connection.state === "connected" && connection.generation >= 2));
    assert.equal(textOf(await connection.callTool("echo", { text: "revenu" })), "revenu");
});

test("http/sse : 5 essais au plus, attente doublée", async t => {
    let calls = 0;
    const createTransport = () => {
        calls++;
        if (calls === 1) return stdioTransport();
        throw new Error("connexion refusée");
    };
    const connection = open(t, httpLike(), { createTransport, reconnectBaseMs: 10 });
    await connection.connect();
    const started = Date.now();
    await connection.callTool("crash");

    assert.ok(await waitFor(() => connection.state === "failed"));
    assert.equal(calls, 1 + 5);
    assert.ok(Date.now() - started >= 10 + 20 + 40 + 80 + 160 - 50);
});

test("http/sse : pas de reconnexion après une erreur d'authentification", async t => {
    let calls = 0;
    const createTransport = () => {
        calls++;
        if (calls === 1) return stdioTransport();
        throw Object.assign(new Error("Unauthorized"), { code: 401 });
    };
    const connection = open(t, httpLike(), { createTransport, reconnectBaseMs: 10 });
    await connection.connect();
    await connection.callTool("crash");

    assert.ok(await waitFor(() => connection.state === "needs-auth"));
    assert.equal(calls, 2);
    assert.match(connection.error.message, /authentification requise/);
});

test("les secrets d'en-têtes sont masqués dans les erreurs", async t => {
    const createTransport = () => {
        throw new Error("échec avec Bearer abcdefghijkl et clé ma-cle-privee-123");
    };
    const connection = open(t, httpLike({ headers: { "X-Api-Key": "ma-cle-privee-123" } }), { createTransport });
    await assert.rejects(connection.connect(), error => {
        assert.ok(!error.message.includes("ma-cle-privee-123"));
        assert.ok(!error.message.includes("abcdefghijkl"));
        return true;
    });
});

// ---------------------------------------------------------------------------
// Gestionnaire
// ---------------------------------------------------------------------------

function managerWith(t, list, options = {}) {
    const manager = createMcpManager({
        root: null,
        loadServers: async () => ({ servers: list, warnings: [] }),
        ensureApproved: async () => STATUS.approved,
        statusOf: async () => STATUS.approved,
        connectionOptions: { connectTimeoutMs: 10_000 },
        ...options
    });
    t.after(() => manager.closeAll());
    return manager;
}

test("gestionnaire : serveur inconnu, avec la liste des noms valides", async t => {
    const manager = managerWith(t, [fakeServer({ name: "alpha" }), fakeServer({ name: "beta" })]);
    await assert.rejects(manager.get("gamma"), error => error.code === "unknown" && /alpha, beta/.test(error.message));
});

test("gestionnaire : un serveur du projet non approuvé ne démarre pas", async t => {
    let created = 0;
    const manager = managerWith(t, [fakeServer({ scope: "project" })], {
        ensureApproved: async () => STATUS.pending,
        createConnection: () => {
            created++;
            throw new Error("ne doit pas être créé");
        }
    });
    await assert.rejects(manager.connect("fake"), error => error.code === "not-approved");
    assert.equal(created, 0);
});

test("gestionnaire : serveur désactivé refusé", async t => {
    const manager = managerWith(t, [fakeServer()], { isDisabled: async () => true });
    await assert.rejects(manager.connect("fake"), error => error.code === "disabled");
    const { servers } = await manager.list();
    assert.equal(servers[0].status, "disabled");
});

test("gestionnaire : variable manquante = erreur de configuration nommée", async t => {
    const manager = managerWith(t, [fakeServer({ env: { CLE_API: "${VARIABLE_MCP_ABSENTE}" } })], { env: {} });
    await assert.rejects(manager.connect("fake"), error => error.code === "config" && /VARIABLE_MCP_ABSENTE/.test(error.message));
});

test("gestionnaire : réutilise la connexion, limite le nombre de serveurs connectés", async t => {
    const manager = managerWith(t, [fakeServer({ name: "un" }), fakeServer({ name: "deux" })], { maxConnected: 1 });
    const first = await manager.connect("un");
    assert.equal(await manager.connect("un"), first);

    await manager.connect("deux");
    assert.equal(first.state, "idle", "le moins récemment utilisé est arrêté");
    assert.equal(manager.connectionCount(), 1);

    const { servers } = await manager.list();
    assert.deepEqual(servers.map(item => item.status), ["idle", "connected"]);
});

test("gestionnaire : changer de dossier arrête les serveurs, killAll aussi", async t => {
    const manager = managerWith(t, [fakeServer()]);
    const connection = await manager.connect("fake");
    const pid = connection.pid;

    await manager.setRoot(require("node:os").tmpdir());
    assert.equal(connection.state, "closed");
    assert.ok(await waitFor(() => !isAlive(pid)));

    const again = await manager.connect("fake");
    const secondPid = again.pid;
    manager.killAll();
    assert.equal(again.state, "closed");
    assert.ok(await waitFor(() => !isAlive(secondPid)));
});
