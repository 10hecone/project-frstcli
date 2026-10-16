import { useEffect, useRef, useState } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import { Entry } from "./Transcript.jsx";

/** Nombre d'entrées sautées par PgUp / PgDn. */
export const PAGE_ENTRIES = 5;

/** Nombre d'entrées sautées par cran de molette. */
export const WHEEL_ENTRIES = 1;

const MOUSE_SGR = /\u001b?\[<(\d+);(\d+);(\d+)([Mm])/g;

/** Vrai si l'entrée contient une séquence souris SGR (molette, clic). */
export function isMouseInput(input) {
    return typeof input === "string" && /\[<\d+;\d+;\d+[Mm]/.test(input);
}

/**
 * Molette au format SGR (?1006) : "\x1b[<64;x;yM" = haut, 65 = bas. Ink
 * retire parfois le \x1b initial. Une même chaîne peut contenir plusieurs
 * événements. Renvoie le nombre net de crans : > 0 vers le haut (plus
 * ancien), < 0 vers le bas, 0 si aucune molette.
 */
export function parseWheel(input) {
    if (typeof input !== "string" || !input) return 0;
    let delta = 0;
    for (const m of input.matchAll(MOUSE_SGR)) {
        const button = Number(m[1]);
        if (m[4] !== "M" || !(button & 64) || button & 128) continue;
        delta += button & 1 ? -1 : 1;
    }
    return delta;
}

/**
 * Fenêtre d'entrées à afficher : offset = nombre d'entrées masquées en bas
 * (0 = collé au bas de la conversation). On ne rend jamais plus de
 * maxEntries entrées (chaque entrée fait au moins une ligne), ce qui garde
 * le rendu rapide même avec un long historique.
 */
export function visibleWindow(length, offset, maxEntries) {
    const total = Math.max(0, Math.floor(length) || 0);
    const max = Math.max(0, total - 1);
    const off = Math.min(Math.max(0, Math.floor(offset) || 0), max);
    const end = total - off;
    const start = Math.max(0, end - Math.max(1, Math.floor(maxEntries) || 1));
    return { start, end, offset: off };
}

/**
 * Conversation du mode plein écran : zone qui prend toute la hauteur libre
 * entre l'en-tête fixe et la saisie. Le contenu trop haut est coupé par le
 * haut (justifyContent flex-end + overflow hidden) : les derniers messages
 * restent visibles. PgUp / PgDn font défiler par paquets d'entrées.
 * children (flux en cours, sortie de commande, spinner) n'est affiché que
 * lorsque la vue est collée en bas.
 */
export function ConversationView({ transcript, version, cwd, color = true, rows = 24, isActive = true, children }) {
    const items = (transcript || []).filter((entry) => entry && entry.type !== "welcome");
    const [offset, setOffset] = useState(0);
    const { stdin } = useStdin();
    const maxRef = useRef(0);
    maxRef.current = Math.max(0, items.length - 1);

    // Molette : Ink avale les séquences souris SGR avant useInput, on lit donc
    // directement l'événement "data" de stdin (sans gêner la lecture d'Ink).
    useEffect(() => {
        if (!isActive || !stdin || typeof stdin.on !== "function") return undefined;
        const onData = (chunk) => {
            const wheel = parseWheel(String(chunk));
            if (wheel !== 0) setOffset((o) => Math.min(Math.max(0, o + wheel * WHEEL_ENTRIES), maxRef.current));
        };
        stdin.on("data", onData);
        return () => {
            if (typeof stdin.off === "function") stdin.off("data", onData);
            else if (typeof stdin.removeListener === "function") stdin.removeListener("data", onData);
        };
    }, [stdin, isActive]);

    useInput(
        (input, key) => {
            if (isMouseInput(input)) return;
            if (key.pageUp) setOffset((o) => Math.min(o + PAGE_ENTRIES, maxRef.current));
            else if (key.pageDown) setOffset((o) => Math.max(0, o - PAGE_ENTRIES));
        },
        { isActive }
    );

    const win = visibleWindow(items.length, offset, rows);
    const shown = items.slice(win.start, win.end);

    return (
        <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden" justifyContent="flex-end">
            {shown.map((entry) => (
                <Box key={entry.id} flexDirection="column" flexShrink={0}>
                    <Entry entry={entry} version={version} cwd={cwd} color={color} />
                </Box>
            ))}
            {win.offset === 0 ? children : null}
            {win.offset > 0 ? (
                <Box flexShrink={0}>
                    <Text dimColor wrap="truncate-end">{`↓ ${win.offset} entrée(s) plus récente(s) · molette ou PgDn pour revenir en bas`}</Text>
                </Box>
            ) : null}
        </Box>
    );
}

export default ConversationView;
