"use strict";

/**
 * Build de l'interface graphique (esbuild) vers dist/gui/ :
 * - renderer.js + renderer.css : React (src/gui/renderer/main.jsx), pour le navigateur ;
 * - preload.js : electron/preload.js empaqueté (le bac à sable interdit les require relatifs) ;
 * - index.html : copié tel quel.
 *
 * Option --prod : minification, sans source maps, React en mode production.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const RENDERER_DIR = path.join(ROOT, "src", "gui", "renderer");
const OUT_DIR = path.join(ROOT, "dist", "gui");

async function buildGui({ prod = false } = {}) {
    const esbuild = require("esbuild");
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const common = { bundle: true, logLevel: "info" };

    await Promise.all([
        esbuild.build({
            ...common,
            entryPoints: [path.join(RENDERER_DIR, "main.jsx")],
            outfile: path.join(OUT_DIR, "renderer.js"),
            format: "iife",
            platform: "browser",
            target: "chrome120",
            jsx: "automatic",
            minify: prod,
            sourcemap: !prod,
            define: { "process.env.NODE_ENV": JSON.stringify(prod ? "production" : "development") }
        }),
        esbuild.build({
            ...common,
            entryPoints: [path.join(ROOT, "electron", "preload.js")],
            outfile: path.join(OUT_DIR, "preload.js"),
            format: "cjs",
            platform: "node",
            target: "node22",
            external: ["electron"]
        })
    ]);

    fs.copyFileSync(path.join(RENDERER_DIR, "index.html"), path.join(OUT_DIR, "index.html"));
}

if (require.main === module) {
    buildGui({ prod: process.argv.includes("--prod") }).catch((error) => {
        console.error(`build:gui a échoué : ${error && error.stack ? error.stack : error}`);
        process.exitCode = 1;
    });
}

module.exports = { buildGui, OUT_DIR };
