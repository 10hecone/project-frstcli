"use strict";

// Boucle des outils client de core/chat.js : exécution locale des appels,
// un seul envoi de résultats par ronde, limites de l'API et cas d'erreur.

const test = require("node:test");
const assert = require("node:assert/strict");

const { state, resetConversation } = require("../src/state");
const { CONFIG } = require("../src/config");
const api = require("../src/api/api");
const registry = require("../src/tools/registry");
const shortContext = require("../src/project/short-context");
const conversations = require("../src/project/conversations");
const profile = require("../src/project/profile");
const chat = require("../src/core/chat");
const compact = require("../src/core/compact");
const { setUiBackend, UI_METHODS } = require("../src/ui-bridge");

// Version réelle, gardée avant toute substitution (utilisée par le test readOnly).
const realRunClientTool = registry.runClientTool;

const call = (callId, name, args = {}, extra = {}) => ({ callId, name, arguments: args, ...extra });
const turn = (text, toolCalls = [], chatId = "chat-1") => ({ text, toolCalls, chatId });
const tick = () => new Promise((resolve) => setImmediate(resolve));
const ticks = async (n) => {
    for (let i = 0; i < n; i++) await tick();
};

/**
 * Remplace l'API, les outils et l'interface.
 * turns : réponses successives de requestTurn puis de sendToolResults. Une fonction
 *         est appelée à la place (elle peut lever une erreur, comme un Ctrl+C).
 * runTool(name, args, allowed) : exécution simulée d'un outil.
 * confirm : réponse à ui.confirm.
 */
function setup({ workspace = "C:/projet", turns = [], runTool, confirm = async () => true } = {}) {
    const original = {
        requestTurn: api.requestTurn,
        sendToolResults: api.sendToolResults,
        runClientTool: registry.runClientTool,
        buildShortContext: shortContext.buildShortContext,
        buildPreprompt: profile.buildPreprompt,
        touch: conversations.touch,
        refreshContextUsage: compact.refreshContextUsage,
        workspace: state.workspace,
        mode: state.mode,
        maxAgentTurns: CONFIG.maxAgentTurns,
    };

    const log = { requestTurn: [], sendToolResults: [], runClientTool: [], confirm: [], touch: [], ui: [] };
    const queue = turns.slice();

    function next(options) {
        if (!queue.length) throw new Error("Test : aucun tour prévu.");
        const item = queue.shift();
        const result = typeof item === "function" ? item() : item;
        if (options.onDelta && result.text) options.onDelta(result.text);
        return result;
    }

    api.requestTurn = async (message, options = {}) => {
        log.requestTurn.push({ message, options });
        // Imite l'API : la première réponse crée la conversation.
        if (!state.chatId) {
            state.chatId = "chat-1";
            state.chatIds.chat = "chat-1";
        }
        return next(options);
    };
    api.sendToolResults = async (chatId, results, options = {}) => {
        log.sendToolResults.push({ chatId, results });
        return next(options);
    };
    registry.runClientTool = async (name, args, allowed) => {
        log.runClientTool.push({ name, args, allowed });
        return runTool ? runTool(name, args, allowed) : { ok: true };
    };
    shortContext.buildShortContext = async () => "CONTEXTE";
    profile.buildPreprompt = () => "";
    conversations.touch = async (entry) => {
        log.touch.push(entry);
    };
    // Pas d'appel réseau pour le pourcentage de contexte.
    compact.refreshContextUsage = () => Promise.resolve(null);

    const impl = {};
    for (const name of UI_METHODS) {
        impl[name] = (...args) => {
            log.ui.push([name, ...args]);
        };
    }
    impl.spinner = () => ({ update() {}, stop() {} });
    impl.confirm = async (...args) => {
        log.confirm.push(args);
        return confirm(...args);
    };
    setUiBackend(impl);

    resetConversation();
    state.workspace = workspace;
    // Mode auto : outils proposés dès qu'un projet est ouvert.
    state.mode = "auto";

    function restore() {
        api.requestTurn = original.requestTurn;
        api.sendToolResults = original.sendToolResults;
        registry.runClientTool = original.runClientTool;
        shortContext.buildShortContext = original.buildShortContext;
        profile.buildPreprompt = original.buildPreprompt;
        conversations.touch = original.touch;
        compact.refreshContextUsage = original.refreshContextUsage;
        state.workspace = original.workspace;
        state.mode = original.mode;
        CONFIG.maxAgentTurns = original.maxAgentTurns;
        setUiBackend(null);
        resetConversation();
    }

    return { log, restore };
}

