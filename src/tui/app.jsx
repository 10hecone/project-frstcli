import { useSyncExternalStore } from "react";
import { Box, Text } from "ink";
import { Transcript } from "./components/Transcript.jsx";
import { LiveMessage } from "./components/LiveMessage.jsx";
import { CommandOutput } from "./components/ToolCall.jsx";
import { PromptInput } from "./components/PromptInput.jsx";
import { ConfirmDialog } from "./components/ConfirmDialog.jsx";
import { TextPrompt } from "./components/TextPrompt.jsx";

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
    color = true
}) {
    const current = useStore(store);
    const busy = Boolean(busyProp || (current.status && current.status.busy));
    const prompt = current.pendingPrompt;
    const canType = Boolean(onSubmit && !busy);

    return (
        <Box flexDirection="column">
            <Transcript transcript={current.transcript} version={version} cwd={cwd} color={color} />
            {current.command ? (
                <CommandOutput lines={current.command.lines} hidden={current.command.total - current.command.lines.length} />
            ) : null}
            <LiveMessage live={current.live} color={color} />
            {current.spinner ? <Text color="cyan">{`… ${current.spinner.label ?? ""}`}</Text> : null}
            {prompt ? (
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
            ) : null}
        </Box>
    );
}

export default App;
