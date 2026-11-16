"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { CONFIG } = require("../src/config");
const { projectDir } = require("../src/project/memory");
const mcp = require("../src/mcp/config");

const {
    McpConfigError,
    RESERVED_NAMES,
    MAX_SERVERS,
    checkName,
    validateServer,
    scopeFile,
    readScope,
    loadServers,
    addServer,
    removeServer,
    expandString,
    expandServer
} = mcp;

// Dossier de données et dossier de travail temporaires ; CONFIG.dataDir est restauré à la fin du test.
async function sandbox(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "frst-mcp-"));
    const previous = CONFIG.dataDir;
    const dataDir = path.join(root, "data");
    const workspace = path.join(root, "work");

    await fs.mkdir(workspace, { recursive: true });
    CONFIG.dataDir = dataDir;

    t.after(async () => {
        CONFIG.dataDir = previous;
        await fs.rm(root, { recursive: true, force: true });
    });

    return { root, dataDir, workspace };
}

async function writeText(file, text) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text, "utf8");
}

async function writeScope(scope, workspace, servers, extra = {}) {
    await writeText(scopeFile(scope, workspace), JSON.stringify({ ...extra, mcpServers: servers }));
}

const readJson = async file => JSON.parse(await fs.readFile(file, "utf8"));
const exists = file => fs.access(file).then(() => true, () => false);

// ---------------------------------------------------------------------------
// Noms
// ---------------------------------------------------------------------------

test("mcp config : noms valides", () => {
    for (const name of ["github", "my-server", "my_server", "A1", "x".repeat(64)]) {
        assert.equal(checkName(name), null, name);
    }
});

test("mcp config : noms invalides", () => {
    for (const name of ["", " ", "a b", "a/b", "a.b", "é", "x".repeat(65), "a\nb", 42, null, undefined]) {
        assert.ok(checkName(name), String(name));
    }
});

test("mcp config : noms réservés, quelle que soit la casse", () => {
    for (const name of RESERVED_NAMES) {
        assert.match(checkName(name), /réservé/, name);
        assert.match(checkName(name.toUpperCase()), /réservé/, name);
    }
    assert.match(checkName("List"), /réservé/);
    assert.equal(checkName("lists"), null);
});

test("mcp config : __proto__ est refusé", () => {
    assert.ok(checkName("__proto__"));
    assert.equal(checkName("proto"), null);
});

// ---------------------------------------------------------------------------
// validateServer : stdio
// ---------------------------------------------------------------------------

test("mcp config : stdio avec valeurs par défaut", () => {
    const { server, warnings } = validateServer({ command: "node" });

    assert.deepEqual(server, { type: "stdio", command: "node", args: [], env: {} });
    assert.deepEqual(warnings, []);
});

test("mcp config : stdio complet", () => {
    const { server } = validateServer({
        type: "stdio",
        command: "npx",
        args: ["-y", "pkg"],
        env: { TOKEN: "${TOKEN}" },
        timeout: 30000
    });

    assert.deepEqual(server, {
        type: "stdio",
        command: "npx",
        args: ["-y", "pkg"],
        env: { TOKEN: "${TOKEN}" },
        timeout: 30000
    });
});

test("mcp config : stdio ne partage pas les objets de l'entrée", () => {
    const raw = { command: "node", args: ["a"], env: { A: "1" } };
    const { server } = validateServer(raw);

    server.args.push("b");
    server.env.B = "2";
    assert.deepEqual(raw, { command: "node", args: ["a"], env: { A: "1" } });
});

test("mcp config : stdio invalide", () => {
    const cases = [
        [{ type: "stdio" }, /command/],
        [{ command: "" }, /command/],
        [{ command: "   " }, /command/],
        [{ command: 42 }, /command/],
        [{ command: "node", args: "x" }, /args/],
        [{ command: "node", args: ["a", 1] }, /args/],
        [{ command: "node", env: [] }, /env/],
        [{ command: "node", env: { A: 1 } }, /env/],
        [{ command: "node", env: { "A B": "x" } }, /env/],
        [{ command: "node", env: { "A=B": "x" } }, /env/]
    ];

    for (const [raw, pattern] of cases) {
        const result = validateServer(raw);
        assert.match(result.error ?? "", pattern, JSON.stringify(raw));
        assert.equal(result.server, undefined);
    }
});

test("mcp config : une définition qui n'est pas un objet est refusée", () => {
    for (const raw of [null, undefined, "node", 42, [], true]) {
        assert.ok(validateServer(raw).error, String(raw));
    }
});

// ---------------------------------------------------------------------------
// validateServer : types
// ---------------------------------------------------------------------------

test("mcp config : le type ws (WebSocket) est refusé avec un message clair", () => {
    assert.match(validateServer({ type: "ws", url: "wss://example.com" }).error, /WebSocket/);
});

test("mcp config : type inconnu ou manquant", () => {
    assert.match(validateServer({ type: "grpc", url: "https://example.com" }).error, /inconnue/);
    assert.match(validateServer({ type: 3 }).error, /type/);
    assert.match(validateServer({ url: "https://example.com" }).error, /type/);
    assert.match(validateServer({}).error, /type/);
});

