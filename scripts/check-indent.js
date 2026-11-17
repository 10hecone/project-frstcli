"use strict";

// Signale les lignes dont l'indentation n'est pas un multiple de 4 espaces.
// Usage : node scripts/check-indent.js fichier1 fichier2 ...
// Option --set=fichier@ligne-niveau[,ligne-niveau...] : impose un niveau
// d'indentation (en multiples de 4 espaces) aux lignes données.

const fs = require("node:fs");

const args = process.argv.slice(2);
const sets = new Map();

for (const arg of args.filter(a => a.startsWith("--set="))) {
    const [file, ...specs] = arg.slice(6).split("@");
    const pairs = specs.join(":").split(",");
    for (const pair of pairs) {
        const [line, level] = pair.split("-").map(Number);
        if (!sets.has(file)) sets.set(file, new Map());
        sets.get(file).set(line, level);
    }
}

const files = args.filter(a => !a.startsWith("--"));
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
