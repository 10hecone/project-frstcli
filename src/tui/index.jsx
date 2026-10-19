import { createRequire } from "node:module";
import { render } from "ink";
import { App } from "./app.jsx";
import { Transcript } from "./components/Transcript.jsx";
import { UserMessage, AssistantMessage, Message } from "./components/Message.jsx";
import { LiveMessage, tailLines } from "./components/LiveMessage.jsx";
import { ToolCall, ToolResult, CommandOutput } from "./components/ToolCall.jsx";
import { Diff } from "./components/Diff.jsx";
import { Plan } from "./components/Plan.jsx";
import { TodoList, TODO_MAX_ROWS, TODO_SYMBOLS, todosVisible, visibleTodos, todoRows } from "./components/TodoList.jsx";
import { SubagentList, SUBAGENT_TASK_CHARS, SUBAGENT_LABELS, shortTask, subagentsVisible, subagentRows } from "./components/SubagentList.jsx";
import { PromptInput, SLASH_COMMANDS } from "./components/PromptInput.jsx";
import { ConfirmDialog, confirmOptions } from "./components/ConfirmDialog.jsx";
import { TextPrompt } from "./components/TextPrompt.jsx";
import { Spinner, SPINNER_FRAMES, formatElapsed } from "./components/Spinner.jsx";
import { StatusBar, projectName, formatCount, sessionTokens, contextPercent, contextColor } from "./components/StatusBar.jsx";
import { ConversationView, visibleWindow, parseWheel, isMouseInput, PAGE_ENTRIES, WHEEL_ENTRIES } from "./components/ConversationView.jsx";

const requireCjs = createRequire(import.meta.url);

export {
    App,
    Transcript,
    UserMessage,
    AssistantMessage,
    Message,
    LiveMessage,
    tailLines,
    ToolCall,
    ToolResult,
    CommandOutput,
    Diff,
    Plan,
    TodoList,
    TODO_MAX_ROWS,
    TODO_SYMBOLS,
    todosVisible,
    visibleTodos,
    todoRows,
    SubagentList,
    SUBAGENT_TASK_CHARS,
    SUBAGENT_LABELS,
    shortTask,
    subagentsVisible,
    subagentRows,
    PromptInput,
    SLASH_COMMANDS,
    ConfirmDialog,
    confirmOptions,
    TextPrompt,
    Spinner,
    SPINNER_FRAMES,
    formatElapsed,
    StatusBar,
    projectName,
    formatCount,
    sessionTokens,
    contextPercent,
    contextColor,
    ConversationView,
    visibleWindow,
    parseWheel,
    isMouseInput,
    PAGE_ENTRIES,
    WHEEL_ENTRIES
};

/** Envoie une saisie à la session et diffuse la réponse dans le store. */
export async function submitInput(raw, { store, backend, session } = {}) {
    const text = String(raw ?? "");
    if (!text.trim()) return { exit: false };
    const core = session || requireCjs("../src/core/session.js");

    store.dispatch({ type: "append", entry: { type: "user", text } });
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
        backend.error(error && error.message ? error.message : String(error));
    } finally {
        if (stream) stream.end();
        store.dispatch({ type: "commandEnd" });
        store.dispatch({ type: "status", status: { busy: false } });
        // Mode, modèle, jobs et tokens ont pu changer pendant le tour.
        if (typeof backend.refreshStatus === "function") backend.refreshStatus();
    }
    return { exit: Boolean(result && result.exit) };
}

/**
 * Branche git courante, lue dans .git/HEAD (sans lancer git). Remonte les
 * dossiers parents ; gère le fichier .git des worktrees. null si inconnue.
 */
export function gitBranch(dir = process.cwd()) {
    const fs = requireCjs("node:fs");
    const path = requireCjs("node:path");
    try {
        let current = path.resolve(String(dir || process.cwd()));
        for (;;) {
            const dotGit = path.join(current, ".git");
            if (fs.existsSync(dotGit)) {
                let gitDir = dotGit;
                if (fs.statSync(dotGit).isFile()) {
                    const match = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, "utf8"));
                    if (!match) return null;
                    gitDir = path.resolve(current, match[1].trim());
                }
                const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
                const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
                if (ref) return ref[1];
                return head ? head.slice(0, 7) : null;
            }
            const parent = path.dirname(current);
            if (parent === current) return null;
            current = parent;
        }
    } catch {
        return null;
    }
}

