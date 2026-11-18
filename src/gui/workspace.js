"use strict";

/**
 * Services de la barre latérale et de la barre de chat de l'interface graphique :
 * historique des chats, projets, usage, skills, choix du modèle, pièces jointes.
 *
 * Ne dépend pas d'Electron. Toutes les dépendances sont injectables (tests) :
 * rest ({ request, uploadFile }), agents, projects, stateModule, detectEnvironment,
 * sessionUsage.
 */

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { workspace } = require("../core/workspace");

const CHAT_PAGE = 40;

// Types d'image acceptés au collage (presse-papiers) → extension du fichier envoyé.
const IMAGE_EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp"
};

// Aperçu des pièces jointes : images courantes seulement (le SVG peut contenir du script), 3 Mo au plus.
const PREVIEW_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp"
};
const PREVIEW_MAX_BYTES = 3 * 1024 * 1024;

const text = (value) => (value === null || value === undefined ? "" : String(value));

/** URL data: d'aperçu d'une image locale, ou null (autre type, trop lourde, illisible). Ne lève jamais. */
async function previewOf(filePath) {
    const mime = PREVIEW_TYPES[path.extname(text(filePath)).toLowerCase()];
    if (!mime) return null;
    try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile() || stat.size === 0 || stat.size > PREVIEW_MAX_BYTES) return null;
        return `data:${mime};base64,${(await fs.readFile(filePath)).toString("base64")}`;
    } catch {
        return null;
    }
}

/** Liste d'éléments quel que soit l'emballage : tableau, { data }, { chats }, { items }. */
function listOf(payload, key = null) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    for (const name of [key, "data", "items", "results"].filter(Boolean)) {
        if (Array.isArray(payload[name])) return payload[name];
    }
    return [];
}

function normalizeChat(chat) {
    if (!chat || !chat.id) return null;
    return {
        id: text(chat.id),
        title: text(chat.title).trim() || "Sans titre",
        projectId: chat.projectId ? text(chat.projectId) : null,
        isPinned: Boolean(chat.isPinned),
        lastMessageAt: chat.lastMessageAt || chat.updatedAt || chat.createdAt || null,
        agentId: Number.isInteger(chat.agent?.id) ? chat.agent.id : null
    };
}

/** Texte d'un message, que content soit une chaîne ou une liste de parties. */
function messageText(message) {
    const content = message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((part) => (typeof part === "string" ? part : part?.text || ""))
            .filter(Boolean)
            .join("\n");
    }
    return text(message?.text);
}

function normalizeSkill(skill, shared) {
    if (!skill || !skill.id) return null;
    const version = skill.default_version || skill.defaultVersion || skill.latest_version || {};
    return {
        id: text(skill.id),
        name: text(skill.name || skill.display_title || version.name || skill.id),
        description: text(skill.description || version.description),
        enabled: skill.enabled !== false,
        shared
    };
}

function normalizeFile(file, fallbackName) {
    const data = file?.data && typeof file.data === "object" && !Array.isArray(file.data) ? file.data : file;
    const id = data?.id || data?.fileId || data?.file_id;
    if (!id) throw new Error("L'API n'a pas renvoyé l'identifiant du fichier envoyé.");
    return {
        id: text(id),
        name: text(data.filename || data.name || fallbackName),
        bytes: Number(data.bytes ?? data.size ?? 0) || 0
    };
}

