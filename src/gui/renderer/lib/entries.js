/**
 * Transformations pures du transcript pour l'affichage graphique (sans React).
 *
 * Le store découpe le texte streamé en une entrée par ligne (utile à Ink).
 * Ici, les lignes consécutives d'une même réponse sont regroupées en un bloc.
 */

/** Regroupe les entrées assistant streamées consécutives en { type: "assistantBlock", id, lines }. */
export function groupEntries(transcript = [], live = null) {
    const items = [];
    for (const entry of transcript) {
        const last = items[items.length - 1];
        if (entry && entry.type === "assistant" && entry.streamed) {
            if (last && last.type === "assistantBlock") last.lines.push(String(entry.text ?? ""));
            else items.push({ type: "assistantBlock", id: `block-${entry.id}`, lines: [String(entry.text ?? "")] });
            continue;
        }
        items.push(entry);
    }

    // La ligne en cours de streaming prolonge le dernier bloc, ou en ouvre un.
    if (live && typeof live.text === "string") {
        const last = items[items.length - 1];
        if (last && last.type === "assistantBlock") {
            last.lines.push(live.text);
            last.live = true;
        } else {
            items.push({ type: "assistantBlock", id: `live-${live.id}`, lines: [live.text], live: true });
        }
    }
    return items;
}

const FENCE_RE = /^\s*(```|~~~)\s*([\w+-]*)/;

/**
 * Découpe des lignes Markdown en segments texte et blocs de code :
 * [{ kind: "text" | "code", lang, lines }]. Un bloc non fermé reste du code.
 */
export function toSegments(lines = []) {
    const segments = [];
    let current = null;

    const open = (kind, lang = "") => {
        current = { kind, lang, lines: [] };
        segments.push(current);
    };

    for (const raw of lines) {
        const line = String(raw ?? "");
        const fence = FENCE_RE.exec(line);
        if (fence) {
            if (current && current.kind === "code") current = null;
            else open("code", fence[2] || "");
            continue;
        }
        if (!current) open("text");
        current.lines.push(line);
    }
    return segments.filter((segment) => segment.kind === "code" || segment.lines.some((line) => line.trim()));
}

/** Texte lisible pour un argument d'outil ou un élément de plan. */
export function displayText(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "object") {
        const text = value.text ?? value.content ?? value.title ?? value.label;
        if (text != null) return String(text);
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return String(value);
}

/** Dernier élément d'un chemin (Windows ou POSIX). */
export function baseName(path) {
    const parts = String(path ?? "")
        .split(/[\\/]/)
        .filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "";
}
