import { baseName } from "../lib/entries.js";

export function Header({ status = {} }) {
    return (
        <header className="header">
            <div className="brand">
                <span className="logo" aria-hidden="true">
                    FS
                </span>
                <span>FranceStudent Code</span>
            </div>
            <div className="meta">
                {status.workspace ? <span title={status.workspace}>📁 {baseName(status.workspace)}</span> : null}
                {status.model ? <span className="model">{status.model}</span> : null}
            </div>
        </header>
    );
}
