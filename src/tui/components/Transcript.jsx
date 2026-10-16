import { Box, Static, Text } from "ink";
import { Welcome } from "./Welcome.jsx";
import { UserMessage, AssistantMessage } from "./Message.jsx";
import { ToolCall, ToolResult, CommandOutput } from "./ToolCall.jsx";
import { Diff } from "./Diff.jsx";
import { Plan } from "./Plan.jsx";

function Entry({ entry, version, cwd, color }) {
    switch (entry.type) {
        case "welcome":
            return <Welcome version={version} model={entry.model} workspace={entry.workspace} cwd={cwd} />;
        case "user":
            return <UserMessage text={entry.text} />;
        case "assistant":
            return <AssistantMessage text={entry.text} line={Boolean(entry.line)} inCode={entry.inCode} color={color} />;
        case "tool":
            return <ToolCall name={entry.name} arg={entry.arg} />;
        case "result":
            return <ToolResult text={entry.text} tone={entry.tone} />;
        case "plan":
            return <Plan items={entry.items} />;
        case "diff":
            return <Diff lines={entry.lines} added={entry.added} removed={entry.removed} />;
        case "info":
            return <Text dimColor>{entry.text}</Text>;
        case "warn":
            return <Text color="yellow">{`! ${entry.text}`}</Text>;
        case "error":
            return <Text color="red">{`Erreur : ${entry.text}`}</Text>;
        case "print":
            if (entry.command) return <CommandOutput lines={entry.lines} hidden={entry.hidden || 0} />;
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
