import { ChatsIcon, McpIcon, SkillsIcon } from "./Icons.jsx";

export const VIEWS = [
    { id: "threads", label: "Conversations", Icon: ChatsIcon },
    { id: "skills", label: "Skills", Icon: SkillsIcon },
    { id: "mcp", label: "Serveurs MCP", Icon: McpIcon }
];

/** Pas vertical entre deux boutons : hauteur (40) + espacement (4), voir app.css. */
const STEP = 44;

/**
 * Barre d'activité à gauche, comme VS Code : une icône par vue de la barre
 * latérale. Un clic sur la vue active replie la barre latérale (Ctrl+B aussi).
 * Un seul indicateur glisse vers la vue active, au lieu d'apparaître à chaque bouton.
 */
export function ActivityBar({ view, open = true, controls, onSelect }) {
    const index = Math.max(0, VIEWS.findIndex((item) => item.id === view));

    const onKeyDown = (event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const buttons = [...event.currentTarget.querySelectorAll("[role=tab]")];
        const current = buttons.indexOf(document.activeElement);
        const next = (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
    };

    return (
        <nav className="activity-bar" aria-label="Vues">
            <span className="logo" aria-hidden="true" title="FranceStudent Code">
                FS
            </span>
            <div className="activity-items" role="tablist" aria-orientation="vertical" aria-label="Barre latérale" onKeyDown={onKeyDown}>
                <span
                    className="activity-indicator"
                    aria-hidden="true"
                    style={{ transform: `translateY(${index * STEP}px)`, opacity: open ? 1 : 0 }}
                />
                {VIEWS.map(({ id, label, Icon }) => {
                    const selected = open && view === id;
                    return (
                        <button
                            key={id}
                            type="button"
                            role="tab"
                            className="activity-item icon"
                            aria-selected={selected}
                            aria-controls={controls}
                            aria-label={label}
                            title={selected ? `${label} · cliquer pour masquer (Ctrl+B)` : label}
                            tabIndex={view === id ? 0 : -1}
                            onClick={() => onSelect(id)}
                        >
                            <Icon />
                        </button>
                    );
                })}
            </div>
        </nav>
    );
}
