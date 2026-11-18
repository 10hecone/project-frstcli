"use strict";

// Depuis la phase 4, il n'y a plus de routage chat/agent : le modèle choisit ses outils.
// Le dossier est fixé au lancement : le routeur ne sert plus qu'à répondre à « quel dossier est ouvert ? ».

const test = require("node:test");
const assert = require("node:assert/strict");

const router = require("../src/cli/router");

test("routeur : l'ancien routage agent n'existe plus", () => {
    assert.equal(router.shouldUseAgent, undefined);
    assert.equal(router.seemsToRequestLocalFiles, undefined);
    assert.deepEqual(Object.keys(router).sort(), ["isWorkspaceQuestion"]);
});

test("isWorkspaceQuestion : question sur le projet ouvert, pas une demande d'action", () => {
    assert.equal(router.isWorkspaceQuestion("quel projet est ouvert ?"), true);
    assert.equal(router.isWorkspaceQuestion("bonjour"), false);
    assert.equal(router.isWorkspaceQuestion("quel fichier du projet dois-je modifier dans app.js ?"), false);
});
