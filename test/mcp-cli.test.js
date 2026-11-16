"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

// Le dossier de données doit être fixé AVANT de charger la configuration.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-data-"));
const previousDataDir = process.env.FS_DATA_DIR;
process.env.FS_DATA_DIR = dataDir;

const config = require("../src/mcp/config");
const approvals = require("../src/mcp/approvals");
const disabled = require("../src/mcp/disabled");
const { createMcpManager } = require("../src/mcp/manager");
const { createStore } = require("../src/tools/command/permissions");
const { splitArgs, isReference, maskArg, runMcpCommand } = require("../src/mcp/cli");

test.after(() => {
    if (previousDataDir === undefined) delete process.env.FS_DATA_DIR;
    else process.env.FS_DATA_DIR = previousDataDir;
});

const SECRET = "s3cr3t-valeur-tres-longue";

function newWorkspace() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "fs-ws-mcp-cli-"));
}

function fakeUi(secrets = []) {
    const lines = [];
    const ui = {
        lines,
        questions: [],
        info: text => lines.push(["info", String(text)]),
        warn: text => lines.push(["warn", String(text)]),
        error: text => lines.push(["error", String(text)]),
        askSecret: async question => {
            ui.questions.push(question);
            return secrets.shift() ?? "";
        },
        text: () => lines.map(([, text]) => text).join("\n")
    };
    return ui;
}

function fakeManager(root, overrides = {}) {
    const calls = { close: [], reconnect: [] };
    return {
        calls,
        root,
        list: async () => ({ servers: [], warnings: [] }),
        peek: () => null,
        close: async name => {
            calls.close.push(name);
            return true;
        },
        reconnect: async name => {
            calls.reconnect.push(name);
            return { listTools: async () => [{ name: "a" }, { name: "b" }] };
        },
        ...overrides
    };
}

async function run(line, { root, ui = fakeUi(), manager = fakeManager(root), ...rest } = {}) {
    const result = await runMcpCommand(line, { ui, root, manager, ...rest });
    return { ...result, ui, manager };
}

// ---------------------------------------------------------------------------
// Analyse
// ---------------------------------------------------------------------------

test("splitArgs : apostrophes, guillemets et échappements", () => {
    assert.deepEqual(splitArgs("add fs -- npx -y pkg"), ["add", "fs", "--", "npx", "-y", "pkg"]);
    assert.deepEqual(splitArgs(`add-json x '{"type":"stdio","command":"node"}'`), ["add-json", "x", '{"type":"stdio","command":"node"}']);
    assert.deepEqual(splitArgs(`--header "Authorization: Bearer \\"x\\""`), ["--header", 'Authorization: Bearer "x"']);
    assert.deepEqual(splitArgs("a '' b"), ["a", "", "b"]);
    assert.throws(() => splitArgs("add 'x"), /non fermé/);
});

test("isReference et maskArg : seules les références ${VAR} restent visibles", () => {
    assert.equal(isReference("${TOKEN}"), true);
    assert.equal(isReference("Bearer ${TOKEN}"), true);
    assert.equal(isReference("${TOKEN:-abc}"), true);
    assert.equal(isReference("Bearer abc${TOKEN}"), false);
    assert.equal(maskArg(`--api-key=${SECRET}`), "--api-key=***");
    assert.equal(maskArg("--api-key=${KEY}"), "--api-key=${KEY}");
    assert.equal(maskArg("--port=3000"), "--port=3000");
});

test("sous-commande inconnue et guillemet non fermé : erreur, code 2", async () => {
    const root = newWorkspace();
    let result = await run("frobnicate", { root });
    assert.equal(result.code, 2);
    assert.match(result.ui.text(), /sous-commande inconnue/);

    result = await run("add 'x", { root });
    assert.equal(result.code, 2);
    assert.match(result.ui.text(), /non fermé/);
});

// ---------------------------------------------------------------------------
// add / get / remove
// ---------------------------------------------------------------------------

