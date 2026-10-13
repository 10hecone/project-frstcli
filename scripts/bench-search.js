"use strict";

// Banc de search_files : node scripts/bench-search.js
// Crée 2000 fichiers dans un dossier temporaire, lance la recherche
// 5 fois et affiche la médiane. À lancer avant et après le changement
// (ex. git stash) pour comparer.

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { state } = require("../src/state");
const mod = require("../src/tools/fs/search-files");
const searchFiles = mod.searchFiles || mod.run;

const FILES = 2000;
const DIRS = 20;
const RUNS = 5;
const LINES = 60;

async function setup(root) {
    for (let d = 0; d < DIRS; d++) {
        await fs.mkdir(path.join(root, `dir${d}`), { recursive: true });
    }

    const writes = [];
    for (let i = 0; i < FILES; i++) {
        const lines = [];
        for (let l = 0; l < LINES; l++) {
            lines.push(`const value${l} = compute(${i}, ${l}); // ligne ordinaire`);
        }
        // Le texte cherché n'apparaît que dans 1 fichier sur 100.
        if (i % 100 === 0) lines.push("// MarqueurBanc ici");
        writes.push(fs.writeFile(path.join(root, `dir${i % DIRS}`, `file${i}.js`), lines.join("\n")));
    }
    await Promise.all(writes);
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bench-search-"));
    const previous = state.workspace;

    try {
        await setup(root);
        state.workspace = root;

        // Tour de chauffe (cache disque, JIT).
        await searchFiles({ query: "marqueurbanc" });

        const times = [];
        let last;
        for (let r = 0; r < RUNS; r++) {
            const start = process.hrtime.bigint();
            last = await searchFiles({ query: "marqueurbanc" });
            times.push(Number(process.hrtime.bigint() - start) / 1e6);
        }

        console.log(`Fichiers : ${FILES}, essais : ${RUNS}`);
        console.log(`Temps (ms) : ${times.map(t => t.toFixed(1)).join(", ")}`);
        console.log(`Médiane : ${median(times).toFixed(1)} ms`);
        console.log(`Résultat : ${last.message}`);
    } finally {
        state.workspace = previous;
        await fs.rm(root, { recursive: true, force: true });
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
