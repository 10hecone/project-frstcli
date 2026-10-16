"use strict";

const { ui, askInput, closeInput, createMarkdownStream } = require("./cli/ui");
const chat = require("./core/chat");
const session = require("./core/session");

// Rendu CLI d'un message en mode chat : spinner, Markdown en streaming,
// puis l'ID de la conversation si elle vient d'être créée.
async function chatNormally(input) {
  const spin = ui.spinner("Réflexion");
  let started = false;

  // Rendu Markdown ligne par ligne pendant le streaming (état des blocs de code conservé).
  const md = createMarkdownStream();

  try {
    const { newChatId } = await chat.send(input, {
      onDelta(text) {
        if (!started) {
          spin.stop();
          process.stdout.write("\n");
          started = true;
        }
        md.write(text);
      },
    });

    md.flush();

    process.stdout.write("\n");

    if (newChatId) {
      ui.info(
        `Chat ID : ${newChatId} | /chat-id ${newChatId} pour la reprendre plus tard`,
      );
    }
  } finally {
    spin.stop();
  }
}

async function main() {
  console.log();
  ui.banner();

  const boot = await session.bootstrap();

  if (!boot.ok) {
    ui.error(boot.reason);
    process.exitCode = 1;
    return;
  }

  while (true) {
    const answer = await askInput(ui.prompt());

    if (answer === null) break; // Ctrl+D / entrée fermée

    try {
      const { exit } = await session.handleInput(answer, {
        sendChat: chatNormally,
      });
      if (exit) break;
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
