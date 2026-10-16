const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { ui, setUiBackend, getUiBackend, UI_METHODS } = require("../src/ui-bridge");

afterEach(() => setUiBackend(null));

function makeFake(tag, calls) {
    const handlers = new Set();
    const fake = { handlers };
    for (const name of UI_METHODS) {
        fake[name] = (...args) => {
            calls.push({ tag, name, args });
            return `${tag}:${name}`;
        };
    }
    fake.onInterrupt = handler => {
        handlers.add(handler);
        return () => handlers.delete(handler);
    };
    return fake;
}

test("ui-bridge : délègue les appels et les valeurs de retour au backend actif", () => {
    const calls = [];
    setUiBackend(makeFake("A", calls));
    assert.equal(ui.info("bonjour", 42), "A:info");
    assert.equal(ui.result("ko", { tone: "error" }), "A:result");
    assert.deepEqual(calls, [
        { tag: "A", name: "info", args: ["bonjour", 42] },
        { tag: "A", name: "result", args: ["ko", { tone: "error" }] }
    ]);
});

test("ui-bridge : le changement de backend est pris en compte immédiatement", () => {
    const calls = [];
    const a = makeFake("A", calls);
    const b = makeFake("B", calls);
    setUiBackend(a);
    ui.warn("un");
    setUiBackend(b);
    assert.equal(getUiBackend(), b);
    ui.warn("deux");
    assert.deepEqual(calls.map(c => c.tag), ["A", "B"]);
});

test("ui-bridge : onInterrupt renvoie la fonction de désinscription du backend", () => {
    const fake = makeFake("A", []);
    setUiBackend(fake);
    const handler = () => {};
    const off = ui.onInterrupt(handler);
    assert.equal(typeof off, "function");
    assert.ok(fake.handlers.has(handler));
    off();
    assert.equal(fake.handlers.has(handler), false);
});

test("ui-bridge : erreur claire si le backend n'a pas la méthode", () => {
    setUiBackend({ info() {} });
    assert.throws(() => ui.spinner("x"), /méthode « spinner » absente du backend actif/);
});

test("ui-bridge : refuse un backend qui n'est pas un objet", () => {
    assert.throws(() => setUiBackend("cli"), TypeError);
});

test("ui-bridge : null rétablit le backend CLI par défaut, qui expose toutes les méthodes", () => {
    setUiBackend(makeFake("A", []));
    setUiBackend(null);
    const cliUi = require("../src/cli/ui").ui;
    assert.equal(getUiBackend(), cliUi);
    for (const name of UI_METHODS) {
        assert.equal(typeof cliUi[name], "function", `méthode ${name} manquante dans le ui CLI`);
    }
});

test("ui CLI : print accepte une chaîne ou un tableau", () => {
    const cliUi = require("../src/cli/ui").ui;
    const out = [];
    const original = console.log;
    console.log = (...args) => out.push(args.join(" "));
    try {
        cliUi.print("seule");
        cliUi.print(["a", "b"]);
    } finally {
        console.log = original;
    }
    assert.deepEqual(out, ["seule", "a", "b"]);
});

test("ui CLI : stream écrit le texte et end vide le tampon", () => {
    const cliUi = require("../src/cli/ui").ui;
    const out = [];
    const s = cliUi.stream({ color: false, write: chunk => out.push(chunk) });
    assert.equal(typeof s.write, "function");
    assert.equal(typeof s.end, "function");
    s.write("bonjour ");
    s.write("le monde");
    s.end();
    assert.match(out.join(""), /bonjour le monde/);
});
