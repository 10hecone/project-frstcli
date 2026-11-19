/** Icônes SVG au trait (currentColor), 16 px par défaut, décoratives. */
const base = (size) => ({
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    focusable: false
});

export function PaperclipIcon({ size = 16 }) {
    return (
        <svg {...base(size)}>
            <path d="M13.5 7.5 8 13a3.5 3.5 0 0 1-5-5l5.8-5.8a2.3 2.3 0 0 1 3.3 3.3L6.4 11.2a1.2 1.2 0 0 1-1.7-1.7L10 4.2" />
        </svg>
    );
}

export function ArrowUpIcon({ size = 16 }) {
    return (
        <svg {...base(size)}>
            <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
        </svg>
    );
}

export function StopIcon({ size = 16 }) {
    return (
        <svg {...base(size)}>
            <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" />
        </svg>
    );
}

export function BranchIcon({ size = 14 }) {
    return (
        <svg {...base(size)}>
            <circle cx="4.5" cy="3.5" r="1.5" />
            <circle cx="4.5" cy="12.5" r="1.5" />
            <circle cx="11.5" cy="5.5" r="1.5" />
            <path d="M4.5 5v6M11.5 7c0 3-7 2-7 4" />
        </svg>
    );
}

export function FolderIcon({ size = 14 }) {
    return (
        <svg {...base(size)}>
            <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.5 1.5h4.9A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
        </svg>
    );
}

export function ChevronIcon({ size = 12 }) {
    return (
        <svg {...base(size)}>
            <path d="M4 6l4 4 4-4" />
        </svg>
    );
}

export function CloseIcon({ size = 12 }) {
    return (
        <svg {...base(size)}>
            <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
    );
}

export function CheckIcon({ size = 14 }) {
    return (
        <svg {...base(size)}>
            <path d="M3 8.5 6.5 12 13 4.5" />
        </svg>
    );
}

/** Conversations (barre d'activité). */
export function ChatsIcon({ size = 20 }) {
    return (
        <svg {...base(size)}>
            <path d="M2.5 4.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2V9a2 2 0 0 1-2 2H7l-3 2.5V11a1.5 1.5 0 0 1-1.5-1.5z" />
            <path d="M5.5 6h5M5.5 8.2h3" />
        </svg>
    );
}

/** Skills (barre d'activité). */
export function SkillsIcon({ size = 20 }) {
    return (
        <svg {...base(size)}>
            <path d="M8 1.8l1.6 3.9 3.9 1.6-3.9 1.6L8 12.8 6.4 8.9 2.5 7.3l3.9-1.6z" />
            <path d="M12.5 11.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" />
        </svg>
    );
}

/** Serveurs MCP (barre d'activité) : une prise. */
export function McpIcon({ size = 20 }) {
    return (
        <svg {...base(size)}>
            <path d="M6 2v3M10 2v3" />
            <path d="M4 5h8v2.5a4 4 0 0 1-8 0z" />
            <path d="M8 11.5V14" />
        </svg>
    );
}

/** Paramètres (barre d'activité) : trois curseurs. */
export function SettingsIcon({ size = 20 }) {
    return (
        <svg {...base(size)}>
            <path d="M2.5 4h1.6M6.9 4h6.6M2.5 8h6.6M11.9 8h1.6M2.5 12h3.1M8.4 12h5.1" />
            <circle cx="5.5" cy="4" r="1.4" />
            <circle cx="10.5" cy="8" r="1.4" />
            <circle cx="7" cy="12" r="1.4" />
        </svg>
    );
}

export function RefreshIcon({ size = 14 }) {
    return (
        <svg {...base(size)}>
            <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.5h-2.5" />
        </svg>
    );
}

export function CommandIcon({ size = 14 }) {
    return (
        <svg {...base(size)}>
            <path d="M10 3 6 13" />
        </svg>
    );
}
