import { useEffect, useState } from "react";
import { Box, Text } from "ink";

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const SPINNER_INTERVAL_MS = 100;

/** Durée écoulée lisible : « 7 s », « 2 min 05 s ». */
export function formatElapsed(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    if (total < 60) return `${total} s`;
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
}

/**
 * Indicateur d'activité : frame animée, libellé, durée depuis spinner.startedAt
 * et rappel Ctrl+C. Le timer ne tourne que si un spinner est actif et il est
 * nettoyé au démontage ou dès que le spinner disparaît.
 */
export function Spinner({ spinner, now = Date.now, interval = SPINNER_INTERVAL_MS, color = true }) {
    const [frame, setFrame] = useState(0);
    const active = Boolean(spinner);

    useEffect(() => {
        if (!active) return undefined;
        const timer = setInterval(() => {
            setFrame((value) => (value + 1) % SPINNER_FRAMES.length);
        }, interval);
        return () => clearInterval(timer);
    }, [active, interval]);

    if (!spinner) return null;

    const current = now();
    const startedAt = Number.isFinite(spinner.startedAt) ? spinner.startedAt : current;
    const elapsed = formatElapsed(current - startedAt);

    return (
        <Box>
            <Text color={color ? "cyan" : undefined}>{`${SPINNER_FRAMES[frame % SPINNER_FRAMES.length]} `}</Text>
            <Text>{String(spinner.label ?? "")}</Text>
            <Text dimColor={color}>{` · ${elapsed} · Ctrl+C pour interrompre`}</Text>
        </Box>
    );
}

export default Spinner;
