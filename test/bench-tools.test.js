"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { QUESTIONS, REPLI, classify, withRepli, summarize, parseArgs } = require("../scripts/bench-tools");

const task = { id: "tests", expected: ["run_command"] };
const control = { id: "controle", expected: [] };

test("bench classify : appel du bon outil, d'un autre outil", () => {
    assert.equal(classify(task, { text: "", toolCalls: [{ name: "run_command" }] }), "bon-outil");
    assert.equal(classify(task, { text: "", toolCalls: [{ name: "read_file" }] }), "autre-outil");
});

test("bench classify : refus reconnus en français et en anglais", () => {
    const refusals = [
        "Le chat de France Student ne peut pas servir de moteur d'un agent externe.",
 "Je ne peux pas exécuter de commandes sur votre machine.",
 "Je n'ai pas accès à ton projet.",
        "I can't run commands on your computer."
    ];
    for (const text of refusals) assert.equal(classify(task, { text, toolCalls: [] }), "refus", text);
});

test("bench classify : appel d'outil écrit dans le texte", () => {
    const text = 'Voici l\'action : {"name": "run_command", "arguments": {"command": "npm test"}}';
    assert.equal(classify(task, { text, toolCalls: [] }), "appel-en-texte");
});

test("bench classify : réponse sans outil ni refus reconnu = ambigu", () => {
    assert.equal(classify(task, { text: "Pour lancer les tests, tape npm test.", toolCalls: [] }), "ambigu");
});

test("bench classify : questions de contrôle", () => {
    assert.equal(classify(control, { text: "Une promesse est…", toolCalls: [] }), "ok-sans-outil");
    assert.equal(classify(control, { text: "", toolCalls: [{ name: "read_file" }] }), "outil-inutile");
});

test("bench : chaque question a un identifiant unique et des outils connus", () => {
    const ids = QUESTIONS.map(q => q.id);
    assert.equal(new Set(ids).size, ids.length);
    const known = new Set(["list_directory", "read_file", "search_files", "edit_file", "write_file", "run_command"]);
    for (const q of QUESTIONS) for (const name of q.expected) assert.ok(known.has(name), `${q.id} : ${name}`);
    assert.ok(QUESTIONS.some(q => !q.expected.length), "au moins une question de contrôle");
});

test("bench withRepli : phrase insérée avant les notes techniques, sinon en tête", () => {
    const message = "y\n\n---\n\nCONTEXTE\n\nNotes techniques sur les outils du projet :\n- x";
    const out = withRepli(message);
    assert.ok(out.indexOf(REPLI) < out.indexOf("Notes techniques"));
    assert.ok(out.indexOf("CONTEXTE") < out.indexOf(REPLI));
    assert.ok(withRepli("question seule").startsWith(REPLI));
});

test("bench summarize : taux par modèle et variante, erreurs exclues des taux", () => {
    const rows = [
        { model: "GPT", variant: "actuel", control: false, category: "bon-outil" },
        { model: "GPT", variant: "actuel", control: false, category: "refus" },
        { model: "GPT", variant: "actuel", control: false, category: "erreur" },
        { model: "GPT", variant: "actuel", control: true, category: "ok-sans-outil" },
        { model: "GPT", variant: "brut", control: false, category: "autre-outil" }
    ];
    const [actuel, brut] = summarize(rows);
    assert.deepEqual(
 { requetes: actuel.requetes, erreurs: actuel.erreurs, outil: actuel.outil, refus: actuel.refus, outilInutile: actuel.outilInutile },
        { requetes: 4, erreurs: 1, outil: 50, refus: 50, outilInutile: 0 }
    );
    assert.equal(brut.outil, 100);
    assert.equal(brut.bonOutil, 0);
});

test("bench parseArgs : simulation par défaut, options reconnues, erreurs claires", () => {
    const defaults = parseArgs([]);
    assert.equal(defaults.run, false);
    assert.equal(defaults.incognito, true);

    const args = parseArgs(["--run", "--models=-1002,Sol", "--variants=actuel", "--repeat=3", "--no-incognito"]);
    assert.deepEqual(args.models, ["-1002", "Sol"]);
    assert.deepEqual(args.variants, ["actuel"]);
    assert.equal(args.repeat, 3);
    assert.equal(args.incognito, false);

    assert.throws(() => parseArgs(["--variants=inconnue"]), /Variante/);
    assert.throws(() => parseArgs(["--oups"]), /Option inconnue/);
});
