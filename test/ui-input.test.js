"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { collectInput } = require("../src/cli/ui");

function fakeInterface() {
    const r = new EventEmitter();
    r.line = "";
    r.prompts = [];
    r.writes = [];
    r.setPrompt = p => { r.current = p; };
    r.prompt = () => { r.prompts.push(r.current); };
    r.write = (data, key) => {
        r.writes.push(key?.name);
        if (key?.ctrl && key.name === "u") r.line = "";
    };
    return r;
}

const sink = { write() {} };

test("collectInput : un collage de plusieurs lignes donne un seul message", async () => {
    const r = fakeInterface();
    const keys = new EventEmitter();
    const pending = collectInput(r, "> ", { gapMs: 20, keys, out: sink });
    r.emit("line", "première ligne");
    r.emit("line", "deuxième ligne");
    r.emit("line", "troisième ligne");
    assert.equal(await pending, "première ligne\ndeuxième ligne\ntroisième ligne");
    assert.equal(r.listenerCount("line"), 0);
    assert.equal(keys.listenerCount("keypress"), 0);
});

test("collectInput : une ligne tapée seule est envoyée telle quelle", async () => {
    const r = fakeInterface();
    const pending = collectInput(r, "> ", { gapMs: 10, keys: new EventEmitter(), out: sink });
    r.emit("line", "bonjour");
    assert.equal(await pending, "bonjour");
});

test("collectInput : collage sans retour final, on attend Entrée", async () => {
    const r = fakeInterface();
    let done = false;
    const pending = collectInput(r, "> ", { gapMs: 10, keys: new EventEmitter(), out: sink })
        .then(v => { done = true; return v; });
    r.emit("line", "ligne 1");
    r.line = "ligne 2en cours";
    await new Promise(res => setTimeout(res, 40));
    assert.equal(done, false);
    r.line = "";
    r.emit("line", "ligne 2 en cours");
    assert.equal(await pending, "ligne 1\nligne 2 en cours");
});

test("collectInput : « \\ » en fin de ligne continue la saisie", async () => {
    const r = fakeInterface();
    const pending = collectInput(r, "> ", { gapMs: 10, keys: new EventEmitter(), out: sink });
    r.emit("line", "début\\");
    await new Promise(res => setTimeout(res, 30));
    r.emit("line", "fin");
    assert.equal(await pending, "début\nfin");
});

test("collectInput : Échap efface toute la saisie en cours", async () => {
    const r = fakeInterface();
    const keys = new EventEmitter();
    const pending = collectInput(r, "> ", { gapMs: 10, keys, out: sink });
    r.emit("line", "brouillon\\");
    r.line = "encore";
    keys.emit("keypress", undefined, { name: "escape" });
    assert.equal(r.line, "");
    assert.equal(r.current, "> ");
    r.emit("line", "vrai message");
    assert.equal(await pending, "vrai message");
});

test("collectInput : Ctrl+A puis Retour arrière efface toute la saisie", async () => {
    const r = fakeInterface();
    const keys = new EventEmitter();
    const pending = collectInput(r, "> ", { gapMs: 10, keys, out: sink });
    r.emit("line", "brouillon\\");
    r.line = "encore";
    keys.emit("keypress", undefined, { ctrl: true, name: "a" });
    keys.emit("keypress", undefined, { name: "backspace" });
    assert.equal(r.line, "");
    r.emit("line", "vrai message");
    assert.equal(await pending, "vrai message");
});

test("collectInput : Retour arrière seul n'efface pas tout", async () => {
    const r = fakeInterface();
    const keys = new EventEmitter();
    const pending = collectInput(r, "> ", { gapMs: 10, keys, out: sink });
    r.emit("line", "garde\\");
    keys.emit("keypress", undefined, { name: "backspace" });
    keys.emit("keypress", undefined, { ctrl: true, name: "a" });
    keys.emit("keypress", undefined, { name: "left" });
    keys.emit("keypress", undefined, { name: "backspace" });
    r.emit("line", "suite");
    assert.equal(await pending, "garde\nsuite");
});

test("collectInput : les retours à la ligne du prompt sont écrits une fois, hors du prompt readline", async () => {
    const r = fakeInterface();
    let written = "";
    const out = { write(t) { written += t; } };
    const pending = collectInput(r, "\n> ", { gapMs: 10, keys: new EventEmitter(), out });
    assert.equal(written, "\n");
    assert.equal(r.current, "> ");
    r.emit("line", "ok");
    assert.equal(await pending, "ok");
});

