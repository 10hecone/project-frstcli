"use strict";

const { CONFIG } = require("../config");
const { state, record, activateConversation } = require("../state");
const { ui, c } = require("../cli/ui");
const api = require("../api/api");
const memory = require("../project/memory");
const conversations = require("../project/conversations");
const projectContext = require("../project/project-context");
const { buildAgentPrompt } = require("./prompt");
const {
    TOOLS,
    validateToolCall,
    describeCall,
    summarizeResult,
    readFile,
    listDirectory
} = require("../tools/tools");
const { execFile } = require("node:child_process");

function git(args, cwd) {
    return new Promise(resolve => {
        execFile("git", args, { cwd, timeout: 3000, windowsHide: true }, (error, stdout) => {
            resolve(error ? null : String(stdout).trim());
        });
    });
}

/** Indices concrets sur le terminal, comme le bloc <env> de Claude Code. */
async function detectEnvironment(workspace) {
    const inside = await git(["rev-parse", "--is-inside-work-tree"], workspace);
    const branch = inside === "true" ? await git(["branch", "--show-current"], workspace) : null;

    return {
        git: inside === "true",
        branch,
        node: process.version,
        shell: process.platform === "win32"
            ? (process.env.PSModulePath ? "PowerShell" : "cmd")
            : (process.env.SHELL || null)
    };
}

const fmt = n => Number(n).toLocaleString("fr-FR");

function clip(text, max) {
    const value = String(text);
    return value.length <= max ? value : `${value.slice(0, max)}\n... [tronqué]`;
}

/* ---------- Analyse de la réponse du modèle ---------- */

function extractJsonObject(text) {
    const raw = String(text).trim();
    const candidates = [raw];

    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced) candidates.push(fenced[1].trim());

    for (const start of [...raw.matchAll(/\{/g)].map(m => m.index)) {
        let depth = 0;
        let inString = false;
        let escaped = false;

        for (let i = start; i < raw.length; i++) {
            const ch = raw[i];

            if (inString) {
                if (escaped) escaped = false;
                else if (ch === "\\") escaped = true;
                else if (ch === '"') inString = false;
                continue;
            }

            if (ch === '"') inString = true;
            else if (ch === "{") depth++;
            else if (ch === "}") {
                depth--;

                if (depth === 0) {
                    candidates.push(raw.slice(start, i + 1));
                    break;
                }
            }
        }
    }

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);

            if (
                parsed &&
                typeof parsed === "object" &&
                !Array.isArray(parsed) &&
                (parsed.type === "tool" || parsed.type === "final")
            ) {
                return parsed;
            }
        } catch {
            // candidat suivant
        }
    }

    return null;
}

function parseAgentResponse(text) {
    const action = extractJsonObject(text);

    if (!action) {
        throw new Error('Aucun objet JSON {"type":"tool"|"final"} trouvé.');
    }

    if (action.type === "final") {
        if (typeof action.message !== "string") {
            throw new Error("message doit être une chaîne.");
        }
        return action;
    }

    validateToolCall(action);

    if (action.plan !== undefined) {
        action.plan = Array.isArray(action.plan)
            ? action.plan.filter(item => typeof item === "string").slice(0, 8)
            : undefined;
    }

    action.reason = typeof action.reason === "string"
        ? action.reason.trim().slice(0, 200)
        : undefined;

    return action;
}

/* ---------- Prompt ---------- */

/** Construit le prompt en retirant les observations les plus anciennes si besoin. */
function fitPrompt(context) {
    let observations = context.observations.slice(-CONFIG.maxObservationsInPrompt);
    let prompt = buildAgentPrompt({ ...context, observations });

    while (prompt.length > CONFIG.messageBudget && observations.length > 1) {
        observations = observations.slice(1);
        prompt = buildAgentPrompt({ ...context, observations });
    }

    if (prompt.length > CONFIG.messageBudget) {
        throw new Error(
            `Contexte trop volumineux pour la limite de ${fmt(CONFIG.messageBudget)} caractères.`
        );
    }

    return prompt;
}

/** Ne garde dans l'historique des résultats que l'essentiel des arguments. */
function recordArgs(args) {
    const copy = { ...args };

    for (const key of ["content", "old_string", "new_string"]) {
        if (typeof copy[key] === "string") copy[key] = `<${copy[key].length} caractères>`;
    }

    return copy;
}

/* ---------- Pré-chargement ---------- */

async function preloadContext(task, observations) {
    const mentioned = [
        ...new Set(
            (task.match(/[\w@.\-\/\\]+\.[A-Za-z0-9]{1,6}(?![\w])/g) || [])
                .map(p => p.replace(/^[.\\/]+(?=[^.\\/])/, ""))
        )
    ].slice(0, CONFIG.maxPreloadFiles);

    for (const file of mentioned) {
        try {
            const result = await readFile({ path: file });

            ui.tool("read_file", file);
            ui.result(summarizeResult("read_file", result));

            observations.push({ tool: "read_file", args: { path: file }, ok: true, result });
        } catch {
            // Pas un fichier lisible : le modèle décidera.
        }
    }

    if (!observations.length) {
        try {
            const result = await listDirectory({ path: "." });

            ui.tool("list_directory", ".");
            ui.result(summarizeResult("list_directory", result));

            observations.push({ tool: "list_directory", args: { path: "." }, ok: true, result });
        } catch {
            // ignoré
        }
    }
}

/* ---------- Repli : réponse en texte simple (lecture seule) ---------- */

