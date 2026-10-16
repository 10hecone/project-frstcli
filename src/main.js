"use strict";

const { state, record, activateConversation, setConversation } = require("./state");
const { ui, c, askMultiline, closeInput } = require("./cli/ui");
const { initAuth } = require("./api/auth");
const { promptAndLogin } = require("./api/login");
const api = require("./api/api");
const { runAgent } = require("./agent/agent");
const { handleCommand } = require("./cli/commands");
const projectContext = require("./project/project-context");
const conversations = require("./project/conversations");
const {
  isWorkspaceQuestion,
  seemsToRequestLocalFiles,
  shouldUseAgent,
} = require("./cli/router");

const profile = require("./project/profile");

const SCOPES = { user: "user", utilisateur: "user", projet: "project", project: "project" };

/**
 * /preprompt [user|projet] [texte|clear] : affiche, définit ou efface le pré-prompt.
 * /profil [user|projet] [learn <fait> | forget <n>] : faits appris (poids renforcés).
 */
async function handleProfileCommand(input) {
  const m = input.match(/^\/(\S+)\s*([\s\S]*)$/);
  const cmd = m[1].toLowerCase();
  let rest = m[2].trim();
  let scope = "user";

  const first = rest.split(/\s+/)[0].toLowerCase();
  if (SCOPES[first]) {
    scope = SCOPES[first];
    rest = rest.slice(first.length).trim();
  }

  const label = scope === "user" ? "utilisateur" : "projet";

  if (cmd === "preprompt") {
    if (!rest) {
      for (const s of ["user", "project"]) {
        const text = profile.getPreprompt(s);
        ui.info(`Pré-prompt ${s === "user" ? "utilisateur" : "projet"} : ${text || "(aucun)"}`);
      }
      ui.info("Usage : /preprompt [user|projet] <texte> | /preprompt [user|projet] clear");
      return;
    }

    if (rest.toLowerCase() === "clear") {
      await profile.setPreprompt(scope, "");
      ui.info(`Pré-prompt ${label} effacé.`);
      return;
    }

    await profile.setPreprompt(scope, rest);
    ui.info(`Pré-prompt ${label} enregistré (appliqué aux nouvelles conversations : /new).`);
    return;
  }

  const [sub, ...args] = rest.split(/\s+/);
  const action = (sub || "").toLowerCase();

  if (["learn", "apprends"].includes(action)) {
    const weight = profile.reinforce(scope, args.join(" "));
    await profile.save(scope);
    ui.info(`Fait ${label} enregistré (poids ${weight}).`);
    return;
  }

  if (["forget", "oublie"].includes(action)) {
    if (!profile.forget(scope, args[0])) throw new Error(`Numéro invalide : ${args[0] || "(vide)"}`);
    await profile.save(scope);
    ui.info(`Fait ${label} n°${args[0]} oublié.`);
    return;
  }

  const facts = profile.listFacts(scope);
  ui.info(`Faits appris (${label}) :`);
  if (!facts.length) ui.info("  (aucun)");
  facts.forEach((f, i) => ui.info(`  ${i + 1}. [${f.weight}] ${f.text}`));
  ui.info("Usage : /profil [user|projet] [learn <fait> | forget <n>]");
}

async function chatNormally(input) {
  activateConversation("chat");
  const spin = ui.spinner("Réflexion");
  let started = false;
  const hadChat = Boolean(state.chatIds.chat);

  // Premier message d'une conversation dans un projet : on y joint le contexte.
  const context =
    state.workspace && !state.chatId
      ? projectContext.promptContext(150_000)
      : "";

  // Pré-prompt personnalisé + faits appris, joints au premier message.
  const preprompt = !state.chatId
    ? require("./project/profile").buildPreprompt()
    : "";
  const header = [preprompt, context].filter(Boolean).join("\n\n");

  const message = header ? `${header}\n\nQUESTION : ${input}` : input;

  try {
    const response = await api.requestModel(message, {
      onDelta(text) {
        if (!started) {
          spin.stop();
          process.stdout.write("\n");
          started = true;
        }
        process.stdout.write(text);
      },
    });

    record("user", input);
    record("assistant", response);

    process.stdout.write("\n");

    if (state.chatId) {
      const settings = {
        model: state.model,
        webSearch: state.webSearch,
        private: state.private,
        incognito: state.incognito,
        autoApprove: state.autoApprove,
      };
      state.conversationSettings.chat = settings;
      await conversations.touch({
        id: state.chatId,
        firstMessage: input,
        model: state.model,
        workspace: state.workspace,
        mode: "chat",
        settings,
      });

      if (!hadChat) {
        ui.info(
          `Chat ID : ${state.chatId} | /chat-id ${state.chatId} pour la reprendre plus tard`,
        );
      }
    }
  } finally {
    spin.stop();
  }
}

async function main() {
  console.log();
  ui.banner();

  try {
    await initAuth();
  } catch (error) {
    if (!error.needsLogin) {
      ui.error(error.message);
      process.exitCode = 1;
      return;
    }

    ui.warn("Pas de session valide : connexion avec ton compte France Student.");

    if (!(await promptAndLogin({ useEnv: true }))) {
      ui.error("Connexion impossible. Relance le CLI ou utilise FS_SESSION_TOKEN.");
      process.exitCode = 1;
      return;
    }
  }

  ui.info("Connecté (le token se renouvelle automatiquement).");

  for (const mode of ["chat", "agent"]) {
    const saved = await conversations.findForWorkspace(null, mode);
    if (saved) setConversation(mode, saved.id, saved.settings);
  }

  while (true) {
    const answer = await askMultiline(ui.prompt());

    if (answer === null) break; // Ctrl+D / entrée fermée

    const input = answer.trim();

    if (!input) continue;

    try {
      if (/^\/(preprompt|profil)\b/i.test(input)) {
        await handleProfileCommand(input);
        continue;
      }

      if (!input.startsWith("/")) {
        profile.observe(input).catch(() => {});
      }

      if (input.startsWith("/")) {
        const keepGoing = await handleCommand(input);
        if (!keepGoing) break;
        continue;
      }

      if (isWorkspaceQuestion(input)) {
        ui.assistant(
          `Projet actuel : ${state.workspace || "aucun projet sélectionné."}`,
        );
        continue;
      }

      if (
        !state.workspace &&
        state.mode !== "chat" &&
        seemsToRequestLocalFiles(input)
      ) {
        ui.info(
          "Pour lire ou modifier des fichiers locaux, sélectionne d'abord " +
            "un dossier avec /project <dossier>.",
        );
        continue;
      }

      if (shouldUseAgent(input)) await runAgent(input);
      else await chatNormally(input);
    } catch (error) {
      ui.error(error.message);
    }
  }
}

function run() {
  return main()
    .catch((error) => {
      ui.error(`Erreur fatale : ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => closeInput());
}

module.exports = { main, run, chatNormally };
