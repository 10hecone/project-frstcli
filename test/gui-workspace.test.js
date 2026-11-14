"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const { createWorkspace, listOf, normalizeChat, messageText, normalizeFile } = require("../src/gui/workspace");
const { createTuiBackend } = require("../src/tui/adapter");
const { createGuiHost } = require("../src/gui/host");
const { CHANNELS } = require("../src/gui/channels");

/** Workspace avec toutes ses dépendances simulées : aucun réseau, aucun Electron. */
function setup({ routes = () => ({}), running = false, uploads = null } = {}) {
    const calls = { requests: [], dispatched: [], cleared: 0, refreshed: 0, resets: [], conversations: [], saved: undefined };
    const state = { workspace: path.join("dev", "projet"), model: 7, chatIds: {}, frProject: null, pendingFiles: ["ancien"] };
    const stateModule = {
        state,
        resetConversation(kind) {
            calls.resets.push(kind);
            state.chatIds = {};
        },
        setConversation(kind, id, extra) {
            calls.conversations.push({ kind, id, extra });
            state.chatIds = { [kind]: id };
            if (extra && extra.model) state.model = extra.model;
        }
    };
    const rest = {
        async request(method, route, body) {
            calls.requests.push({ method, route, body });
            return routes(method, route, body);
        },
        async uploadFile(filePath) {
            return uploads(filePath);
        }
    };
    const backend = {
        store: { dispatch: (action) => calls.dispatched.push(action) },
        clear: () => {
            calls.cleared += 1;
        }
    };
    const agents = {
        async listAgents() {
            return {
                agents: [
                    { id: 7, name: "Rapide", provider: "fr", isDefault: true },
                    { id: 9, name: "Expert", description: "Raisonnement" }
                ]
            };
        }
    };
    const projects = {
        async listProjects() {
            return [{ id: "p1", name: "Thèse" }, { id: "p2" }, null];
        },
        async saveSelected(project) {
            calls.saved = project;
            state.frProject = project;
        }
    };
    const workspace = createWorkspace({
        backend,
        refresh: () => {
            calls.refreshed += 1;
        },
        isRunning: () => running,
        rest,
        agents,
        projects,
        stateModule,
        detectEnvironment: async () => ({ git: { branch: "main" } }),
        sessionUsage: { requests: 2, inputTokens: 100 }
    });
    return { workspace, calls, state };
}

test("workspace : utilitaires de lecture défensive", () => {
    assert.deepEqual(listOf([1]), [1]);
    assert.deepEqual(listOf({ chats: [2] }, "chats"), [2]);
    assert.deepEqual(listOf({ data: [3] }), [3]);
    assert.deepEqual(listOf(null), []);
    assert.equal(normalizeChat({}), null);
    assert.deepEqual(normalizeChat({ id: "c1", title: "  ", agent: { id: 9 }, updatedAt: "2026-11-01" }), {
        id: "c1",
        title: "Sans titre",
        projectId: null,
        isPinned: false,
        lastMessageAt: "2026-11-01",
        agentId: 9
    });
    assert.equal(messageText({ content: [{ text: "a" }, "b", {}] }), "a\nb");
    assert.equal(messageText({ text: "c" }), "c");
});

test("workspace : normalizeFile lit l'enveloppe data et exige un id", () => {
    assert.deepEqual(normalizeFile({ data: { id: "f1", filename: "a.pdf", bytes: 10 } }, "x"), {
        id: "f1",
        name: "a.pdf",
        bytes: 10
    });
    assert.deepEqual(normalizeFile({ fileId: "f2", size: "5" }, "b.txt"), { id: "f2", name: "b.txt", bytes: 5 });
    assert.throws(() => normalizeFile({ data: {} }, "c"), /identifiant/);
});

test("workspace : info donne branche, modèle et agents", async () => {
    const { workspace } = setup();
    const info = await workspace.info();
    assert.equal(info.branch, "main");
    assert.equal(info.workspaceName, "projet");
    assert.equal(info.modelId, 7);
    assert.equal(info.chatId, null);
    assert.deepEqual(
        info.agents.map((agent) => [agent.id, agent.name, agent.isDefault]),
        [
            [7, "Rapide", true],
            [9, "Expert", false]
        ]
    );
});

