/**
 * Options des dialogues de confirmation : mêmes réponses que la TUI
 * (src/tui/components/ConfirmDialog.jsx), donc même sémantique côté adaptateur.
 * o = oui une fois, n = non, t = toujours.
 */
export function confirmOptions({ kind = "confirm", force = false, prefix = "" } = {}) {
    const options = [
        { value: "o", label: "Oui (une fois)", key: "o" },
        { value: "n", label: "Non", key: "n" }
    ];
    if (kind === "command") options.push({ value: "t", label: `Toujours « ${prefix} »`, key: "t" });
    else if (!force) options.push({ value: "t", label: "Toujours (tout autoriser pour la session)", key: "t" });
    return options;
}

/** Les questions ouvertes (ask, secret) attendent du texte ; les autres un choix. */
export function isTextPrompt(prompt) {
    return Boolean(prompt) && (prompt.kind === "ask" || prompt.kind === "secret");
}