test("mcp config : http et sse", () => {
    for (const type of ["http", "sse"]) {
        const { server } = validateServer({ type, url: "https://example.com/mcp" });
        assert.deepEqual(server, { type, url: "https://example.com/mcp", headers: {} });
    }
});

test("mcp config : http sans url ou avec url vide", () => {
    assert.match(validateServer({ type: "http" }).error, /url/);
    assert.match(validateServer({ type: "http", url: "" }).error, /url/);
    assert.match(validateServer({ type: "sse", url: 42 }).error, /url/);
});

// ---------------------------------------------------------------------------
// validateServer : règles d'URL
// ---------------------------------------------------------------------------

const checkUrl = url => validateServer({ type: "http", url });

test("mcp config : https accepté", () => {
    assert.ok(checkUrl("https://example.com/mcp").server);
    assert.ok(checkUrl("https://example.com:8443/mcp?x=1").server);
});

test("mcp config : http refusé hors machine locale", () => {
    assert.match(checkUrl("http://example.com/mcp").error, /https/);
    assert.match(checkUrl("http://192.168.1.10:3000").error, /https/);
    assert.match(checkUrl("http://localhost.evil.com").error, /https/);
    assert.match(checkUrl("http://127.0.0.1.evil.com").error, /https/);
});

test("mcp config : http accepté pour localhost, 127.0.0.1 et [::1]", () => {
    assert.ok(checkUrl("http://localhost:3000/mcp").server);
    assert.ok(checkUrl("http://127.0.0.1:8080/mcp").server);
    assert.ok(checkUrl("http://[::1]:8080/mcp").server);
});

test("mcp config : autres schémas et urls invalides refusés", () => {
    for (const url of ["ftp://example.com", "file:///etc/passwd", "ws://localhost:3000", "pas une url", "//example.com"]) {
        assert.ok(checkUrl(url).error, url);
    }
});

test("mcp config : hôte vide, blancs et caractères de contrôle refusés", () => {
    const urls = [
            "https:///mcp", // l'analyseur d'URL en ferait l'hôte « mcp »
        "https:////example.com/mcp",
            "https:\\\\example.com\\mcp",
        "https://exam ple.com/mcp",
        " https://example.com/mcp",
            "https://example.com/mcp\n",
        "https://example.com/\tmcp",
        "https://example.com/\u0000mcp",
            "https://",
        "https://${HOST} /mcp",
        "https:///${PATH_PART}"
    ];

    for (const url of urls) {
        assert.match(checkUrl(url).error ?? "", /url/, JSON.stringify(url));
    }
});

test("mcp config : identifiants dans l'url refusés, sans recopier le secret", () => {
    for (const url of ["https://user:SECRETPW@example.com/mcp", "https://SECRETTOKEN@example.com/mcp"]) {
        const { error } = checkUrl(url);
        assert.match(error, /identifiants/);
        assert.ok(!error.includes("SECRET"), error);
    }
});

test("mcp config : url de plus de 2048 caractères refusée", () => {
    assert.match(checkUrl("https://example.com/" + "a".repeat(2100)).error, /trop longue/);
    assert.match(checkUrl("https://${HOST}/" + "a".repeat(2100)).error, /trop longue/);
    assert.ok(checkUrl("https://example.com/" + "a".repeat(2000)).server);
});

test("mcp config : url modèle avec ${VAR} acceptée, contrôlée plus légèrement", () => {
    assert.ok(checkUrl("https://${HOST}/mcp").server);
    assert.ok(checkUrl("https://example.com/${PATH_PART}").server);
    assert.ok(checkUrl("http://${HOST}/mcp").server); // refait après développement
    assert.ok(checkUrl("http://localhost:3000/${P}").server);

    assert.match(checkUrl("http://example.com/${P}").error, /https/);
    assert.match(checkUrl("ftp://${HOST}/mcp").error, /https/);
    assert.match(checkUrl("${URL}").error, /https/);
    assert.match(checkUrl("https://${USER}:${PW}@example.com/mcp").error, /identifiants/);
});

// ---------------------------------------------------------------------------
// validateServer : timeout et en-têtes
// ---------------------------------------------------------------------------

test("mcp config : timeout valide conservé", () => {
    const { server, warnings } = validateServer({ command: "node", timeout: 1000 });

    assert.equal(server.timeout, 1000);
    assert.deepEqual(warnings, []);
});

test("mcp config : timeout invalide ignoré avec un avertissement", () => {
    for (const timeout of [0, 500, 999, -1, 1.5, "30000", null, NaN]) {
        const { server, warnings } = validateServer({ command: "node", timeout });

        assert.ok(server, String(timeout));
        assert.equal(server.timeout, undefined, String(timeout));
        assert.equal(warnings.length, 1, String(timeout));
        assert.match(warnings[0], /timeout/);
    }
});

test("mcp config : en-têtes valides, y compris avec ${VAR}", () => {
    const { server } = validateServer({
        type: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer ${TOKEN}", "X-Api-Key": "abc" }
    });

    assert.deepEqual(server.headers, { Authorization: "Bearer ${TOKEN}", "X-Api-Key": "abc" });
});

