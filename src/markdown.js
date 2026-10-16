"use strict";

const COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

/* ---------- Markdown léger (ligne par ligne, compatible streaming) ---------- */

const ansi = (code, text, color) =>
    color ? `\x1b[${code}m${text}\x1b[0m` : String(text);

/** Gras **x** et code `x` dans une ligne. */
function renderInline(text, color = COLOR) {
    return String(text)
        .replace(/\*\*(.+?)\*\*/g, (_, t) => ansi("1", t, color))
        .replace(/`([^`\n]+)`/g, (_, t) => ansi("36", t, color));
}

/**
 * Rend une ligne Markdown. state.inCode est mis à jour sur les clôtures ```.
 * Sans couleur (NO_COLOR, sortie non TTY) : aucune séquence ANSI, mais
 * l'indentation des listes et des blocs de code est conservée.
 */
function renderMarkdownLine(line, state = { inCode: false }, { color = COLOR } = {}) {
    const raw = String(line).replace(/\r$/, "");

    if (/^\s*(```|~~~)/.test(raw)) {
        state.inCode = !state.inCode;
        return ansi("90", raw.trim(), color);
    }

    if (state.inCode) return ansi("33", `  ${raw}`, color);

    const heading = raw.match(/^\s*(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
        const title = renderInline(heading[2], false);
        return ansi(heading[1].length <= 2 ? "1;35" : "1;36", title, color);
    }

    const quote = raw.match(/^\s*>\s?(.*)$/);
    if (quote) return ansi("90", `│ ${renderInline(quote[1], false)}`, color);

    const bullet = raw.match(/^(\s*)[-*+]\s+(.*)$/);
    if (bullet) {
        return `  ${bullet[1]}${ansi("36", "•", color)} ${renderInline(bullet[2], color)}`;
    }

    const numbered = raw.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    if (numbered) {
        return `  ${numbered[1]}${ansi("36", `${numbered[2]}.`, color)} ${renderInline(numbered[3], color)}`;
    }

    return renderInline(raw, color);
}

/**
 * Rendu en streaming : les morceaux sont mis en tampon jusqu'à « \n »,
 * chaque ligne complète est rendue ; flush() rend la dernière ligne.
 */
function createMarkdownStream({ color = COLOR, write = s => process.stdout.write(s) } = {}) {
    const mdState = { inCode: false };
    let buffer = "";

    return {
        state: mdState,
        write(chunk) {
            buffer += String(chunk ?? "");
            let i;
            while ((i = buffer.indexOf("\n")) !== -1) {
                const line = buffer.slice(0, i);
                buffer = buffer.slice(i + 1);
                write(`${renderMarkdownLine(line, mdState, { color })}\n`);
            }
        },
        flush() {
            if (buffer) {
                write(renderMarkdownLine(buffer, mdState, { color }));
                buffer = "";
            }
        }
    };
}

function renderMarkdownLite(text, { color = COLOR } = {}) {
    const mdState = { inCode: false };
    return String(text)
        .split("\n")
        .map(line => renderMarkdownLine(line, mdState, { color }))
        .join("\n");
}

module.exports = {
    COLOR,
    renderInline,
    renderMarkdownLine,
    renderMarkdownLite,
    createMarkdownStream
};
