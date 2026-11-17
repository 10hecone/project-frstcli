"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { runMcpCall, formatToolResult } = require("../src/mcp/call");
const { parseMcpArgs, canonicalMcpArgs } = require("../src/mcp/policy");

test("MCP : le texte ne masque pas les données structurées complémentaires", () => {
    assert.equal(formatToolResult({ content: [{ type: "text", text: "ok" }], structuredContent: { count: 3 } }), 'ok\nDonnées structurées (JSON) :\n{"count":3}');
    assert.equal(formatToolResult({ content: [{ type: "text", text: '{ "count": 3 }' }], structuredContent: { count: 3 } }), '{ "count": 3 }');
});

test("MCP : pagination de description sans perte de schéma", async () => {
    const schema = { type: "object", properties: { text: { type: "string", description: "x".repeat(10000) } }, required: ["text"] };
    const manager = { connect: async () => ({ listTools: async () => [{ name: "echo", inputSchema: schema }] }) };
    let offset = 0;
    let joined = "";
    for (let page = 0; page < 5; page++) {
        const result = await runMcpCall({ args: ["describe", "fake", "echo", "--offset", String(offset)], manager });
        assert.equal(result.exit_code, 0);
        const footer = /\n\[description partielle :[^\n]+--offset (\d+)\]$/.exec(result.output.trimEnd());
        let text = result.output.trimEnd();
        if (offset) text = text.slice(text.indexOf("\n") + 1);
        if (footer) text = text.slice(0, text.lastIndexOf("\n[description partielle"));
        joined += text;
        if (!footer) break;
        offset = Number(footer[1]);
    }
    const json = joined.split("arguments (schéma JSON) : ")[1].split("\nappel :")[0];
    assert.deepEqual(JSON.parse(json), schema);
    assert.equal(parseMcpArgs(["describe", "fake", "echo", "--offset", "4000"]).offset, 4000);
    assert.ok(parseMcpArgs(["describe", "fake", "echo", "--offset", "-1"]).error);
    assert.ok(parseMcpArgs(["run", "fake", "echo", "--offset", "1"]).error);
    assert.deepEqual(canonicalMcpArgs(["describe", "fake", "echo", "--offset", "4000"]), ["describe", "fake", "echo", "--offset", "4000"]);
});
