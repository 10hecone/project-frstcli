"use strict";

const { requireString, optionalInt } = require("./core/args");
const { runCommand } = require("./command/index");

const runCommandTool = {
    name: "run_command",
    run: runCommand,
    check(args) {
        if (args.command !== undefined) {
            requireString(args.command, "command");
        } else {
            requireString(args.name, "name");
        }
        optionalInt(args.timeout_ms, "timeout_ms");
    },
    describe(a) {
        const command = a.command ?? a.name ?? "?";
        return a.timeout_ms !== undefined
            ? `${command} (délai ${a.timeout_ms} ms)`
            : command;
    }
};

const MODULES = [
    require("./fs/list-directory"),
    require("./fs/read-file"),
    require("./fs/search-files"),
    require("./fs/create-directory"),
    require("./fs/write-file"),
    require("./fs/edit-file"),
    require("./fs/move-path"),
    require("./fs/copy-path"),
    require("./fs/delete-path"),
    require("./fs/remember"),
    runCommandTool
];

const TOOLS = {};
const DESCRIBE = {};

for (const tool of MODULES) {
    TOOLS[tool.name] = { run: tool.run, check: tool.check };
    DESCRIBE[tool.name] = tool.describe;
}

function validateToolCall(action) {
    if (!action || typeof action !== "object") {
        throw new Error("Action d'outil invalide.");
    }

    if (!Object.hasOwn(TOOLS, action.name)) {
        throw new Error(
            `Outil inconnu : ${action.name}. Outils valides : ${Object.keys(TOOLS).join(", ")}.`
        );
    }

    if (!action.args || typeof action.args !== "object" || Array.isArray(action.args)) {
        throw new Error("args doit être un objet.");
    }

    TOOLS[action.name].check(action.args);
}

/** Description lisible de l'action, affichée à côté du nom de l'outil. */
function describeCall(action) {
    const a = action.args || {};

    if (Object.hasOwn(DESCRIBE, action.name)) return DESCRIBE[action.name](a);

    return a.path ?? ".";
}

module.exports = { TOOLS, validateToolCall, describeCall };
