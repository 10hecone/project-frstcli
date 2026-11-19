"use strict";

const fs = require("node:fs/promises");

const { programName } = require("./policy");
const { PROGRAM, canonicalMcpArgs } = require("../../mcp/policy");
const { writeJsonFile } = require("../core/atomic");

const FILE_NAME = "permissions.json";
const MAX_RULES = 200;

// mcp-call : le raccourci `mcp-call <serveur> <outil>` est ramené à `mcp-call run <serveur> <outil>`.
// bg-run : les règles portent sur la commande lancée (« rojo serve » vaut pour bg-run rojo serve).
function withCanonicalMcp(tokens) {
    if (tokens[0] === "bg-run" && tokens.length > 1) {
        return withCanonicalMcp([programName(tokens[1]), ...tokens.slice(2)]);
    }
    return tokens[0] === PROGRAM ? [PROGRAM, ...canonicalMcpArgs(tokens.slice(1))] : tokens;
}

function tokensOf(file, args = []) {
    return withCanonicalMcp([programName(file ?? ""), ...(Array.isArray(args) ? args.map(String) : [])]);
}

// Règle trop large pour mcp-call : « mcp-call » ou « mcp-call run » autoriseraient tous les serveurs.
function isTooBroad(tokens) {
    return tokens[0] === PROGRAM && tokens.length < 3;
}

// Préfixe proposé pour la réponse « t » : programme + sous-commande (npm test, git commit).
// mcp-call : jusqu'à l'outil ou au prompt (4 mots), jusqu'au serveur pour read (3 mots).
function suggestPrefix(file, args = []) {
    const tokens = tokensOf(file, args);
    if (tokens[0] === PROGRAM) return tokens.slice(0, tokens[1] === "read" ? 3 : 4);
    const sub = tokens[1];
    if (sub && !sub.startsWith("-") && !/[\\/]/.test(sub)) return tokens.slice(0, 2);
    return tokens.slice(0, 1);
}

function normalizePrefix(prefix) {
    const list = typeof prefix === "string" ? prefix.trim().split(/\s+/) : prefix;
    if (!Array.isArray(list)) return null;
    const tokens = list.map(String).filter(Boolean);
    if (!tokens.length) return null;
    tokens[0] = programName(tokens[0]);
    return tokens[0] ? withCanonicalMcp(tokens) : null;
}

function formatPrefix(prefix) {
    return prefix.join(" ");
}

function matchesPrefix(prefix, tokens) {
    return prefix.length <= tokens.length && prefix.every((t, i) => t === tokens[i]);
}

// Réponse à la confirmation : "once" (o), "always" (t), sinon "no".
function parseAnswer(raw) {
    const answer = String(raw ?? "").trim().toLowerCase();
    if (["o", "oui", "y", "yes"].includes(answer)) return "once";
    if (["t", "toujours", "a", "always"].includes(answer)) return "always";
    return "no";
}

/**
 * Décision finale pour une commande : "deny" (jamais lancée), "run" (sans
 * confirmation) ou "ask". Une règle enregistrée ne lève jamais un deny,
 * ni une confirmation obligatoire (alwaysAsk : PowerShell).
 */
function decide({ verdict, rules = [], file, args = [] }) {
    if (!verdict || verdict.level === "deny") return "deny";
    if (verdict.alwaysAsk) return "ask";
    if (verdict.level === "safe") return "run";
    const tokens = tokensOf(file, args);
    return rules.some(rule => matchesPrefix(rule.prefix, tokens)) ? "run" : "ask";
}

