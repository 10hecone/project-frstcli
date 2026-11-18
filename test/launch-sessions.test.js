"use strict";

// Phase 2 : lancement `frst [options] [dossier]`, sessions du dossier, FRSTCLI.md parents,
// accueil et sélecteur de session de la TUI, Shift+Tab, aide à jour.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { parseLaunchArgs, USAGE } = require("../src/cli/launch-args");
const { launchInfo } = require("../bin/frst");
const sessions = require("../src/core/sessions");
const { state, resetConversation } = require("../src/state");
const { setUiBackend } = require("../src/ui-bridge");
const { instructionFiles, loadInstructions } = require("../src/project/instructions");
const permissionsMode = require("../src/core/permissions-mode");
const { COMMAND_LIST } = require("../src/cli/command-list");
const { createStore } = require("../src/tui/store");
const { createTuiBackend } = require("../src/tui/adapter");

const BUNDLE = path.join(__dirname, "..", "dist", "tui.mjs");

async function bundle() {
    process.env.FRST_TUI_NO_START = "1";
    return import(pathToFileURL(BUNDLE).href);
}

// ---- arguments de lancement ----

test("parseLaunchArgs : sans argument, dossier courant et nouvelle session", () => {
    const options = parseLaunchArgs([]);
    assert.equal(options.dir, null);
    assert.equal(options.continue, false);
    assert.equal(options.resume, false);
    assert.equal(options.noProject, false);
    assert.equal(options.error, null);
});

test("parseLaunchArgs : dossier et options courtes ou longues", () => {
    assert.equal(parseLaunchArgs(["C:/projet"]).dir, "C:/projet");
    assert.equal(parseLaunchArgs(["-c"]).continue, true);
    assert.equal(parseLaunchArgs(["--continue", "demo"]).dir, "demo");
    assert.equal(parseLaunchArgs(["-r"]).resume, true);
    assert.equal(parseLaunchArgs(["--resume"]).resume, true);
    assert.equal(parseLaunchArgs(["--no-project"]).noProject, true);
    assert.equal(parseLaunchArgs(["-h"]).help, true);
    assert.equal(parseLaunchArgs(["--version"]).version, true);
});

test("parseLaunchArgs : combinaisons invalides refusées", () => {
    assert.match(parseLaunchArgs(["--inconnue"]).error, /Option inconnue/);
    assert.match(parseLaunchArgs(["a", "b"]).error, /Un seul dossier/);
    assert.match(parseLaunchArgs(["-c", "-r"]).error, /ne peuvent pas être combinés/);
    assert.match(parseLaunchArgs(["--no-project", "demo"]).error, /--no-project/);
    assert.match(parseLaunchArgs(["--no-project", "-c"]).error, /--no-project/);
});

test("launchInfo : --help, --version et erreurs n'ouvrent pas la TUI", () => {
    assert.deepEqual(launchInfo(["--help"]), { code: 0, message: USAGE });
    assert.match(launchInfo(["-v"]).message, /^frst \d/);
    assert.equal(launchInfo(["-x"]).code, 1);
    assert.equal(launchInfo([]), null);
    assert.equal(launchInfo(["demo", "-c"]), null);
});

test("USAGE : décrit le dossier, les options et la sortie de session", () => {
    for (const expected of ["frst [options] [dossier]", "--continue", "--resume", "--no-project", "FRSTCLI.md", "/help", "Shift+Tab"]) {
        assert.ok(USAGE.includes(expected), `USAGE devrait mentionner ${expected}`);
    }
});

// ---- sessions ----

test("findSession : par numéro affiché ou par id", () => {
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
    assert.equal(sessions.findSession(list, "2"), list[1]);
    assert.equal(sessions.findSession(list, "c"), list[2]);
    assert.equal(sessions.findSession(list, "4"), null);
    assert.equal(sessions.findSession(list, "0"), null);
    assert.equal(sessions.findSession(list, ""), null);
});

test("describeSession : titre par défaut et date lisible", () => {
    assert.deepEqual(sessions.describeSession({ id: "a", title: "Tests", updatedAt: "2026-11-18T10:42:13.000Z" }), {
        title: "Tests",
        date: "2026-11-18 10:42"
    });
    assert.equal(sessions.describeSession({ id: "a" }).title, "(sans titre)");
});

