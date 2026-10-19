"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Avant tout require du projet : la config lit l'environnement au chargement.
process.env.FS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fscli-data-"));

const { state, resetConversation } = require("../src/state");
const api = require("../src/api/api");
const { setUiBackend } = require("../src/ui-bridge");
const { runAgent } = require("../src/agent/agent");

const CONTENTS = ["Lire le code", "Corriger le bug", "Lancer les tests"];

function todoWrite(statuses, reason) {
    return JSON.stringify({
        type: "tool",
        name: "todo_write",
        args: {
            todos: statuses.map((status, i) => ({ id: String(i + 1), content: CONTENTS[i], status }))
        },
        reason
    });
}

test("todo_write en mode classique : création, progression et fin d'une liste de 3 tâches", { concurrency: false }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fscli-proj-"));

    resetConversation();
    setUiBackend(null);
    state.workspace = dir;
    state.autoApprove = true;
    state.todos = [];

    const answers = [
        todoWrite(["in_progress", "pending", "pending"], "Créer la liste de tâches"),
        todoWrite(["done", "in_progress", "pending"], "Passer à la deuxième tâche"),
        todoWrite(["done", "done", "in_progress"], "Passer à la troisième tâche"),
        todoWrite(["done", "done", "done"], "Terminer toutes les tâches"),
        "{\"type\":\"final\",\"message\":\"Les 3 tâches sont terminées.\"}"
    ];
    const sent = [];
    const originalRequest = api.requestModel;

    api.requestModel = async (message, options) => {
        sent.push({ message, options });
        state.chatIds.agent = "agent-test";
        state.chatId = "agent-test";
        api.usage.requests++;
        api.usage.chars += message.length;
        return answers.shift();
    };

    const out = [];
    const log = console.log;
    const error = console.error;
    console.log = (...args) => out.push(args.join(" "));
    console.error = (...args) => out.push(args.join(" "));

    try {
        await runAgent("Corrige le bug en trois étapes");
    } finally {
        console.log = log;
        console.error = error;
        api.requestModel = originalRequest;
        state.workspace = null;
    }

    // Le modèle simulé a été appelé 5 fois : 4 mises à jour puis final.
    assert.equal(sent.length, 5);
    assert.equal(answers.length, 0);

    // État final : les 3 tâches sont terminées.
    assert.deepEqual(state.todos.map(t => t.status), ["done", "done", "done"]);

    const text = out.join("\n");

    // Mode classique sans TTY : texte simple, sans code de contrôle du terminal.
    assert.doesNotMatch(text, /\x1b/);

    // La liste est réécrite à chaque mise à jour, dans l'ordre.
    const counters = [...text.matchAll(/Tâches \((\d)\/3\)/g)].map(m => m[1]);
    assert.deepEqual(counters, ["0", "1", "2", "3"]);

    assert.match(text, /◐ Lire le code/);
    assert.match(text, /● Lire le code/);
    assert.match(text, /◐ Corriger le bug/);
    assert.match(text, /○ Lancer les tests/);
    assert.match(text, /● Lancer les tests/);

    // Le modèle reçoit le résumé de chaque mise à jour.
    assert.match(sent[1].message, /Tâches : 0 terminée\(s\) sur 3, en cours : Lire le code/);
    assert.match(sent[4].message, /Tâches : 3 terminée\(s\) sur 3/);
});
