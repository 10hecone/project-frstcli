"use strict";

/**
 * Préférences de l'utilisateur modifiables depuis le panneau Paramètres de l'interface
 * graphique, enregistrées en haut niveau de ~/.francestudent-cli/settings.json
 * (les clés « hooks », « permissions », « shellPath »… sont conservées telles quelles).
 *
 * Une variable d'environnement définie a priorité : le champ correspondant est verrouillé.
 * Par sécurité, la page ne peut modifier ni shellPath ni les règles allow/deny : ils sont
 * seulement affichés (à changer dans le fichier lui-même).
 */

const fs = require("node:fs/promises");
const path = require("node:path");

const { CONFIG, KNOWN_MODELS } = require("../config");
const { userFile, readJson, isObject } = require("./settings");

const PERMISSION_MODES = ["default", "acceptEdits", "plan"];
const SHELL_MODES = ["auto", "bash", "powershell", "off"];

const seconds = (key) => (value) => {
    CONFIG[key] = value * 1000;
};
const direct = (key) => (value) => {
    CONFIG[key] = value;
};

/**
 * Champs : type select (options), number (min, max) ou bool ; env = variable qui verrouille ;
 * apply = application immédiate à CONFIG ; startup = application au démarrage seulement.
 */
const FIELDS = [
    {
        key: "model",
        label: "Modèle par défaut",
        hint: "Modèle des nouvelles sessions (le choix de la barre de chat reste possible).",
        type: "select",
        default: -1002,
        env: "FS_AGENT_ID",
        apply: direct("defaultAgentId"),
        startup: (value) => {
            require("../state").state.model = value;
        }
    },
    {
        key: "permissionMode",
        label: "Mode de permission au démarrage",
        hint: "default : écritures et commandes confirmées ; acceptEdits : écritures acceptées ; plan : lecture seule.",
        type: "select",
        options: PERMISSION_MODES.map((value) => ({ value, label: value })),
        default: "default",
        startup: (value) => {
            require("./permissions-mode").set(value);
        }
    },
    {
        key: "shell",
        label: "Shell de run_command",
        hint: "auto : Git Bash s'il est trouvé, sinon PowerShell (Windows) ; off : sans shell.",
        type: "select",
        options: SHELL_MODES.map((value) => ({ value, label: value })),
        default: "auto",
        env: "FS_SHELL"
    },
    {
        key: "autoCompactPercent",
        label: "Compaction automatique (%)",
        hint: "Résume la conversation à ce pourcentage de contexte ; 0 la désactive.",
        type: "number",
        min: 0,
        max: 95,
        default: 85,
        env: "FS_AUTO_COMPACT",
        apply: direct("autoCompactPercent")
    },
    {
        key: "maxAgentTurns",
        label: "Rondes d'outils avant confirmation",
        hint: "0 = sans limite.",
        type: "number",
        min: 0,
        max: 500,
        default: 0,
        env: "FS_MAX_AGENT_TURNS",
        apply: direct("maxAgentTurns")
    },
    {
        key: "firstByteTimeoutSeconds",
        label: "Délai de première réponse (s)",
        type: "number",
        min: 10,
        max: 300,
        default: 60,
        env: "FS_FIRST_BYTE_TIMEOUT_MS",
        apply: seconds("firstByteTimeoutMs")
    },
    {
        key: "idleTimeoutSeconds",
        label: "Délai d'inactivité du flux (s)",
        type: "number",
        min: 10,
        max: 300,
        default: 90,
        env: "FS_IDLE_TIMEOUT_MS",
        apply: seconds("idleTimeoutMs")
    },
    {
        key: "mcpToolTimeoutSeconds",
        label: "Délai d'un outil MCP (s)",
        type: "number",
        min: 1,
        max: 600,
        default: 120,
        env: "FS_MCP_TOOL_TIMEOUT_MS",
        apply: seconds("mcpToolTimeoutMs")
    },
    {
        key: "optim",
        label: "Optimisations de consommation",
        type: "bool",
        default: true,
        env: "FS_OPTIM",
        apply: direct("optim")
    },
    {
        key: "includeLearnedTopics",
        label: "Inclure les sujets appris",
        hint: "Ajoute les sujets mémorisés au premier message (plus long).",
        type: "bool",
        default: false,
        env: "FS_INCLUDE_LEARNED_TOPICS",
        apply: direct("includeLearnedTopics")
    },
    {
        key: "resumeInProject",
        label: "Reprendre la session dans le projet",
        type: "bool",
        default: false,
        env: "FS_RESUME_IN_PROJECT",
        apply: direct("resumeInProject")
    }
];

const BY_KEY = new Map(FIELDS.map((field) => [field.key, field]));

/** Vrai si la variable d'environnement du champ est définie (elle a alors priorité). */
function lockedBy(field, env = process.env) {
    return field.env && env[field.env] !== undefined && env[field.env] !== "" ? field.env : null;
}

