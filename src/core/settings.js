"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { CONFIG } = require("../config");

/*
 * Fichiers settings.json (même format, comme Claude Code) :
 *   - projet : <projet>/.frst/settings.json (versionné : jamais de droit supplémentaire) ;
 *   - utilisateur : ~/.francestudent-cli/settings.json.
 *
 *   {
 *     "shell": "auto" | "bash" | "powershell" | "off",   (utilisateur seulement)
 *     "shellPath": "C:\\Program Files\\Git\\bin\\bash.exe", (utilisateur seulement)
 *     "permissions": { "allow": ["npm run build", "Bash(npm test:*)"], "deny": ["git push"] },
 *     "hooks": { ... }  (voir core/hooks.js)
 *   }
 *
 * Le fichier utilisateur porte aussi les préférences du panneau Paramètres (model,
 * permissionMode, autoCompactPercent…) : voir core/preferences.js.
 */

const PROJECT_FILE = path.join(".frst", "settings.json");
const USER_FILE = "settings.json";

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

const projectFile = root => path.join(root, PROJECT_FILE);
const userFile = () => path.join(CONFIG.dataDir, USER_FILE);

/** Contenu JSON du fichier, null s'il n'existe pas ; lève une erreur claire s'il est invalide. */
async function readJson(file) {
    try {
        return JSON.parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw new Error(`${file} illisible : ${error.message}`);
    }
}

/** Réglages des deux fichiers : { user, project, errors } (objet vide si absent ou invalide). */
async function loadSettings(root) {
    const errors = [];
    const read = async (file, label) => {
        try {
            const data = await readJson(file);
            if (data === null) return {};
            if (!isObject(data)) throw new Error("objet JSON attendu.");
            return data;
        } catch (error) {
            errors.push(`${label} : ${error.message}`);
            return {};
        }
    };
    const user = await read(userFile(), userFile());
    const project = root ? await read(projectFile(root), PROJECT_FILE) : {};
    return { user, project, errors };
}

module.exports = { PROJECT_FILE, USER_FILE, isObject, projectFile, userFile, readJson, loadSettings };
