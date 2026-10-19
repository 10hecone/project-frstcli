import { useSyncExternalStore } from "react";
import { Box, useStdout } from "ink";
import { Transcript } from "./components/Transcript.jsx";
import { LiveMessage, useTerminalRows } from "./components/LiveMessage.jsx";
import { Header } from "./components/Header.jsx";
import { ConversationView } from "./components/ConversationView.jsx";
import { CommandOutput } from "./components/ToolCall.jsx";
import { PromptInput } from "./components/PromptInput.jsx";
import { ConfirmDialog } from "./components/ConfirmDialog.jsx";
import { TextPrompt } from "./components/TextPrompt.jsx";
import { Spinner } from "./components/Spinner.jsx";
import { StatusBar } from "./components/StatusBar.jsx";

function useStore(store) {
    return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** Dialogue d'un prompt en attente : confirm/command → ConfirmDialog, ask/secret → TextPrompt. */
function PromptDialog({ prompt, onAnswer }) {
    const answer = (value) => {
        if (onAnswer) onAnswer(prompt.id, value);
    };
    if (prompt.kind === "confirm" || prompt.kind === "command") {
        return (
            <ConfirmDialog
                key={`prompt-${prompt.id}`}
                question={prompt.question}
                kind={prompt.kind}
                force={Boolean(prompt.force)}
                prefix={prompt.prefix ?? ""}
                isActive={Boolean(onAnswer)}
                onAnswer={answer}
            />
        );
    }
    return (
        <TextPrompt
            key={`prompt-${prompt.id}`}
            question={prompt.question}
            secret={Boolean(prompt.secret || prompt.kind === "secret")}
            isActive={Boolean(onAnswer)}
            onAnswer={answer}
        />
    );
}

export function App({
    store,
    version = "",
    cwd = process.cwd(),
    onSubmit,
    onAnswer,
    onInterrupt,
    onExit,
    onClear,
    onHistoryAdd,
    history = [],
    clipboard,
    busy: busyProp = false,
    color = true,
    now = Date.now,
    spinnerInterval,
    fullscreen = false
}) {
    const current = useStore(store);
    const { stdout } = useStdout();
    const rows = useTerminalRows(stdout);
    const status = current.status || {};
    const busy = Boolean(busyProp || status.busy);
    const prompt = current.pendingPrompt;
    const canType = Boolean(onSubmit && !busy);

    const command = current.command ? (
        <CommandOutput lines={current.command.lines} hidden={current.command.total - current.command.lines.length} />
    ) : null;
    const live = <LiveMessage live={current.live} color={color} />;
    const spinner = current.spinner ? (
        <Spinner spinner={current.spinner} now={now} interval={spinnerInterval} color={color} />
    ) : null;
    const input = prompt ? (
        <PromptDialog key={`prompt-${prompt.id}`} prompt={prompt} onAnswer={onAnswer} />
    ) : canType || onInterrupt ? (
        <PromptInput
            key="main"
            label="> "
            isActive={canType || Boolean(onInterrupt)}
            history={history}
            onHistoryAdd={onHistoryAdd}
            onInterrupt={onInterrupt}
            onExit={onExit}
            onClear={onClear}
            clipboard={clipboard}
            onSubmit={(value) => {
                if (onSubmit && !busy) onSubmit(value);
            }}
        />
    ) : null;
    const bar = (
        <StatusBar
            mode={status.mode}
            model={status.model}
            workspace={status.workspace}
            autoApprove={Boolean(status.autoApprove)}
            jobs={status.jobs}
            usage={status.usage}
            context={status.context}
            branch={status.branch}
            color={color}
        />
    );

    if (fullscreen) {
        // Plein écran (écran alternatif) : en-tête fixe en haut, conversation qui
        // défile au milieu, saisie et barre d'état en bas. Hauteur = lignes - 1 pour
        // éviter qu'Ink n'efface tout le terminal à chaque rendu (scintillement).
        const welcome = (current.transcript || []).find((entry) => entry && entry.type === "welcome");
        return (
            <Box flexDirection="column" height={Math.max(8, rows - 1)}>
                <Header
                    version={version}
                    model={(welcome && welcome.model) || status.model}
                    workspace={(welcome && welcome.workspace) || status.workspace}
                    cwd={cwd}
                />
                <ConversationView
                    key={`conversation-${current.epoch || 0}`}
                    transcript={current.transcript}
                    version={version}
                    cwd={cwd}
                    color={color}
                    rows={rows}
                >
                    {command}
                    {live}
                    {spinner}
                </ConversationView>
                <Box flexDirection="column" flexShrink={0}>
                    {input}
                    {bar}
                </Box>
            </Box>
        );
    }

    return (
        <Box flexDirection="column">
            <Transcript key={`transcript-${current.epoch || 0}`} transcript={current.transcript} version={version} cwd={cwd} color={color} />
            {command}
            {live}
            {spinner}
            {input}
            {bar}
        </Box>
    );
}

export default App;