test("mcp config : en-têtes invalides refusés", () => {
    const base = { type: "http", url: "https://example.com/mcp" };
    const cases = [
        { Authorization: "Bearer x\r\nX-Evil: 1" },
        { Authorization: "Bearer x\nX-Evil: 1" },
        { Authorization: "a\0b" },
        { "Bad Name": "x" },
        { "Bad:Name": "x" },
        { "": "x" },
        { Authorization: 42 }
    ];

    for (const headers of cases) {
        assert.match(validateServer({ ...base, headers }).error ?? "", /headers/, JSON.stringify(headers));
    }
    assert.match(validateServer({ ...base, headers: [] }).error, /headers/);
});

// ---------------------------------------------------------------------------
// Chemins des scopes
// ---------------------------------------------------------------------------

test("mcp config : projectDir est exporté par memory.js", () => {
    assert.equal(typeof require("../src/project/memory").projectDir, "function");
});

test("mcp config : fichiers des trois scopes", async t => {
    const { dataDir, workspace } = await sandbox(t);

    assert.equal(scopeFile("user"), path.join(dataDir, "mcp.json"));
    assert.equal(scopeFile("user", workspace), path.join(dataDir, "mcp.json"));
    assert.equal(scopeFile("project", workspace), path.join(workspace, ".mcp.json"));
    assert.equal(scopeFile("local", workspace), path.join(projectDir(workspace), "mcp.json"));
    assert.ok(scopeFile("local", workspace).startsWith(path.join(dataDir, "projects")));
});

test("mcp config : scope inconnu ou dossier manquant", async t => {
    const { workspace } = await sandbox(t);

    assert.throws(() => scopeFile("global", workspace), McpConfigError);
    assert.throws(() => scopeFile("project"), McpConfigError);
    assert.throws(() => scopeFile("local"), McpConfigError);
    assert.throws(() => scopeFile(undefined, workspace), McpConfigError);
});

// ---------------------------------------------------------------------------
// Lecture d'un scope
// ---------------------------------------------------------------------------

test("mcp config : fichier absent, sans avertissement", async t => {
    const { workspace } = await sandbox(t);

    for (const scope of ["local", "project", "user"]) {
        const result = await readScope(scope, workspace);
        assert.deepEqual(result.servers, [], scope);
        assert.deepEqual(result.warnings, [], scope);
    }
});

test("mcp config : une entrée invalide est ignorée, les autres sont chargées", async t => {
    const { workspace } = await sandbox(t);

    await writeScope("project", workspace, {
        ok: { command: "node" },
        broken: { type: "ws", url: "wss://example.com" },
        list: { command: "node" },
        "a b": { command: "node" },
        second: { type: "http", url: "https://example.com/mcp" }
    });

    const { servers, warnings } = await readScope("project", workspace);

    assert.deepEqual(servers.map(s => s.name), ["ok", "second"]);
    assert.equal(warnings.length, 3);
    assert.ok(warnings.some(w => w.includes("« broken »") && w.includes('"type"')), warnings.join("\n"));
    assert.ok(warnings.some(w => w.includes("list") && w.includes("réservé")), warnings.join("\n"));
    assert.ok(warnings.some(w => w.includes("a b")), warnings.join("\n"));
});

test("mcp config : les serveurs lus portent leur nom et leur scope", async t => {
    const { workspace } = await sandbox(t);

    await writeScope("project", workspace, { srv: { command: "node", args: ["x.js"] } });

    const { servers } = await readScope("project", workspace);
    assert.deepEqual(servers, [
        { name: "srv", scope: "project", type: "stdio", command: "node", args: ["x.js"], env: {} }
    ]);
});

test("mcp config : le champ fautif d'un timeout est signalé sans perdre le serveur", async t => {
    const { workspace } = await sandbox(t);

    await writeScope("project", workspace, { srv: { command: "node", timeout: 5 } });

    const { servers, warnings } = await readScope("project", workspace);
    assert.equal(servers.length, 1);
    assert.equal(servers[0].timeout, undefined);
    assert.match(warnings[0], /« srv »/);
    assert.match(warnings[0], /timeout/);
});

test("mcp config : JSON invalide ignoré avec un avertissement", async t => {
    const { workspace } = await sandbox(t);

    await writeText(scopeFile("project", workspace), "{ pas du json");

    const { servers, warnings } = await readScope("project", workspace);
    assert.deepEqual(servers, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /JSON invalide/);
});

test("mcp config : mcpServers absent, vide ou mal typé", async t => {
    const { workspace } = await sandbox(t);
    const file = scopeFile("project", workspace);

    await writeText(file, "{}");
    assert.deepEqual(await readScope("project", workspace), { scope: "project", file, servers: [], warnings: [] });

    await writeText(file, '{"mcpServers":{}}');
    assert.deepEqual((await readScope("project", workspace)).warnings, []);

    for (const text of ['{"mcpServers":[]}', '{"mcpServers":"x"}', '{"mcpServers":null}']) {
        await writeText(file, text);
        const { servers, warnings } = await readScope("project", workspace);
        assert.deepEqual(servers, [], text);
        assert.match(warnings.join("\n"), /objet/, text);
    }

    await writeText(file, "[]");
    assert.deepEqual((await readScope("project", workspace)).servers, []);
});

