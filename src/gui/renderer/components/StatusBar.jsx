import { baseName } from "../lib/entries.js";

/**
 * Barre d'état : copie de store.status (refreshStatus de l'adaptateur).
 * Le contexte est affiché dans la barre de chat (UsageMeter).
 */
export function StatusBar({ status = {}, phase = "ready" }) {
    return (
        <div className="statusbar">
            <span className={`phase ${phase}`}>
                {phase === "booting" ? "Connexion…" : phase === "failed" ? "Hors session" : status.busy ? "Occupé" : "Prêt"}
            </span>
            {status.mode ? <span>mode {status.mode}</span> : null}
            {status.workspace ? <span title={status.workspace}>{baseName(status.workspace)}</span> : null}
            {status.branch ? <span title="Branche git">⎇ {status.branch}</span> : null}
            {status.jobs > 0 ? <span>{status.jobs} job(s)</span> : null}
        </div>
    );
}