function createWorkspace({
    backend,
    refresh = () => {},
    isRunning = () => false,
    rest = null,
    agents = null,
    projects = null,
    stateModule = null,
    compact = null,
    detectEnvironment = null,
    sessionUsage = null,
    permissions = null,
    workspaceCore = workspace
} = {}) {
    const api = () => rest || require("../api/rest");
    const agentsApi = () => agents || require("../api/agents");
    const projectsApi = () => projects || require("../api/fr-projects");
    const st = () => stateModule || require("../state");
    const compactApi = () => compact || require("../core/compact");
    const detect = () => detectEnvironment || require("../project/short-context").detectEnvironment;
    const usageSource = () => sessionUsage || require("../api/api").usage;

    function ensureIdle() {
        if (isRunning()) throw new Error("Une demande est en cours : attends la fin ou interromps-la.");
    }

    async function branch() {
        const { state } = st();
        if (!workspaceCore.root) return null;
        try {
            const env = await detect()(workspaceCore.root);
            return env?.git?.branch || null;
        } catch {
            return null;
        }
    }

    /** Branche, modèle, projet et conversation courants + liste des modèles. */
    async function info() {
        const { state } = st();
        let list = [];
        try {
            ({ agents: list = [] } = await agentsApi().listAgents());
        } catch {
            list = [];
        }
        return {
            branch: await branch(),
            workspace: workspaceCore.root || null,
            workspaceName: workspaceCore.root ? path.basename(workspaceCore.root) : null,
            modelId: state.model,
            chatId: state.chatIds?.chat || null,
            project: state.frProject || null,
            agents: list.map((agent) => ({
                id: agent.id,
                name: text(agent.name),
                provider: text(agent.provider),
                model: text(agent.model),
                description: text(agent.description),
                isDefault: Boolean(agent.isDefault)
            }))
        };
    }

    /** Chats récents, d'un projet, ou résultats d'une recherche. */
    async function listChats({ projectId = null, cursor = null, query = "" } = {}) {
        const q = text(query).trim();
        let payload;
        if (q) {
            payload = await api().request("GET", `/chats/search?query=${encodeURIComponent(q)}`);
        } else if (projectId) {
            payload = await api().request("GET", `/projects/${encodeURIComponent(projectId)}/chats?limit=${CHAT_PAGE}`);
        } else {
            const after = cursor ? `&cursor_chat_id=${encodeURIComponent(cursor)}` : "";
            payload = await api().request("GET", `/chats?limit=${CHAT_PAGE}${after}`);
        }
        const chats = listOf(payload, "chats").map(normalizeChat).filter(Boolean);
        return { chats, hasMore: Boolean(payload && payload.hasMore) };
    }

    /** Reprend une conversation : même effet que /chat-id, avec l'historique affiché. */
    async function openChat(id) {
        ensureIdle();
        const chatId = text(id).trim();
        if (!chatId) throw new Error("Identifiant de chat manquant.");
        const detail = await api().request("GET", `/chats/${encodeURIComponent(chatId)}`);

        const { state, resetConversation, setConversation } = st();
        const agentId = Number.isInteger(detail?.agent?.id) ? detail.agent.id : null;
        resetConversation();
        setConversation(chatId, agentId !== null ? { model: agentId } : null);
        state.contextUsagePercent = state.contextDetails = null;
        state.pendingFiles = [];

        backend.store.dispatch({ type: "clear" });
        const title = text(detail?.title).trim();
        backend.store.dispatch({
            type: "append",
            entry: { type: "info", text: `Conversation reprise${title ? ` : « ${title} »` : ""}.` }
        });
        for (const message of listOf(detail?.chatMessages)) {
            const body = messageText(message).trim();
            if (!body) continue;
            const role = text(message.role).toLowerCase();
            const type = role === "user" ? "user" : role === "assistant" || role === "model" ? "assistant" : null;
            if (type) backend.store.dispatch({ type: "append", entry: { type, text: body } });
        }
        refresh();
        return { ok: true, id: chatId, title };
    }

    /** Nouveau thread : même effet que /new suivi de /clear. */
    function newThread() {
        ensureIdle();
        const { state, resetConversation } = st();
        resetConversation();
        state.contextUsagePercent = state.contextDetails = null;
        state.pendingFiles = [];
        backend.clear();
        refresh();
        return { ok: true };
    }

    async function listProjects() {
        const { state } = st();
        const list = await projectsApi().listProjects();
        return {
            selectedId: state.frProject?.id || null,
            projects: list
                .filter((project) => project && project.id)
                .map((project) => ({ id: text(project.id), name: text(project.name) || "Sans nom" }))
        };
    }

    /** Projet rattaché aux nouvelles conversations (null pour aucun). */
    async function selectProject(id) {
        if (!id) {
            await projectsApi().saveSelected(null);
            refresh();
            return { selectedId: null };
        }
        const { projects: list } = await listProjects();
        const project = list.find((item) => item.id === id);
        if (!project) throw new Error("Projet introuvable.");
        await projectsApi().saveSelected(project);
        refresh();
        return { selectedId: project.id };
    }

    /** Consommation : limites du compte, tokens sur 7 jours, stockage, session locale. */
    async function usage() {
        const [limits, tokens, storage] = await Promise.allSettled([
            api().request("GET", "/user/usage"),
            api().request("GET", "/user/tokenusage?tokenUsageDays=7"),
            api().request("GET", "/filesv2/usage")
        ]);
        const value = (result) => (result.status === "fulfilled" ? result.value : null);
        let session = null;
        try {
            const source = usageSource();
            session = source ? { ...source } : null;
        } catch {
            session = null;
        }
        const failed = [limits, tokens, storage].filter((result) => result.status === "rejected");
        return {
            limits: value(limits),
            tokens: value(tokens),
            storage: value(storage),
            session,
            error: failed.length === 3 ? text(failed[0].reason?.message) : null
        };
    }

    async function listSkills() {
        const [own, shared] = await Promise.allSettled([
            api().request("GET", "/skills"),
            api().request("GET", "/skills/shared")
        ]);
        const pick = (result, isShared) =>
            result.status === "fulfilled"
                ? listOf(result.value, "skills").map((skill) => normalizeSkill(skill, isShared)).filter(Boolean)
                : [];
        if (own.status === "rejected" && shared.status === "rejected") throw own.reason;
        return { skills: [...pick(own, false), ...pick(shared, true)] };
    }

    async function toggleSkill(id, enabled, shared = false) {
        const route = `/skills/${shared ? "shared/" : ""}${encodeURIComponent(text(id))}`;
        await api().request("POST", route, { enabled: Boolean(enabled) });
        return { ok: true, enabled: Boolean(enabled) };
    }

    /** Change de modèle : même effet que /model (nouvelle conversation). */
    async function setModel(id) {
        ensureIdle();
        const { agents: list = [] } = await agentsApi().listAgents();
        const agent = list.find((item) => item.id === Number(id));
        if (!agent) throw new Error("Modèle introuvable.");
        const { state } = st();
        if (state.model === agent.id) return { ok: true, changed: false, name: agent.name };
        // Le modèle actuel résume la conversation : le nouveau la reprend avec ce résumé.
        const switched = await compactApi().switchModel(agent);
        let detail = "nouvelle conversation";
        if (switched.summarized) {
            detail = switched.fallback
                ? "nouvelle conversation, derniers échanges transmis"
                : "nouvelle conversation, résumé transmis";
        }
        backend.store.dispatch({
            type: "append",
            entry: { type: "info", text: `Modèle : ${agent.name} (${detail}).` }
        });
        refresh();
        return { ok: true, changed: true, name: agent.name };
    }

    /** Mode de permission de la session (default, acceptEdits, plan) : même effet que Shift+Tab. */
    function setPermissionMode(mode) {
        const applied = (permissions || require("../core/permissions-mode")).set(mode);
        if (!applied) throw new Error("Mode de permission inconnu.");
        refresh();
        return { ok: true, mode: applied };
    }

    /** Envoie des fichiers locaux (Files v2). Un échec n'empêche pas les autres. */
    async function uploadFiles(paths = []) {
        const files = [];
        const errors = [];
        for (const filePath of paths) {
            const name = path.basename(text(filePath));
            try {
                const file = normalizeFile(await api().uploadFile(filePath), name);
                const preview = await previewOf(filePath);
                files.push(preview ? { ...file, preview } : file);
            } catch (error) {
                errors.push(`${name} : ${error && error.message ? error.message : String(error)}`);
            }
        }
        return { files, errors };
    }

    /**
     * Envoie une image collée (octets du presse-papiers) comme pièce jointe Files v2.
     * L'image passe par un fichier temporaire, supprimé aussitôt : { files, errors }.
     */
    async function uploadImage(data, mime = "image/png") {
        const extension = IMAGE_EXTENSIONS[text(mime).toLowerCase()];
        if (!extension) return { files: [], errors: ["Format d'image non pris en charge."] };
        const content = Buffer.isBuffer(data)
            ? data
            : ArrayBuffer.isView(data)
                ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
                : null;
        if (!content || !content.length) return { files: [], errors: ["Image vide ou illisible."] };

        const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
        let dir = null;
        try {
            dir = await fs.mkdtemp(path.join(os.tmpdir(), "frst-paste-"));
            const filePath = path.join(dir, `image-collee-${stamp}.${extension}`);
            await fs.writeFile(filePath, content);
            return await uploadFiles([filePath]);
        } catch (error) {
            return { files: [], errors: [`Image collée : ${error && error.message ? error.message : String(error)}`] };
        } finally {
            if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        }
    }

    return {
        branch,
        info,
        listChats,
        openChat,
        newThread,
        listProjects,
        selectProject,
        usage,
        listSkills,
        toggleSkill,
        setModel,
        setPermissionMode,
        uploadFiles,
        uploadImage
    };
}

module.exports = { createWorkspace, listOf, normalizeChat, messageText, normalizeSkill, normalizeFile };
