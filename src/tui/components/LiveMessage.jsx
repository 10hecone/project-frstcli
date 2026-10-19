import { useEffect, useState } from "react";
import { Box, Text, useStdout } from "ink";
import { renderMarkdownLine } from "../../markdown.js";

// Lignes réservées sous la zone dynamique (spinner, marge, bordures haut/bas de la saisie, ligne de saisie, barre d'état).
const RESERVED_ROWS = 6;
const DEFAULT_ROWS = 24;

/**
 * Garde seulement les dernières lignes qui tiennent dans la hauteur disponible.
 * extra : lignes réservées en plus (ex. liste de tâches au-dessus de la saisie).
 */
export function tailLines(text, rows, extra = 0) {
    const lines = String(text ?? "").split("\n");
    const reserved = RESERVED_ROWS + Math.max(0, Math.floor(Number(extra) || 0));
    const max = Math.max(1, Math.floor(rows) - reserved);
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

const DEFAULT_COLUMNS = 80;

/**
 * Largeur utile pour les lignes pleine largeur (bordures, barre d'état) :
 * colonnes - 1. Dans cmd (conhost), écrire jusqu'à la dernière colonne
 * provoque un retour à la ligne automatique qui fausse l'effacement d'Ink
 * (texte dupliqué après un redimensionnement).
 */
export function usableWidth(columns) {
    const n = Math.floor(Number(columns) || DEFAULT_COLUMNS);
    return Math.max(10, n - 1);
}

/** Largeur du terminal, recalculée à chaque événement « resize » de stdout. */
export function useTerminalColumns(stdout) {
    const read = () => (stdout && stdout.columns) || DEFAULT_COLUMNS;
    const [columns, setColumns] = useState(read);
    useEffect(() => {
        if (!stdout || typeof stdout.on !== "function") return undefined;
        const onResize = () => setColumns(read());
        onResize();
        stdout.on("resize", onResize);
        return () => {
            if (typeof stdout.off === "function") stdout.off("resize", onResize);
            else if (typeof stdout.removeListener === "function") stdout.removeListener("resize", onResize);
        };
    }, [stdout]);
    return columns;
}

/**
 * Message en cours de streaming : seules ses dernières lignes sont affichées
 * (hauteur du terminal via useStdout, mise à jour au redimensionnement).
 * Les lignes terminées sont déjà dans <Static>.
 */
export function LiveMessage({ live, rows, color = true, extraRows = 0 }) {
    const { stdout } = useStdout();
    const terminalRows = useTerminalRows(stdout);
    if (!live || !live.text) return null;

    const height = rows ?? terminalRows;
    const lines = tailLines(live.text, height, extraRows);
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
