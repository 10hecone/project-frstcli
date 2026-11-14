"use strict";

/**
 * Store du processus principal pour l'interface graphique.
 *
 * Il réutilise le store de la TUI (même reducer, mêmes actions) : l'adaptateur
 * src/tui/adapter.js fonctionne donc tel quel. Chaque action qui modifie l'état
 * est transmise à la fenêtre avec un numéro de séquence ; la fenêtre applique le
 * même reducer et obtient le même état.
 *
 * Le numéro de séquence permet à la fenêtre de partir d'un instantané (snapshot)
 * puis d'ignorer les actions déjà incluses dedans (rechargement de la page, F5).
 */

const { createStore } = require("../tui/store");

function createRemoteStore(send) {
    if (typeof send !== "function") {
        throw new TypeError("Store distant : send doit être une fonction.");
    }

    const store = createStore();
    let seq = 0;

    store.subscribe((_state, action) => {
        seq += 1;
        try {
            send({ seq, action });
        } catch {
            // Fenêtre fermée ou en cours de rechargement : elle repartira d'un snapshot.
        }
    });

    return {
        getState: store.getState,
        dispatch: store.dispatch,
        subscribe: store.subscribe,

        /** État courant et numéro de la dernière action incluse. */
        snapshot() {
            return { seq, state: store.getState() };
        }
    };
}

module.exports = { createRemoteStore };
