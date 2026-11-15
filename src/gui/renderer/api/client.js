/**
 * Client de session : le SEUL module de l'interface qui connaît le transport.
 *
 * Contrat de session (identique à window.frst exposé par electron/preload.js) :
 * - start()         → Promise<{ ok, reason? }>
 * - snapshot()      → Promise<{ seq, state }>
 * - submit(text, files?)   → Promise<{ ok, exit?, reason? }> ; files = ids de pièces jointes
 * - answer(id, value)      → Promise<boolean>
 * - interrupt()     → Promise<boolean>
 * - onAction(listener)     → désabonnement ; listener reçoit { seq, action }
 *
 * Méthodes d'espace de travail (facultatives, complétées hors ligne si absentes) :
 * info, listChats, openChat, newThread, listProjects, selectProject, usage,
 * listSkills, toggleSkill, setModel, pickFiles.
 *
 * Dossiers et permissions (mêmes règles) :
 * - pickFolder()        → { ok, path } | { needsTrust, path, message } | { cancelled }
 * - openFolder(path)    → { ok, path } | { needsTrust, path, message } ; trustFolder(path) puis openFolder
 * - closeFolder(), recentFolders(), folderSessions(path), setPermissionMode(mode).
 *
 * Pour rebrancher l'interface sur un autre transport (WebSocket, serveur local,
 * tests), il suffit de fournir un objet qui respecte ce contrat.
 */

export const CLIENT_METHODS = ["start", "snapshot", "submit", "answer", "interrupt", "onAction"];

const OFFLINE = "Interface hors ligne.";

/** Réponses par défaut des méthodes d'espace de travail, sans transport. */
export const WORKSPACE_FALLBACKS = {
    info: async () => ({ branch: null, workspace: null, workspaceName: null, modelId: null, chatId: null, project: null, agents: [] }),
    listChats: async () => ({ chats: [], hasMore: false }),
    openChat: async () => ({ ok: false, reason: OFFLINE }),
    newThread: async () => ({ ok: false, reason: OFFLINE }),
    listProjects: async () => ({ selectedId: null, projects: [] }),
    selectProject: async () => ({ ok: false, reason: OFFLINE }),
    usage: async () => ({ limits: null, tokens: null, storage: null, session: null, error: OFFLINE }),
    listSkills: async () => ({ skills: [] }),
    toggleSkill: async () => ({ ok: false, reason: OFFLINE }),
    setModel: async () => ({ ok: false, reason: OFFLINE }),
    pickFiles: async () => ({ files: [], errors: ["Hors ligne"], cancelled: true }),
    pickFolder: async () => ({ ok: false, cancelled: true }),
    openFolder: async () => ({ ok: false, reason: OFFLINE }),
    closeFolder: async () => ({ ok: false, reason: OFFLINE }),
    recentFolders: async () => [],
    trustFolder: async () => ({ ok: false, reason: OFFLINE }),
    folderSessions: async () => [],
    setPermissionMode: async () => ({ ok: false, reason: OFFLINE })
};

export const WORKSPACE_METHODS = Object.keys(WORKSPACE_FALLBACKS);

export function isClient(value) {
    return Boolean(value) && CLIENT_METHODS.every((name) => typeof value[name] === "function");
}

/**
 * Complète un client avec les méthodes d'espace de travail manquantes.
 * Renvoie le même objet s'il est déjà complet (identité conservée).
 */
export function withWorkspace(client) {
    const missing = WORKSPACE_METHODS.filter((name) => typeof client[name] !== "function");
    if (missing.length === 0) return client;
    const extra = {};
    for (const name of missing) extra[name] = WORKSPACE_FALLBACKS[name];
    return Object.assign(Object.create(client), extra);
}

export function getClient(scope = typeof window !== "undefined" ? window : {}) {
    return isClient(scope.frst) ? scope.frst : createOfflineClient();
}

/**
 * Client hors Electron (index.html ouvert dans un navigateur) : aucune session,
 * seulement un message explicatif. Utile pour travailler le style de l'interface.
 */
export function createOfflineClient() {
    const listeners = new Set();
    let seq = 0;

    const emit = (action) => {
        seq += 1;
        for (const listener of [...listeners]) listener({ seq, action });
    };
    const notice = (type, text) => emit({ type: "append", entry: { type, text } });

    return {
        offline: true,
        ...WORKSPACE_FALLBACKS,
        async start() {
            notice("warn", "Hors Electron : aucune session n'est branchée. Lance « npm run app ».");
            return { ok: false, reason: OFFLINE };
        },
        async snapshot() {
            return { seq, state: null };
        },
        async submit(text) {
            emit({ type: "append", entry: { type: "user", text: String(text ?? "") } });
            notice("info", "Message non envoyé : interface hors ligne.");
            return { ok: false, reason: OFFLINE };
        },
        async answer() {
            return false;
        },
        async interrupt() {
            return false;
        },
        onAction(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };
}
