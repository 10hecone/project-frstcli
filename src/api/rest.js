"use strict";

/**
 * Requêtes REST authentifiées génériques (JSON et envoi de fichiers multipart).
 * Mêmes en-têtes que le reste du client ; un seul nouvel essai après
 * renouvellement du token sur 401.
 */

const fs = require("node:fs/promises");
const path = require("node:path");

const { CONFIG } = require("../config");
const { auth, getAccessToken } = require("./auth");

const TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 120_000;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

async function baseHeaders(retried) {
    const token = await getAccessToken(retried);
    return {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": CONFIG.userAgent,
        "francestudent-client-platform": CONFIG.clientPlatform,
        "francestudent-client-version": CONFIG.clientVersion,
        "francestudent-device-id": auth.deviceId,
        Origin: CONFIG.origin,
        Referer: `${CONFIG.origin}/`
    };
}

async function readJson(response, method, route) {
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        const error = new Error(`HTTP ${response.status} sur ${method} ${route}${text ? ` : ${text.slice(0, 300)}` : ""}`);
        error.status = response.status;
        throw error;
    }
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        const error = new Error(`Réponse illisible sur ${method} ${route} (JSON attendu).`);
        error.status = response.status;
        throw error;
    }
}

/** Requête JSON : request("GET", "/chats?limit=30"), request("POST", "/skills/x", { enabled: true }). */
async function request(method, route, body, retried = false) {
    const headers = await baseHeaders(retried);
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${CONFIG.apiUrl}${route}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (response.status === 401 && !retried) return request(method, route, body, true);
    return readJson(response, method, route);
}

/** POST /filesv2 (multipart, champ « file ») → FileObject. */
async function uploadFile(filePath, retried = false) {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error(`${path.basename(filePath)} n'est pas un fichier.`);
    if (stat.size > MAX_UPLOAD_BYTES) {
        throw new Error(`${path.basename(filePath)} dépasse ${MAX_UPLOAD_BYTES / 1024 / 1024} Mo.`);
    }
    const data = await fs.readFile(filePath);
    const form = new FormData();
    form.append("file", new Blob([data]), path.basename(filePath));

    // Pas de Content-Type : fetch ajoute la frontière multipart.
    const response = await fetch(`${CONFIG.apiUrl}/filesv2`, {
        method: "POST",
        headers: await baseHeaders(retried),
        body: form,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
    });
    if (response.status === 401 && !retried) return uploadFile(filePath, true);
    return readJson(response, "POST", "/filesv2");
}

module.exports = { request, uploadFile, MAX_UPLOAD_BYTES };