async function fallbackPlainAnswer(task, observations) {
    ui.warn(
        "Le modèle ne respecte pas le protocole d'outils : mode texte simple (lecture seule)."
    );

    const readFiles = observations.filter(o => o.tool === "read_file" && o.result);

    const perFile = Math.floor(
        (CONFIG.messageBudget - clip(task, 50_000).length - 5_000) /
        Math.max(1, readFiles.length)
    );

    const files = readFiles
        .map(o => `--- ${o.result.path} ---\n${clip(o.result.content, perFile)}`)
        .join("\n\n");

    const listing = observations
        .filter(o => o.tool === "list_directory" && o.result)
        .map(o => o.result.entries.map(e => `${e.type}: ${e.path}`).join("\n"))
        .join("\n");

    const prompt =
        "Tu es un assistant de programmation. Réponds en français, de façon claire " +
        "et concise, à la demande ci-dessous en te basant UNIQUEMENT sur les fichiers " +
        "fournis. Réponds directement, sans JSON.\n\n" +
        `Demande : ${clip(task, 50_000)}\n\n` +
        (files ? `Fichiers :\n${files}\n\n` : "") +
        (listing ? `Contenu du dossier :\n${listing}\n` : "");

    const spin = ui.spinner("Analyse");

    try {
        const answer = await api.requestModel(prompt, { conversationMode: "agent" });
        spin.stop();
        ui.assistant(answer.trim());
        record("assistant", answer.trim());
    } finally {
        spin.stop();
    }
}

/* ---------- Boucle agent ---------- */

async function runAgent(task) {
    activateConversation("agent");
    if (task.length > CONFIG.messageBudget / 2) {
        throw new Error(
            `Demande trop longue : ${fmt(task.length)} caractères ` +
            `(limite ${fmt(CONFIG.maxMessageChars)} par message).`
        );
    }

    const observations = [];
    const changesBefore = memory.sessionChanges();
    const signatures = new Map();
    const projectText = projectContext.promptContext(CONFIG.agentContextChars);
    const env = await detectEnvironment(state.workspace);

    let planShown = false;
    let stuck = 0;

    async function saveConversation() {
        if (!state.chatIds.agent) return;

        const settings = {
            model: state.model,
            webSearch: state.webSearch,
            private: state.private,
            incognito: state.incognito,
            autoApprove: state.autoApprove,
        };

        state.conversationSettings.agent = settings;
        await conversations.touch({
            id: state.chatIds.agent,
            firstMessage: task,
            model: state.model,
            workspace: state.workspace,
            mode: "agent",
            settings,
        });
    }

    async function finish(message) {
        ui.assistant(message);
        record("user", task);
        record("assistant", message);
        await saveConversation();

        const changed = memory.sessionChanges() - changesBefore;

        if (changed > 0) {
            ui.info(
                `${changed} modification(s) enregistrée(s) | /undo annule la dernière | /changes en liste l'historique`
            );
        }
    }

    await preloadContext(task, observations);

    for (let turn = 1; turn <= CONFIG.maxAgentTurns; turn++) {
        let action = null;
        let correction = null;
        let lastResponse = "";

        const spin = ui.spinner(turn === 1 ? "Réflexion" : `Réflexion (tour ${turn})`);

        try {
            for (let attempt = 1; attempt <= CONFIG.maxProtocolAttempts; attempt++) {
                const prompt = fitPrompt({
                    workspace: state.workspace,
                    env,
                    task,
                    history: state.history.slice(-6),
                    memorySummary: memory.summary(),
                    projectContext: projectText,
                    observations,
                    turn,
                    maxTurns: CONFIG.maxAgentTurns,
                    correction
                });

                lastResponse = await api.requestModel(prompt, { conversationMode: "agent" });

                try {
                    action = parseAgentResponse(lastResponse);
                    break;
                } catch (error) {
                    ui.debug(
                        `Réponse invalide (${attempt}/${CONFIG.maxProtocolAttempts}) : ` +
                        `${error.message}\n${lastResponse.slice(0, 400)}`
                    );

                    correction = {
                        error: error.message,
                        previousResponse: lastResponse.slice(0, 300)
                    };
                }
            }
        } finally {
            spin.stop();
        }

        if (!action) {
            record("user", task);
            await fallbackPlainAnswer(task, observations);
            await saveConversation();
            return;
        }

        if (action.type === "final") {
            await finish(action.message);
            return;
        }

        if (action.plan?.length && !planShown) {
            ui.plan(action.plan);
            planShown = true;
        }

        if (action.reason) ui.info(action.reason);

        ui.tool(action.name, describeCall(action));

        const recorded = recordArgs(action.args);
        const signature = `${action.name}:${JSON.stringify(action.args)}`;
        const seen = (signatures.get(signature) || 0) + 1;

        signatures.set(signature, seen);

        // Garde-fou : la même action répétée en boucle n'est plus exécutée.
        if (seen >= 3) {
            stuck++;
            ui.result(c.red("Action répétée : ignorée"));

            observations.push({
                tool: action.name,
                args: recorded,
                ok: false,
                error: "Action déjà exécutée plusieurs fois avec les mêmes arguments. Change de démarche ou termine avec final."
            });

            if (stuck >= 2) {
                await finish("Je tourne en rond : j'arrête ici. Précise ta demande ou le fichier concerné.");
                return;
            }

            continue;
        }

        try {
            const result = await TOOLS[action.name].run(action.args);

            ui.result(summarizeResult(action.name, result));

            observations.push({
                tool: action.name,
                args: recorded,
                ok: !result.denied,
                result
            });
        } catch (error) {
            ui.result(c.red(error.message));

            observations.push({
                tool: action.name,
                args: recorded,
                ok: false,
                error: error.message
            });
        }
    }

    const message =
        "Limite de tours atteinte. Les modifications déjà confirmées restent enregistrées (/undo pour les annuler).";

    ui.warn(message);
    record("user", task);
    record("assistant", message);
    await saveConversation();
}

module.exports = { runAgent, parseAgentResponse, extractJsonObject, fitPrompt };
