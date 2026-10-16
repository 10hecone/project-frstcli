import { createRequire } from "node:module";
import { render } from "ink";
import { App } from "./app.jsx";
import { Transcript } from "./components/Transcript.jsx";
import { UserMessage, AssistantMessage, Message } from "./components/Message.jsx";
import { LiveMessage, tailLines } from "./components/LiveMessage.jsx";
import { ToolCall, ToolResult, CommandOutput } from "./components/ToolCall.jsx";
import { Diff } from "./components/Diff.jsx";
import { Plan } from "./components/Plan.jsx";
import { PromptInput, SLASH_COMMANDS } from "./components/PromptInput.jsx";
import { ConfirmDialog, confirmOptions } from "./components/ConfirmDialog.jsx";
import { TextPrompt } from "./components/TextPrompt.jsx";
import { Spinner, SPINNER_FRAMES, formatElapsed } from "./components/Spinner.jsx";
import { StatusBar, projectName, formatCount, sessionTokens } from "./components/StatusBar.jsx";

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
    sessionTokens
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

    const store = createStore();
    const backend = createTuiBackend(store);
    setUiBackend(backend);

    let instance = null;
    let running = false;

    const onSubmit = async (value) => {
        if (running) return;
        running = true;
        try {
            const outcome = await submitInput(value, { store, backend, session });
            if (outcome.exit && instance) instance.unmount();
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
    const onExit = () => {
        if (instance) instance.unmount();
    };
    // Ctrl+L : efface l'écran et le défilement, puis Ink redessine la zone dynamique.
    const onClear = () => {
        process.stdout.write("\u001b[2J\u001b[3J\u001b[H");
        if (instance && typeof instance.clear === "function") instance.clear();
    };

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

    if (!result.ok) {
        instance = render(<App store={store} version={version} cwd={process.cwd()} />, { exitOnCtrlC: false });
        backend.error(result.reason);
        process.exitCode = 1;
        instance.unmount();
    } else {
        backend.info(`Modèle : ${state.model}.`);
        backend.refreshStatus({ branch: gitBranch(state.workspace || process.cwd()) });
        instance = render(
            <App
                store={store}
                version={version}
                cwd={process.cwd()}
                onSubmit={onSubmit}
                onAnswer={onAnswer}
                onInterrupt={onInterrupt}
                onExit={onExit}
                onClear={onClear}
                history={history}
                onHistoryAdd={onHistoryAdd}
                clipboard={readClipboard}
            />,
            { exitOnCtrlC: false }
        );
    }

    await instance.waitUntilExit();
    setUiBackend(null);
    return result;
}

if (process.env.FRST_TUI_NO_START !== "1") {
    await start();
}
