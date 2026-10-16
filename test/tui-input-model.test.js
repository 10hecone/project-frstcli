"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const m = require("../src/tui/input-model");

function typed(text) {
    return m.insert(m.empty(), text);
}

test("empty / isEmpty / toText", () => {
    const model = m.empty();
    assert.deepEqual(model, { lines: [""], row: 0, col: 0 });
    assert.equal(m.isEmpty(model), true);
    assert.equal(m.toText(model), "");
    assert.equal(m.isEmpty(typed("a")), false);
});

test("fromText place le curseur à la fin et normalise CRLF", () => {
    const model = m.fromText("ab\r\ncde");
    assert.deepEqual(model, { lines: ["ab", "cde"], row: 1, col: 3 });
    assert.equal(m.toText(model), "ab\ncde");
});

test("insert au milieu d'une ligne", () => {
    let model = typed("ac");
    model = m.left(model);
    model = m.insert(model, "b");
    assert.equal(m.toText(model), "abc");
    assert.equal(model.col, 2);
});

test("collage multiligne inséré d'un coup", () => {
    let model = typed("début fin");
    model = { ...model, col: 6 };
    model = m.insert(model, "un\r\ndeux\ntrois ");
    assert.deepEqual(model.lines, ["début un", "deux", "trois fin"]);
    assert.equal(model.row, 2);
    assert.equal(model.col, "trois ".length);
});

test("insert ne modifie pas le modèle d'origine", () => {
    const model = typed("x");
    m.insert(model, "y");
    assert.equal(m.toText(model), "x");
});

test("newline coupe la ligne au curseur", () => {
    let model = m.left(typed("ab"));
    model = m.newline(model);
    assert.deepEqual(model, { lines: ["a", "b"], row: 1, col: 0 });
});

test("backspace efface ou fusionne avec la ligne précédente", () => {
    let model = typed("ab");
    model = m.backspace(model);
    assert.equal(m.toText(model), "a");
    model = m.fromText("ab\ncd");
    model = m.home(model);
    model = m.backspace(model);
    assert.deepEqual(model, { lines: ["abcd"], row: 0, col: 2 });
    assert.deepEqual(m.backspace(m.empty()), m.empty());
});

test("del efface sous le curseur ou fusionne avec la ligne suivante", () => {
    let model = m.home(typed("ab"));
    model = m.del(model);
    assert.equal(m.toText(model), "b");
    model = m.fromText("ab\ncd");
    model = { ...model, row: 0, col: 2 };
    model = m.del(model);
    assert.deepEqual(model, { lines: ["abcd"], row: 0, col: 2 });
});

test("left / right traversent les lignes", () => {
    let model = m.home(m.fromText("ab\ncd"));
    model = m.left(model);
    assert.deepEqual([model.row, model.col], [0, 2]);
    model = m.right(model);
    assert.deepEqual([model.row, model.col], [1, 0]);
    const start = { lines: ["ab"], row: 0, col: 0 };
    assert.deepEqual(m.left(start), start);
    const fin = typed("ab");
    assert.deepEqual(m.right(fin), fin);
});

test("home / end", () => {
    const model = typed("abc");
    assert.equal(m.home(model).col, 0);
    assert.equal(m.end(m.home(model)).col, 3);
});

test("up / down changent de ligne et renvoient null en bord", () => {
    const model = m.fromText("abcdef\nxy");
    assert.equal(m.down(model), null);
    const moved = m.up(model);
    assert.deepEqual([moved.row, moved.col], [0, 2]);
    assert.equal(m.up(moved), null);
    const back = m.down({ ...moved, col: 5 });
    assert.deepEqual([back.row, back.col], [1, 2]);
});

test("killToStart / killToEnd", () => {
    const model = { lines: ["abcdef"], row: 0, col: 2 };
    assert.deepEqual(m.killToStart(model), { lines: ["cdef"], row: 0, col: 0 });
    assert.deepEqual(m.killToEnd(model), { lines: ["ab"], row: 0, col: 2 });
});

test("continuation par « \\ » en fin de ligne", () => {
    const model = typed("ligne \\");
    assert.equal(m.endsWithContinuation(model), true);
    assert.equal(m.endsWithContinuation(m.left(model)), false);
    assert.equal(m.endsWithContinuation(typed("ligne")), false);
    const next = m.continueLine(model);
    assert.deepEqual(next, { lines: ["ligne ", ""], row: 1, col: 0 });
});

test("historique : prev / next avec brouillon conservé", () => {
    let nav = m.createHistoryNav(["un", "deux"]);
    assert.equal(m.historyNext(nav), null);

    let step = m.historyPrev(nav, "brouillon");
    assert.equal(step.text, "deux");
    nav = step.nav;
    step = m.historyPrev(nav, "deux");
    assert.equal(step.text, "un");
    nav = step.nav;
    assert.equal(m.historyPrev(nav, "un"), null);

    step = m.historyNext(nav);
    assert.equal(step.text, "deux");
    nav = step.nav;
    step = m.historyNext(nav);
    assert.equal(step.text, "brouillon");
    assert.equal(m.historyNext(step.nav), null);
});

test("historique vide", () => {
    const nav = m.createHistoryNav([]);
    assert.equal(m.historyPrev(nav, "x"), null);
    assert.equal(m.historyNext(nav), null);
});

test("completeSlash", () => {
    const commands = ["/help", "/history", "/model", "/mode", "/exit"];
    assert.deepEqual(m.completeSlash("/he", commands), { text: "/help ", matches: ["/help"] });
    assert.deepEqual(m.completeSlash("/mo", commands), { text: "/mode", matches: ["/model", "/mode"] });
    assert.deepEqual(m.completeSlash("/h", commands).text, "/h");
    assert.deepEqual(m.completeSlash("/h", commands).matches, ["/help", "/history"]);
    assert.deepEqual(m.completeSlash("/zz", commands), { text: "/zz", matches: [] });
    assert.deepEqual(m.completeSlash("bonjour", commands), { text: "bonjour", matches: [] });
    assert.deepEqual(m.completeSlash("/help x", commands), { text: "/help x", matches: [] });
});
