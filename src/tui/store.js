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
        nextId: 1
    };
}

function reducer(state, action) {
    switch (action && action.type) {
        case "append": {
            const entry = action.entry || {};
            if (!ENTRY_TYPES.includes(entry.type)) {
                throw new TypeError(`Store : type d'entrée inconnu « ${entry.type} ».`);
            }
            return {
                ...state,
                transcript: [...state.transcript, { ...entry, id: state.nextId }],
                nextId: state.nextId + 1
            };
        }

        case "liveStart":
            return { ...state, live: { id: state.nextId, text: "" }, nextId: state.nextId + 1 };

        case "liveAppend": {
            const text = String(action.text ?? "");
            if (!text) return state;
            if (!state.live) {
                return { ...state, live: { id: state.nextId, text }, nextId: state.nextId + 1 };
            }
            return { ...state, live: { ...state.live, text: state.live.text + text } };
        }

        case "liveEnd": {
            if (!state.live) return state;
            if (!state.live.text) return { ...state, live: null };
            return {
                ...state,
                live: null,
                transcript: [
                    ...state.transcript,
                    { type: "assistant", text: state.live.text, streamed: true, id: state.live.id }
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

        case "status":
            return { ...state, status: { ...state.status, ...(action.status || {}) } };

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

module.exports = { createStore, reducer, initialState, ENTRY_TYPES };
