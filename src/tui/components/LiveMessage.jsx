import { useEffect, useState } from "react";
import { Box, Text, useStdout } from "ink";
import { renderMarkdownLine } from "../../markdown.js";

// Lignes réservées sous la zone dynamique (spinner, marge, bordures haut/bas de la saisie, ligne de saisie, barre d'état).
const RESERVED_ROWS = 6;
const DEFAULT_ROWS = 24;

/** Garde seulement les dernières lignes qui tiennent dans la hauteur disponible. */
export function tailLines(text, rows) {
    const lines = String(text ?? "").split("\n");
    const max = Math.max(1, Math.floor(rows) - RESERVED_ROWS);
    return lines.length > max ? lines.slice(-max) : lines;
}

/**
 * Hauteur du terminal, recalculée à chaque événement « resize » de stdout
 * (étape 10). L'écouteur est retiré au démontage.
 */
export function useTerminalRows(stdout) {
    const read = () => (stdout && stdout.rows) || DEFAULT_ROWS;
    const [rows, setRows] = useState(read);
    useEffect(() => {
        if (!stdout || typeof stdout.on !== "function") return undefined;
        const onResize = () => setRows(read());
        onResize();
        stdout.on("resize", onResize);
        return () => {
            if (typeof stdout.off === "function") stdout.off("resize", onResize);
            else if (typeof stdout.removeListener === "function") stdout.removeListener("resize", onResize);
        };
    }, [stdout]);
    return rows;
}

/**
 * Message en cours de streaming : seules ses dernières lignes sont affichées
 * (hauteur du terminal via useStdout, mise à jour au redimensionnement).
 * Les lignes terminées sont déjà dans <Static>.
 */
export function LiveMessage({ live, rows, color = true }) {
    const { stdout } = useStdout();
    const terminalRows = useTerminalRows(stdout);
    if (!live || !live.text) return null;

    const height = rows ?? terminalRows;
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
