import { Box, Text } from "ink";
import { toolLabel } from "../../tool-labels.js";

/** Appel d'outil façon Claude Code : « ● Lire src/a.js ». */
export function ToolCall({ name, arg }) {
    const detail = arg == null || arg === "" ? "" : String(arg);
    return (
        <Box marginTop={1}>
            <Text>
                <Text color="green">{"● "}</Text>
                <Text bold>{toolLabel(name)}</Text>
                {detail ? <Text dimColor>{` ${detail}`}</Text> : null}
            </Text>
        </Box>
    );
}

/** Résumé du résultat : « ⎿ résumé », en rouge si tone === "error". */
export function ToolResult({ text, tone }) {
    const isError = tone === "error";
    const lines = String(text ?? "").split("\n");
    return (
        <Box flexDirection="column">
            {lines.map((line, index) => (
                <Text key={index} color={isError ? "red" : undefined} dimColor={!isError}>
                    {`${index === 0 ? "  ⎿ " : "    "}${line}`}
                </Text>
            ))}
        </Box>
    );
}

/** Sortie en direct de run_command, repliée sur ses dernières lignes. */
export function CommandOutput({ lines, hidden = 0 }) {
    const list = Array.isArray(lines) ? lines : [];
    return (
        <Box flexDirection="column">
            {hidden > 0 ? <Text dimColor>{`    … ${hidden} ligne(s) masquée(s)`}</Text> : null}
            {list.map((line, index) => (
                <Text key={index} dimColor>{`    ${line}`}</Text>
            ))}
        </Box>
    );
}

export default ToolCall;
