"use strict";

// Mesure l'effet des économies de tokens sur la taille envoyée au modèle et sur
// la conservation des informations utiles (approximation de la qualité des réponses).
//
// Usage :
//   node scripts/measure-savings.js    mesures hors ligne (aucune requête)
//   node scripts/measure-savings.js --real-tests     ajoute la vraie suite de tests (~50 s)
//   node scripts/measure-savings.js --run --models=a,b
//       pose une question au modèle sur chaque sortie (une nouvelle conversation par requête)

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { createTapDigest } = require("../src/tools/command/tap-digest");

const ROOT = path.join(__dirname, "..");
const CHARS_PER_TOKEN = 3.5; // estimation grossière (français et code mélangés)

const CONFIGS = [
    { id: "avant", head: 8000, tail: 8000, tap: false, read: 30000 },
    { id: "actuel", head: 8000, tail: 8000, tap: true, read: 30000 },
    { id: "propose", head: 4000, tail: 4000, tap: true, read: 20000 }
];

const tokens = chars => Math.round(chars / CHARS_PER_TOKEN);

/** Ce que le modèle reçoit pour une sortie de commande, selon la configuration. */
function shape(text, config) {
    if (config.tap) {
        const digest = createTapDigest();
        digest.push(text);
        const condensed = digest.render();
            if (condensed !== null) return condensed;
    }
    if (text.length <= config.head + config.tail) return text;
    const omitted = text.length - config.head - config.tail;
    return `${text.slice(0, config.head)}\n[... ${omitted} caractères omis ...]\n${text.slice(-config.tail)}`;
}

