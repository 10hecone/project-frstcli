/**
 * Analyseur Markdown (sous-ensemble GFM) sans dépendance ni HTML brut :
 * il produit un arbre que components/Markdown.jsx rend avec React, donc
 * tout le texte est échappé. Pensé pour le streaming : un bloc de code
 * non fermé reste un bloc de code (open: true).
 *
 * Blocs : heading, paragraph, code, list (puces, numéros, cases à cocher),
 * blockquote, table, hr.
 * En ligne : code, strong, em, del, link (texte, <url> et URL nues), br.
 */

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING_RE = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/;
const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE_RE = /^ {0,3}>[ ]?(.*)$/;
const LIST_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const TASK_RE = /^\[([ xX])\][ \t]+(.*)$/;
const TABLE_SEP_RE = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const WORD_RE = /[\p{L}\p{N}]/u;

/** Largeur d'indentation (tabulation = 4). */
function indentOf(line) {
                let width = 0;
                for (const ch of line) {
                                if (ch === " ") width += 1;
                                else if (ch === "\t") width += 4;
                                else break;
                }
                return width;
}

/** Retire jusqu'à `count` colonnes d'indentation. */
function dedent(line, count) {
                let index = 0;
                let width = 0;
                while (index < line.length && width < count) {
                                if (line[index] === " ") width += 1;
                                else if (line[index] === "\t") width += 4;
                                else break;
                                index++;
                }
                return line.slice(index);
}

function isBlank(line) {
                return !line || !line.trim();
}

function isFenceClose(line, marker) {
                const trimmed = line.trim();
                return trimmed.length >= marker.length && trimmed === marker[0].repeat(trimmed.length);
}

function isTableStart(lines, index) {
                return index + 1 < lines.length && lines[index].includes("|") && TABLE_SEP_RE.test(lines[index + 1]) && lines[index + 1].includes("-");
}

/** Une ligne qui ouvre un autre bloc interrompt un paragraphe. */
function startsBlock(lines, index) {
                const line = lines[index];
                return (
                                FENCE_RE.test(line) ||
                                HEADING_RE.test(line) ||
                                HR_RE.test(line) ||
                                QUOTE_RE.test(line) ||
                                LIST_RE.test(line) ||
                                isTableStart(lines, index)
                );
}

/** Découpe une ligne de tableau en cellules (les \| restent du texte). */
export function splitRow(line) {
                let text = line.trim();
                if (text.startsWith("|")) text = text.slice(1);
                if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
                const cells = [];
                let current = "";
                let inCode = false;
                for (let index = 0; index < text.length; index++) {
                                const ch = text[index];
                                if (ch === "\\" && text[index + 1] === "|") {
                                                current += "|";
                                                index++;
                                } else if (ch === "`") {
                                                inCode = !inCode;
                                                current += ch;
                                } else if (ch === "|" && !inCode) {
                                                cells.push(current.trim());
                                                current = "";
                                } else {
                                                current += ch;
                                }
                }
                cells.push(current.trim());
                return cells;
}

function alignOf(cell) {
                const left = cell.startsWith(":");
                const right = cell.endsWith(":");
                if (left && right) return "center";
                if (right) return "right";
                if (left) return "left";
                return null;
}

function parseList(lines, start) {
                const first = LIST_RE.exec(lines[start]);
                const base = indentOf(first[1]);
                const ordered = /\d/.test(first[2]);
                const list = { type: "list", ordered, start: ordered ? parseInt(first[2], 10) : 1, items: [] };
                let index = start;

                while (index < lines.length) {
                                const match = LIST_RE.exec(lines[index]);
                                if (!match || indentOf(match[1]) !== base || /\d/.test(match[2]) !== ordered) break;
                                const contentIndent = base + match[2].length + 1;
                                const body = [match[3] || ""];
                                index++;

                                while (index < lines.length) {
                                                const line = lines[index];
                                                if (isBlank(line)) {
                                                                let next = index + 1;
                                                                while (next < lines.length && isBlank(lines[next])) next++;
                                                                if (next < lines.length && indentOf(lines[next]) > base) {
                                                                                for (; index < next; index++) body.push("");
                                                                                continue;
                                                                }
                                                                break;
                                                }
                                                const indent = indentOf(line);
                                                if (indent > base) {
                                                                body.push(dedent(line, contentIndent));
                                                                index++;
                                                                continue;
                                                }
                                                // Continuation paresseuse d'un paragraphe (ligne non indentée).
                                                if (!isBlank(body[body.length - 1]) && !startsBlock(lines, index)) {
                                                                body.push(line.trim());
                                                                index++;
                                                                continue;
                                                }
                                                break;
                                }

                                let checked = null;
                                const task = TASK_RE.exec(body[0]);
                                if (task) {
                                                checked = task[1] !== " ";
                                                body[0] = task[2];
                                }
                                list.items.push({ checked, children: parseBlocks(body) });

                                // Une ligne vide entre deux éléments du même niveau.
                                if (index < lines.length && isBlank(lines[index])) {
                                                let next = index;
                                                while (next < lines.length && isBlank(lines[next])) next++;
                                                const again = next < lines.length ? LIST_RE.exec(lines[next]) : null;
                                                if (again && indentOf(again[1]) === base && /\d/.test(again[2]) === ordered) index = next;
                                }
                }
                return { block: list, next: index };
}

