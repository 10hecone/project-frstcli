"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const STYLES = path.join(__dirname, "..", "src", "gui", "renderer", "styles");
const read = (name) => fs.readFileSync(path.join(STYLES, name), "utf8");

/** Règles de premier niveau (les @media sont ignorées : on ne lit que les jetons de base). */
function topLevelRules(css) {
    const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [];
    let depth = 0;
    let start = 0;
    let bodyStart = 0;
    let selector = "";
    for (let i = 0; i < source.length; i += 1) {
        if (source[i] === "{") {
            if (depth === 0) {
                selector = source.slice(start, i).trim();
                bodyStart = i + 1;
            }
            depth += 1;
        } else if (source[i] === "}") {
            depth -= 1;
            if (depth === 0) {
                if (!selector.startsWith("@")) rules.push({ selector, body: source.slice(bodyStart, i) });
                start = i + 1;
            }
        }
    }
    return rules;
}

function tokens(body) {
    const out = {};
    for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[match[1]] = match[2].trim();
    return out;
}

function parseColor(value, vars) {
    const text = value.trim();
    const ref = /^var\((--[\w-]+)\)$/.exec(text);
    if (ref) return parseColor(vars[ref[1]], vars);
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
    if (hex) {
        const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
        return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
    }
    const rgb = /^rgba?\(([^)]+)\)$/.exec(text);
    assert.ok(rgb, `couleur illisible : ${value}`);
    const [r, g, b, a = 1] = rgb[1].split(",").map(Number);
    return { r, g, b, a };
}

/** Superpose une couleur (avec alpha) sur un fond opaque. */
function over(top, bottom) {
    const mix = (t, b) => t * top.a + b * (1 - top.a);
    return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

function luminance({ r, g, b }) {
    const channel = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

const rootTokens = {};
for (const file of ["app.css", "sidebar.css"]) {
    for (const rule of topLevelRules(read(file))) {
        if (rule.selector === ":root") Object.assign(rootTokens, tokens(rule.body));
    }
}
const lightRule = topLevelRules(read("sidebar.css")).find((rule) => rule.selector.startsWith('[data-theme="light"]'));
assert.ok(lightRule, "bloc de jetons du thème clair introuvable");

const THEMES = {
    // Pire cas : noir sous la fenêtre, base du fond, puis le halo bleu le plus clair.
    sombre: {
        vars: rootTokens,
        backdrop: (vars) => {
            const base = over(parseColor(vars["--backdrop-base"], vars), { r: 0, g: 0, b: 0, a: 1 });
            return over({ r: 91, g: 140, b: 255, a: 0.28 }, base);
        }
    },
    // Le thème clair n'est pas encore activé : fond d'application clair supposé.
    clair: {
        vars: { ...rootTokens, ...tokens(lightRule.body) },
        backdrop: () => ({ r: 243, g: 244, b: 247, a: 1 })
    }
};

for (const [name, theme] of Object.entries(THEMES)) {
    const { vars } = theme;
    const color = (token) => parseColor(vars[token], vars);
    const backdrop = theme.backdrop(vars);
    const thick = over(color("--glass-thick"), backdrop);
    const rail = over(color("--glass-rail"), backdrop);
    const popover = over(color("--glass-popover"), backdrop);
    const field = over(color("--field"), thick);
    const selection = over(color("--selection"), thick);
    const railSelection = over(color("--selection"), rail);
    const onTop = (token, bg) => over(color(token), bg);

    test(`thème ${name} : textes de la barre latérale lisibles (4,5:1)`, () => {
        for (const token of ["--text", "--text-secondary", "--muted"]) {
            const got = ratio(onTop(token, thick), thick);
            assert.ok(got >= 4.5, `${token} sur la barre latérale : ${got.toFixed(2)}`);
        }
        const placeholder = ratio(onTop("--muted", field), field);
        assert.ok(placeholder >= 4.5, `--muted sur un champ : ${placeholder.toFixed(2)}`);
        const toast = ratio(onTop("--text", popover), popover);
        assert.ok(toast >= 4.5, `--text sur le toast : ${toast.toFixed(2)}`);
    });

    test(`thème ${name} : élément sélectionné lisible (4,5:1)`, () => {
        const got = ratio(onTop("--selection-text", selection), selection);
        assert.ok(got >= 4.5, `texte sélectionné : ${got.toFixed(2)}`);
    });

    test(`thème ${name} : icônes de la barre d'activité et bords visibles (3:1)`, () => {
        const icon = ratio(onTop("--muted", rail), rail);
        assert.ok(icon >= 3, `icône au repos : ${icon.toFixed(2)}`);
        const selected = ratio(onTop("--selection-text", railSelection), railSelection);
        assert.ok(selected >= 3, `icône sélectionnée : ${selected.toFixed(2)}`);
        const edge = ratio(onTop("--control-edge", thick), thick);
        assert.ok(edge >= 3, `bord des contrôles : ${edge.toFixed(2)}`);
    });
}
