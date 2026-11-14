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

/** Caractères streamés par l'assistant depuis le dernier message de l'utilisateur. */
export function streamedChars(transcript = [], live = null) {
    let total = live && typeof live.text === "string" ? live.text.length : 0;
    for (let i = transcript.length - 1; i >= 0; i--) {
        const entry = transcript[i];
        if (!entry) continue;
        if (entry.type === "user") break;
        if (entry.type === "assistant" && entry.streamed) total += String(entry.text ?? "").length + 1;
    }
    return total;
}

/** Entrée qui suit un appel d'outil : son résultat, son diff ou la sortie de commande. */
function followsTool(entry) {
    return entry.type === "result" || entry.type === "diff" || (entry.type === "print" && entry.command);
}

/**
 * Regroupe les appels d'outils consécutifs en { type: "activity", id, steps }.
 * Une étape = un « tool » suivi de ses résultats ; l'interface n'affiche que la
 * dernière, les précédentes restent dépliables. Un texte de l'assistant, un
 * message ou un avertissement termine le groupe.
 */
export function groupActivity(items = []) {
    const out = [];
    for (const entry of items) {
        const last = out[out.length - 1];
        const group = last && last.type === "activity" ? last : null;
        if (entry && entry.type === "tool") {
            const step = { id: entry.id, entries: [entry] };
            if (group) group.steps.push(step);
            else out.push({ type: "activity", id: `activity-${entry.id}`, steps: [step] });
            continue;
        }
        if (entry && group && followsTool(entry)) {
            group.steps[group.steps.length - 1].entries.push(entry);
            continue;
        }
        out.push(entry);
    }
    return out;
}

/** Nombre d'étapes en erreur (résultat au ton « error »). */
export function failedSteps(steps = []) {
    return steps.filter((step) => step.entries.some((entry) => entry.type === "result" && entry.tone === "error")).length;
}

const TOOL_KINDS = {
    list_directory: { kind: "list", label: "Liste" },
    read_file: { kind: "read", label: "Lecture" },
    search_files: { kind: "search", label: "Recherche" },
    edit_file: { kind: "edit", label: "Modification" },
    write_file: { kind: "write", label: "Écriture" },
    run_command: { kind: "command", label: "Commande" }
};

/** Famille d'un outil (icône) et libellé lisible ; outil inconnu : { kind: "other", label: nom }. */
export function toolKind(name) {
    const known = TOOL_KINDS[String(name || "")];
    return known || { kind: "other", label: String(name || "Outil") };
}

/** État d'une étape : error (résultat en erreur), done (résultat ou sortie), running sinon. */
export function stepStatus(step) {
    const rest = ((step && step.entries) || []).slice(1);
    if (rest.some((entry) => entry.type === "result" && entry.tone === "error")) return "error";
    return rest.length ? "done" : "running";
}

/**
 * Diff en attente de confirmation : edit_file et write_file affichent le diff
 * puis demandent l'accord. On renvoie le dernier diff après le dernier outil.
 */
export function pendingDiff(transcript = []) {
    for (let i = transcript.length - 1; i >= 0; i--) {
        const entry = transcript[i];
        if (!entry) continue;
        if (entry.type === "diff") return entry;
        if (entry.type === "tool" || entry.type === "user") return null;
    }
    return null;
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
