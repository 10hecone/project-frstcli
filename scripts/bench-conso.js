"use strict";

/**
 * Banc de consommation : sessions complètes (boucle d'outils exécutée) dans UNE conversation
 * par session, sur une copie jetable du dépôt (git worktree). Compare « avant » et « après »
 * les optimisations, modèle par modèle.
 *
 * Usage :
 *   node scripts/bench-conso.js     simulation : plan, AUCUNE requête
 *   node scripts/bench-conso.js --list-models     modèles disponibles (aucun chat créé)
 *   node scripts/bench-conso.js --run --models=<m> --variant=avant|apres [--repeat=n]
 *   node scripts/bench-conso.js --report          tableau à partir des fichiers conso-*.json
 *
 * Quota : 1 session = 1 nouvelle conversation (limite observée : 50 par jour, incognito compris).
 * --variant fixe FS_OPTIM (avant = 0, apres = 1) avant le chargement du code : les optimisations
 * doivent lire cette variable pour être désactivables sur le même commit.
 *
 * Sécurité : les tâches tournent dans un worktree temporaire (dossier système), supprimé à la fin.
 * Le dépôt de travail n'est jamais modifié. Confirmations acceptées automatiquement, uniquement
 * dans ce worktree. L'historique local des conversations n'est pas mis à jour.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const RESULTS_DIR = path.join(ROOT, "bench-results");
const VARIANTS = ["avant", "apres"];

// Bug injecté avant la tâche « corriger » : collapseRepeats marque aussi les lignes uniques « [x1] ».
const BUG = {
    file: "src/tools/command/output.js",
    from: "out.push(count > 1 ? `${previous} [x${count}]` : previous);",
    to: "out.push(count >= 1 ? `${previous} [x${count}]` : previous);",
    test: "test/command-output.test.js"
};

/**
 * Tâches enchaînées dans la même conversation. check(ctx) vérifie la réussite :
 * réponse attendue et/ou état du worktree. Les tâches 5 et 6 portent sur le même fichier
 * (relecture possible au tour suivant).
 */
const TASKS = [
    {
        id: "version",
        text: "lis package.json et dis-moi la version du projet",
        check: ({ response, pkg }) => response.includes(pkg.version)
    },
    {
        id: "commit",
        text: "quel est le dernier commit du dépôt ? donne son hash court et son message",
        check: ({ response, head }) => response.includes(head.slice(0, 7))
    },
    {
        id: "corriger",
        text: `le test ${BUG.test} échoue : trouve pourquoi et corrige le code (ne modifie pas le test)`,
        check: ({ worktree }) => testPasses(worktree) && !gitChanged(worktree, BUG.test)
    },
    {
        id: "lint",
        text: "ajoute un script npm « lint » qui lance scripts/check-indent.js",
        check: ({ worktree }) => {
            const scripts = readJson(path.join(worktree, "package.json"))?.scripts ?? {};
            return /check-indent\.js/.test(scripts.lint ?? "");
        }
    },
    {
        id: "chat-total",
        text: "dans src/core/chat.js, quelle est la limite totale de caractères des résultats d'outils par envoi, et à quoi sert fitOutputs ?",
        check: ({ response }) => /120[\s\u202f.,]?000/.test(response)
    },
    {
        id: "chat-unitaire",
        text: "et dans ce même fichier, quelle est la limite par résultat ?",
        check: ({ response }) => /40[\s\u202f.,]?000/.test(response)
    }
];

// ---------------------------------------------------------------------------
// Arguments et utilitaires
// ---------------------------------------------------------------------------

function parseArgs(argv) {
    const args = { run: false, list: false, report: false, models: null, variant: null, repeat: 1, delay: 2000, incognito: true };
    for (const arg of argv) {
        const [key, value = ""] = arg.replace(/^--/, "").split("=");
        if (key === "run") args.run = true;
        else if (key === "list-models") args.list = true;
        else if (key === "report") args.report = true;
        else if (key === "no-incognito") args.incognito = false;
        else if (key === "models") args.models = value.split(",").map(s => s.trim()).filter(Boolean);
        else if (key === "variant") args.variant = value;
        else if (key === "repeat") args.repeat = Math.max(1, Number.parseInt(value, 10) || 1);
        else if (key === "delay") args.delay = Math.max(0, Number.parseInt(value, 10) || 0);
        else throw new Error(`Option inconnue : ${arg}`);
    }
    if (args.variant !== null && !VARIANTS.includes(args.variant)) {
        throw new Error(`Variante inconnue : ${args.variant} (${VARIANTS.join(" ou ")}).`);
    }
    if (args.run && (!args.models || !args.variant)) {
        throw new Error("--run exige --models=... et --variant=avant|apres (pour maîtriser le quota).");
    }
    return args;
}

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return null;
    }
}