/** Analyse des lignes en blocs. */
export function parseBlocks(lines = []) {
                const blocks = [];
                let index = 0;

                while (index < lines.length) {
                                const line = String(lines[index] ?? "");
                                if (isBlank(line)) {
                                                index++;
                                                continue;
                                }

                                const fence = FENCE_RE.exec(line);
                                if (fence) {
                                                const marker = fence[1];
                                                const body = [];
                                                let closed = false;
                                                const indent = indentOf(line);
                                                index++;
                                                while (index < lines.length) {
                                                                const current = String(lines[index] ?? "");
                                                                if (isFenceClose(current, marker)) {
                                                                                closed = true;
                                                                                index++;
                                                                                break;
                                                                }
                                                                body.push(dedent(current, indent));
                                                                index++;
                                                }
                                                blocks.push({ type: "code", lang: fence[2] || "", text: body.join("\n"), open: !closed });
                                                continue;
                                }

                                const heading = HEADING_RE.exec(line);
                                if (heading) {
                                                blocks.push({ type: "heading", level: heading[1].length, children: parseInline(heading[2] || "") });
                                                index++;
                                                continue;
                                }

                                if (HR_RE.test(line)) {
                                                blocks.push({ type: "hr" });
                                                index++;
                                                continue;
                                }

                                if (QUOTE_RE.test(line)) {
                                                const body = [];
                                                while (index < lines.length) {
                                                                const quote = QUOTE_RE.exec(String(lines[index] ?? ""));
                                                                if (!quote) break;
                                                                body.push(quote[1]);
                                                                index++;
                                                }
                                                blocks.push({ type: "blockquote", children: parseBlocks(body) });
                                                continue;
                                }

                                if (LIST_RE.test(line) && LIST_RE.exec(line)[3] !== undefined) {
                                                const { block, next } = parseList(lines.map((item) => String(item ?? "")), index);
                                                blocks.push(block);
                                                index = next;
                                                continue;
                                }

                                if (isTableStart(lines, index)) {
                                                const header = splitRow(line);
                                                const align = splitRow(lines[index + 1]).map(alignOf);
                                                const rows = [];
                                                index += 2;
                                                while (index < lines.length && !isBlank(lines[index]) && String(lines[index]).includes("|")) {
                                                                const cells = splitRow(String(lines[index]));
                                                                rows.push(header.map((_, column) => parseInline(cells[column] || "")));
                                                                index++;
                                                }
                                                blocks.push({ type: "table", align: header.map((_, column) => align[column] || null), header: header.map((cell) => parseInline(cell)), rows });
                                                continue;
                                }

                                const body = [line.trim()];
                                index++;
                                while (index < lines.length && !isBlank(lines[index]) && !startsBlock(lines, index)) {
                                                body.push(String(lines[index]).trim());
                                                index++;
                                }
                                blocks.push({ type: "paragraph", children: parseInline(body.join("\n")) });
                }
                return blocks;
}

/** Point d'entrée : texte ou tableau de lignes. */
export function parseMarkdown(source) {
                const lines = Array.isArray(source) ? source.map((line) => String(line ?? "")) : String(source ?? "").split(/\r?\n/);
                return parseBlocks(lines.map((line) => line.replace(/\r$/, "")));
}

function skipCode(text, index) {
                let run = 1;
                while (text[index + run] === "`") run++;
                const end = text.indexOf("`".repeat(run), index + run);
                return end === -1 ? index + run : end + run;
}

function emphasis(text, start, ch, run) {
                if (ch === "~" ? run !== 2 : run > 3) return null;
                const next = text[start + run];
                if (!next || /\s/.test(next)) return null;
                if (ch === "_" && start > 0 && WORD_RE.test(text[start - 1])) return null;
                let index = start + run;
                while (index < text.length) {
                                const current = text[index];
                                if (current === "\\") {
                                                index += 2;
                                                continue;
                                }
                                if (current === "`") {
                                                index = skipCode(text, index);
                                                continue;
                                }
                                if (current === ch) {
                                                let length = 1;
                                                while (text[index + length] === ch) length++;
                                                const after = text[index + length];
                                                const closes = length === run && !/\s/.test(text[index - 1]) && !(ch === "_" && after && WORD_RE.test(after));
                                                if (closes) {
                                                                const children = parseInline(text.slice(start + run, index));
                                                                let node;
                                                                if (ch === "~") node = { type: "del", children };
                                                                else if (run === 1) node = { type: "em", children };
                                                                else if (run === 2) node = { type: "strong", children };
                                                                else node = { type: "strong", children: [{ type: "em", children }] };
                                                                return { node, end: index + length };
                                                }
                                                index += length;
                                                continue;
                                }
                                index++;
                }
                return null;
}

