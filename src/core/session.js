"use strict";

const { state, setConversation } = require("../state");
const { ui } = require("../ui-bridge");
const auth = require("../api/auth");
const login = require("../api/login");
const agent = require("../agent/agent");
const commands = require("../cli/commands");
const conversations = require("../project/conversations");
const chat = require("./chat");
const router = require("../cli/router");

/**
 * Démarrage de la session : authentification (connexion si besoin),
 * puis restauration des conversations chat et agent.
 * Renvoie { ok: true } ou { ok: false, reason } (message d'erreur à afficher).
 */
async function bootstrap() {
    try {
        await auth.initAuth();
    } catch (error) {
        if (!error.needsLogin) return { ok: false, reason: error.message };

        ui.warn("Pas de session valide : connexion avec ton compte France Student.");

        if (!(await login.promptAndLogin({ useEnv: true }))) {
            return {
                ok: false,
                reason: "Connexion impossible. Relance le CLI ou utilise FS_SESSION_TOKEN."
            };
        }
    }

    ui.info("Connecté (le token se renouvelle automatiquement).");

    for (const mode of ["chat", "agent"]) {
        const saved = await conversations.findForWorkspace(null, mode);
        if (saved) setConversation(mode, saved.id, saved.settings);
    }

    return { ok: true };
}

/**
 * Traite une saisie : commande /..., question sur le projet, agent ou chat.
 * onChatDelta reçoit le texte du chat en streaming. sendChat (optionnel)
 * remplace l'envoi du chat par défaut (utilisé par le CLI pour son rendu).
 * Renvoie { exit } : true si la session doit s'arrêter.
 */
async function handleInput(rawInput, { onChatDelta, sendChat } = {}) {
    const input = String(rawInput ?? "").trim();

    if (!input) return { exit: false };

    if (input.startsWith("/")) {
        const keepGoing = await commands.handleCommand(input);
        return { exit: !keepGoing };
    }

    if (router.isWorkspaceQuestion(input)) {
        ui.assistant(`Projet actuel : ${state.workspace || "aucun projet sélectionné."}`);
        return { exit: false };
    }

    if (!state.workspace && state.mode !== "chat" && router.seemsToRequestLocalFiles(input)) {
        ui.info(
            "Pour lire ou modifier des fichiers locaux, sélectionne d'abord " +
                "un dossier avec /project <dossier>."
        );
        return { exit: false };
    }

    if (router.shouldUseAgent(input)) await agent.runAgent(input);
    else if (sendChat) await sendChat(input);
    else await chat.send(input, { onDelta: onChatDelta });

    return { exit: false };
}

module.exports = { bootstrap, handleInput };
