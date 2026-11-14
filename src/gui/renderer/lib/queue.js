/**
 * File d'attente des messages saisis pendant une réponse : ils partent un par
 * un, dans l'ordre, dès que l'assistant a fini. Fonctions pures (testées).
 * Élément : { id, text, files } (files = pièces jointes { id, name, bytes }).
 */

let sequence = 0;

/** Ajoute un message à la fin de la file (texte vide ignoré). */
export function enqueue(queue, text, files = []) {
    const value = String(text ?? "").trim();
    if (!value) return queue;
    sequence += 1;
    return [...queue, { id: `q${sequence}`, text: value, files: [...files] }];
}

/** Retire un message de la file. */
export function removeQueued(queue, id) {
    return queue.filter((item) => item.id !== id);
}

/** Premier message à envoyer et reste de la file. */
export function takeNext(queue) {
    if (!queue.length) return { next: null, rest: queue };
    const [next, ...rest] = queue;
    return { next, rest };
}

/**
 * Après une interruption, la file revient dans la zone de saisie (comme Claude
 * Code) : textes en attente puis brouillon actuel, et pièces jointes sans doublon.
 */
export function restoreQueue(queue, draft = "", attachments = []) {
    const text = [...queue.map((item) => item.text), String(draft || "").trim()].filter(Boolean).join("\n\n");
    const known = new Set();
    const files = [...queue.flatMap((item) => item.files || []), ...attachments].filter((file) => {
        if (!file || known.has(file.id)) return false;
        known.add(file.id);
        return true;
    });
    return { text, files };
}

/** Aperçu court d'un message en file (une ligne). */
export function preview(text, max = 60) {
    const line = String(text || "").replace(/\s+/g, " ").trim();
    return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
