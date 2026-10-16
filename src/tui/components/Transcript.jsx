import { Box, Static, Text } from "ink";
import { Welcome } from "./Welcome.jsx";

function Entry({ entry, version, cwd }) {
    switch (entry.type) {
        case "welcome":
            return <Welcome version={version} model={entry.model} workspace={entry.workspace} cwd={cwd} />;
        case "user":
            return <Text><Text color="cyan">{"> "}</Text>{entry.text}</Text>;
        case "assistant":
            return <Text>{entry.text}</Text>;
        case "tool":
            return <Text><Text color="green">{"● "}</Text><Text bold>{entry.name}</Text>{entry.arg ? ` ${entry.arg}` : ""}</Text>;
        case "result":
            return <Text color={entry.tone === "error" ? "red" : undefined} dimColor={entry.tone !== "error"}>{`  ⎿ ${entry.text}`}</Text>;
        case "plan":
            return (
                <Box flexDirection="column">
                    {(entry.items || []).map((item, index) => (
                        <Text key={index}>{`${index + 1}. ${item}`}</Text>
                    ))}
                </Box>
            );
        case "diff":
            return (
                <Box flexDirection="column">
                    {(entry.lines || []).map((line, index) => (
                        <Text key={index} color={line.type === "add" ? "green" : line.type === "remove" ? "red" : undefined}>
                            {`${line.type === "add" ? "+" : line.type === "remove" ? "-" : " "} ${line.text ?? ""}`}
                        </Text>
                    ))}
                </Box>
            );
        case "info":
            return <Text dimColor>{entry.text}</Text>;
        case "warn":
            return <Text color="yellow">{entry.text}</Text>;
        case "error":
            return <Text color="red">{entry.text}</Text>;
        case "print":
            return (
                <Box flexDirection="column">
                    {(entry.lines || []).map((line, index) => (
                        <Text key={index} dimColor={Boolean(entry.command)}>{line}</Text>
                    ))}
                </Box>
            );
        default:
            return null;
    }
}

export function Transcript({ transcript, version, cwd }) {
    return (
        <Static items={transcript || []}>
            {(entry) => (
                <Box key={entry.id} flexDirection="column">
                    <Entry entry={entry} version={version} cwd={cwd} />
                </Box>
            )}
        </Static>
    );
}

export default Transcript;
