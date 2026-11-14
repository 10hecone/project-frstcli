"use strict";

const { ui } = require("../ui-bridge");
const profile = require("../project/profile");

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

module.exports = { handleProfileCommand };
