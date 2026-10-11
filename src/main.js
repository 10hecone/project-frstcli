"use strict";

const { state, record } = require("./state");
const { ui, c, ask, closeInput } = require("./cli/ui");
const { initAuth } = require("./api/auth");
const api = require("./api/api");
const { runAgent } = require("./agent/agent");
const { handleCommand } = require("./cli/commands");
const projectContext = require("./project/project-context");
const {
    isWorkspaceQuestion,
    seemsToRequestLocalFiles,
    shouldUseAgent
} = require("./cli/router");

async function chatNormally(input) {
    const spin = ui.spinner("Réflexion");
    let started = false;

    // Premier message d'une conversation dans un projet : on y joint le contexte.
    const context = state.workspace && !state.chatId
        ? projectContext.promptContext(150_000)
        : "";

    const message = context ? `${context}\n\nQUESTION : ${input}` : input;

    try {
        const response = await api.requestModel(message, {
            onDelta(text) {
                if (!started) {
                    spin.stop();
                    process.stdout.write(`\n${c.cyan("●")} `);
                    started = true;
                }
                process.stdout.write(text);
            }
        });

        record("user", input);
        record("assistant", response);

        process.stdout.write("\n");
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
        ui.error(error.message);
        process.exitCode = 1;
        return;
    }

    ui.info("Connecté (le token se renouvelle automatiquement).");

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
                ui.assistant(`Projet actuel : ${state.workspace || "aucun projet sélectionné."}`);
                continue;
            }

            if (!state.workspace && state.mode !== "chat" && seemsToRequestLocalFiles(input)) {
                ui.info(
                    "Pour lire ou modifier des fichiers locaux, sélectionne d'abord " +
                    "un dossier avec /project <dossier>."
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
        .catch(error => {
            ui.error(`Erreur fatale : ${error.message}`);
            process.exitCode = 1;
        })
        .finally(() => closeInput());
}

module.exports = { main, run, chatNormally };