test("mcp config : BOM au début du fichier toléré", async t => {
    const { workspace } = await sandbox(t);

    await writeText(scopeFile("project", workspace), '\uFEFF{"mcpServers":{"srv":{"command":"node"}}}');

    const { servers, warnings } = await readScope("project", workspace);
    assert.equal(servers.length, 1);
    assert.deepEqual(warnings, []);
});

test("mcp config : au plus 50 entrées examinées par fichier", async t => {
    const { workspace } = await sandbox(t);
    const many = {};

    for (let i = 0; i < 60; i++) many[`srv${String(i).padStart(2, "0")}`] = { command: "node" };
    await writeScope("project", workspace, many);

    const { servers, warnings } = await readScope("project", workspace);
    assert.equal(servers.length, MAX_SERVERS);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /50 serveurs au maximum/);
});

test("mcp config : une clé __proto__ dans le fichier est ignorée", async t => {
    const { workspace } = await sandbox(t);

    await writeText(scopeFile("project", workspace), '{"mcpServers":{"__proto__":{"command":"node"},"ok":{"command":"node"}}}');

    const { servers, warnings } = await readScope("project", workspace);
    assert.deepEqual(servers.map(s => s.name), ["ok"]);
    assert.equal(warnings.length, 1);
    assert.equal(({}).command, undefined);
});

test("mcp config : le contenu invalide d'un fichier ne fait jamais échouer loadServers", async t => {
    const { workspace } = await sandbox(t);

    await writeText(scopeFile("local", workspace), "{ cassé");
    await writeText(scopeFile("project", workspace), '{"mcpServers":{"ok":{"command":"node"},"mauvais":42}}');

    const { servers, warnings } = await loadServers(workspace);
    assert.deepEqual(servers.map(s => s.name), ["ok"]);
    assert.equal(warnings.length, 2);
});

// ---------------------------------------------------------------------------
// Précédence
// ---------------------------------------------------------------------------

test("mcp config : précédence local > project > user, sans fusion de champs", async t => {
    const { workspace } = await sandbox(t);

    await writeScope("user", workspace, {
        srv: { command: "user-cmd", args: ["u"], env: { U: "1" } },
        "only-user": { command: "u" },
        "user-project": { command: "up-user" }
    });
    await writeScope("project", workspace, {
        srv: { command: "project-cmd", args: ["p"] },
        "only-project": { command: "p" },
        "user-project": { command: "up-project" }
    });
    await writeScope("local", workspace, {
        srv: { command: "local-cmd" },
        "only-local": { command: "l" }
    });

    const { servers, warnings } = await loadServers(workspace);
    const byName = Object.fromEntries(servers.map(s => [s.name, s]));

    assert.deepEqual(warnings, []);
    assert.deepEqual(servers.map(s => s.name), ["only-local", "only-project", "only-user", "srv", "user-project"]);

    assert.equal(byName.srv.scope, "local");
    assert.equal(byName.srv.command, "local-cmd");
    assert.deepEqual(byName.srv.args, []);
    assert.deepEqual(byName.srv.env, {});

    assert.equal(byName["user-project"].scope, "project");
    assert.equal(byName["user-project"].command, "up-project");
    assert.equal(byName["only-user"].scope, "user");
    assert.equal(byName["only-project"].scope, "project");
    assert.equal(byName["only-local"].scope, "local");
});

test("mcp config : sans dossier ouvert, seulement le scope user", async t => {
    const { workspace } = await sandbox(t);

    await writeScope("user", workspace, { a: { command: "u" } });
    await writeScope("project", workspace, { b: { command: "p" } });
    await writeScope("local", workspace, { c: { command: "l" } });

    const { servers } = await loadServers();
    assert.deepEqual(servers.map(s => `${s.name}:${s.scope}`), ["a:user"]);

    assert.deepEqual((await loadServers(undefined)).servers.length, 1);
    assert.deepEqual((await loadServers(workspace)).servers.length, 3);
});

test("mcp config : les serveurs sont triés par nom", async t => {
    const { workspace } = await sandbox(t);

    await writeScope("project", workspace, { zeta: { command: "z" }, alpha: { command: "a" }, mu: { command: "m" } });

    const { servers } = await loadServers(workspace);
    assert.deepEqual(servers.map(s => s.name), ["alpha", "mu", "zeta"]);
});

// ---------------------------------------------------------------------------
// Variables ${VAR}
// ---------------------------------------------------------------------------

test("mcp config : expandString développe ${VAR}", () => {
    assert.equal(expandString("a-${X}-b", { X: "1" }), "a-1-b");
    assert.equal(expandString("${A}${B}", { A: "x", B: "y" }), "xy");
    assert.equal(expandString("sans variable", {}), "sans variable");
    assert.equal(expandString("$X et ${ X } restent", { X: "1" }), "$X et ${ X } restent");
});

