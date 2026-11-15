"use strict";

const { state, setConversation } = require("../state");
const { ui } = require("../ui-bridge");
const auth = require("../api/auth");
const login = require("../api/login");
const commands = require("../cli/commands");
const conversations = require("../project/conversations");
const chat = require("./chat");
const router = require("../cli/router");
const profile = require("../project/profile");
const { handleProfileCommand } = require("../cli/profile-commands");
const { workspace } = require("./workspace");

// Commandes de profil, communes au CLI et à la TUI.
const PROFILE_COMMAND_RE = /^\/(preprompt|profil)(\s|$)/i;

/**
 * Démarrage de la session : authentification (connexion si besoin),
 * puis restauration de la dernière conversation.
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

    const frProject = await require("../api/fr-projects").loadSelected();
    if (frProject) ui.info(`Projet FranceStudent : ${frProject.name} (nouvelles conversations rattachées).`);

    // Une seule conversation : celle du chat (les anciennes conversations « agent » ne sont plus reprises).
    const saved = await conversations.findForWorkspace(null, "chat");
    if (saved) setConversation(saved.id, saved.settings);

    return { ok: true };
}

/**
 * Traite une saisie : commande /..., question sur le projet, ou message au modèle.
 * onChatDelta reçoit le texte en streaming. sendChat (optionnel) remplace l'envoi
 * par défaut (utilisé par le CLI pour son rendu).
 * Renvoie { exit } : true si la session doit s'arrêter.
 *
 * Pas de compaction automatique : les fournisseurs compactent eux-mêmes l'historique
 * rejoué par l'API. /compact reste disponible pour repartir d'un résumé.
 */
async function handleInput(rawInput, { onChatDelta, sendChat } = {}) {
    const input = String(rawInput ?? "").trim();

    if (!input) return { exit: false };

    if (PROFILE_COMMAND_RE.test(input)) {
        await handleProfileCommand(input);
        return { exit: false };
    }

    if (input.startsWith("/")) {
        const keepGoing = await commands.handleCommand(input);
        return { exit: !keepGoing };
    }

    // Le profil apprend des messages normaux (CLI et TUI), sans bloquer la saisie.
    Promise.resolve()
        .then(() => profile.observe(input))
        .catch(error => ui.debug(`Profil non mis à jour : ${error.message}`));

    if (router.isWorkspaceQuestion(input)) {
        ui.assistant(`Projet actuel : ${workspace.root || "aucun projet sélectionné."}`);
        return { exit: false };
    }

    if (!workspace.root && router.seemsToRequestLocalFiles(input)) {
        ui.info(
            "Pour lire ou modifier des fichiers locaux, sélectionne d'abord " +
                "un dossier avec /project <dossier>."
        );
        return { exit: false };
    }

    if (sendChat) await sendChat(input);
    else await chat.send(input, { onDelta: onChatDelta });

    return { exit: false };
}

module.exports = { bootstrap, handleInput };
