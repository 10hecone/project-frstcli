import { useEffect, useRef } from "react";

/**
 * Menu d'auto-complétion au-dessus de la barre de chat (commandes « / » et skills « $ »).
 * Le focus reste dans la zone de saisie (aria-activedescendant) : le menu ne
 * prend jamais le focus. Il reste monté pour que l'entrée et la sortie suivent
 * le même chemin ; à la fermeture, il garde son dernier contenu pendant le fondu.
 */
export function Autocomplete({ id, open, kind, items, active = 0, onHover, onPick }) {
    const last = useRef({ kind: null, items: [] });
    if (open) last.current = { kind, items };
    const shown = last.current;
    const listRef = useRef(null);

    useEffect(() => {
        if (!open || !listRef.current) return;
        const el = listRef.current.querySelector(`[data-index="${active}"]`);
        if (el) el.scrollIntoView({ block: "nearest" });
    }, [open, active]);

    const isSkill = shown.kind === "skill";

    return (
        <div className={`popover completion${open ? " open" : ""}`} aria-hidden={!open} inert={!open}>
            <div className="popover-title">{isSkill ? "Skills" : "Commandes"}</div>
            <ul id={id} ref={listRef} role="listbox" aria-label={isSkill ? "Skills" : "Commandes"}>
                {shown.items.map((item, index) => {
                    const selected = open && index === active;
                    return (
                        <li
                            key={isSkill ? item.id : item.name}
                            id={`${id}-${index}`}
                            data-index={index}
                            role="option"
                            aria-selected={selected}
                            className={`option completion-option${selected ? " active" : ""}${isSkill && item.enabled === false ? " off" : ""}`}
                            onPointerDown={(event) => event.preventDefault()}
                            onPointerMove={() => (selected ? null : onHover && onHover(index))}
                            onClick={() => onPick && onPick(item)}
                        >
                            <span className="completion-name">{isSkill ? `$${item.mention}` : item.name}</span>
                            {!isSkill && item.args ? <span className="completion-args">{item.args}</span> : null}
                            <span className="option-description">{item.description}</span>
                            {isSkill && item.enabled === false ? <span className="tag">désactivé</span> : null}
                        </li>
                    );
                })}
            </ul>
            <p className="popover-hint">
                <kbd>↑</kbd> <kbd>↓</kbd> choisir · <kbd>Tab</kbd> compléter · <kbd>Entrée</kbd> valider · <kbd>Échap</kbd> fermer
            </p>
        </div>
    );
}
