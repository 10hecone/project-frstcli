"use strict";

const { state, resetConversation, setConversation } = require("../state");
const { c } = require("./ui");
const { ui } = require("../ui-bridge");
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
    ["/fr-project <nom>|off", "Rattacher les conversations à un projet FranceStudent"],
    ["/pwd", "Afficher le projet sélectionné"],
    ["/tree [dossier]", "Lister un dossier (2 niveaux)"],
    ["/read <fichier>", "Lire localement un fichier"],
    ["/index", "Régénérer le résumé du projet (RESUME.md)"],
    ["/init", "Créer FRSTCLI.md (instructions du projet)"],
    ["/plan <demande>", "Plan en lecture seule, sans modification"],
    ["/resume", "Afficher le résumé du projet"],
    ["/undo", "Annuler la dernière modification"],
    ["/changes", "Historique des modifications annulables"],
    ["/memory", "Notes et dernières actions du projet"],
    ["/remember <texte>", "Ajouter une note durable au projet"],
    ["/forget <n|all>", "Supprimer une note (ou toutes)"],
    ["/permissions [remove <n|préfixe>|clear]", "Règles des commandes autorisées (projet)"],
    ["/jobs [stop <id>|stop-all]", "Commandes en arrière-plan (liste / arrêt)"],
    ["/auto on|off", "Autoriser sans confirmation (session)"],
    ["/mode auto|agent|chat", "Quand utiliser les outils fichiers"],
    ["/new", "Nouvelle conversation"],
    ["/compact [consigne]", "Résumer la session dans une nouvelle conversation"],
    ["/context", "Contexte utilisé, chat ID agent, tours et seuil de compaction"],
    ["/chat-id [n|id]", "Voir le chat ID / reprendre une conversation"],
    ["/history [all]", "Dernières conversations (id + titre)"],
    ["/messages", "Messages de la conversation (session)"],
    ["/usage", "Consommation : session, conversations, limites du compte"],
    ["/model [nom]", "Lister les agents de l'API / changer d'agent"],
    ["/web on|off", "Recherche web (chat normal)"],
    ["/auth [refresh]", "État de la connexion / renouvellement"],
    ["/login", "Se connecter avec e-mail et mot de passe"],
    ["/clear", "Effacer le terminal"],
    ["/exit", "Quitter (alias : /quit)"],
  ];

  ui.print(`\n${c.bold("Commandes")}`);

  for (const [cmd, desc] of rows) {
    ui.print(`  ${c.cyan(cmd.padEnd(24))} ${c.dim(desc)}`);
  }

  ui.print(
    `\n${c.dim("Projet :")} ${state.workspace || "aucun"}  ` +
      `${c.dim("Agent :")} ${require("../api/agents").agentName(state.model)}  ${c.dim("Mode :")} ${state.mode}`,
  );
  ui.print(
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

      {
        const newConv = /\s+newconv$/i.test(value);
        const target = newConv ? value.replace(/\s+newconv$/i, "").trim() : value;
        await setProject(unquote(target), { newConv });
      }
      break;

    case "/unproject":
      unsetProject();
      ui.info("Projet désélectionné. Retour au chat normal.");
      break;

    case "/fr-project": {
      const frProjects = require("../api/fr-projects");
      const name = unquote(value);

      if (!name) {
        const current = state.frProject || (await frProjects.loadSelected());
        ui.info(
          current
            ? `Projet FranceStudent : ${current.name} (${current.id})`
            : "Aucun projet FranceStudent. Usage : /fr-project <nom> | /fr-project off",
        );
        break;
      }

      if (/^(off|none|aucun)$/i.test(name)) {
        await frProjects.saveSelected(null);
ui.info("Projet FranceStudent retiré : les nouvelles conversations ne sont plus rattachées à un projet.");
        break;
      }

      try {
        const { project, created } = await frProjects.findOrCreateProject(name);
        await frProjects.saveSelected(project);
        resetConversation();
        ui.info(
          `${created ? "Projet FranceStudent créé" : "Projet FranceStudent existant"} : ${project.name} (${project.id}). ` +
            "Les prochaines conversations y seront rattachées.",
        );
      } catch (error) {
        ui.error(`Projet FranceStudent : ${error.message}`);
      }
      break;
    }

    case "/pwd":
      ui.info(`Projet : ${state.workspace || "aucun projet sélectionné"}`);
      break;

    case "/tree": {
      if (!requireProject()) break;

      const result = await listDirectory({
        path: unquote(value) || ".",
        recursive: true,
      });

      ui.print(c.bold(result.path));

      for (const entry of result.entries) {
        const depth =
          entry.path.split("/").length -
          (result.path === "." ? 1 : result.path.split("/").length + 1);
        const name = entry.path.split("/").pop();
        const indent = "  ".repeat(Math.max(0, depth) + 1);

        ui.print(
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

      ui.print((await readFile({ path: unquote(value) })).content);
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

    case "/init": {
      if (!requireProject()) break;

      const { initInstructions } = require("../project/instructions");
      const { testCommand } = await require("../agent/agent").detectPackageInfo(state.workspace);
      const result = await initInstructions(state.workspace, { testCommand });
      require("../agent/agent").clearAgentContextCache();
      ui.info(
        result.created
          ? `FRSTCLI.md créé : ${result.path}. Complète-le, il sera lu à chaque demande de l'agent.`
          : `FRSTCLI.md existe déjà : ${result.path}. Je ne l'ai pas modifié.`,
      );
      break;
    }

    case "/plan": {
      if (!requireProject()) break;

      if (!value) {
        ui.info("Usage : /plan <demande>. L'agent explore le projet en lecture seule et propose un plan.");
        break;
      }

      const { runAgent } = require("../agent/agent");
      await runAgent(
        "MODE PLAN (lecture seule) : explore le projet avec list_directory, read_file et search_files, " +
          "sans rien modifier ni lancer de commande. Termine avec final : un plan numéroté " +
          "(fichiers à modifier, changements prévus, tests à ajouter, risques).\n\nDemande : " +
          value,
        { readOnly: true },
      );
      break;
    }

    case "/resume": {
      if (!requireProject()) break;

      ui.print(projectContext.resumeText() ?? "Aucun résumé chargé.");
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

      ui.print(c.bold("Modifications (la plus récente en premier)"));

      [...list].reverse().forEach((entry, i) => {
        ui.print(
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

      ui.print(c.bold("Notes"));

      if (!notes.length) ui.print(c.dim("  aucune"));
      notes.forEach((note, i) =>
        ui.print(`  ${c.gray(`${i + 1}.`)} ${note}`),
      );

      ui.print(`\n${c.bold("Dernières actions")}`);

      if (!actions.length) ui.print(c.dim("  aucune"));
      actions.forEach((a) =>
        ui.print(
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

    case "/jobs": {
      const { manager: jobManager, statusMessage } = require("../tools/command/jobs");
      const [action, ...rest] = String(value || "").trim().split(/\s+/);
      const id = rest.join(" ");

      if (!action) {
        const jobs = jobManager.list();
        if (!jobs.length) {
          ui.info("Aucun job en arrière-plan.");
        } else {
          jobs.forEach(job => ui.info(`  ${statusMessage(job)} ${job.command}`));
        }
      } else if (action === "stop" && id) {
        try {
          ui.info(statusMessage(await jobManager.stop(id)));
        } catch (error) {
          ui.warn(error.message);
        }
      } else if (action === "stop-all") {
        await jobManager.stopAll();
        ui.info("Tous les jobs en cours sont arrêtés.");
      } else {
        ui.info("Usage : /jobs [stop <id>|stop-all]");
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

    case "/compact": {
      const { compactSession } = require("../agent/agent");
      if (!state.chatIds.agent) {
        ui.info("Aucune conversation agent à résumer (/compact s'utilise après une demande à l'agent).");
        break;
      }

      const spin = ui.spinner("Résumé de la session");
      try {
        const result = await compactSession({ instruction: unquote(value) });
        spin.stop();
        ui.info(
          `Session compactée : résumé de ${result.chars} caractères, ` +
            `nouvelle conversation ${result.chatId || "(id attribué au prochain message)"}.`,
        );
        ui.info(
          result.contextUsagePercent == null
            ? "Contexte : inconnu."
            : `Contexte : ${Math.round(result.contextUsagePercent)} %.`,
        );
      } catch (error) {
        spin.stop();
        ui.warn(`Compaction impossible : ${error.message}`);
      }
      break;
    }

    case "/context": {
      const { CONFIG } = require("../config");
      const percent = state.contextUsagePercent;
      const turns = state.history.filter((entry) => entry.role === "user").length;
      ui.info(
        `Contexte : ${typeof percent === "number" ? `${Math.round(percent)} %` : "inconnu"}`,
      );
      ui.info(`Conversation agent : ${state.chatIds.agent || "aucune"}`);
      ui.info(`Tours (session) : ${turns}`);
      ui.info(
        CONFIG.autoCompact
          ? `Compaction automatique : à partir de ${CONFIG.autoCompactThreshold} %`
          : "Compaction automatique : désactivée (FS_AUTO_COMPACT=0)",
      );
      break;
    }

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
      const agentsApi = require("../api/agents");
      const { agents, source, error } = await agentsApi.listAgents({ refresh: !value });

      if (!value) {
        ui.print(
          c.bold(
            source === "api"
              ? "Agents disponibles (API FranceStudent)"
              : "Agents connus (API injoignable, liste locale)",
          ),
        );
        for (const agent of agents) {
          const current = agent.id === state.model;
          const details = [agent.provider, agent.model].filter(Boolean).join(" / ");
          ui.print(
            `  ${current ? c.cyan("●") : " "} ${c.cyan(agent.name)}` +
              (details ? c.dim(`  ${details}`) : "") +
              (agent.isDefault ? c.dim("  (par défaut)") : "") +
              (current ? c.dim("  (actuel)") : ""),
);
        }
        if (error && source === "local") ui.info(`API indisponible : ${error.message}`);
        ui.info("Usage : /model <nom>   (ex. /model claude opus, /model sol)");
        break;
      }

      const query = unquote(value);
      const { agent, matches } = agentsApi.resolveAgent(query, agents);

      if (!agent) {
        if (matches.length > 1) {
          ui.info(
            `Plusieurs agents correspondent à "${query}" : ${matches.map((a) => a.name).join(", ")}. Précise le nom.`,
          );
        } else {
          ui.info(`Aucun agent ne correspond à "${query}". Tape /model pour voir la liste.`);
        }
        break;
      }

      state.model = agent.id;
      resetConversation(state.mode === "agent" ? "agent" : "chat");
      ui.info(`Agent sélectionné : ${agent.name}`);
      break;
    }

    case "/usage": {
      const api = require("../api/api");
      const account = require("../api/account");
      const lines = [...account.describeSession(api.usage)];

      for (const mode of ["chat", "agent"]) {
        const id = state.chatIds[mode];
        if (!id) continue;
        const label = mode === "agent" ? "Conversation agent" : "Conversation chat";
        try {
          lines.push(...account.describeChatUsage(label, await account.fetchChatUsage(id)));
        } catch (error) {
          lines.push(`${label} : ${error.message}`);
        }
      }

      try {
        lines.push(...account.describeUserUsage(await account.fetchUserUsage()));
      } catch (error) {
        lines.push(`Compte : ${error.message}`);
      }

      ui.print(c.bold("Consommation"));
      lines.forEach((line) => ui.print(`  ${line}`));
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

      ui.print(
        c.bold("Conversations récentes (la plus récente en premier)"),
      );

      items.forEach((entry, i) => {
        const current =
          entry.id === state.chatId ? c.green("  (en cours)") : "";
        const date = String(entry.updatedAt || "")
          .slice(0, 16)
          .replace("T", " ");

        ui.print(
          `  ${c.gray(String(i + 1).padStart(2))} ${entry.title}${current}`,
        );
        ui.print(
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
        ui.print(
          `\n${item.role === "user" ? c.bold(">") : ""} ${item.content}`,
        );
      }
      break;

    case "/clear":
      require("../agent/agent").clearAgentContextCache();
      ui.clear();
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
