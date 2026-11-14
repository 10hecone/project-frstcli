import { useId, useState } from "react";
import { Entry } from "./Entry.jsx";
import { ToolIcon } from "./ToolIcon.jsx";
import { displayText, failedSteps, stepStatus, toolKind } from "../lib/entries.js";

const STATUS_LABELS = { running: "en cours", done: "terminé", error: "en erreur" };

/**
 * Suite d'appels d'outils (groupActivity), comme dans Claude Code : une puce par
 * action (icône de l'outil, argument), le résultat en retrait dessous. Seule la
 * dernière action reste visible ; les précédentes sont repliées derrière un
 * bouton. expandAll (Ctrl+O) déplie tous les groupes.
 */
export function Activity({ group, expandAll = false }) {
    const [open, setOpen] = useState(false);
    const listId = useId();
    const steps = group.steps || [];
    const previous = steps.slice(0, -1);
    const current = steps[steps.length - 1];
    const failed = failedSteps(previous);
    const shown = open || expandAll;
    if (!current) return null;

    return (
        <section className="activity" aria-label="Actions de l'assistant">
            {previous.length ? (
                <button
                    type="button"
                    className="activity-toggle"
                    aria-expanded={shown}
                    aria-controls={listId}
                    title="Ctrl+O : déplier ou replier toutes les actions"
                    onClick={() => setOpen((value) => !value)}
                >
                    <span className="activity-chevron" aria-hidden="true">›</span>
                    {previous.length} action{previous.length > 1 ? "s" : ""} précédente{previous.length > 1 ? "s" : ""}
                    {failed ? <span className="activity-failed"> · {failed} en erreur</span> : null}
                </button>
            ) : null}
            {shown ? (
                <div className="activity-history" id={listId}>
                    {previous.map((step) => (
                        <Step key={step.id} step={step} />
                    ))}
                </div>
            ) : null}
            <Step key={current.id} step={current} current />
        </section>
    );
}

/** Une action : puce + icône + nom et argument, puis le résultat en retrait. */
function Step({ step, current = false }) {
    const [tool, ...output] = step.entries;
    const status = stepStatus(step);
    const { kind, label } = toolKind(tool && tool.name);
    return (
        <div className={`activity-step is-${status}${current ? " is-current" : ""}`}>
            <div className="step-head">
                <span className="step-bullet" aria-label={STATUS_LABELS[status]} role="img" />
                <ToolIcon kind={kind} />
                <span className="step-label" title={tool && tool.name}>{label}</span>
                <span className="step-arg">{displayText(tool && tool.arg)}</span>
            </div>
            {output.length ? (
                <div className="step-output">
                    {output.map((entry) => (
                        <Entry key={entry.id} entry={entry} />
                    ))}
                </div>
            ) : null}
        </div>
    );
}
