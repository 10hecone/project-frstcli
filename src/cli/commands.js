"use strict";

const fs = require("fs");
const path = require("path");
const { state, resetConversation, setConversation } = require("../state");
const { c } = require("./ui");
const { COMMANDS } = require("./command-list");
const { ui } = require("../ui-bridge");
const memory = require("../project/memory");
const projectContext = require("../project/project-context");
const conversations = require("../project/conversations");
const { authStatus, getAccessToken } = require("../api/auth");
const { promptAndLogin } = require("../api/login");
const { workspace } = require("../core/workspace");
const {
  undoLast,
  listDirectory,
  readFile,
} = require("../tools/tools");

function showHelp() {
  const rows = COMMANDS;

  ui.print(`\n${c.bold("Commandes")}`);

  for (const [cmd, desc] of rows) {
    ui.print(`  ${c.cyan(cmd.padEnd(24))} ${c.dim(desc)}`);
  }

  ui.print(
    `\n${c.dim("Dossier :")} ${workspace.root || "aucun (--no-project)"}  ` +
      `${c.dim("Agent :")} ${require("../api/agents").agentName(state.model)}  ${c.dim("Mode :")} ${require("../core/permissions-mode").get()}`,
  );
  for (const line of HELP_NOTES) ui.print(c.dim(line));
}

// Explications affichées sous la liste des commandes (/help).
const HELP_NOTES = [
  "",
  "Dossier : frst travaille dans le dossier où il est lancé (ou `frst <dossier>`). Le modèle y lit, cherche,",
  "édite et lance des commandes ; pour changer de dossier, quitte et relance frst ailleurs.",
  "Modes (Shift+Tab ou /mode) : default confirme écritures et commandes non sûres ; acceptEdits applique",
  "les écritures sans confirmer (/undo reste possible) ; plan explore en lecture seule, sans rien modifier.",
  "Sessions : chaque lancement ouvre une nouvelle session ; /resume en reprend une du dossier.",
  "Lancement : frst -c (reprendre la dernière session) · frst --resume (choisir) · frst --no-project",
  "(chat sans outils, aucun dossier) · frst --help (toutes les options).",
];

const unquote = (value) =>
  value.length > 1 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;

// Sans dossier (lancement avec --no-project), les commandes de projet sont indisponibles.
function requireFolder() {
  if (!workspace.root) {
    ui.info("Aucun dossier ouvert (lancé avec --no-project) : relance frst dans un dossier.");
    return false;
  }
  return true;
}

// Ouvre un fichier avec l'application par défaut du système, sans attendre sa fermeture.
function openWithDefaultApp(file) {
  const { spawn } = require("child_process");
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", file]]
      : [process.platform === "darwin" ? "open" : "xdg-open", [file]];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => ui.warn(`Impossible d'ouvrir ${file} : ouvre-le dans ton éditeur.`));
  child.unref();
}

// /status : état du dossier et de la session en cours.
async function showStatus() {
  const root = workspace.root;
  const sessions = require("../core/sessions");
  const chatId = state.chatIds.chat;
  const rows = [["Dossier", root || "aucun (lancé avec --no-project)"]];

  if (root) {
    const project = await require("../project/projects").get(root);
    rows.push(["Confiance", project && project.trusted ? "dossier approuvé" : "non approuvé"]);
  }

  let title = null;
  if (chatId) {
    const known = (await sessions.listSessions(root)).find((session) => session.id === chatId);
    title = known ? known.title : (await conversations.find(chatId))?.title;
  }
  rows.push([
    "Session",
    chatId ? `${chatId}${title ? ` | "${title}"` : ""}` : "nouvelle (l'id est attribué au premier message)",
  ]);

  if (root) rows.push(["Branche", require("../project/git-branch").gitBranch(root) || "aucune (pas un dépôt git)"]);
  rows.push(["Mode", `${require("../core/permissions-mode").get()} (Shift+Tab ou /mode pour changer)`]);
  rows.push(["Agent", require("../api/agents").agentName(state.model)]);

  if (root) {
    const files = await require("../project/instructions").instructionFiles(root);
    rows.push(["FRSTCLI.md", files.length ? files.map((file) => file.path).join(", ") : "aucun (/init pour en créer un)"]);
  }

  for (const [label, text] of rows) ui.print(`  ${c.dim(`${label} :`.padEnd(13))} ${text}`);
}

