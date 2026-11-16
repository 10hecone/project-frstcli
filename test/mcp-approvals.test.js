"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { CONFIG } = require("../src/config");
const { loadServers } = require("../src/mcp/config");
const approvals = require("../src/mcp/approvals");

const { STATUS, fingerprint, getDecision, setDecision, resetProjectChoices, statusOf, ensureApproved, describeForApproval } = approvals;

async function sandbox(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "frst-mcp-approvals-"));
    const previous = CONFIG.dataDir;
    const workspace = path.join(root, "work");

    await fs.mkdir(workspace, { recursive: true });
    CONFIG.dataDir = path.join(root, "data");

    t.after(async () => {
        CONFIG.dataDir = previous;
        await fs.rm(root, { recursive: true, force: true });
    });

    return { root, workspace };
}

const trusted = async () => true;
const untrusted = async () => false;

function projectServer(overrides = {}) {
    return {
        name: "demo",
        scope: "project",
        type: "stdio",
        command: "npx",
        args: ["-y", "serveur-demo"],
        env: { API_TOKEN: "${DEMO_TOKEN}", MODE: "test" },
        ...overrides
    };
}

function fakeUi(answers) {
    const questions = [];
    return {
        questions,
        async confirm(question) {
            questions.push(question);
            return answers.shift();
        }
    };
}

test("empreinte stable : l'ordre des clés d'env et d'en-têtes ne compte pas", () => {
    const a = projectServer({ env: { A: "1", B: "2" } });
    const b = projectServer({ env: { B: "2", A: "1" } });
    assert.equal(fingerprint(a), fingerprint(b));
    assert.match(fingerprint(a), /^[0-9a-f]{64}$/);

    const h1 = { name: "h", scope: "project", type: "http", url: "https://exemple.fr/mcp", headers: { X: "1", Y: "2" } };
    const h2 = { ...h1, headers: { Y: "2", X: "1" } };
    assert.equal(fingerprint(h1), fingerprint(h2));
});

test("empreinte : commande, argument, valeur d'env, url, en-tête ou délai modifiés ⇒ empreinte différente", () => {
    const base = projectServer();
    const variants = [
        projectServer({ command: "node" }),
        projectServer({ args: ["-y", "autre-serveur"] }),
        projectServer({ env: { API_TOKEN: "${DEMO_TOKEN}", MODE: "prod" } }),
        projectServer({ env: { API_TOKEN: "${DEMO_TOKEN}", MODE: "test", EXTRA: "1" } }),
        projectServer({ timeout: 5000 })
    ];
    for (const variant of variants) assert.notEqual(fingerprint(variant), fingerprint(base));

    const http = { name: "h", scope: "project", type: "http", url: "https://a.fr/mcp", headers: {} };
    assert.notEqual(fingerprint(http), fingerprint({ ...http, url: "https://b.fr/mcp" }));
    assert.notEqual(fingerprint(http), fingerprint({ ...http, headers: { Authorization: "Bearer ${T}" } }));
    assert.notEqual(fingerprint(http), fingerprint({ ...http, type: "sse" }));
});

test("scopes local et user : toujours approuvés, sans question", async t => {
    const { workspace } = await sandbox(t);
    const ui = fakeUi([]);

    for (const scope of ["local", "user"]) {
        const status = await ensureApproved(workspace, projectServer({ scope }), { ui, isTrusted: untrusted });
        assert.equal(status, STATUS.approved);
    }
    assert.equal(ui.questions.length, 0);
});

test("dossier non approuvé (pas de confiance) ou absent ⇒ serveur ignoré, aucune question", async t => {
    const { workspace } = await sandbox(t);
    const ui = fakeUi([true]);

    assert.equal(await ensureApproved(workspace, projectServer(), { ui, isTrusted: untrusted }), STATUS.untrusted);
    assert.equal(await ensureApproved(null, projectServer(), { ui, isTrusted: trusted }), STATUS.untrusted);
    assert.equal(ui.questions.length, 0);
});

test("sans interface : statut en attente, rien n'est mémorisé", async t => {
    const { workspace } = await sandbox(t);

    assert.equal(await ensureApproved(workspace, projectServer(), { isTrusted: trusted }), STATUS.pending);
    assert.equal(await statusOf(workspace, projectServer(), { isTrusted: trusted }), STATUS.pending);
    await assert.rejects(fs.access(approvals.approvalsFile()));
});

test("oui mémorisé : pas de seconde question ; un argument modifié ⇒ nouvelle question", async t => {
    const { workspace } = await sandbox(t);
    const ui = fakeUi([true, true]);

    assert.equal(await ensureApproved(workspace, projectServer(), { ui, isTrusted: trusted }), STATUS.approved);
    assert.equal(await ensureApproved(workspace, projectServer(), { ui, isTrusted: trusted }), STATUS.approved);
    assert.equal(ui.questions.length, 1);

    const changed = projectServer({ args: ["-y", "serveur-demo", "--danger"] });
    assert.equal(await statusOf(workspace, changed, { isTrusted: trusted }), STATUS.pending);
    assert.equal(await ensureApproved(workspace, changed, { ui, isTrusted: trusted }), STATUS.approved);
    assert.equal(ui.questions.length, 2);
});

