"use strict";

// Depuis la phase 4, il n'y a plus de routage chat/agent : le modèle choisit ses outils.
// Le routeur sert seulement à conseiller /project quand aucun projet n'est ouvert.

const test = require("node:test");
const assert = require("node:assert/strict");

const router = require("../src/cli/router");
const { normalizeTodos } = require("../src/tools/todo-write");

test("routeur : l'ancien routage agent n'existe plus", () => {
    assert.equal(router.shouldUseAgent, undefined);
    assert.deepEqual(Object.keys(router).sort(), ["isWorkspaceQuestion", "seemsToRequestLocalFiles"]);
});

test("seemsToRequestLocalFiles : les demandes sur des fichiers ou le projet sont reconnues", () => {
    assert.equal(router.seemsToRequestLocalFiles("lis package.json"), true);
    assert.equal(router.seemsToRequestLocalFiles("corrige le bug dans app.js"), true);
    assert.equal(router.seemsToRequestLocalFiles("commence la mission 4"), true);
    assert.equal(router.seemsToRequestLocalFiles("lance les tests"), true);
    assert.equal(router.seemsToRequestLocalFiles("liste les fichiers du dossier"), true);
});

test("seemsToRequestLocalFiles : une simple conversation n'est pas concernée", () => {
    assert.equal(router.seemsToRequestLocalFiles("bonjour, comment vas-tu ?"), false);
    assert.equal(router.seemsToRequestLocalFiles("quelle est la capitale de la France ?"), false);
});

test("isWorkspaceQuestion : question sur le projet ouvert, pas une demande d'action", () => {
    assert.equal(router.isWorkspaceQuestion("quel projet est ouvert ?"), true);
    assert.equal(router.isWorkspaceQuestion("bonjour"), false);
    assert.equal(router.isWorkspaceQuestion("quel fichier du projet dois-je modifier dans app.js ?"), false);
});

test("todo_write : les synonymes de statut sont acceptés", () => {
    const list = normalizeTodos([
        { id: 1, content: "Lire", status: "completed" },
        { id: 2, content: "Écrire", status: "In-Progress" },
        { id: 3, content: "Tester", status: "terminé" },
        { id: 4, content: "Commiter", status: "todo" }
    ]);

    assert.deepEqual(list.map(t => t.status), ["done", "in_progress", "done", "pending"]);
    assert.throws(() => normalizeTodos([{ id: 1, content: "x", status: "inconnu" }]), /status doit valoir/);
});