test("mcp config : expandString utilise la valeur par défaut si la variable est absente ou vide", () => {
    assert.equal(expandString("${X:-def}", {}), "def");
    assert.equal(expandString("${X:-def}", { X: "" }), "def");
    assert.equal(expandString("${X:-def}", { X: "valeur" }), "valeur");
    assert.equal(expandString("${X:-}", {}), "");
    assert.equal(expandString("${X:-http://localhost:3000/a}", {}), "http://localhost:3000/a");
});

test("mcp config : variable vide mais définie, sans défaut, donne une chaîne vide", () => {
    assert.equal(expandString("a${X}b", { X: "" }), "ab");
});

test("mcp config : variable absente sans défaut, erreur qui nomme la variable sans fuite de valeur", () => {
    assert.throws(
        () => expandString("Bearer ${TOKEN}", { AUTRE: "SECRETVALUE" }, "headers.Authorization"),
        error => {
            assert.ok(error instanceof McpConfigError);
            assert.equal(error.variable, "TOKEN");
            assert.equal(error.field, "headers.Authorization");
            assert.match(error.message, /TOKEN/);
            assert.ok(!error.message.includes("SECRETVALUE"));
            return true;
        }
    );
});

test("mcp config : FS_* n'est jamais développé, même avec une valeur par défaut", () => {
    const env = { FS_TOKEN: "SECRETVALUE", fs_low: "SECRETVALUE" };

    for (const text of ["${FS_TOKEN}", "${FS_TOKEN:-x}", "${FS_AUTRE:-x}", "${fs_low}", "a ${FS_EMAIL:-} b"]) {
        assert.throws(
            () => expandString(text, env),
            error => {
                assert.ok(error instanceof McpConfigError, text);
                assert.ok(!error.message.includes("SECRETVALUE"), text);
                return true;
            },
            text
        );
    }
    assert.equal(expandString("${FSX:-ok}", {}), "ok");
});

test("mcp config : le résultat du développement n'est pas redéveloppé", () => {
    assert.equal(expandString("${A}", { A: "${B}", B: "zzz" }), "${B}");
    assert.equal(expandString("${A:-${B}}", { B: "zzz" }), "${B}");
    assert.equal(expandString("${A}", { A: "${FS_TOKEN}", FS_TOKEN: "secret" }), "${FS_TOKEN}");
});

test("mcp config : expandString lit process.env par défaut", t => {
    const name = "FRST_MCP_TEST_VAR";
    const previous = process.env[name];

    process.env[name] = "depuis-process-env";
    t.after(() => {
        if (previous === undefined) delete process.env[name];
        else process.env[name] = previous;
    });

    assert.equal(expandString(`\${${name}}`), "depuis-process-env");
});

test("mcp config : expandServer stdio (command, args, env, valeurs seulement)", () => {
    const server = {
        name: "srv",
        scope: "user",
        type: "stdio",
        command: "${BIN:-node}",
        args: ["${DIR}/server.js", "--plain", "--mode=${MODE:-prod}"],
        env: { TOKEN: "${TOKEN}", "${CLE}": "valeur", FIXE: "x" },
        timeout: 5000
    };
    const before = JSON.parse(JSON.stringify(server));

    const out = expandServer(server, { DIR: "/opt/srv", TOKEN: "tok-123" });

    assert.deepEqual(out, {
        name: "srv",
        scope: "user",
        type: "stdio",
        command: "node",
        args: ["/opt/srv/server.js", "--plain", "--mode=prod"],
        env: { TOKEN: "tok-123", "${CLE}": "valeur", FIXE: "x" },
        timeout: 5000
    });
    assert.deepEqual(server, before, "le serveur d'origine ne doit pas être modifié");
});

test("mcp config : expandServer http (url et en-têtes)", () => {
    const server = {
        name: "api",
        scope: "project",
        type: "http",
        url: "https://${HOST}/mcp",
        headers: { Authorization: "Bearer ${TOKEN}", "X-Fixe": "1" }
    };

    const out = expandServer(server, { HOST: "api.example.com", TOKEN: "tok-123" });

    assert.equal(out.url, "https://api.example.com/mcp");
    assert.deepEqual(out.headers, { Authorization: "Bearer tok-123", "X-Fixe": "1" });
    assert.equal(server.url, "https://${HOST}/mcp");
});

test("mcp config : expandServer, variable manquante nomme la variable et le champ", () => {
    const cases = [
        [{ type: "stdio", command: "${BIN}", args: [], env: {} }, "BIN", "command"],
        [{ type: "stdio", command: "node", args: ["a", "${ARG}"], env: {} }, "ARG", "args[1]"],
        [{ type: "stdio", command: "node", args: [], env: { K: "${VAL}" } }, "VAL", "env.K"],
        [{ type: "http", url: "https://${HOST}/mcp", headers: {} }, "HOST", "url"],
        [{ type: "http", url: "https://example.com", headers: { A: "${TOK}" } }, "TOK", "headers.A"]
    ];

    for (const [server, variable, field] of cases) {
        assert.throws(
            () => expandServer(server, {}),
            error => {
                assert.ok(error instanceof McpConfigError);
                assert.equal(error.variable, variable);
                assert.equal(error.field, field);
                return true;
            },
            variable
        );
    }
});

