import { useEffect, useMemo, useState } from "react";
import { ActivityBar } from "./components/ActivityBar.jsx";
import { Header, projectName } from "./components/Header.jsx";
import { TitleBar } from "./components/TitleBar.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { Transcript } from "./components/Transcript.jsx";
import { TaskPanel } from "./components/TaskPanel.jsx";
import { Composer } from "./components/Composer.jsx";
import { PromptDialog } from "./components/PromptDialog.jsx";
import { StatusBar } from "./components/StatusBar.jsx";
import { Home } from "./components/Home.jsx";
import { TrustDialog } from "./components/TrustDialog.jsx";
import { useSession } from "./hooks/useSession.js";
import { useWorkspace } from "./hooks/useWorkspace.js";
import { chatBudget, contextDetails, contextPercent } from "./lib/usage.js";
import { pendingDiff } from "./lib/entries.js";
import { nextPermissionMode } from "./lib/folders.js";

/**
 * Composant racine : barre d'activité + barre latérale + zone principale.
 * Aucune logique de transport ici (voir api/client.js) ni de synchronisation (voir hooks/).
 */
export function App({ client }) {
    const { state, phase, busy, submit, answer, interrupt } = useSession(client);
    const status = state.status || {};
    const workspace = useWorkspace(client, status);
    const { newThread, loadSkills, loadUsage } = workspace;
    const [view, setView] = useState("threads");
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [expandAll, setExpandAll] = useState(false);
    const prompt = state.pendingPrompt;
    const info = workspace.info;
    const branch = status.branch || (info && info.branch) || null;
    const activeChat = workspace.chats.items.find((chat) => chat.id === status.chatId);
    const title = activeChat ? activeChat.title : status.chatId ? "Conversation" : "Nouveau thread";
    const ready = phase === "ready";
    const folder = workspace.folders.active;
    // Accueil tant qu'aucun dossier n'est ouvert, sauf si l'utilisateur a choisi de continuer sans dossier.
    const home = ready && !folder && !workspace.folders.skipped;
    const { setPermissionMode } = workspace;
    const mode = status.mode;

    // Comme VS Code : un clic sur la vue affichée replie la barre, un autre la rouvre.
    const selectView = (next) => {
        if (next === view && sidebarOpen) setSidebarOpen(false);
        else {
            setView(next);
            setSidebarOpen(true);
        }
    };

    // Ctrl+N (Cmd+N sur macOS) : nouveau thread. Ctrl+B : affiche ou masque la barre latérale.
    // Ctrl+O : déplie ou replie toutes les actions de l'assistant (comme Claude Code).
    useEffect(() => {
        const onKey = (event) => {
            if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
            const key = event.key.toLowerCase();
            if (key === "n") {
                event.preventDefault();
                if (!busy && ready) newThread();
            } else if (key === "b") {
                event.preventDefault();
                setSidebarOpen((open) => !open);
            } else if (key === "o") {
                event.preventDefault();
                setExpandAll((value) => !value);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [busy, ready, newThread]);

    // Maj+Tab dans la barre de chat : change de mode de permission, comme dans le terminal.
    // Ailleurs, Maj+Tab reste le retour arrière du focus (accessibilité au clavier).
    useEffect(() => {
        const onKey = (event) => {
            if (event.key !== "Tab" || !event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
            if (!ready || !(event.target instanceof HTMLTextAreaElement)) return;
            event.preventDefault();
            setPermissionMode(nextPermissionMode(mode));
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [ready, mode, setPermissionMode]);

    // Titre de la fenêtre : « dossier — FranceStudent Code ».
    const folderName = folder ? folder.name : null;
    useEffect(() => {
        document.title = folderName ? `${folderName} — FranceStudent Code` : "FranceStudent Code";
    }, [folderName]);

    // Skills : nécessaires à l'auto-complétion « $ », même barre latérale fermée.
    useEffect(() => {
        if (ready) loadSkills();
    }, [ready, loadSkills]);

    // Budget de chat : relu au démarrage et après chaque réponse.
    useEffect(() => {
        if (ready && !busy) loadUsage();
    }, [ready, busy, loadUsage]);

    const budget = chatBudget(workspace.usage.data);
    const context = contextPercent(status);
    const details = contextDetails(status);
    // Diff affiché juste avant une confirmation (edit_file, write_file).
    const diff = useMemo(() => (prompt ? pendingDiff(state.transcript || []) : null), [prompt, state.transcript]);

    return (
        <div className={`app${sidebarOpen ? "" : " sidebar-closed"}`}>
            <div className="backdrop" aria-hidden="true" />
            <TitleBar title={title} project={projectName(info && info.project)} folder={folderName} />
            <ActivityBar view={view} open={sidebarOpen} controls="sidebar" onSelect={selectView} />
            <Sidebar id="sidebar" view={view} open={sidebarOpen} workspace={workspace} status={status} busy={busy || !ready} />
            <main className={`main${home ? " home-main" : ""}`}>
                {home ? (
                    <Home
                        recent={workspace.folders.recent}
                        error={workspace.folders.error}
                        onPick={workspace.pickFolder}
                        onOpen={workspace.openFolder}
                        onContinue={workspace.continueWithoutFolder}
                    />
                ) : (
                    <>
                        <Header title={title} project={info && info.project} />
                        <Transcript
                            transcript={state.transcript}
                            live={state.live}
                            command={state.command}
                            spinner={state.spinner}
                            expandAll={expandAll}
                        />
                        <TaskPanel todos={state.todos} subagents={state.subagents} />
                        <Composer
                            busy={busy}
                            disabled={!ready || Boolean(prompt)}
                            info={info}
                            branch={branch}
                            skills={workspace.skills.items}
                            context={context}
                            contextDetails={details}
                            budget={budget}
                            usageError={workspace.usage.error}
                            usageLoading={workspace.usage.loading}
                            onSubmit={submit}
                            onInterrupt={interrupt}
                            onPickFiles={workspace.pickFiles}
                            onPasteImage={workspace.pasteImage}
                            onPickFolder={workspace.pickFolder}
                            onSetModel={workspace.setModel}
                            onRefreshUsage={loadUsage}
                        />
                        <StatusBar status={{ ...status, branch }} phase={phase} onSetMode={setPermissionMode} />
                    </>
                )}
            </main>
            <PromptDialog prompt={prompt} onAnswer={answer} diff={diff} />
            <TrustDialog
                request={workspace.folders.trust}
                onAccept={workspace.acceptTrust}
                onDecline={workspace.declineTrust}
            />
        </div>
    );
}
