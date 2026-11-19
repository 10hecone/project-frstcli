import { useCallback, useEffect, useRef, useState } from "react";
import { activeFolder, trustRequest } from "../lib/folders.js";

const errorText = (err) => (err && err.message ? err.message : String(err));

/**
 * Données de l'espace de travail (branche, modèles, chats, projets, usage, skills).
 *
 * - info est rechargé quand le modèle, le chat, la branche ou l'état occupé changent.
 * - Les listes sont chargées à la demande (load*) : la barre latérale décide quand.
 * - Les actions renvoient { ok, reason? } et ne lèvent jamais.
 */
export function useWorkspace(client, status = {}) {
    const [info, setInfo] = useState(null);
    const [chats, setChats] = useState({ items: [], hasMore: false, loading: false, error: null });
    const [projects, setProjects] = useState({ selectedId: null, items: [], loading: false, error: null });
    const [usage, setUsage] = useState({ data: null, loading: false, error: null });
    const [skills, setSkills] = useState({ items: [], loading: false, error: null });
    const [mcp, setMcp] = useState({ items: [], warnings: [], loading: false, error: null });
    const [settings, setSettings] = useState({ data: null, loading: false, error: null });
    const [recent, setRecent] = useState([]);
    const [sessions, setSessions] = useState({ path: null, items: [], loading: false, error: null });
    const [trust, setTrust] = useState(null);
    const [skipped, setSkipped] = useState(false);
    const [folderError, setFolderError] = useState(null);
    const query = useRef("");

    const refreshInfo = useCallback(async () => {
        try {
            setInfo(await client.info());
        } catch {
            // Info indisponible : la barre de chat garde les valeurs précédentes.
        }
        }, [client]);

    useEffect(() => {
        refreshInfo();
        }, [refreshInfo, status.modelId, status.chatId, status.branch, status.busy, status.workspace]);

    const loadChats = useCallback(
        async (options = {}) => {
            if (options.query !== undefined) query.current = options.query;
            const more = Boolean(options.cursor);
            setChats((prev) => ({ ...prev, loading: true, error: null }));
            try {
                const result = await client.listChats({ query: query.current, cursor: options.cursor, projectId: options.projectId });
                const list = (result && result.chats) || [];
                setChats((prev) => ({
                    items: more ? [...prev.items, ...list] : list,
                    hasMore: Boolean(result && result.hasMore),
                    loading: false,
                    error: null
                }));
                return list;
            } catch (err) {
                setChats((prev) => ({ ...prev, loading: false, error: errorText(err) }));
                return [];
            }
        },
        [client]
    );

    /** Chats d'un projet, sans toucher à la liste principale (projets dépliés). */
    const fetchChats = useCallback(
        async (options = {}) => {
            const result = await client.listChats(options);
            return { chats: (result && result.chats) || [], hasMore: Boolean(result && result.hasMore) };
        },
        [client]
    );

    const loadProjects = useCallback(async () => {
        setProjects((prev) => ({ ...prev, loading: true, error: null }));
        try {
            const result = await client.listProjects();
            setProjects({
                selectedId: (result && result.selectedId) || null,
                items: (result && result.projects) || [],
                loading: false,
                error: null
            });
        } catch (err) {
            setProjects((prev) => ({ ...prev, loading: false, error: errorText(err) }));
        }
        }, [client]);

    const loadUsage = useCallback(async () => {
        setUsage((prev) => ({ ...prev, loading: true, error: null }));
        try {
            const data = await client.usage();
            setUsage({ data, loading: false, error: (data && data.error) || null });
        } catch (err) {
            setUsage((prev) => ({ ...prev, loading: false, error: errorText(err) }));
        }
        }, [client]);

    const loadSkills = useCallback(async () => {
        setSkills((prev) => ({ ...prev, loading: true, error: null }));
        try {
            const result = await client.listSkills();
            setSkills({ items: (result && result.skills) || [], loading: false, error: null });
        } catch (err) {
            setSkills((prev) => ({ ...prev, loading: false, error: errorText(err) }));
        }
        }, [client]);

    const loadMcp = useCallback(async () => {
        setMcp((prev) => ({ ...prev, loading: true, error: null }));
        try {
            const result = await client.listMcp();
            setMcp({
                items: (result && Array.isArray(result.servers) && result.servers) || [],
                warnings: (result && Array.isArray(result.warnings) && result.warnings) || [],
                loading: false,
                error: null
            });
        } catch (err) {
            setMcp((prev) => ({ ...prev, loading: false, error: errorText(err) }));
        }
    }, [client]);

    const loadSettings = useCallback(async () => {
        setSettings((prev) => ({ ...prev, loading: true, error: null }));
        try {
            const data = await client.getSettings();
            setSettings({ data: data || null, loading: false, error: null });
        } catch (err) {
            setSettings((prev) => ({ ...prev, loading: false, error: errorText(err) }));
        }
    }, [client]);

    /** Enregistre des préférences ({ clé: valeur | null }) : { ok } ou { ok:false, reason }. */
    const saveSettings = useCallback(
        async (patch) => {
            try {
                const data = await client.saveSettings(patch);
                setSettings({ data: data || null, loading: false, error: null });
                return { ok: true };
            } catch (err) {
                return { ok: false, reason: errorText(err) };
            }
        },
        [client]
    );

    /** Exécute une action et transforme une exception en { ok:false, reason }. */
    const run = useCallback(async (fn) => {
        try {
            const result = await fn();
            return result && typeof result === "object" && "ok" in result ? result : { ok: true, ...(result || {}) };
        } catch (err) {
            return { ok: false, reason: errorText(err) };
        }
        }, []);

    const openChat = useCallback((id) => run(() => client.openChat(id)), [client, run]);
    const openSettingsFile = useCallback(() => run(() => client.openSettingsFile()), [client, run]);
    const newThread = useCallback(() => run(() => client.newThread()), [client, run]);
    const setModel = useCallback(
        async (id) => {
            const result = await run(() => client.setModel(id));
            refreshInfo();
            return result;
        },
        [client, run, refreshInfo]
    );
    const selectProject = useCallback(
        async (id) => {
            const result = await run(() => client.selectProject(id));
            loadProjects();
            refreshInfo();
            return result;
        },
        [client, run, loadProjects, refreshInfo]
    );
    const toggleSkill = useCallback(
        async (id, enabled, shared) => {
            // Mise à jour optimiste : l'interrupteur répond tout de suite, puis on recharge.
            setSkills((prev) => ({
                ...prev,
                items: prev.items.map((skill) => (skill.id === id ? { ...skill, enabled } : skill))
            }));
            const result = await run(() => client.toggleSkill(id, enabled, shared));
            loadSkills();
            return result;
        },
        [client, run, loadSkills]
    );
    const setMcpEnabled = useCallback(
        async (name, enabled) => {
            // Mise à jour optimiste, comme pour les skills.
            setMcp((prev) => ({
                ...prev,
                items: prev.items.map((server) => (server.name === name ? { ...server, enabled } : server))
            }));
            const result = await run(() => client.setMcpEnabled(name, enabled));
            loadMcp();
            return result;
        },
        [client, run, loadMcp]
    );
    const connectMcp = useCallback(
        async (name) => {
            const result = await run(() => client.connectMcp(name));
            loadMcp();
            return result;
        },
        [client, run, loadMcp]
    );
    const loginMcp = useCallback(
        async (name) => {
            const result = await run(() => client.loginMcp(name));
            loadMcp();
            return result;
        },
        [client, run, loadMcp]
    );
    const pickFiles = useCallback(async () => {
        try {
            return await client.pickFiles();
        } catch (err) {
            return { files: [], errors: [errorText(err)], cancelled: false };
        }
        }, [client]);
    const pasteImage = useCallback(
        async (data, mime) => {
            try {
                return await client.pasteImage(data, mime);
            } catch (err) {
                return { files: [], errors: [errorText(err)] };
            }
        },
        [client]
    );

    const loadFolders = useCallback(async () => {
        try {
            const list = await client.recentFolders();
            setRecent(Array.isArray(list) ? list : []);
        } catch {
            // Liste indisponible : l'accueil garde la précédente.
        }
    }, [client]);

    // Dossiers récents : relus à chaque changement de dossier.
    useEffect(() => {
        loadFolders();
    }, [loadFolders, status.workspace]);

    // Sessions du dossier actif : relues quand le chat ou l'état occupé change (nouveau titre, nouveau chat).
    useEffect(() => {
        const dir = status.workspace || null;
        if (!dir) {
            setSessions({ path: null, items: [], loading: false, error: null });
            return undefined;
        }
        let stale = false;
        // « Chargement » seulement sans liste déjà affichée pour ce dossier : pas de clignotement.
        setSessions((prev) =>
            prev.path === dir
                ? { ...prev, error: null, loading: prev.items.length === 0 }
                : { path: dir, items: [], loading: true, error: null }
        );
        client.folderSessions(dir).then(
            (list) => {
                if (!stale) setSessions({ path: dir, items: Array.isArray(list) ? list : [], loading: false, error: null });
            },
            (err) => {
                if (!stale) setSessions((prev) => ({ ...prev, loading: false, error: errorText(err) }));
            }
        );
        return () => {
            stale = true;
        };
    }, [client, status.workspace, status.chatId, status.busy]);

    /** Suite d'une ouverture : confiance demandée → dialogue ; échec → message pour l'accueil. */
    const settleOpen = useCallback((result) => {
        const request = trustRequest(result);
        if (request) setTrust(request);
        if (request || (result && result.ok)) setFolderError(null);
        else if (result && result.ok === false) setFolderError(result.reason || "Dossier non ouvert.");
        return result;
    }, []);

    const openFolder = useCallback(async (dir) => settleOpen(await run(() => client.openFolder(dir))), [client, run, settleOpen]);
    const pickFolder = useCallback(async () => settleOpen(await run(() => client.pickFolder())), [client, run, settleOpen]);
    const closeFolder = useCallback(async () => {
        const result = await run(() => client.closeFolder());
        if (result.ok) setSkipped(false);
        return result;
    }, [client, run]);
    const acceptTrust = useCallback(
        async (dir) => {
            setTrust(null);
            const trusted = await run(() => client.trustFolder(dir));
            return trusted.ok ? openFolder(dir) : settleOpen(trusted);
        },
        [client, run, openFolder, settleOpen]
    );
    const declineTrust = useCallback(() => setTrust(null), []);
    const continueWithoutFolder = useCallback(() => setSkipped(true), []);
    const setPermissionMode = useCallback((mode) => run(() => client.setPermissionMode(mode)), [client, run]);

    // Dossier demandé hors de la fenêtre (ligne de commande, seconde instance).
    useEffect(() => client.onFolderRequested((dir) => openFolder(dir)), [client, openFolder]);

    const folders = {
        active: activeFolder(status.workspace, status.branch, recent),
        recent,
        sessions,
        trust,
        skipped,
        error: folderError
    };

    return {
        info,
        folders,
        chats,
        projects,
        usage,
        skills,
        mcp,
        refreshInfo,
        loadChats,
        fetchChats,
        loadProjects,
        loadUsage,
        loadSkills,
        openChat,
        newThread,
        setModel,
        selectProject,
        toggleSkill,
        loadMcp,
        setMcpEnabled,
        connectMcp,
        loginMcp,
        settings,
        loadSettings,
        saveSettings,
        openSettingsFile,
        pickFiles,
        pasteImage,
        loadFolders,
        openFolder,
        pickFolder,
        closeFolder,
        acceptTrust,
        declineTrust,
        continueWithoutFolder,
        setPermissionMode
    };
}
