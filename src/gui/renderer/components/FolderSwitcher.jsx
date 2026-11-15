import { useEffect, useRef, useState } from "react";

const MAX_RECENT = 6;

/**
 * Sélecteur du dossier actif, en haut de la barre latérale : nom + branche, puis un menu
 * avec les dossiers récents, « Ouvrir un dossier… » et « Fermer le dossier ».
 * folders = { active, recent } (voir useWorkspace). Le menu se ferme au clic dehors ou sur Échap
 * (le focus revient alors sur le bouton). Désactivé pendant une réponse : ouvrir ou fermer
 * un dossier est refusé tant qu'une demande est en cours.
 */
export function FolderSwitcher({ folders, disabled = false, disabledReason, onPick, onOpen, onClose }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    const active = folders.active || null;
    const others = (folders.recent || []).filter((folder) => !active || folder.path !== active.path).slice(0, MAX_RECENT);

    useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
            if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
        };
        const onKeyDown = (event) => {
            if (event.key !== "Escape") return;
            setOpen(false);
            if (triggerRef.current) triggerRef.current.focus();
        };
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);

    const choose = (action) => {
        setOpen(false);
        action();
    };

    return (
        <div className="folder-switcher" ref={rootRef}>
            <button
                type="button"
                ref={triggerRef}
                className="folder-trigger secondary"
                aria-haspopup="menu"
                aria-expanded={open}
                title={active ? active.path : "Aucun dossier ouvert"}
                onClick={() => setOpen((value) => !value)}
            >
                <span className="folder-name">{active ? active.name : "Aucun dossier"}</span>
                {active && active.branch ? <span className="folder-branch">{active.branch}</span> : null}
                <span className="folder-chevron" aria-hidden="true">
                    ›
                </span>
            </button>
            {open ? (
                <div className="folder-menu" role="menu">
                    {others.map((folder) => (
                        <button
                            key={folder.path}
                            type="button"
                            role="menuitem"
                            className="row"
                            disabled={disabled}
                            title={disabled ? disabledReason : folder.path}
                            onClick={() => choose(() => onOpen(folder.path))}
                        >
                            <span className="folder-name">{folder.name}</span>
                            {folder.branch ? <span className="folder-branch">{folder.branch}</span> : null}
                        </button>
                    ))}
                    {others.length > 0 ? <hr className="folder-separator" /> : null}
                    <button type="button" role="menuitem" className="row" disabled={disabled} title={disabledReason} onClick={() => choose(onPick)}>
                        Ouvrir un dossier…
                    </button>
                    {active ? (
                        <button type="button" role="menuitem" className="row" disabled={disabled} title={disabledReason} onClick={() => choose(onClose)}>
                            Fermer le dossier
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
