import { useEffect, useRef } from "react";

/**
 * Dialogue de confiance : affiché quand ouvrir un dossier demande une confirmation
 * (request = { path, message } renvoyé par openFolder / pickFolder avec needsTrust).
 * Échap ou « Ne pas ouvrir » refuse : l'appelant revient à l'accueil.
 * Le focus part sur le refus, comme PromptDialog pour les confirmations.
 */
export function TrustDialog({ request, onAccept, onDecline }) {
    const declineRef = useRef(null);

    useEffect(() => {
        if (request && declineRef.current) declineRef.current.focus();
    }, [request && request.path]);

    if (!request) return null;

    return (
        <div
            className="overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trust-title"
            onKeyDown={(event) => {
                if (event.key === "Escape") onDecline();
            }}
        >
            <div className="dialog">
                <p className="question" id="trust-title">
                    Faire confiance aux fichiers de ce dossier ?
                </p>
                <code className="prefix">{request.path}</code>
                {request.message ? <p className="dialog-note">{request.message}</p> : null}
                <div className="actions">
                    <button type="button" ref={declineRef} className="secondary" onClick={onDecline}>
                        Ne pas ouvrir
                    </button>
                    <button type="button" onClick={() => onAccept(request.path)}>
                        Faire confiance et ouvrir
                    </button>
                </div>
            </div>
        </div>
    );
}
