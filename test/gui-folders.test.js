"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createFolders, folderFromArgv } = require("../src/gui/folders");

/** Dossiers avec toutes leurs dépendances simulées ; les dossiers sont de vrais dossiers temporaires. */
function setup({ known = {}, running = false } = {}) {
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "frst-folders-")));
    const calls = { opened: [], closed: 0, cleared: 0, refreshed: 0, trusted: [] };
    const state = { contextUsagePercent: 42, contextDetails: {}, pendingFiles: ["f"] };
    const projects = {
        async get(p) {
            return known[p] || null;
        },
        async list() {
            return Object.values(known);
        },
        async trust(p) {
            calls.trusted.push(p);
        }
    };
    const workspaceCore = {
        async open(p) {
            calls.opened.push(p);
            return true;
        },
        close() {
            calls.closed += 1;
        }
    };
    const folders = createFolders({
        backend: { clear: () => (calls.cleared += 1) },
        refresh: () => (calls.refreshed += 1),
        isRunning: () => running,
        projects,
        detectEnvironment: async () => ({ git: { branch: "main" } }),
        stateModule: { state },
        workspaceCore
    });
    return { folders, calls, state, dir, known };
}

test("folderFromArgv : ignore l'exécutable, le script de développement et les options", () => {
    const cwd = path.resolve("travail");
    const absolute = path.resolve("ailleurs", "projet");

    // Application empaquetée : [exécutable, options Chromium, dossier].
    assert.equal(folderFromArgv(["app.exe", "--allow-file-access", absolute], { cwd }), absolute);
    assert.equal(folderFromArgv(["app.exe", "sous-dossier"], { cwd }), path.join(cwd, "sous-dossier"));
    assert.equal(folderFromArgv(["app.exe"], { cwd }), null);
    assert.equal(folderFromArgv(["app.exe", "--seule-option", "  "], { cwd }), null);

    // Mode développement (electron .) : le deuxième élément est le script, pas un dossier.
    assert.equal(folderFromArgv(["electron.exe", ".", absolute], { defaultApp: true, cwd }), absolute);
    assert.equal(folderFromArgv(["electron.exe", "."], { defaultApp: true, cwd }), null);

    assert.equal(folderFromArgv(undefined), null);
});

test("folders : un dossier de confiance s'ouvre, vide le transcript et oublie le contexte", async () => {
    const ctx = setup();
    ctx.known[ctx.dir] = { path: ctx.dir, trusted: true };
    assert.deepEqual(await ctx.folders.open(ctx.dir), { ok: true, path: ctx.dir });
    assert.deepEqual(ctx.calls.opened, [ctx.dir]);
    assert.equal(ctx.calls.cleared, 1);
    assert.equal(ctx.calls.refreshed, 1);
    assert.equal(ctx.state.contextUsagePercent, null);
    assert.deepEqual(ctx.state.pendingFiles, []);
});

test("folders : ouvrir un autre dossier arrête les serveurs MCP du précédent", async () => {
    const { createMcpManager, bindWorkspace } = require("../src/mcp/manager");
    const first = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "frst-folders-")));
    const second = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "frst-folders-")));

    // Cœur d'espace de travail simulé, même contrat que src/core/workspace.js (open + onChange).
    const listeners = new Set();
    let root = first;
    const workspaceCore = {
        async open(p) {
            root = p;
            for (const listener of listeners) listener({ root });
            return true;
        },
        close() {},
        onChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };

    // Connexions simulées : aucun processus lancé.
    const closed = [];
    const manager = createMcpManager({
        root: first,
        loadServers: async () => ({ servers: [{ name: "local", scope: "user", transport: "stdio", command: "srv", args: [] }] }),
        expandServer: (server) => server,
        ensureApproved: async () => "approved",
        statusOf: async () => "approved",
        fingerprint: () => "empreinte",
        createConnection: (server, options) => ({
            state: "idle",
            busy: false,
            lastUsed: 0,
            cwd: options.cwd,
            async connect() {
                this.state = "connected";
            },
            async close() {
                this.state = "closed";
                closed.push(this.cwd);
            },
            killSync() {
                this.state = "closed";
            }
        })
    });
    const unbind = bindWorkspace(manager, workspaceCore);

    const projects = {
        async get(p) {
            return { path: p, trusted: true };
        },
        async list() {
            return [];
        },
        async trust() {}
    };
    const folders = createFolders({
        backend: { clear: () => {} },
        projects,
        detectEnvironment: async () => ({}),
        stateModule: { state: { pendingFiles: [] } },
        workspaceCore
    });

    const connection = await manager.connect("local");
    assert.equal(connection.cwd, first);
    assert.equal((await folders.open(second)).ok, true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(connection.state, "closed");
    assert.deepEqual(closed, [first]);
    assert.equal(manager.root, second);
    unbind();
});

