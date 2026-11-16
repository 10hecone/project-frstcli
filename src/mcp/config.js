"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { CONFIG } = require("../config");
const { projectDir } = require("../project/memory");
const { writeJsonFile } = require("../tools/core/atomic");

/*
 * Configuration des serveurs MCP locaux (même format que Claude Code) :
 *   { "mcpServers": { "<nom>": { "type", "command", "args", "env", "url", "headers", "timeout" } } }
 *
 * Trois scopes, par ordre de précédence (le premier trouvé gagne, sans fusion champ par champ) :
 *   local    ~/.francestudent-cli/projects/<projet>/mcp.json   privé, ce projet
 *   project  <projet>/.mcp.json    partageable
 *   user     ~/.francestudent-cli/mcp.json       tous les projets
 *
 * Les variables ${VAR} et ${VAR:-défaut} ne sont développées qu'à la connexion
 * (expandServer) : le fichier garde le modèle, donc jamais de secret développé sur le disque.
 */

const FILE_NAME = "mcp.json";
const PROJECT_FILE_NAME = ".mcp.json";

const SCOPES = ["local", "project", "user"]; // du plus prioritaire au moins prioritaire
const TYPES = ["stdio", "http", "sse"];

// Sous-commandes de `mcp-call` : un serveur ne peut pas porter ces noms (raccourci `mcp-call <serveur>`).
const RESERVED_NAMES = ["list", "tools", "describe", "run", "resources", "read", "prompts", "prompt", "help"];

const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ENV_NAME_RE = /^[^=\0\s]+$/;
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const HEADER_VALUE_BAD_RE = /[\r\n\0]/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const URL_BAD_CHARS_RE = /[\s\u0000-\u001f\u007f]/;
const URL_AUTHORITY_RE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/\\?#]/;

const HAS_VAR_RE = /\$\{/;
const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

const MAX_SERVERS = 50;
const MAX_URL_CHARS = 2048;
const MIN_TIMEOUT_MS = 1000;

const URL_SCHEME_MESSAGE = "https obligatoire (http seulement pour localhost, 127.0.0.1 et [::1])";
const URL_CREDENTIALS_MESSAGE = "l'url ne doit pas contenir d'identifiants (utilisateur:mot-de-passe@)";

class McpConfigError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = "McpConfigError";
        Object.assign(this, details);
    }
}

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const isStringArray = value => Array.isArray(value) && value.every(item => typeof item === "string");
const isStringMap = value => isObject(value) && Object.values(value).every(item => typeof item === "string");
const short = value => JSON.stringify(String(value).slice(0, 40));

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Message d'erreur si le nom n'est pas utilisable, sinon null. */
function checkName(name) {
    if (typeof name !== "string" || !NAME_RE.test(name)) {
        return "nom invalide : 1 à 64 caractères parmi lettres, chiffres, _ et -";
    }
    if (name === "__proto__") return "nom interdit";
    if (RESERVED_NAMES.includes(name.toLowerCase())) {
        return `nom réservé (sous-commande de mcp-call) : « ${name} »`;
    }
    return null;
}

// URL concrète : https, ou http seulement pour la machine locale ; pas d'identifiants dans l'URL.
function checkConcreteUrl(value) {
    if (value.length > MAX_URL_CHARS) return `url trop longue (${MAX_URL_CHARS} caractères maximum)`;

    // L'analyseur d'URL est trop indulgent (« https:///x » devient l'hôte « x », les blancs sont retirés) :
    // on exige un hôte juste après « :// » et aucun blanc ni caractère de contrôle.
    if (URL_BAD_CHARS_RE.test(value) || !URL_AUTHORITY_RE.test(value)) return "url invalide";

    let url;
    try {
        url = new URL(value);
    } catch {
        return "url invalide";
    }

    if (url.username || url.password) return URL_CREDENTIALS_MESSAGE;
    if (url.protocol === "https:") return null;
    if (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)) return null;
    return URL_SCHEME_MESSAGE;
}

