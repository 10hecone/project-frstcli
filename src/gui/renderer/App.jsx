import { Header } from "./components/Header.jsx";
import { Transcript } from "./components/Transcript.jsx";
import { TaskPanel } from "./components/TaskPanel.jsx";
import { Composer } from "./components/Composer.jsx";
import { PromptDialog } from "./components/PromptDialog.jsx";
import { StatusBar } from "./components/StatusBar.jsx";
import { useSession } from "./hooks/useSession.js";

/**
 * Composant racine : assemble les zones de l'écran. Aucune logique de transport
 * ici (voir api/client.js) ni de synchronisation (voir hooks/useSession.js).
 */
export function App({ client }) {
    const { state, phase, busy, submit, answer, interrupt } = useSession(client);
    const prompt = state.pendingPrompt;

    return (
        <div className="app">
            <Header status={state.status} />
            <Transcript
                transcript={state.transcript}
                live={state.live}
                command={state.command}
                spinner={state.spinner}
            />
            <TaskPanel todos={state.todos} subagents={state.subagents} />
            <Composer
                busy={busy}
                disabled={phase !== "ready" || Boolean(prompt)}
                onSubmit={submit}
                onInterrupt={interrupt}
            />
            <StatusBar status={state.status} phase={phase} />
            <PromptDialog prompt={prompt} onAnswer={answer} />
        </div>
    );
}
