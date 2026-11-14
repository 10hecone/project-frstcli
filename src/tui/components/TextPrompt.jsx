import { useRef, useState } from "react";
import { Box, Text, useInput } from "ink";

/**
 * Question libre sur une ligne.
 * - Entrée valide. Retour arrière efface. Ctrl+U vide la saisie.
 * - Échap et Ctrl+C annulent (réponse vide).
 * - secret : la saisie est affichée en « • », la valeur n'est jamais rendue.
 * onAnswer(value) n'est appelé qu'une fois.
 */
export function TextPrompt({ question = "", secret = false, isActive = true, onAnswer, color = true }) {
    const valueRef = useRef("");
    const doneRef = useRef(false);
    const [, setTick] = useState(0);

    const setValue = (next) => {
        valueRef.current = next;
        setTick((tick) => tick + 1);
    };
    const answer = (value) => {
        if (doneRef.current) return;
        doneRef.current = true;
        valueRef.current = "";
        setTick((tick) => tick + 1);
        if (onAnswer) onAnswer(value);
    };

    useInput((input, key) => {
        if (key.ctrl && input === "c") return answer("");
        if (key.return) return answer(valueRef.current);
        if (key.escape) return answer("");
        if (key.backspace || key.delete) return setValue(Array.from(valueRef.current).slice(0, -1).join(""));
        if (key.ctrl && input === "u") return setValue("");
        if (key.ctrl || key.meta || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.tab) return;
        const text = String(input ?? "").replace(/[\r\n]/g, "");
        if (text) setValue(valueRef.current + text);
    }, { isActive });

    const value = valueRef.current;
    const shown = secret ? "•".repeat(Array.from(value).length) : value;
    return (
        <Box flexDirection="column">
            <Box>
                <Text bold={color}>{`${question}`}</Text>
                <Text>{shown}</Text>
                <Text inverse> </Text>
            </Box>
            <Text dimColor={color}>{secret ? "Saisie masquée · Entrée valider · Échap annuler" : "Entrée valider · Échap annuler"}</Text>
        </Box>
    );
}

export default TextPrompt;
