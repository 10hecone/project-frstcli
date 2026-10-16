import { Box, Text } from "ink";
import { renderMarkdownLine, renderMarkdownLite } from "../../markdown.js";

/** Message utilisateur : préfixe « > ». */
export function UserMessage({ text }) {
    const lines = String(text ?? "").split("\n");
    return (
        <Box flexDirection="column" marginTop={1}>
            {lines.map((line, index) => (
                <Text key={index}>
                    <Text color="cyan" bold>{index === 0 ? "> " : "  "}</Text>
                    {line}
                </Text>
            ))}
        </Box>
    );
}

/**
 * Message de l'assistant rendu en Markdown léger.
 * line = true : une seule ligne issue du streaming, avec l'état inCode
 * hérité des lignes précédentes.
 */
export function AssistantMessage({ text, line = false, inCode = false, color = true }) {
    if (line) {
        const mdState = { inCode: Boolean(inCode) };
        return <Text>{renderMarkdownLine(String(text ?? ""), mdState, { color })}</Text>;
    }
    return (
        <Box marginTop={1}>
            <Text>{renderMarkdownLite(String(text ?? ""), { color })}</Text>
        </Box>
    );
}

export function Message({ entry, color = true }) {
    if (!entry) return null;
    if (entry.type === "user") return <UserMessage text={entry.text} />;
    return <AssistantMessage text={entry.text} line={Boolean(entry.line)} inCode={entry.inCode} color={color} />;
}

export default Message;