test("une ronde : un résultat par callId, dans l'ordre, en un seul envoi", async () => {
    const env = setup({
        turns: [
            turn("Je regarde.", [
                call("c1", "read_file", { path: "a.js" }),
                call("c2", "list_directory", { path: "." }),
            ]),
            turn("Fini."),
        ],
        // Formes inconnues du formateur : renvoyées en JSON.
        runTool: (name, args) => ({ tool: name, path: args.path }),
    });
    try {
        const deltas = [];
        const rounds = [];
        const { response, newChatId } = await chat.send("analyse", {
            onDelta: (text) => deltas.push(text),
            onToolCalls: (calls) => rounds.push(calls.map((c) => c.callId)),
        });

        assert.deepEqual(rounds, [["c1", "c2"]]);
        assert.equal(env.log.sendToolResults.length, 1);

        const sent = env.log.sendToolResults[0];
        assert.equal(sent.chatId, "chat-1");
        assert.deepEqual(sent.results.map((r) => r.callId), ["c1", "c2"]);
        assert.deepEqual(JSON.parse(sent.results[0].output), { tool: "read_file", path: "a.js" });
        assert.deepEqual(JSON.parse(sent.results[1].output), { tool: "list_directory", path: "." });
        assert.ok(sent.results.every((r) => r.isError === undefined));

        assert.equal(response, "Je regarde.\n\nFini.");
        assert.equal(newChatId, "chat-1");
        assert.deepEqual(deltas, ["Je regarde.", "Fini."]);
        assert.deepEqual(state.history.map((e) => e.content), ["analyse", "Je regarde.\n\nFini."]);
        assert.equal(env.log.requestTurn[0].message, "CONTEXTE\n\nQUESTION : analyse");
    } finally {
        env.restore();
    }
});

test("résultats en texte : read_file numéroté, list_directory une entrée par ligne", async () => {
    const env = setup({
        turns: [
            turn("", [
                call("r", "read_file", { path: "a.js" }),
                call("l", "list_directory", { path: "." }),
            ]),
            turn("ok"),
        ],
        runTool: (name) =>
            name === "read_file"
                ? { path: "a.js", total_lines: 2, range: null, truncated: false, next_line: null, content: "un\ndeux\n", message: "Fichier lu." }
                : { path: ".", entries: [{ path: "src", type: "directory" }, { path: "a.js", type: "file" }], truncated: false, message: "2 élément(s)." },
    });
    try {
        await chat.send("go");
        const [read, list] = env.log.sendToolResults[0].results;
        assert.match(read.output, /^Fichier : a\.js \(2 ligne\(s\) au total, lignes 1 à 2 affichées\)/);
        assert.match(read.output, /\n1\tun\n2\tdeux$/);
        assert.equal(list.output, "Dossier : .\nsrc/\na.js");
    } finally {
        env.restore();
    }
});

test("lectures consécutives : en parallèle, résultats dans l'ordre des appels", async () => {
    let running = 0;
    let maxRunning = 0;
    const env = setup({
        turns: [
            turn("", [
                call("r1", "read_file", { path: "a", wait: 3 }),
                call("r2", "read_file", { path: "b", wait: 2 }),
                call("r3", "search_files", { query: "x", wait: 1 }),
            ]),
            turn("ok"),
        ],
        runTool: async (name, args) => {
            running += 1;
            maxRunning = Math.max(maxRunning, running);
            await ticks(args.wait);
            running -= 1;
            return { done: args.path ?? args.query };
        },
    });
    try {
        await chat.send("go");
        assert.equal(maxRunning, 3);
        const results = env.log.sendToolResults[0].results;
        assert.deepEqual(results.map((r) => r.callId), ["r1", "r2", "r3"]);
        assert.deepEqual(results.map((r) => JSON.parse(r.output).done), ["a", "b", "x"]);
    } finally {
        env.restore();
    }
});

test("écritures : une par une, et elles séparent les groupes de lectures", async () => {
    const journal = [];
    const env = setup({
        turns: [
            turn("", [
                call("a", "read_file", { path: "a" }),
                call("b", "read_file", { path: "b" }),
                call("c", "write_file", { path: "c", content: "x" }),
                call("d", "edit_file", { path: "d", old_string: "x", new_string: "y" }),
                call("e", "read_file", { path: "e" }),
            ]),
            turn("ok"),
        ],
        runTool: async (name, args) => {
            journal.push(`début ${args.path}`);
            await tick();
            journal.push(`fin ${args.path}`);
            return { ok: true };
        },
    });
    try {
        await chat.send("go");
        assert.deepEqual(journal, [
            "début a", "début b", "fin a", "fin b",
            "début c", "fin c",
            "début d", "fin d",
            "début e", "fin e",
        ]);
        assert.deepEqual(env.log.sendToolResults[0].results.map((r) => r.callId), ["a", "b", "c", "d", "e"]);
    } finally {
        env.restore();
    }
});

