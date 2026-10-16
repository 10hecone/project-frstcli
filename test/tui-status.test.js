"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { state } = require("../src/state");
const { createStore } = require("../src/tui/store");
const { createTuiBackend } = require("../src/tui/adapter");

const BUNDLE = path.join(__dirname, "..", "dist", "tui.mjs");

async function load() {
    process.env.FRST_TUI_NO_START = "1";
    const bundle = await import(pathToFileURL(BUNDLE).href);
    const React = await import("react");
    const { render } = await import("ink-testing-library");
    return { bundle, h: React.createElement, render };
}

const tick = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));
const strip = (text) => String(text ?? "").replace(/\u001b\[[0-9;]*m/g, "");

async function renderBar(props) {
    const { bundle, h, render } = await load();
    const view = render(h(bundle.StatusBar, { color: false, ...props }));
    await tick();
    const frame = strip(view.lastFrame());
    view.unmount();
    return frame;
}

// ---- Fonctions utilitaires ----

test("StatusBar : utilitaires projectName, formatCount, sessionTokens", async () => {
    const { bundle } = await load();
    assert.equal(bundle.projectName("C:\\Users\\x\\mon-projet"), "mon-projet");
    assert.equal(bundle.projectName("/home/x/app/"), "app");
    assert.equal(bundle.projectName(null), null);
    assert.equal(bundle.formatCount(950), "950");
    assert.equal(bundle.formatCount(1234), "1,2 k");
    assert.equal(bundle.formatCount(3_400_000), "3,4 M");
    assert.equal(bundle.sessionTokens(null), null);
    assert.equal(bundle.sessionTokens({ requests: 0 }), null);
    assert.deepEqual(
        bundle.sessionTokens({ requests: 2, reported: 2, inputTokens: 1000, outputTokens: 500, chars: 10 }),
        { count: 1500, estimated: false }
    );
    assert.deepEqual(bundle.sessionTokens({ requests: 1, reported: 0, chars: 350 }), { count: 100, estimated: true });
});

test("Spinner : formatElapsed", async () => {
    const { bundle } = await load();
    assert.equal(bundle.formatElapsed(0), "0 s");
    assert.equal(bundle.formatElapsed(7400), "7 s");
    assert.equal(bundle.formatElapsed(125000), "2 min 05 s");
    assert.equal(bundle.formatElapsed(-50), "0 s");
});

// ---- Rendu de la barre d'état ----

test("StatusBar : état minimal (mode, modèle, projet)", async () => {
    const frame = await renderBar({ mode: "auto", model: "gpt-x", workspace: "/tmp/demo" });
    assert.match(frame, /auto · gpt-x · demo/);
    assert.doesNotMatch(frame, /auto-approbation/);
    assert.doesNotMatch(frame, /job/);
    assert.doesNotMatch(frame, /tokens/);
    assert.doesNotMatch(frame, /⎇/);
});

test("StatusBar : branche, auto-approbation, jobs et tokens réels", async () => {
    const frame = await renderBar({
        mode: "agent",
        model: "m",
        workspace: "/tmp/demo",
        branch: "dev",
        autoApprove: true,
        jobs: 2,
        usage: { requests: 3, reported: 3, inputTokens: 1000, outputTokens: 234, chars: 0 }
    });
    assert.match(frame, /agent · m · demo · ⎇ dev · auto-approbation · 2 jobs · 1,2 k tokens/);
});

test("StatusBar : tokens estimés et un seul job", async () => {
    const frame = await renderBar({ mode: "chat", jobs: 1, usage: { requests: 1, reported: 0, chars: 700 } });
    assert.match(frame, /chat · 1 job · ≈ 200 tokens/);
    assert.doesNotMatch(frame, /1 jobs/);
});

test("StatusBar : rien à afficher → rendu vide", async () => {
    const frame = await renderBar({});
    assert.equal(frame.trim(), "");
});

// ---- Spinner ----

test("Spinner : libellé, durée écoulée et rappel Ctrl+C", async () => {
    const { bundle, h, render } = await load();
    const view = render(h(bundle.Spinner, {
        spinner: { id: 1, label: "Réflexion (tour 2)", startedAt: 1000 },
        now: () => 13000,
        color: false
    }));
    await tick();
    const frame = strip(view.lastFrame());
    view.unmount();
    assert.match(frame, /Réflexion \(tour 2\) · 12 s · Ctrl\+C pour interrompre/);
    assert.ok(bundle.SPINNER_FRAMES.some((f) => frame.includes(f)));
});

test("Spinner : la frame avance avec le timer", async () => {
    const { bundle, h, render } = await load();
    const view = render(h(bundle.Spinner, {
        spinner: { id: 1, label: "Connexion", startedAt: 0 },
        now: () => 0,
        interval: 10,
        color: false
    }));
    await tick();
    const first = strip(view.lastFrame());
    await tick(60);
    const later = strip(view.lastFrame());
    view.unmount();
    assert.match(first, /Connexion/);
    assert.notEqual(first, later);
});

test("Spinner : rien sans spinner actif", async () => {
    const { bundle, h, render } = await load();
    const view = render(h(bundle.Spinner, { spinner: null }));
    await tick();
    assert.equal(strip(view.lastFrame()).trim(), "");
    view.unmount();
});

// ---- App + adaptateur ----

test("App : le spinner suit update() puis disparaît après stop()", async () => {
    const { bundle, h, render } = await load();
    let clock = 5000;
    const now = () => clock;
    const store = createStore();
    const backend = createTuiBackend(store, { now, jobs: { runningCount: () => 0 }, usage: { requests: 0 } });
    const view = render(h(bundle.App, { store, version: "0.0.0", cwd: "/tmp", now, color: false }));
    await tick();

    const spin = backend.spinner("Analyse du projet 1/3");
    clock = 8000;
    await tick();
    let frame = strip(view.lastFrame());
    assert.match(frame, /Analyse du projet 1\/3 · 3 s · Ctrl\+C pour interrompre/);

    spin.update("Analyse du projet 2/3");
    await tick();
    frame = strip(view.lastFrame());
    assert.match(frame, /Analyse du projet 2\/3/);
    assert.doesNotMatch(frame, /1\/3/);

    spin.stop();
    await tick();
    frame = strip(view.lastFrame());
    assert.doesNotMatch(frame, /Analyse du projet/);
    assert.doesNotMatch(frame, /Ctrl\+C pour interrompre/);
    assert.equal(store.getState().spinner, null);
    view.unmount();
});

test("Adaptateur : refreshStatus alimente la barre d'état de l'App", async () => {
    const saved = { mode: state.mode, model: state.model, workspace: state.workspace, autoApprove: state.autoApprove };
    try {
        state.mode = "agent";
        state.model = "modele-test";
        state.workspace = path.join(os.tmpdir(), "projet-barre");
        state.autoApprove = true;
        const usage = { requests: 1, reported: 1, inputTokens: 40, outputTokens: 2, chars: 0 };
        const store = createStore();
        const backend = createTuiBackend(store, { jobs: { runningCount: () => 3 }, usage });
        backend.refreshStatus({ branch: "dev" });

        const status = store.getState().status;
        assert.equal(status.mode, "agent");
        assert.equal(status.jobs, 3);
        assert.equal(status.branch, "dev");
        assert.notEqual(status.usage, usage, "usage doit être copié");

        const { bundle, h, render } = await load();
        const view = render(h(bundle.App, { store, version: "0.0.0", cwd: "/tmp", color: false }));
        await tick();
        const frame = strip(view.lastFrame());
        view.unmount();
        assert.match(frame, /agent · modele-test · projet-barre · ⎇ dev · auto-approbation · 3 jobs · 42 tokens/);
    } finally {
        Object.assign(state, saved);
    }
});

test("Adaptateur : refreshStatus tolère une source de jobs défaillante", () => {
    const store = createStore();
    const backend = createTuiBackend(store, {
        jobs: { runningCount: () => { throw new Error("boom"); } },
        usage: { requests: 0 }
    });
    backend.refreshStatus();
    assert.equal(store.getState().status.jobs, 0);
});

// ---- Branche git ----

test("gitBranch : branche, HEAD détaché, dossier parent et hors dépôt", async () => {
    const { bundle } = await load();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "frst-git-"));
    try {
        const repo = path.join(root, "repo");
        fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
        fs.mkdirSync(path.join(repo, "src", "deep"), { recursive: true });
        fs.writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/feature/x\n");
        assert.equal(bundle.gitBranch(repo), "feature/x");
        assert.equal(bundle.gitBranch(path.join(repo, "src", "deep")), "feature/x");

        fs.writeFileSync(path.join(repo, ".git", "HEAD"), "0123456789abcdef0123456789abcdef01234567\n");
        assert.equal(bundle.gitBranch(repo), "0123456");

        const worktree = path.join(root, "wt");
        const wtGitDir = path.join(root, "wt-gitdir");
        fs.mkdirSync(worktree);
        fs.mkdirSync(wtGitDir);
        fs.writeFileSync(path.join(wtGitDir, "HEAD"), "ref: refs/heads/dev\n");
        fs.writeFileSync(path.join(worktree, ".git"), `gitdir: ${wtGitDir}\n`);
        assert.equal(bundle.gitBranch(worktree), "dev");

        const outside = path.join(root, "outside");
        fs.mkdirSync(outside);
        const found = bundle.gitBranch(outside);
        // Hors dépôt dans tmp : null, sauf si tmp est lui-même dans un dépôt git.
        assert.ok(found === null || typeof found === "string");
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
