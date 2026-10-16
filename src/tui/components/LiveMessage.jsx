import { Box, Text, useStdout } from "ink";
import { renderMarkdownLine } from "../../markdown.js";

// Lignes réservées sous la zone dynamique (spinner, saisie, marge).
const RESERVED_ROWS = 4;
const DEFAULT_ROWS = 24;

/** Garde seulement les dernières lignes qui tiennent dans la hauteur disponible. */
export function tailLines(text, rows) {
    const lines = String(text ?? "").split("\n");
    const max = Math.max(1, Math.floor(rows) - RESERVED_ROWS);
    return lines.length > max ? lines.slice(-max) : lines;
}

/**
 * Message en cours de streaming : seules ses dernières lignes sont affichées
 * (hauteur du terminal via useStdout). Les lignes terminées sont déjà dans <Static>.
 */
export function LiveMessage({ live, rows, color = true }) {
    const { stdout } = useStdout();
    if (!live || !live.text) return null;

    const height = rows ?? (stdout && stdout.rows) ?? DEFAULT_ROWS;
    const lines = tailLines(live.text, height);
    const mdState = { inCode: Boolean(live.inCode) };

    return (
        <Box flexDirection="column">
            {lines.map((line, index) => (
                <Text key={index}>{renderMarkdownLine(line, mdState, { color })}</Text>
            ))}
        </Box>
    );
}

export default LiveMessage;