function git(args, cwd = ROOT) {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gitChanged(worktree, file) {
    try {
        return git(["status", "--porcelain", "--", file], worktree) !== "";
    } catch {
        return true;
    }
}

function testPasses(worktree) {
    const result = spawnSync(process.execPath, ["--test", BUG.test], { cwd: worktree, encoding: "utf8", timeout: 120_000 });
    return result.status === 0;
}

/** Copie jetable du dépôt (HEAD, détachée), avec le bug injecté. */
function createWorktree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frst-conso-"));
    fs.rmdirSync(dir);
    git(["worktree", "add", "--detach", dir, "HEAD"]);
    const file = path.join(dir, BUG.file);
    const source = fs.readFileSync(file, "utf8");
    if (!source.includes(BUG.from)) throw new Error(`Injection du bug impossible : ligne introuvable dans ${BUG.file}.`);
    fs.writeFileSync(file, source.replace(BUG.from, BUG.to), "utf8");
    if (testPasses(dir)) throw new Error("Le bug injecté ne fait pas échouer le test : banc invalide.");
    return dir;
}

function removeWorktree(dir) {
    try {
        git(["worktree", "remove", "--force", dir]);
    } catch (error) {
        console.warn(`Worktree non supprimé (${dir}) : ${error.message}`);
    }
}

/** Interface silencieuse : confirmations acceptées (worktree jetable uniquement). */
function benchUi(log) {
    const quiet = (...parts) => log.push(parts.map(String).join(" "));
    return {
        info: quiet, warn: quiet, error: quiet, debug() {}, print: quiet, assistant() {}, plan() {},
        tool: (name, detail) => log.push(`> ${name} ${detail ?? ""}`),
        result() {}, commandLine() {}, banner() {}, prompt() {}, clear() {}, todos() {}, subagents() {},
        diff: data => ({ added: data?.added ?? 0, removed: data?.removed ?? 0 }),
        stream: () => ({ write() {}, end() {} }),
        spinner: () => ({ stop() {}, update() {} }),
        confirm: async () => true,
        askCommand: async () => "o",
        ask: async () => "",
        askSecret: async () => "",
        onInterrupt: () => () => {}
    };
}

/**
 * Estimation du contexte relu par le modèle (l'API ne renvoie pas toujours l'usage en tokens).
 * La conversation est conservée côté serveur : chaque requête relit tout l'historique.
 * history = caractères déjà dans la conversation (envois + appels d'outils + réponses) ;
 * processed = somme, sur les requêtes, de l'historique au moment de la requête.
 */
