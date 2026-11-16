#!/usr/bin/env node
"use strict";

/*
 * Faux serveur MCP stdio pour les tests (SDK serveur officiel).
 * Outils : echo, slow, fail, env_keys, big, add_tool (ajoute « extra » et envoie list_changed), crash.
 * Ressource : fake://note. Prompt : greet.
 * Variables : FAKE_MCP_SECRET (écrite sur stderr au démarrage, pour tester le masquage),
 * FAKE_MCP_STDERR_FLOOD (nombre de caractères écrits sur stderr au démarrage).
 */

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
    ListToolsRequestSchema,
    CallToolRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
    ListPromptsRequestSchema,
    GetPromptRequestSchema
} = require("@modelcontextprotocol/sdk/types.js");

const text = value => ({ content: [{ type: "text", text: String(value) }] });

const tools = [
    {
        name: "echo",
        description: "Renvoie le texte reçu.",
        inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
        annotations: { readOnlyHint: true }
    },
    { name: "slow", description: "Attend « ms » millisecondes.", inputSchema: { type: "object", properties: { ms: { type: "number" } } } },
    { name: "fail", description: "Répond toujours par une erreur d'outil.", inputSchema: { type: "object", properties: {} } },
    { name: "env_keys", description: "Noms des variables d'environnement reçues.", inputSchema: { type: "object", properties: {} } },
    { name: "big", description: "Renvoie « chars » caractères.", inputSchema: { type: "object", properties: { chars: { type: "number" } } } },
    { name: "image", description: "Renvoie une petite image.", inputSchema: { type: "object", properties: {} } },
    { name: "add_tool", description: "Ajoute l'outil extra et prévient le client.", inputSchema: { type: "object", properties: {} } },
    { name: "crash", description: "Arrête le processus.", inputSchema: { type: "object", properties: {} } }
];

const server = new Server(
    { name: "fake-mcp", version: "1.0.0" },
    { capabilities: { tools: { listChanged: true }, resources: {}, prompts: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const args = request.params.arguments || {};

    switch (request.params.name) {
        case "echo":
            return text(args.text);
        case "slow":
            await new Promise((resolve, reject) => {
                const timer = setTimeout(resolve, Number(args.ms) || 1000);
                extra.signal.addEventListener("abort", () => {
                    clearTimeout(timer);
                    reject(new Error("annulé"));
                });
            });
            return text("fini");
        case "fail":
            return { content: [{ type: "text", text: "échec volontaire" }], isError: true };
        case "env_keys":
            return text(JSON.stringify(Object.keys(process.env).sort()));
        case "big":
            return text("x".repeat(Number(args.chars) || 100_000));
        case "image":
            return { content: [{ type: "image", data: Buffer.from("fausse image").toString("base64"), mimeType: "image/png" }] };
        case "add_tool":
            if (!tools.some(tool => tool.name === "extra")) {
                tools.push({ name: "extra", description: "Outil ajouté.", inputSchema: { type: "object", properties: {} } });
            }
            await server.sendToolListChanged();
            return text("ajouté");
        case "crash":
            setTimeout(() => process.exit(3), 10);
            return text("arrêt");
        case "extra":
            return text("extra");
        default:
            return { content: [{ type: "text", text: `outil inconnu : ${request.params.name}` }], isError: true };
    }
});

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{ uri: "fake://note", name: "note", mimeType: "text/plain" }]
}));

server.setRequestHandler(ReadResourceRequestSchema, async request => ({
    contents: [{ uri: request.params.uri, mimeType: "text/plain", text: "contenu de la note" }]
}));

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [{ name: "greet", description: "Salutation.", arguments: [{ name: "who", required: false }] }]
}));

server.setRequestHandler(GetPromptRequestSchema, async request => ({
    messages: [{ role: "user", content: { type: "text", text: `Bonjour ${(request.params.arguments || {}).who || "toi"}` } }]
}));

if (process.env.FAKE_MCP_SECRET) process.stderr.write(`secret reçu : ${process.env.FAKE_MCP_SECRET}\n`);
if (process.env.FAKE_MCP_STDERR_FLOOD) {
    const count = Number(process.env.FAKE_MCP_STDERR_FLOOD);
    for (let i = 0; i < count / 50; i++) process.stderr.write(`ligne ${String(i).padStart(6, "0")} ${"y".repeat(36)}\n`);
}

server.connect(new StdioServerTransport()).catch(error => {
    process.stderr.write(`échec : ${error.message}\n`);
    process.exit(1);
});
