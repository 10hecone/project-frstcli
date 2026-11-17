"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { CONFIG } = require("../src/config");
const profile = require("../src/project/profile");
const memory = require("../src/project/memory");

test("profil : préférences séparées, sujets facultatifs et provenances conservées", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frst-profile-prompt-"));
    const originalDir = CONFIG.dataDir;
    const originalProjectPath = memory.projectPath;
    try {
        CONFIG.dataDir = dir;
        memory.projectPath = () => path.join(dir, "project-profile.json");
        profile.reset();
        await profile.setPreprompt("user", "Répondre en français.");
        await profile.setPreprompt("project", "Garder les changements ciblés.");
        profile.reinforce("user", "Sujet fréquent : Git", 18);
        profile.reinforce("project", "Sujet fréquent : Git", 12);
        profile.reinforce("user", "Le projet utilise npm", 3);
        profile.reinforce("project", "Le projet utilise npm", 2);

        const withTopics = profile.buildPreprompt({ includeLearnedTopics: true });
        assert.match(withTopics, /Préférences explicites de l'utilisateur/);
        assert.match(withTopics, /Préférences explicites du projet/);
        assert.match(withTopics, /Historique des sujets fréquents/);
        assert.equal(withTopics.split("Sujet fréquent : Git").length - 1, 1);
        assert.match(withTopics, /\[utilisateur, 18 ; projet, 12\]/);
        assert.match(withTopics, /\[utilisateur, 3 ; projet, 2\]/);

        const withoutTopics = profile.buildPreprompt({ includeLearnedTopics: false });
        assert.doesNotMatch(withoutTopics, /Sujet fréquent|Historique des sujets/);
        assert.match(withoutTopics, /Le projet utilise npm/);
        assert.match(withoutTopics, /Répondre en français/);
        assert.match(withoutTopics, /Garder les changements ciblés/);
        assert.equal(profile.listFacts("user").length, 2);
        assert.equal(profile.listFacts("project").length, 2);
    } finally {
        CONFIG.dataDir = originalDir;
        memory.projectPath = originalProjectPath;
        profile.reset();
        await fs.rm(dir, { recursive: true, force: true });
    }
});
