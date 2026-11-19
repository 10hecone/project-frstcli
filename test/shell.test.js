"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
    normalizeMode,
    kindOf,
    findShell,
    shellConfig,
    activeShell,
    lexShell,
    assessShell,
    buildPosixScript,
    settleCwd,
    runShell
} = require("../src/tools/command/shell");
const { parseSettingsRule, settingsRules, deniedBy } = require("../src/tools/command/permissions");

const existsIn = files => file => files.includes(file);

// ---------------------------------------------------------------------------
// Choix du shell
// ---------------------------------------------------------------------------

test("normalizeMode et kindOf", () => {
    assert.equal(normalizeMode("Git-Bash"), "bash");
    assert.equal(normalizeMode("pwsh"), "powershell");
    assert.equal(normalizeMode("OFF"), "off");
    assert.equal(normalizeMode("n'importe quoi"), "auto");
    assert.equal(kindOf("C:\\Program Files\\Git\\bin\\bash.exe"), "posix");
    assert.equal(kindOf("/bin/zsh"), "posix");
    assert.equal(kindOf("C:\\x\\pwsh.exe"), "powershell");
    assert.equal(kindOf("cmd.exe"), null);
});

test("findShell : Git Bash de Program Files sous Windows", () => {
    const bash = "C:\\Program Files\\Git\\bin\\bash.exe";
    const shell = findShell({ env: { PROGRAMFILES: "C:\\Program Files" }, platform: "win32", exists: existsIn([bash]) });
    assert.deepEqual(shell, { kind: "posix", file: bash, name: "bash" });
});

test("findShell : Git Bash déduit de git.exe du PATH", () => {
    const git = "D:\\Outils\\Git\\cmd\\git.exe";
    const bash = "D:\\Outils\\Git\\bin\\bash.exe";
    const shell = findShell({ env: { PATH: "D:\\Outils\\Git\\cmd" }, platform: "win32", exists: existsIn([git, bash]) });
    assert.equal(shell.file, bash);
});

test("findShell : le bash.exe de WSL n'est jamais retenu, repli sur PowerShell", () => {
    const wsl = "C:\\Windows\\System32\\bash.exe";
    const ps = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    const env = { PATH: "C:\\Windows\\System32", SYSTEMROOT: "C:\\Windows" };
    const shell = findShell({ env, platform: "win32", exists: existsIn([wsl, ps]) });
    assert.equal(shell.kind, "powershell");
    assert.equal(shell.file, ps);
    assert.equal(findShell({ mode: "bash", env, platform: "win32", exists: existsIn([wsl, ps]) }), null);
    assert.equal(findShell({ shellPath: wsl, env, platform: "win32", exists: existsIn([wsl, ps]) }).file, ps);
});

test("findShell : modes off, powershell et chemin explicite", () => {
    const bash = "C:\\Program Files\\Git\\bin\\bash.exe";
    const pwsh = "C:\\PS7\\pwsh.exe";
    const env = { PROGRAMFILES: "C:\\Program Files", PATH: "C:\\PS7" };
    const exists = existsIn([bash, pwsh]);
    assert.equal(findShell({ mode: "off", env, platform: "win32", exists }), null);
    assert.equal(findShell({ mode: "powershell", env, platform: "win32", exists }).file, pwsh);
    assert.equal(findShell({ shellPath: pwsh, env, platform: "win32", exists }).file, pwsh);
    // Chemin explicite d'un autre type que le mode demandé : ignoré.
    assert.equal(findShell({ mode: "bash", shellPath: pwsh, env, platform: "win32", exists }).file, bash);
    assert.equal(findShell({ env: {}, platform: "win32", exists: existsIn([]) }), null);
});

test("findShell : $SHELL sous Unix s'il s'agit de bash ou zsh", () => {
    const exists = existsIn(["/usr/bin/zsh", "/bin/bash", "/usr/bin/fish"]);
    assert.equal(findShell({ env: { SHELL: "/usr/bin/zsh" }, platform: "linux", exists }).file, "/usr/bin/zsh");
    assert.equal(findShell({ env: { SHELL: "/usr/bin/fish" }, platform: "linux", exists }).file, "/bin/bash");
    assert.equal(findShell({ env: {}, platform: "darwin", exists: existsIn(["/bin/sh"]) }).file, "/bin/sh");
});

