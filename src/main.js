"use strict";

const { state, record, activateConversation, setConversation } = require("./state");
const { ui, c, ask, closeInput } = require("./cli/ui");
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

  const message = context ? `${context}\n\nQUESTION : ${input}` : input;

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
    const answer = await ask(ui.prompt());

    if (answer === null) break; // Ctrl+D / entrée fermée

    const input = answer.trim();

    if (!input) continue;

    try {
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
