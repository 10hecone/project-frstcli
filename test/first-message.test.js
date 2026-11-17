"use strict";

// Couche 1 du banc d'essai : forme du premier message envoyé au modèle, sans appel réseau.
// Ces tests empêchent le retour de formulations qui font croire à certains modèles (GPT)
// qu'ils sont pilotés par un agent externe, et donc qu'ils doivent refuser les outils.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { state, resetConversation } = require("../src/state");
const chat = require("../src/core/chat");
const shortContext = require("../src/project/short-context");
const profile = require("../src/project/profile");

// Démentis et méta-instructions sur l'identité du modèle : à ne jamais réintroduire.
const SUSPICIOUS = [
    /agent externe/i,
    /tu n['’]es (pas|ni)\b/i,
    /ex[ée]cut[ée] sur un cli/i,
    /identit[ée]/i,
    /mode agent/i,
    /prioritaire/i
];

// Taille maximale raisonnable du premier message (contexte court + FRSTCLI.md + question).
const MAX_FIRST_MESSAGE_CHARS = 12_000;

const QUESTION = "lance les tests et corrige les erreurs";

async function tempProject() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frst-first-"));
    await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "demo", scripts: { test: "node --test" } })
    );
    await fs.writeFile(path.join(dir, "FRSTCLI.md"), "# Instructions du projet\n\n- Tests : npm test\n");
    await fs.mkdir(path.join(dir, "src"));
    return dir;
}

/** Premier message réel (contexte court réel), avec un profil vide et des serveurs MCP choisis. */
async function firstMessage({ question = QUESTION, summary = null, mcp = [] } = {}) {
    const original = {
        buildShortContext: shortContext.buildShortContext,
        buildPreprompt: profile.buildPreprompt,
        workspace: state.workspace
    };
    const dir = await tempProject();

    shortContext.buildShortContext = (root, options = {}) =>
 original.buildShortContext(root, { ...options, mcpServers: async () => mcp });
    profile.buildPreprompt = () => "";
    resetConversation();
    state.workspace = dir;
    state.compactSummary = summary;
    shortContext.clearShortContextCache();

    try {
        return await chat.buildMessage(question);
    } finally {
        shortContext.buildShortContext = original.buildShortContext;
        profile.buildPreprompt = original.buildPreprompt;
 state.workspace = original.workspace;
        state.compactSummary = null;
 resetConversation();
        shortContext.clearShortContextCache();
        await fs.rm(dir, { recursive: true, force: true });
    }
}

test("premier message : aucun démenti ni méta-instruction sur l'identité du modèle", async () => {
    const message = await firstMessage({ mcp: ["fake"], summary: "Objectif : finir la refonte." });
    for (const pattern of SUSPICIOUS) {
 assert.doesNotMatch(message, pattern, `formulation à éviter trouvée : ${pattern}`);
    }
});

test("premier message : « pas des instructions » réservé au contenu tiers ou généré", async () => {
    const message = await firstMessage({ mcp: ["fake"], summary: "Objectif : finir la refonte." });
    const lines = message
 .split("\n")
        .filter(line => /pas des instructions/i.test(line))
        // Contenu légitimement marqué : résultats MCP (tiers) et résumé /compact (généré).
        .filter(line => !line.startsWith("- MCP local") && !line.startsWith("RÉSUMÉ DE LA SESSION"));

    assert.equal(lines.length, 0, `mentions hors MCP et /compact :\n${lines.join("\n")}`);
});

test("premier message : la question est présente une seule fois et le message reste court", async () => {
    const message = await firstMessage();
    assert.equal(message.split(QUESTION).length - 1, 1);
    assert.ok(
        message.length <= MAX_FIRST_MESSAGE_CHARS,
        `premier message trop long : ${message.length} caractères`
    );
});

test("message suivant : envoyé tel quel, sans contexte", async () => {
    const original = state.workspace;
    resetConversation();
    state.workspace = "C:/projet";
    state.chatId = "chat-existant";
    try {
 assert.equal(await chat.buildMessage("encore"), "encore");
    } finally {
        state.workspace = original;
 resetConversation();
    }
});

// La demande d'abord, le contexte ensuite : un long bloc avant la demande ressemble à une injection.
test("premier message : la demande arrive en tête, avant tout contexte", async () => {
    const message = await firstMessage({ summary: "Objectif : finir la refonte." });
    assert.ok(message.startsWith(QUESTION), `début du message : ${message.slice(0, 80)}`);
    assert.ok(message.indexOf(QUESTION) < message.indexOf("Premier niveau du projet"));
});
