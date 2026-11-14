import { toSegments } from "../lib/entries.js";

/**
 * Texte de l'assistant : paragraphes et blocs de code (Markdown minimal).
 * Point d'extension : remplacer par un vrai rendu Markdown plus tard.
 */
export function AssistantText({ lines = [], live = false }) {
    const segments = toSegments(lines);
    return (
        <div className={`assistant${live ? " is-live" : ""}`}>
            {segments.map((segment, index) =>
                segment.kind === "code" ? (
                    <pre key={index} className="code" data-lang={segment.lang || undefined}>
                        <code>{segment.lines.join("\n")}</code>
                    </pre>
                ) : (
                    <p key={index} className="text">
                        {segment.lines.join("\n")}
                    </p>
                )
            )}
            {live ? <span className="caret" aria-hidden="true" /> : null}
        </div>
    );
}
