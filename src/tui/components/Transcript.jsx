import { Box, Static, Text } from "ink";
import { Welcome } from "./Welcome.jsx";
import { UserMessage, AssistantMessage } from "./Message.jsx";
import { ToolCall, ToolResult, CommandOutput } from "./ToolCall.jsx";
import { Diff } from "./Diff.jsx";
import { Plan } from "./Plan.jsx";

export function Entry({ entry, version, cwd, color }) {
    switch (entry.type) {
        case "welcome":
            return <Welcome version={version} model={entry.model} workspace={entry.workspace} cwd={cwd} color={color} />;
        case "user":
            return <UserMessage text={entry.text} color={color} />;
        case "assistant":
            return <AssistantMessage text={entry.text} line={Boolean(entry.line)} inCode={entry.inCode} color={color} />;
        case "tool":
            return <ToolCall name={entry.name} arg={entry.arg} color={color} />;
        case "result":
            return <ToolResult text={entry.text} tone={entry.tone} color={color} />;
        case "plan":
            return <Plan items={entry.items} color={color} />;
        case "diff":
            return <Diff lines={entry.lines} added={entry.added} removed={entry.removed} color={color} />;
        case "info":
            return <Text dimColor={color}>{entry.text}</Text>;
        case "warn":
            return <Text color={color ? "yellow" : undefined}>{`! ${entry.text}`}</Text>;
        case "error":
            return <Text color={color ? "red" : undefined}>{`Erreur : ${entry.text}`}</Text>;
        case "print":
            if (entry.command) return <CommandOutput lines={entry.lines} hidden={entry.hidden || 0} color={color} />;
            return (
                <Box flexDirection="column">
                    {(entry.lines || []).map((line, index) => (
                        <Text key={index}>{line}</Text>
                    ))}
                </Box>
            );
        default:
            return null;
    }
}

export function Transcript({ transcript, version, cwd, color = true }) {
    return (
        <Static items={transcript || []}>
            {(entry) => (
                <Box key={entry.id} flexDirection="column">
                    <Entry entry={entry} version={version} cwd={cwd} color={color} />
                </Box>
            )}
        </Static>
    );
}

export default Transcript;