test("refus mémorisé : plus de question, jusqu'à reset-project-choices", async t => {
    const { workspace } = await sandbox(t);
    const ui = fakeUi([false, true]);

    assert.equal(await ensureApproved(workspace, projectServer(), { ui, isTrusted: trusted }), STATUS.rejected);
    assert.equal(await ensureApproved(workspace, projectServer(), { ui, isTrusted: trusted }), STATUS.rejected);
    assert.equal(ui.questions.length, 1);

    assert.equal(await resetProjectChoices(workspace), 1);
    assert.equal(await resetProjectChoices(workspace), 0);
    assert.equal(await ensureApproved(workspace, projectServer(), { ui, isTrusted: trusted }), STATUS.approved);
    assert.equal(ui.questions.length, 2);
});

test("décisions séparées par dossier ; clé en minuscules sous Windows", async t => {
    const { root, workspace } = await sandbox(t);
    const other = path.join(root, "autre");
    await fs.mkdir(other);

    await setDecision(workspace, projectServer(), "approved");
    assert.equal(await getDecision(workspace, projectServer()), STATUS.approved);
    assert.equal(await getDecision(other, projectServer()), STATUS.pending);

    if (process.platform === "win32") {
        assert.equal(await getDecision(workspace.toUpperCase(), projectServer()), STATUS.approved);
    }
});

test("deux demandes simultanées ne posent qu'une question", async t => {
    const { workspace } = await sandbox(t);
    const ui = fakeUi([true, true]);

    const results = await Promise.all([
        ensureApproved(workspace, projectServer(), { ui, isTrusted: trusted }),
        ensureApproved(workspace, projectServer(), { ui, isTrusted: trusted })
    ]);
    assert.deepEqual(results, [STATUS.approved, STATUS.approved]);
    assert.equal(ui.questions.length, 1);
});

test("question : noms des variables et des en-têtes, jamais leurs valeurs", () => {
    const stdio = describeForApproval(projectServer({ env: { API_TOKEN: "valeur-secrete-123" } }));
    assert.match(stdio, /demo/);
    assert.match(stdio, /npx -y serveur-demo/);
    assert.match(stdio, /API_TOKEN/);
    assert.doesNotMatch(stdio, /valeur-secrete-123/);

    const http = describeForApproval({
        name: "web", scope: "project", type: "http", url: "https://exemple.fr/mcp",
        headers: { Authorization: "Bearer jeton-tres-secret" }
    });
    assert.match(http, /https:\/\/exemple\.fr\/mcp/);
    assert.match(http, /Authorization/);
    assert.doesNotMatch(http, /jeton-tres-secret/);
});

test("fichier d'approbations : forme attendue et droits 0o600 (hors Windows)", async t => {
    const { workspace } = await sandbox(t);
    await setDecision(workspace, projectServer(), "rejected");

    const data = JSON.parse(await fs.readFile(approvals.approvalsFile(), "utf8"));
    assert.equal(data.version, 1);
    const entry = data.projects[approvals.projectKey(workspace)].demo;
    assert.equal(entry.decision, "rejected");
    assert.equal(entry.sha256, fingerprint(projectServer()));

    if (process.platform !== "win32") {
        const info = await fs.stat(approvals.approvalsFile());
        assert.equal(info.mode & 0o777, 0o600);
    }
});

test("fichier d'approbations corrompu : tout est redemandé (jamais approuvé par défaut)", async t => {
    const { workspace } = await sandbox(t);
    await fs.mkdir(CONFIG.dataDir, { recursive: true });
    await fs.writeFile(approvals.approvalsFile(), "{ pas du json", "utf8");

    assert.equal(await getDecision(workspace, projectServer()), STATUS.pending);
});

test("de bout en bout avec .mcp.json : modifier le fichier après approbation redemande", async t => {
    const { workspace } = await sandbox(t);
    const file = path.join(workspace, ".mcp.json");
    const write = def => fs.writeFile(file, JSON.stringify({ mcpServers: { demo: def } }), "utf8");
    const find = async () => (await loadServers(workspace)).servers.find(s => s.name === "demo");

    await write({ command: "node", args: ["serveur.js"] });
    const ui = fakeUi([true]);
    assert.equal(await ensureApproved(workspace, await find(), { ui, isTrusted: trusted }), STATUS.approved);

    await write({ command: "node", args: ["serveur.js", "--autre"] });
    assert.equal(await statusOf(workspace, await find(), { isTrusted: trusted }), STATUS.pending);
});

test("setDecision refuse une décision inconnue", async t => {
    const { workspace } = await sandbox(t);
    assert.throws(() => setDecision(workspace, projectServer(), "peut-être"), /décision inconnue/);
});
