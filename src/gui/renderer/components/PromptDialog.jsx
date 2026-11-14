import { useEffect, useRef, useState } from "react";
import { confirmOptions, isTextPrompt } from "../lib/prompts.js";

/**
 * Dialogue modal pour le prompt en attente du store (pendingPrompt) :
 * - confirm / command : boutons o / n / t (raccourcis clavier, Échap = non) ;
 * - ask / secret : champ texte (masqué pour secret), Échap = réponse vide.
 * onAnswer(id, value) n'est appelé qu'une fois par prompt.
 */
export function PromptDialog({ prompt, onAnswer }) {
    const [text, setText] = useState("");
    const doneRef = useRef(false);
    const focusRef = useRef(null);

    useEffect(() => {
        doneRef.current = false;
        setText("");
        if (focusRef.current) focusRef.current.focus();
    }, [prompt && prompt.id]);

    if (!prompt) return null;

    const reply = (value) => {
        if (doneRef.current) return;
        doneRef.current = true;
        onAnswer(prompt.id, value);
    };

    if (isTextPrompt(prompt)) {
        return (
            <div className="overlay" role="dialog" aria-modal="true">
                <form
                    className="dialog"
                    onSubmit={(event) => {
                        event.preventDefault();
                        reply(text);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") reply("");
                    }}
                >
                    <p className="question">{prompt.question}</p>
                    <input
                        ref={focusRef}
                        type={prompt.kind === "secret" ? "password" : "text"}
                        autoComplete="off"
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                    />
                    <div className="actions">
                        <button type="button" className="secondary" onClick={() => reply("")}>
                            Annuler
                        </button>
                        <button type="submit">Valider</button>
                    </div>
                </form>
            </div>
        );
    }

    const options = confirmOptions(prompt);
    const onKeyDown = (event) => {
        if (event.key === "Escape") return reply("n");
        const match = options.find((option) => option.key === event.key.toLowerCase());
        if (match) reply(match.value);
    };

    return (
        <div className="overlay" role="dialog" aria-modal="true" onKeyDown={onKeyDown}>
            <div className="dialog">
                <p className="question">{prompt.question}</p>
                {prompt.kind === "command" && prompt.prefix ? <code className="prefix">{prompt.prefix}</code> : null}
                <div className="actions">
                    {options.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            ref={option.value === "n" ? focusRef : undefined}
                            className={option.value === "o" ? "" : "secondary"}
                            onClick={() => reply(option.value)}
                        >
                            <kbd>{option.key}</kbd> {option.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