test("shellConfig : variables d'environnement prioritaires", async () => {
    const config = await shellConfig({ FS_SHELL: "pwsh", FS_SHELL_PATH: "  C:\\PS7\\pwsh.exe  " });
    assert.deepEqual(config, { mode: "powershell", shellPath: "C:\\PS7\\pwsh.exe" });
});

test("activeShell : rien hors d'un dossier de confiance", async () => {
    assert.equal(await activeShell("C:\\projet", { isTrusted: async () => false }), null);
    assert.equal(await activeShell("C:\\projet", { isTrusted: async () => { throw new Error("x"); } }), null);
    assert.equal(await activeShell(null, { isTrusted: async () => true }), null);
});

// ---------------------------------------------------------------------------
// Analyse de la ligne
// ---------------------------------------------------------------------------

test("lexShell : guillemets, opérateurs et redirections", () => {
    const quoted = lexShell("echo 'a > b' \"c | d\"");
    assert.equal(quoted.segments.length, 1);
    assert.equal(quoted.segments[0].redirects.length, 0);
    assert.deepEqual(quoted.segments[0].words.map(word => word.text), ["echo", "a > b", "c | d"]);

    const piped = lexShell("npm test 2>&1 | tail -n 5");
    assert.equal(piped.segments.length, 2);
    // 2>&1 duplique un flux : pas de fichier visé.
    assert.equal(piped.segments[0].redirects.length, 0);

    const written = lexShell("npm test > out.txt");
    assert.equal(written.segments[0].redirects.length, 1);
    assert.equal(written.segments[0].words.length, 2);
});

test("assessShell : lignes sûres lancées sans question", () => {
    const root = process.cwd();
    const opts = { kind: "posix", cwd: root, workspace: root };
    assert.equal(assessShell("cd src && ls", opts).level, "run");
    assert.equal(assessShell("git log --oneline -5 | head -3", opts).level, "run");
    assert.equal(assessShell("echo 'a > b' \"c | d\"", opts).level, "run");
    assert.equal(assessShell("Get-ChildItem | Select-Object -First 3", { ...opts, kind: "powershell" }).level, "run");
});

test("assessShell : confirmation pour variables, écritures, boucles et scripts", () => {
    const root = process.cwd();
    const opts = { kind: "posix", cwd: root, workspace: root };
    for (const line of ["git status && echo $HOME", "echo $(whoami)", "npm test > out.txt", "ls *.js", "FOO=1 node x.js", "for f in a b; do echo $f; done"]) {
        const verdict = assessShell(line, opts);
        assert.equal(verdict.level, "ask", line);
        assert.deepEqual(verdict.prefixes, [], line);
        assert.ok(verdict.reason, line);
    }
    assert.equal(assessShell("Get-ChildItem | Where-Object { $_.Length -gt 0 }", { ...opts, kind: "powershell" }).level, "ask");

    // Seul cas mémorisable : une commande non sûre sans rien d'opaque autour.
    const npm = assessShell("npm test 2>&1 | tail -n 5", opts);
    assert.equal(npm.level, "ask");
    assert.deepEqual(npm.prefixes, [["npm", "test"]]);
});

test("assessShell : refus (hors projet, programme interdit, cd sans argument)", () => {
    const root = process.cwd();
    const opts = { kind: "posix", cwd: root, workspace: root };
    assert.equal(assessShell("cat ../secret > /dev/null", opts).level, "deny");
    assert.equal(assessShell("rm -rf build; ls", opts).level, "deny");
    assert.equal(assessShell("cd && ls", opts).level, "deny");
    assert.equal(assessShell("cd - && ls", opts).level, "deny");
});

test("assessShell : règles allow et deny de settings.json", () => {
    const root = process.cwd();
    const opts = { kind: "posix", cwd: root, workspace: root };
    const allowed = assessShell("npm test 2>&1 | tail -n 5", { ...opts, rules: [parseSettingsRule("Bash(npm test:*)")] });
    assert.equal(allowed.level, "run");
    const denied = assessShell("git log -1 | head -1", { ...opts, denyRules: [parseSettingsRule("Bash(git log:*)")] });
    assert.equal(denied.level, "deny");
});