test("add stdio : scope local par défaut, référence ${VAR} acceptée, doublon refusé", async () => {
    const root = newWorkspace();
    let result = await run("add --env API_KEY=${MY_KEY} --env MODE=dev fs -- node server.js --port 3000", { root });
    assert.equal(result.code, 0, result.ui.text());

    const { servers } = await config.readScope("local", root);
    assert.equal(servers.length, 1);
    assert.equal(servers[0].name, "fs");
    assert.equal(servers[0].command, "node");
    assert.deepEqual(servers[0].args, ["server.js", "--port", "3000"]);
    assert.deepEqual(servers[0].env, { API_KEY: "${MY_KEY}", MODE: "dev" });

    result = await run("add fs -- node autre.js", { root });
    assert.equal(result.code, 2);
    assert.match(result.ui.text(), /existe déjà dans le scope local/);
});

test("add : secret en clair refusé, saisie masquée acceptée, get ne montre aucun secret", async () => {
    const root = newWorkspace();

    let result = await run(`add --env API_KEY=${SECRET} fs -- node s.js`, { root });
    assert.equal(result.code, 2);
    assert.match(result.ui.text(), /pas de secret en clair/);
    assert.doesNotMatch(result.ui.text(), new RegExp(SECRET));
    assert.equal((await config.readScope("local", root)).servers.length, 0);

    const ui = fakeUi([SECRET]);
    result = await run(`add --env API_KEY fs -- node s.js --token=${SECRET}`, { root, ui });
    assert.equal(result.code, 0, ui.text());
    assert.equal(ui.questions.length, 1);
    assert.equal((await config.readScope("local", root)).servers[0].env.API_KEY, SECRET);

    const getUi = fakeUi();
    const manager = fakeManager(root, {
        peek: () => ({ cache: { tools: [{ name: "lire" }, { name: "ecrire" }] }, stderrTail: () => `boom ${SECRET}\n` })
    });
    result = await run("get fs", { root, ui: getUi, manager });
    assert.equal(result.code, 0);
    const text = getUi.text();
    assert.match(text, /Scope\s+: local/);
    assert.match(text, /Variables\s+: API_KEY/);
    assert.match(text, /--token=\*\*\*/);
    assert.match(text, /Outils\s+: lire, ecrire/);
    assert.match(text, /boom/);
    assert.doesNotMatch(text, new RegExp(SECRET));
});

test("add http : en-tête en clair refusé, ${VAR} visible dans get, saisie masquée affichée ***", async () => {
    const root = newWorkspace();

    let result = await run(`add --transport http --header "Authorization: Bearer ${SECRET}" api https://example.com/mcp`, { root });
    assert.equal(result.code, 2);
    assert.doesNotMatch(result.ui.text(), new RegExp(SECRET));

    result = await run(`add -t http -H "Authorization: Bearer \${TOKEN}" api https://example.com/mcp`, { root });
    assert.equal(result.code, 0, result.ui.text());

    const ui = fakeUi([SECRET]);
    result = await run("add --transport sse --header X-Api-Key --scope user api2 https://example.com/sse", { root, ui });
    assert.equal(result.code, 0, ui.text());

    const getUi = fakeUi();
    await run("get api", { root, ui: getUi });
    assert.match(getUi.text(), /Authorization: Bearer \$\{TOKEN\}/);

    const getUi2 = fakeUi();
    await run("get api2", { root, ui: getUi2 });
    assert.match(getUi2.text(), /X-Api-Key: \*\*\*/);
    assert.match(getUi2.text(), /Scope\s+: user/);
    assert.doesNotMatch(getUi2.text(), new RegExp(SECRET));

    await config.removeServer("user", root, "api2");
});

test("add --scope project : écrit .mcp.json et mémorise l'approbation ; saisie masquée refusée", async () => {
    const root = newWorkspace();

    let result = await run("add --scope project --env TOKEN partage -- node s.js", { root, ui: fakeUi([SECRET]) });
    assert.equal(result.code, 2);
    assert.match(result.ui.text(), /\.mcp\.json est partagé/);

    result = await run("add --scope project outils -- node s.js", { root });
    assert.equal(result.code, 0, result.ui.text());

    const stored = JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"));
    assert.deepEqual(stored.mcpServers.outils, { type: "stdio", command: "node", args: ["s.js"] });

    const [server] = (await config.readScope("project", root)).servers;
    assert.equal(await approvals.getDecision(root, server), approvals.STATUS.approved);
});

