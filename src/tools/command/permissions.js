"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { programName } = require("./policy");

const FILE_NAME = "permissions.json";
const MAX_RULES = 200;

function tokensOf(file, args = []) {
    return [programName(file ?? ""), ...(Array.isArray(args) ? args.map(String) : [])];
}

// Préfixe proposé pour la réponse « t » : programme + sous-commande (npm test, git commit).
function suggestPrefix(file, args = []) {
    const tokens = tokensOf(file, args);
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
    return tokens[0] ? tokens : null;
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
 * confirmation) ou "ask". Une règle enregistrée ne lève jamais un deny.
 */
function decide({ verdict, rules = [], file, args = [] }) {
    if (!verdict || verdict.level === "deny") return "deny";
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
                if (prefix && !rules.some(r => formatPrefix(r.prefix) === formatPrefix(prefix))) {
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
        await fs.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        const data = JSON.stringify({ version: 1, rules }, null, 2) + "\n";
        await fs.writeFile(tmp, data, { mode: 0o600 });
        await fs.rename(tmp, file);
        try {
            await fs.chmod(file, 0o600);
        } catch {
            // Sans effet sous Windows.
        }
    }

    function listRules() {
        return rules.map(r => ({ prefix: [...r.prefix], text: formatPrefix(r.prefix), added: r.added }));
    }

    async function add(prefix) {
        await ensure();
        const tokens = normalizePrefix(prefix);
        if (!tokens) throw new Error("Préfixe de commande vide.");
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

module.exports = {
    FILE_NAME,
    MAX_RULES,
    createStore,
    defaultFile,
    decide,
    parseAnswer,
    suggestPrefix,
    normalizePrefix,
    matchesPrefix,
    formatPrefix
};
