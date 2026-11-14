import { useCallback, useEffect, useReducer, useRef, useState } from "react";
// Même reducer que la TUI et que le store du processus principal : les deux états restent identiques.
import { reducer, initialState } from "../../../tui/store.js";

const RESET = "@@gui/reset";

/** Reducer de la fenêtre : instantané complet (RESET) ou action du store partagé. */
export function guiReducer(state, action) {
    if (action && action.type === RESET) {
        return { ...initialState(), ...(action.state || {}) };
    }
    try {
        return reducer(state, action);
    } catch {
        // Action inconnue (version différente du cœur) : on garde l'état plutôt que de planter.
        return state;
    }
}

/**
 * Synchronise l'état de la fenêtre avec la session du processus principal.
 *
 * Ordre : abonnement → instantané → rejeu des actions reçues entre-temps
 * (seq > seq de l'instantané) → démarrage de la session.
 *
 * phase : "booting" (démarrage, connexion), "ready" ou "failed".
 */
export function useSession(client) {
    const [state, dispatch] = useReducer(guiReducer, undefined, initialState);
    const [phase, setPhase] = useState("booting");
    const [error, setError] = useState(null);
    const seqRef = useRef(0);

    useEffect(() => {
        let alive = true;
        let synced = false;
        const pending = [];

        const apply = (message) => {
            if (!message || !message.action) return;
            if (!synced) {
                pending.push(message);
                return;
            }
            if (message.seq <= seqRef.current) return;
            seqRef.current = message.seq;
            dispatch(message.action);
        };

        const unsubscribe = client.onAction(apply);

        (async () => {
            const snap = await client.snapshot();
            if (!alive) return;
            seqRef.current = (snap && snap.seq) || 0;
            dispatch({ type: RESET, state: snap && snap.state });
            synced = true;
            pending.splice(0).forEach(apply);

            const result = await client.start();
            if (!alive) return;
            if (result && result.ok) {
                setPhase("ready");
                setError(null);
            } else {
                setPhase("failed");
                setError((result && result.reason) || null);
            }
        })().catch((err) => {
            if (!alive) return;
            setPhase("failed");
            setError(err && err.message ? err.message : String(err));
        });

        return () => {
            alive = false;
            unsubscribe();
        };
    }, [client]);

    const submit = useCallback((text) => client.submit(text), [client]);
    const answer = useCallback((id, value) => client.answer(id, value), [client]);
    const interrupt = useCallback(() => client.interrupt(), [client]);

    return {
        state,
        phase,
        error,
        busy: Boolean(state.status && state.status.busy),
        submit,
        answer,
        interrupt
    };
}
