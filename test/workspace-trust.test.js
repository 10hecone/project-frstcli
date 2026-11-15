"use strict";

const test = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");

const { trustMessage } = require("../src/core/workspace");

test("trustMessage : rappel de l'envoi au fournisseur API", () => {
    const message = trustMessage(path.join(os.tmpdir(), "projet"));
    assert.match(message, /fournisseur API/);
    assert.doesNotMatch(message, /ATTENTION/);
});

test("trustMessage : avertissement renforcé pour ~ et la racine d'un disque", () => {
    assert.match(trustMessage(os.homedir()), /ATTENTION/);
    assert.match(trustMessage(path.parse(process.cwd()).root), /ATTENTION/);
});