test("mcp config : expandServer refuse FS_* partout", () => {
    const env = { FS_TOKEN: "SECRETVALUE" };
    const servers = [
        { type: "stdio", command: "node", args: ["${FS_TOKEN}"], env: {} },
        { type: "stdio", command: "node", args: [], env: { T: "${FS_TOKEN:-x}" } },
        { type: "http", url: "https://example.com/${FS_TOKEN}", headers: {} },
        { type: "http", url: "https://example.com", headers: { A: "${FS_TOKEN}" } }
    ];

    for (const server of servers) {
        assert.throws(() => expandServer(server, env), error => {
            assert.ok(error instanceof McpConfigError);
            assert.ok(!error.message.includes("SECRETVALUE"));
            return true;
        });
    }
});

test("mcp config : expandServer re-valide l'url après développement", () => {
    const bad = [
        ["https://${HOST}/mcp", { HOST: "user:SECRETPW@example.com" }, /identifiants/],
        ["http://${HOST}/mcp", { HOST: "example.com" }, /https/],
        ["https://${HOST}/mcp", { HOST: "" }, /url/],
        ["${URL}", { URL: "ftp://example.com" }, /https/],
        ["https://example.com/${P}", { P: "a".repeat(3000) }, /trop longue/]
    ];

    for (const [url, env, pattern] of bad) {
        assert.throws(
            () => expandServer({ type: "http", url, headers: {} }, env),
            error => {
                assert.ok(error instanceof McpConfigError);
                assert.equal(error.field, "url");
                assert.match(error.message, pattern);
                assert.ok(!error.message.includes("SECRETPW"));
                return true;
            },
            url
        );
    }

    assert.equal(
        expandServer({ type: "http", url: "http://${HOST}:3000/mcp", headers: {} }, { HOST: "localhost" }).url,
        "http://localhost:3000/mcp"
    );
});

test("mcp config : expandServer re-valide les en-têtes après développement", () => {
    assert.throws(
        () => expandServer(
            { type: "http", url: "https://example.com", headers: { Authorization: "Bearer ${TOKEN}" } },
            { TOKEN: "abc\r\nX-Evil: SECRETVALUE" }
        ),
        error => {
            assert.ok(error instanceof McpConfigError);
            assert.equal(error.field, "headers");
            assert.ok(!error.message.includes("SECRETVALUE"));
            return true;
        }
    );
});

test("mcp config : expandServer refuse une commande vide après développement", () => {
    for (const env of [{}, { BIN: "   " }]) {
        assert.throws(
            () => expandServer({ type: "stdio", command: "${BIN:-}", args: [], env: {} }, env),
            error => error instanceof McpConfigError && error.field === "command"
        );
    }
});

// ---------------------------------------------------------------------------
// Écriture : addServer et removeServer
// ---------------------------------------------------------------------------

test("mcp config : addServer puis removeServer (aller-retour)", async t => {
    const { workspace } = await sandbox(t);
    const file = scopeFile("project", workspace);

    const added = await addServer("project", workspace, "srv", { command: "node", args: ["a.js"] });

    assert.deepEqual(added.server, {
        name: "srv", scope: "project", type: "stdio", command: "node", args: ["a.js"], env: {}
    });
    assert.deepEqual(added.warnings, []);
    assert.deepEqual(await readJson(file), {
        mcpServers: { srv: { type: "stdio", command: "node", args: ["a.js"] } }
    });
    assert.deepEqual((await loadServers(workspace)).servers.map(s => s.name), ["srv"]);

    assert.equal(await removeServer("project", workspace, "srv"), true);
    assert.deepEqual(await readJson(file), { mcpServers: {} });
    assert.deepEqual((await loadServers(workspace)).servers, []);

    assert.equal(await removeServer("project", workspace, "srv"), false);
});

test("mcp config : addServer fonctionne dans chaque scope", async t => {
    const { workspace } = await sandbox(t);

    for (const scope of ["local", "project", "user"]) {
        await addServer(scope, workspace, `srv-${scope}`, { type: "http", url: "https://example.com/mcp" });
        assert.ok(await exists(scopeFile(scope, workspace)), scope);
    }

    const { servers } = await loadServers(workspace);
    assert.deepEqual(servers.map(s => `${s.name}:${s.scope}`), ["srv-local:local", "srv-project:project", "srv-user:user"]);
});

test("mcp config : le fichier ne stocke pas les champs vides", async t => {
    await sandbox(t);

    await addServer("user", undefined, "a", { command: "node", args: [], env: {} });
    await addServer("user", undefined, "b", { type: "sse", url: "https://example.com/sse", headers: {}, timeout: 20000 });

    assert.deepEqual((await readJson(scopeFile("user"))).mcpServers, {
        a: { type: "stdio", command: "node" },
        b: { type: "sse", url: "https://example.com/sse", timeout: 20000 }
    });
});