/** Séquence ANSI qui réaffiche le curseur. */
export const SHOW_CURSOR = "\u001b[?25h";

/** Couleurs désactivées si NO_COLOR est défini et non vide (https://no-color.org). */
export function colorEnabled(env = process.env) {
    return !(env && typeof env.NO_COLOR === "string" && env.NO_COLOR !== "");
}

/**
 * Sortie propre (étape 10) : arrêt des jobs, fermeture de la mémoire, démontage
 * d'Ink puis restauration du terminal (mode brut désactivé, curseur visible).
 * Chaque étape est protégée : une erreur n'empêche pas les suivantes.
 * Renvoie la liste des étapes réussies.
 */
export function cleanExit({
    instance = null,
    jobs = null,
    memory = null,
    stdin = process.stdin,
    stdout = process.stdout,
    altScreen = false
} = {}) {
    const done = [];
    const attempt = (name, fn) => {
        try {
            fn();
            done.push(name);
        } catch {
            // On continue : la restauration du terminal passe avant tout.
        }
    };
    if (jobs && typeof jobs.killAll === "function") attempt("jobs", () => jobs.killAll());
    if (memory && typeof memory.close === "function") attempt("memory", () => memory.close());
    if (instance && typeof instance.unmount === "function") attempt("unmount", () => instance.unmount());
    if (stdin && stdin.isTTY && typeof stdin.setRawMode === "function") {
        attempt("rawMode", () => stdin.setRawMode(false));
    }
    // Plein écran : quitter l'écran alternatif pour retrouver le terminal d'origine.
    if (altScreen && stdout && typeof stdout.write === "function") {
        attempt("altScreen", () => stdout.write("\u001b[?1000l\u001b[?1006l\u001b[?1049l"));
    }
    if (stdout && typeof stdout.write === "function") attempt("cursor", () => stdout.write(SHOW_CURSOR));
    return done;
}

