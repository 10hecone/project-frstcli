"use strict";

const os = require("node:os");
const path = require("node:path");

const envInt = (name, fallback) => {
    const raw = process.env[name];
    if (raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    return Number.isInteger(n) ? n : fallback;
};

const CONFIG = {
    apiUrl: process.env.FS_API_URL || "https://api.francestudent.ai",
    origin: process.env.FS_ORIGIN || "https://ia.francestudent.org",

    clientPlatform: "web_fs_ai",
    clientVersion: process.env.FS_CLIENT_VERSION || "4005601",
    userAgent:
        process.env.FS_USER_AGENT ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0",

    defaultAgentId: envInt("FS_AGENT_ID", -1002),
    timeoutMs: 310_000,
    firstByteTimeoutMs: envInt("FS_FIRST_BYTE_TIMEOUT_MS", 60_000),
    idleTimeoutMs: envInt("FS_IDLE_TIMEOUT_MS", 90_000),

    // Boucle d'outils client : confirmation demandée toutes les N rondes.
    maxAgentTurns: envInt("FS_MAX_AGENT_TURNS", 15),

    // Fichiers
    maxReadBytes: 1024 * 1024,      // taille max d'un fichier lisible sur disque
    maxReadChars: 30_000,           // caractères renvoyés au modèle par read_file
    maxWriteBytes: 512 * 1024,
    maxWriteChars: 1_000_000,       // longueur max de content / new_string, vérifiée dès la validation
    maxDirectoryEntries: 300,
    maxSearchResults: 60,
    maxSearchFiles: 3000,

    // Prompt
    maxMessageChars: 1_000_000,     // limite de l'API
    messageBudget: 980_000,

    // Résumé du projet (/index)
    contextBudgetChars: 400_000,    // contenu brut total indexé
    contextFileChars: 30_000,       // par fichier
    contextMaxFiles: 500,
    summaryChunkChars: 120_000,     // taille d'un envoi pour le résumé
    resumeInProject: process.env.FS_RESUME_IN_PROJECT === "1",
    contextIgnoredDirs: ["node_modules", ".git", "dist", "build", "coverage", "debug_src"],
    contextIgnoredFiles: ["package-lock.json"],

    // Persistance (mémoire, corbeille, sauvegardes, session)
    dataDir: process.env.FS_DATA_DIR || path.join(os.homedir(), ".francestudent-cli"),

    debug: process.env.FS_DEBUG === "1"
};

// Identifiants d'agents observés dans la capture réseau.
const KNOWN_MODELS = [
    { id: -1002, name: "GPT 6 Luna" },
    { id: -1003, name: "GPT 6.1 Sol" },
    { id: -2002, name: "Claude Haiku 5.5" },
    { id: -2001, name: "Claude Opus 5.5" }
];

module.exports = { CONFIG, KNOWN_MODELS };
