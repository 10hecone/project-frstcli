"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { CONFIG } = require("../config");
const { ui } = require("../cli/ui");

/*
 * Historique local des conversations du chat normal.
 * Chaque entrée : { id, title, model, workspace, createdAt, updatedAt, messages }.
 * Le titre est le début du premier message (l'API ne fournit pas de titre connu).
 */

const projects = require("./projects");

// Historique enregistré dans ce dépôt (racine du CLI), jamais dans le projet ouvert.
const FILE = path.join(projects.REPO_ROOT, "history.json");
const MAX_ENTRIES = 50;
const TITLE_CHARS = 70;

let entries = null;
let saving = Promise.resolve();

async function load() {
  if (entries) return entries;

  try {
    const raw = JSON.parse(await fs.readFile(FILE, "utf8"));
    entries = Array.isArray(raw)
      ? raw.filter((e) => e && typeof e.id === "string" && e.id)
      : [];
  } catch {
    entries = []; // première utilisation ou fichier illisible
  }

  return entries;
}

function makeTitle(text) {
  const title = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (!title) return "(sans titre)";

  return title.length > TITLE_CHARS
    ? `${title.slice(0, TITLE_CHARS - 1)}...`
    : title;
}

function save() {
  const data = JSON.stringify(entries, null, 2);

  saving = saving.then(async () => {
    try {
      await fs.mkdir(path.dirname(FILE), { recursive: true });

      const tmp = `${FILE}.${process.pid}.tmp`;

      await fs.writeFile(tmp, data, { mode: 0o600 });
      await fs.rename(tmp, FILE);
    } catch (error) {
      ui.debug(
        `Historique des conversations non enregistré : ${error.message}`,
      );
    }
  });

  return saving;
}

/** Enregistre un échange dans la conversation id (créée si inconnue). */
async function touch({ id, firstMessage, model, workspace, mode = "chat", settings = null }) {
  await load();

  const now = new Date().toISOString();
  const index = entries.findIndex((e) => e.id === id);

  const entry =
    index === -1
      ? {
          id,
          title: makeTitle(firstMessage),
          model,
          workspace: workspace || null,
          mode,
          settings,
          createdAt: now,
          updatedAt: now,
          messages: 0,
        }
      : entries.splice(index, 1)[0];

  entry.updatedAt = now;
  entry.mode = mode;
  entry.settings = settings || entry.settings || null;
  entry.messages = (entry.messages || 0) + 1;

  entries.unshift(entry); // la plus récente en premier

  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;

  await save();

  if (workspace) await projects.setConversation(workspace, mode, id, entry.settings);

  return entry;
}

async function findForWorkspace(workspace, mode) {
  await load();
  return (
    entries.find(
      (entry) =>
        (entry.workspace || null) === (workspace || null) &&
        (entry.mode || "chat") === mode,
    ) || null
  );
}

async function recent(limit = 15) {
  return (await load()).slice(0, limit);
}

/** Cherche par numéro affiché dans /history (1, 2, ...) ou par id exact. */
async function find(ref) {
  const all = await load();
  const value = String(ref ?? "").trim();

  const byId = all.find((e) => e.id === value);
  if (byId) return byId;

  if (/^\d{1,3}$/.test(value)) {
    const n = Number(value);
    if (n >= 1 && n <= all.length) return all[n - 1];
  }

  return null;
}

module.exports = { touch, recent, find, findForWorkspace, makeTitle, MAX_ENTRIES };