export async function start() {
    const { setUiBackend } = requireCjs("../src/ui-bridge.js");
    const { createStore } = requireCjs("../src/tui/store.js");
    const { createTuiBackend } = requireCjs("../src/tui/adapter.js");
    const { state } = requireCjs("../src/state.js");
    const session = requireCjs("../src/core/session.js");

    let version = "";
    try {
        version = requireCjs("../package.json").version || "";
    } catch {
    }

    let instance = null;
    let running = false;
    let closed = false;
    // Écran alternatif actif (mode plein écran) : il faut le quitter à la sortie.
    let altScreen = false;

    // Efface l'écran et le défilement, puis Ink redessine la zone dynamique.
    const clearScreen = () => {
        process.stdout.write("\u001b[2J\u001b[3J\u001b[H");
        if (instance && typeof instance.clear === "function") instance.clear();
    };

    const store = createStore();
    const backend = createTuiBackend(store, { onClearScreen: clearScreen });
    setUiBackend(backend);

    // Sortie propre, une seule fois : /exit, /quit, double Ctrl+C, Ctrl+D, erreur fatale.
    const shutdown = () => {
        if (closed) return;
        closed = true;
        let jobs = null;
        let memory = null;
        try {
            jobs = requireCjs("../src/tools/command/jobs.js").manager;
        } catch {
        }
        try {
            memory = requireCjs("../src/project/memory.js");
        } catch {
        }
        cleanExit({ instance, jobs, memory, altScreen });
    };

    const onSubmit = async (value) => {
        if (running) return;
        running = true;
        try {
            const outcome = await submitInput(value, { store, backend, session });
            if (outcome.exit) shutdown();
        } finally {
            running = false;
        }
    };
    const onAnswer = (id, value) => backend.resolvePrompt(id, value);
    // Renvoie true si une tâche a été interrompue ; sinon PromptInput efface la saisie, puis quitte au second Ctrl+C.
    const onInterrupt = () => {
        if (running && typeof backend.interrupt === "function") return backend.interrupt() === true;
        return false;
    };
    // Échap : annule les sous-agents en cours (delegate) ; renvoie false s'il n'y en a pas.
    const onEscape = () => {
        const list = store.getState().subagents || [];
        if (!running || !list.some((item) => item && item.status === "running")) return false;
        if (typeof backend.interrupt !== "function") return false;
        return backend.interrupt() === true;
    };
    const onExit = () => shutdown();
    // Ctrl+L : efface seulement l'écran (le transcript reste dans le store).
    const onClear = () => clearScreen();
    const color = colorEnabled(process.env);

    const historyFile = requireCjs("../src/tui/history-file.js");
    const { readClipboard } = requireCjs("../src/clipboard.js");
    const history = await historyFile.load();
    const onHistoryAdd = (text) => {
        historyFile.add(text).catch(() => {});
    };

    backend.banner();

    let result;
    try {
        result = await session.bootstrap();
    } catch (error) {
        result = { ok: false, reason: error && error.message ? error.message : String(error) };
    }

    // Erreur fatale : on restaure le terminal avant de quitter.
    const onFatal = (error) => {
        shutdown();
        const message = error && error.message ? error.message : String(error);
        try {
            process.stderr.write(`Erreur fatale : ${message}\n`);
        } catch {
        }
        process.exit(1);
    };
    process.once("uncaughtException", onFatal);
    process.once("unhandledRejection", onFatal);
    const renderOptions = { exitOnCtrlC: false, patchConsole: true };
    // Rendu en ligne par défaut (comme Claude Code) : l'historique est écrit une fois
    // dans le terminal (Static), qui gère lui-même la molette et la sélection du texte.
    // Plein écran (en-tête fixe, suivi de la souris) seulement avec FRST_TUI_FULLSCREEN=1.
    const fullscreen = Boolean(process.stdout.isTTY) && process.env.FRST_TUI_FULLSCREEN === "1";

    // Redimensionnement : les lignes déjà affichées se replient dans le terminal
    // (surtout cmd/conhost) et Ink efface alors un mauvais nombre de lignes, d'où du
    // texte dupliqué. Après un court délai, on efface l'écran et on redessine tout.
    let resizeTimer = null;
    const onResize = () => {
        if (closed) return;
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            resizeTimer = null;
            if (closed) return;
            try {
                clearScreen();
            } catch {
            }
            store.dispatch({ type: "redraw" });
        }, 100);
    };
    const stopResize = () => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = null;
        process.stdout.removeListener("resize", onResize);
    };
    if (process.stdout.isTTY) process.stdout.on("resize", onResize);

    if (!result.ok) {
        instance = render(<App store={store} version={version} cwd={process.cwd()} color={color} />, renderOptions);
        backend.error(result.reason);
        process.exitCode = 1;
        shutdown();
    } else {
        const agentsApi = requireCjs("../src/api/agents.js");
        const branch = gitBranch(state.workspace || process.cwd());
        backend.info(`Modèle : ${agentsApi.agentName(state.model)}.`);
        backend.refreshStatus({ branch });
        // Charge la liste réelle des agents (GET /chats/agents) en arrière-plan, puis rafraîchit le nom affiché.
        agentsApi.listAgents().then(({ source }) => {
            if (source === "api") backend.refreshStatus({ branch });
        }).catch(() => {});
        if (fullscreen) {
            // Écran alternatif : l'en-tête reste en haut, seule la conversation défile.
            process.stdout.write("\u001b[?1049h\u001b[H\u001b[?1000h\u001b[?1006h");
            altScreen = true;
        }
        instance = render(
            <App
                store={store}
                version={version}
                cwd={process.cwd()}
                onSubmit={onSubmit}
                onAnswer={onAnswer}
                onInterrupt={onInterrupt}
                onEscape={onEscape}
                onExit={onExit}
                onClear={onClear}
                history={history}
                onHistoryAdd={onHistoryAdd}
                clipboard={readClipboard}
                color={color}
                fullscreen={fullscreen}
            />,
            renderOptions
        );
    }

    try {
        await instance.waitUntilExit();
    } catch (error) {
        // Ink peut rejeter waitUntilExit avec l'erreur qui a démonté l'App.
        backend.error(error && error.message ? error.message : String(error));
        process.exitCode = 1;
    } finally {
        stopResize();
        shutdown();
        process.removeListener("uncaughtException", onFatal);
        process.removeListener("unhandledRejection", onFatal);
        setUiBackend(null);
    }
    return result;
}

if (process.env.FRST_TUI_NO_START !== "1") {
    await start();
}