test("folders : un dossier sans confiance n'est pas ouvert, la confiance est demandée", async () => {
    const ctx = setup();
    const result = await ctx.folders.open(ctx.dir);
    assert.equal(result.needsTrust, true);
    assert.equal(result.ok, false);
    assert.match(result.message, /fournisseur API/);
    assert.deepEqual(ctx.calls.opened, []);
    assert.equal(ctx.calls.cleared, 0);
});

test("folders : trust enregistre la confiance sans ouvrir", async () => {
    const ctx = setup();
    assert.deepEqual(await ctx.folders.trust(ctx.dir), { ok: true, path: ctx.dir });
    assert.deepEqual(ctx.calls.trusted, [ctx.dir]);
    assert.deepEqual(ctx.calls.opened, []);
});

test("folders : open et close sont refusés pendant une demande", async () => {
    const ctx = setup({ running: true });
    await assert.rejects(ctx.folders.open(ctx.dir), /demande est en cours/);
    assert.throws(() => ctx.folders.close(), /demande est en cours/);
    assert.deepEqual(ctx.calls.opened, []);
    assert.equal(ctx.calls.closed, 0);
});

test("folders : un chemin inexistant ou un fichier est refusé", async () => {
    const ctx = setup();
    await assert.rejects(ctx.folders.open(path.join(ctx.dir, "absent")));
    const file = path.join(ctx.dir, "a.txt");
    fs.writeFileSync(file, "x");
    await assert.rejects(ctx.folders.open(file), /pas un dossier/);
    await assert.rejects(ctx.folders.open("  "), /manquant/);
});

test("folders : close ferme le dossier et vide le transcript", () => {
    const ctx = setup();
    assert.deepEqual(ctx.folders.close(), { ok: true });
    assert.equal(ctx.calls.closed, 1);
    assert.equal(ctx.calls.cleared, 1);
});

test("folders : recent donne nom, branche et nombre de sessions", async () => {
    const ctx = setup();
    ctx.known.a = {
        path: path.join("x", "alpha"),
        trusted: true,
        lastOpenedAt: "2026-11-01",
        sessions: [{ id: "1" }, { id: "2" }]
    };
    ctx.known.b = { path: path.join("x", "beta") };
    const list = await ctx.folders.recent();
    assert.deepEqual(list[0], {
        name: "alpha",
        path: path.join("x", "alpha"),
        branch: "main",
        sessions: 2,
        lastOpenedAt: "2026-11-01",
        trusted: true
    });
    assert.equal(list[1].sessions, 0);
    assert.equal(list[1].trusted, false);
});

test("folders : sessions du dossier, titre de repli", async () => {
    const ctx = setup();
    ctx.known[ctx.dir] = {
        path: ctx.dir,
        sessions: [{ id: 5, title: "Mon plan", updatedAt: "2026-11-02" }, { id: "6" }]
    };
    assert.deepEqual(await ctx.folders.sessions(ctx.dir), [
        { id: "5", title: "Mon plan", updatedAt: "2026-11-02" },
        { id: "6", title: "Sans titre", updatedAt: null }
    ]);
    assert.deepEqual(await setup().folders.sessions(ctx.dir), []);
});