test("mcp config : le reste du fichier est conservé (clés inconnues, autres serveurs)", async t => {
    const { workspace } = await sandbox(t);
    const file = scopeFile("project", workspace);

    await writeText(file, JSON.stringify({
        $schema: "https://example.com/schema.json",
        extra: { a: [1, 2, 3] },
        mcpServers: {
            old: { type: "stdio", command: "old-cmd", custom: true },
            invalide: 42
        }
    }));

    await addServer("project", workspace, "nouveau", { command: "node" });
    let data = await readJson(file);

    assert.equal(data.$schema, "https://example.com/schema.json");
    assert.deepEqual(data.extra, { a: [1, 2, 3] });
    assert.deepEqual(data.mcpServers.old, { type: "stdio", command: "old-cmd", custom: true });
    assert.equal(data.mcpServers.invalide, 42);
    assert.deepEqual(data.mcpServers.nouveau, { type: "stdio", command: "node" });

    assert.equal(await removeServer("project", workspace, "nouveau"), true);
    data = await readJson(file);

    assert.deepEqual(data.extra, { a: [1, 2, 3] });
    assert.deepEqual(Object.keys(data.mcpServers), ["old", "invalide"]);
});

test("mcp config : addServer refuse un doublon sauf avec replace", async t => {
    const { workspace } = await sandbox(t);

    await addServer("project", workspace, "srv", { command: "un" });

    await assert.rejects(
        addServer("project", workspace, "srv", { command: "deux" }),
        error => error instanceof McpConfigError && /existe déjà/.test(error.message)
    );
    assert.equal((await loadServers(workspace)).servers[0].command, "un");

    const replaced = await addServer("project", workspace, "srv", { command: "deux" }, { replace: true });
    assert.equal(replaced.server.command, "deux");
    assert.equal((await loadServers(workspace)).servers[0].command, "deux");

    // Le même nom dans un autre scope n'est pas un doublon.
    await addServer("user", workspace, "srv", { command: "trois" });
});

test("mcp config : addServer refuse un nom ou une définition invalide, sans rien écrire", async t => {
    const { workspace } = await sandbox(t);
    const file = scopeFile("project", workspace);

    const bad = [
        ["list", { command: "node" }],
        ["a b", { command: "node" }],
        ["__proto__", { command: "node" }],
        ["srv", { type: "ws", url: "wss://example.com" }],
        ["srv", { command: "" }],
        ["srv", { type: "http", url: "http://example.com" }],
        ["srv", null]
    ];

    for (const [name, definition] of bad) {
        await assert.rejects(addServer("project", workspace, name, definition), McpConfigError, name);
    }
    assert.equal(await exists(file), false);
});

test("mcp config : addServer refuse un scope inconnu ou sans dossier", async t => {
    await sandbox(t);

    await assert.rejects(addServer("global", undefined, "srv", { command: "node" }), McpConfigError);
    await assert.rejects(addServer("project", undefined, "srv", { command: "node" }), McpConfigError);
    await assert.rejects(addServer("local", undefined, "srv", { command: "node" }), McpConfigError);
    await assert.rejects(removeServer("project", undefined, "srv"), McpConfigError);
});

test("mcp config : un fichier illisible n'est jamais écrasé", async t => {
    const { workspace } = await sandbox(t);
    const file = scopeFile("project", workspace);

    for (const content of ["{ pas du json", '{"mcpServers":[]}', "[]", '"texte"', ""]) {
        await writeText(file, content);

        await assert.rejects(addServer("project", workspace, "srv", { command: "node" }), McpConfigError, content);
        await assert.rejects(removeServer("project", workspace, "srv"), McpConfigError, content);

        assert.equal(await fs.readFile(file, "utf8"), content);
    }
});

test("mcp config : retirer un serveur inconnu ne crée pas de fichier", async t => {
    const { workspace } = await sandbox(t);

    assert.equal(await removeServer("user", workspace, "inconnu"), false);
    assert.equal(await removeServer("project", workspace, "inconnu"), false);
    assert.equal(await exists(scopeFile("user")), false);
    assert.equal(await exists(scopeFile("project", workspace)), false);

    await addServer("project", workspace, "srv", { command: "node" });
    assert.equal(await removeServer("project", workspace, "inconnu"), false);
    assert.equal(await removeServer("project", workspace, "__proto__"), false);
    assert.equal((await loadServers(workspace)).servers.length, 1);
});

test("mcp config : aucun fichier temporaire ne reste après une écriture", async t => {
    const { workspace } = await sandbox(t);

    await addServer("project", workspace, "a", { command: "node" });
    await addServer("project", workspace, "b", { command: "node" });
    await removeServer("project", workspace, "a");
    await addServer("user", workspace, "c", { command: "node" });
    await addServer("local", workspace, "d", { command: "node" });

    for (const scope of ["project", "user", "local"]) {
        const names = await fs.readdir(path.dirname(scopeFile(scope, workspace)));
        assert.deepEqual(names.filter(name => name.endsWith(".tmp")), [], scope);
    }
});