test("collectInput : avec _ttyWrite, Ctrl+A n'atteint pas readline et une lettre remplace le texte", async () => {
    const r = fakeInterface();
    const seen = [];
    r._ttyWrite = function (s, key) {
        seen.push(key?.ctrl ? `ctrl+${key.name}` : s);
        if (key?.ctrl && key.name === "u") r.line = "";
        else if (typeof s === "string") r.line += s;
    };
    r.write = (data, key) => r._ttyWrite(data, key);
    const original = r._ttyWrite;
    const pending = collectInput(r, "> ", { gapMs: 10, keys: null, out: sink });
    r.line = "ancien texte";
    r._ttyWrite(undefined, { ctrl: true, name: "a" });
    assert.ok(!seen.includes("ctrl+a"));
    r._ttyWrite("n", { name: "n" });
    assert.equal(r.line, "n");
    r.line = "";
    r.emit("line", "nouveau");
    assert.equal(await pending, "nouveau");
    assert.equal(r._ttyWrite, original);
});

test("collectInput : Ctrl+A surligne la ligne en vidéo inverse, une flèche retire le surlignage", async () => {
    const r = fakeInterface();
    let written = "";
    const out = { write(t) { written += t; return true; } };
    r._ttyWrite = function (s, key) {
        if (key?.ctrl && key.name === "u") r.line = "";
        else if (typeof s === "string" && !key?.ctrl) r.line += s;
    };
    r.write = (data, key) => r._ttyWrite(data, key);
    r.getCursorPos = () => ({ rows: 0, cols: 2 + r.line.length });
    r.getPrompt = () => r.current;
    const pending = collectInput(r, "> ", { gapMs: 10, keys: null, out });
    r.line = "abc";
    written = "";
    r._ttyWrite(undefined, { ctrl: true, name: "a" });
    assert.ok(written.includes("> \x1b[7mabc\x1b[27m"));
    written = "";
    r._ttyWrite(undefined, { name: "left" });
    assert.ok(written.includes("> abc"));
    assert.ok(!written.includes("\x1b[7m"));
    assert.equal(r.line, "abc");
    r.line = "";
    r.emit("line", "abc");
    assert.equal(await pending, "abc");
});

test("collectInput : Ctrl+V colle le presse-papier du système, plusieurs lignes comprises", async () => {
    const r = fakeInterface();
    r._ttyWrite = function (s, key) {
        if (key?.ctrl && key.name === "u") r.line = "";
        else if (typeof s === "string" && !key?.ctrl) r.line += s;
    };
    r.write = (data, key) => r._ttyWrite(data, key);
    const clipboard = async () => "ligne 1\r\nligne 2\r\nligne 3\r\n";
    const pending = collectInput(r, "> ", { gapMs: 10, keys: null, out: sink, clipboard });
    r._ttyWrite(undefined, { ctrl: true, name: "v" });
    await new Promise(res => setTimeout(res, 5));
    assert.equal(r.line, "ligne 3");
    r.line = "";
    r.emit("line", "ligne 3");
    assert.equal(await pending, "ligne 1\nligne 2\nligne 3");
});

test("collectInput : Ctrl+V avec un presse-papier vide ne change rien", async () => {
    const r = fakeInterface();
    r._ttyWrite = function (s, key) {
        if (key?.ctrl && key.name === "u") r.line = "";
        else if (typeof s === "string" && !key?.ctrl) r.line += s;
    };
    r.write = (data, key) => r._ttyWrite(data, key);
    const pending = collectInput(r, "> ", { gapMs: 10, keys: null, out: sink, clipboard: async () => "" });
    r.line = "garde";
    r._ttyWrite(undefined, { ctrl: true, name: "v" });
    await new Promise(res => setTimeout(res, 5));
    assert.equal(r.line, "garde");
    r.line = "";
    r.emit("line", "garde");
    assert.equal(await pending, "garde");
});

test("collectInput : null si l'entrée est fermée", async () => {
    const r = fakeInterface();
    const pending = collectInput(r, "> ", { gapMs: 10, keys: new EventEmitter(), out: sink });
    r.emit("close");
    assert.equal(await pending, null);
});
