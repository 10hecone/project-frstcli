const ADD = new Set(["+", "add"]);
const REMOVE = new Set(["-", "remove"]);

function lineClass(type) {
    if (ADD.has(type)) return "add";
    if (REMOVE.has(type)) return "remove";
    if (type === "gap" || type === "more") return "gap";
    return "context";
}

/** Diff produit par buildDiff : { type: "+" | "-" | " " | "gap" | "more", num, text }. */
export function Diff({ lines = [], added = 0, removed = 0 }) {
    return (
        <div className="diff">
            <div className="diff-body">
                {lines.map((line, index) => {
                    const type = line && line.type;
                    const kind = lineClass(type);
                    return (
                        <div key={index} className={`diff-line ${kind}`}>
                            <span className="num">{kind === "gap" || line?.num == null ? "" : line.num}</span>
                            <span className="sign">{kind === "add" ? "+" : kind === "remove" ? "-" : " "}</span>
                            <span className="code-text">{type === "gap" ? "⋮" : String(line?.text ?? "")}</span>
                        </div>
                    );
                })}
            </div>
            <div className="diff-stats">
                <span className="add">+{added}</span> <span className="remove">-{removed}</span>
            </div>
        </div>
    );
}