test("mcp config : le fichier temporaire est nettoyé si le rename échoue", async t => {
    const { workspace } = await sandbox(t);
    const file = scopeFile("project", workspace);

    // Un dossier à la place du fichier fait échouer le rename.
    await fs.mkdir(file, { recursive: true });
    await assert.rejects(addServer("project", workspace, "srv", { command: "node" }));

    const names = await fs.readdir(workspace);
    assert.deepEqual(names.filter(name => name.endsWith(".tmp")), []);
});

test("mcp config : 50 serveurs au maximum par scope à l'écriture", async t => {
    const { workspace } = await sandbox(t);
    const full = {};

    for (let i = 0; i < MAX_SERVERS; i++) full[`srv${i}`] = { type: "stdio", command: "node" };
    await writeScope("project", workspace, full);

    await assert.rejects(
        addServer("project", workspace, "un-de-trop", { command: "node" }),
        error => error instanceof McpConfigError && /50 serveurs/.test(error.message)
    );
    assert.equal(Object.keys((await readJson(scopeFile("project", workspace))).mcpServers).length, MAX_SERVERS);

    // Remplacer un serveur existant reste possible quand le scope est plein.
    await addServer("project", workspace, "srv0", { command: "autre" }, { replace: true });
    assert.equal((await readJson(scopeFile("project", workspace))).mcpServers.srv0.command, "autre");

    // Après un retrait, il y a de nouveau de la place.
    await removeServer("project", workspace, "srv1");
    await addServer("project", workspace, "un-de-trop", { command: "node" });
});

test("mcp config : 10 addServer concurrents sans mise à jour perdue", async t => {
    const { workspace } = await sandbox(t);
    const names = Array.from({ length: 10 }, (_, i) => `srv${i}`);

    await Promise.all(names.map(name => addServer("user", workspace, name, { command: "node", args: [name] })));

    const { servers } = await loadServers(workspace);
    assert.deepEqual(servers.map(s => s.name).sort(), [...names].sort());
});

test("mcp config : addServer et removeServer concurrents restent cohérents", async t => {
    const { workspace } = await sandbox(t);

    await addServer("user", workspace, "base", { command: "node" });
    await Promise.all([
        addServer("user", workspace, "a", { command: "node" }),
        removeServer("user", workspace, "base"),
        addServer("user", workspace, "b", { command: "node" }),
        addServer("user", workspace, "a", { command: "node" }).catch(() => "doublon")
    ]);

    const { servers } = await loadServers(workspace);
    assert.deepEqual(servers.map(s => s.name), ["a", "b"]);
});

test("mcp config : une erreur n'empêche pas les écritures suivantes", async t => {
    const { workspace } = await sandbox(t);

    await assert.rejects(addServer("user", workspace, "list", { command: "node" }));
    await addServer("user", workspace, "ok", { command: "node" });
    assert.deepEqual((await loadServers(workspace)).servers.map(s => s.name), ["ok"]);
});

test("mcp config : la configuration sur disque garde le modèle ${TOKEN}", async t => {
    const { workspace } = await sandbox(t);

    await addServer("user", workspace, "api", {
        type: "http",
        url: "https://${HOST:-api.example.com}/mcp",
        headers: { Authorization: "Bearer ${TOKEN}" }
    });

    const text = await fs.readFile(scopeFile("user"), "utf8");
    assert.ok(text.includes("${TOKEN}"));
    assert.ok(text.includes("${HOST:-api.example.com}"));

    const { servers } = await loadServers(workspace);
    const expanded = expandServer(servers[0], { TOKEN: "SECRETVALUE" });

    assert.equal(expanded.headers.Authorization, "Bearer SECRETVALUE");
    assert.equal(expanded.url, "https://api.example.com/mcp");
    assert.equal(servers[0].headers.Authorization, "Bearer ${TOKEN}");
    assert.ok(!(await fs.readFile(scopeFile("user"), "utf8")).includes("SECRETVALUE"));
});

test("mcp config : fichiers local et user en 0o600, dossier en 0o700", { skip: process.platform === "win32" }, async t => {
    const { workspace } = await sandbox(t);

    for (const scope of ["local", "user"]) {
        await addServer(scope, workspace, "srv", { command: "node" });
        await addServer(scope, workspace, "autre", { command: "node" });

        const file = scopeFile(scope, workspace);
        assert.equal((await fs.stat(file)).mode & 0o777, 0o600, scope);
        assert.equal((await fs.stat(path.dirname(file))).mode & 0o777, 0o700, scope);
    }
});

test("mcp config : le fichier .mcp.json partageable ne modifie pas les droits du dossier du projet", { skip: process.platform === "win32" }, async t => {
    const { workspace } = await sandbox(t);

    await fs.chmod(workspace, 0o755);
    await addServer("project", workspace, "srv", { command: "node" });

    assert.equal((await fs.stat(workspace)).mode & 0o777, 0o755);
    assert.notEqual((await fs.stat(scopeFile("project", workspace))).mode & 0o777, 0o600);
});