function installMeter(usage) {
    const meter = { history: 0, processed: 0 };
    let chars = usage.chars;
    Object.defineProperty(usage, "chars", {
        configurable: true,
        enumerable: true,
        get: () => chars,
        set: value => {
            meter.history += value - chars;
            meter.processed += meter.history;
            chars = value;
        }
    });
    return meter;
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const mean = list => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

// ---------------------------------------------------------------------------
// Une session
// ---------------------------------------------------------------------------

async function runSession({ model, variant, repeat, incognito }) {
    const { state, resetConversation } = require("../src/state");
    const api = require("../src/api/api");
    const chat = require("../src/core/chat");
    const memory = require("../src/project/memory");
    const permissionsMode = require("../src/core/permissions-mode");

    const worktree = createWorktree();
    const session = { model: model.name, modelId: model.id, variant, repeat, worktree, tasks: [] };
    const context = {
        worktree,
        pkg: readJson(path.join(worktree, "package.json")),
        head: git(["rev-parse", "--short=12", "HEAD"], worktree)
    };

    const meter = installMeter(api.usage);

    try {
        // Ouverture directe (sans workspace.open) : pas d'entrée dans projects.json.
        state.workspace = fs.realpathSync(worktree);
        resetConversation();
        await memory.open(state.workspace);
        permissionsMode.set("default");
        state.model = model.id;
        state.incognito = incognito;
        state.private = true;
        state.webSearch = false;

        for (const task of TASKS) {
            const before = { ...api.usage };
            const contextBefore = meter.processed;
            const started = Date.now();
            const tools = [];
            const row = { id: task.id };
            try {
                const { response } = await chat.send(task.text, {
                    onToolCalls: calls => {
                        tools.push(...calls.map(call => call.name));
                        meter.history += JSON.stringify(calls).length;
                    }
                });
                meter.history += response.length;
                row.ok = Boolean(task.check({ ...context, response }));
                row.response = response.slice(0, 800);
            } catch (error) {
                row.ok = false;
                row.error = error.message;
                if (error.status === 429) session.quota = true;
            }
            row.ms = Date.now() - started;
            row.requests = api.usage.requests - before.requests;
            row.chars = api.usage.chars - before.chars;
            row.context = meter.processed - contextBefore;
            row.inputTokens = api.usage.inputTokens - before.inputTokens;
            row.cachedTokens = api.usage.cachedTokens - before.cachedTokens;
            row.outputTokens = api.usage.outputTokens - before.outputTokens;
            row.reported = api.usage.reported - before.reported;
            row.tools = tools;
            session.tasks.push(row);
            console.log(
                `  ${task.id.padEnd(14)} ${row.ok ? "réussi" : "ÉCHEC "} ${String(row.requests).padStart(2)} req. ` +
                `${String(row.chars).padStart(7)} car. envoyés ${String(row.context).padStart(8)} car. contexte` +
                `${row.reported ? ` ${row.inputTokens} tok. entrée (${row.cachedTokens} cache) ${row.outputTokens} sortie` : ""}` +
                ` ${(row.ms / 1000).toFixed(0).padStart(4)} s` +
                `${row.error ? ` | ${row.error.slice(0, 120)}` : ""}`
            );
            if (session.quota) break;
        }
        session.chatId = state.chatIds.chat;
    } finally {
        memory.close?.();
        state.workspace = null;
        removeWorktree(worktree);
    }
    return session;
}

// ---------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------

function totals(session) {
    const sum = key => session.tasks.reduce((n, t) => n + (t[key] || 0), 0);
    return {
        requests: sum("requests"),
        chars: sum("chars"),
        context: sum("context"),
        inputTokens: sum("inputTokens"),
        cachedTokens: sum("cachedTokens"),
        outputTokens: sum("outputTokens"),
        ms: sum("ms"),
        ok: session.tasks.filter(t => t.ok).length,
        tasks: session.tasks.length,
        complete: session.tasks.length === TASKS.length && session.tasks.every(t => t.reported === t.requests)
    };
}

/** Moyennes par modèle × variante (sessions complètes seulement). */
function summarize(sessions) {
    const groups = new Map();
    for (const s of sessions) {
        const key = `${s.model}\u0000${s.variant}`;
        if (!groups.has(key)) groups.set(key, { model: s.model, variant: s.variant, list: [] });
        groups.get(key).list.push(totals(s));
    }
    return [...groups.values()].map(({ model, variant, list }) => {
        const full = list.filter(t => t.tasks === TASKS.length);
        const avg = key => mean(full.map(t => t[key]));
        const spread = key => {
            const values = full.map(t => t[key]);
            return values.length ? [Math.min(...values), Math.max(...values)] : null;
        };
        return {
            model, variant, sessions: full.length,
            requests: avg("requests"), context: avg("context"), contextRange: spread("context"),
            inputTokens: avg("inputTokens"), inputRange: spread("inputTokens"),
            cachedTokens: avg("cachedTokens"), outputTokens: avg("outputTokens"),
            chars: avg("chars"), seconds: avg("ms") === null ? null : avg("ms") / 1000,
            success: full.length ? full.reduce((n, t) => n + t.ok, 0) / (full.length * TASKS.length) : null,
            usageReported: full.every(t => t.complete)
        };
    });
}

function printSummary(summary) {
    const n = v => (v === null || v === undefined ? "—" : Math.round(v).toLocaleString("fr-FR"));
    console.log("\nModèle        Variante  Sess.  Req.  Car. envoyés  Contexte cumulé (min–max)     Durée  Réussite");
    for (const s of summary) {
        const range = s.contextRange ? `(${n(s.contextRange[0])}–${n(s.contextRange[1])})` : "";
        console.log(
            `${s.model.padEnd(20)} ${s.variant.padEnd(9)} ${String(s.sessions).padStart(5)}  ${n(s.requests).padStart(4)}  ` +
            `${n(s.chars).padStart(12)}  ${n(s.context).padStart(10)} ${range.padEnd(23)} ${n(s.seconds).padStart(4)} s  ` +
            `${s.success === null ? "—" : `${Math.round(s.success * 100)} %`}`
        );
        if (s.usageReported && s.sessions) {
            console.log(`${"".padEnd(31)}tokens : ${n(s.inputTokens)} entrée (${n(s.cachedTokens)} cache), ${n(s.outputTokens)} sortie`);
        }
    }
}

function report() {
    const files = fs.existsSync(RESULTS_DIR)
        ? fs.readdirSync(RESULTS_DIR).filter(f => /^conso-.*\.json$/.test(f)).sort()
        : [];
    const sessions = files.flatMap(f => readJson(path.join(RESULTS_DIR, f))?.sessions ?? []);
    if (!sessions.length) {
        console.log("Aucun résultat conso-*.json dans bench-results.");
        return;
    }
    console.log(`${sessions.length} session(s) dans ${files.length} fichier(s).`);
    printSummary(summarize(sessions));
}

// ---------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.report) return report();

    // Avant tout chargement du code mesuré.
    if (args.variant) process.env.FS_OPTIM = args.variant === "apres" ? "1" : "0";

    const { setUiBackend } = require("../src/ui-bridge");
    const log = [];
    setUiBackend(benchUi(log));
    require("../src/project/conversations").touch = async () => {};

    const { loadSession } = require("../src/api/auth");
    const { listAgents, resolveAgent } = require("../src/api/agents");

    if (args.list) {
        await loadSession();
        const { agents, source } = await listAgents({ refresh: true });
        console.log(`Modèles (${source}) :`);
        for (const a of agents) console.log(`  ${String(a.id).padStart(6)}  ${a.name}${a.model ? `  [${a.model}]` : ""}`);
        return;
    }

    const sessionsPlanned = (args.models?.length ?? 2) * args.repeat;
    console.log(`Tâches par session : ${TASKS.map(t => t.id).join(", ")}`);
    console.log(`Sessions prévues : ${sessionsPlanned} (= ${sessionsPlanned} nouvelle(s) conversation(s) sur le quota quotidien)`);
    if (!args.run) {
        console.log("\nSimulation : aucune requête envoyée. Ajoute --run --models=... --variant=avant|apres.");
        return;
    }

    await loadSession();
    const { agents } = await listAgents({ refresh: true });
    const models = args.models.map(query => {
        const { agent, matches } = resolveAgent(query, agents);
        if (!agent) throw new Error(`Modèle introuvable ou ambigu : ${query} (${matches.map(m => m.name).join(", ") || "aucun"})`);
        return agent;
    });

    const sessions = [];
    outer:
    for (let repeat = 1; repeat <= args.repeat; repeat++) {
        for (const model of models) {
            console.log(`\n${model.name} | ${args.variant} | session ${repeat}/${args.repeat}`);
            const session = await runSession({ model, variant: args.variant, repeat, incognito: args.incognito });
            session.log = log.splice(0).slice(-300);
            sessions.push(session);
            if (session.quota) {
                console.log("Quota épuisé : arrêt du banc.");
                break outer;
            }
            if (args.delay) await pause(args.delay);
        }
    }

    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const file = path.join(RESULTS_DIR, `conso-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    let commit = null;
    try { commit = git(["rev-parse", "--short", "HEAD"]); } catch { /* hors dépôt */ }
    const meta = { date: new Date().toISOString(), commit, dirty: git(["status", "--porcelain", "--", "src"]) !== "", args };
    fs.writeFileSync(file, JSON.stringify({ meta, sessions }, null, 2), "utf8");
    printSummary(summarize(sessions));
    console.log(`\nRésultats détaillés : ${path.relative(ROOT, file)} (tableau global : --report)`);
}

if (require.main === module) {
    main()
        .then(() => process.exit(process.exitCode || 0))
        .catch(error => {
            console.error("Échec du banc de consommation :", error?.message ?? error);
            process.exit(1);
        });
}

module.exports = { TASKS, BUG, VARIANTS, parseArgs, summarize, totals };
