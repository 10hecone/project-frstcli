import { useEffect, useRef, useState } from "react";
import { Gauge } from "./Gauge.jsx";
import { RefreshIcon } from "./Icons.jsx";
import { resetTime } from "../lib/format.js";
import { compactThresholdLabel, formatTokens, level } from "../lib/usage.js";

const RADIUS = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Anneau de progression : stroke-dashoffset en transition, qui repart de la valeur affichée. */
function Ring({ value }) {
    const p = value == null ? 0 : value;
    return (
        <svg className={`ring ${level(value)}`} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <circle className="ring-track" cx="8" cy="8" r={RADIUS} />
            <circle
                className="ring-fill"
                cx="8"
                cy="8"
                r={RADIUS}
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={CIRCUMFERENCE * (1 - p / 100)}
                transform="rotate(-90 8 8)"
            />
        </svg>
    );
}

const label = (value) => (value == null ? "—" : `${Math.round(value)} %`);

/** Répartition du contexte (GET /chats/{id}/context) : tokens, catégories, seuil. */
function ContextBreakdown({ details }) {
    const threshold = compactThresholdLabel(details);
    return (
        <div className="context-breakdown">
            <p className="context-tokens">
                {formatTokens(details.usedTokens)} / {formatTokens(details.contextWindow)} tokens
                {details.measured ? "" : " (estimé)"}
                {details.modelName ? <span className="muted"> · {details.modelName}</span> : null}
            </p>
            {details.categories.length ? (
                <ul className="context-categories">
                    {details.categories.map((category) => (
                        <li key={category.key}>
                            <span className="context-category">{category.label}</span>
                            <span className="context-bar" aria-hidden="true">
                                <span style={{ width: `${category.share ?? 0}%` }} />
                            </span>
                            <span className="context-count">{formatTokens(category.tokens)}</span>
                        </li>
                    ))}
                </ul>
            ) : null}
            {threshold ? <p className="context-threshold muted">{threshold}</p> : null}
        </div>
    );
}

/**
 * Usage dans la barre de chat : contexte de la conversation et budget de chat,
 * en deux anneaux. Un clic ouvre le détail (popover ancré sur le bouton, vers le haut).
 * details : répartition du contexte (lib/usage.js, contextDetails), facultative.
 */
export function UsageMeter({ context = null, details = null, budget = null, error = null, loading = false, onRefresh }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    const budgetPercent = budget ? budget.percent : null;

    useEffect(() => {
        if (!open) return undefined;
        if (onRefresh) onRefresh();
        const onPointer = (event) => {
            if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
        };
        document.addEventListener("pointerdown", onPointer);
        return () => document.removeEventListener("pointerdown", onPointer);
    }, [open]);

    const onKeyDown = (event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
    };

    const summary = `Contexte ${label(context)}, budget de chat ${label(budgetPercent)}`;

    return (
        <div className="usage-meter" ref={rootRef} onKeyDown={onKeyDown}>
            <button
                ref={triggerRef}
                type="button"
                className="chip-button usage-button"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={`${summary}. Afficher le détail`}
                title={summary}
                onClick={() => setOpen((value) => !value)}
            >
                <span className="usage-reading">
                    <Ring value={context} />
                    <span className="usage-key">ctx</span>
                    {label(context)}
                </span>
                <span className="usage-reading">
                    <Ring value={budgetPercent} />
                    <span className="usage-key">budget</span>
                    {label(budgetPercent)}
                </span>
            </button>
            <div className={`popover usage-popover${open ? " open" : ""}`} role="dialog" aria-label="Usage" aria-hidden={!open} inert={!open}>
                <div className="usage-popover-head">
                    <div className="popover-title">Usage</div>
                    <button
                        type="button"
                        className="icon-button"
                        title="Actualiser"
                        aria-label="Actualiser l’usage"
                        disabled={loading}
                        onClick={onRefresh}
                    >
                        <RefreshIcon />
                    </button>
                </div>
                <Gauge
                    label="Contexte de la conversation"
                    value={context}
                    detail={context == null ? "Disponible après le premier message." : "Proche de la limite : /compact résume et repart d’une nouvelle conversation."}
                />
                {details ? <ContextBreakdown details={details} /> : null}
                <Gauge
                    label="Budget de chat"
                    value={budgetPercent}
                    detail={budget && budget.resetAt ? `Réinitialisation ${resetTime(budget.resetAt)}` : budget ? null : "Non fourni par le compte."}
                />
                {error && !budget ? <p className="panel-error">{error}</p> : null}
            </div>
        </div>
    );
}
