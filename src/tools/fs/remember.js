"use strict";

const { ui } = require("../../ui-bridge");
const memory = require("../../project/memory");
const { requireString } = require("../core/args");
const { denied } = require("../core/fs-utils");

async function rememberTool(args = {}) {
    const note = requireString(args.note, "note").trim().slice(0, memory.LIMITS.noteChars);

    ui.result(`Note : ${note}`);

    if (!(await ui.confirm("Enregistrer cette note dans la mémoire du projet ?"))) {
        return denied(".");
    }

    memory.addNote(note);
    await memory.save();

    return { changed: true, message: "Note enregistrée." };
}

const short = (value, max) => {
    const text = String(value ?? "").replace(/\s+/g, " ");
    return text.length > max ? `${text.slice(0, max)}...` : text;
};

function check(args) {
    requireString(args.note, "note");
}

function describe(a) {
    return `"${short(a.note, 60)}"`;
}

module.exports = { name: "remember", run: rememberTool, check, describe };
