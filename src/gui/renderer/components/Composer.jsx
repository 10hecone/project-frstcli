import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Autocomplete } from "./Autocomplete.jsx";
import { ModelPicker } from "./ModelPicker.jsx";
import { UsageMeter } from "./UsageMeter.jsx";
import { ArrowUpIcon, BranchIcon, CloseIcon, FolderIcon, PaperclipIcon, StopIcon } from "./Icons.jsx";
import { bytes } from "../lib/format.js";
import { applyCompletion, commandSuggestions, completionContext, runsWithoutArgs, skillSuggestions } from "../lib/completion.js";
import { enqueue, preview, removeQueued, restoreQueue, takeNext } from "../lib/queue.js";

const MAX_ATTACHMENTS = 20;

const contextKey = (ctx) => (ctx ? `${ctx.kind}:${ctx.start}` : null);

/**
 * Barre de chat.
 * - Entrée envoie, Maj+Entrée ajoute une ligne.
 * - Pendant une réponse, Entrée met le message en file : il part dès la fin de
 *   la réponse (un par un, dans l'ordre). Chaque message en file peut être retiré.
 * - « / » en début de message propose les commandes, « $ » propose les skills :
 *   ↑ / ↓ choisissent, Tab ou Entrée complètent, Échap ferme le menu.
 * - ↑ / ↓ parcourent l'historique de la session quand le menu est fermé et que
 *   le curseur est en début / fin.
 * - Échap (dans la saisie ou n'importe où dans la fenêtre) interrompt la tâche en
 *   cours ; les messages en file reviennent alors dans la saisie.
 * - Trombone : envoie des fichiers (Files v2) ; leurs ids partent avec le message.
 * - Ctrl+V sur une image : elle est jointe comme avec le trombone (le texte collé reste du texte).
 * - Sélecteur de modèle, usage (contexte et budget), dossier et branche git.
 */