test("add : avertit si un scope prioritaire masque la définition", async () => {
    const root = newWorkspace();
    await config.addServer("local", root, "dup", { type: "stdio", command: "node" });

    const result = await run("add --scope project dup -- node autre.js", { root });
    assert.equal(result.code, 0);
    assert.match(result.ui.text(), /scope local définit aussi « dup »/);
});

test("add-json : définition valide, secret en clair refusé", async () => {
    const root = newWorkspace();

    let result = await run(`add-json j '{"type":"stdio","command":"node","env":{"SECRET_KEY":"${SECRET}"}}'`, { root });
    assert.equal(result.code, 2);
    assert.doesNotMatch(result.ui.text(), new RegExp(SECRET));

    result = await run(`add-json j '{"type":"http","url":"https://example.com/mcp"}' --scope local`, { root });
    assert.equal(result.code, 0, result.ui.text());
    assert.equal((await config.readScope("local", root)).servers[0].url, "https://example.com/mcp");

    result = await run("add-json k 'pas du json'", { root });
    assert.equal(result.code, 2);
    assert.match(result.ui.text(), /JSON invalide/);
});

test("remove : scope trouvé seul, --scope exigé si plusieurs, connexion arrêtée", async () => {
    const root = newWorkspace();
    await config.addServer("local", root, "a", { type: "stdio", command: "node" });
    await config.addServer("local", root, "b", { type: "stdio", command: "node" });
    await config.addServer("project", root, "b", { type: "stdio", command: "node" });

    let result = await run("remove a", { root });
    assert.equal(result.code, 0, result.ui.text());
    assert.deepEqual(result.manager.calls.close, ["a"]);

    result = await run("remove b", { root });
    assert.equal(result.code, 2);
    assert.match(result.ui.text(), /plusieurs scopes \(local, project\)/);

    result = await run("remove b --scope project", { root });
    assert.equal(result.code, 0);
    assert.deepEqual((await config.readScope("local", root)).servers.map(s => s.name), ["b"]);
    assert.equal((await config.readScope("project", root)).servers.length, 0);

    result = await run("remove inconnu", { root });
    assert.equal(result.code, 2);
});

// ---------------------------------------------------------------------------
// enable / disable / list / reconnect
// ---------------------------------------------------------------------------

test("disable / enable : stocké par dossier, list l'affiche, le gestionnaire refuse de démarrer", async () => {
    const root = newWorkspace();
    const other = newWorkspace();
    await config.addServer("local", root, "srv", { type: "stdio", command: "node" });

    let result = await run("disable srv", { root });
    assert.equal(result.code, 0, result.ui.text());
    assert.deepEqual(result.manager.calls.close, ["srv"]);
    assert.equal(await disabled.isDisabled({ name: "srv" }, root), true);
    assert.equal(await disabled.isDisabled({ name: "srv" }, other), false);

    const manager = createMcpManager({ root, isDisabled: disabled.isDisabled });
    const listUi = fakeUi();
    await run("list", { root, ui: listUi, manager });
    assert.match(listUi.text(), /srv\s+local\s+stdio\s+désactivé/);
    await assert.rejects(manager.get("srv"), /désactivé/);

    result = await run("disable srv", { root });
    assert.match(result.ui.text(), /déjà désactivé/);

    result = await run("enable srv", { root });
    assert.equal(result.code, 0);
    assert.equal(await disabled.isDisabled({ name: "srv" }, root), false);

    const listUi2 = fakeUi();
    await run("", { root, ui: listUi2, manager });
    assert.match(listUi2.text(), /srv\s+local\s+stdio\s+non connecté/);
});

