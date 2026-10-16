/**
 * Port d'interface (étape 1 du plan).
 *
 * Les modules métier appellent `ui.xxx()` sans savoir quel rendu est actif :
 * la CLI readline (par défaut) ou la TUI Ink (branchée via setUiBackend).
 * Chaque méthode délègue au backend actif au moment de l'appel.
 */

const UI_METHODS = [
    "info", "warn", "error", "debug", "print", "assistant", "plan", "tool",
    "result", "diff", "commandLine", "stream", "spinner", "confirm",
    "askCommand", "ask", "askSecret", "onInterrupt", "banner", "prompt"
];

let backend = null;

/**
 * Renvoie le backend actif. Le backend CLI est chargé à la demande
 * (require paresseux) pour éviter un cycle avec state/config.
 */
function getUiBackend() {
    if (!backend) backend = require("./cli/ui").ui;
    return backend;
}

/**
 * Remplace le backend actif. `null` ou `undefined` rétablit le backend CLI par défaut.
 */
function setUiBackend(impl) {
    if (impl != null && typeof impl !== "object") {
        throw new TypeError("Interface : le backend doit être un objet.");
    }
    backend = impl || null;
}

const ui = {};
for (const name of UI_METHODS) {
    ui[name] = function (...args) {
        const impl = getUiBackend();
        if (typeof impl[name] !== "function") {
            throw new Error(`Interface : méthode « ${name} » absente du backend actif.`);
        }
        return impl[name].apply(impl, args);
    };
}
Object.freeze(ui);

module.exports = { ui, setUiBackend, getUiBackend, UI_METHODS };
