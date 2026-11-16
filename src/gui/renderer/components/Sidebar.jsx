import { useEffect, useRef, useState } from "react";
import { relativeTime } from "../lib/format.js";
import { FolderSwitcher } from "./FolderSwitcher.jsx";

const TABS = [
    { id: "chats", label: "Threads" },
    { id: "projects", label: "Projets en ligne" }
];

const VIEW_TITLES = { threads: "Conversations", skills: "Skills", mcp: "Serveurs MCP" };

/** Libellé et symbole de chaque état : l'état ne repose jamais sur la couleur seule. */
const MCP_STATES = {
    connected: { label: "Connecté", symbol: "●" },
    connecting: { label: "Connexion…", symbol: "◌" },
    idle: { label: "Inactif", symbol: "○" },
    failed: { label: "En échec", symbol: "✕" },
    "needs-approval": { label: "À approuver", symbol: "?" },
    "needs-auth": { label: "Connexion requise", symbol: "⚿" },
    rejected: { label: "Refusé", symbol: "⊘" },
    disabled: { label: "Désactivé", symbol: "–" }
};

const MCP_SCOPES = { project: "projet", user: "utilisateur", local: "local" };

const BUSY_REASON = "Indisponible pendant une réponse";

const errorText = (err) => (err && err.message ? err.message : String(err));

/**
 * Barre latérale pilotée par la barre d'activité : vue Conversations
 * (Chats / Projets) ou vue Skills. Repliée, elle reste montée mais inerte.
 */
