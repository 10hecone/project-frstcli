"use strict";

// Signale les lignes dont l'indentation n'est pas un multiple de 4 espaces.
// Usage : node scripts/check-indent.js fichier1 fichier2 ...
// Option --set=fichier@ligne-niveau[,ligne-niveau...] : impose un niveau
// d'indentation (en multiples de 4 espaces) aux lignes données.

const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const sets = new Map();

for (const arg of args.filter(a => a.startsWith("--set="))) {
    // Chaque élément peut répéter le fichier : « a.js@3-1,a.js@7-2 » vaut « a.js@3-1,7-2 ».
    let file = null;
    for (const item of arg.slice(6).split(",")) {
        const at = item.lastIndexOf("@");
        if (at >= 0) file = item.slice(0, at);
        const [line, level] = item.slice(at + 1).split("-").map(Number);
        if (!file || !Number.isInteger(line) || !Number.isInteger(level)) {
            console.error(`Option --set invalide : ${item}`);
            process.exit(2);
        }
        if (!sets.has(file)) sets.set(file, new Map());
        sets.get(file).set(line, level);
    }
}

// Sans fichier ni --set : tout le code de src, test et scripts (avant, rien n'était vérifié).
function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.(c|m)?jsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

const named = args.filter(a => !a.startsWith("--"));
const files = named.length || sets.size ? named : ["src", "test", "scripts"].flatMap(dir => walk(dir));
let bad = 0;

for (const file of new Set([...files, ...sets.keys()])) {
    const text = fs.readFileSync(file, "utf8");
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const fixes = sets.get(file);
    const lines = text.split(/\r?\n/).map((line, i) => {
        const level = fixes?.get(i + 1);
        if (level === undefined) return line;
        return " ".repeat(level * 4) + line.trimStart();
    });

    if (fixes) fs.writeFileSync(file, lines.join(eol), "utf8");

    lines.forEach((line, i) => {
        const n = line.match(/^ */)[0].length;
        // Les lignes « * » des commentaires JSDoc ont un espace de plus.
        if (n % 4 === 0 || !line.trim() || /^\s*\*/.test(line)) return;
        bad++;
        console.log(`${file}:${i + 1}: [${n}] ${line.trim()}`);
    });
}

console.log(`${bad} ligne(s) mal indentée(s).`);
process.exitCode = bad ? 1 : 0;
