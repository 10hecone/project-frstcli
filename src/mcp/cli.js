"use strict";

const config = require("./config");
const approvals = require("./approvals");
const disabledStore = require("./disabled");
const { MASK, SENSITIVE_KEY_RE, redact, redactUrl, createRedactor, secretsOf } = require("./redact");

/*
 * Commande /mcp : gestion des serveurs MCP locaux (sous-commandes à la git).
 *
 *   /mcp [list]    état de chaque serveur
 *   /mcp get <nom>        détail, sans aucun secret
 *   /mcp add [options] <nom> -- <commande> [args…]     (stdio)
 *   /mcp add --transport http|sse [options] <nom> <url>
 *   /mcp add-json <nom> '<json>' [--scope …]
 *   /mcp remove <nom> [--scope …]
 *   /mcp enable|disable <nom>
 *   /mcp reconnect <nom|all>
 *   /mcp allow <serveur>         mcp-call run <serveur> … sans confirmation
 *   /mcp reset-project-choices          oublie les réponses aux serveurs de .mcp.json
 *
 * Un secret n'est jamais accepté en clair sur la ligne (elle reste dans l'historique) :
 * référence ${VAR}, ou saisie masquée (`--env CLE` / `--header Nom` sans valeur).
 */

const USAGE = [
    "Usage : /mcp <sous-commande>",
    "  list       état des serveurs (par défaut)",
    "  get <nom>         détail d'un serveur (sans secret)",
    "  add [--transport stdio|http|sse] [--scope local|project|user] [--env CLE=valeur] [--header \"Nom: valeur\"]",
    "      <nom> -- <commande> [args…]        serveur stdio",
    "      <nom> <url>          serveur http ou sse",
    "  add-json <nom> '<json>' [--scope …]    définition JSON (format .mcp.json)",
    "  remove <nom> [--scope …]",
    "  enable <nom> | disable <nom>",
    "  reconnect <nom|all>",
    "  allow <serveur>          autoriser mcp-call run <serveur> sans confirmation",
    "  reset-project-choices    oublier les réponses aux serveurs du projet (.mcp.json)",
    "Secrets : --env CLE=${VAR} ou --header \"Authorization: Bearer ${VAR}\" ; sans valeur, saisie masquée."
].join("\n");

const STATUS_LABELS = {
    idle: "non connecté (outils non chargés)",
    connecting: "connexion…",
    connected: "connecté",
    failed: "échec",
    "needs-auth": "authentification requise",
    "needs-approval": "en attente d'approbation (serveur du projet)",
    rejected: "refusé (/mcp reset-project-choices pour revenir sur ce choix)",
    disabled: "désactivé (/mcp enable <nom>)",
    closed: "arrêté"
};

// Valeur qui n'est qu'une référence : « ${VAR} », « ${VAR:-défaut} », éventuellement après un mot (« Bearer ${VAR} »).
const REFERENCE_RE = /^(?:[A-Za-z]+\s+)?\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}$/;
const isReference = value => REFERENCE_RE.test(String(value).trim());

// Argument « --cle=valeur » ou « cle=valeur » dont la clé est sensible.
const SENSITIVE_ARG_RE = /^(-{0,2}[^=\s]+)=(.*)$/s;

class McpCliError extends Error {}

const fail = message => {
    throw new McpCliError(message);
};

// ---------------------------------------------------------------------------
// Analyse de la ligne
// ---------------------------------------------------------------------------

/**
 * Découpe une ligne en arguments : blancs comme séparateurs, '…' littéral,
 * "…" avec \" et \\ comme seuls échappements. Lève si un guillemet n'est pas fermé.
 */
