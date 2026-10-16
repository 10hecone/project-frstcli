"use strict";

/** Lit le texte du presse-papier du système, ou "" s'il est vide ou illisible. */
function readClipboard() {
    const { execFile } = require("node:child_process");
    const [cmd, args] = process.platform === "win32"
        ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
            "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Clipboard -Raw"]]
        : process.platform === "darwin"
            ? ["pbpaste", []]
            : ["sh", ["-c", "wl-paste --no-newline 2>/dev/null || xclip -selection clipboard -o 2>/dev/null || xsel -b -o"]];
    return new Promise(resolve => {
        execFile(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 10 * 1024 * 1024 },
            (error, stdout) => resolve(error ? "" : String(stdout || "")));
    });
}

module.exports = { readClipboard };
