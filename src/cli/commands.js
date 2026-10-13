"use strict";

const { KNOWN_MODELS } = require("../config");
const { state, resetConversation, setConversation } = require("../state");
const { ui, c } = require("./ui");
const memory = require("../project/memory");
const projectContext = require("../project/project-context");
const conversations = require("../project/conversations");
const { authStatus, getAccessToken } = require("../api/auth");
const { promptAndLogin } = require("../api/login");
const {
  setProject,
  unsetProject,
  undoLast,
  listDirectory,
  readFile,
} = require("../tools/tools");

function showHelp() {
  const rows = [
    ["/help", "Afficher cette aide"],
    ["/project <dossier>", "Choisir un projet local"],
    ["/unproject", "Quitter le mode projet"],
    ["/pwd", "Afficher le projet sélectionné"],
    ["/tree [dossier]", "Lister un dossier (2 niveaux)"],
    ["/read <fichier>", "Lire localement un fichier"],
    ["/index", "Régénérer le résumé du projet (RESUME.md)"],
    ["/resume", "Afficher le résumé du projet"],
    ["/undo", "Annuler la dernière modification"],
    ["/changes", "Historique des modifications annulables"],
    ["/memory", "Notes et dernières actions du projet"],
    ["/remember <texte>", "Ajouter une note durable au projet"],
    ["/forget <n|all>", "Supprimer une note (ou toutes)"],
    ["/permissions [remove <n|préfixe>|clear]", "Règles des commandes autorisées (projet)"],
    ["/auto on|off", "Autoriser sans confirmation (session)"],
    ["/mode auto|agent|chat", "Quand utiliser les outils fichiers"],
    ["/new", "Nouvelle conversation"],
    ["/chat-id [n|id]", "Voir le chat ID / reprendre une conversation"],
    ["/history [all]", "Dernières conversations (id + titre)"],
    ["/messages", "Messages de la conversation (session)"],
    ["/model [id]", "Lister / changer d'agent"],
    ["/web on|off", "Recherche web (chat normal)"],
    ["/auth [refresh]", "État de la connexion / renouvellement"],
    ["/login", "Se connecter avec e-mail et mot de passe"],
    ["/history", "Afficher l'historique local"],
    ["/clear", "Effacer le terminal"],
    ["/exit", "Quitter"],
  ];

  console.log(`\n${c.bold("Commandes")}`);

  for (const [cmd, desc] of rows) {
    console.log(`  ${c.cyan(cmd.padEnd(24))} ${c.dim(desc)}`);
  }

  console.log(
    `\n${c.dim("Projet :")} ${state.workspace || "aucun"}  ` +
      `${c.dim("Agent :")} ${state.model}  ${c.dim("Mode :")} ${state.mode}`,
  );
  console.log(
    c.dim(
      "Sans /project : chat normal. Avec /project : l'agent peut lire, créer, éditer, " +
        "déplacer, copier et supprimer (corbeille). Chaque écriture est confirmée.",
    ),
  );
}

const unquote = (value) =>
  value.length > 1 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;

function requireProject() {
  if (!state.workspace) {
    ui.info("Aucun projet sélectionné. Utilise /project <dossier>.");
    return false;
  }
  return true;
}