// ---------------------------------------------------------------------------
// Règles de settings.json
// ---------------------------------------------------------------------------

test("parseSettingsRule : formes acceptées et ignorées", () => {
    assert.deepEqual(parseSettingsRule("npm test").prefix, ["npm", "test"]);
    assert.deepEqual(parseSettingsRule("Bash(npm run lint:*)").prefix, ["npm", "run", "lint"]);
    assert.deepEqual(parseSettingsRule("run_command(git push)").prefix, ["git", "push"]);
    assert.equal(parseSettingsRule("Bash(npm test:*)").source, "Bash(npm test:*)");
    assert.equal(parseSettingsRule("Read(./secret)"), null);
    assert.equal(parseSettingsRule("Bash(git * main)"), null);
    assert.equal(parseSettingsRule(""), null);
    assert.equal(parseSettingsRule(42), null);
});

test("settingsRules : allow du projet ignoré, deny des deux fichiers", () => {
    const rules = settingsRules({
        user: { permissions: { allow: ["npm test"], deny: ["Bash(git push:*)"] } },
        project: { permissions: { allow: ["Bash(node:*)"], deny: ["Bash(npm publish)"] } }
    });
    assert.deepEqual(rules.allow.map(rule => rule.prefix), [["npm", "test"]]);
    assert.deepEqual(rules.deny.map(rule => rule.prefix), [["git", "push"], ["npm", "publish"]]);
    assert.deepEqual(settingsRules({}), { allow: [], deny: [] });
});

test("deniedBy : règle qui vise la commande", () => {
    const deny = [parseSettingsRule("Bash(git push:*)")];
    assert.equal(deniedBy(deny, "git", ["push", "origin", "main"]).source, "Bash(git push:*)");
    assert.equal(deniedBy(deny, "git", ["status"]), null);
    assert.equal(deniedBy([], "git", ["push"]), null);
});

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

test("buildPosixScript et settleCwd", () => {
    const script = buildPosixScript("echo ok\r\nexit 2");
    assert.match(script, /trap __frst_exit EXIT/);
    assert.ok(!script.includes("\r"));

    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "frst-settle-")));
    try {
        fs.mkdirSync(path.join(root, "src"));
        assert.deepEqual(settleCwd(null, root, root), { cwd: root, note: null });
        assert.equal(settleCwd(path.join(root, "src"), root, root).cwd, path.join(root, "src"));
        const outside = settleCwd(path.dirname(root), path.join(root, "src"), root);
        assert.equal(outside.cwd, root);
        assert.match(outside.note, /hors du projet/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

const realShells = [findShell({ mode: "bash" }), findShell({ mode: "powershell" })].filter(Boolean);

for (const kind of ["posix", "powershell"]) {
    const shell = realShells.find(item => item.kind === kind);
    const lines = kind === "posix"
        ? { cd: "X=bonjour; cd sub && echo \"$X\"", exit: "exit 3", out: "cd .." }
        : { cd: "$X = 'bonjour'; Set-Location sub; Write-Output $X", exit: "exit 3", out: "Set-Location .." };

    test(`runShell réel (${kind})`, { skip: shell ? false : `aucun shell ${kind}`, timeout: 60000 }, async () => {
        const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "frst-shell-test-")));
        try {
            fs.mkdirSync(path.join(root, "sub"));

            const moved = await runShell(lines.cd, { shell, cwd: root, workspace: root, timeoutMs: 30000 });
            assert.equal(moved.exit_code, 0);
            assert.match(moved.output, /bonjour/);
            assert.equal(fs.realpathSync.native(moved.cwd), path.join(root, "sub"));
            assert.equal(moved.cwd_note, null);

            const failed = await runShell(lines.exit, { shell, cwd: root, workspace: root, timeoutMs: 30000 });
            assert.equal(failed.exit_code, 3);

            const outside = await runShell(lines.out, { shell, cwd: root, workspace: root, timeoutMs: 30000 });
            assert.equal(outside.cwd, root);
            assert.match(outside.cwd_note, /hors du projet/);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
}