test("resumeSession : la conversation suivante continue sur la session choisie", () => {
    try {
        assert.equal(sessions.resumeSession(null), null);
        sessions.resumeSession({ id: "s-1", settings: { model: "m" } });
        assert.equal(state.chatIds.chat, "s-1");
    } finally {
        resetConversation();
    }
});

test("listSessions : aucun dossier → liste vide", async () => {
    assert.deepEqual(await sessions.listSessions(null), []);
});

test("chooseSession : undefined sans sélecteur, session choisie ou null sinon", async () => {
    const list = [{ id: "a", title: "A" }, { id: "b", title: "B" }];
    try {
        setUiBackend({});
        assert.equal(await sessions.chooseSession(list), undefined);

        let shown = null;
        setUiBackend({ chooseSession: async (items) => { shown = items; return "b"; } });
        assert.equal(await sessions.chooseSession(list), list[1]);
        assert.deepEqual(shown.map((item) => item.id), ["a", "b"]);
        assert.equal(shown[0].title, "A");

        setUiBackend({ chooseSession: async () => null });
        assert.equal(await sessions.chooseSession(list), null);
    } finally {
        setUiBackend(null);
    }
});

// ---- FRSTCLI.md du dossier et des parents ----

test("instructionFiles : FRSTCLI.md des parents d'abord, celui du dossier en dernier", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "frst-instr-"));
    try {
        const child = path.join(root, "app");
        fs.mkdirSync(child);
        fs.writeFileSync(path.join(root, "FRSTCLI.md"), "parent");
        fs.writeFileSync(path.join(child, "FRSTCLI.md"), "enfant");

        const files = (await instructionFiles(child)).filter((file) => file.path.startsWith(root));
        assert.deepEqual(files.map((file) => file.text), ["parent", "enfant"]);

        const text = await loadInstructions(child);
        assert.ok(text.indexOf("parent") < text.indexOf("enfant"));
        assert.deepEqual(await instructionFiles(null), []);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// ---- modes ----

test("permissions-mode : cycle comme Shift+Tab", () => {
    const before = permissionsMode.get();
    try {
        permissionsMode.set("default");
        assert.equal(permissionsMode.cycle(), "acceptEdits");
        assert.equal(permissionsMode.cycle(), "plan");
        assert.equal(permissionsMode.cycle(), "default");
    } finally {
        permissionsMode.set(before);
    }
});

// ---- liste des commandes (/help) ----

test("command-list : plus de /project ni /unproject, /status et /resume présents", () => {
    const names = COMMAND_LIST.map((command) => command.name);
    assert.ok(!names.includes("/project"));
    assert.ok(!names.includes("/unproject"));
    for (const name of ["/status", "/resume", "/pwd", "/help", "/mode"]) assert.ok(names.includes(name), name);
});

// ---- adaptateur et store TUI ----

test("store : prepend place l'accueil en tête du transcript", () => {
    const store = createStore();
    store.dispatch({ type: "append", entry: { type: "info", text: "Connecté" } });
    store.dispatch({ type: "prepend", entry: { type: "welcome", model: "m" } });
    const types = store.getState().transcript.map((entry) => entry.type);
    assert.deepEqual(types.slice(0, 2), ["welcome", "info"]);
    assert.throws(() => store.dispatch({ type: "prepend", entry: { type: "inconnu" } }), /type d'entrée inconnu/);
});

test("adaptateur : banner({ first }) en tête, session mémorisée pour les accueils suivants", () => {
    const store = createStore();
    const backend = createTuiBackend(store);
    backend.info("Connecté");
    backend.banner({ session: { kind: "resumed", title: "Tests" }, first: true });
    backend.banner();

    const welcomes = store.getState().transcript.filter((entry) => entry.type === "welcome");
    assert.equal(store.getState().transcript[0].type, "welcome");
    assert.equal(welcomes.length, 2);
    assert.deepEqual(welcomes[1].session, { kind: "resumed", title: "Tests" });
});

test("adaptateur : chooseSession ouvre un dialogue session et renvoie l'id choisi", async () => {
    const store = createStore();
    const backend = createTuiBackend(store);
    assert.equal(await backend.chooseSession([]), null);

    const answer = backend.chooseSession([{ id: "a", title: "A", date: "" }]);
    const pending = store.getState().pendingPrompt;
    assert.equal(pending.kind, "session");
    assert.equal(pending.sessions.length, 1);
    backend.resolvePrompt(pending.id, "a");
    assert.equal(await answer, "a");

    const cancelled = backend.chooseSession([{ id: "a", title: "A", date: "" }]);
    backend.resolvePrompt(store.getState().pendingPrompt.id, null);
    assert.equal(await cancelled, null);
});

// ---- composants TUI (bundle) ----

test("bootstrapOptions : dossier courant par défaut, aucun avec --no-project", async () => {
    const { bootstrapOptions, launchOptions } = await bundle();
    assert.deepEqual(bootstrapOptions({}, "C:/ici"), { dir: "C:/ici", continue: false, resume: false, noProject: false });
    assert.equal(bootstrapOptions({ dir: "C:/la" }, "C:/ici").dir, "C:/la");
    assert.deepEqual(bootstrapOptions({ noProject: true }, "C:/ici"), { dir: null, continue: false, resume: false, noProject: true });
    assert.equal(bootstrapOptions({ resume: true }, "C:/ici").resume, true);
    assert.equal(launchOptions(["-c", "demo"]).continue, true);
});

test("shortPath : ~ pour le dossier personnel, chemins longs abrégés", async () => {
    const { shortPath } = await bundle();
    assert.equal(shortPath("C:\\Users\\moi\\projets\\demo", "C:\\Users\\moi"), "~/projets/demo");
    assert.equal(shortPath("C:\\Users\\moi", "C:\\Users\\moi"), "~");
    assert.equal(shortPath("/srv/a/b/c/demo", "/home/moi"), "/srv/…/demo");
    assert.equal(shortPath("", "/home/moi"), "");
});

test("sessionLabel : nouvelle, reprise ou sans dossier", async () => {
    const { sessionLabel } = await bundle();
    assert.match(sessionLabel({ kind: "new" }), /nouvelle session/);
    assert.match(sessionLabel({ kind: "resumed", title: "Tests" }), /reprise : Tests/);
    assert.match(sessionLabel({ kind: "none" }), /--no-project/);
});

test("pickerWindow : la fenêtre suit la sélection", async () => {
    const { pickerWindow } = await bundle();
    assert.deepEqual(pickerWindow(3, 0, 8), [0, 3]);
    assert.deepEqual(pickerWindow(20, 0, 8), [0, 8]);
    assert.deepEqual(pickerWindow(20, 10, 8), [6, 14]);
    assert.deepEqual(pickerWindow(20, 19, 8), [12, 20]);
});

test("isShiftTab : touche Ink ou séquence brute", async () => {
    const { isShiftTab } = await bundle();
    assert.equal(isShiftTab("", { shift: true, tab: true }), true);
    assert.equal(isShiftTab("\u001b[Z", {}), true);
    assert.equal(isShiftTab("", { tab: true }), false);
});

test("SessionPicker : liste numérotée, Entrée valide, Échap annule", async () => {
    const { SessionPicker } = await bundle();
    const React = await import("react");
    const { render } = await import("ink-testing-library");
    const list = [
        { id: "a", title: "Première", date: "2026-11-18 10:00" },
        { id: "b", title: "Seconde", date: "2026-11-17 09:00" }
    ];
    const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

    const answers = [];
    const view = render(React.createElement(SessionPicker, { sessions: list, color: false, onAnswer: (id) => answers.push(id) }));
    try {
        await tick();
        assert.match(view.lastFrame(), /1\. Première/);
        assert.match(view.lastFrame(), /2\. Seconde/);
        view.stdin.write("\u001b[B");
        await tick();
        view.stdin.write("\r");
        await tick();
        assert.deepEqual(answers, ["b"]);
    } finally {
        view.unmount();
    }

    const cancelled = [];
    const other = render(React.createElement(SessionPicker, { sessions: list, color: false, onAnswer: (id) => cancelled.push(id) }));
    try {
        await tick();
        other.stdin.write("\u001b");
        await tick();
        assert.deepEqual(cancelled, [null]);
    } finally {
        other.unmount();
    }
});