async function handleCommand(input) {
  const firstSpace = input.search(/\s/);
  const command = (
    firstSpace === -1 ? input : input.slice(0, firstSpace)
  ).toLowerCase();
  const value = firstSpace === -1 ? "" : input.slice(firstSpace).trim();

  switch (command) {
    case "/help":
      showHelp();
      break;

    case "/project":
      if (!value) {
        ui.info(`Projet : ${state.workspace || "aucun"}`);
        break;
      }

      await setProject(unquote(value));
      break;

    case "/unproject":
      unsetProject();
      ui.info("Projet désélectionné. Retour au chat normal.");
      break;

    case "/pwd":
      ui.info(`Projet : ${state.workspace || "aucun projet sélectionné"}`);
      break;

    case "/tree": {
      if (!requireProject()) break;

      const result = await listDirectory({
        path: unquote(value) || ".",
        recursive: true,
      });

      console.log(c.bold(result.path));

      for (const entry of result.entries) {
        const depth =
          entry.path.split("/").length -
          (result.path === "." ? 1 : result.path.split("/").length + 1);
        const name = entry.path.split("/").pop();
        const indent = "  ".repeat(Math.max(0, depth) + 1);

        console.log(
          entry.type === "directory"
            ? `${indent}${c.cyan(`${name}/`)}`
            : `${indent}${name}`,
        );
      }

      if (result.truncated) ui.warn("Liste tronquée.");
      break;
    }

    case "/read":
      if (!requireProject()) break;

      if (!value) {
        ui.info("Usage : /read <fichier>");
        break;
      }

      console.log((await readFile({ path: unquote(value) })).content);
      break;

    case "/index": {
      if (!requireProject()) break;

      const report = await projectContext.load(state.workspace, {
        force: true,
      });
      ui.info(
        `${report.status} | ${report.files} fichier(s), ${report.skipped} ignoré(s)`,
      );
      break;
    }

    case "/resume": {
      if (!requireProject()) break;

      console.log(projectContext.resumeText() ?? "Aucun résumé chargé.");
      break;
    }

    case "/undo":
      if (!requireProject()) break;
      ui.info(await undoLast());
      break;

    case "/changes": {
      if (!requireProject()) break;

      const list = memory.listUndo();

      if (!list.length) {
        ui.info("Aucune modification annulable.");
        break;
      }

      console.log(c.bold("Modifications (la plus récente en premier)"));

      [...list].reverse().forEach((entry, i) => {
        console.log(
          `  ${c.gray(String(i + 1).padStart(2))} ${entry.label} ` +
            c.dim(entry.at.slice(0, 16).replace("T", " ")),
        );
      });
      break;
    }

    case "/memory": {
      if (!requireProject()) break;

      const notes = memory.listNotes();
      const actions = memory.listActions().slice(-10);

      console.log(c.bold("Notes"));

      if (!notes.length) console.log(c.dim("  aucune"));
      notes.forEach((note, i) =>
        console.log(`  ${c.gray(`${i + 1}.`)} ${note}`),
      );

      console.log(`\n${c.bold("Dernières actions")}`);

      if (!actions.length) console.log(c.dim("  aucune"));
      actions.forEach((a) =>
        console.log(
          `  ${c.gray(a.at.slice(0, 16).replace("T", " "))} ${a.text}`,
        ),
      );
      break;
    }

    case "/remember":
      if (!requireProject()) break;

      if (!value) {
        ui.info("Usage : /remember <texte>");
        break;
      }

      memory.addNote(value);
      await memory.save();
      ui.info("Note enregistrée.");
      break;

    case "/forget":
      if (!requireProject()) break;

      if (value === "all") {
        memory.clearNotes();
        await memory.save();
        ui.info("Toutes les notes ont été supprimées.");
      } else if (memory.removeNote(value)) {
        await memory.save();
        ui.info("Note supprimée.");
      } else {
        ui.info("Usage : /forget <numéro|all> (voir /memory)");
      }
      break;

    case "/permissions": {
      if (!requireProject()) break;

      const { getPermissionStore } = require("../tools/command/index");
      const store = getPermissionStore();

      if (!store) {
        ui.info("Aucun projet ouvert.");
        break;
      }

      const [action, ...rest] = String(value || "").trim().split(/\s+/);
      const target = rest.join(" ");

      if (!action) {
        const rules = await store.load();
        if (!rules.length) {
          ui.info("Aucune règle : chaque commande non sûre est confirmée (o / n / t).");
        } else {
          ui.info(`Règles (${store.file}) :`);
          rules.forEach((rule, i) => ui.info(`  ${i + 1}. ${rule.text}`));
        }
      } else if (action === "remove" && target) {
        const removed = await store.remove(target);
        ui.info(removed ? `Règle supprimée : « ${removed} ».` : "Règle introuvable (voir /permissions).");
      } else if (action === "clear") {
        const count = await store.clear();
        ui.info(`${count} règle(s) supprimée(s).`);
      } else {
        ui.info("Usage : /permissions [remove <numéro|préfixe>|clear]");
      }
      break;
    }

    case "/auto":
      if (!["on", "off"].includes(value)) {
        ui.info(
          `Auto-approbation : ${state.autoApprove ? "on" : "off"} (usage : /auto on|off)`,
        );
        break;
      }

      state.autoApprove = value === "on";

      if (state.autoApprove) {
        ui.warn(
          "Les écritures seront appliquées SANS confirmation. /undo reste disponible.",
        );
      } else {
        ui.info("Confirmation de chaque écriture rétablie.");
      }
      break;

    case "/mode":
      if (!["auto", "agent", "chat"].includes(value)) {
        ui.info(`Mode : ${state.mode} (usage : /mode auto|agent|chat)`);
        break;
      }

      state.mode = value;
      ui.info(`Mode : ${value}`);
      break;

    case "/new":
      resetConversation(state.mode === "agent" ? "agent" : "chat");
      ui.info("Nouvelle conversation.");
      break;

    case "/chat-id": {
      if (!value) {
        const ids = state.chatIds;
        if (!ids.chat && !ids.agent) {
          ui.info(
            "Aucune conversation en cours (l'id est attribué au premier message).",
          );
          break;
        }

        for (const mode of ["chat", "agent"]) {
          if (!ids[mode]) continue;
          const current = await conversations.find(ids[mode]);
          ui.info(
            `${mode === "agent" ? "Agent" : "Chat"} : ${ids[mode]}` +
              (current ? ` | "${current.title}"` : ""),
          );
          ui.info(`Pour la reprendre plus tard : /chat-id ${ids[mode]}`);
        }
        break;
      }

      const ref = unquote(value);
      const target = await conversations.find(ref);
      const id = target?.id ?? ref;

      if (/\s/.test(id)) {
        ui.info("Usage : /chat-id <numéro|id> (voir /history)");
        break;
      }

      const mode = target?.mode === "agent" ? "agent" :
        state.mode === "agent" ? "agent" : "chat";
      resetConversation(mode);
      setConversation(
        mode,
        id,
        target?.settings || (Number.isInteger(target?.model) ? { model: target.model } : null),
      );

      ui.info(
        target
          ? `Conversation reprise : "${target.title}" (${id}) | agent ${state.model}`
          : `Conversation ${id} reprise (absente de l'historique local).`,
      );

      break;
    }

    case "/model": {
      if (!value) {
        for (const model of KNOWN_MODELS) {
          console.log(
            `  ${c.cyan(String(model.id).padEnd(7))} ${model.name}` +
              (model.id === state.model ? c.dim("  (actuel)") : ""),
          );
        }
        ui.info("Usage : /model <id>");
        break;
      }

      const id = Number(value);

      if (!Number.isInteger(id)) {
        ui.info("Usage : /model -1002");
        break;
      }

      state.model = id;
      resetConversation(state.mode === "agent" ? "agent" : "chat");
      ui.info(`Agent sélectionné : ${id}`);
      break;
    }

    case "/web":
      if (!["on", "off"].includes(value)) {
        ui.info("Usage : /web on|off");
        break;
      }

      state.webSearch = value === "on";
      ui.info(`Recherche web : ${state.webSearch ? "on" : "off"}`);
      break;

    case "/login":
      await promptAndLogin();
      break;

    case "/auth":
      if (value === "refresh") {
        await getAccessToken(true);
        ui.info("Token renouvelé.");
      }

      authStatus();
      break;

    case "/history": {
      const limit = value === "all" ? conversations.MAX_ENTRIES : 15;
      const items = await conversations.recent(limit);

      if (!items.length) {
        ui.info("Aucune conversation enregistrée.");
        break;
      }

      console.log(
        c.bold("Conversations récentes (la plus récente en premier)"),
      );

      items.forEach((entry, i) => {
        const current =
          entry.id === state.chatId ? c.green("  (en cours)") : "";
        const date = String(entry.updatedAt || "")
          .slice(0, 16)
          .replace("T", " ");

        console.log(
          `  ${c.gray(String(i + 1).padStart(2))} ${entry.title}${current}`,
        );
        console.log(
          `     ${c.cyan(entry.id)} ` +
            c.dim(
              `${date} | agent ${entry.model} | ${entry.messages} échange(s)`,
            ),
        );
      });

      ui.info(
        "Reprendre : /chat-id <numéro> ou /chat-id <id> | /history all pour tout voir",
      );
      break;
    }

    case "/messages":
      if (!state.history.length) ui.info("Historique local vide.");

      for (const item of state.history) {
        console.log(
          `\n${item.role === "user" ? c.bold(">") : ""} ${item.content}`,
        );
      }
      break;

    case "/clear":
      console.clear();
      break;

    case "/exit":
    case "/quit":
      return false;

    default:
      ui.info("Commande inconnue. Utilise /help.");
  }

  return true;
}

module.exports = { handleCommand };
