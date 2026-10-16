import { createRequire } from "node:module";
import { render } from "ink";
import { App } from "./app.jsx";
import { Transcript } from "./components/Transcript.jsx";
import { UserMessage, AssistantMessage, Message } from "./components/Message.jsx";
import { LiveMessage, tailLines } from "./components/LiveMessage.jsx";
import { ToolCall, ToolResult, CommandOutput } from "./components/ToolCall.jsx";
import { Diff } from "./components/Diff.jsx";
import { Plan } from "./components/Plan.jsx";

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
    Plan
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
    }
    return { exit: Boolean(result && result.exit) };
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
    const onInterrupt = () => {
        if (running && typeof backend.interrupt === "function") backend.interrupt();
        else if (instance) instance.unmount();
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
        instance = render(
            <App
                store={store}
                version={version}
                cwd={process.cwd()}
                onSubmit={onSubmit}
                onAnswer={onAnswer}
                onInterrupt={onInterrupt}
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
