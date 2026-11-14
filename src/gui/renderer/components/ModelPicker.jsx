import { useEffect, useId, useRef, useState } from "react";
import { CheckIcon, ChevronIcon } from "./Icons.jsx";

/** Modèle affiché : celui de la session, sinon le modèle par défaut, sinon le premier. */
export function currentAgent(agents = [], modelId = null) {
    return (
        agents.find((agent) => modelId != null && String(agent.id) === String(modelId)) ||
        agents.find((agent) => agent.isDefault) ||
        agents[0] ||
        null
    );
}

/**
 * Sélecteur de modèle : popover ancré sur son bouton (il s’ouvre vers le haut,
 * depuis le bouton). Il reste monté pour que l’entrée et la sortie suivent le
 * même chemin. Échap ou un clic à l’extérieur le ferment ; ↑/↓ parcourent la liste.
 */
export function ModelPicker({ agents = [], modelId = null, disabled = false, onSelect }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    const listRef = useRef(null);
    const listId = useId();
    const current = currentAgent(agents, modelId);

    useEffect(() => {
        if (!open) return undefined;
        const onPointer = (event) => {
            if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
        };
        document.addEventListener("pointerdown", onPointer);
        // Focus sur l’option courante à l’ouverture.
        const selected = listRef.current && listRef.current.querySelector('[aria-selected="true"]');
        const first = listRef.current && listRef.current.querySelector("[role=option]");
        (selected || first)?.focus();
        return () => document.removeEventListener("pointerdown", onPointer);
    }, [open]);

    useEffect(() => {
        if (disabled) setOpen(false);
    }, [disabled]);

    const close = () => {
        setOpen(false);
        triggerRef.current?.focus();
    };

    const choose = (agent) => {
        close();
        if (!current || agent.id !== current.id) onSelect?.(agent.id);
    };

    const onKeyDown = (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const options = [...(listRef.current?.querySelectorAll("[role=option]") || [])];
        const index = options.indexOf(document.activeElement);
        const next = event.key === "ArrowDown" ? Math.min(options.length - 1, index + 1) : Math.max(0, index - 1);
        options[next]?.focus();
    };

    return (
        <div className="model-picker" ref={rootRef} onKeyDown={open ? onKeyDown : undefined}>
            <button
                ref={triggerRef}
                type="button"
                className="chip-button"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={listId}
                disabled={disabled || agents.length === 0}
                title={disabled ? "Indisponible pendant une réponse" : "Choisir le modèle"}
                onClick={() => setOpen((value) => !value)}
            >
                <span className="model-name">{current ? current.name : "Modèle"}</span>
                <ChevronIcon />
            </button>
            <div className={`popover${open ? " open" : ""}`} aria-hidden={!open} inert={!open}>
                <div className="popover-title">Modèle</div>
                <ul id={listId} ref={listRef} role="listbox" aria-label="Modèles">
                    {agents.map((agent) => {
                        const selected = Boolean(current && agent.id === current.id);
                        return (
                            <li
                                key={agent.id}
                                role="option"
                                tabIndex={-1}
                                aria-selected={selected}
                                className="option"
                                onClick={() => choose(agent)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        choose(agent);
                                    }
                                }}
                            >
                                <span className="option-text">
                                    <span className="option-name">{agent.name}</span>
                                    {agent.description || agent.provider ? (
                                        <span className="option-description">{agent.description || agent.provider}</span>
                                    ) : null}
                                </span>
                                <span className="option-check">{selected ? <CheckIcon /> : null}</span>
                            </li>
                        );
                    })}
                </ul>
                <p className="popover-hint">Changer de modèle ouvre une nouvelle conversation.</p>
            </div>
        </div>
    );
}
