import { useEffect, useMemo, useRef } from "react";
import { Entry } from "./Entry.jsx";
import { Spinner } from "./Spinner.jsx";
import { groupEntries } from "../lib/entries.js";

// Distance (px) en dessous de laquelle on considère l'utilisateur « en bas ».
const STICK_THRESHOLD = 80;

/**
 * Conversation : entrées terminées, texte en cours de streaming, sortie de
 * commande en direct et indicateur de chargement. Suit le bas automatiquement,
 * sauf si l'utilisateur est remonté dans l'historique.
 */
export function Transcript({ transcript, live, command, spinner }) {
    const items = useMemo(() => groupEntries(transcript, live), [transcript, live]);
    const ref = useRef(null);
    const stickRef = useRef(true);

    const onScroll = () => {
        const el = ref.current;
        if (!el) return;
        stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
    };

    useEffect(() => {
        const el = ref.current;
        if (el && stickRef.current) el.scrollTop = el.scrollHeight;
    }, [items, command, spinner]);

    return (
        <main className="transcript" ref={ref} onScroll={onScroll}>
            {items.map((entry) => (
                <Entry key={entry.id} entry={entry} />
            ))}
            {command ? (
                <pre className="print command is-live">
                    {command.total > command.lines.length ? (
                        <span className="hidden-lines">
                            … {command.total - command.lines.length} ligne(s) masquée(s){"\n"}
                        </span>
                    ) : null}
                    {command.lines.join("\n")}
                </pre>
            ) : null}
            <Spinner spinner={spinner} />
        </main>
    );
}
