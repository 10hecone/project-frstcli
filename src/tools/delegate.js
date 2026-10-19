"use strict";

const { MAX_JOBS } = require("./command/jobs");

// Nombre maximal de sous-agents lancés en même temps (même limite que les jobs).
const MAX_SUBAGENTS = MAX_JOBS;

// Longueur maximale d'une consigne envoyée à un sous-agent.
const MAX_TASK_CHARS = 2000;

// Sous-agents en cours, tous appels de delegate confondus.
let running = 0;

/** Valide et normalise la liste de consignes (1 à MAX_SUBAGENTS chaînes non vides). */
function normalizeTasks(tasks) {
    if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > MAX_SUBAGENTS) {
        throw new Error(`tasks doit être une liste de 1 à ${MAX_SUBAGENTS} consignes.`);
    }

    return tasks.map((task, index) => {
        if (typeof task !== "string" || !task.trim()) {
            throw new Error(`tasks[${index}] doit être un texte non vide.`);
        }
        if (task.length > MAX_TASK_CHARS) {
            throw new Error(`tasks[${index}] : ${MAX_TASK_CHARS} caractères au maximum.`);
        }
        return task.trim();
    });
}

/**
 * Lance un sous-agent en lecture seule par consigne, en parallèle, et renvoie leurs résumés.
 * L'échec d'un sous-agent n'empêche pas les autres de terminer.
 */
async function delegateTool(args = {}, options = {}) {
    const tasks = normalizeTasks(args.tasks);

    if (running + tasks.length > MAX_SUBAGENTS) {
        throw new Error(
            `Déjà ${running} sous-agent(s) en cours (maximum ${MAX_SUBAGENTS}). Attends leur fin.`
        );
    }

    // Chargement paresseux : subagent.js dépend du registre des outils.
    const { runSubagent } = require("../agent/subagent");

    running += tasks.length;

    let settled;
    try {
        settled = await Promise.allSettled(
            tasks.map((task, index) => Promise.resolve().then(() => runSubagent({
                task,
                signal: options.signal,
                onTurn: typeof options.onTurn === "function"
                    ? info => options.onTurn({ index, task, ...info })
                    : undefined
            })))
        );
    } finally {
        running -= tasks.length;
    }

    const results = settled.map((outcome, index) => {
        const task = tasks[index];

        if (outcome.status === "rejected") {
            const message = outcome.reason?.message ?? String(outcome.reason);
            return { task, ok: false, status: "error", summary: "", turns: 0, error: message };
        }

        const out = outcome.value;
        const item = {
            task,
            ok: out.status === "done",
            status: out.status,
            summary: out.summary,
            turns: out.turns
        };
        if (out.error !== undefined) item.error = out.error;
        return item;
    });

    const done = results.filter(r => r.ok).length;

    return {
        results,
        changed: false,
        message: `Sous-agents : ${done} terminé(s) sur ${results.length}.`
    };
}

function check(args) {
    normalizeTasks(args.tasks);
}

function describe(a) {
    const n = Array.isArray(a.tasks) ? a.tasks.length : 0;
    return `${n} sous-agent(s)`;
}

module.exports = {
    name: "delegate",
    run: delegateTool,
    check,
    describe,
    normalizeTasks,
    MAX_SUBAGENTS,
    MAX_TASK_CHARS
};