/** [texte](url "titre") à partir du crochet ouvrant. */
function matchLink(text, start) {
                let depth = 0;
                let index = start;
                for (; index < text.length; index++) {
                                const ch = text[index];
                                if (ch === "\\") {
                                                index++;
                                } else if (ch === "[") {
                                                depth++;
                                } else if (ch === "]") {
                                                depth--;
                                                if (depth === 0) break;
                                }
                }
                if (depth !== 0 || text[index + 1] !== "(") return null;
                const label = text.slice(start + 1, index);
                let parens = 0;
                let end = index + 2;
                for (; end < text.length; end++) {
                                const ch = text[end];
                                if (ch === "(") parens++;
                                else if (ch === ")") {
                                                if (parens === 0) break;
                                                parens--;
                                }
                }
                if (end >= text.length) return null;
                const target = text.slice(index + 2, end).trim();
                const href = target.replace(/\s+(["'(]).*$/, "").replace(/^<(.*)>$/, "$1");
                if (!href) return null;
                return { label, href, end: end + 1 };
}

const ESCAPABLE = "\\`*_{}[]()#+-.!|~>";
const BARE_URL_RE = /^https?:\/\/[^\s<]*[^\s<.,;:!?)\]'"]/;

/** Analyse en ligne : renvoie une liste de nœuds. */
export function parseInline(text = "") {
                const nodes = [];
                let buffer = "";
                const flush = () => {
                                if (buffer) nodes.push({ type: "text", value: buffer });
                                buffer = "";
                };

                let index = 0;
                while (index < text.length) {
                                const ch = text[index];

                                if (ch === "\\" && index + 1 < text.length && ESCAPABLE.includes(text[index + 1])) {
                                                buffer += text[index + 1];
                                                index += 2;
                                                continue;
                                }

                                if (ch === "\n") {
                                                buffer = buffer.replace(/[ \t]+$/, "");
                                                flush();
                                                nodes.push({ type: "br" });
                                                index++;
                                                continue;
                                }

                                if (ch === "`") {
                                                let run = 1;
                                                while (text[index + run] === "`") run++;
                                                const end = text.indexOf("`".repeat(run), index + run);
                                                if (end !== -1) {
                                                                let value = text.slice(index + run, end).replace(/\n/g, " ");
                                                                if (value.length > 2 && value.startsWith(" ") && value.endsWith(" ")) value = value.slice(1, -1);
                                                                flush();
                                                                nodes.push({ type: "code", value });
                                                                index = end + run;
                                                                continue;
                                                }
                                                buffer += "`".repeat(run);
                                                index += run;
                                                continue;
                                }

                                if (ch === "[" || (ch === "!" && text[index + 1] === "[")) {
                                                const image = ch === "!";
                                                const link = matchLink(text, image ? index + 1 : index);
                                                if (link) {
                                                                flush();
                                                                const children = image ? [{ type: "text", value: link.label || link.href }] : parseInline(link.label);
                                                                nodes.push({ type: "link", href: link.href, image, children });
                                                                index = link.end;
                                                                continue;
                                                }
                                }

                                if (ch === "<") {
                                                const auto = /^<((?:https?:\/\/|mailto:)[^\s>]+)>/i.exec(text.slice(index));
                                                if (auto) {
                                                                flush();
                                                                nodes.push({ type: "link", href: auto[1], children: [{ type: "text", value: auto[1].replace(/^mailto:/i, "") }] });
                                                                index += auto[0].length;
                                                                continue;
                                                }
                                }

                                if (ch === "h" && (index === 0 || /[\s(]/.test(text[index - 1]))) {
                                                const bare = BARE_URL_RE.exec(text.slice(index));
                                                if (bare) {
                                                                flush();
                                                                nodes.push({ type: "link", href: bare[0], children: [{ type: "text", value: bare[0] }] });
                                                                index += bare[0].length;
                                                                continue;
                                                }
                                }

                                if (ch === "*" || ch === "_" || ch === "~") {
                                                let run = 1;
                                                while (text[index + run] === ch) run++;
                                                const found = emphasis(text, index, ch, run);
                                                if (found) {
                                                                flush();
                                                                nodes.push(found.node);
                                                                index = found.end;
                                                                continue;
                                                }
                                                buffer += ch.repeat(run);
                                                index += run;
                                                continue;
                                }

                                buffer += ch;
                                index++;
                }
                flush();
                return nodes;
}

/** Seuls http(s) et mailto deviennent des liens cliquables. */
export function safeHref(href) {
                const value = String(href ?? "").trim();
                return /^(https?:\/\/|mailto:)/i.test(value) ? value : null;
}

/** Texte brut d'une liste de nœuds (titres, tests). */
export function plainText(nodes = []) {
                return nodes
                                .map((node) => {
                                                if (node.type === "text" || node.type === "code") return node.value;
                                                if (node.type === "br") return "\n";
                                                return plainText(node.children || []);
                                })
                                .join("");
}
