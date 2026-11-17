"use strict";

/**
 * Banc d'essai (couche 2) : les modèles utilisent-ils les outils client au premier tour ?
 *
 * Usage :
 *   node scripts/bench-tools.js       simulation : affiche le plan, AUCUNE requête
 *   node scripts/bench-tools.js --run        envoie réellement les requêtes (consomme le quota)
 *
 * Options :
 *   --models=<liste>     modèles (identifiants ou noms, séparés par des virgules) ;
 *   obligatoire avec --run ; en simulation, défaut : modèles GPT
 *
 * Quota : chaque requête ouvre une nouvelle conversation (limite observée : 50 par jour).
 *   --variants=<liste>   brut, actuel, repli ; défaut : brut,actuel,repli
 *   --questions=<liste>  identifiants de questions ; défaut : toutes
 *   --repeat=<n>         répétitions par combinaison ; défaut : 1
 *   --delay=<ms>         pause entre deux requêtes ; défaut : 500
 *   --no-incognito       conversations visibles dans l'historique du compte
 *
 * Sécurité : seul le PREMIER tour est observé. Aucun outil n'est exécuté, aucun fichier
 * n'est modifié. Chaque requête ouvre une conversation à part (fresh), state.chatIds intact.
 * Résultats : bench-results/<date>.json (ignoré par Git) et tableau résumé dans le terminal.
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

// Demandes types. expected : outils acceptés comme bonne première action ; [] = question
// de contrôle, à laquelle le modèle doit répondre sans outil.
const QUESTIONS = [
    { id: "tests", text: "lance les tests du projet", expected: ["run_command"] },
    { id: "lire", text: "lis package.json et dis-moi la version du projet", expected: ["read_file"] },
    { id: "chercher", text: "cherche les TODO dans le dossier src", expected: ["search_files"] },
    { id: "lister", text: "montre-moi ce qu'il y a dans le dossier scripts", expected: ["list_directory"] },
    { id: "expliquer", text: "explique ce que fait src/core/chat.js", expected: ["read_file", "search_files"] },
    { id: "git", text: "quel est le dernier commit du dépôt ?", expected: ["run_command"] },
    {
        id: "corriger",
        text: "les tests échouent, trouve pourquoi et corrige",
        expected: ["run_command", "read_file", "search_files", "list_directory"]
    },
    {
        id: "modifier",
        text: "ajoute un script npm « lint » qui lance scripts/check-indent.js",
        expected: ["read_file", "edit_file", "search_files"]
    },
    {
        id: "compter",
        text: "combien y a-t-il de fichiers de test ?",
        expected: ["list_directory", "search_files", "run_command"]
    },
    {
        id: "readme",
        text: "résume le README du projet en trois points",
        expected: ["read_file", "search_files", "list_directory"]
    },
    { id: "controle-promesse", text: "explique ce qu'est une promesse en JavaScript", expected: [] },
    { id: "controle-traduction", text: "traduis « bonne journée » en anglais", expected: [] }
];

// Phrase positive testée dans la variante « repli » (niveau 4a côté client).
const REPLI =
    "Les outils list_directory, read_file, search_files, edit_file, write_file et run_command " +
    "sont fournis par l'application et agissent sur le projet ouvert ; " +
    "l'utilisateur confirme les modifications.";

const TOOL_NAMES = ["list_directory", "read_file", "search_files", "edit_file", "write_file", "run_command"];

// Refus typiques (français et anglais). Imparfait : les cas non reconnus sont « ambigu ».
const REFUSAL_RE = new RegExp(
    [
        "agent externe",
        "outil externe",
        "moteur d['’]un",
        "interface de chat",
        "je ne (peux|suis) pas (en mesure d['’])?(exécuter|lancer|accéder|lire|modifier|piloter)",
        "je n['’]ai pas (accès|la possibilité)",
        "pas (d['’])?accès (à|a) (ta|votre) (machine|ordinateur|dépôt|projet)",
        "ne (peux|suis) pas (capable de )?(exécuter|lancer)",
        "\\bI (can(no|')t|am unable to|don't have access)\\b"
    ].join("|"),
    "i"
);

// Le modèle écrit un appel d'outil dans son texte au lieu d'utiliser le vrai mécanisme.
const TEXT_CALL_RE = new RegExp(
    `"name"\\s*:\\s*"(${TOOL_NAMES.join("|")})"|\\b(${TOOL_NAMES.join("|")})\\s*\\(\\s*[{"']`
);

const VARIANTS = ["brut", "actuel", "repli"];

/**
 * Classe un premier tour. Renvoie l'une des catégories :
 * bon-outil, autre-outil, refus, appel-en-texte, ambigu (tâches) ;
 * ok-sans-outil, outil-inutile (questions de contrôle).
 */
