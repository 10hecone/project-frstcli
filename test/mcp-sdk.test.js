"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

// Test de fumée : garde le contrat avec @modelcontextprotocol/sdk si la version change.
// Les chemins sont ceux utilisés par src/mcp/ (CommonJS, comme le reste de src/).

test("SDK MCP : les modules client se chargent depuis le CommonJS", () => {
    const client = require("@modelcontextprotocol/sdk/client/index.js");
    const stdio = require("@modelcontextprotocol/sdk/client/stdio.js");
    const http = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const sse = require("@modelcontextprotocol/sdk/client/sse.js");
    const types = require("@modelcontextprotocol/sdk/types.js");

    assert.equal(typeof client.Client, "function");
    assert.equal(typeof stdio.StdioClientTransport, "function");
    assert.equal(typeof http.StreamableHTTPClientTransport, "function");
    assert.equal(typeof sse.SSEClientTransport, "function");
    assert.ok(types && typeof types === "object");
});

test("SDK MCP : version épinglée sans intervalle (dependencies, pas devDependencies)", () => {
    const pkg = require("../package.json");
    const version = pkg.dependencies?.["@modelcontextprotocol/sdk"];

    assert.match(version ?? "", /^\d+\.\d+\.\d+$/, "la version doit être exacte (--save-exact)");
    assert.equal(pkg.devDependencies?.["@modelcontextprotocol/sdk"], undefined);
});
