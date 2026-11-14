/**
 * Client de session : le SEUL module de l'interface qui connaît le transport.
 *
 * Contrat (identique à window.frst exposé par electron/preload.js) :
 * - start()     → Promise<{ ok, reason? }>
 * - snapshot()         → Promise<{ seq, state }>
 * - submit(text)→ Promise<{ ok, exit?, reason? }>
 * - answer(id, value)  → Promise<boolean>
 * - interrupt()        → Promise<boolean>
 * - onAction(listener) → désabonnement ; listener reçoit { seq, action }
 *
 * Pour rebrancher l'interface sur un autre transport (WebSocket, serveur local,
 * tests), il suffit de fournir un objet qui respecte ce contrat.
 */

export const CLIENT_METHODS = ["start", "snapshot", "submit", "answer", "interrupt", "onAction"];

export function isClient(value) {
    return Boolean(value) && CLIENT_METHODS.every((name) => typeof value[name] === "function");
}

export function getClient(scope = typeof window !== "undefined" ? window : {}) {
    return isClient(scope.frst) ? scope.frst : createOfflineClient();
}

/**
 * Client hors Electron (index.html ouvert dans un navigateur) : aucune session,
 * seulement un message explicatif. Utile pour travailler le style de l'interface.
 */
export function createOfflineClient() {
    const listeners = new Set();
    let seq = 0;

    const emit = (action) => {
        seq += 1;
        for (const listener of [...listeners]) listener({ seq, action });
    };
    const notice = (type, text) => emit({ type: "append", entry: { type, text } });

    return {
        offline: true,
        async start() {
            notice("warn", "Hors Electron : aucune session n'est branchée. Lance « npm run app ».");
            return { ok: false, reason: "Interface hors ligne." };
        },
        async snapshot() {
            return { seq, state: null };
        },
        async submit(text) {
            emit({ type: "append", entry: { type: "user", text: String(text ?? "") } });
            notice("info", "Message non envoyé : interface hors ligne.");
            return { ok: false, reason: "Interface hors ligne." };
        },
        async answer() {
            return false;
        },
        async interrupt() {
            return false;
        },
        onAction(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };
}