test("workspace : listChats choisit la route (récents, projet, recherche)", async () => {
    const { workspace, calls } = setup({
        routes: () => ({ data: [{ id: "c1", title: "Un", isPinned: true }, { title: "sans id" }], hasMore: true })
    });

    const recent = await workspace.listChats();
    assert.equal(calls.requests[0].route, "/chats?limit=40");
    assert.equal(recent.hasMore, true);
    assert.deepEqual(
        recent.chats.map((chat) => [chat.id, chat.isPinned]),
        [["c1", true]]
    );

    await workspace.listChats({ cursor: "c9" });
    assert.equal(calls.requests[1].route, "/chats?limit=40&cursor_chat_id=c9");

    await workspace.listChats({ projectId: "p 1" });
    assert.equal(calls.requests[2].route, "/projects/p%201/chats?limit=40");

    // La recherche l'emporte sur le projet et le curseur.
    await workspace.listChats({ query: "  thèse ", projectId: "p1", cursor: "c9" });
    assert.equal(calls.requests[3].route, `/chats/search?query=${encodeURIComponent("thèse")}`);
});

test("workspace : openChat vide le transcript puis rejoue l'historique", async () => {
    const { workspace, calls, state } = setup({
        routes: () => ({
            title: "Révisions",
            agent: { id: 9 },
            chatMessages: [
                { role: "user", content: "Bonjour" },
                { role: "assistant", content: [{ text: "Salut" }] },
                { role: "system", content: "ignoré" },
                { role: "user", content: "   " }
            ]
        })
    });

    const result = await workspace.openChat(" c1 ");
    assert.deepEqual(result, { ok: true, id: "c1", title: "Révisions" });
    assert.equal(calls.requests[0].route, "/chats/c1");
    assert.deepEqual(calls.resets, ["chat"]);
    assert.deepEqual(calls.conversations, [{ kind: "chat", id: "c1", extra: { model: 9 } }]);
    assert.deepEqual(state.pendingFiles, []);
    assert.equal(state.model, 9);

    assert.equal(calls.dispatched[0].type, "clear");
    assert.equal(calls.dispatched[1].entry.type, "info");
    assert.match(calls.dispatched[1].entry.text, /Révisions/);
    assert.deepEqual(
        calls.dispatched.slice(2).map((action) => [action.entry.type, action.entry.text]),
        [
            ["user", "Bonjour"],
            ["assistant", "Salut"]
        ]
    );
    assert.equal(calls.refreshed, 1);

    await assert.rejects(workspace.openChat("  "), /manquant/);
});

test("workspace : openChat, newThread et setModel refusés pendant une demande", async () => {
    const { workspace, calls } = setup({ running: true });
    await assert.rejects(workspace.openChat("c1"), /en cours/);
    assert.throws(() => workspace.newThread(), /en cours/);
    await assert.rejects(workspace.setModel(9), /en cours/);
    assert.equal(calls.requests.length, 0);
    assert.equal(calls.cleared, 0);
});

test("workspace : newThread réinitialise la conversation et l'écran", () => {
    const { workspace, calls, state } = setup();
    state.chatIds = { chat: "c1" };
    assert.deepEqual(workspace.newThread(), { ok: true });
    assert.deepEqual(calls.resets, ["chat"]);
    assert.deepEqual(state.chatIds, {});
    assert.deepEqual(state.pendingFiles, []);
    assert.equal(calls.cleared, 1);
    assert.equal(calls.refreshed, 1);
});

test("workspace : setModel change de modèle et ouvre une nouvelle conversation", async () => {
    const { workspace, calls, state } = setup();

    assert.deepEqual(await workspace.setModel(7), { ok: true, changed: false, name: "Rapide" });
    assert.equal(calls.resets.length, 0);

    assert.deepEqual(await workspace.setModel("9"), { ok: true, changed: true, name: "Expert" });
    assert.equal(state.model, 9);
    assert.deepEqual(calls.resets, ["chat"]);
    assert.match(calls.dispatched[0].entry.text, /Expert/);
    assert.equal(calls.refreshed, 1);

    await assert.rejects(workspace.setModel(42), /introuvable/);
});

test("workspace : projets listés, rattachés puis détachés", async () => {
    const { workspace, calls } = setup();
    const list = await workspace.listProjects();
    assert.deepEqual(list, {
        selectedId: null,
        projects: [
            { id: "p1", name: "Thèse" },
            { id: "p2", name: "Sans nom" }
        ]
    });

    assert.deepEqual(await workspace.selectProject("p1"), { selectedId: "p1" });
    assert.deepEqual(calls.saved, { id: "p1", name: "Thèse" });
    assert.equal((await workspace.listProjects()).selectedId, "p1");

    assert.deepEqual(await workspace.selectProject(null), { selectedId: null });
    assert.equal(calls.saved, null);
    await assert.rejects(workspace.selectProject("p9"), /introuvable/);
});

