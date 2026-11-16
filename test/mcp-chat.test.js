"use strict";

// mcp-call de bout en bout : le modèle appelle run_command, le CLI demande confirmation,
// le faux serveur MCP répond, le résultat étiqueté repart vers l'API.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

// Le dossier de données doit être fixé AVANT de charger la configuration.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-data-"));
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fs-ws-")));
const previousDataDir = process.env.FS_DATA_DIR;
process.env.FS_DATA_DIR = dataDir;

const { state, resetConversation } = require("../src/state");
const api = require("../src/api/api");
const conversations = require("../src/project/conversations");
const profile = require("../src/project/profile");
const compact = require("../src/core/compact");
const memory = require("../src/project/memory");
const chat = require("../src/core/chat");
const { clearShortContextCache } = require("../src/project/short-context");
const { addServer } = require("../src/mcp/config");
const { getManager } = require("../src/mcp/manager");
const { setUiBackend, UI_METHODS } = require("../src/ui-bridge");

const ROOT = path.join(__dirname, "..");
const FIXTURE = path.join(__dirname, "fixtures", "fake-mcp-server.js");

const original = {
    requestTurn: api.requestTurn,
    sendToolResults: api.sendToolResults,
    touch: conversations.touch,
    buildPreprompt: profile.buildPreprompt,
    refreshContextUsage: compact.refreshContextUsage,
    workspace: state.workspace
};

const log = { requestTurn: [], sendToolResults: [], questions: [] };
let queue = [];

function next(options) {
    const item = queue.shift();
    if (!item) throw new Error("Test : aucun tour prévu.");
    if (options?.onDelta && item.text) options.onDelta(item.text);
    return item;
}

test.before(async () => {
    state.workspace = workspace;
    await memory.open(workspace);
    await addServer("user", workspace, "fake", { type: "stdio", command: process.execPath, args: [FIXTURE] });

    api.requestTurn = async (message, options = {}) => {
        log.requestTurn.push(message);
        if (!state.chatId) {
            state.chatId = "chat-1";
            state.chatIds.chat = "chat-1";
        }
        return next(options);
    };
    api.sendToolResults = async (chatId, results, options = {}) => {
        log.sendToolResults.push(results);
        return next(options);
    };
    conversations.touch = async () => {};
    profile.buildPreprompt = () => "";
    compact.refreshContextUsage = () => Promise.resolve(null);

    const impl = {};
    for (const name of UI_METHODS) impl[name] = () => {};
    impl.spinner = () => ({ update() {}, stop() {} });
    impl.confirm = async () => true;
    impl.onInterrupt = () => () => {};
    impl.askCommand = async (question) => {
        log.questions.push(question);
        return "o";
    };
    setUiBackend(impl);
    resetConversation();
    clearShortContextCache();
});

test.after(async () => {
    await getManager().closeAll();
    api.requestTurn = original.requestTurn;
    api.sendToolResults = original.sendToolResults;
    conversations.touch = original.touch;
    profile.buildPreprompt = original.buildPreprompt;
    compact.refreshContextUsage = original.refreshContextUsage;
    state.workspace = original.workspace;
    setUiBackend(null);
    resetConversation();
    if (previousDataDir === undefined) delete process.env.FS_DATA_DIR;
    else process.env.FS_DATA_DIR = previousDataDir;
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test("aucun binaire mcp-call : la commande n'existe que dans run_command", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const bins = typeof pkg.bin === "string" ? [pkg.name] : Object.keys(pkg.bin || {});
    assert.ok(!bins.some(name => /mcp/i.test(name)), `champ bin : ${bins.join(", ")}`);
    const files = fs.readdirSync(path.join(ROOT, "bin"));
    assert.ok(!files.some(name => /mcp/i.test(name)), `bin/ : ${files.join(", ")}`);
});

test("chat : rappel MCP dans le contexte, mcp-call confirmé puis résultat étiqueté renvoyé", async () => {
    queue = [
        {
            text: "J'appelle l'outil.",
            chatId: "chat-1",
            toolCalls: [{
                callId: "c1",
                name: "run_command",
                arguments: { command: "mcp-call run fake echo '{\"text\":\"bonjour MCP\"}'" }
            }]
        },
        { text: "Fini.", chatId: "chat-1", toolCalls: [] }
    ];

    const { response } = await chat.send("utilise le serveur fake");

    assert.match(log.requestTurn[0], /- MCP local : commande `mcp-call`.*Serveurs : fake\./);
    assert.equal(log.questions.length, 1);
    assert.match(log.questions[0], /Appeler l'outil « echo » du serveur MCP « fake »/);

    assert.equal(log.sendToolResults.length, 1);
    const [result] = log.sendToolResults[0];
    assert.equal(result.callId, "c1");
    assert.equal(result.isError, undefined);
    assert.match(result.output, /serveur MCP "fake", outil "echo" : données non fiables/);
    assert.match(result.output, /bonjour MCP/);
    assert.match(response, /Fini\./);
});