/** Règles d'un projet, enregistrées dans file (permissions.json, mode 0o600). */
function createStore(file) {
    let rules = [];
    let loaded = false;

    async function load() {
        rules = [];
        try {
            const raw = JSON.parse(await fs.readFile(file, "utf8"));
            const list = Array.isArray(raw?.rules) ? raw.rules : [];
            for (const rule of list) {
                const prefix = normalizePrefix(rule?.prefix);
                if (prefix && !isTooBroad(prefix) && !rules.some(r => formatPrefix(r.prefix) === formatPrefix(prefix))) {
                    rules.push({ prefix, added: typeof rule.added === "string" ? rule.added : null });
                }
            }
        } catch (error) {
            // Fichier absent ou illisible : aucune règle.
            if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
        }
        loaded = true;
        return listRules();
    }

    async function ensure() {
        if (!loaded) await load();
    }

    async function save() {
        await writeJsonFile(file, { version: 1, rules });
    }

    function listRules() {
        return rules.map(r => ({ prefix: [...r.prefix], text: formatPrefix(r.prefix), added: r.added }));
    }

    async function add(prefix) {
        await ensure();
        const tokens = normalizePrefix(prefix);
        if (!tokens) throw new Error("Préfixe de commande vide.");
        if (isTooBroad(tokens)) {
            throw new Error("Règle trop large pour mcp-call : précise au moins le serveur (/mcp allow <serveur>).");
        }
        if (rules.some(r => formatPrefix(r.prefix) === formatPrefix(tokens))) return false;
        if (rules.length >= MAX_RULES) throw new Error(`Trop de règles : maximum ${MAX_RULES}.`);
        rules.push({ prefix: tokens, added: new Date().toISOString() });
        await save();
        return true;
    }

    // target : numéro (à partir de 1) ou préfixe ("npm test").
    async function remove(target) {
        await ensure();
        let index = -1;
        if (/^\d+$/.test(String(target).trim())) {
            index = Number(String(target).trim()) - 1;
        } else {
            const tokens = normalizePrefix(target);
            if (tokens) index = rules.findIndex(r => formatPrefix(r.prefix) === formatPrefix(tokens));
        }
        if (index < 0 || index >= rules.length) return null;
        const [removed] = rules.splice(index, 1);
        await save();
        return formatPrefix(removed.prefix);
    }

    async function clear() {
        await ensure();
        const count = rules.length;
        rules = [];
        await save();
        return count;
    }

    async function allows(fileName, args = []) {
        await ensure();
        const tokens = tokensOf(fileName, args);
        return rules.some(r => matchesPrefix(r.prefix, tokens));
    }

    async function rulesForDecision() {
        await ensure();
        return rules.map(r => ({ prefix: [...r.prefix] }));
    }

    return { file, load, list: listRules, add, remove, clear, allows, rules: rulesForDecision };
}

// Fichier du projet ouvert : ~/.francestudent-cli/projects/<projet>/permissions.json.
function defaultFile() {
    return require("../../project/memory").projectPath(FILE_NAME);
}

// ---------------------------------------------------------------------------
// Règles de settings.json : permissions.allow / permissions.deny
// ---------------------------------------------------------------------------

/**
 * Une règle « npm run build », « Bash(npm test:*) » ou « run_command(git push) » devient un
 * préfixe de mots. Les règles d'autres outils (Read(...), Edit(...)) et les jokers au milieu
 * de la règle sont ignorés (null).
 */
function parseSettingsRule(raw) {
    if (typeof raw !== "string") return null;
    let text = raw.trim();
    const wrapped = /^(?:Bash|run_command)\(([\s\S]*)\)$/.exec(text);
    if (wrapped) text = wrapped[1].trim();
    else if (/^[A-Za-z_]+\(/.test(text)) return null;
    text = text.replace(/:\*$/, "").replace(/\*$/, "").trim();
    if (!text || text.includes("*")) return null;
    const prefix = normalizePrefix(text);
    return prefix ? { prefix, source: raw.trim() } : null;
}

/**
 * Règles des deux fichiers settings.json. Le fichier du projet est versionné (donc écrit par
 * n'importe quel contributeur) : seules ses règles deny comptent, jamais ses règles allow.
 */
function settingsRules(settings) {
    const pick = (scope, key) => {
        const list = settings?.[scope]?.permissions?.[key];
        return Array.isArray(list) ? list.map(parseSettingsRule).filter(Boolean) : [];
    };
    return {
        allow: pick("user", "allow").filter(rule => !isTooBroad(rule.prefix)),
        deny: [...pick("user", "deny"), ...pick("project", "deny")]
    };
}

async function loadSettingsRules(root) {
    const { loadSettings } = require("../../core/settings");
    const settings = await loadSettings(root);
    return { ...settingsRules(settings), errors: settings.errors };
}

/** Règle deny qui vise cette commande, ou null. */
function deniedBy(rules, file, args = []) {
    const tokens = tokensOf(file, args);
    return (rules || []).find(rule => matchesPrefix(rule.prefix, tokens)) || null;
}

module.exports = {
    FILE_NAME,
    MAX_RULES,
    createStore,
    defaultFile,
    parseSettingsRule,
    settingsRules,
    loadSettingsRules,
    deniedBy,
    decide,
    parseAnswer,
    suggestPrefix,
    isTooBroad,
    normalizePrefix,
    matchesPrefix,
    formatPrefix
};
