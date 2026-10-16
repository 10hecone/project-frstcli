"use strict";

/**
 * Adaptateur TUI du port d'interface (étape 4), en CommonJS pur, sans React.
 *
 * Les méthodes d'affichage poussent des entrées dans le store. confirm,
 * askCommand, ask et askSecret créent un pendingPrompt et renvoient une
 * promesse résolue quand l'UI appelle resolvePrompt(id, valeur).
 */

const { state } = require("../state");
const { CONFIG } = require("../config");

const STREAM_INTERVAL_MS = 40;

function createTuiBackend(store, {
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    jobs: jobManager = null,
    usage: usageObject = null,
    onClearScreen = null
} = {}) {
    if (!store || typeof store.dispatch !== "function") {
        throw new TypeError("Adaptateur TUI : un store est requis.");
    }

    // Sources de la barre d'état : injectables (tests), sinon require différé.
    const jobSource = () => jobManager || require("../tools/command/jobs").manager;
    const usageSource = () => usageObject || require("../api/api").usage;

    const resolvers = new Map();
    const interrupts = [];
    let nextPromptId = 1;
    let nextSpinnerId = 1;

    function append(entry) {
        store.dispatch({ type: "append", entry });
    }

    function openPrompt(kind, question, extra = {}) {
        const id = nextPromptId++;
        return new Promise((resolve) => {
            resolvers.set(id, resolve);
            store.dispatch({
                type: "prompt",
                prompt: { id, kind, question: String(question ?? ""), ...extra }
            });
        });
    }

    const backend = {
        banner() {
            append({
                type: "welcome",
                model: require("../api/agents").agentName(state.model),
                workspace: state.workspace,
                mode: state.mode,
                webSearch: state.webSearch
            });
        },

        prompt() {
            return "> ";
        },

        info(text) {
            append({ type: "info", text: String(text ?? "") });
        },

        debug(text) {
            if (CONFIG.debug) append({ type: "info", text: String(text ?? ""), debug: true });
        },

        warn(text) {
            append({ type: "warn", text: String(text ?? "") });
        },

        error(text) {
            append({ type: "error", text: String(text ?? "") });
        },

        assistant(text) {
            append({ type: "assistant", text: String(text ?? "") });
        },

        print(lines) {
            const list = Array.isArray(lines) ? lines : [lines];
            append({ type: "print", lines: list.map((line) => (line == null ? "" : String(line))) });
        },

        plan(items) {
            append({ type: "plan", items: Array.isArray(items) ? [...items] : [] });
        },

        tool(name, arg) {
            append({ type: "tool", name, arg: arg ?? "" });
        },

        result(text, { tone } = {}) {
            append({ type: "result", text: String(text ?? ""), tone: tone || null });
        },

        /** Ligne de sortie d'une commande, affichée en direct. */
        commandLine(text) {
            store.dispatch({ type: "commandLine", text: String(text ?? "") });
        },

        /** Diff produit par buildDiff({ lines, added, removed }). Renvoie { added, removed }. */
        diff(data) {
            const added = data?.added ?? 0;
            const removed = data?.removed ?? 0;
            append({ type: "diff", lines: Array.isArray(data?.lines) ? data.lines : [], added, removed });
            return { added, removed };
        },

        spinner(label) {
            const id = nextSpinnerId++;
            let active = true;
            store.dispatch({ type: "spinner", spinner: { id, label, startedAt: now() } });

            const isCurrent = () => store.getState().spinner?.id === id;

            return {
                update(next) {
                    if (!active || !isCurrent()) return;
                    const current = store.getState().spinner;
                    store.dispatch({ type: "spinner", spinner: { ...current, label: next } });
                },
                stop() {
                    if (!active) return;
                    active = false;
                    if (isCurrent()) store.dispatch({ type: "spinner", spinner: null });
                }
            };
        },

        /**
         * Même sémantique que le CLI : o/oui = oui, t = tout autoriser pour la
         * session (sauf avec force), toute autre réponse refuse.
         */
        async confirm(question, { force = false } = {}) {
            if (!force && state.autoApprove) return true;

            const raw = await openPrompt("confirm", question, { force: Boolean(force) });
            const answer = String(raw ?? "").trim().toLowerCase();

            if (!force && ["t", "tout", "a", "all"].includes(answer)) {
                state.autoApprove = true;
                backend.warn("Auto-approbation activée pour cette session (/auto off pour la couper).");
                return true;
            }

            return ["o", "oui", "y", "yes"].includes(answer);
        },

        /** Confirmation d'une commande : renvoie la réponse brute. Jamais auto-approuvée. */
        askCommand(question, prefixText) {
            return openPrompt("command", question, { prefix: String(prefixText ?? "") });
        },

        ask(question) {
            return openPrompt("ask", question);
        },

        askSecret(question) {
            return openPrompt("secret", question, { secret: true });
        },

        /** Pile de gestionnaires : le plus récent reçoit l'interruption. */
        onInterrupt(handler) {
            interrupts.push(handler);
            return () => {
                const index = interrupts.lastIndexOf(handler);
                if (index !== -1) interrupts.splice(index, 1);
            };
        },

        /** Flux de texte : deltas regroupés et envoyés au store au plus toutes les 40 ms. */
        stream() {
            let buffer = "";
            let timer = null;
            let lastFlush = -Infinity;
            let ended = false;

            store.dispatch({ type: "liveStart" });

            function flush() {
                timer = null;
                lastFlush = now();
                if (!buffer) return;
                const text = buffer;
                buffer = "";
                store.dispatch({ type: "liveAppend", text });
            }

            return {
                write(chunk) {
                    if (ended) return;
                    const text = String(chunk ?? "");
                    if (!text) return;
                    buffer += text;
                    if (timer) return;
                    const elapsed = now() - lastFlush;
                    if (elapsed >= STREAM_INTERVAL_MS) flush();
                    else timer = setTimer(flush, STREAM_INTERVAL_MS - elapsed);
                },
                end() {
                    if (ended) return;
                    ended = true;
                    if (timer) {
                        clearTimer(timer);
                        timer = null;
                    }
                    flush();
                    store.dispatch({ type: "liveEnd" });
                }
            };
        },

        /**
         * /clear : efface l'écran (callback injecté), vide l'affichage du store
         * (transcript, flux, sortie de commande ; epoch++ pour remonter <Static>)
         * puis réaffiche l'accueil.
         */
        clear() {
            if (typeof onClearScreen === "function") {
                try {
                    onClearScreen();
                } catch {
                    // L'effacement de l'écran est facultatif : le store est vidé quand même.
                }
            }
            store.dispatch({ type: "clear" });
            backend.banner();
        },

        // ---- Appelées par l'UI (hors port) ----

        /**
         * Barre d'état : copie dans store.status le mode, le modèle, le workspace,
         * l'auto-approbation, les jobs actifs et l'usage de la session.
         * extra permet d'ajouter des champs connus ailleurs (ex. branch).
         */
        refreshStatus(extra = {}) {
            let jobs = 0;
            let usage = null;
            try {
                jobs = jobSource().runningCount();
            } catch {
                jobs = 0;
            }
            try {
                const source = usageSource();
                usage = source ? { ...source } : null;
            } catch {
                usage = null;
            }
            store.dispatch({
                type: "status",
                status: {
                    mode: state.mode,
                    model: require("../api/agents").agentName(state.model),
                    workspace: state.workspace,
                    autoApprove: Boolean(state.autoApprove),
                    jobs,
                    usage,
                    ...extra
                }
            });
        },


        /** Résout le prompt id avec value. Renvoie false si le prompt n'existe pas. */
        resolvePrompt(id, value) {
            const resolve = resolvers.get(id);
            if (!resolve) return false;
            resolvers.delete(id);
            store.dispatch({ type: "promptResolved", id });
            resolve(value);
            return true;
        },

        /** Ctrl+C : appelle le dernier gestionnaire inscrit. Renvoie true s'il y en avait un. */
        interrupt() {
            const handler = interrupts[interrupts.length - 1];
            if (!handler) return false;
            handler();
            return true;
        },

        store
    };

    return backend;
}

module.exports = { createTuiBackend, STREAM_INTERVAL_MS };