test("workspace : usage tolère des échecs partiels", async () => {
    const partial = setup({
        routes: (method, route) => {
            if (route === "/user/usage") return { rateLimits: [{ type: "chat", usedPercent: 40 }] };
            throw new Error("indisponible");
        }
    });
    const usage = await partial.workspace.usage();
    assert.equal(usage.limits.rateLimits[0].usedPercent, 40);
    assert.equal(usage.tokens, null);
    assert.equal(usage.storage, null);
    assert.equal(usage.error, null);
    assert.deepEqual(usage.session, { requests: 2, inputTokens: 100 });
    assert.deepEqual(
        partial.calls.requests.map((call) => call.route),
        ["/user/usage", "/user/tokenusage?tokenUsageDays=7", "/filesv2/usage"]
    );

    const down = setup({
        routes: () => {
            throw new Error("hors ligne");
        }
    });
    assert.equal((await down.workspace.usage()).error, "hors ligne");
});

test("workspace : skills personnels et partagés, interrupteur sur la bonne route", async () => {
    const { workspace, calls } = setup({
        routes: (method, route) => {
            if (route === "/skills") return { data: [{ id: "s1", name: "Résumé" }] };
            if (route === "/skills/shared") return [{ id: "s2", display_title: "Fiches", enabled: false }];
            return {};
        }
    });
    const { skills } = await workspace.listSkills();
    assert.deepEqual(
        skills.map((skill) => [skill.id, skill.name, skill.enabled, skill.shared]),
        [
            ["s1", "Résumé", true, false],
            ["s2", "Fiches", false, true]
        ]
    );

    assert.deepEqual(await workspace.toggleSkill("s2", false, true), { ok: true, enabled: false });
    assert.deepEqual(calls.requests.at(-1), { method: "POST", route: "/skills/shared/s2", body: { enabled: false } });
    await workspace.toggleSkill("s1", 1);
    assert.deepEqual(calls.requests.at(-1), { method: "POST", route: "/skills/s1", body: { enabled: true } });
});

test("workspace : uploadFiles continue après un échec", async () => {
    const { workspace } = setup({
        uploads: async (filePath) => {
            if (filePath.includes("gros")) throw new Error("fichier trop gros");
            return { data: { id: `id-${path.basename(filePath)}`, bytes: 3 } };
        }
    });
    const result = await workspace.uploadFiles([path.join("tmp", "a.pdf"), path.join("tmp", "gros.zip"), path.join("tmp", "b.txt")]);
    assert.deepEqual(result.files, [
        { id: "id-a.pdf", name: "a.pdf", bytes: 3 },
        { id: "id-b.txt", name: "b.txt", bytes: 3 }
    ]);
    assert.deepEqual(result.errors, ["gros.zip : fichier trop gros"]);
});

test("canaux IPC : canaux de l'espace de travail présents", () => {
    for (const name of ["INFO", "CHATS", "OPEN_CHAT", "NEW_THREAD", "PROJECTS", "SELECT_PROJECT", "USAGE", "SKILLS", "TOGGLE_SKILL", "SET_MODEL", "PICK_FILES"]) {
        assert.match(CHANNELS[name] || "", /^frst:/, name);
    }
});

/** Hôte avec un état simulé (stateModule) pour suivre state.pendingFiles. */
function setupHost({ statusExtra = null } = {}) {
    const state = { pendingFiles: [], model: 7, chatIds: {}, frProject: null };
    const seen = [];
    const host = createGuiHost({
        send: () => {},
        session: {
            async bootstrap() {
                return { ok: true };
            },
            async handleInput(text) {
                seen.push({ text, files: [...state.pendingFiles] });
                return { exit: false };
            }
        },
        bridge: { setUiBackend() {} },
        createBackend: (store) => createTuiBackend(store, { jobs: { runningCount: () => 0 }, usage: {} }),
        jobs: { killAll() {} },
        memory: { close() {} },
        stateModule: { state },
        statusExtra
    });
    return { host, state, seen };
}