test("refus, exception et arguments invalides : résultats isError", async () => {
    const env = setup({
        turns: [
            turn("", [
                call("ok", "read_file", { path: "a" }),
                call("refus", "write_file", { path: "b", content: "x" }),
                call("boum", "run_command", { command: "npm test" }),
                call("args", "read_file", {}, { argsError: "Arguments JSON invalides." }),
            ]),
            turn("compris"),
        ],
        runTool: async (name) => {
            if (name === "write_file") return { denied: true, message: "Écriture refusée par l'utilisateur." };
            if (name === "run_command") throw new Error("commande introuvable");
            return { content: "texte" };
        },
    });
    try {
        const { response } = await chat.send("go");
        const results = env.log.sendToolResults[0].results;

        assert.deepEqual(results.map((r) => r.callId), ["ok", "refus", "boum", "args"]);
        assert.equal(results[0].isError, undefined);
        assert.deepEqual(results.slice(1).map((r) => r.isError), [true, true, true]);
        assert.equal(results[1].output, "Écriture refusée par l'utilisateur.");
        assert.equal(results[2].output, "Erreur : commande introuvable");
        assert.equal(results[3].output, "Erreur : Arguments JSON invalides.");

        // L'appel aux arguments invalides n'est jamais exécuté.
        assert.deepEqual(env.log.runClientTool.map((c) => c.name), ["read_file", "write_file", "run_command"]);
        assert.equal(response, "compris");
    } finally {
        env.restore();
    }
});

test("readOnly : seuls les outils de lecture sont proposés et autorisés", async () => {
    const env = setup({
        turns: [turn("", [call("w", "write_file", { path: "x", content: "y" })]), turn("plan")],
        // Vraie vérification du registre : write_file est refusé avant toute exécution.
        runTool: (name, args, allowed) => realRunClientTool(name, args, allowed),
    });
    try {
        const { response } = await chat.send("plan", { readOnly: true });
        assert.deepEqual(env.log.requestTurn[0].options.clientTools, registry.READ_TOOLS);
        assert.deepEqual(env.log.runClientTool[0].allowed, registry.READ_TOOLS);

        const [result] = env.log.sendToolResults[0].results;
        assert.equal(result.isError, true);
        assert.match(result.output, /Outil non disponible : write_file/);
        assert.equal(response, "plan");
    } finally {
        env.restore();
    }
});

test("sans projet : aucun outil proposé, message brut", async () => {
    const env = setup({ workspace: null, turns: [turn("salut")] });
    try {
        const { response } = await chat.send("bonjour");
        assert.deepEqual(env.log.requestTurn[0].options.clientTools, []);
        assert.equal(env.log.requestTurn[0].message, "bonjour");
        assert.equal(env.log.sendToolResults.length, 0);
        assert.equal(response, "salut");
    } finally {
        env.restore();
    }
});

test("résumé de /compact : joint au premier message puis oublié", async () => {
    const env = setup({ turns: [turn("vu"), turn("encore")] });
    try {
        state.compactSummary = "Objectif : finir la refonte.";
        await chat.send("on reprend");
        assert.match(
            env.log.requestTurn[0].message,
            /^RÉSUMÉ DE LA SESSION PRÉCÉDENTE[^\n]*\nObjectif : finir la refonte\.\n\nCONTEXTE\n\nQUESTION : on reprend$/,
        );
        assert.equal(state.compactSummary, null);

        await chat.send("suite");
        assert.equal(env.log.requestTurn[1].message, "suite");
    } finally {
        env.restore();
    }
});

test("plus de 32 appels : seuls les 32 premiers sont exécutés et envoyés", async () => {
    const calls = Array.from({ length: 40 }, (_, i) => call(`c${i}`, "read_file", { path: `f${i}` }));
    const env = setup({ turns: [turn("", calls), turn("ok")] });
    try {
        await chat.send("go");
        const results = env.log.sendToolResults[0].results;
        assert.equal(results.length, chat.MAX_RESULTS_PER_SEND);
        assert.equal(results.length, 32);
        assert.deepEqual(results.map((r) => r.callId), calls.slice(0, 32).map((c) => c.callId));
        assert.equal(env.log.runClientTool.length, 32);
        assert.ok(env.log.ui.some(([method, text]) => method === "warn" && /32 premiers/.test(text)));
    } finally {
        env.restore();
    }
});

