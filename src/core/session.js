"use strict";

const { ui } = require("../ui-bridge");
const auth = require("../api/auth");
const login = require("../api/login");
const commands = require("../cli/commands");
const sessions = require("./sessions");
const chat = require("./chat");
const router = require("../cli/router");
const profile = require("../project/profile");
const { handleProfileCommand } = require("../cli/profile-commands");
const { workspace } = require("./workspace");

// Commandes de profil, communes à la TUI et à la GUI.
const PROFILE_COMMAND_RE = /^\/(preprompt|profil)(\s|$)/i;

const UNTRUSTED_REASON =
    "Dossier non approuvé : rien n'a été ouvert. Lance frst dans un dossier de confiance, " +
    "ou frst --no-project pour discuter sans outils.";

/**
 * Démarrage de la session : authentification (connexion si besoin), puis ouverture du dossier.
 * options (issues de `frst [options] [dossier]`, voir cli/launch-args.js) :
 * - dir : dossier à ouvrir (la TUI passe process.cwd() par défaut) ; sans dir, rien n'est ouvert (GUI) ;
 * - continue : reprendre la dernière session du dossier ; resume : la choisir dans une liste ;
 * - noProject : chat sans dossier ni outils.
 * Renvoie { ok: true, session: { kind: "new"|"resumed"|"none", title? } } ou { ok: false, reason }.
 * Chaque lancement démarre une nouvelle conversation, sauf reprise demandée.
 */
async function bootstrap(options = {}) {
    try {
        await auth.initAuth();
    } catch (error) {
        if (!error.needsLogin) return { ok: false, reason: error.message };

        ui.warn("Pas de session valide : connexion avec ton compte France Student.");

        if (!(await login.promptAndLogin({ useEnv: true }))) {
            return {
                ok: false,
                reason: "Connexion impossible. Relance frst ou utilise FS_SESSION_TOKEN."
            };
        }
    }

    ui.info("Connecté (le token se renouvelle automatiquement).");

    const frProject = await require("../api/fr-projects").loadSelected();
    if (frProject) ui.info(`Projet FranceStudent : ${frProject.name} (nouvelles conversations rattachées).`);

    if (options.noProject) return { ok: true, session: { kind: "none" } };
    if (!options.dir) return { ok: true, session: { kind: "new" } };

    try {
        if (!(await workspace.open(options.dir))) return { ok: false, reason: UNTRUSTED_REASON };
    } catch (error) {
        return { ok: false, reason: `Impossible d'ouvrir ${options.dir} : ${error.message}` };
    }

    if (!options.continue && !options.resume) return { ok: true, session: { kind: "new" } };

    const list = await sessions.listSessions();
    if (!list.length) {
        ui.info("Aucune session précédente dans ce dossier : nouvelle session.");
        return { ok: true, session: { kind: "new" } };
    }

    // --continue : la plus récente ; --resume : au choix (interface sans sélecteur → /resume).
    let chosen = list[0];
    if (options.resume) chosen = await sessions.chooseSession(list);
    if (chosen === undefined) ui.info("Sélection indisponible ici : /resume liste les sessions du dossier.");
    if (!chosen) return { ok: true, session: { kind: "new" } };

    sessions.resumeSession(chosen);
    return { ok: true, session: { kind: "resumed", title: sessions.describeSession(chosen).title } };
}

/**
 * Traite une saisie : commande /..., question sur le projet, ou message au modèle.
 * onChatDelta reçoit le texte en streaming. sendChat (optionnel) remplace l'envoi
 * par défaut (utilisé par le CLI pour son rendu).
 * Renvoie { exit } : true si la session doit s'arrêter.
 *
 * La compaction automatique (serveur) a lieu dans chat.send, avant l'envoi (core/compact.js).
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
        ui.assistant(`Dossier actuel : ${workspace.root || "aucun (chat sans outils, frst --no-project)."}`);
        return { exit: false };
    }

    if (sendChat) await sendChat(input);
    else await chat.send(input, { onDelta: onChatDelta });

    return { exit: false };
}

module.exports = { bootstrap, handleInput, UNTRUSTED_REASON };
