"use strict";

/**
 * Canaux IPC entre le processus principal Electron et la fenêtre.
 * Partagés par electron/ipc.js et electron/preload.js : un seul endroit à modifier.
 */
const CHANNELS = Object.freeze({
    // Fenêtre → processus principal (ipcRenderer.invoke) : session
    START: "frst:start",
    SNAPSHOT: "frst:snapshot",
    SUBMIT: "frst:submit",
    ANSWER: "frst:answer",
    INTERRUPT: "frst:interrupt",

    // Fenêtre → processus principal : barre latérale et barre de chat
    INFO: "frst:info",
    CHATS: "frst:chats",
    OPEN_CHAT: "frst:open-chat",
    NEW_THREAD: "frst:new-thread",
    PROJECTS: "frst:projects",
    SELECT_PROJECT: "frst:select-project",
    USAGE: "frst:usage",
    SKILLS: "frst:skills",
    TOGGLE_SKILL: "frst:toggle-skill",
    SET_MODEL: "frst:set-model",
    PICK_FILES: "frst:pick-files",
    PASTE_IMAGE: "frst:paste-image",

    // Fenêtre → processus principal : dossiers et mode de permission
    PICK_FOLDER: "frst:pick-folder",
    OPEN_FOLDER: "frst:open-folder",
    CLOSE_FOLDER: "frst:close-folder",
    RECENT_FOLDERS: "frst:recent-folders",
    TRUST_FOLDER: "frst:trust-folder",
    FOLDER_SESSIONS: "frst:folder-sessions",
    SET_PERMISSION_MODE: "frst:set-permission-mode",

    // Fenêtre → processus principal : modifications de fichiers et chemins
    CHANGES: "frst:changes",
    UNDO_CHANGE: "frst:undo-change",
    UNDO_TURN: "frst:undo-turn",
    OPEN_PATH: "frst:open-path",

    // Fenêtre → processus principal : panneau MCP (lister, activer, connecter ; rien d'autre)
    MCP_LIST: "frst:mcp-list",
    MCP_SET_ENABLED: "frst:mcp-set-enabled",
    MCP_CONNECT: "frst:mcp-connect",
    MCP_LOGIN: "frst:mcp-login",

    // Fenêtre → processus principal : intégration au système
    ATTENTION: "frst:attention",
    ZOOM: "frst:zoom",
    APPEARANCE: "frst:appearance",

    // Processus principal → fenêtre (webContents.send)
    ACTION: "frst:action",
    ZOOM_CHANGED: "frst:zoom-changed",
    FOLDER_REQUESTED: "frst:folder-requested"
});

module.exports = { CHANNELS };
