"use strict";

/**
 * Modifications de fichiers faites pendant la session, pour l'interface graphique :
 * liste par fichier avec diff, bilan de fin de tour, annulation par fichier ou d'un tour.
 *
 * S'appuie sur la pile d'annulation du projet (src/project/memory.js) : une entrée par
 * modification, de la plus ancienne à la plus récente. Ne dépend pas d'Electron.
 *
 * Dépendances injectables (tests) : memory, revert, resolve, readText, workspace, diffModule.
 */

const fsp = require("node:fs/promises");

const DIFF_LINES = 200;
const MAX_DIFF_BYTES = 512 * 1024;
const SUMMARY_ITEMS = 8;

function errorMessage(error) {
    return error && error.message ? error.message : String(error);
}

/** Chemins touchés par une entrée de la pile. */
const entryPaths = (entry) => [entry.rel, entry.from, entry.to].filter(Boolean);

/** Deux chemins se recouvrent s'ils sont identiques ou si l'un contient l'autre. */
function related(a, b) {
    return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/** Vrai si deux listes d'entrées touchent un même chemin (ou un chemin parent/enfant). */
function overlaps(entry, paths) {
    return entryPaths(entry).some((p) => paths.some((q) => related(p, q)));
}

/** Clé de regroupement : un déplacement est un élément à part, le reste est groupé par fichier. */
function groupKey(entry) {
    return entry.kind === "move" ? `${entry.from} → ${entry.to}` : String(entry.rel);
}

/** Genre « net » d'un groupe d'entrées (création puis modifications = création). */
function netKind(entries) {
    const first = entries[0];
    const last = entries[entries.length - 1];
    if (first.kind === "move" || first.kind === "mkdir" || first.kind === "copy") return first.kind;
    if (last.kind === "delete") return "delete";
    if (first.kind === "create") return "create";
    return "edit";
}

/** Diff d'une suppression : toutes les lignes retirées. */
function removalDiff(text) {
    const all = String(text).split("\n");
    const lines = all
        .slice(0, DIFF_LINES)
        .map((line, index) => ({ type: "-", num: index + 1, text: line.replace(/\r$/, "") }));
    if (all.length > DIFF_LINES) {
        lines.push({ type: "more", num: null, text: `... ${all.length - DIFF_LINES} lignes de plus` });
    }
    return { lines, added: 0, removed: all.length };
}

function createChanges({
    memory = null,
    revert = null,
    resolve = null,
    readText = null,
    workspace = null,
    notify = () => {},
    isRunning = () => false,
    diffModule = null
} = {}) {
    const mem = () => memory || require("../project/memory");
    const doRevert = (entry) => (revert || require("../tools/core/journal").revert)(entry);
    const root = () => (workspace ? workspace() : require("../core/workspace").workspace.root);

    async function absolute(rel) {
        const resolver = resolve || require("../tools/security").resolveInWorkspace;
        const { target } = await resolver(root(), rel);
        return target;
    }

    /** Contenu texte d'un fichier, ou null s'il est absent, trop gros ou binaire. */
    async function read(file) {
        if (!file) return null;
        try {
            if (readText) return await readText(file);
            const info = await fsp.stat(file);
            if (!info.isFile() || info.size > MAX_DIFF_BYTES) return null;
            const text = await fsp.readFile(file, "utf8");
            return text.includes("\0") ? null : text;
        } catch {
            return null;
        }
    }

    /** Entrées de la session (ou les `count` dernières), de la plus ancienne à la plus récente. */
    function sessionEntries(count = null) {
        const all = mem().listUndo();
        const wanted = count === null ? mem().sessionChanges() : count;
        return wanted > 0 ? all.slice(-wanted) : [];
    }

    /** Diff net d'un groupe : état avant la première entrée, état actuel du fichier. */
    async function netDiff(entries, kind) {
        if (kind === "move" || kind === "mkdir" || kind === "copy") return null;

        const first = entries[0];
        const last = entries[entries.length - 1];

        let before = null;
        if (first.kind === "delete") before = await read(first.trash);
        else if (first.kind !== "create") before = await read(first.backup);

        // Fichier créé : « avant » est vide (null). Sinon, sans contenu d'origine, pas de diff.
        if (before === null && first.kind !== "create") return null;
        if (kind === "delete") return before === null ? null : removalDiff(before);

        const current = await read(await absolute(last.rel).catch(() => null));
        if (current === null) return null;

        return diffModule ? diffModule.buildDiff(before, current, DIFF_LINES) : require("../tools/diff").buildDiff(before, current, DIFF_LINES);
    }

    /** Un élément de la liste (ou du bilan) pour un groupe d'entrées. */
    async function describe({ key, entries, newer }, { withLines }) {
        const kind = netKind(entries);
        const last = entries[entries.length - 1];
        const rel = last.kind === "move" ? last.to : last.rel;
        const paths = entries.flatMap(entryPaths);
        const blocking = newer.find((other) => overlaps(other, paths));

        let diff = null;
        try {
            diff = await netDiff(entries, kind);
        } catch {
            diff = null;
        }

        const item = {
            id: key,
            rel,
            from: last.kind === "move" ? last.from : null,
            kind,
            count: entries.length,
            label: last.label || rel,
            at: last.at || null,
            added: diff ? diff.added : 0,
            removed: diff ? diff.removed : 0,
            hasDiff: Boolean(diff),
            canUndo: !blocking,
            reason: blocking ? `Une modification plus récente touche ${blocking.rel || blocking.to}.` : null
        };
        if (withLines) item.lines = diff ? diff.lines : [];
        return item;
    }

    /** Regroupe des entrées par fichier ; `newer` = entrées plus récentes hors du groupe. */
    function groupEntries(entries, all) {
        const groups = new Map();
        for (const entry of entries) {
            const key = groupKey(entry);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(entry);
        }
        return [...groups].map(([key, list]) => {
            const lastIndex = Math.max(...list.map((entry) => all.indexOf(entry)));
            const newer = all.slice(lastIndex + 1).filter((entry) => !list.includes(entry));
            return { key, entries: list, newer };
        });
    }

    const totals = (items) => ({
        files: items.length,
        added: items.reduce((sum, item) => sum + item.added, 0),
        removed: items.reduce((sum, item) => sum + item.removed, 0)
    });

    /** Fichiers touchés pendant la session avec leur diff, le plus récent d'abord. */
    async function list() {
        const all = mem().listUndo();
        const items = [];
        for (const group of groupEntries(sessionEntries(), all)) {
            items.push(await describe(group, { withLines: true }));
        }
        items.reverse();
        return { changes: items, ...totals(items) };
    }

    /** Bilan des `count` dernières modifications (carte de fin de tour), ou null s'il n'y en a pas. */
    async function summarize(count) {
        const all = mem().listUndo();
        const entries = sessionEntries(Math.min(Math.floor(Number(count)) || 0, all.length));
        if (!entries.length) return null;

        const items = [];
        for (const group of groupEntries(entries, all)) {
            items.push(await describe(group, { withLines: false }));
        }
        items.reverse();
        return {
            type: "turnSummary",
            count: entries.length,
            lastAt: entries[entries.length - 1].at || null,
            ...totals(items),
            items: items.slice(0, SUMMARY_ITEMS).map(({ rel, kind, added, removed }) => ({ rel, kind, added, removed })),
            more: Math.max(0, items.length - SUMMARY_ITEMS)
        };
    }

    function ensureIdle() {
        if (isRunning()) throw new Error("Une demande est en cours : attends la fin ou interromps-la.");
    }

    /** Annule une entrée : restauration, journal, sauvegarde libérée. Renvoie le message de restauration. */
    async function undoEntry(entry) {
        let message;
        try {
            message = await doRevert(entry);
        } catch (error) {
            throw new Error(`Annulation impossible : ${errorMessage(error)}`);
        }
        const m = mem();
        m.removeUndo(entry);
        m.noteAction(`annulé : ${entry.label}`);
        if (entry.kind !== "copy") await m.discard(entry);
        return message;
    }

    /** Annule toutes les modifications d'un fichier (de la plus récente à la plus ancienne). */
    async function undoFile(key) {
        ensureIdle();
        const all = mem().listUndo();
        const found = groupEntries(sessionEntries(), all).find((group) => group.key === key);
        if (!found) throw new Error("Cette modification n'existe plus.");

        const paths = found.entries.flatMap(entryPaths);
        const blocking = found.newer.find((other) => overlaps(other, paths));
        if (blocking) {
            throw new Error(`Annulation impossible : ${blocking.rel || blocking.to} a été modifié depuis.`);
        }

        const messages = [];
        try {
            for (const entry of [...found.entries].reverse()) messages.push(await undoEntry(entry));
        } finally {
            await mem().save();
        }
        const text = `Annulé : ${messages.join(" ")}`;
        notify(text);
        return { ok: true, message: text };
    }

    /** Annule les `count` dernières modifications, si la dernière est bien celle du bilan (`lastAt`). */
    async function undoTurn({ count, lastAt = null } = {}) {
        ensureIdle();
        const wanted = Math.floor(Number(count));
        const all = mem().listUndo();
        if (!(wanted > 0) || wanted > all.length) throw new Error("Rien à annuler.");
        if (lastAt && all[all.length - 1].at !== lastAt) {
            throw new Error("Les modifications ont changé depuis ce bilan : utilise le panneau Modifications.");
        }

        let undone = 0;
        try {
            for (const entry of all.slice(-wanted).reverse()) {
                await undoEntry(entry);
                undone++;
            }
        } finally {
            await mem().save();
        }
        const text = `Annulé : ${undone} modification(s).`;
        notify(text);
        return { ok: true, undone, message: text };
    }

    return { list, summarize, undoFile, undoTurn };
}

module.exports = { createChanges, related, groupKey, netKind, removalDiff };
