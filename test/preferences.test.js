"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { CONFIG } = require("../src/config");
const { state } = require("../src/state");
const permissionsMode = require("../src/core/permissions-mode");
const preferences = require("../src/core/preferences");
const { createSettingsPanel } = require("../src/gui/settings-panel");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fs-prefs-"));
const KEYS = ["dataDir", "defaultAgentId", "autoCompactPercent", "maxAgentTurns", "firstByteTimeoutMs", "idleTimeoutMs", "mcpToolTimeoutMs", "optim", "includeLearnedTopics", "resumeInProject"];
const saved = { config: Object.fromEntries(KEYS.map((key) => [key, CONFIG[key]])), model: state.model, mode: permissionsMode.get() };
const AGENTS = [{ id: -1002, name: "Modèle A" }, { id: 7, name: "Modèle B" }];
const ENV = {};
let counter = 0;

/** Dossier de données neuf pour chaque test. */
function freshDataDir(content) {
    CONFIG.dataDir = path.join(root, `data-${++counter}`);
    fs.mkdirSync(CONFIG.dataDir, { recursive: true });
    const file = path.join(CONFIG.dataDir, "settings.json");
    if (content !== undefined) fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
    return file;
}

const fieldOf = (panel, key) => panel.fields.find((field) => field.key === key);

test.after(() => {
    Object.assign(CONFIG, saved.config);
    state.model = saved.model;
    permissionsMode.set(saved.mode);
    fs.rmSync(root, { recursive: true, force: true });
});

test("validate : types, bornes et options", () => {
    const byKey = Object.fromEntries(preferences.FIELDS.map((field) => [field.key, field]));
    assert.equal(preferences.validate(byKey.autoCompactPercent, "50"), 50);
    assert.throws(() => preferences.validate(byKey.autoCompactPercent, 96), /entre 0 et 95/);
    assert.throws(() => preferences.validate(byKey.maxAgentTurns, 1.5), /entier/);
    assert.equal(preferences.validate(byKey.optim, false), false);
    assert.throws(() => preferences.validate(byKey.optim, "oui"), /vrai ou faux/);
    assert.equal(preferences.validate(byKey.shell, "PowerShell"), "powershell");
    assert.throws(() => preferences.validate(byKey.shell, "zsh"), /attendu/);
    assert.equal(preferences.validate(byKey.permissionMode, "acceptedits"), "acceptEdits");
    assert.throws(() => preferences.validate(byKey.model, 99, [-1002, 7]), /inconnu/);
});

test("read : valeurs par défaut sans fichier, verrou par variable d'environnement", async () => {
    freshDataDir();
    const panel = await preferences.read({ agents: AGENTS, env: { FS_SHELL: "bash" } });
    assert.equal(panel.error, null);
    assert.equal(fieldOf(panel, "autoCompactPercent").value, 85);
    assert.equal(fieldOf(panel, "autoCompactPercent").saved, false);
    assert.equal(fieldOf(panel, "shell").locked, "FS_SHELL");
    assert.equal(fieldOf(panel, "optim").locked, null);
    assert.deepEqual(fieldOf(panel, "model").options.map((option) => option.value), [-1002, 7]);
    assert.deepEqual(panel.readonly, { shellPath: "", allow: [], deny: [] });
});

test("read : valeur enregistrée invalide = défaut ; fichier invalide signalé", async () => {
    freshDataDir({ autoCompactPercent: 400, shellPath: "C:/bash.exe", permissions: { allow: ["read_file"], deny: [] } });
    let panel = await preferences.read({ env: ENV });
    assert.equal(fieldOf(panel, "autoCompactPercent").value, 85);
    assert.equal(fieldOf(panel, "autoCompactPercent").saved, false);
    assert.deepEqual(panel.readonly, { shellPath: "C:/bash.exe", allow: ["read_file"], deny: [] });

    freshDataDir("{ pas du json");
    panel = await preferences.read({ env: ENV });
    assert.ok(panel.error);
});