/** Valeur validée, ou lève une erreur claire. */
function validate(field, value, modelIds = null) {
    if (field.type === "bool") {
        if (typeof value !== "boolean") throw new Error(`${field.label} : vrai ou faux attendu.`);
        return value;
    }
    if (field.type === "number" || field.key === "model") {
        const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
        if (!Number.isInteger(n)) throw new Error(`${field.label} : nombre entier attendu.`);
        if (field.type === "number" && (n < field.min || n > field.max)) {
            throw new Error(`${field.label} : entre ${field.min} et ${field.max}.`);
        }
        if (field.key === "model" && modelIds && !modelIds.includes(n)) {
            throw new Error(`${field.label} : modèle inconnu.`);
        }
        return n;
    }
    const allowed = field.options.map((option) => option.value);
    const wanted = String(value ?? "").toLowerCase();
    const found = allowed.find((option) => option.toLowerCase() === wanted);
    if (!found) throw new Error(`${field.label} : ${allowed.join(", ")} attendu.`);
    return found;
}

/** Contenu du fichier utilisateur ({} s'il est absent) ; lève une erreur s'il est invalide. */
async function readUserFile() {
    const data = await readJson(userFile());
    if (data === null) return {};
    if (!isObject(data)) throw new Error(`${userFile()} : objet JSON attendu.`);
    return data;
}

/** Valeur enregistrée valide, sinon null (valeur absente ou incorrecte : défaut). */
function storedValue(field, data) {
    if (!(field.key in data)) return null;
    try {
        return validate(field, data[field.key]);
    } catch {
        return null;
    }
}

const stringList = (value) => (Array.isArray(value) ? value.map(String) : []);

/**
 * État du panneau : { file, fields, readonly, error }.
 * agents : liste { id, name } pour le choix du modèle (KNOWN_MODELS par défaut).
 */
async function read({ agents = null, env = process.env } = {}) {
    let data = {};
    let error = null;
    try {
        data = await readUserFile();
    } catch (err) {
        error = err.message;
    }
    const models = Array.isArray(agents) && agents.length ? agents : KNOWN_MODELS;
    const fields = FIELDS.map((field) => {
        const stored = storedValue(field, data);
        const options = field.key === "model"
            ? models.map((agent) => ({ value: Number(agent.id), label: String(agent.name || agent.id) }))
            : field.options;
        return {
            key: field.key,
            label: field.label,
            hint: field.hint || "",
            type: field.type,
            options: options || null,
            min: field.min ?? null,
            max: field.max ?? null,
            default: field.default,
            value: stored === null ? field.default : stored,
            saved: stored !== null,
            locked: lockedBy(field, env)
        };
    });
    const permissions = isObject(data.permissions) ? data.permissions : {};
    return {
        file: userFile(),
        fields,
        readonly: {
            shellPath: typeof data.shellPath === "string" ? data.shellPath : "",
            allow: stringList(permissions.allow),
            deny: stringList(permissions.deny)
        },
        error
    };
}

/** Écriture atomique (fichier temporaire puis renommage). */
async function writeUserFile(data) {
    const file = userFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    try {
        await fs.rename(tmp, file);
    } catch (error) {
        await fs.rm(tmp, { force: true }).catch(() => {});
        throw error;
    }
}

/**
 * Enregistre des préférences : patch { clé: valeur } (null = revenir au défaut).
 * Tout est validé avant d'écrire ; les champs verrouillés ou inconnus sont refusés.
 * Les valeurs sont appliquées aussitôt à CONFIG. Renvoie l'état du panneau.
 */
async function save(patch, { agents = null, env = process.env } = {}) {
    if (!isObject(patch)) throw new Error("Préférences invalides.");
    const modelIds = Array.isArray(agents) && agents.length ? agents.map((agent) => Number(agent.id)) : null;
    const changes = [];
    for (const [key, value] of Object.entries(patch)) {
        const field = BY_KEY.get(key);
        if (!field) throw new Error(`Réglage inconnu : ${key}.`);
        const locked = lockedBy(field, env);
        if (locked) throw new Error(`${field.label} : fixé par la variable ${locked}.`);
        changes.push([field, value === null ? null : validate(field, value, modelIds)]);
    }
    // Un fichier invalide n'est jamais écrasé : l'utilisateur le corrige lui-même.
    const data = await readUserFile();
    for (const [field, value] of changes) {
        if (value === null) delete data[field.key];
        else data[field.key] = value;
    }
    await writeUserFile(data);
    for (const [field, value] of changes) {
        if (field.apply) field.apply(value === null ? field.default : value);
    }
    return read({ agents, env });
}

/**
 * Applique les préférences enregistrées au démarrage (avant la restauration de session).
 * Les champs fixés par une variable d'environnement sont ignorés. Renvoie les erreurs.
 */
async function applyUserSettings({ env = process.env } = {}) {
    let data;
    try {
        data = await readUserFile();
    } catch (error) {
        return [error.message];
    }
    for (const field of FIELDS) {
        if (lockedBy(field, env)) continue;
        const value = storedValue(field, data);
        if (value === null) continue;
        if (field.apply) field.apply(value);
        if (field.startup) field.startup(value);
    }
    return [];
}

module.exports = { FIELDS, read, save, applyUserSettings, validate, lockedBy };
