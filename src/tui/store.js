"use strict";

/**
 * Store minimal de la TUI (étape 4) : état + dispatch + subscribe, sans React.
 *
 * - transcript : entrées terminées (affichées dans <Static>) ;
 * - live : message en cours de streaming ({ id, text }) ;
 * - spinner : indicateur de chargement ({ id, label, startedAt }) ;
 * - pendingPrompt : confirmation ou question en attente (la première de la file prompts) ;
 * - status : informations de la barre d'état.
 */

const ENTRY_TYPES = [
    "welcome", "user", "assistant", "tool", "result", "plan",
    "diff", "info", "warn", "error", "print"
];

function initialState() {
    return {
        transcript: [],
        live: null,
        spinner: null,
        pendingPrompt: null,
        prompts: [],
        status: {},
        command: null,
        todos: [],
        nextId: 1
    };
}

// Sortie de run_command : seules les dernières lignes sont gardées (affichage replié).
const COMMAND_FOLD_LINES = 5;

// Clôture de bloc de code Markdown (même règle que renderMarkdownLine).
const FENCE_RE = /^\s*(```|~~~)/;

/** Termine la sortie de commande en cours : une entrée print repliée passe dans le transcript. */
function flushCommand(state) {
    if (!state.command) return state;
    const { lines, total } = state.command;
    return {
        ...state,
        command: null,
        transcript: [
            ...state.transcript,
            { type: "print", lines: [...lines], command: true, hidden: total - lines.length, id: state.nextId }
        ],
        nextId: state.nextId + 1
    };
}

function reducer(state, action) {
    switch (action && action.type) {
        case "append": {
            const entry = action.entry || {};
            if (!ENTRY_TYPES.includes(entry.type)) {
                throw new TypeError(`Store : type d'entrée inconnu « ${entry.type} ».`);
            }
            const base = flushCommand(state);
            return {
                ...base,
                transcript: [...base.transcript, { ...entry, id: base.nextId }],
                nextId: base.nextId + 1
            };
        }

        case "commandLine": {
            const text = String(action.text ?? "");
            const previous = state.command || { lines: [], total: 0 };
            const lines = [...previous.lines, text].slice(-COMMAND_FOLD_LINES);
            return { ...state, command: { lines, total: previous.total + 1 } };
        }

        case "commandEnd":
            return flushCommand(state);

        case "liveStart": {
            const base = flushCommand(state);
            return { ...base, live: { id: base.nextId, text: "" }, nextId: base.nextId + 1 };
        }

        case "liveAppend": {
            const text = String(action.text ?? "");
            if (!text) return state;
            let base = state;
            if (!base.live) {
                base = { ...base, live: { id: base.nextId, text: "", inCode: false }, nextId: base.nextId + 1 };
            }
            // Les lignes complètes passent dans le transcript (<Static>) : seule la ligne
            // en cours reste dans la zone dynamique, ce qui évite le scintillement.
            const parts = (base.live.text + text).split("\n");
            const rest = parts.pop();
            if (!parts.length) return { ...base, live: { ...base.live, text: rest } };
            let inCode = Boolean(base.live.inCode);
            let nextId = base.nextId;
            const lines = parts.map((line) => {
                const entry = { type: "assistant", text: line, streamed: true, line: true, inCode, id: nextId++ };
                if (FENCE_RE.test(line)) inCode = !inCode;
                return entry;
            });
            return {
                ...base,
                transcript: [...base.transcript, ...lines],
                live: { ...base.live, text: rest, inCode },
                nextId
            };
        }

        case "liveEnd": {
            if (!state.live) return state;
            if (!state.live.text) return { ...state, live: null };
            return {
                ...state,
                live: null,
                transcript: [
                    ...state.transcript,
                    {
                        type: "assistant",
                        text: state.live.text,
                        streamed: true,
                        line: true,
                        inCode: Boolean(state.live.inCode),
                        id: state.live.id
                    }
                ]
            };
        }

        case "spinner":
            return { ...state, spinner: action.spinner ? { ...action.spinner } : null };

        case "prompt": {
            const prompts = [...state.prompts, { ...action.prompt }];
            return { ...state, prompts, pendingPrompt: prompts[0] };
        }

        case "promptResolved": {
            const prompts = state.prompts.filter(p => p.id !== action.id);
            if (prompts.length === state.prompts.length) return state;
            return { ...state, prompts, pendingPrompt: prompts[0] || null };
        }

        case "todos":
            // Liste de tâches (todo_write) : remplacée en entier à chaque mise à jour.
            return {
                ...state,
                todos: Array.isArray(action.todos) ? action.todos.map(todo => ({ ...todo })) : []
            };

        case "status":
            return { ...state, status: { ...state.status, ...(action.status || {}) } };

        case "clear":
            // /clear : vide l'affichage (transcript, flux, sortie de commande) en gardant
            // status, prompts et nextId. epoch sert de clé pour remonter <Static>.
            return {
                ...state,
                transcript: [],
                live: null,
                command: null,
                epoch: (state.epoch || 0) + 1
            };

        case "redraw":
            // Redimensionnement : garde tout le contenu, mais change epoch pour que
            // <Static> soit remonté et réimprime le transcript après effacement de l'écran.
            return { ...state, epoch: (state.epoch || 0) + 1 };

        default:
            return state;
    }
}

function createStore(preloaded = null) {
    let current = { ...initialState(), ...(preloaded || {}) };
    const listeners = new Set();

    return {
        getState() {
            return current;
        },

        dispatch(action) {
            const next = reducer(current, action);
            if (next !== current) {
                current = next;
                for (const listener of [...listeners]) listener(current, action);
            }
            return action;
        },

        subscribe(listener) {
            if (typeof listener !== "function") {
                throw new TypeError("Store : subscribe attend une fonction.");
            }
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        }
    };
}

module.exports = { createStore, reducer, initialState, ENTRY_TYPES, COMMAND_FOLD_LINES };