// URL avec ${VAR} : contrôles possibles sans connaître les valeurs ; le reste est refait après développement.
function checkTemplateUrl(value) {
    if (value.length > MAX_URL_CHARS) return `url trop longue (${MAX_URL_CHARS} caractères maximum)`;

    if (URL_BAD_CHARS_RE.test(value)) return "url invalide";

    const match = /^(https?):\/\/([^/?#]*)/i.exec(value);
    if (!match) return URL_SCHEME_MESSAGE;

    const authority = match[2];
    if (!authority || authority.includes("\\")) return "url invalide";
    if (authority.includes("@")) return URL_CREDENTIALS_MESSAGE;

    if (match[1].toLowerCase() === "http" && !HAS_VAR_RE.test(authority)) {
        const host = authority.toLowerCase().replace(/:\d*$/, "");
        if (!LOCAL_HOSTS.has(host)) return URL_SCHEME_MESSAGE;
    }
    return null;
}

const checkUrl = value => (HAS_VAR_RE.test(value) ? checkTemplateUrl(value) : checkConcreteUrl(value));

function checkHeaders(headers) {
    for (const [name, value] of Object.entries(headers)) {
        if (!HEADER_NAME_RE.test(name)) return `nom d'en-tête invalide : ${short(name)}`;
        if (HEADER_VALUE_BAD_RE.test(value)) return `valeur invalide pour l'en-tête ${short(name)}`;
    }
    return null;
}

/**
 * Valide et normalise la définition d'un serveur.
 * Renvoie { server, warnings } ou { error } ; les valeurs ne sont jamais recopiées dans les messages.
 */
function validateServer(raw) {
    if (!isObject(raw)) return { error: "la définition doit être un objet" };

    let type = raw.type;
    if (type === undefined) {
        if (raw.command === undefined) return { error: 'champ "type" manquant (stdio, http ou sse)' };
        type = "stdio";
    }
    if (typeof type !== "string" || !TYPES.includes(type)) {
        return {
            error: type === "ws"
                ? 'champ "type" : « ws » (WebSocket) n\'est pas pris en charge (stdio, http ou sse)'
                : `champ "type" : valeur inconnue ${short(type)} (stdio, http ou sse)`
        };
    }

    let server;

    if (type === "stdio") {
        if (typeof raw.command !== "string" || !raw.command.trim()) {
            return { error: 'champ "command" : chaîne non vide requise' };
        }
        if (raw.args !== undefined && !isStringArray(raw.args)) {
            return { error: 'champ "args" : tableau de chaînes requis' };
        }
        if (raw.env !== undefined && !isStringMap(raw.env)) {
            return { error: 'champ "env" : objet de chaînes requis' };
        }

        const badName = Object.keys(raw.env ?? {}).find(name => !ENV_NAME_RE.test(name));
        if (badName !== undefined) return { error: `champ "env" : nom de variable invalide ${short(badName)}` };

        server = { type, command: raw.command, args: [...(raw.args ?? [])], env: { ...raw.env } };
    } else {
        if (typeof raw.url !== "string" || !raw.url) return { error: 'champ "url" : chaîne non vide requise' };

        const urlError = checkUrl(raw.url);
        if (urlError) return { error: `champ "url" : ${urlError}` };

        if (raw.headers !== undefined && !isStringMap(raw.headers)) {
            return { error: 'champ "headers" : objet de chaînes requis' };
        }

        const headerError = checkHeaders(raw.headers ?? {});
        if (headerError) return { error: `champ "headers" : ${headerError}` };

        server = { type, url: raw.url, headers: { ...raw.headers } };
    }

    const warnings = [];
    if (raw.timeout !== undefined) {
        if (Number.isInteger(raw.timeout) && raw.timeout >= MIN_TIMEOUT_MS) {
            server.timeout = raw.timeout;
        } else {
            warnings.push(`champ "timeout" ignoré (entier d'au moins ${MIN_TIMEOUT_MS} ms attendu)`);
        }
    }

    return { server, warnings };
}

// Forme écrite sur le disque : sans les champs vides.
function toStored(server) {
    const out = { type: server.type };

    if (server.type === "stdio") {
        out.command = server.command;
        if (server.args.length) out.args = server.args;
        if (Object.keys(server.env).length) out.env = server.env;
    } else {
        out.url = server.url;
        if (Object.keys(server.headers).length) out.headers = server.headers;
    }
    if (server.timeout) out.timeout = server.timeout;

    return out;
}

// ---------------------------------------------------------------------------
// Fichiers et scopes
// ---------------------------------------------------------------------------

/** Fichier d'un scope. `workspace` : racine du dossier ouvert (inutile pour « user »). */
function scopeFile(scope, workspace) {
    if (!SCOPES.includes(scope)) {
        throw new McpConfigError(`scope inconnu : ${short(scope)} (local, project ou user)`);
    }
    if (scope === "user") return path.join(CONFIG.dataDir, FILE_NAME);
    if (!workspace) throw new McpConfigError(`le scope « ${scope} » demande un dossier ouvert`);
    if (scope === "local") return path.join(projectDir(workspace), FILE_NAME);
    return path.join(workspace, PROJECT_FILE_NAME);
}

/**
 * Lit un scope. Ne lève jamais pour un contenu mal formé : une entrée invalide est ignorée
 * avec un avertissement qui nomme le champ, les autres serveurs se chargent.
 */
async function readScope(scope, workspace) {
    const file = scopeFile(scope, workspace);
    const result = { scope, file, servers: [], warnings: [] };
    const label = `${scope} (${file})`;

    let text;
    try {
        text = await fs.readFile(file, "utf8");
    } catch (error) {
        if (error.code !== "ENOENT" && error.code !== "ENOTDIR") {
            result.warnings.push(`${label} : lecture impossible (${error.code || "erreur"})`);
        }
        return result;
    }

    let data;
    try {
        data = JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch {
        result.warnings.push(`${label} : JSON invalide, fichier ignoré`);
        return result;
    }

    const entries = isObject(data) ? data.mcpServers : undefined;
    if (entries === undefined) return result;
    if (!isObject(entries)) {
        result.warnings.push(`${label} : « mcpServers » doit être un objet, fichier ignoré`);
        return result;
    }

    const list = Object.entries(entries);
    if (list.length > MAX_SERVERS) {
        result.warnings.push(`${label} : ${MAX_SERVERS} serveurs au maximum, les suivants sont ignorés`);
    }

    for (const [name, raw] of list.slice(0, MAX_SERVERS)) {
        const nameError = checkName(name);
        if (nameError) {
            result.warnings.push(`${label} : serveur ${short(name)} ignoré, ${nameError}`);
            continue;
        }

        const checked = validateServer(raw);
        if (checked.error) {
            result.warnings.push(`${label} : serveur « ${name} » ignoré, ${checked.error}`);
            continue;
        }

        for (const warning of checked.warnings) {
            result.warnings.push(`${label} : serveur « ${name} », ${warning}`);
        }
        result.servers.push({ name, scope, ...checked.server });
    }

    return result;
}

/**
 * Tous les serveurs visibles depuis `workspace` (seulement « user » sans dossier ouvert).
 * Précédence local > project > user par nom ; chaque serveur garde son scope d'origine.
 */
async function loadServers(workspace) {
    const scopes = workspace ? SCOPES : ["user"];
    const results = await Promise.all(scopes.map(scope => readScope(scope, workspace)));
    const byName = new Map();
    const warnings = [];

    for (const result of results) {
        warnings.push(...result.warnings);
        for (const server of result.servers) {
            if (!byName.has(server.name)) byName.set(server.name, server);
        }
    }

    const servers = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { servers, warnings };
}

// ---------------------------------------------------------------------------
// Écriture : modification du fichier brut (le reste du fichier est conservé tel quel)
// ---------------------------------------------------------------------------

// Les écritures d'un même processus passent l'une après l'autre : pas de mise à jour perdue.
let chain = Promise.resolve();
function exclusive(task) {
    const run = chain.then(task);
    chain = run.catch(() => {});
    return run;
}

// Fichier temporaire puis rename. « local » et « user » : 0o600 dans un dossier 0o700.
// « project » (.mcp.json) est fait pour être partagé : droits par défaut, sans toucher au dossier du projet.
const writeJson = writeJsonFile;

// Fichier brut et son objet « mcpServers ». Un fichier illisible n'est jamais écrasé.
async function readRaw(file) {
    let text;
    try {
        text = await fs.readFile(file, "utf8");
    } catch (error) {
        if (error.code === "ENOENT") return { data: {}, servers: {}, exists: false };
        throw new McpConfigError(`lecture impossible : ${file} (${error.code || "erreur"})`);
    }

    let data;
    try {
        data = JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch {
        throw new McpConfigError(`JSON invalide dans ${file} : corrige le fichier avant de le modifier`);
    }
    if (!isObject(data)) throw new McpConfigError(`${file} doit contenir un objet JSON`);
    if (data.mcpServers !== undefined && !isObject(data.mcpServers)) {
        throw new McpConfigError(`« mcpServers » doit être un objet dans ${file}`);
    }

    return { data, servers: data.mcpServers ?? {}, exists: true };
}

/**
 * Ajoute (ou remplace, avec { replace: true }) un serveur dans un scope.
 * Lève McpConfigError si le nom ou la définition est invalide, si le nom existe déjà ou si le scope est plein.
 * Renvoie { server, warnings }.
 */
function addServer(scope, workspace, name, definition, { replace = false } = {}) {
    return exclusive(async () => {
        const file = scopeFile(scope, workspace);

        const nameError = checkName(name);
        if (nameError) throw new McpConfigError(nameError);

        const checked = validateServer(definition);
        if (checked.error) throw new McpConfigError(checked.error);

        const { data, servers } = await readRaw(file);
        const exists = Object.hasOwn(servers, name);

        if (exists && !replace) throw new McpConfigError(`« ${name} » existe déjà dans le scope ${scope}`);
        if (!exists && Object.keys(servers).length >= MAX_SERVERS) {
            throw new McpConfigError(`${MAX_SERVERS} serveurs au maximum par scope`);
        }

        servers[name] = toStored(checked.server);
        await writeJson(file, { ...data, mcpServers: servers }, { shared: scope === "project" });

        return { server: { name, scope, ...checked.server }, warnings: checked.warnings };
    });
}

/** Retire un serveur d'un scope. Renvoie false s'il n'y était pas. */
function removeServer(scope, workspace, name) {
    return exclusive(async () => {
        const file = scopeFile(scope, workspace);
        const { data, servers, exists } = await readRaw(file);

        if (!exists || !Object.hasOwn(servers, name)) return false;

        delete servers[name];
        await writeJson(file, { ...data, mcpServers: servers }, { shared: scope === "project" });
        return true;
    });
}

// ---------------------------------------------------------------------------
// Variables ${VAR} et ${VAR:-défaut} (à la connexion seulement)
// ---------------------------------------------------------------------------

/**
 * Développe une chaîne. Une variable absente sans défaut lève une erreur qui la nomme
 * (Claude Code garde le texte « ${VAR} » : ici un faux jeton ne partirait jamais chez le serveur).
 * FS_* (identifiants France Student) n'est jamais développé. Le résultat n'est pas redéveloppé.
 * Les messages ne contiennent jamais de valeur.
 */
function expandString(value, env = process.env, field = "valeur") {
    return value.replace(VAR_RE, (_match, name, fallback) => {
        if (/^FS_/i.test(name)) {
            throw new McpConfigError(
                `${name} (identifiants France Student) ne peut pas être utilisée dans une configuration MCP`,
                { variable: name, field }
            );
        }

        const current = env[name];

        if (fallback !== undefined) return current === undefined || current === "" ? fallback : current;

        if (current === undefined) {
            throw new McpConfigError(
                `variable d'environnement ${name} non définie (${field}) : définis-la ou utilise la forme avec défaut`,
                { variable: name, field }
            );
        }
        return current;
    });
}

/** Copie d'un serveur avec les variables développées (commande, arguments, env, url, en-têtes). */
function expandServer(server, env = process.env) {
    const expandMap = (map, label) => Object.fromEntries(
        Object.entries(map).map(([key, value]) => [key, expandString(value, env, `${label}.${key}`)])
    );

    if (server.type === "stdio") {
        const command = expandString(server.command, env, "command");
        if (!command.trim()) {
            throw new McpConfigError("« command » est vide après développement des variables", { field: "command" });
        }

        return {
            ...server,
            command,
            args: server.args.map((arg, index) => expandString(arg, env, `args[${index}]`)),
            env: expandMap(server.env, "env")
        };
    }

    const url = expandString(server.url, env, "url");
    const urlError = checkConcreteUrl(url);
    if (urlError) {
        throw new McpConfigError(`« url » après développement des variables : ${urlError}`, { field: "url" });
    }

    const headers = expandMap(server.headers, "headers");
    const headerError = checkHeaders(headers);
    if (headerError) {
        throw new McpConfigError(`« headers » après développement des variables : ${headerError}`, { field: "headers" });
    }

    return { ...server, url, headers };
}

module.exports = {
    FILE_NAME,
    PROJECT_FILE_NAME,
    SCOPES,
    TYPES,
    RESERVED_NAMES,
    MAX_SERVERS,
    McpConfigError,
    checkName,
    validateServer,
    scopeFile,
    readScope,
    loadServers,
    addServer,
    removeServer,
    expandString,
    expandServer
};
