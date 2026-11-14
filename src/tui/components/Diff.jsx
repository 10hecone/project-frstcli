import { Box, Text } from "ink";

const ADD = new Set(["+", "add"]);
const REMOVE = new Set(["-", "remove"]);

/** Une ligne de buildDiff : { type: "+" | "-" | " " | "gap" | "more", num, text }. */
function DiffLine({ line, color = true }) {
    const type = line && line.type;
    const text = String((line && line.text) ?? "");
    const num = line && line.num != null ? String(line.num).padStart(4) : "    ";

    if (type === "gap") return <Text dimColor={color}>{"    ⋮"}</Text>;
    if (type === "more") return <Text dimColor={color}>{`    ${text}`}</Text>;
    if (ADD.has(type)) return <Text color={color ? "green" : undefined}>{`${num} + ${text}`}</Text>;
    if (REMOVE.has(type)) return <Text color={color ? "red" : undefined}>{`${num} - ${text}`}</Text>;
    return <Text dimColor={color}>{`${num}   ${text}`}</Text>;
}

/** Diff coloré : ajouts en vert, suppressions en rouge, contexte grisé. */
export function Diff({ lines, added, removed, color = true }) {
    const list = Array.isArray(lines) ? lines : [];
    const hasCounts = added != null || removed != null;
    return (
        <Box flexDirection="column">
            {list.map((line, index) => (
                <DiffLine key={index} line={line} color={color} />
            ))}
            {hasCounts ? (
                <Text dimColor={color}>
                    {"    "}
                    <Text color={color ? "green" : undefined}>{`+${added ?? 0}`}</Text>
                    {" "}
                    <Text color={color ? "red" : undefined}>{`-${removed ?? 0}`}</Text>
                </Text>
            ) : null}
        </Box>
    );
}

export default Diff;
