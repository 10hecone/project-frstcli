import { useSyncExternalStore } from "react";
import { Box, Text } from "ink";
import { Transcript } from "./components/Transcript.jsx";
import { LiveMessage } from "./components/LiveMessage.jsx";
import { CommandOutput } from "./components/ToolCall.jsx";
import { PromptInput } from "./components/PromptInput.jsx";

function useStore(store) {
    return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

function promptLabel(prompt) {
    if (!prompt) return "> ";
    if (prompt.kind === "confirm") {
        return `${prompt.question} ${prompt.force ? "[o/N]" : "[o/N | t = tout autoriser]"} `;
    }
    if (prompt.kind === "command") return `${prompt.question} [o/N | t = toujours « ${prompt.prefix ?? ""} »] `;
    return `${prompt.question} `;
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
    const canType = Boolean(prompt ? onAnswer : onSubmit && !busy);

    return (
        <Box flexDirection="column">
            <Transcript transcript={current.transcript} version={version} cwd={cwd} color={color} />
            {current.command ? (
                <CommandOutput lines={current.command.lines} hidden={current.command.total - current.command.lines.length} />
            ) : null}
            <LiveMessage live={current.live} color={color} />
            {current.spinner ? <Text color="cyan">{`… ${current.spinner.label ?? ""}`}</Text> : null}
            {canType || onInterrupt ? (
                <PromptInput
                    key={prompt ? `prompt-${prompt.id}` : "main"}
                    label={promptLabel(prompt)}
                    secret={Boolean(prompt && prompt.secret)}
                    isActive={canType || Boolean(onInterrupt)}
                    history={prompt ? [] : history}
                    onHistoryAdd={prompt ? undefined : onHistoryAdd}
                    onInterrupt={onInterrupt}
                    onExit={onExit}
                    onClear={onClear}
                    clipboard={clipboard}
                    onSubmit={(value) => {
                        if (prompt) onAnswer(prompt.id, value);
                        else if (onSubmit && !busy) onSubmit(value);
                    }}
                />
            ) : null}
        </Box>
    );
}

export default App;