function splitArgs(text) {
    const args = [];
    let current = "";
    let started = false;
    let quote = null;

    const input = String(text ?? "");
    for (let i = 0; i < input.length; i += 1) {
        const char = input[i];

        if (quote === "'") {
            if (char === "'") quote = null;
            else current += char;
        } else if (quote === '"') {
            if (char === "\\" && (input[i + 1] === '"' || input[i + 1] === "\\")) {
                current += input[i + 1];
                i += 1;
            } else if (char === '"') {
                quote = null;
            } else {
                current += char;
            }
        } else if (/\s/.test(char)) {
            if (started) args.push(current);
            current = "";
            started = false;
        } else if (char === "'" || char === '"') {
            quote = char;
            started = true;
        } else {
            current += char;
            started = true;
        }
    }

    if (quote) fail(`guillemet ${quote} non fermé`);
    if (started) args.push(current);
    return args;
}

const OPTION_ALIASES = { "-t": "--transport", "-s": "--scope", "-e": "--env", "-H": "--header" };

/** Sépare options (--transport, --scope, --env, --header), arguments positionnels et ce qui suit « -- ». */
function parseOptions(args, allowed) {
    const options = { env: [], header: [] };
    const positional = [];
    let rest = null;

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === "--") {
            rest = args.slice(i + 1);
            break;
        }

        const match = /^(--?[A-Za-z]+)(?:=(.*))?$/s.exec(arg);
        if (!match) {
            positional.push(arg);
            continue;
        }

        const name = OPTION_ALIASES[match[1]] || match[1];
        if (!allowed.includes(name)) {
            fail(`option inconnue : ${match[1]} (les options d'une commande stdio se placent après « -- »)`);
        }

        let value = match[2];
        if (value === undefined) {
            if (i + 1 >= args.length) fail(`valeur manquante pour ${name}`);
            value = args[i + 1];
            i += 1;
        }

        const key = name.slice(2);
        if (key === "env" || key === "header") options[key].push(value);
        else options[key] = value;
    }

    return { options, positional, rest };
}

