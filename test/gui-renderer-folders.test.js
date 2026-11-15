"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

/** Empaquette un module ESM du renderer en CommonJS, en mémoire (comme gui-renderer-lib). */
function loadRendererModule(relative) {
    const esbuild = require("esbuild");
    const file = path.join(__dirname, "..", "src", "gui", "renderer", relative);
    const out = esbuild.buildSync({
        entryPoints: [file],
        bundle: true,
        format: "cjs",
        platform: "node",
        write: false,
        logLevel: "silent"
    });
    const mod = new Module(file);
    mod.filename = file;
    mod.paths = Module._nodeModulePaths(path.dirname(file));
    mod._compile(out.outputFiles[0].text, file);
    return mod.exports;
}

const folders = loadRendererModule("lib/folders.js");

test("activeFolder : null sans dossier, nom déduit du chemin sinon", () => {
    assert.equal(folders.activeFolder(null), null);
    assert.deepEqual(folders.activeFolder("C:\\projets\\site", "main"), {
        name: "site",
        path: "C:\\projets\\site",
        branch: "main"
    });
});

test("activeFolder : reprend le nom et la branche des dossiers récents", () => {
    const recent = [{ name: "Site vitrine", path: "/home/a/site", branch: "dev" }];
    assert.deepEqual(folders.activeFolder("/home/a/site", null, recent), {
        name: "Site vitrine",
        path: "/home/a/site",
        branch: "dev"
    });
    assert.equal(folders.activeFolder("/home/a/site", "main", recent).branch, "main");
});

test("trustRequest : seulement quand l'ouverture demande la confiance", () => {
    assert.equal(folders.trustRequest({ ok: true, path: "/a" }), null);
    assert.equal(folders.trustRequest({ cancelled: true }), null);
    assert.deepEqual(folders.trustRequest({ ok: false, needsTrust: true, path: "/a", message: "Faire confiance ?" }), {
        path: "/a",
        message: "Faire confiance ?"
    });
});

test("nextPermissionMode : cycle default → acceptEdits → plan → default", () => {
    assert.equal(folders.nextPermissionMode("default"), "acceptEdits");
    assert.equal(folders.nextPermissionMode("acceptEdits"), "plan");
    assert.equal(folders.nextPermissionMode("plan"), "default");
    assert.equal(folders.nextPermissionMode("inconnu"), "default");
});

test("modeLabel : libellés français, inconnu renvoyé tel quel", () => {
    assert.equal(folders.modeLabel("plan"), "plan");
    assert.equal(folders.modeLabel("acceptEdits"), "modifs auto");
    assert.equal(folders.modeLabel("autre"), "autre");
});
