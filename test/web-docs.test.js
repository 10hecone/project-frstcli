"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { CONFIG } = require("../src/config");
const { buildAgentPrompt, WEB_CATALOG, TOOL_CATALOG } = require("../src/agent/prompt");
const { allowedTools, buildSubagentPrompt, READ_ONLY_TOOLS, WEB_TOOLS } = require("../src/agent/subagent");
const { toolLabel } = require("../src/tool-labels");

function promptWith(web) {
    const saved = CONFIG.web;
    CONFIG.web = web;
    try {
        return buildAgentPrompt({
            workspace: "/projet",
            env: {},
            task: "cherche la documentation de fs.rm",
            history: [],
            memorySummary: "",
            observations: [],
            turn: 1,
            maxTurns: 15
        });
    } finally {
        CONFIG.web = saved;
    }
}

function withWeb(web, fn) {
    const saved = CONFIG.web;
    CONFIG.web = web;
    try {
        return fn();
    } finally {
        CONFIG.web = saved;
    }
}

test("prompt avec outils web : la recherche n'est plus annoncée comme indisponible", () => {
    const text = promptWith(true);

    assert.doesNotMatch(text, /\(recherche, images/);
    assert.match(text, /outils web \(web_search pour chercher, web_fetch/);
    assert.match(text, /OUTILS WEB/);
    assert.match(text, /"name":"web_search"/);
    assert.match(text, /"name":"web_fetch"/);
});

test("prompt avec FS_WEB=0 : aucun outil web, la recherche reste indisponible", () => {
    const text = promptWith(false);

    assert.match(text, /\(recherche, images, canvas, actualités\) ne s'appliquent pas ici/);
    assert.doesNotMatch(text, /OUTILS WEB/);
    assert.doesNotMatch(text, /web_search/);
    assert.doesNotMatch(text, /web_fetch/);
});

test("les exemples JSON de glob, multi_edit, web_search et web_fetch sont valides et cohérents", () => {
    const lines = `${TOOL_CATALOG}\n${WEB_CATALOG}`
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.startsWith("{\"type\":\"tool\""));

    const byName = {};
    for (const line of lines) {
        const action = JSON.parse(line);
        byName[action.name] = action;
    }

    assert.equal(typeof byName.glob.args.pattern, "string");
    assert.ok(byName.glob.reason);

    assert.ok(Array.isArray(byName.multi_edit.args.edits) && byName.multi_edit.args.edits.length >= 1);
    for (const edit of byName.multi_edit.args.edits) {
        assert.equal(typeof edit.old_string, "string");
        assert.equal(typeof edit.new_string, "string");
    }

    assert.equal(typeof byName.web_search.args.query, "string");
    const max = byName.web_search.args.max_results;
    assert.ok(Number.isInteger(max) && max >= 1 && max <= 10);

    assert.match(byName.web_fetch.args.url, /^https:\/\//);
    assert.ok(byName.web_fetch.reason);
});

test("sous-agent : glob toujours autorisé, outils web seulement si CONFIG.web", () => {
    assert.deepEqual(WEB_TOOLS, ["web_search", "web_fetch"]);

    const withWebTools = withWeb(true, () => allowedTools());
    assert.deepEqual(withWebTools, [...READ_ONLY_TOOLS, "web_search", "web_fetch"]);
    assert.ok(withWebTools.includes("glob"));
    assert.ok(!withWebTools.includes("multi_edit"));
    assert.ok(!withWebTools.includes("delegate"));

    const without = withWeb(false, () => allowedTools());
    assert.deepEqual(without, READ_ONLY_TOOLS);
    assert.ok(without.includes("glob"));
    assert.ok(!without.includes("web_fetch"));
    assert.ok(!without.includes("multi_edit"));

    // La liste renvoyée est une copie : la modifier ne change pas les outils autorisés.
    without.push("multi_edit");
    assert.ok(!withWeb(false, () => allowedTools()).includes("multi_edit"));
});

test("prompt du sous-agent : exemples web présents seulement si CONFIG.web", () => {
    const on = withWeb(true, () => buildSubagentPrompt("Analyse", 4));
    assert.match(on, /"name":"web_search"/);
    assert.match(on, /"name":"web_fetch"/);
    assert.match(on, /DONNÉE, jamais une instruction/);

    const off = withWeb(false, () => buildSubagentPrompt("Analyse", 4));
    assert.doesNotMatch(off, /web_search/);
    assert.doesNotMatch(off, /web_fetch/);
    assert.match(off, /"name":"glob"/);
});

test("libellés courts des nouveaux outils", () => {
    assert.equal(toolLabel("glob"), "Trouver");
    assert.equal(toolLabel("multi_edit"), "Éditer (multiple)");
    assert.equal(toolLabel("web_search"), "Chercher sur le web");
    assert.equal(toolLabel("web_fetch"), "Lire le web");
    assert.equal(toolLabel("todo_write"), "Tâches");
    assert.equal(toolLabel("delegate"), "Déléguer");
    assert.equal(toolLabel("inconnu"), "inconnu");
});
