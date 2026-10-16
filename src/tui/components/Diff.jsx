import { Box, Text } from "ink";

const ADD = new Set(["+", "add"]);
const REMOVE = new Set(["-", "remove"]);

/** Une ligne de buildDiff : { type: "+" | "-" | " " | "gap" | "more", num, text }. */
function DiffLine({ line }) {
    const type = line && line.type;
    const text = String((line && line.text) ?? "");
    const num = line && line.num != null ? String(line.num).padStart(4) : "    ";

    if (type === "gap") return <Text dimColor>{"    ⋮"}</Text>;
    if (type === "more") return <Text dimColor>{`    ${text}`}</Text>;
    if (ADD.has(type)) return <Text color="green">{`${num} + ${text}`}</Text>;
    if (REMOVE.has(type)) return <Text color="red">{`${num} - ${text}`}</Text>;
    return <Text dimColor>{`${num}   ${text}`}</Text>;
}

/** Diff coloré : ajouts en vert, suppressions en rouge, contexte grisé. */
export function Diff({ lines, added, removed }) {
    const list = Array.isArray(lines) ? lines : [];
    const hasCounts = added != null || removed != null;
    return (
        <Box flexDirection="column">
            {list.map((line, index) => (
                <DiffLine key={index} line={line} />
            ))}
            {hasCounts ? (
                <Text dimColor>
                    {"    "}
                    <Text color="green">{`+${added ?? 0}`}</Text>
                    {" "}
                    <Text color="red">{`-${removed ?? 0}`}</Text>
                </Text>
            ) : null}
        </Box>
    );
}

export default Diff;