test("hôte : pièces jointes passées au cœur puis toujours vidées", async () => {
    const { host, state, seen } = setupHost();
    await host.submit("Analyse ces fichiers", ["f1", "f1", " ", null, "f2"]);
    assert.deepEqual(seen[0], { text: "Analyse ces fichiers", files: ["f1", "f2"] });
    assert.deepEqual(state.pendingFiles, []);
    const users = host.store.getState().transcript.filter((entry) => entry.type === "user");
    assert.equal(users.at(-1).files, 2);

    // Une commande /… n'emporte jamais de pièces jointes.
    await host.submit("/help", ["f3"]);
    assert.deepEqual(seen[1], { text: "/help", files: [] });
    const last = host.store.getState().transcript.filter((entry) => entry.type === "user").at(-1);
    assert.equal(last.files, undefined);
});

test("hôte : pendingFiles vidé même si le cœur échoue", async () => {
    const state = { pendingFiles: [], chatIds: {} };
    const failing = createGuiHost({
        send: () => {},
        session: {
            async bootstrap() {
                return { ok: true };
            },
            async handleInput() {
                throw new Error("panne");
            }
        },
        bridge: { setUiBackend() {} },
        createBackend: (store) => createTuiBackend(store, { jobs: { runningCount: () => 0 }, usage: {} }),
        jobs: { killAll() {} },
        memory: { close() {} },
        stateModule: { state }
    });
    await failing.submit("Bonjour", ["f1"]);
    assert.deepEqual(state.pendingFiles, []);
    assert.ok(failing.store.getState().transcript.some((entry) => entry.type === "error" || /panne/.test(entry.text || "")));
});

test("hôte : statusExtra ajoute la branche à la barre d'état", async () => {
    const { host } = setupHost({ statusExtra: async () => ({ branch: "feature/gui" }) });
    await host.start();
    await host.syncStatus();
    const status = host.store.getState().status;
    assert.equal(status.branch, "feature/gui");
    assert.equal(status.modelId, 7);
    assert.equal(status.chatId, null);
});

/** Charge un module ESM du renderer en CommonJS (comme gui-renderer-lib.test.js). */
function loadRendererModule(relative) {
    const esbuild = require("esbuild");
    const file = path.join(__dirname, "..", "src", "gui", "renderer", relative);
    const out = esbuild.buildSync({ entryPoints: [file], bundle: true, format: "cjs", platform: "node", write: false, logLevel: "silent" });
    const mod = new Module(file);
    mod.filename = file;
    mod.paths = Module._nodeModulePaths(path.dirname(file));
    mod._compile(out.outputFiles[0].text, file);
    return mod.exports;
}

test("client : méthodes d'espace de travail complétées hors ligne", async () => {
    const client = loadRendererModule("api/client.js");
    const minimal = Object.fromEntries(client.CLIENT_METHODS.map((name) => [name, () => "session"]));
    const full = client.withWorkspace(minimal);
    assert.notEqual(full, minimal);
    assert.equal(full.start(), "session");
    assert.deepEqual(await full.listChats(), { chats: [], hasMore: false });
    assert.equal((await full.pickFiles()).cancelled, true);
    assert.equal((await full.info()).branch, null);

    const complete = { ...minimal, ...Object.fromEntries(client.WORKSPACE_METHODS.map((name) => [name, () => name])) };
    assert.equal(client.withWorkspace(complete), complete);

    const offline = client.createOfflineClient();
    assert.equal(client.withWorkspace(offline), offline);
    assert.deepEqual((await offline.listSkills()).skills, []);
});

test("format : temps relatifs, nombres et libellés de limites", () => {
    const format = loadRendererModule("lib/format.js");
    const now = Date.parse("2026-11-14T12:00:00Z");
    assert.equal(format.relativeTime("2026-11-14T11:59:30Z", now), "à l’instant");
    assert.equal(format.relativeTime("2026-11-14T11:55:00Z", now), "il y a 5 min");
    assert.equal(format.relativeTime("2026-11-13T12:00:00Z", now), "hier");
    assert.equal(format.relativeTime("pas une date", now), "");
    assert.equal(format.resetTime("2026-11-14T15:00:00Z", now), "dans 3 h");
    assert.equal(format.resetTime("2026-11-14T11:00:00Z", now), "maintenant");
    assert.equal(format.percent(140), 100);
    assert.equal(format.percent("x"), null);
    assert.equal(format.bytes(2048), "2 Ko");
    assert.equal(format.limitLabel({ type: "chat", bucket: "day" }), "Messages par jour");
});
