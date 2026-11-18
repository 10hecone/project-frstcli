"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { state, resetConversation } = require("../src/state");
const { setUiBackend, UI_METHODS } = require("../src/ui-bridge");
const auth = require("../src/api/auth");
const login = require("../src/api/login");
const commands = require("../src/cli/commands");
const sessions = require("../src/core/sessions");
const { workspace: workspaceObject } = require("../src/core/workspace");
const router = require("../src/cli/router");
const chat = require("../src/core/chat");
const session = require("../src/core/session");

function setup({
    workspace = null,
    keepGoing = true,
    workspaceQuestion = false,
} = {}) {
    const original = {
        handleCommand: commands.handleCommand,
        send: chat.send,
        isWorkspaceQuestion: router.isWorkspaceQuestion,
        initAuth: auth.initAuth,
        promptAndLogin: login.promptAndLogin,
        open: workspaceObject.open,
        sessions: { ...sessions },
        workspace: state.workspace,
    };

    const calls = { command: [], chat: [], ui: [], login: 0 };

    const fakeUi = {};
    for (const name of UI_METHODS) {
        fakeUi[name] = (...args) => {
            calls.ui.push({ name, args });
        };
    }
    setUiBackend(fakeUi);

    commands.handleCommand = async (input) => {
        calls.command.push(input);
        return keepGoing;
    };
    chat.send = async (input, options = {}) => {
        calls.chat.push({ input, options });
        if (options.onDelta) options.onDelta("delta");
        return { response: "ok", newChatId: null };
    };
    router.isWorkspaceQuestion = () => workspaceQuestion;

    resetConversation();
    state.workspace = workspace;

    function restore() {
        Object.assign(commands, { handleCommand: original.handleCommand });
        chat.send = original.send;
        router.isWorkspaceQuestion = original.isWorkspaceQuestion;
        auth.initAuth = original.initAuth;
        login.promptAndLogin = original.promptAndLogin;
        workspaceObject.open = original.open;
        Object.assign(sessions, original.sessions);
        state.workspace = original.workspace;
        resetConversation();
        setUiBackend(null);
    }

    return { calls, restore };
}

// ---- handleInput : routage ----

test("handleInput : saisie vide ignorée", async () => {
    const { calls, restore } = setup();
    try {
        assert.deepEqual(await session.handleInput("   "), { exit: false });
        assert.equal(calls.command.length + calls.chat.length, 0);
    } finally {
        restore();
    }
});

test("handleInput : une commande /... passe par handleCommand", async () => {
    const { calls, restore } = setup({ keepGoing: true });
    try {
        assert.deepEqual(await session.handleInput("  /help "), { exit: false });
        assert.deepEqual(calls.command, ["/help"]);
        assert.equal(calls.chat.length, 0);
    } finally {
        restore();
    }
});

test("handleInput : /exit (handleCommand renvoie false) demande l'arrêt", async () => {
    const { calls, restore } = setup({ keepGoing: false });
    try {
        assert.deepEqual(await session.handleInput("/exit"), { exit: true });
        assert.deepEqual(calls.command, ["/exit"]);
    } finally {
        restore();
    }
});

test("handleInput : question sur le projet actuel", async () => {
    const { calls, restore } = setup({ workspace: "C:/projet", workspaceQuestion: true });
    try {
        assert.deepEqual(await session.handleInput("quel projet ?"), { exit: false });
        const shown = calls.ui.find((call) => call.name === "assistant");
        assert.ok(shown);
        assert.equal(shown.args[0], "Dossier actuel : C:/projet");
        assert.equal(calls.chat.length, 0);
    } finally {
        restore();
    }
});

test("handleInput : question projet sans dossier ouvert (--no-project)", async () => {
    const { calls, restore } = setup({ workspaceQuestion: true });
    try {
        await session.handleInput("quel projet ?");
        const shown = calls.ui.find((call) => call.name === "assistant");
        assert.equal(shown.args[0], "Dossier actuel : aucun (chat sans outils, frst --no-project).");
    } finally {
        restore();
    }
});

test("handleInput : sans dossier, une demande sur des fichiers va quand même au chat", async () => {
    const { calls, restore } = setup();
    try {
        await session.handleInput("lis le fichier index.js");
        assert.equal(calls.chat.length, 1);
    } finally {
        restore();
    }
});

test("handleInput : avec un projet, une demande d'action va au chat (le modèle choisit ses outils)", async () => {
    const { calls, restore } = setup({ workspace: "C:/projet" });
    try {
        assert.deepEqual(await session.handleInput("corrige le bug"), { exit: false });
        assert.equal(calls.chat.length, 1);
        assert.equal(calls.chat[0].input, "corrige le bug");
    } finally {
        restore();
    }
});

test("handleInput : envoi au chat avec onChatDelta", async () => {
    const { calls, restore } = setup();
    try {
        const deltas = [];
        await session.handleInput("bonjour", { onChatDelta: (text) => deltas.push(text) });
        assert.equal(calls.chat.length, 1);
        assert.equal(calls.chat[0].input, "bonjour");
        assert.deepEqual(deltas, ["delta"]);
    } finally {
        restore();
    }
});

test("handleInput : sendChat remplace l'envoi par défaut", async () => {
    const { calls, restore } = setup();
    try {
        const sent = [];
        await session.handleInput("bonjour", { sendChat: async (input) => sent.push(input) });
        assert.deepEqual(sent, ["bonjour"]);
        assert.equal(calls.chat.length, 0);
    } finally {
        restore();
    }
});

