"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { state, resetConversation } = require("../src/state");
const { setUiBackend, UI_METHODS } = require("../src/ui-bridge");
const auth = require("../src/api/auth");
const login = require("../src/api/login");
const agent = require("../src/agent/agent");
const commands = require("../src/cli/commands");
const conversations = require("../src/project/conversations");
const router = require("../src/cli/router");
const chat = require("../src/core/chat");
const session = require("../src/core/session");

function setup({
    workspace = null,
    mode = "auto",
    keepGoing = true,
    workspaceQuestion = false,
    localFiles = false,
    useAgent = false,
} = {}) {
    const original = {
        handleCommand: commands.handleCommand,
        runAgent: agent.runAgent,
        send: chat.send,
        isWorkspaceQuestion: router.isWorkspaceQuestion,
        seemsToRequestLocalFiles: router.seemsToRequestLocalFiles,
        shouldUseAgent: router.shouldUseAgent,
        initAuth: auth.initAuth,
        promptAndLogin: login.promptAndLogin,
        findForWorkspace: conversations.findForWorkspace,
        workspace: state.workspace,
        mode: state.mode,
    };

    const calls = { command: [], agent: [], chat: [], ui: [], login: 0 };

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
    agent.runAgent = async (input) => {
        calls.agent.push(input);
    };
    chat.send = async (input, options = {}) => {
        calls.chat.push({ input, options });
        if (options.onDelta) options.onDelta("delta");
        return { response: "ok", newChatId: null };
    };
    router.isWorkspaceQuestion = () => workspaceQuestion;
    router.seemsToRequestLocalFiles = () => localFiles;
    router.shouldUseAgent = () => useAgent;

    resetConversation();
    state.workspace = workspace;
    state.mode = mode;

    function restore() {
        Object.assign(commands, { handleCommand: original.handleCommand });
        agent.runAgent = original.runAgent;
        chat.send = original.send;
        router.isWorkspaceQuestion = original.isWorkspaceQuestion;
        router.seemsToRequestLocalFiles = original.seemsToRequestLocalFiles;
        router.shouldUseAgent = original.shouldUseAgent;
        auth.initAuth = original.initAuth;
        login.promptAndLogin = original.promptAndLogin;
        conversations.findForWorkspace = original.findForWorkspace;
        state.workspace = original.workspace;
        state.mode = original.mode;
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
        assert.equal(calls.command.length + calls.agent.length + calls.chat.length, 0);
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
        assert.equal(shown.args[0], "Projet actuel : C:/projet");
        assert.equal(calls.agent.length + calls.chat.length, 0);
    } finally {
        restore();
    }
});

test("handleInput : question projet sans projet sélectionné", async () => {
    const { calls, restore } = setup({ workspaceQuestion: true });
    try {
        await session.handleInput("quel projet ?");
        const shown = calls.ui.find((call) => call.name === "assistant");
        assert.equal(shown.args[0], "Projet actuel : aucun projet sélectionné.");
    } finally {
        restore();
    }
});

test("handleInput : fichiers locaux demandés sans projet → message d'aide", async () => {
    const { calls, restore } = setup({ localFiles: true, useAgent: true });
    try {
        await session.handleInput("lis le fichier index.js");
        const info = calls.ui.find((call) => call.name === "info");
        assert.ok(info);
        assert.match(info.args[0], /\/project <dossier>/);
        assert.equal(calls.agent.length + calls.chat.length, 0);
    } finally {
        restore();
    }
});

test("handleInput : en mode chat, pas de message d'aide pour les fichiers locaux", async () => {
    const { calls, restore } = setup({ mode: "chat", localFiles: true });
    try {
        await session.handleInput("lis le fichier index.js");
        assert.equal(calls.chat.length, 1);
    } finally {
        restore();
    }
});

test("handleInput : routage vers l'agent", async () => {
    const { calls, restore } = setup({ workspace: "C:/projet", mode: "agent", useAgent: true });
    try {
        assert.deepEqual(await session.handleInput("corrige le bug"), { exit: false });
        assert.deepEqual(calls.agent, ["corrige le bug"]);
        assert.equal(calls.chat.length, 0);
    } finally {
        restore();
    }
});

test("handleInput : routage vers le chat avec onChatDelta", async () => {
    const { calls, restore } = setup({ useAgent: false });
    try {
        const deltas = [];
        await session.handleInput("bonjour", { onChatDelta: (text) => deltas.push(text) });
        assert.equal(calls.chat.length, 1);
        assert.equal(calls.chat[0].input, "bonjour");
        assert.deepEqual(deltas, ["delta"]);
        assert.equal(calls.agent.length, 0);
    } finally {
        restore();
    }
});

test("handleInput : sendChat remplace l'envoi par défaut", async () => {
    const { calls, restore } = setup({ useAgent: false });
    try {
        const sent = [];
        await session.handleInput("bonjour", { sendChat: async (input) => sent.push(input) });
        assert.deepEqual(sent, ["bonjour"]);
        assert.equal(calls.chat.length, 0);
    } finally {
        restore();
    }
});

test("handleInput : les erreurs remontent à l'appelant", async () => {
    const { restore } = setup({ useAgent: true, workspace: "C:/projet" });
    try {
        agent.runAgent = async () => {
            throw new Error("boom");
        };
        await assert.rejects(session.handleInput("fais quelque chose"), /boom/);
    } finally {
        restore();
    }
});

// ---- bootstrap ----

test("bootstrap : session valide et conversations restaurées", async () => {
    const { calls, restore } = setup();
    try {
        auth.initAuth = async () => {};
        conversations.findForWorkspace = async (workspace, mode) =>
            mode === "chat" ? { id: "c-1", settings: { model: "m" } } : { id: "a-1", settings: null };

        assert.deepEqual(await session.bootstrap(), { ok: true });
        assert.equal(state.chatIds.chat, "c-1");
        assert.equal(state.chatIds.agent, "a-1");
        assert.ok(calls.ui.some((call) => call.name === "info"));
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
        conversations.findForWorkspace = async () => null;

        assert.deepEqual(await session.bootstrap(), { ok: true });
        assert.deepEqual(options, { useEnv: true });
        assert.equal(state.chatIds.chat, null);
    } finally {
        restore();
    }
});