function classify(question, turn) {
    const calls = Array.isArray(turn?.toolCalls) ? turn.toolCalls : [];
    const text = String(turn?.text || "");

    if (!question.expected.length) return calls.length ? "outil-inutile" : "ok-sans-outil";
    if (calls.length) {
        return calls.some(call => question.expected.includes(call.name)) ? "bon-outil" : "autre-outil";
    }
    if (TEXT_CALL_RE.test(text)) return "appel-en-texte";
    if (REFUSAL_RE.test(text)) return "refus";
    return "ambigu";
}

/** Insère la phrase de repli juste avant les notes techniques (sinon en tête du message). */
function withRepli(message) {
    const marker = "Notes techniques sur les outils";
    const at = message.indexOf(marker);
    return at === -1 ? `${REPLI}\n\n${message}` : `${message.slice(0, at)}${REPLI}\n${message.slice(at)}`;
}

/** Résumé par modèle × variante : effectifs et taux (en %). */
function summarize(rows) {
    const groups = new Map();
    for (const row of rows) {
        const key = `${row.model}\u0000${row.variant}`;
        if (!groups.has(key)) groups.set(key, { model: row.model, variant: row.variant, rows: [] });
        groups.get(key).rows.push(row);
    }

    const pct = (n, d) => (d ? Math.round((100 * n) / d) : null);
    return [...groups.values()].map(({ model, variant, rows: list }) => {
        const tasks = list.filter(r => !r.control && r.category !== "erreur");
        const controls = list.filter(r => r.control && r.category !== "erreur");
        const count = (set, category) => set.filter(r => r.category === category).length;
        const withTool = count(tasks, "bon-outil") + count(tasks, "autre-outil");
        return {
            model,
            variant,
            requetes: list.length,
            erreurs: count(list, "erreur"),
            outil: pct(withTool, tasks.length),
            bonOutil: pct(count(tasks, "bon-outil"), tasks.length),
            refus: pct(count(tasks, "refus"), tasks.length),
            appelEnTexte: pct(count(tasks, "appel-en-texte"), tasks.length),
            ambigu: pct(count(tasks, "ambigu"), tasks.length),
            outilInutile: pct(count(controls, "outil-inutile"), controls.length)
        };
    });
}

function parseArgs(argv) {
    const args = { run: false, incognito: true, repeat: 1, delay: 500, models: null, variants: VARIANTS, questions: null };
    for (const arg of argv) {
        const [key, value = ""] = arg.replace(/^--/, "").split("=");
        const list = () => value.split(",").map(s => s.trim()).filter(Boolean);
        if (key === "run") args.run = true;
        else if (key === "no-incognito") args.incognito = false;
        else if (key === "repeat") args.repeat = Math.max(1, Number.parseInt(value, 10) || 1);
        else if (key === "delay") args.delay = Math.max(0, Number.parseInt(value, 10) || 0);
        else if (key === "models") args.models = list();
        else if (key === "variants") args.variants = list();
        else if (key === "questions") args.questions = list();
        else throw new Error(`Option inconnue : ${arg}`);
    }
    const unknown = args.variants.filter(v => !VARIANTS.includes(v));
    if (unknown.length) throw new Error(`Variante(s) inconnue(s) : ${unknown.join(", ")}`);
    return args;
}

