"use strict";

/**
 * Commandes slash : source unique pour /help (CLI) et l'auto-complétion de
 * l'interface graphique. Aucun require ici : le renderer Electron l'importe.
 */
const COMMANDS = [
    ["/help", "Afficher cette aide"],
    ["/project <dossier>", "Choisir un projet local"],
    ["/unproject", "Quitter le mode projet"],
    ["/fr-project <nom>|off", "Rattacher les conversations à un projet FranceStudent"],
    ["/pwd", "Afficher le projet sélectionné"],
    ["/tree [dossier]", "Lister un dossier (2 niveaux)"],
    ["/read <fichier>", "Lire localement un fichier"],
    ["/index [force]", "Résumer le projet avec l'IA (RESUME.md, pour /resume)"],
    ["/init", "Créer FRSTCLI.md (instructions du projet)"],
    ["/plan <demande>", "Plan en lecture seule, sans modification"],
    ["/resume", "Afficher le résumé du projet (RESUME.md)"],
    ["/undo", "Annuler la dernière modification"],
    ["/changes", "Historique des modifications annulables"],
    ["/memory", "Notes et dernières actions du projet"],
    ["/remember <texte>", "Ajouter une note durable au projet"],
    ["/forget <n|all>", "Supprimer une note (ou toutes)"],
    ["/permissions [remove <n|préfixe>|clear]", "Règles des commandes autorisées (projet)"],
    ["/jobs [stop <id>|stop-all]", "Commandes en arrière-plan (liste / arrêt)"],
    ["/auto on|off", "Autoriser sans confirmation (session)"],
    ["/mode auto|chat", "Outils : auto = avec /project, chat = aucun"],
    ["/new", "Nouvelle conversation"],
    ["/compact [consigne]", "Résumer la session et repartir d'une nouvelle conversation"],
    ["/context", "Contexte utilisé, conversation et tours"],
    ["/chat-id [n|id]", "Voir le chat ID / reprendre une conversation"],
    ["/history [all]", "Dernières conversations (id + titre)"],
    ["/messages", "Messages de la conversation (session)"],
    ["/usage", "Consommation : session, conversation, limites du compte"],
    ["/model [nom]", "Lister les agents de l'API / changer d'agent"],
    ["/web on|off", "Recherche web (chat normal)"],
    ["/auth [refresh]", "État de la connexion / renouvellement"],
    ["/login", "Se connecter avec e-mail et mot de passe"],
    ["/profil [user|projet] [learn <fait>|forget <n>]", "Profil appris (utilisateur ou projet)"],
    ["/preprompt [user|projet] <texte>|clear", "Consigne ajoutée à chaque demande"],
    ["/clear", "Effacer le terminal"],
    ["/exit", "Quitter (alias : /quit)"],
];

/** « /read <fichier> » → { name: "/read", args: "<fichier>", usage, description }. */
function parseCommand([usage, description]) {
    const space = usage.indexOf(" ");
    return {
        name: space === -1 ? usage : usage.slice(0, space),
        args: space === -1 ? "" : usage.slice(space + 1),
        usage,
        description,
    };
}

const COMMAND_LIST = COMMANDS.map(parseCommand);

module.exports = { COMMANDS, COMMAND_LIST, parseCommand };
