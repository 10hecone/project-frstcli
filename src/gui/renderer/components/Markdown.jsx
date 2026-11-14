import { useState } from "react";
import { parseMarkdown, safeHref } from "../lib/markdown.js";

/**
 * Rendu Markdown sûr : l'arbre vient de lib/markdown.js et React échappe
 * tout le texte (pas de dangerouslySetInnerHTML). Les liens http(s) et
 * mailto s'ouvrent dans le navigateur (setWindowOpenHandler d'Electron).
 */
export function Markdown({ lines, text }) {
                const blocks = parseMarkdown(lines ?? text ?? "");
                return <Blocks blocks={blocks} />;
}

function Blocks({ blocks }) {
                return blocks.map((block, index) => <Block key={index} block={block} />);
}

function Block({ block }) {
                switch (block.type) {
                                case "heading": {
                                                const Tag = `h${block.level}`;
                                                return (
                                                                <Tag className="md-heading">
                                                                                <Inline nodes={block.children} />
                                                                </Tag>
                                                );
                                }

                                case "paragraph":
                                                return (
                                                                <p className="text">
                                                                                <Inline nodes={block.children} />
                                                                </p>
                                                );

                                case "code":
                                                return <CodeBlock lang={block.lang} text={block.text} open={block.open} />;

                                case "hr":
                                                return <hr className="md-hr" />;

                                case "blockquote":
                                                return (
                                                                <blockquote className="md-quote">
                                                                                <Blocks blocks={block.children} />
                                                                </blockquote>
                                                );

                                case "list": {
                                                const items = block.items.map((item, index) => (
                                                                <li key={index} className={item.checked === null ? undefined : "md-task"}>
                                                                                {item.checked === null ? null : <input type="checkbox" checked={item.checked} readOnly disabled />}
                                                                                <Blocks blocks={item.children} />
                                                                </li>
                                                ));
                                                return block.ordered ? (
                                                                <ol className="md-list" start={block.start !== 1 ? block.start : undefined}>
                                                                                {items}
                                                                </ol>
                                                ) : (
                                                                <ul className="md-list">{items}</ul>
                                                );
                                }

                                case "table":
                                                return (
                                                                <div className="md-table">
                                                                                <table>
                                                                                                <thead>
                                                                                                                <tr>
                                                                                                                                {block.header.map((cell, column) => (
                                                                                                                                                <th key={column} style={block.align[column] ? { textAlign: block.align[column] } : undefined}>
                                                                                                                                                                <Inline nodes={cell} />
                                                                                                                                                </th>
                                                                                                                                ))}
                                                                                                                </tr>
                                                                                                </thead>
                                                                                                <tbody>
                                                                                                                {block.rows.map((row, rowIndex) => (
                                                                                                                                <tr key={rowIndex}>
                                                                                                                                                {row.map((cell, column) => (
                                                                                                                                                                <td key={column} style={block.align[column] ? { textAlign: block.align[column] } : undefined}>
                                                                                                                                                                                <Inline nodes={cell} />
                                                                                                                                                                </td>
                                                                                                                                                ))}
                                                                                                                                </tr>
                                                                                                                ))}
                                                                                                </tbody>
                                                                                </table>
                                                                </div>
                                                );

                                default:
                                                return null;
                }
}

function CodeBlock({ lang, text, open }) {
                const [copied, setCopied] = useState(false);

                const copy = async () => {
                                try {
                                                await navigator.clipboard.writeText(text);
                                                setCopied(true);
                                                setTimeout(() => setCopied(false), 1500);
                                } catch {
                                                setCopied(false);
                                }
                };

                return (
                                <div className={`md-code${open ? " is-open" : ""}`}>
                                                <div className="md-code-bar">
                                                                <span className="md-code-lang">{lang || "texte"}</span>
                                                                <button type="button" className="md-code-copy" onClick={copy} disabled={open}>
                                                                                {copied ? "Copié" : "Copier"}
                                                                </button>
                                                </div>
                                                <pre className="code" data-lang={lang || undefined}>
                                                                <code>{text}</code>
                                                </pre>
                                </div>
                );
}

function Inline({ nodes = [] }) {
                return nodes.map((node, index) => <InlineNode key={index} node={node} />);
}

function InlineNode({ node }) {
                switch (node.type) {
                                case "text":
                                                return node.value;
                                case "br":
                                                return <br />;
                                case "code":
                                                return <code className="md-inline-code">{node.value}</code>;
                                case "strong":
                                                return (
                                                                <strong>
                                                                                <Inline nodes={node.children} />
                                                                </strong>
                                                );
                                case "em":
                                                return (
                                                                <em>
                                                                                <Inline nodes={node.children} />
                                                                </em>
                                                );
                                case "del":
                                                return (
                                                                <del>
                                                                                <Inline nodes={node.children} />
                                                                </del>
                                                );
                                case "link": {
                                                const href = safeHref(node.href);
                                                if (!href) {
                                                                return (
                                                                                <span className="md-link is-local" title={node.href}>
                                                                                                <Inline nodes={node.children} />
                                                                                </span>
                                                                );
                                                }
                                                return (
                                                                <a className="md-link" href={href} target="_blank" rel="noreferrer noopener" title={href}>
                                                                                <Inline nodes={node.children} />
                                                                </a>
                                                );
                                }
                                default:
                                                return null;
                }
}