export function Composer({
    busy = false,
    disabled = false,
    info = null,
    branch = null,
    skills = [],
    context = null,
    contextDetails = null,
    budget = null,
    usageError = null,
    usageLoading = false,
    onSubmit,
    onInterrupt,
    onPickFiles,
    onPasteImage,
    onPickFolder,
    onSetModel,
    onRefreshUsage
}) {
    const [value, setValue] = useState("");
    const [caret, setCaret] = useState(0);
    const [dismissed, setDismissed] = useState(null);
    const [active, setActive] = useState(0);
    const [attachments, setAttachments] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [fileError, setFileError] = useState(null);
    const [queue, setQueue] = useState([]);
    // Vrai entre l'envoi et la fin de onSubmit : couvre le délai avant status.busy.
    const [inFlight, setInFlight] = useState(false);
    const history = useRef([]);
    const cursor = useRef(-1);
    const inputRef = useRef(null);
    const pendingCaret = useRef(null);
    const stopRef = useRef(null);
    const listId = useId();
    const working = busy || inFlight;

    useEffect(() => {
        if (!disabled && inputRef.current) inputRef.current.focus();
    }, [disabled, busy]);

    // Après une complétion, replace le curseur juste après le texte inséré.
    useLayoutEffect(() => {
        const el = inputRef.current;
        if (pendingCaret.current == null || !el) return;
        el.setSelectionRange(pendingCaret.current, pendingCaret.current);
        pendingCaret.current = null;
    }, [value]);

    const ctx = completionContext(value, caret);
    const key = contextKey(ctx);
    const suggestions = !ctx
        ? []
        : ctx.kind === "command"
            ? commandSuggestions(ctx.query)
            : skillSuggestions(ctx.query, skills);
    const menuOpen = !disabled && suggestions.length > 0 && dismissed !== key;
    const activeIndex = Math.min(active, Math.max(0, suggestions.length - 1));

    // Nouvelle saisie : on repart du premier élément ; hors jeton, Échap est oublié.
    useEffect(() => {
        setActive(0);
        if (!key) setDismissed(null);
    }, [key, ctx ? ctx.query : null]);

    const isCommand = value.trim().startsWith("/");
    // Pendant une réponse, l'envoi reste possible : le message part en file.
    const ready = !disabled && !uploading;
    const canSend = Boolean(value.trim()) && ready;

    /** Remplace le texte et place le curseur (après le rendu). */
    const replace = (text, position = text.length) => {
        pendingCaret.current = position;
        setValue(text);
        setCaret(position);
    };

    /** Transmet un message à la session ; inFlight retombe quand la réponse est finie. */
    const dispatch = (text, files) => {
        const ids = text.startsWith("/") ? [] : files.map((file) => file.id);
        setInFlight(true);
        Promise.resolve()
            .then(() => (onSubmit ? onSubmit(text, ids) : null))
            .catch(() => null)
            .finally(() => setInFlight(false));
    };

    // Fin de réponse : le premier message en file part.
    useEffect(() => {
        if (working || disabled || !queue.length) return;
        const { next, rest } = takeNext(queue);
        setQueue(rest);
        dispatch(next.text, next.files);
    }, [working, disabled, queue]);

    const send = (override) => {
        const text = (override ?? value).trim();
        if (!text || !ready) return;
        const command = text.startsWith("/");
        history.current.push(text);
        cursor.current = -1;
        replace("", 0);
        setDismissed(null);
        const files = command ? [] : attachments;
        if (!command) setAttachments([]);
        setFileError(null);
        if (working || queue.length) setQueue((prev) => enqueue(prev, text, files));
        else dispatch(text, files);
    };

    /** Interruption : les messages en file reviennent dans la saisie, puis la tâche s'arrête. */
    const stop = () => {
        if (queue.length) {
            const restored = restoreQueue(queue, value, attachments);
            setQueue([]);
            replace(restored.text);
            setAttachments(restored.files.slice(0, MAX_ATTACHMENTS));
        }
        if (onInterrupt) onInterrupt();
    };
    stopRef.current = stop;

    // Échap n'importe où dans la fenêtre (hors menus qui l'ont déjà traité) interrompt.
    useEffect(() => {
        if (!working || disabled) return undefined;
        const onKey = (event) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            event.preventDefault();
            if (stopRef.current) stopRef.current();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [working, disabled]);

    const complete = (item) => {
        if (!ctx || !item) return;
        const insertion = ctx.kind === "command" ? item.name : `$${item.mention}`;
        const next = applyCompletion(value, ctx, insertion);
        replace(next.text, next.caret);
        inputRef.current?.focus();
    };

    /** Entrée sur une commande sans argument obligatoire, rien d'autre dans le message : on l'exécute. */
    const pick = (item) => {
        const rest = ctx ? value.slice(ctx.end).trim() : "";
        if (ctx && ctx.kind === "command" && runsWithoutArgs(item) && !rest && ready) send(item.name);
        else complete(item);
    };

    /** Ajoute les fichiers envoyés ({ files, errors }) aux pièces jointes, sans doublon. */
    const addAttachments = (result) => {
        const added = result.files || [];
        setAttachments((prev) => {
            const known = new Set(prev.map((file) => file.id));
            return [...prev, ...added.filter((file) => !known.has(file.id))].slice(0, MAX_ATTACHMENTS);
        });
        if (result.errors && result.errors.length) setFileError(result.errors.join(" · "));
    };

    const attach = async () => {
        if (!onPickFiles || uploading) return;
        setUploading(true);
        setFileError(null);
        try {
            const result = (await onPickFiles()) || {};
            if (result.cancelled && !(result.files || []).length) return;
            addAttachments(result);
        } finally {
            setUploading(false);
            inputRef.current?.focus();
        }
    };

    /**
     * Ctrl+V : une image du presse-papiers (capture d'écran, « copier l'image ») devient une
     * pièce jointe. Si le presse-papiers contient aussi du texte, le collage reste un collage de texte.
     */
    const paste = async (event) => {
        const data = event.clipboardData;
        if (!onPasteImage || !data || data.getData("text/plain")) return;
        const images = Array.from(data.items || [])
            .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
            .map((item) => item.getAsFile())
            .filter(Boolean);
        if (!images.length) return;
        event.preventDefault();
        if (uploading) return;
        const room = MAX_ATTACHMENTS - attachments.length;
        if (room <= 0) {
            setFileError(`${MAX_ATTACHMENTS} pièces jointes au maximum.`);
            return;
        }
        setUploading(true);
        setFileError(null);
        try {
            const files = [];
            const errors = [];
            for (const image of images.slice(0, room)) {
                const result = (await onPasteImage(new Uint8Array(await image.arrayBuffer()), image.type)) || {};
                files.push(...(result.files || []));
                errors.push(...(result.errors || []));
            }
            if (images.length > room) errors.push(`${MAX_ATTACHMENTS} pièces jointes au maximum.`);
            addAttachments({ files, errors });
        } catch (error) {
            setFileError(error && error.message ? error.message : "Image collée illisible.");
        } finally {
            setUploading(false);
            inputRef.current?.focus();
        }
    };

    const remove = (id) => setAttachments((prev) => prev.filter((file) => file.id !== id));

    const browse = (direction) => {
        const list = history.current;
        if (!list.length) return false;
        let next = cursor.current === -1 ? list.length : cursor.current;
        next += direction;
        if (next < 0) next = 0;
        const text = next >= list.length ? "" : list[next];
        cursor.current = next >= list.length ? -1 : next;
        // Un « /help » rappelé de l'historique n'ouvre pas le menu.
        setDismissed(contextKey(completionContext(text, text.length)));
        replace(text);
        return true;
    };

    const onMenuKey = (event) => {
        const count = suggestions.length;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActive((activeIndex + step + count) % count);
            return true;
        }
        if (event.key === "Tab" && !event.shiftKey) {
            event.preventDefault();
            complete(suggestions[activeIndex]);
            return true;
        }
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            pick(suggestions[activeIndex]);
            return true;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            setDismissed(key);
            return true;
        }
        return false;
    };

    const onKeyDown = (event) => {
        if (menuOpen && onMenuKey(event)) return;
        const el = event.currentTarget;
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            send();
        } else if (event.key === "Escape" && working) {
            event.preventDefault();
            stop();
        } else if (event.key === "ArrowUp" && el.selectionStart === 0 && el.selectionEnd === 0) {
            if (browse(-1)) event.preventDefault();
        } else if (event.key === "ArrowDown" && el.selectionStart === value.length) {
            if (browse(1)) event.preventDefault();
        }
    };

    const placeholder = working
        ? "Réponse en cours… Entrée met en file, Échap interrompt"
        : attachments.length
            ? "Décris ce qu’il faut faire avec ces fichiers…"
            : "Écris un message — / pour les commandes, $ pour les skills";

    return (
        <footer className="composer">
            <div className={`composer-card${disabled ? " is-disabled" : ""}`}>
                <Autocomplete
                    id={listId}
                    open={menuOpen}
                    kind={ctx ? ctx.kind : null}
                    items={suggestions}
                    active={activeIndex}
                    onHover={setActive}
                    onPick={pick}
                />
                {queue.length ? (
                    <ul className="queue" aria-label="Messages en attente">
                        {queue.map((item, index) => (
                            <li key={item.id} className="queued" title={item.text}>
                                <span className="queued-rank">{index === 0 ? "Ensuite" : `${index + 1}ᵉ`}</span>
                                <span className="queued-text">{preview(item.text)}</span>
                                {item.files.length ? (
                                    <span className="queued-files">
                                        <PaperclipIcon size={11} />
                                        {item.files.length}
                                    </span>
                                ) : null}
                                <button
                                    type="button"
                                    className="attachment-remove"
                                    aria-label={`Retirer de la file : ${preview(item.text, 30)}`}
                                    onClick={() => setQueue((prev) => removeQueued(prev, item.id))}
                                >
                                    <CloseIcon size={10} />
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : null}
                {attachments.length || uploading ? (
                    <ul className="attachments" aria-label="Pièces jointes">
                        {attachments.map((file) => (
                            <li key={file.id} className={`attachment${file.preview ? " has-preview" : ""}`} title={file.name}>
                                {file.preview ? (
                                    <img className="attachment-thumb" src={file.preview} alt={`Aperçu de ${file.name}`} draggable={false} />
                                ) : (
                                    <PaperclipIcon size={12} />
                                )}
                                <span className="attachment-name">{file.name}</span>
                                {file.bytes ? <span className="attachment-size">{bytes(file.bytes)}</span> : null}
                                <button
                                    type="button"
                                    className="attachment-remove"
                                    aria-label={`Retirer ${file.name}`}
                                    onClick={() => remove(file.id)}
                                >
                                    <CloseIcon size={10} />
                                </button>
                            </li>
                        ))}
                        {uploading ? <li className="attachment pending">Envoi…</li> : null}
                    </ul>
                ) : null}
                {isCommand && attachments.length ? (
                    <p className="composer-note">Les pièces jointes ne partent pas avec une commande /… : elles restent pour le prochain message.</p>
                ) : null}
                {fileError ? (
                    <p className="composer-error" role="alert">
                        {fileError}
                    </p>
                ) : null}
                <textarea
                    ref={inputRef}
                    value={value}
                    rows={Math.min(8, Math.max(1, value.split("\n").length))}
                    placeholder={placeholder}
                    aria-label="Message"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={menuOpen}
                    aria-controls={listId}
                    aria-activedescendant={menuOpen ? `${listId}-${activeIndex}` : undefined}
                    disabled={disabled}
                    onChange={(event) => {
                        setValue(event.target.value);
                        setCaret(event.target.selectionStart);
                    }}
                    onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
                    onKeyDown={onKeyDown}
                    onPaste={paste}
                    onBlur={() => setDismissed(key)}
                    onFocus={() => setDismissed(null)}
                />
                <div className="composer-bar">
                    <div className="composer-tools">
                        <button
                            type="button"
                            className="icon-button"
                            title="Joindre des fichiers"
                            aria-label="Joindre des fichiers"
                            disabled={disabled || uploading || attachments.length >= MAX_ATTACHMENTS}
                            onClick={attach}
                        >
                            <PaperclipIcon />
                        </button>
                        <ModelPicker
                            agents={(info && info.agents) || []}
                            modelId={info ? info.modelId : null}
                            disabled={working || disabled}
                            onSelect={onSetModel}
                        />
                    </div>
                    <div className="composer-context">
                        <UsageMeter
                            context={context}
                            details={contextDetails}
                            budget={budget}
                            error={usageError}
                            loading={usageLoading}
                            onRefresh={onRefreshUsage}
                        />
                        {info && info.workspaceName ? (
                            <button
                                type="button"
                                className="chip chip-action"
                                disabled={busy || !onPickFolder}
                                title={busy ? "Indisponible pendant une réponse" : `${info.workspace}\nChanger de dossier`}
                                onClick={onPickFolder}
                            >
                                <FolderIcon />
                                {info.workspaceName}
                            </button>
                        ) : null}
                        {branch ? (
                            <span className="chip branch" title={`Branche git : ${branch}`}>
                                <BranchIcon />
                                {branch}
                            </span>
                        ) : null}
                        {working ? (
                            <button type="button" className="send stop" aria-label="Interrompre" title="Interrompre (Échap)" onClick={stop}>
                                <StopIcon />
                            </button>
                        ) : null}
                        {!working || value.trim() ? (
                            <button
                                type="button"
                                className="send"
                                aria-label={working ? "Mettre en file" : "Envoyer"}
                                title={working ? "Mettre en file (Entrée) : part après la réponse en cours" : "Envoyer (Entrée)"}
                                disabled={!canSend}
                                onClick={() => send()}
                            >
                                <ArrowUpIcon />
                            </button>
                        ) : null}
                    </div>
                </div>
            </div>
        </footer>
    );
}
