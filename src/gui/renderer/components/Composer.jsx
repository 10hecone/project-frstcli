import { useEffect, useRef, useState } from "react";

/**
 * Zone de saisie.
 * - Entrée envoie, Maj+Entrée ajoute une ligne.
 * - ↑ / ↓ parcourent l'historique de la session quand le curseur est en début / fin.
 * - Échap interrompt la tâche en cours.
 */
export function Composer({ busy = false, disabled = false, onSubmit, onInterrupt }) {
    const [value, setValue] = useState("");
    const history = useRef([]);
    const cursor = useRef(-1);
    const inputRef = useRef(null);

    useEffect(() => {
        if (!disabled && inputRef.current) inputRef.current.focus();
    }, [disabled, busy]);

    const send = () => {
        const text = value.trim();
        if (!text || busy || disabled) return;
        history.current.push(text);
        cursor.current = -1;
        setValue("");
        if (onSubmit) onSubmit(text);
    };

    const browse = (direction) => {
        const list = history.current;
        if (!list.length) return false;
        let next = cursor.current === -1 ? list.length : cursor.current;
        next += direction;
        if (next < 0) next = 0;
        if (next >= list.length) {
            cursor.current = -1;
            setValue("");
            return true;
        }
        cursor.current = next;
        setValue(list[next]);
        return true;
    };

    const onKeyDown = (event) => {
        const el = event.currentTarget;
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            send();
        } else if (event.key === "Escape" && busy) {
            event.preventDefault();
            if (onInterrupt) onInterrupt();
        } else if (event.key === "ArrowUp" && el.selectionStart === 0 && el.selectionEnd === 0) {
            if (browse(-1)) event.preventDefault();
        } else if (event.key === "ArrowDown" && el.selectionStart === value.length) {
            if (browse(1)) event.preventDefault();
        }
    };

    return (
        <footer className="composer">
            <textarea
                ref={inputRef}
                value={value}
                rows={Math.min(8, Math.max(1, value.split("\n").length))}
                placeholder={
                    busy ? "Réponse en cours… (Échap pour interrompre)" : "Écris un message ou une commande /…"
                }
                disabled={disabled}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={onKeyDown}
            />
            {busy ? (
                <button type="button" className="secondary" onClick={onInterrupt}>
                    Interrompre
                </button>
            ) : (
                <button type="button" onClick={send} disabled={disabled || !value.trim()}>
                    Envoyer
                </button>
            )}
        </footer>
    );
}
