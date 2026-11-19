"use strict";

/**
 * Panneau Paramètres de l'interface graphique : lecture et enregistrement des préférences
 * (src/core/preferences.js). Ne dépend pas d'Electron ; dépendances injectables (tests).
 * Les modifications sont refusées pendant une réponse, comme les skills et les dossiers.
 */

const fs = require("node:fs/promises");
const path = require("node:path");

function createSettingsPanel({ isRunning = () => false, preferences = null, agents = null, settings = null } = {}) {
    const prefs = () => preferences || require("../core/preferences");
    const settingsApi = () => settings || require("../core/settings");

    /** Liste des modèles pour le choix par défaut (API si possible, sinon modèles connus). */
    async function modelList() {
        try {
            const { agents: list = [] } = await (agents || require("../api/agents")).listAgents();
            return list.length ? list : null;
        } catch {
            return null;
        }
    }

    async function get() {
        return prefs().read({ agents: await modelList() });
    }

    async function save(patch) {
        if (isRunning()) throw new Error("Attends la fin de la réponse pour modifier les paramètres.");
        return prefs().save(patch, { agents: await modelList() });
    }

    /** Chemin de settings.json, créé vide s'il n'existe pas (pour l'ouvrir dans un éditeur). */
    async function ensureFile() {
        const file = settingsApi().userFile();
        await fs.mkdir(path.dirname(file), { recursive: true });
        try {
            await fs.writeFile(file, "{}\n", { encoding: "utf8", flag: "wx" });
        } catch (error) {
            if (error.code !== "EEXIST") throw error;
        }
        return file;
    }

    return { get, save, ensureFile };
}

module.exports = { createSettingsPanel };
