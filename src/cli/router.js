"use strict";

const { state } = require("../state");

const LETTER = "\\p{L}";

function wordRegex(words) {
    return new RegExp(`(?<!${LETTER})(?:${words})(?!${LETTER})`, "iu");
}

const FILE_NOUN_RE = wordRegex(
    "fichiers?|dossiers?|r[ée]pertoires?|code|source|readme|src|projet|" +
    "fonctions?|classes?|module|script|fichier|arborescence|" + "missions?|t[âa]ches?|[ée]tapes?|plan|tests?|commits?|bugs?|erreurs?|probl[èe]mes?|fonctionnalit[ée]s?|outils?|branches?|d[ée]p[ôo]t|todo|" + "task|step|feature|tool|branch|repo|repository|project|file|folder"
);

const FILE_NAME_RE = new RegExp(
    "package\\.json" +
    "|\\.(?:js|mjs|cjs|ts|tsx|jsx|json|md|py|html|css|txt|ya?ml|env|sh|ps1)(?![\\p{L}\\d])",
    "iu"
);

const FILE_VERB_RE = wordRegex(
    "lis|lire|ouvre|ouvrir|affiche|liste|lister|cr[ée]e|cr[ée]er|ajoute|ajouter|" +
    "modifie|modifier|corrige|corriger|[ée]dite|[ée]diter|remplace|remplacer|" +
    "renomme|renommer|d[ée]place|d[ée]placer|copie|copier|supprime|supprimer|efface|" +
    "[ée]cris|[ée]crire|g[ée]n[èe]re|explique|analyse|refactor\\w*|am[ée]liore|" +
    "read|open|list|create|write|edit|fix|move|rename|delete|copy|add|" + "commence|commencer|continue|continuer|termine|terminer|finis|finir|fini|fais|faire|lance|lancer|ex[ée]cute|ex[ée]cuter|impl[ée]mente|impl[ée]menter|teste|tester|installe|installer|range|ranger|nettoie|nettoyer|manipule|manipuler|commite|commiter|r[ée]sous|r[ée]soudre|" + "start|finish|run|test|implement|install|commit|resolve|solve"
);

function seemsToRequestLocalFiles(input) {
    return FILE_NAME_RE.test(input) || (FILE_VERB_RE.test(input) && FILE_NOUN_RE.test(input));
}

function isWorkspaceQuestion(input) {
    return (
        wordRegex("quel|quelle|où|ou|dans quel|dans quelle|which|what").test(input) &&
        wordRegex("projet|dossier|workspace|r[ée]pertoire").test(input) &&
        !seemsToRequestLocalFiles(input)
    );
}

/** Faut-il passer par l'agent (outils fichiers) pour ce message ? */
function shouldUseAgent(input) {
    if (!state.workspace) return false;
    if (state.mode === "agent") return true;
    if (state.mode === "chat") return false;
    return seemsToRequestLocalFiles(input);
}

module.exports = { seemsToRequestLocalFiles, isWorkspaceQuestion, shouldUseAgent };
