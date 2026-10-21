import { Box, Text } from "ink";
import { toolLabel } from "../../tool-labels.js";

/** Appel d'outil façon Claude Code : « ● Lire src/a.js ». */
export function ToolCall({ name, arg, color = true }) {
    const detail = arg == null || arg === "" ? "" : String(arg);
    return (
        <Box marginTop={1}>
            <Text>
                <Text color={color ? "green" : undefined}>{"● "}</Text>
                <Text bold={color}>{toolLabel(name)}</Text>
                {detail ? <Text dimColor={color}>{` ${detail}`}</Text> : null}
            </Text>
        </Box>
    );
}

/** Résumé du résultat : « ⎿ résumé », en rouge si tone === "error". */
export function ToolResult({ text, tone, color = true }) {
    const isError = tone === "error";
    const lines = String(text ?? "").split("\n");
    return (
        <Box flexDirection="column">
            {lines.map((line, index) => (
                <Text key={index} color={color && isError ? "red" : undefined} dimColor={color && !isError}>
                    {`${index === 0 ? "  ⎿ " : "    "}${line}`}
                </Text>
            ))}
        </Box>
    );
}

/** Sortie en direct de run_command, repliée sur ses dernières lignes. */
export function CommandOutput({ lines, hidden = 0, color = true }) {
    const list = Array.isArray(lines) ? lines : [];
    return (
        <Box flexDirection="column">
            {hidden > 0 ? <Text dimColor={color}>{`    … ${hidden} ligne(s) masquée(s)`}</Text> : null}
            {list.map((line, index) => (
                <Text key={index} dimColor={color}>{`    ${line}`}</Text>
            ))}
        </Box>
    );
}

export default ToolCall;