test("save : fusion qui conserve hooks et permissions, application à CONFIG", async () => {
    const file = freshDataDir({ hooks: { PreToolUse: [] }, permissions: { allow: ["x"] }, shellPath: "/bin/bash", optim: false });
    const panel = await preferences.save({ autoCompactPercent: 60, idleTimeoutSeconds: 120, optim: null }, { agents: AGENTS, env: ENV });
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(data, { hooks: { PreToolUse: [] }, permissions: { allow: ["x"] }, shellPath: "/bin/bash", autoCompactPercent: 60, idleTimeoutSeconds: 120 });
    assert.equal(CONFIG.autoCompactPercent, 60);
    assert.equal(CONFIG.idleTimeoutMs, 120000);
    assert.equal(CONFIG.optim, true);
    assert.equal(fieldOf(panel, "autoCompactPercent").saved, true);
    assert.equal(fs.readdirSync(CONFIG.dataDir).length, 1, "pas de fichier temporaire restant");
});

test("save : refuse clés inconnues, champs verrouillés et valeurs invalides sans rien écrire", async () => {
    const file = freshDataDir({ optim: true });
    const before = fs.readFileSync(file, "utf8");
    await assert.rejects(preferences.save({ shellPath: "/tmp/x" }, { env: ENV }), /inconnu/);
    await assert.rejects(preferences.save({ shell: "bash" }, { env: { FS_SHELL: "powershell" } }), /FS_SHELL/);
    await assert.rejects(preferences.save({ optim: false, maxAgentTurns: -1 }, { env: ENV }), /entre 0 et 500/);
    await assert.rejects(preferences.save({ model: 99 }, { agents: AGENTS, env: ENV }), /inconnu/);
    assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("save : un fichier invalide n'est pas écrasé", async () => {
    const file = freshDataDir("[1, 2]");
    await assert.rejects(preferences.save({ optim: false }, { env: ENV }), /objet JSON/);
    assert.equal(fs.readFileSync(file, "utf8"), "[1, 2]");
});

test("applyUserSettings : applique au démarrage, ignore les champs verrouillés", async () => {
    freshDataDir({ model: 7, permissionMode: "plan", maxAgentTurns: 40, firstByteTimeoutSeconds: 30, includeLearnedTopics: true });
    CONFIG.maxAgentTurns = 0;
    const errors = await preferences.applyUserSettings({ env: { FS_MAX_AGENT_TURNS: "5" } });
    assert.deepEqual(errors, []);
    assert.equal(state.model, 7);
    assert.equal(CONFIG.defaultAgentId, 7);
    assert.equal(permissionsMode.get(), "plan");
    assert.equal(CONFIG.maxAgentTurns, 0);
    assert.equal(CONFIG.firstByteTimeoutMs, 30000);
    assert.equal(CONFIG.includeLearnedTopics, true);

    freshDataDir("{");
    const failures = await preferences.applyUserSettings({ env: ENV });
    assert.equal(failures.length, 1);
});

test("panneau GUI : refus pendant une réponse, création du fichier à ouvrir", async () => {
    let running = true;
    const calls = [];
    const fake = {
        read: async (options) => ({ read: options.agents }),
        save: async (patch, options) => {
            calls.push([patch, options.agents]);
            return { saved: true };
        }
    };
    const panel = createSettingsPanel({
        isRunning: () => running,
        preferences: fake,
        agents: { listAgents: async () => ({ agents: AGENTS }) }
    });
    await assert.rejects(panel.save({ optim: false }), /fin de la réponse/);
    assert.equal(calls.length, 0);
    running = false;
    assert.deepEqual(await panel.save({ optim: false }), { saved: true });
    assert.deepEqual(calls, [[{ optim: false }, AGENTS]]);
    assert.deepEqual(await panel.get(), { read: AGENTS });

    const file = freshDataDir();
    assert.equal(await panel.ensureFile(), file);
    assert.equal(fs.readFileSync(file, "utf8"), "{}\n");
    fs.writeFileSync(file, "{\"optim\":false}");
    await panel.ensureFile();
    assert.equal(fs.readFileSync(file, "utf8"), "{\"optim\":false}", "fichier existant conservé");
});
