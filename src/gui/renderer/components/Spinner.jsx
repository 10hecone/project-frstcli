import { useEffect, useState } from "react";

function elapsed(startedAt, now) {
    const seconds = Math.max(0, Math.floor((now - (startedAt || now)) / 1000));
    return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/** Indicateur de chargement du store : { id, label, startedAt }. */
export function Spinner({ spinner }) {
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        if (!spinner) return undefined;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [spinner]);

    if (!spinner) return null;
    return (
        <div className="spinner" role="status">
            <span className="dot" aria-hidden="true" />
            <span>{spinner.label || "En cours"}</span>
            <span className="muted">{elapsed(spinner.startedAt, now)}</span>
        </div>
    );
}
