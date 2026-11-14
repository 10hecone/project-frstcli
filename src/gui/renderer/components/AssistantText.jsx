import { Markdown } from "./Markdown.jsx";

/**
 * Texte de l'assistant rendu en Markdown (voir lib/markdown.js).
 * Pendant le streaming, un bloc de code non fermé reste affiché en code.
 */
export function AssistantText({ lines = [], live = false }) {
                return (
                                <div className={`assistant md${live ? " is-live" : ""}`}>
                                                <Markdown lines={lines} />
                                                {live ? <span className="caret" aria-hidden="true" /> : null}
                                </div>
                );
}
