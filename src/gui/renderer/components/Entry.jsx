import { AssistantText } from "./AssistantText.jsx";
import { Diff } from "./Diff.jsx";
import { displayText } from "../lib/entries.js";

/**
 * Rendu d'une entrée du transcript. Les types viennent de src/tui/store.js
 * (ENTRY_TYPES), plus "assistantBlock" produit par groupEntries.
 * Ajouter un type = ajouter un case ici.
 */
export function Entry({ entry }) {
    switch (entry.type) {
        case "welcome":
            return (
                <div className="welcome">
                    <h2>FranceStudent Code</h2>
                    <dl>
                        <dt>Modèle</dt>
                        <dd>{entry.model || "—"}</dd>
                        <dt>Dossier</dt>
                        <dd>{entry.workspace || "aucun dossier ouvert"}</dd>
                        <dt>Mode</dt>
                        <dd>{entry.mode || "—"}</dd>
                    </dl>
                </div>
            );

        case "user":
            return (
                <div className="user">
                    {entry.text}
                    {entry.files > 0 ? (
                        <span className="user-files">📎 {entry.files} fichier{entry.files > 1 ? "s" : ""}</span>
                    ) : null}
                </div>
            );

        case "assistant":
            return <AssistantText lines={String(entry.text ?? "").split("\n")} />;

        case "assistantBlock":
            return <AssistantText lines={entry.lines} live={entry.live} />;

        case "tool":
            return (
                <div className="tool">
                    <span className="tool-name">{entry.name}</span>
                    <span className="tool-arg">{displayText(entry.arg)}</span>
                </div>
            );

        case "result":
            return <div className={`result ${entry.tone || ""}`}>{entry.text}</div>;

        case "plan":
            return (
                <ol className="plan">
                    {(entry.items || []).map((item, index) => (
                        <li key={index}>{displayText(item)}</li>
                    ))}
                </ol>
            );

        case "diff":
            return <Diff lines={entry.lines} added={entry.added} removed={entry.removed} />;

        case "print":
            return (
                <pre className={`print${entry.command ? " command" : ""}`}>
                    {entry.hidden > 0 ? (
                        <span className="hidden-lines">
                            … {entry.hidden} ligne(s) masquée(s){"\n"}
                        </span>
                    ) : null}
                    {(entry.lines || []).join("\n")}
                </pre>
            );

        case "info":
        case "warn":
        case "error":
            return <div className={`notice ${entry.type}${entry.debug ? " debug" : ""}`}>{entry.text}</div>;

        default:
            return null;
    }
}
