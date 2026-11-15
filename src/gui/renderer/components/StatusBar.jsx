import { baseName } from "../lib/entries.js";
import { modeLabel, nextPermissionMode } from "../lib/folders.js";

/**
 * Barre d'état : copie de store.status (refreshStatus de l'adaptateur).
 * Le contexte est affiché dans la barre de chat (UsageMeter).
 */
export function StatusBar({ status = {}, phase = "ready", onSetMode }) {
    const next = nextPermissionMode(status.mode);
    return (
        <div className="statusbar">
            <span className={`phase ${phase}`}>
                {phase === "booting" ? "Connexion…" : phase === "failed" ? "Hors session" : status.busy ? "Occupé" : "Prêt"}
            </span>
            {status.mode ? (
                <button
                    type="button"
                    className="statusbar-mode"
                    disabled={!onSetMode}
                    title={`Mode de permission : ${modeLabel(status.mode)}. Passer en « ${modeLabel(next)} » (Maj+Tab)`}
                    onClick={() => onSetMode(next)}
                >
                    mode {modeLabel(status.mode)}
                </button>
            ) : null}
            {status.workspace ? <span title={status.workspace}>{baseName(status.workspace)}</span> : null}
            {status.branch ? <span title="Branche git">⎇ {status.branch}</span> : null}
            {status.jobs > 0 ? <span>{status.jobs} job(s)</span> : null}
        </div>
    );
}
