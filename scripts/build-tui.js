"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "src");
const TUI_DIR = path.join(SRC_DIR, "tui");
const ENTRY = path.join(TUI_DIR, "index.jsx");
const OUT_FILE = path.join(ROOT, "dist", "tui.mjs");
const OUT_DIR = path.dirname(OUT_FILE);

// Les modules CommonJS de src/ (hors src/tui) sont chargés par Node viace require,
// pour partager les mêmes singletons (state, mémoire...) que l'ancien CLI.
const BANNER = [
    "import { createRequire as __frstCreateRequire } from \"node:module\";",
    "const require = __frstCreateRequire(import.meta.url);",
].join("\n");

function isInside(dir, file) {
    const rel = path.relative(dir, file);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function resolveFile(base) {
    const candidates = [base, base + ".js", base + ".cjs", path.join(base, "index.js")];
    for (const candidate of candidates) {
        try {
            if (fs.statSync(candidate).isFile()) return candidate;
        } catch {
        }
    }
    return null;
}

// Laisse externes les fichiers CommonJS de src/ hors src/tui : le chemin est réécrit
// relativement à dist/ pour que Node les retrouve depuis dist/tui.mjs.
const externalCommonJsPlugin = {
    name: "frst-external-commonjs",
    setup(build) {
        build.onResolve({ filter: /^\.\.?(?:[\\/]|$)/ }, (args) => {
            if (!args.resolveDir) return undefined;
            const file = resolveFile(path.resolve(args.resolveDir, args.path));
            if (!file || !/\.c?js$/.test(file)) return undefined;
            if (!isInside(SRC_DIR, file) || isInside(TUI_DIR, file)) return undefined;
            let rel = path.relative(OUT_DIR, file).split(path.sep).join("/");
            if (!rel.startsWith(".")) rel = "./" + rel;
            return { path: rel, external: true };
        });
    },
};

async function buildTui() {
    const esbuild = require("esbuild");
    return esbuild.build({
        entryPoints: [ENTRY],
        outfile: OUT_FILE,
        bundle: true,
        format: "esm",
        platform: "node",
        target: "node22",
        jsx: "automatic",
        packages: "external",
        banner: { js: BANNER },
        plugins: [externalCommonJsPlugin],
        logLevel: "info",
    });
}

if (require.main === module) {
    buildTui().catch(() => {
        process.exitCode = 1;
    });
}

module.exports = { buildTui, externalCommonJsPlugin, OUT_FILE };
