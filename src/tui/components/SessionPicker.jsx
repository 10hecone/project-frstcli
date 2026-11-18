import { useRef, useState } from "react";
import { Box, Text, useInput } from "ink";

/** Nombre maximal de sessions affichées à la fois (la liste défile autour de la sélection). */
export const SESSION_PICKER_ROWS = 8;

/** Fenêtre visible [début, fin[ de la liste, centrée autant que possible sur la sélection. */
export function pickerWindow(total, selected, rows = SESSION_PICKER_ROWS) {
    if (total <= rows) return [0, total];
    const start = Math.min(Math.max(0, selected - Math.floor(rows / 2)), total - rows);
    return [start, start + rows];
}

/**
 * Choix d'une session à reprendre (frst --resume, /resume).
 * sessions = [{ id, title, date }] ; ↑/↓ choisissent, Entrée valide (onAnswer(id)),
 * Échap et Ctrl+C annulent (onAnswer(null)). onAnswer n'est appelé qu'une fois.
 */
export function SessionPicker({ question = "Reprendre une session", sessions = [], isActive = true, onAnswer, color = true }) {
    const list = Array.isArray(sessions) ? sessions : [];
    const selectedRef = useRef(0);
    const doneRef = useRef(false);
    const [, setTick] = useState(0);

    const select = (index) => {
        if (!list.length) return;
        selectedRef.current = (index + list.length) % list.length;
        setTick((tick) => tick + 1);
    };
    const answer = (value) => {
        if (doneRef.current) return;
        doneRef.current = true;
        if (onAnswer) onAnswer(value);
    };

    useInput((input, key) => {
        if (key.ctrl && input === "c") return answer(null);
        if (key.escape) return answer(null);
        if (key.upArrow || (key.shift && key.tab)) return select(selectedRef.current - 1);
        if (key.downArrow || key.tab) return select(selectedRef.current + 1);
        if (key.return) return answer(list.length ? list[selectedRef.current].id : null);
    }, { isActive });

    const selected = selectedRef.current;
    const [start, end] = pickerWindow(list.length, selected);
    return (
        <Box flexDirection="column" borderStyle="round" borderColor={color ? "cyan" : undefined} paddingX={1}>
            <Text bold={color}>{question}</Text>
            {start > 0 ? <Text dimColor={color}>{`  … ${start} plus récente(s)`}</Text> : null}
            {list.slice(start, end).map((session, offset) => {
                const index = start + offset;
                const active = index === selected;
                return (
                    <Text key={session.id} color={color && active ? "cyan" : undefined} bold={color && active}>
                        {`${active ? "❯" : " "} ${index + 1}. ${session.title || "(sans titre)"}`}
                        <Text dimColor={color}>{session.date ? `  ${session.date}` : ""}</Text>
                    </Text>
                );
            })}
            {end < list.length ? <Text dimColor={color}>{`  … ${list.length - end} plus ancienne(s)`}</Text> : null}
            <Text dimColor={color}>↑/↓ choisir · Entrée reprendre · Échap annuler</Text>
        </Box>
    );
}

export default SessionPicker;
