import { useState, useSyncExternalStore } from "react";
import { Box, Text, useInput } from "ink";
import { Transcript } from "./components/Transcript.jsx";
import { LiveMessage } from "./components/LiveMessage.jsx";
import { CommandOutput } from "./components/ToolCall.jsx";

function useStore(store) {
    return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** Saisie minimale sur une ligne : Entrée envoie, Retour arrière efface, Ctrl+C interrompt. */
function InputLine({ label, secret = false, onSubmit, onInterrupt, isActive = true }) {
    const [value, setValue] = useState("");

    useInput((input, key) => {
        if (key.ctrl && input === "c") {
            if (onInterrupt) onInterrupt();
            return;
        }
        if (key.return) {
            const submitted = value;
            setValue("");
            if (onSubmit) onSubmit(submitted);
            return;
        }
        if (key.backspace || key.delete) {
            setValue((current) => current.slice(0, -1));
            return;
        }
        if (input && !key.ctrl && !key.meta) setValue((current) => current + input);
    }, { isActive: Boolean(isActive) });

    const shown = secret ? "•".repeat(value.length) : value;
    return (
        <Box marginTop={1}>
            <Text>
                <Text color="cyan" bold>{label}</Text>
                {shown}
                <Text inverse>{" "}</Text>
            </Text>
        </Box>
    );
}

function promptLabel(prompt) {
    if (!prompt) return "> ";
    if (prompt.kind === "confirm") {
        return `${prompt.question} ${prompt.force ? "[o/N]" : "[o/N | t = tout autoriser]"} `;
    }
    if (prompt.kind === "command") return `${prompt.question} [o/N | t = toujours « ${prompt.prefix ?? ""} »] `;
    return `${prompt.question} `;
}

export function App({ store, version = "", cwd = process.cwd(), onSubmit, onAnswer, onInterrupt, busy: busyProp = false, color = true }) {
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
                <InputLine
                    key={prompt ? `prompt-${prompt.id}` : "main"}
                    label={promptLabel(prompt)}
                    secret={Boolean(prompt && prompt.secret)}
                    isActive={canType || Boolean(onInterrupt)}
                    onInterrupt={onInterrupt}
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
