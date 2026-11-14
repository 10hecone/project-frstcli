/** Icône d'un outil selon sa famille (lib/entries.js, toolKind). */
const PATHS = {
    list: "M3 4h10M3 8h10M3 12h10",
    read: "M4 2h6l3 3v9H4zM10 2v3h3M6 8h5M6 11h5",
    search: "M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM10.5 10.5 14 14",
    edit: "M11 2.5 13.5 5 6 12.5H3.5V10zM9.5 4 12 6.5",
    write: "M4 2h6l3 3v9H4zM10 2v3h3M8.5 7.5v5M6 10h5",
    command: "M2.5 4 6 7.5 2.5 11M8 12h5.5",
    other: "M8 3v10M3 8h10"
};

export function ToolIcon({ kind = "other", size = 14 }) {
    return (
        <svg
            className={`tool-icon tool-icon-${kind}`}
            width={size}
            height={size}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
        >
            <path d={PATHS[kind] || PATHS.other} />
        </svg>
    );
}
