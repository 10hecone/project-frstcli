import { useRef, useState } from "react";
import { Box, Text, useInput } from "ink";

/**
 * Options d'une confirmation : o = oui une fois, n = non, t = toujours.
 * Avec force (ex. prolongation des tours), pas d'option « toujours ».
 * Pour une commande, « toujours » enregistre le préfixe (réponse "t" → "always").
 */
export function confirmOptions({ kind = "confirm", force = false, prefix = "" } = {}) {
    const options = [
        { value: "o", label: "Oui (une fois)" },
        { value: "n", label: "Non" }
    ];
    if (kind === "command") options.push({ value: "t", label: `Toujours « ${prefix} »` });
    else if (!force) options.push({ value: "t", label: "Toujours (tout autoriser pour la session)" });
    return options;
}

/**
 * Dialogue de confirmation.
 * - ↑/↓ (ou ←/→, Tab) choisissent, Entrée valide ; o/n/t répondent directement.
 * - Échap et Ctrl+C répondent « n ». Par défaut, la sélection est sur « Non ».
 * onAnswer(value) n'est appelé qu'une fois.
 */
export function ConfirmDialog({ question = "", kind = "confirm", force = false, prefix = "", isActive = true, onAnswer, color = true }) {
    const options = confirmOptions({ kind, force, prefix });
    const selectedRef = useRef(Math.max(0, options.findIndex((option) => option.value === "n")));
    const doneRef = useRef(false);
    const [, setTick] = useState(0);
const hasAlways = options.some((option) => option.value === "t");

    const select = (index) => {
        selectedRef.current = (index + options.length) % options.length;
        setTick((tick) => tick + 1);
    };
    const answer = (value) => {
        if (doneRef.current) return;
        doneRef.current = true;
        if (onAnswer) onAnswer(value);
    };

    useInput((input, key) => {
        if (key.ctrl && input === "c") return answer("n");
        if (key.upArrow || key.leftArrow || (key.shift && key.tab)) return select(selectedRef.current - 1);
        if (key.downArrow || key.rightArrow || key.tab) return select(selectedRef.current + 1);
        if (key.return) return answer(options[selectedRef.current].value);
        if (key.escape) return answer("n");
        if (key.ctrl || key.meta) return;
        const ch = String(input ?? "").trim().toLowerCase();
        if (ch === "o" || ch === "y") return answer("o");
        if (ch === "n") return answer("n");
        if ((ch === "t" || ch === "a") && hasAlways) return answer("t");
    }, { isActive });

    const selected = selectedRef.current;
    return (
        <Box flexDirection="column" borderStyle="round" borderColor={color ? "yellow" : undefined} paddingX={1}>
            <Text bold={color}>{question}</Text>
            {options.map((option, index) => (
                <Text key={option.value} color={color && index === selected ? "cyan" : undefined} bold={color && index === selected}>
                    {`${index === selected ? "❯" : " "} ${option.value} — ${option.label}`}
                </Text>
            ))}
            <Text dimColor={color}>{`↑/↓ choisir · Entrée valider · ${hasAlways ? "o/n/t" : "o/n"} · Échap = non`}</Text>
        </Box>
    );
}

export default ConfirmDialog;
