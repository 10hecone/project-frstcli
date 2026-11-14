import { useEffect, useState } from "react";

function elapsed(startedAt, now) {
    const seconds = Math.max(0, Math.floor((now - (startedAt || now)) / 1000));
    return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/** Estimation grossière (≈ 3,5 caractères par token), comme /usage hors API. */
function estimateTokens(chars) {
    return chars > 0 ? Math.max(1, Math.round(chars / 3.5)) : 0;
}

/**
 * Indicateur de chargement du store : { id, label, startedAt }.
 * streamedChars : longueur du texte reçu en streaming (estimation des tokens).
 */
export function Spinner({ spinner, streamedChars = 0 }) {
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        if (!spinner) return undefined;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [spinner]);

    if (!spinner) return null;
    const tokens = estimateTokens(streamedChars);
    return (
        <div className="spinner" role="status">
            <span className="dot" aria-hidden="true" />
            <span>{spinner.label || "En cours"}</span>
            <span className="muted">
                ({elapsed(spinner.startedAt, now)}
                {tokens ? ` · ≈ ${tokens.toLocaleString("fr-FR")} tokens` : ""}
                {" · "}
                <kbd>Échap</kbd> pour interrompre)
            </span>
        </div>
    );
}