function run(file, args, cwd) {
    const result = spawnSync(file, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return `${result.stdout || ""}${result.stderr || ""}`;
}

/** Suite de tests jetable : count tests, ceux de failing échouent. */
function syntheticTests(count, failing) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frst-mesure-"));
    const lines = ['"use strict";', 'const test = require("node:test");', 'const assert = require("node:assert/strict");'];
    for (let i = 1; i <= count; i++) {
        lines.push(failing.has(i)
            ? `test("cas ${i} échoue", () => assert.equal(${i} + 1, ${i}, "total des points du cas ${i}"));`
            : `test("cas ${i}", () => assert.equal(${i}, ${i}));`);
    }
    const file = path.join(dir, "suite.test.js");
    fs.writeFileSync(file, lines.join("\n"), "utf8");
    try {
        return run(process.execPath, ["--test", "--test-reporter=tap", file], dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function buildLog() {
    const lines = [];
    for (let i = 1; i <= 2500; i++) {
        lines.push(`[build] module ${i} compilé (${(i * 7) % 300} ko)`);
            if (i === 1200) lines.push("ERREUR src/app.js:120 : variable inconnue « totl »");
    }
    lines.push("Build échoué : 1 erreur.");
    return lines.join("\n");
}

function scenarios(options) {
    const list = [];

    list.push({
        id: "tests-ok",
        command: "node --test (300 tests réussis)",
        output: syntheticTests(300, new Set()),
        needles: ["# tests 300", "# fail 0"],
        question: "Combien de tests ont été lancés et combien ont échoué ?",
        answer: [/300/, /\b(0|aucun)\b/i]
    });

    list.push({
        id: "test-echec",
        command: "node --test (400 tests, 1 échec au milieu)",
        output: syntheticTests(400, new Set([200])),
        needles: ["cas 200 échoue", "total des points du cas 200", "# fail 1"],
        question: "Quel test échoue, et pourquoi ? Réponds en une ou deux phrases.",
        answer: [/\b200\b/, /total des points|201|attendu|égal|equal/i]
    });

    const many = new Set(Array.from({ length: 30 }, (_, k) => 10 + k * 13));
    list.push({
        id: "echecs-multiples",
        command: "node --test (400 tests, 30 échecs)",
        output: syntheticTests(400, many),
        needles: [...many].map(i => `cas ${i} échoue`).concat(["# fail 30"]),
        question: "Combien de tests échouent ? Donne les numéros des cas en échec.",
        answer: [/\b30\b/, /\b10\b/, /\b387\b/]
    });

    list.push({
        id: "build-erreur",
        command: "build (2 500 lignes, erreur au milieu)",
        output: buildLog(),
        needles: ["variable inconnue « totl »", "Build échoué"],
        question: "Le build a-t-il réussi ? Si non, quelle est l'erreur et où est-elle ?",
        answer: [/totl/, /app\.js/]
    });

    const subjects = run("git", ["log", "--format=%s", "-60"], ROOT).trim().split("\n");
    list.push({
        id: "git-log",
        command: "git log --stat -60",
        output: run("git", ["log", "--stat", "-60"], ROOT),
        needles: subjects
    });

    if (options.realTests) {
        list.push({
            id: "vraie-suite",
            command: "node --test test/*.test.js",
            output: run(process.execPath, ["--test", "--test-reporter=tap", "test/*.test.js"], ROOT),
            needles: ["# fail 0"]
        });
    }

    return list;
}

function measureOutputs(list) {
    console.log("\n1. Sorties de commandes : taille envoyée au modèle et informations conservées");
    console.log("Scénario     Config.    Caractères  ~Tokens  Infos gardées");
    for (const s of list) {
        for (const config of CONFIGS) {
            const shown = shape(s.output, config);
            const kept = s.needles.filter(n => shown.includes(n)).length;
            console.log(
                `${s.id.padEnd(19)} ${config.id.padEnd(9)} ${String(shown.length).padStart(11)}  ` +
                `${String(tokens(shown.length)).padStart(7)}  ${kept}/${s.needles.length}`
            );
        }
        console.log(`${"".padEnd(19)} (sortie brute : ${s.output.length} caractères)`);
    }
}

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
            else if (/\.(c|m)?jsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

function measureReads() {
    console.log("\n2. read_file : appels nécessaires pour lire tout un fichier");
    const files = walk(path.join(ROOT, "src"))
        .map(file => ({ file, size: fs.readFileSync(file, "utf8").length }))
        .sort((a, b) => b.size - a.size);
    const big = files.filter(f => f.size > 20000);
    console.log(`Fichiers de src : ${files.length} ; plus de 20 000 caractères : ${big.length} ; plus de 30 000 : ${files.filter(f => f.size > 30000).length}`);
    for (const { file, size } of files.slice(0, 5)) {
        const calls = CONFIGS.filter(c => c.id !== "actuel").map(c => `${c.id} ${Math.ceil(size / c.read)} appel(s)`);
        console.log(`  ${path.relative(ROOT, file)} (${size} car.) : ${calls.join(", ")}`);
    }
}

function measureConversations() {
    console.log("\n3. Nouvelles conversations par jour (historique local)");
    const { CONFIG } = require("../src/config");
    const file = path.join(CONFIG.dataDir, "history.json");
    let entries;
    try {
        entries = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        console.log(`  Historique illisible (${file}) : ${error.message}`);
        return;
    }
    const days = new Map();
    for (const entry of entries) {
        const day = String(entry.createdAt || "").slice(0, 10);
        const stats = days.get(day) || { count: 0, single: 0, messages: 0, modes: {} };
        stats.count++;
        stats.messages += entry.messages || 0;
        if ((entry.messages || 0) <= 1) stats.single++;
        stats.modes[entry.mode || "chat"] = (stats.modes[entry.mode || "chat"] || 0) + 1;
        days.set(day, stats);
    }
    console.log(`  (les ${entries.length} dernières conversations gardées localement ; le banc n'y figure pas)`);
    for (const [day, s] of [...days].sort().reverse().slice(0, 7)) {
        const modes = Object.entries(s.modes).map(([m, n]) => `${m} ${n}`).join(", ");
        console.log(`  ${day} : ${s.count} conversation(s), ${s.single} avec un seul message, ${s.messages} message(s) ; ${modes}`);
    }
}

function measureSearches() {
    console.log("\n4. search_files : requêtes avec « | » (sans regex: true, la recherche est littérale)");
    const queries = [
        "HEAD_CHARS|TAIL_CHARS|maxReadChars|MAX_RESULT_CHARS|MAX_RESULTS_CHARS",
        "appendFile|\\.jsonl"
    ];
    const texts = walk(path.join(ROOT, "src")).map(file => fs.readFileSync(file, "utf8"));
    for (const query of queries) {
        const re = new RegExp(query, "i");
        let literal = 0;
        let regex = 0;
        for (const text of texts) {
            for (const line of text.split("\n")) {
                if (line.toLowerCase().includes(query.toLowerCase())) literal++;
                if (re.test(line)) regex++;
            }
        }
        console.log(`  ${query} : littéral ${literal} résultat(s), regex ${regex} résultat(s)`);
    }
}

function parseArgs(argv) {
    const args = { run: false, realTests: false, models: null };
    for (const arg of argv) {
        const [key, value = ""] = arg.replace(/^--/, "").split("=");
        if (key === "run") args.run = true;
        else if (key === "real-tests") args.realTests = true;
        else if (key === "models") args.models = value.split(",").map(s => s.trim()).filter(Boolean);
        else throw new Error(`Option inconnue : ${arg}`);
    }
    if (args.run && !args.models) throw new Error("--run exige --models=... (liste explicite, pour maîtriser le quota).");
    return args;
}

/** Qualité : le modèle retrouve-t-il l'information à partir de la sortie qu'il reçoit ? */
async function measureAnswers(list, args) {
    const { state } = require("../src/state");
    const api = require("../src/api/api");
    const { listAgents, resolveAgent } = require("../src/api/agents");
    const { loadSession } = require("../src/api/auth");

    await loadSession();
    const { agents } = await listAgents();
    const models = args.models.map(query => {
        const { agent } = resolveAgent(query, agents);
        if (!agent) throw new Error(`Modèle introuvable ou ambigu : ${query}`);
        return agent;
    });

    // Une requête par sortie différente : « avant » et « actuel » sont identiques hors TAP.
    const jobs = [];
    for (const s of list.filter(item => item.question)) {
        const seen = new Map();
        for (const config of CONFIGS) {
            const shown = shape(s.output, config);
            if (seen.has(shown)) continue;
            seen.set(shown, config.id);
            jobs.push({ s, config, shown });
        }
    }
    console.log(`\n5. Qualité des réponses : ${jobs.length * models.length} requête(s) prévue(s)`);

    state.incognito = true;
    const rows = [];
    outer:
    for (const model of models) {
        for (const { s, config, shown } of jobs) {
            const message =
                `Voici la sortie renvoyée par la commande \`${s.command}\` :\n\n${shown}\n\n` +
                `Question : ${s.question}`;
            const row = { model: model.name, scenario: s.id, config: config.id, tokens: tokens(message.length) };
            try {
                const turn = await api.requestTurn(message, { agentId: model.id, fresh: true, onInterrupt: () => null });
                const text = String(turn.text || "");
                row.score = `${s.answer.filter(re => re.test(text)).length}/${s.answer.length}`;
                row.text = text.slice(0, 400);
            } catch (error) {
                row.score = "erreur";
                row.error = error.message;
                if (error.status === 429) {
                    rows.push(row);
                    console.log(`Quota épuisé, arrêt : ${error.message}`);
                    break outer;
                }
            }
            rows.push(row);
            console.log(`${model.name.padEnd(20)} ${s.id.padEnd(17)} ${config.id.padEnd(8)} ~${row.tokens} tokens -> ${row.score}`);
        }
    }

    const dir = path.join(ROOT, "bench-results");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `savings-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(rows, null, 2), "utf8");
    console.log(`Réponses détaillées : ${path.relative(ROOT, file)}`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const list = scenarios(args);
    measureOutputs(list);
    measureReads();
    measureConversations();
    measureSearches();
    if (args.run) await measureAnswers(list, args);
    else console.log("\nQualité des réponses : ajoute --run --models=... (une conversation par requête).");
}

main()
    .then(() => process.exit(process.exitCode || 0))
    .catch(error => {
        console.error("Échec de la mesure :", error && error.message ? error.message : error);
        process.exit(1);
    });