test("handleInput : les erreurs de chat.send remontent à l'appelant", async () => {
    const { restore } = setup({ workspace: "C:/projet" });
    try {
        chat.send = async () => {
            throw new Error("boom");
        };
        await assert.rejects(session.handleInput("fais quelque chose"), /boom/);
    } finally {
        restore();
    }
});

// ---- bootstrap ----

test("bootstrap : session valide, nouvelle conversation (aucune restauration automatique)", async () => {
    const { calls, restore } = setup();
    try {
        auth.initAuth = async () => {};
        sessions.listSessions = async () => {
            throw new Error("ne doit pas lister les sessions");
        };

        assert.deepEqual(await session.bootstrap(), { ok: true, session: { kind: "new" } });
        assert.equal(state.chatIds.chat, null);
        assert.ok(calls.ui.some((call) => call.name === "info"));
    } finally {
        restore();
    }
});

test("bootstrap : --no-project n'ouvre aucun dossier", async () => {
    const { restore } = setup();
    try {
        auth.initAuth = async () => {};
        const opened = [];
        workspaceObject.open = async (dir) => opened.push(dir);

        const result = await session.bootstrap({ dir: "C:/projet", noProject: true });
        assert.deepEqual(result, { ok: true, session: { kind: "none" } });
        assert.deepEqual(opened, []);
    } finally {
        restore();
    }
});

test("bootstrap : le dossier demandé est ouvert", async () => {
    const { restore } = setup();
    try {
        auth.initAuth = async () => {};
        const opened = [];
        workspaceObject.open = async (dir) => {
            opened.push(dir);
            return true;
        };

        assert.deepEqual(await session.bootstrap({ dir: "C:/projet" }), { ok: true, session: { kind: "new" } });
        assert.deepEqual(opened, ["C:/projet"]);
    } finally {
        restore();
    }
});

test("bootstrap : dossier non approuvé → échec explicite", async () => {
    const { restore } = setup();
    try {
        auth.initAuth = async () => {};
        workspaceObject.open = async () => false;

        const result = await session.bootstrap({ dir: "C:/projet" });
        assert.equal(result.ok, false);
        assert.match(result.reason, /non approuvé/);
    } finally {
        restore();
    }
});

test("bootstrap : --continue reprend la session la plus récente", async () => {
    const { restore } = setup();
    try {
        auth.initAuth = async () => {};
        workspaceObject.open = async () => true;
        const recent = { id: "s-2" };
        const resumed = [];
        sessions.listSessions = async () => [recent, { id: "s-1" }];
        sessions.chooseSession = async () => {
            throw new Error("pas de sélecteur avec --continue");
        };
        sessions.resumeSession = (entry) => resumed.push(entry);
        sessions.describeSession = () => ({ title: "Récente" });

        const result = await session.bootstrap({ dir: "C:/projet", continue: true });
        assert.deepEqual(result, { ok: true, session: { kind: "resumed", title: "Récente" } });
        assert.deepEqual(resumed, [recent]);
    } finally {
        restore();
    }
});

test("bootstrap : --resume sans session précédente → nouvelle session", async () => {
    const { calls, restore } = setup();
    try {
        auth.initAuth = async () => {};
        workspaceObject.open = async () => true;
        sessions.listSessions = async () => [];

        const result = await session.bootstrap({ dir: "C:/projet", resume: true });
        assert.deepEqual(result, { ok: true, session: { kind: "new" } });
        assert.ok(calls.ui.some((call) => call.name === "info" && /Aucune session précédente/.test(call.args[0])));
    } finally {
        restore();
    }
});

test("bootstrap : --resume annulé (Échap) → nouvelle session", async () => {
    const { restore } = setup();
    try {
        auth.initAuth = async () => {};
        workspaceObject.open = async () => true;
        sessions.listSessions = async () => [{ id: "s-1" }];
        sessions.chooseSession = async () => null;
        sessions.resumeSession = () => {
            throw new Error("rien ne doit être repris");
        };

        assert.deepEqual(await session.bootstrap({ dir: "C:/projet", resume: true }), {
            ok: true,
            session: { kind: "new" },
        });
    } finally {
        restore();
    }
});

test("bootstrap : erreur sans needsLogin", async () => {
    const { restore } = setup();
    try {
        auth.initAuth = async () => {
            throw new Error("réseau indisponible");
        };
        assert.deepEqual(await session.bootstrap(), { ok: false, reason: "réseau indisponible" });
    } finally {
        restore();
    }
});

test("bootstrap : connexion demandée puis échec", async () => {
    const { calls, restore } = setup();
    try {
        auth.initAuth = async () => {
            throw Object.assign(new Error("expirée"), { needsLogin: true });
        };
        login.promptAndLogin = async () => false;

        const result = await session.bootstrap();
        assert.equal(result.ok, false);
        assert.match(result.reason, /Connexion impossible/);
        assert.ok(calls.ui.some((call) => call.name === "warn"));
    } finally {
        restore();
    }
});

test("bootstrap : connexion demandée puis réussie", async () => {
    const { restore } = setup();
    try {
        auth.initAuth = async () => {
            throw Object.assign(new Error("expirée"), { needsLogin: true });
        };
        let options = null;
        login.promptAndLogin = async (opts) => {
            options = opts;
            return true;
        };
        assert.deepEqual(await session.bootstrap(), { ok: true, session: { kind: "new" } });
        assert.deepEqual(options, { useEnv: true });
        assert.equal(state.chatIds.chat, null);
    } finally {
        restore();
    }
});