function gitCommit() {
    try {
        return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    } catch {
        return null;
    }
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function printTable(summary) {
    const show = v => (v === null ? "—" : `${v} %`);
    console.log("\nModèle        Variante  Req.  Err.  Outil  Bon outil  Refus  En texte  Ambigu  Outil inutile");
    for (const s of summary) {
        console.log(
            `${s.model.padEnd(20)} ${s.variant.padEnd(9)} ${String(s.requetes).padStart(4)}  ${String(s.erreurs).padStart(4)}  ` +
            `${show(s.outil).padStart(5)}  ${show(s.bonOutil).padStart(9)}  ${show(s.refus).padStart(5)}  ` +
            `${show(s.appelEnTexte).padStart(8)}  ${show(s.ambigu).padStart(6)}  ${show(s.outilInutile).padStart(13)}`
        );
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    // Chargement différé : les tests importent classify/summarize sans toucher à l'API.
    const { state } = require("../src/state");
    const api = require("../src/api/api");
    const chat = require("../src/core/chat");
    const registry = require("../src/tools/registry");
    const { listAgents, resolveAgent } = require("../src/api/agents");
    const { loadSession } = require("../src/api/auth");

    const questions = args.questions ? QUESTIONS.filter(q => args.questions.includes(q.id)) : QUESTIONS;
    if (!questions.length) throw new Error("Aucune question sélectionnée.");

    if (args.run) await loadSession();
    // En mode réel, la liste de l'API peut contenir plus de modèles que la simulation
    // (qui n'a pas de session) : on exige une liste explicite pour maîtriser le quota.
    if (args.run && !args.models) {
        throw new Error("--run exige --models=... (liste explicite, pour maîtriser le quota).");
    }
    const { agents } = await listAgents();
    const queries = args.models || agents.filter(a => /gpt/i.test(`${a.name} ${a.model}`)).map(a => String(a.id));
    const models = queries.map(query => {
        const { agent, matches } = resolveAgent(query, agents);
        if (!agent) throw new Error(`Modèle introuvable ou ambigu : ${query} (${matches.length} correspondance(s))`);
        return agent;
    });
    if (!models.length) throw new Error("Aucun modèle sélectionné (utilise --models=...).");

    // Messages construits une fois par question et variante, comme un vrai premier message.
    state.workspace = ROOT;
    const messages = new Map();
    for (const question of questions) {
        state.chatId = null;
        state.compactSummary = null;
        const actual = await chat.buildMessage(question.text);
        messages.set(`${question.id}:brut`, question.text);
        messages.set(`${question.id}:actuel`, actual);
        messages.set(`${question.id}:repli`, withRepli(actual));
    }

    const total = models.length * args.variants.length * questions.length * args.repeat;
    console.log(`Modèles : ${models.map(m => `${m.name} (${m.id})`).join(", ")}`);
    console.log(`Variantes : ${args.variants.join(", ")} ; questions : ${questions.length} ; répétitions : ${args.repeat}`);
    console.log(`Requêtes prévues : ${total}`);

    if (!args.run) {
        const sample = messages.get(`${questions[0].id}:actuel`);
        console.log(`\nSimulation : aucune requête envoyée. Ajoute --run pour lancer le banc.`);
        console.log(`Exemple de premier message (variante actuel, ${sample.length} caractères) :\n`);
        console.log(sample.length > 1500 ? `${sample.slice(0, 1500)}\n… [coupé]` : sample);
        return;
    }

    state.incognito = args.incognito;
    const rows = [];
    let done = 0;

    outer:
    for (const model of models) {
        for (const variant of args.variants) {
            for (const question of questions) {
                for (let repeat = 1; repeat <= args.repeat; repeat++) {
                    done++;
                    const row = {
                        model: model.name, modelId: model.id, variant, question: question.id,
                        control: !question.expected.length, repeat
                    };
                    try {
                        const turn = await api.requestTurn(messages.get(`${question.id}:${variant}`), {
                            agentId: model.id,
                            fresh: true,
                            clientTools: registry.CLIENT_TOOLS,
                            onInterrupt: () => null
                        });
                        row.category = classify(question, turn);
                        row.tools = (turn.toolCalls || []).map(call => call.name);
                        row.text = String(turn.text || "").slice(0, 600);
                    } catch (error) {
                        row.category = "erreur";
                        row.error = error.message;
                        // Quota épuisé : inutile de continuer.
                        if (error.status === 429) {
                            rows.push(row);
                            console.log(`\n[${done}/${total}] quota épuisé, arrêt du banc : ${error.message}`);
                            break outer;
                        }
                    }
                    rows.push(row);
                    console.log(`[${done}/${total}] ${model.name} | ${variant} | ${question.id} #${repeat} -> ${row.category}`);
                    if (args.delay) await pause(args.delay);
                }
            }
        }
    }

    const summary = summarize(rows);
    printTable(summary);

    const dir = path.join(ROOT, "bench-results");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    const meta = { date: new Date().toISOString(), commit: gitCommit(), args, questions };
    await fs.writeFile(file, JSON.stringify({ meta, summary, rows }, null, 2), "utf8");
    console.log(`\nRésultats détaillés : ${path.relative(ROOT, file)}`);
    console.log("Les réponses « ambigu » sont à relire à la main dans ce fichier.");
}

if (require.main === module) {
    main()
        .then(() => process.exit(process.exitCode || 0))
        .catch(error => {
            console.error("Échec du banc d'essai :", error && error.message ? error.message : error);
            process.exit(1);
        });
}

module.exports = { QUESTIONS, VARIANTS, REPLI, classify, withRepli, summarize, parseArgs };
