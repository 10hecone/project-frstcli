import { useSyncExternalStore } from "react";
import { Box, Text, useStdout } from "ink";
import { SessionPicker } from "./components/SessionPicker.jsx";
import { Transcript } from "./components/Transcript.jsx";
import { LiveMessage, useTerminalRows } from "./components/LiveMessage.jsx";
import { TodoList, todoRows } from "./components/TodoList.jsx";
import { SubagentList, subagentRows } from "./components/SubagentList.jsx";
import { Header } from "./components/Header.jsx";
import { ConversationView } from "./components/ConversationView.jsx";
import { CommandOutput } from "./components/ToolCall.jsx";
import { PromptInput } from "./components/PromptInput.jsx";
import { ConfirmDialog } from "./components/ConfirmDialog.jsx";
import { TextPrompt } from "./components/TextPrompt.jsx";
import { Spinner } from "./components/Spinner.jsx";
import { StatusBar } from "./components/StatusBar.jsx";

/** Messages affichés pendant l'amorçage (les derniers seulement). */
const BOOT_MESSAGES = 6;
const BOOT_COLORS = { info: undefined, warn: "yellow", error: "red" };

function useStore(store) {
    return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** Dialogue d'un prompt en attente : confirm/command → ConfirmDialog, ask/secret → TextPrompt. */
function PromptDialog({ prompt, onAnswer, color = true }) {
    const answer = (value) => {
        if (onAnswer) onAnswer(prompt.id, value);
    };
    if (prompt.kind === "session") {
        return (
            <SessionPicker
                key={`prompt-${prompt.id}`}
                question={prompt.question}
                sessions={prompt.sessions}
                isActive={Boolean(onAnswer)}
                onAnswer={answer}
                color={color}
            />
        );
    }
    if (prompt.kind === "confirm" || prompt.kind === "command") {
        return (
            <ConfirmDialog
                key={`prompt-${prompt.id}`}
                question={prompt.question}
                kind={prompt.kind}
                prefix={prompt.prefix ?? ""}
                isActive={Boolean(onAnswer)}
                onAnswer={answer}
                color={color}
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
            color={color}
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
    onEscape,
    onExit,
    onClear,
    onCycleMode,
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
        <CommandOutput lines={current.command.lines} hidden={current.command.total - current.command.lines.length} color={color} />
    ) : null;
    const todoList = (
        <Box flexDirection="column">
            <TodoList todos={current.todos} color={color} />
            <SubagentList subagents={current.subagents} color={color} />
        </Box>
    );
    const live = (
        <LiveMessage
            live={current.live}
            color={color}
            extraRows={todoRows(current.todos) + subagentRows(current.subagents)}
        />
    );
    const spinner = current.spinner ? (
        <Spinner spinner={current.spinner} now={now} interval={spinnerInterval} color={color} />
    ) : null;
    const input = prompt ? (
        <PromptDialog key={`prompt-${prompt.id}`} prompt={prompt} onAnswer={onAnswer} color={color} />
    ) : canType || onInterrupt ? (
        <PromptInput
            key="main"
            label="> "
            isActive={canType || Boolean(onInterrupt)}
            history={history}
            onHistoryAdd={onHistoryAdd}
            onInterrupt={onInterrupt}
            onEscape={onEscape}
            onExit={onExit}
            onClear={onClear}
            onCycleMode={onCycleMode}
            clipboard={clipboard}
            color={color}
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
            jobs={status.jobs}
            usage={status.usage}
            context={status.context}
            branch={status.branch}
            modeHint={Boolean(onCycleMode)}
            color={color}
        />
    );

    if (status.booting) {
        // Amorçage (connexion, confiance, choix de session) : rien dans <Static> pour que
        // l'accueil, ajouté ensuite en tête, s'affiche en premier ; derniers messages en direct.
        const messages = (current.transcript || [])
            .filter((entry) => entry && (entry.type === "info" || entry.type === "warn" || entry.type === "error"))
            .slice(-BOOT_MESSAGES);
        return (
            <Box flexDirection="column">
                {messages.map((entry) => (
                    <Text key={entry.id} color={color ? BOOT_COLORS[entry.type] : undefined}>{entry.text}</Text>
                ))}
                {prompt ? input : <Text dimColor={color}>Démarrage…</Text>}
            </Box>
        );
    }

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
                    branch={status.branch}
                    color={color}
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
                    {todoList}
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
            {todoList}
            {input}
            {bar}
        </Box>
    );
}

export default App;