test("limite de rondes : confirmation forcée, arrêt si l'utilisateur refuse", async () => {
    const env = setup({
        turns: [
            turn("1", [call("a", "read_file", { path: "a" })]),
            turn("2", [call("b", "read_file", { path: "b" })]),
        ],
        confirm: async () => false,
    });
    CONFIG.maxAgentTurns = 1;
    try {
        const { response } = await chat.send("go");
        assert.equal(env.log.confirm.length, 1);
        assert.match(env.log.confirm[0][0], /^1 rondes d'outils effectuées\. Continuer 1 rondes de plus \?$/);
        assert.deepEqual(env.log.confirm[0][1], { force: true });
        assert.equal(env.log.sendToolResults.length, 1);
        assert.equal(env.log.runClientTool.length, 1);
        assert.ok(env.log.ui.some(([method]) => method === "warn"));
        assert.equal(response, "1\n\n2");
    } finally {
        env.restore();
    }
});

test("limite de rondes : nouvelle confirmation toutes les N rondes", async () => {
    const env = setup({
        turns: [
            turn("", [call("a", "read_file", { path: "a" })]),
            turn("", [call("b", "read_file", { path: "b" })]),
            turn("", [call("c", "read_file", { path: "c" })]),
            turn("", [call("d", "read_file", { path: "d" })]),
            turn("", [call("e", "read_file", { path: "e" })]),
            turn("fini"),
        ],
        confirm: async () => true,
    });
    CONFIG.maxAgentTurns = 2;
    try {
        const { response } = await chat.send("go");
        // Rondes 3 et 5 : une confirmation chacune.
        assert.equal(env.log.confirm.length, 2);
        assert.match(env.log.confirm[0][0], /^2 rondes/);
        assert.match(env.log.confirm[1][0], /^4 rondes/);
        assert.equal(env.log.sendToolResults.length, 5);
        assert.equal(response, "fini");
    } finally {
        env.restore();
    }
});

test("limite de rondes : la boucle continue si l'utilisateur accepte", async () => {
    const env = setup({
        turns: [
            turn("", [call("a", "read_file", { path: "a" })]),
            turn("", [call("b", "read_file", { path: "b" })]),
            turn("fini"),
        ],
        confirm: async () => true,
    });
    CONFIG.maxAgentTurns = 1;
    try {
        const { response } = await chat.send("go");
        assert.equal(env.log.confirm.length, 1);
        assert.equal(env.log.sendToolResults.length, 2);
        assert.equal(response, "fini");
    } finally {
        env.restore();
    }
});

test("fitOutputs : 40 000 caractères par résultat, 120 000 par envoi, début et fin gardés", () => {
    const big = (callId) => ({ callId, output: `DEBUT${"x".repeat(49_990)}FIN` });
    const fitted = chat.fitOutputs([big("a"), big("b"), big("c"), big("d")]);

    assert.deepEqual(fitted.map((r) => r.callId), ["a", "b", "c", "d"]);
    for (const r of fitted) {
        assert.ok(r.output.length <= 30_000);
        assert.match(r.output, /\[tronqué : 49998 caractères au total, début et fin conservés\]/);
        assert.ok(r.output.startsWith("DEBUT"));
        assert.ok(r.output.endsWith("FIN"));
    }
    assert.ok(fitted.reduce((sum, r) => sum + r.output.length, 0) <= 120_000);

    const [small, large] = chat.fitOutputs([
        { callId: "s", output: "0123456789" },
        { callId: "l", output: "y".repeat(100_000), isError: true },
    ]);
    assert.equal(small.output, "0123456789");
    assert.ok(large.output.length <= 40_000);
    assert.equal(large.isError, true);
});

test("Ctrl+C pendant l'envoi des résultats : l'erreur remonte, la conversation est enregistrée", async () => {
    const cancel = Object.assign(new Error("Interrompu"), { cancelled: true });
    const env = setup({
        turns: [
            turn("", [call("a", "read_file", { path: "a" })]),
            () => {
                throw cancel;
            },
        ],
    });
    try {
        await assert.rejects(chat.send("go"), (error) => error === cancel);
        assert.equal(env.log.touch.length, 1);
        assert.equal(env.log.touch[0].id, "chat-1");
        assert.equal(state.history.length, 0);
    } finally {
        env.restore();
    }
});
