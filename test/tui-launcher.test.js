"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { chooseInterface, MISSING_BUNDLE_MESSAGE } = require("../bin/frst.js");

const BASE = { argv: [], env: {}, isTTY: true, hasBundle: true };

test("chooseInterface choisit la TUI avec un TTY et le bundle", () => {
    assert.equal(chooseInterface(BASE), "tui");
});

test("chooseInterface choisit classic avec --classic", () => {
    assert.equal(chooseInterface({ ...BASE, argv: ["--classic"] }), "classic");
    assert.equal(chooseInterface({ ...BASE, argv: ["--debug", "--classic"] }), "classic");
});

test("chooseInterface choisit classic avec FRST_UI=classic", () => {
    assert.equal(chooseInterface({ ...BASE, env: { FRST_UI: "classic" } }), "classic");
    assert.equal(chooseInterface({ ...BASE, env: { FRST_UI: " Classic " } }), "classic");
    assert.equal(chooseInterface({ ...BASE, env: { FRST_UI: "tui" } }), "tui");
});

test("chooseInterface choisit classic sans TTY", () => {
    assert.equal(chooseInterface({ ...BASE, isTTY: false }), "classic");
});

test("chooseInterface choisit classic et prévient si le bundle manque", () => {
    const messages = [];
    const choice = chooseInterface({ ...BASE, hasBundle: false, warn: (m) => messages.push(m) });
    assert.equal(choice, "classic");
    assert.deepEqual(messages, [MISSING_BUNDLE_MESSAGE]);
});

test("chooseInterface ne prévient pas pour le bundle si classic est demandé", () => {
    const messages = [];
    const choice = chooseInterface({ ...BASE, argv: ["--classic"], hasBundle: false, warn: (m) => messages.push(m) });
    assert.equal(choice, "classic");
    assert.deepEqual(messages, []);
});

test("chooseInterface sans argument renvoie classic", () => {
    assert.equal(chooseInterface(), "classic");
});
