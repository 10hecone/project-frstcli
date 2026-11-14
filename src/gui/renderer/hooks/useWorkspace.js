import { useCallback, useEffect, useRef, useState } from "react";

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
    const pickFiles = useCallback(async () => {
        try {
            return await client.pickFiles();
        } catch (err) {
            return { files: [], errors: [errorText(err)], cancelled: false };
        }
        }, [client]);

    return {
        info,
        chats,
        projects,
        usage,
        skills,
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
        pickFiles
    };
}
