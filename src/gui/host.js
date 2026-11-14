"use strict";

/**
 * Hôte de session de l'interface graphique.
 *
 * Relie le cœur partagé (src/core/session.js) au port d'interface (src/ui-bridge.js)
 * avec le même adaptateur que la TUI, branché sur un store distant. Ce module ne
 * dépend pas d'Electron : `send` suffit, ce qui le rend testable avec node --test.
 *
 * Dépendances injectables (tests) : session, bridge, createBackend, jobs, memory.
 */

const { createRemoteStore } = require("./remote-store");

function errorMessage(error) {
    return error && error.message ? error.message : String(error);
}

function createGuiHost({
    send,
    onExit = null,
    session = null,
    bridge = null,
    createBackend = null,
    jobs = null,
    memory = null,
    stateModule = null,
    statusExtra = null,
    refreshContext = undefined
} = {}) {
    const core = session || require("../core/session");
    const port = bridge || require("../ui-bridge");
    const makeBackend = createBackend || require("../tui/adapter").createTuiBackend;
    const { state } = stateModule || require("../state");

    // Contexte via GET /chats/{id}/context (pas en test, sauf injection explicite).
    const loadContext = refreshContext !== undefined
        ? refreshContext
        : session
            ? null
            : () => require("../core/compact").refreshContextUsage();

    const store = createRemoteStore(send);
    const backend = makeBackend(store);
    port.setUiBackend(backend);

    let starting = null;
    let running = false;
    let disposed = false;
    // Champs de la barre d'état calculés hors de l'adaptateur (ex. branche git).
    let extra = {};

    function refresh() {
        if (typeof backend.refreshStatus !== "function") return;
        backend.refreshStatus({
            ...extra,
            modelId: state.model,
            chatId: (state.chatIds && state.chatIds.chat) || null,
            project: state.frProject ? state.frProject.name || null : null
        });
    }

    /** Recalcule les champs asynchrones (statusExtra, contexte) puis rafraîchit la barre d'état. */
    async function syncStatus() {
        if (typeof statusExtra === "function") {
            try {
                extra = { ...extra, ...((await statusExtra()) || {}) };
            } catch {
                // Information facultative : la barre d'état reste valable sans elle.
            }
        }
        if (typeof loadContext === "function") {
            try {
                await loadContext();
            } catch {
                // Pourcentage facultatif : la barre d'état garde la dernière valeur.
            }
        }
        if (!disposed) refresh();
    }

    /** Ids Files v2 valides (chaînes non vides, sans doublon, 20 au plus). */
    function cleanFiles(files) {
        if (!Array.isArray(files)) return [];
        const ids = files.map((id) => String(id ?? "").trim()).filter(Boolean);
        return [...new Set(ids)].slice(0, 20);
    }

    /** Démarrage unique : accueil, authentification, restauration de la conversation. */
    function start() {
        if (starting) return starting;
        starting = (async () => {
            backend.banner();
            let result;
            try {
                result = await core.bootstrap();
            } catch (error) {
                result = { ok: false, reason: errorMessage(error) };
            }
            if (!result || !result.ok) {
                const reason = (result && result.reason) || "Démarrage impossible.";
                backend.error(reason);
                return { ok: false, reason };
            }
            refresh();
            syncStatus();
            // Liste réelle des agents en arrière-plan, comme la TUI (pas en test).
            if (!session) {
                Promise.resolve()
                    .then(() => require("../api/agents").listAgents())
                    .then(({ source } = {}) => {
                        if (source === "api") refresh();
                    })
                    .catch(() => {});
            }
            return { ok: true };
        })();
        return starting;
    }

    /**
     * Envoie une saisie (message ou commande /...) et diffuse la réponse.
     * files : ids Files v2 joints au message (ignorés pour une commande /...).
     */
    async function submit(raw, files = []) {
        const text = String(raw ?? "");
        const attachments = text.trim().startsWith("/") ? [] : cleanFiles(files);
        if (!text.trim()) return { ok: false, reason: "Saisie vide." };
        if (disposed) return { ok: false, reason: "Session fermée." };
        if (running) return { ok: false, reason: "Une demande est déjà en cours." };

        const boot = await start();
        if (!boot.ok) return boot;

        running = true;
        state.pendingFiles = attachments;
        store.dispatch({
            type: "append",
            entry: attachments.length ? { type: "user", text, files: attachments.length } : { type: "user", text }
        });
        store.dispatch({ type: "status", status: { busy: true } });

        let stream = null;
        const onChatDelta = (delta) => {
            if (!stream) stream = backend.stream();
            stream.write(delta);
        };

        let result = null;
        try {
            result = await core.handleInput(text, { onChatDelta });
        } catch (error) {
            backend.error(errorMessage(error));
        } finally {
            if (stream) stream.end();
            store.dispatch({ type: "commandEnd" });
            store.dispatch({ type: "status", status: { busy: false } });
            // Jamais renvoyées avec un message suivant, même après une erreur.
            state.pendingFiles = [];
            refresh();
            running = false;
        }
        syncStatus();

        const exit = Boolean(result && result.exit);
        if (exit && typeof onExit === "function") onExit();
        return { ok: true, exit };
    }

    /** Réponse à une confirmation ou à une question (id du prompt en attente). */
    function answer(id, value) {
        return backend.resolvePrompt(Number(id), String(value ?? ""));
    }

    /** Interrompt la tâche en cours. Renvoie true si un gestionnaire a été appelé. */
    function interrupt() {
        if (!running || typeof backend.interrupt !== "function") return false;
        return backend.interrupt() === true;
    }

    function snapshot() {
        return store.snapshot();
    }

    /** Fermeture : arrêt des commandes en arrière-plan, mémoire, port d'interface. */
    function dispose() {
        if (disposed) return;
        disposed = true;
        const attempt = (fn) => {
            try {
                fn();
            } catch {
                // Chaque étape est indépendante : une erreur n'empêche pas les suivantes.
            }
        };
        attempt(() => {
            const manager = jobs || require("../tools/command/jobs").manager;
            if (manager && typeof manager.killAll === "function") manager.killAll();
        });
        attempt(() => {
            const mem = memory || require("../project/memory");
            if (mem && typeof mem.close === "function") mem.close();
        });
        attempt(() => port.setUiBackend(null));
    }

    return {
        start,
        submit,
        answer,
        interrupt,
        snapshot,
        dispose,
        refresh,
        syncStatus,
        isRunning: () => running,
        backend,
        store
    };
}

module.exports = { createGuiHost };