test("list : libellés des statuts, erreurs masquées et avertissements", async () => {
    const root = newWorkspace();
    const manager = fakeManager(root, {
        list: async () => ({
            servers: [
                { name: "a", scope: "local", type: "stdio", status: "connected", error: null, toolCount: 3 },
                { name: "b", scope: "project", type: "http", status: "needs-approval", error: null, toolCount: null },
                { name: "c", scope: "project", type: "stdio", status: "rejected", error: null, toolCount: null },
                { name: "d", scope: "user", type: "sse", status: "failed", error: "https://u:p@x.test/?token=abc", toolCount: null }
            ],
            warnings: ["user (fichier) : JSON invalide, fichier ignoré"]
        })
    });

    const { ui, code } = await run("list", { root, manager });
    assert.equal(code, 0);
    const text = ui.text();
    assert.match(text, /a\s+local\s+stdio\s+connecté · 3 outil\(s\)/);
    assert.match(text, /en attente d'approbation/);
    assert.match(text, /refusé \(\/mcp reset-project-choices/);
    assert.match(text, /échec : /);
    assert.doesNotMatch(text, /u:p@|token=abc/);
    assert.ok(ui.lines.some(([kind, line]) => kind === "warn" && /JSON invalide/.test(line)));

    const empty = await run("list", { root });
    assert.match(empty.ui.text(), /Aucun serveur MCP/);
});

test("reconnect : un serveur, ou tous sauf désactivés et refusés", async () => {
    const root = newWorkspace();
    await config.addServer("local", root, "a", { type: "stdio", command: "node" });

    let result = await run("reconnect a", { root });
    assert.equal(result.code, 0, result.ui.text());
    assert.match(result.ui.text(), /« a » : connecté · 2 outil\(s\)/);

    const manager = fakeManager(root, {
        list: async () => ({
            servers: [
                { name: "a", status: "idle" },
                { name: "b", status: "disabled" },
                { name: "c", status: "rejected" },
                { name: "d", status: "failed" }
            ],
            warnings: []
        }),
        reconnect: async name => {
            manager.calls.reconnect.push(name);
            if (name === "d") throw new Error("échec de connexion");
            return {};
        }
    });
    result = await run("reconnect all", { root, manager });
    assert.deepEqual(manager.calls.reconnect, ["a", "d"]);
    assert.equal(result.code, 1);
    assert.match(result.ui.text(), /« d » : échec de connexion/);

    result = await run("reconnect", { root });
    assert.equal(result.code, 2);
});

// ---------------------------------------------------------------------------
// allow / reset-project-choices / login
// ---------------------------------------------------------------------------

test("allow : ajoute la règle « mcp-call run <serveur> »", async () => {
    const root = newWorkspace();
    await config.addServer("local", root, "srv", { type: "stdio", command: "node" });
    const store = createStore(path.join(root, "permissions.json"));

    let result = await run("allow srv", { root, permissionStore: store });
    assert.equal(result.code, 0, result.ui.text());
    assert.deepEqual((await store.load()).map(rule => rule.text), ["mcp-call run srv"]);

    result = await run("allow srv", { root, permissionStore: store });
    assert.match(result.ui.text(), /existe déjà/);

    result = await run("allow inconnu", { root, permissionStore: store });
    assert.equal(result.code, 2);
});

test("reset-project-choices : efface les réponses du dossier", async () => {
    const root = newWorkspace();
    const server = { name: "p", scope: "project", type: "stdio", command: "node", args: [], env: {} };
    await approvals.setDecision(root, server, approvals.STATUS.rejected);

    let result = await run("reset-project-choices", { root });
    assert.equal(result.code, 0);
    assert.match(result.ui.text(), /1 choix effacé/);
    assert.equal(await approvals.getDecision(root, server), approvals.STATUS.pending);

    result = await run("reset-project-choices", { root });
    assert.match(result.ui.text(), /Aucun choix/);

    result = await run("reset-project-choices", { root: null });
    assert.equal(result.code, 2);
});

test("login / logout : pas encore disponibles, conseil d'en-tête ${VAR}", async () => {
    const { code, ui } = await run("login srv", { root: newWorkspace() });
    assert.equal(code, 1);
    assert.match(ui.text(), /pas encore disponible/);
    assert.match(ui.text(), /Authorization: Bearer \$\{/);
});