export function Sidebar({ id, view = "threads", open = true, workspace, status = {}, busy = false }) {
    const [tab, setTab] = useState("chats");
    const [toast, setToast] = useState(null);
    const { loadProjects, loadSkills, loadMcp } = workspace;
    // Dossiers : fournis par useWorkspace ; sans eux, la barre latérale garde l'ancien comportement.
    const folders = workspace.folders || null;

    useEffect(() => {
        if (!open) return;
        if (view === "skills") loadSkills();
        else if (view === "mcp") {
            if (loadMcp) loadMcp();
        } else if (tab === "projects") loadProjects();
    }, [open, view, tab, loadProjects, loadSkills, loadMcp]);

    useEffect(() => {
        if (!toast) return undefined;
        const timer = setTimeout(() => setToast(null), 4000);
        return () => clearTimeout(timer);
    }, [toast]);

    /** Lance une action et affiche la raison d’un échec. */
    const act = async (fn) => {
        const result = await fn();
        if (result && result.ok === false && !result.needsTrust) setToast(result.reason || "Action impossible.");
        return result;
    };

    const busyReason = busy ? BUSY_REASON : undefined;
    const title = VIEW_TITLES[view] || VIEW_TITLES.threads;

    return (
        <aside id={id} className="sidebar" aria-label={title} aria-hidden={!open} inert={!open}>
            <div className="sidebar-inner">
                <div className="sidebar-top">
                    <h2 className="sidebar-title">{title}</h2>
                    {view === "skills" ? (
                        <p className="panel-hint">
                            Tape <kbd>$</kbd> dans la barre de chat pour mentionner un skill.
                        </p>
                    ) : view === "mcp" ? (
                        <p className="panel-hint">
                            Ajoute un serveur avec <kbd>/mcp add</kbd> dans la barre de chat.
                        </p>
                    ) : (
                        <>
                            <button
                                type="button"
                                className="new-thread secondary"
                                disabled={busy}
                                title={busyReason || "Nouveau thread (Ctrl+N)"}
                                onClick={() => act(workspace.newThread)}
                            >
                                <span className="plus" aria-hidden="true">
                                    ＋
                                </span>
                                Nouveau thread
                            </button>
                            {folders ? (
                                <FolderSwitcher
                                    folders={folders}
                                    disabled={busy}
                                    disabledReason={busyReason}
                                    onPick={() => act(workspace.pickFolder)}
                                    onOpen={(dir) => act(() => workspace.openFolder(dir))}
                                    onClose={() => act(workspace.closeFolder)}
                                />
                            ) : null}
                            <div
                                className="segmented"
                                role="tablist"
                                aria-label="Sections"
                                style={{ "--index": TABS.findIndex((item) => item.id === tab), "--count": TABS.length }}
                            >
                                {TABS.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        role="tab"
                                        aria-selected={tab === item.id}
                                        className={tab === item.id ? "selected" : ""}
                                        onClick={() => setTab(item.id)}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>

                <ScrollArea className="sidebar-body" resetKey={view + ":" + tab}>
                    {view === "skills" ? (
                        <SkillsPanel
                            skills={workspace.skills}
                            onToggle={(skill, enabled) => act(() => workspace.toggleSkill(skill.id, enabled, skill.shared))}
                        />
                    ) : view === "mcp" ? (
                        <McpPanel
                            mcp={workspace.mcp || { items: [], warnings: [], loading: false, error: null }}
                            disabled={busy}
                            disabledReason={busyReason}
                            onToggle={(server, enabled) => act(() => workspace.setMcpEnabled(server.name, enabled))}
                            onConnect={(server) => act(() => workspace.connectMcp(server.name))}
                            onLogin={(server) => act(() => workspace.loginMcp(server.name))}
                        />
                    ) : tab === "projects" ? (
                        <ProjectsPanel
                            projects={workspace.projects}
                            activeId={status.chatId}
                            disabled={busy}
                            fetchChats={workspace.fetchChats}
                            onOpen={(chatId) => act(() => workspace.openChat(chatId))}
                            onSelect={(projectId) => act(() => workspace.selectProject(projectId))}
                        />
                    ) : (
                        <ThreadsPanel
                            folders={folders}
                            chats={workspace.chats}
                            activeId={status.chatId}
                            disabled={busy}
                            onLoad={workspace.loadChats}
                            onOpen={(chatId) => act(() => workspace.openChat(chatId))}
                        />
                    )}
                </ScrollArea>

                <div className={"toast" + (toast ? " visible" : "")} role="status" aria-live="polite">
                    {toast}
                </div>
            </div>
        </aside>
    );
}

/**
 * Zone défilante avec effets de bord : un fondu apparaît en haut ou en bas
 * seulement quand il reste du contenu caché, au lieu d’un séparateur fixe.
 */
function ScrollArea({ className, resetKey, children }) {
    const ref = useRef(null);
    const [edges, setEdges] = useState({ top: false, bottom: false });

    const measure = () => {
        const el = ref.current;
        if (!el) return;
        const top = el.scrollTop > 2;
        const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
        setEdges((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
    };

    useEffect(() => {
        if (ref.current) ref.current.scrollTop = 0;
        measure();
    }, [resetKey]);

    useEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === "undefined") return undefined;
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        for (const child of el.children) observer.observe(child);
        return () => observer.disconnect();
    });

    return (
        <div
            ref={ref}
            className={`scroll-area ${className || ""}`}
            data-edge-top={edges.top || undefined}
            data-edge-bottom={edges.bottom || undefined}
            onScroll={measure}
        >
            <div className="scroll-content">{children}</div>
        </div>
    );
}

/** Threads du dossier actif s'il y en a un, sinon les chats FranceStudent comme avant. */
function ThreadsPanel({ folders, ...chatProps }) {
    if (folders && folders.active) {
        return (
            <FolderThreads
                sessions={folders.sessions}
                activeId={chatProps.activeId}
                disabled={chatProps.disabled}
                onOpen={chatProps.onOpen}
            />
        );
    }
    return <ChatsPanel {...chatProps} />;
}

function FolderThreads({ sessions = { items: [], loading: false, error: null }, activeId, disabled, onOpen }) {
    const items = sessions.items.map((session) => ({ id: session.id, title: session.title, lastMessageAt: session.updatedAt }));
    return (
        <div className="panel">
            <ChatList items={items} activeId={activeId} disabled={disabled} onOpen={onOpen} />
            {sessions.error ? <p className="panel-error">{sessions.error}</p> : null}
            {sessions.loading ? <p className="panel-empty">Chargement…</p> : null}
            {!sessions.loading && !sessions.error && items.length === 0 ? (
                <p className="panel-empty">Aucun thread dans ce dossier.</p>
            ) : null}
        </div>
    );
}

function ChatsPanel({ chats, activeId, disabled, onLoad, onOpen }) {
    const [query, setQuery] = useState("");

    useEffect(() => {
        const timer = setTimeout(() => onLoad({ query: query.trim() }), query ? 250 : 0);
        return () => clearTimeout(timer);
    }, [query, onLoad]);

    // Un nouveau chat apparaît après le premier message : on recharge la liste.
    useEffect(() => {
        if (activeId && !chats.items.some((chat) => chat.id === activeId)) onLoad({});
    }, [activeId]);

    const pinned = chats.items.filter((chat) => chat.isPinned);
    const others = chats.items.filter((chat) => !chat.isPinned);
    const last = chats.items[chats.items.length - 1];

    return (
        <div className="panel">
            <input
                type="search"
                className="search"
                placeholder="Rechercher"
                aria-label="Rechercher dans les chats"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
            />
            {pinned.length ? <ChatList title="Épinglés" items={pinned} activeId={activeId} disabled={disabled} onOpen={onOpen} /> : null}
            <ChatList title={pinned.length ? "Récents" : null} items={others} activeId={activeId} disabled={disabled} onOpen={onOpen} />
            {chats.error ? <p className="panel-error">{chats.error}</p> : null}
            {!chats.loading && !chats.error && chats.items.length === 0 ? (
                <p className="panel-empty">{query ? "Aucun chat ne correspond." : "Aucun chat pour l’instant."}</p>
            ) : null}
            {chats.loading ? <p className="panel-empty">Chargement…</p> : null}
            {chats.hasMore && !chats.loading && last ? (
                <button type="button" className="ghost more" onClick={() => onLoad({ cursor: last.id })}>
                    Afficher plus
                </button>
            ) : null}
        </div>
    );
}

function ChatList({ title, items, activeId, disabled, onOpen }) {
    if (!items.length) return null;
    return (
        <section className="chat-group">
            {title ? <h3 className="group-title">{title}</h3> : null}
            <ul className="chat-list">
                {items.map((chat) => {
                    const active = chat.id === activeId;
                    return (
                        <li key={chat.id}>
                            <button
                                type="button"
                                className="chat-item row"
                                aria-current={active ? "true" : undefined}
                                disabled={disabled && !active}
                                title={disabled && !active ? BUSY_REASON : chat.title}
                                onClick={() => (active ? null : onOpen(chat.id))}
                            >
                                <span className="chat-title">{chat.title}</span>
                                <span className="chat-time">{relativeTime(chat.lastMessageAt)}</span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

function ProjectsPanel({ projects, activeId, disabled, fetchChats, onOpen, onSelect }) {
    const [open, setOpen] = useState({});

    const toggle = async (id) => {
        if (open[id]) {
            setOpen((prev) => {
                const next = { ...prev };
                delete next[id];
                return next;
            });
            return;
        }
        setOpen((prev) => ({ ...prev, [id]: { loading: true, chats: [], error: null } }));
        let entry;
        try {
            const result = await fetchChats({ projectId: id });
            entry = { loading: false, chats: result.chats, error: null };
        } catch (err) {
            entry = { loading: false, chats: [], error: errorText(err) };
        }
        setOpen((prev) => (prev[id] ? { ...prev, [id]: entry } : prev));
    };

    return (
        <div className="panel">
            <p className="panel-hint">Le projet rattaché reçoit les nouveaux chats de ce dossier.</p>
            {projects.error ? <p className="panel-error">{projects.error}</p> : null}
            {!projects.loading && !projects.error && projects.items.length === 0 ? (
                <p className="panel-empty">Aucun projet.</p>
            ) : null}
            <ul className="project-list">
                {projects.items.map((project) => {
                    const expanded = Boolean(open[project.id]);
                    const selected = project.id === projects.selectedId;
                    const detail = open[project.id];
                    return (
                        <li key={project.id} className={`project${selected ? " selected" : ""}`}>
                            <div className="project-row">
                                <button
                                    type="button"
                                    className="disclosure ghost"
                                    aria-expanded={expanded}
                                    onClick={() => toggle(project.id)}
                                >
                                    <span className="chevron" aria-hidden="true">
                                        ›
                                    </span>
                                    <span className="project-name">{project.name}</span>
                                </button>
                                <button
                                    type="button"
                                    className={`pill${selected ? " on" : ""}`}
                                    disabled={disabled}
                                    title={selected ? "Détacher ce projet du dossier" : "Rattacher ce projet au dossier"}
                                    onClick={() => onSelect(selected ? null : project.id)}
                                >
                                    {selected ? "Rattaché" : "Rattacher"}
                                </button>
                            </div>
                            {expanded ? (
                                <div className="project-chats">
                                    {detail.loading ? <p className="panel-empty">Chargement…</p> : null}
                                    {detail.error ? <p className="panel-error">{detail.error}</p> : null}
                                    {!detail.loading && !detail.error && detail.chats.length === 0 ? (
                                        <p className="panel-empty">Aucun chat dans ce projet.</p>
                                    ) : null}
                                    <ChatList items={detail.chats} activeId={activeId} disabled={disabled} onOpen={onOpen} />
                                </div>
                            ) : null}
                        </li>
                    );
                })}
            </ul>
            {projects.loading ? <p className="panel-empty">Chargement…</p> : null}
        </div>
    );
}

function SkillsPanel({ skills, onToggle }) {
    return (
        <div className="panel">
            {skills.error ? <p className="panel-error">{skills.error}</p> : null}
            {!skills.loading && !skills.error && skills.items.length === 0 ? (
                <p className="panel-empty">Aucun skill installé.</p>
            ) : null}
            <ul className="skill-list">
                {skills.items.map((skill) => (
                    <li key={skill.id} className="skill">
                        <div className="skill-text">
                            <span className="skill-name">
                                {skill.name}
                                {skill.shared ? <span className="tag">partagé</span> : null}
                            </span>
                            {skill.description ? <span className="skill-description">{skill.description}</span> : null}
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={skill.enabled}
                            aria-label={`${skill.enabled ? "Désactiver" : "Activer"} ${skill.name}`}
                            className="switch"
                            onClick={() => onToggle(skill, !skill.enabled)}
                        >
                            <span className="knob" />
                        </button>
                    </li>
                ))}
            </ul>
            {skills.loading ? <p className="panel-empty">Chargement…</p> : null}
        </div>
    );
}

/** Action proposée selon l'état d'un serveur (null : aucune). */
function mcpAction(server) {
    if (!server.enabled) return null;
    if (server.status === "needs-approval") return { label: "Examiner", kind: "connect" };
    if (server.status === "needs-auth") return { label: "Se connecter", kind: "login" };
    if (server.status === "failed" || server.status === "idle") return { label: "Reconnecter", kind: "connect" };
    return null;
}

function McpPanel({ mcp, disabled, disabledReason, onToggle, onConnect, onLogin }) {
    const items = Array.isArray(mcp.items) ? mcp.items : [];
    const warnings = Array.isArray(mcp.warnings) ? mcp.warnings : [];
    return (
        <div className="panel mcp-panel">
            {mcp.error ? <p className="panel-error">{mcp.error}</p> : null}
            {warnings.map((warning, index) => (
                <p key={index} className="panel-error">
                    {String(warning)}
                </p>
            ))}
            {!mcp.loading && !mcp.error && items.length === 0 ? (
                <p className="panel-empty">Aucun serveur MCP configuré.</p>
            ) : null}
            <ul className="mcp-list">
                {items.map((server) => {
                    const state = MCP_STATES[server.status] || { label: String(server.status || "inconnu"), symbol: "·" };
                    const action = mcpAction(server);
                    return (
                        <li key={server.scope + ":" + server.name} className={"mcp-server mcp-" + (server.status || "idle")}>
                            <div className="mcp-text">
                                <span className="mcp-name">
                                    {server.name}
                                    <span className="tag">{MCP_SCOPES[server.scope] || server.scope}</span>
                                </span>
                                <span className="mcp-status">
                                    <span className="mcp-symbol" aria-hidden="true">
                                        {state.symbol}
                                    </span>
                                    {state.label}
                                    {server.status === "connected" && typeof server.toolCount === "number"
                                        ? ` · ${server.toolCount} outil${server.toolCount > 1 ? "s" : ""}`
                                        : null}
                                </span>
                                {server.detail ? (
                                    <span className="mcp-detail" title={server.detail}>
                                        {server.transport ? server.transport + " · " : null}
                                        {server.detail}
                                    </span>
                                ) : null}
                                {server.reason ? <span className="mcp-reason">{server.reason}</span> : null}
                                {action ? (
                                    <button
                                        type="button"
                                        className="secondary mcp-action"
                                        disabled={disabled}
                                        title={disabledReason}
                                        onClick={() => (action.kind === "login" ? onLogin(server) : onConnect(server))}
                                    >
                                        {action.label}
                                    </button>
                                ) : null}
                            </div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={Boolean(server.enabled)}
                                aria-label={`${server.enabled ? "Désactiver" : "Activer"} ${server.name}`}
                                className="switch"
                                disabled={disabled}
                                title={disabledReason}
                                onClick={() => onToggle(server, !server.enabled)}
                            >
                                <span className="knob" />
                            </button>
                        </li>
                    );
                })}
            </ul>
            {mcp.loading ? <p className="panel-empty">Chargement…</p> : null}
        </div>
    );
}
