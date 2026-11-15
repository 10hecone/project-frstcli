import { useEffect, useMemo, useRef } from "react";
import { Entry } from "./Entry.jsx";
import { Spinner } from "./Spinner.jsx";
import { Activity } from "./Activity.jsx";
import { groupActivity, groupEntries, streamedChars } from "../lib/entries.js";

// Distance (px) en dessous de laquelle on considère l'utilisateur « en bas ».
const STICK_THRESHOLD = 80;

/**
 * Conversation : entrées terminées, texte en cours de streaming, sortie de
 * commande en direct et indicateur de chargement. Suit le bas automatiquement,
 * sauf si l'utilisateur est remonté dans l'historique.
 * expandAll (Ctrl+O) déplie toutes les actions.
 */
export function Transcript({ transcript, live, command, spinner, expandAll = false }) {
    const items = useMemo(() => groupActivity(groupEntries(transcript, live)), [transcript, live]);
    const chars = useMemo(() => (spinner ? streamedChars(transcript, live) : 0), [spinner, transcript, live]);
    const ref = useRef(null);
    const stickRef = useRef(true);
    const lastTopRef = useRef(0);

    const toBottom = () => {
        const el = ref.current;
        if (el && stickRef.current) el.scrollTop = el.scrollHeight;
    };

    // Seul un défilement vers le haut (geste de l'utilisateur) décroche le suivi.
    // La croissance du contenu ne change pas scrollTop : elle ne décroche plus.
    const onScroll = () => {
        const el = ref.current;
        if (!el) return;
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
        if (nearBottom) stickRef.current = true;
        else if (el.scrollTop < lastTopRef.current - 1) stickRef.current = false;
        lastTopRef.current = el.scrollTop;
    };

    // Un nouveau message de l'utilisateur ramène toujours en bas.
    const lastType = transcript.length ? transcript[transcript.length - 1]?.type : null;
    useEffect(() => {
        if (lastType === "user") stickRef.current = true;
    }, [transcript.length, lastType]);

    useEffect(toBottom, [items, command, spinner]);

    // Le contenu grandit aussi après le rendu (markdown, blocs dépliés, images,
    // zone de saisie qui change de hauteur) : on suit ces changements de taille.
    useEffect(() => {
        const el = ref.current;
        if (!el) return undefined;

        const resize = new ResizeObserver(() => toBottom());
        const watch = () => {
            resize.disconnect();
            resize.observe(el);
            for (const child of el.children) resize.observe(child);
        };
        const mutation = new MutationObserver(() => {
            watch();
            toBottom();
        });

        watch();
        mutation.observe(el, { childList: true, subtree: true, characterData: true });
        return () => {
            mutation.disconnect();
            resize.disconnect();
        };
    }, []);

    return (
        <main className="transcript" ref={ref} onScroll={onScroll}>
            {items.map((entry) => (
                entry.type === "activity" ? (
                    <Activity key={entry.id} group={entry} expandAll={expandAll} />
                ) : (
                    <Entry key={entry.id} entry={entry} />
                )
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
            <Spinner spinner={spinner} streamedChars={chars} />
        </main>
    );
}