function scopeOption(options, root) {
    if (options.scope === undefined) return root ? "local" : "user";
    if (!config.SCOPES.includes(options.scope)) fail(`scope inconnu : « ${options.scope} » (local, project ou user)`);
    if (options.scope !== "user" && !root) fail(`le scope « ${options.scope} » demande un dossier ouvert (/project <dossier>)`);
    return options.scope;
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

const plainSecretMessage = (what, name) =>
    `${what} « ${name} » : pas de secret en clair sur la ligne. ` +
    `Utilise une référence \${VAR}, ou omets la valeur pour une saisie masquée.`;

/** Refuse une valeur en clair pour une clé sensible (sauf référence ${VAR}). */
function checkPlainSecret(what, name, value) {
    if (value === "" || isReference(value)) return;
    if (SENSITIVE_KEY_RE.test(name)) fail(plainSecretMessage(what, name));
}

/** Demande un secret en saisie masquée. Un serveur du projet (.mcp.json, partagé) n'accepte que ${VAR}. */
async function askSecretValue(ui, what, name, scope) {
    if (scope === "project") {
        fail(`${what} « ${name} » : .mcp.json est partagé, utilise une référence \${VAR} plutôt qu'une valeur`);
    }
    if (!ui || typeof ui.askSecret !== "function") fail(`${what} « ${name} » : valeur manquante`);

    const value = String((await ui.askSecret(`Valeur de ${what} ${name} (saisie masquée) : `)) ?? "");
    if (!value) fail(`${what} « ${name} » : valeur vide, rien n'a été ajouté`);
    return value;
}

async function parseEnv(list, ui, scope) {
    const env = {};
    for (const item of list) {
        const equal = item.indexOf("=");
        const name = equal === -1 ? item : item.slice(0, equal);
        if (!name) fail(`--env : nom de variable manquant dans « ${redact(item)} »`);

        if (equal === -1) {
            env[name] = await askSecretValue(ui, "la variable", name, scope);
        } else {
            const value = item.slice(equal + 1);
            checkPlainSecret("La variable", name, value);
            env[name] = value;
        }
    }
    return env;
}

async function parseHeaders(list, ui, scope) {
    const headers = {};
    for (const item of list) {
        const colon = item.indexOf(":");
        const name = (colon === -1 ? item : item.slice(0, colon)).trim();
        if (!name) fail("--header : nom d'en-tête manquant (forme « Nom: valeur »)");

        if (colon === -1) {
            headers[name] = await askSecretValue(ui, "l'en-tête", name, scope);
        } else {
            const value = item.slice(colon + 1).trim();
            checkPlainSecret("L'en-tête", name, value);
            headers[name] = value;
        }
    }
    return headers;
}

/** Contrôle des secrets d'une définition JSON (add-json) : la ligne entière est visible. */
function checkDefinitionSecrets(definition) {
    if (!definition || typeof definition !== "object") return;
    for (const [name, value] of Object.entries(definition.env ?? {})) {
        if (typeof value === "string") checkPlainSecret("La variable", name, value);
    }
    for (const [name, value] of Object.entries(definition.headers ?? {})) {
        if (typeof value === "string") checkPlainSecret("L'en-tête", name, value);
    }
}

// ---------------------------------------------------------------------------
// Affichage sans secret
// ---------------------------------------------------------------------------

const maskHeader = value => (isReference(value) ? value : MASK);

function maskArg(arg) {
    const match = SENSITIVE_ARG_RE.exec(arg);
    if (match && SENSITIVE_KEY_RE.test(match[1]) && match[2] !== "" && !isReference(match[2])) {
        return `${match[1]}=${MASK}`;
    }
    return redact(arg);
}

function statusLine(item) {
    let label = STATUS_LABELS[item.status] || item.status;
    if (item.status === "failed" && item.error) label += ` : ${redact(item.error)}`;
    if (item.toolCount !== null && item.toolCount !== undefined) label += ` · ${item.toolCount} outil(s)`;
    return label;
}

function describeServer(server, root) {
    const lines = [`Serveur « ${server.name} »`];
    let file = "";
    try {
        file = ` (${config.scopeFile(server.scope, root)})`;
    } catch {
        // scope sans dossier : pas de chemin à afficher
    }
    lines.push(`  Scope      : ${server.scope}${file}`);
    lines.push(`  Transport  : ${server.type}`);

    if (server.type === "stdio") {
        lines.push(`  Commande   : ${[redact(server.command), ...server.args.map(maskArg)].join(" ")}`);
        const names = Object.keys(server.env);
        if (names.length) lines.push(`  Variables  : ${names.join(", ")} (valeurs masquées)`);
    } else {
        lines.push(`  URL : ${redactUrl(server.url)}`);
        for (const [name, value] of Object.entries(server.headers)) {
            lines.push(`  En-tête    : ${name}: ${maskHeader(value)}`);
        }
    }
    if (server.timeout) lines.push(`  Délai      : ${server.timeout} ms`);
    return lines;
}

// ---------------------------------------------------------------------------
// Sous-commandes
// ---------------------------------------------------------------------------

async function findServer(ctx, name) {
    if (!name) fail("nom du serveur manquant");
    const { servers } = await ctx.loadServers(ctx.root);
    const server = servers.find(item => item.name === name);
    if (!server) {
        const names = servers.map(item => item.name);
        fail(`serveur MCP inconnu : « ${name} » (${names.length ? `serveurs : ${names.join(", ")}` : "aucun serveur configuré"})`);
    }
    return server;
}

async function cmdList(ctx) {
    const { servers, warnings } = await ctx.manager.list();

    if (!servers.length) {
        ctx.ui.info("Aucun serveur MCP. Ajoute-en un : /mcp add <nom> -- <commande> [args…] (voir /mcp help).");
    } else {
        ctx.ui.info(`Serveurs MCP (${servers.length}) :`);
        const width = Math.max(...servers.map(item => item.name.length));
        for (const item of servers) {
            ctx.ui.info(`  ${item.name.padEnd(width)}  ${item.scope.padEnd(7)}  ${item.type.padEnd(5)}  ${statusLine(item)}`);
        }
    }
    for (const warning of warnings) ctx.ui.warn(redact(warning));
    return { ok: true, code: 0 };
}

async function cmdGet(ctx, [name]) {
    const server = await findServer(ctx, name);
    const lines = describeServer(server, ctx.root);

    const { servers } = await ctx.manager.list();
    const item = servers.find(entry => entry.name === name);
    if (item) lines.push(`  État       : ${statusLine(item)}`);

    const connection = ctx.manager.peek(name);
    const tools = connection?.cache?.tools;
    if (Array.isArray(tools)) {
        const names = tools.map(tool => tool.name);
        lines.push(`  Outils     : ${names.length ? names.join(", ") : "aucun"}`);
    }

    // La connexion masque déjà ses valeurs développées ; on masque en plus les valeurs écrites dans la définition.
    const hide = createRedactor(secretsOf(server));
    const tail = connection && typeof connection.stderrTail === "function" ? hide(connection.stderrTail(800)).trim() : "";
    if (tail) {
        lines.push("  Dernières lignes de stderr :");
        for (const line of tail.split("\n")) lines.push(`    ${line}`);
    }

    for (const line of lines) ctx.ui.info(line);
    return { ok: true, code: 0 };
}

/** Prévient si le serveur ajouté est masqué par un scope prioritaire, ou s'il doit être approuvé. */
async function afterAdd(ctx, server, warnings) {
    for (const warning of warnings) ctx.ui.warn(warning);

    const { servers } = await ctx.loadServers(ctx.root);
    const effective = servers.find(item => item.name === server.name);
    if (effective && effective.scope !== server.scope) {
        ctx.ui.warn(`Le scope ${effective.scope} définit aussi « ${server.name} » et passe avant : cette définition est masquée.`);
    }

    // Ajouté par l'utilisateur lui-même : sa réponse est mémorisée (la confiance du dossier reste exigée).
    if (server.scope === "project") await ctx.setDecision(ctx.root, server, approvals.STATUS.approved);

    ctx.ui.info(`Serveur « ${server.name} » ajouté (scope ${server.scope}). Il démarrera au premier mcp-call.`);
    return { ok: true, code: 0 };
}

async function cmdAdd(ctx, args) {
    const { options, positional, rest } = parseOptions(args, ["--transport", "--scope", "--env", "--header"]);
    const scope = scopeOption(options, ctx.root);
    const type = options.transport ?? "stdio";
    if (!config.TYPES.includes(type)) fail(`transport inconnu : « ${type} » (stdio, http ou sse)`);

    const [name, ...others] = positional;
    if (!name) fail(`nom du serveur manquant\n${USAGE}`);
    const nameError = config.checkName(name);
    if (nameError) fail(nameError);

    let definition;
    if (type === "stdio") {
        if (options.header.length) fail("--header ne s'applique qu'aux serveurs http et sse");
        const command = rest ?? others;
        if (!command.length) fail("commande manquante : /mcp add <nom> -- <commande> [args…]");
        definition = { type, command: command[0], args: command.slice(1), env: await parseEnv(options.env, ctx.ui, scope) };
    } else {
        if (options.env.length) fail("--env ne s'applique qu'aux serveurs stdio");
        const target = rest ?? others;
        if (target.length !== 1) fail(`une seule URL attendue : /mcp add --transport ${type} <nom> <url>`);
        definition = { type, url: target[0], headers: await parseHeaders(options.header, ctx.ui, scope) };
    }

    const { server, warnings } = await ctx.addServer(scope, ctx.root, name, definition);
    return afterAdd(ctx, server, warnings);
}

async function cmdAddJson(ctx, args) {
    const { options, positional } = parseOptions(args, ["--scope"]);
    const scope = scopeOption(options, ctx.root);
    const [name, json, ...extra] = positional;
    if (!name || json === undefined || extra.length) fail("usage : /mcp add-json <nom> '<json>' [--scope local|project|user]");

    let definition;
    try {
        definition = JSON.parse(json);
    } catch {
        fail("JSON invalide (entoure-le d'apostrophes : '{\"type\":\"stdio\",…}')");
    }
    checkDefinitionSecrets(definition);

    const { server, warnings } = await ctx.addServer(scope, ctx.root, name, definition);
    return afterAdd(ctx, server, warnings);
}

async function cmdRemove(ctx, args) {
    const { options, positional } = parseOptions(args, ["--scope"]);
    const [name] = positional;
    if (!name || positional.length > 1) fail("usage : /mcp remove <nom> [--scope local|project|user]");

    let scope = options.scope;
    if (scope === undefined) {
        const scopes = ctx.root ? config.SCOPES : ["user"];
        const found = [];
        for (const candidate of scopes) {
            const { servers } = await ctx.readScope(candidate, ctx.root);
            if (servers.some(item => item.name === name)) found.push(candidate);
        }
        if (!found.length) fail(`serveur « ${name} » introuvable`);
        if (found.length > 1) fail(`« ${name} » existe dans plusieurs scopes (${found.join(", ")}) : précise --scope`);
        scope = found[0];
    } else {
        scope = scopeOption(options, ctx.root);
    }

    const removed = await ctx.removeServer(scope, ctx.root, name);
    if (!removed) fail(`serveur « ${name} » absent du scope ${scope}`);

    await ctx.manager.close(name);
    ctx.ui.info(`Serveur « ${name} » retiré du scope ${scope}.`);
    return { ok: true, code: 0 };
}

async function cmdToggle(ctx, [name], enable) {
    await findServer(ctx, name);
    const changed = await ctx.setDisabled(ctx.root, name, !enable);
    if (!enable) await ctx.manager.close(name);

    if (!changed) ctx.ui.info(`Serveur « ${name} » déjà ${enable ? "activé" : "désactivé"}.`);
    else ctx.ui.info(`Serveur « ${name} » ${enable ? "réactivé" : "désactivé"}.`);
    return { ok: true, code: 0 };
}

async function reconnectOne(ctx, name) {
    try {
        const connection = await ctx.manager.reconnect(name, { ui: ctx.ui });
        let tools = "";
        if (typeof connection.listTools === "function") {
            try {
                tools = ` · ${(await connection.listTools()).length} outil(s)`;
            } catch {
                // le serveur ne propose pas d'outils
            }
        }
        ctx.ui.info(`« ${name} » : connecté${tools}.`);
        return true;
    } catch (error) {
        ctx.ui.warn(`« ${name} » : ${redact(error.message)}`);
        return false;
    }
}

async function cmdReconnect(ctx, [name]) {
    if (!name) fail("usage : /mcp reconnect <nom|all>");

    if (name !== "all") {
        await findServer(ctx, name);
        const ok = await reconnectOne(ctx, name);
        return { ok, code: ok ? 0 : 1 };
    }

    const { servers } = await ctx.manager.list();
    const targets = servers.filter(item => item.status !== "disabled" && item.status !== "rejected");
    if (!targets.length) {
        ctx.ui.info("Aucun serveur à reconnecter.");
        return { ok: true, code: 0 };
    }

    let ok = true;
    for (const item of targets) ok = (await reconnectOne(ctx, item.name)) && ok;
    return { ok, code: ok ? 0 : 1 };
}

async function cmdAllow(ctx, [name]) {
    await findServer(ctx, name);
    const store = ctx.permissionStore();
    if (!store) fail("ouvre un projet (/project <dossier>) : les règles sont enregistrées par projet");

    const added = await store.add(["mcp-call", "run", name]);
    ctx.ui.info(added
        ? `Règle ajoutée : « mcp-call run ${name} » ne demande plus de confirmation (retrait : /permissions remove).`
        : `La règle « mcp-call run ${name} » existe déjà.`);
    return { ok: true, code: 0 };
}

async function cmdResetProjectChoices(ctx) {
    if (!ctx.root) fail("aucun dossier ouvert (/project <dossier>)");
    const count = await ctx.resetProjectChoices(ctx.root);
    ctx.ui.info(count
        ? `${count} choix effacé(s) : les serveurs de .mcp.json seront redemandés au prochain usage.`
        : "Aucun choix mémorisé pour ce dossier.");
    return { ok: true, code: 0 };
}

function cmdAuth(ctx) {
    ctx.ui.info(
        "La connexion OAuth aux serveurs MCP n'est pas encore disponible. " +
        "En attendant : /mcp add --transport http --header \"Authorization: Bearer ${MON_JETON}\" <nom> <url>."
    );
    return { ok: false, code: 1 };
}

// ---------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------

function contextOf(options) {
    const ui = options.ui ?? require("../ui-bridge").ui;
    const manager = options.manager ?? require("./manager").getManager();
    const root = options.root !== undefined ? options.root : manager.root;

    return {
        ui,
        manager,
        root,
        loadServers: options.loadServers ?? config.loadServers,
        readScope: options.readScope ?? config.readScope,
        addServer: options.addServer ?? config.addServer,
        removeServer: options.removeServer ?? config.removeServer,
        setDisabled: options.setDisabled ?? disabledStore.setDisabled,
        setDecision: options.setDecision ?? approvals.setDecision,
        resetProjectChoices: options.resetProjectChoices ?? approvals.resetProjectChoices,
        permissionStore: options.permissionStore
            ? () => options.permissionStore
            : () => require("../tools/command/index").getPermissionStore()
    };
}

/**
 * Exécute /mcp. `argv` : tableau d'arguments ou ligne brute (découpée par splitArgs).
 * Les dépendances sont injectables (tests). Renvoie { ok, code } ; n'échoue jamais par exception.
 */
async function runMcpCommand(argv = [], options = {}) {
    let ctx;
    try {
        ctx = contextOf(options);
        const args = Array.isArray(argv) ? [...argv] : splitArgs(argv);
        const [action = "list", ...rest] = args;

        switch (action) {
            case "list":
                return await cmdList(ctx);
            case "get":
                return await cmdGet(ctx, rest);
            case "add":
                return await cmdAdd(ctx, rest);
            case "add-json":
                return await cmdAddJson(ctx, rest);
            case "remove":
                return await cmdRemove(ctx, rest);
            case "enable":
                return await cmdToggle(ctx, rest, true);
            case "disable":
                return await cmdToggle(ctx, rest, false);
            case "reconnect":
                return await cmdReconnect(ctx, rest);
            case "allow":
                return await cmdAllow(ctx, rest);
            case "reset-project-choices":
                return await cmdResetProjectChoices(ctx);
            case "login":
            case "logout":
                return cmdAuth(ctx);
            case "help":
            case "--help":
            case "-h":
                ctx.ui.info(USAGE);
                return { ok: true, code: 0 };
            default:
                fail(`sous-commande inconnue : « ${action} »\n${USAGE}`);
        }
    } catch (error) {
        const known = error instanceof McpCliError || error instanceof config.McpConfigError;
        const message = known ? error.message : `erreur inattendue : ${error.message}`;
        const ui = ctx?.ui ?? options.ui ?? require("../ui-bridge").ui;
        ui.error(`/mcp : ${redact(message)}`);
        return { ok: false, code: known ? 2 : 1 };
    }
    return { ok: false, code: 2 };
}

module.exports = { USAGE, STATUS_LABELS, splitArgs, parseOptions, isReference, maskArg, describeServer, runMcpCommand };