// /resume [n|id] : reprend une session du dossier (sélecteur, ou liste numérotée sans sélecteur).
async function resumeCommand(ref) {
  const sessions = require("../core/sessions");
  const list = await sessions.listSessions();
  if (!list.length) {
    ui.info("Aucune session précédente dans ce dossier.");
    return;
  }

  let target = null;
  if (ref) {
    target = sessions.findSession(list, ref);
    if (!target) {
      ui.info(`Session inconnue : ${ref}. /resume sans argument liste les sessions du dossier.`);
      return;
    }
  } else {
    target = await sessions.chooseSession(list);
    if (target === null) {
      ui.info("Reprise annulée.");
      return;
    }
    if (target === undefined) {
      ui.print(c.bold("Sessions du dossier (la plus récente en premier)"));
      list.forEach((session, i) => {
        const { title, date } = sessions.describeSession(session);
        ui.print(`  ${c.gray(String(i + 1).padStart(2))} ${title} ${c.dim(date)}`);
      });
      ui.info("Pour en reprendre une : /resume <numéro|id>");
      return;
    }
  }

  sessions.resumeSession(target);
  ui.info(`Session reprise : "${sessions.describeSession(target).title}" (${target.id}).`);
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
        state.contextUsagePercent = state.contextDetails = null;
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
      ui.info(`Dossier : ${workspace.root || "aucun (lancé avec --no-project)"}`);
      break;

    case "/status":
      await showStatus();
      break;

    case "/tree": {
      if (!requireFolder()) break;

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
      if (!requireFolder()) break;

      if (!value) {
        ui.info("Usage : /read <fichier>");
        break;
      }

      ui.print((await readFile({ path: unquote(value) })).content);
      break;

    case "/index": {
      if (!requireFolder()) break;

      // /index show : affiche le résumé existant (RESUME.md) sans relancer l'analyse.
      if (value === "show") {
        const text = projectContext.resumeText() ?? (await projectContext.storedResume());
        ui.print(text ?? "Aucun résumé : /index analyse le projet avec l'IA et génère RESUME.md.");
        break;
      }

      // Le résumé n'est pas joint aux messages : il se consulte avec /index show.
      // Seuls les fichiers modifiés depuis le dernier /index sont renvoyés à l'IA.
      const report = await projectContext.load(workspace.root, {
        force: value === "force",
      });
      ui.info(
        `${report.status} | ${report.files} fichier(s), ${report.skipped} ignoré(s)`,
      );
      break;
    }

    case "/init": {
      if (!requireFolder()) break;

      const { initInstructions } = require("../project/instructions");
      const { detectPackageInfo } = require("../project/package-info");
      const { testCommand } = await detectPackageInfo(workspace.root);
      const result = await initInstructions(workspace.root, { testCommand });
      ui.info(
        result.created
          ? `FRSTCLI.md créé : ${result.path}. Complète-le, il sera lu au début de chaque conversation.`
          : `FRSTCLI.md existe déjà : ${result.path}. Je ne l'ai pas modifié.`,
      );
      break;
    }

    case "/plan": {
      if (!requireFolder()) break;

      if (!value) {
        ui.info("Usage : /plan <demande>. Explore le projet en lecture seule et propose un plan, sans rien modifier.");
        break;
      }

      // Chat avec les seuls outils de lecture (list_directory, read_file, search_files).
      const chat = require("../core/chat");
      const spin = ui.spinner("Exploration du projet");
      try {
        const { response } = await chat.send(
          "MODE PLAN (lecture seule) : explore le projet avec list_directory, read_file et search_files, " +
            "sans rien modifier ni lancer de commande. Termine par un plan numéroté " +
            "(fichiers à modifier, changements prévus, tests à ajouter, risques).\n\nDemande : " +
            value,
          { readOnly: true, onToolCalls: () => spin.stop() },
        );
        spin.stop();
        if (response) ui.assistant(response);
      } finally {
        spin.stop();
      }
      break;
    }

    case "/resume": {
      if (!requireFolder()) break;
      await resumeCommand(unquote(value));
      break;
    }

    case "/undo":
      if (!requireFolder()) break;
      ui.info(await undoLast());
      break;

    case "/changes": {
      if (!requireFolder()) break;

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
      if (!requireFolder()) break;

      const instructions = require("../project/instructions");
      if (value === "open") {
        // Ouvre le FRSTCLI.md du dossier (il faut d'abord le créer avec /init).
        const file = path.join(workspace.root, "FRSTCLI.md");
        if (!fs.existsSync(file)) {
          ui.info("Pas encore de FRSTCLI.md dans ce dossier : /init le crée.");
          break;
        }
        openWithDefaultApp(file);
        ui.info(`Ouverture de ${file}. Les changements seront lus au prochain message.`);
        break;
      }

      const files = await instructions.instructionFiles(workspace.root);
      ui.print(c.bold("Instructions (FRSTCLI.md)"));
      if (!files.length) ui.print(c.dim("  aucune : /init crée FRSTCLI.md"));
      files.forEach((file) => ui.print(`  ${file.path} ${c.dim(`(${file.text.length} caractères)`)}`));
      ui.print("");

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
      if (!requireFolder()) break;

      if (!value) {
        ui.info("Usage : /remember <texte>");
        break;
      }

      memory.addNote(value);
      await memory.save();
      ui.info("Note enregistrée.");
      break;

    case "/forget":
      if (!requireFolder()) break;

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
      if (!requireFolder()) break;

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

    case "/mcp": {
      const { runMcpCommand } = require("../mcp/cli");
      await runMcpCommand(value);
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

    case "/mode": {
      const permissionsMode = require("../core/permissions-mode");
      const mode = permissionsMode.set(value);
      if (!mode) {
        ui.info(
          `Mode : ${permissionsMode.get()} (usage : /mode default|acceptEdits|plan)`,
        );
        break;
      }

      ui.info(`Mode : ${mode}`);
      if (mode === "acceptEdits") {
        ui.warn("Les écritures seront appliquées SANS confirmation. /undo reste disponible.");
      }
      break;
    }

    case "/new":
      resetConversation();
      state.contextUsagePercent = state.contextDetails = null;
      ui.info("Nouvelle conversation.");
      break;

    case "/compact": {
      const { compactSession } = require("../core/compact");
      if (!state.chatIds.chat) {
        ui.info("Aucune conversation à résumer (/compact s'utilise après au moins un message).");
        break;
      }

      const spin = ui.spinner("Résumé de la session");
      try {
        const result = await compactSession({ instruction: unquote(value) });
        spin.stop();
        ui.info(
          `Session compactée : résumé de ${result.chars} caractères. ` +
            "Il sera joint à ton prochain message, qui ouvre une nouvelle conversation.",
        );
        ui.info(`Ancienne conversation : ${result.previousChatId} (/chat-id ${result.previousChatId} pour y revenir).`);
      } catch (error) {
        spin.stop();
        ui.warn(`Compaction impossible : ${error.message}`);
      }
      break;
    }

    case "/context": {
      const percent = state.contextUsagePercent;
      const turns = state.history.filter((entry) => entry.role === "user").length;
      ui.info(
        `Contexte : ${typeof percent === "number" ? `${Math.round(percent)} %` : "inconnu"}`,
      );
      ui.info(`Conversation : ${state.chatIds.chat || "aucune"}`);
      ui.info(`Tours (session) : ${turns}`);
      if (state.compactSummary) {
        ui.info(
          `Résumé /compact en attente : ${state.compactSummary.length} caractères, joint au prochain message.`,
        );
      }
      ui.info("Pas de compaction automatique : les fournisseurs compactent l'historique ; /compact repart d'une conversation neuve.");
      break;
    }

    case "/chat-id": {
      if (!value) {
        const currentId = state.chatIds.chat;
        if (!currentId) {
          ui.info(
            "Aucune conversation en cours (l'id est attribué au premier message).",
          );
          break;
        }

        const current = await conversations.find(currentId);
        ui.info(
          `Chat : ${currentId}` + (current ? ` | "${current.title}"` : ""),
        );
        ui.info(`Pour la reprendre plus tard : /chat-id ${currentId}`);
        break;
      }

      const ref = unquote(value);
      const target = await conversations.find(ref);
      const id = target?.id ?? ref;

      if (/\s/.test(id)) {
        ui.info("Usage : /chat-id <numéro|id> (voir /history)");
        break;
      }

      // Une ancienne conversation « agent » est reprise comme les autres (avec les outils client).
      resetConversation();
      setConversation(
        id,
        target?.settings || (Number.isInteger(target?.model) ? { model: target.model } : null),
      );
      state.contextUsagePercent = state.contextDetails = null;

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

      if (agent.id === state.model) {
        ui.info(`Agent déjà sélectionné : ${agent.name}`);
        break;
      }

      const { switchModel } = require("../core/compact");
      const spin = state.chatIds.chat ? ui.spinner("Résumé de la conversation pour le nouvel agent") : null;
      let switched;
      try {
        switched = await switchModel(agent);
      } finally {
        if (spin) spin.stop();
      }

      ui.info(`Agent sélectionné : ${agent.name}`);
      if (switched.summarized) {
        ui.info(
          (switched.fallback
            ? "Résumé automatique indisponible : les derniers échanges seront transmis"
            : `Conversation résumée (${switched.chars} caractères) : le résumé sera transmis`) +
            " à ce nouvel agent avec ton prochain message (nouvelle conversation).",
        );
        ui.info(`Ancienne conversation : ${switched.previousChatId} (/chat-id ${switched.previousChatId} pour y revenir).`);
      }
      break;
    }

    case "/usage": {
      const api = require("../api/api");
      const account = require("../api/account");
      const lines = [...account.describeSession(api.usage)];

      const chatId = state.chatIds.chat;
      if (chatId) {
        const label = "Conversation chat";
        try {
          lines.push(...account.describeChatUsage(label, await account.fetchChatUsage(chatId)));
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
