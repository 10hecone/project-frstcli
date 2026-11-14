import { baseName } from "../lib/entries.js";

/** Barre d'état : copie de store.status (refreshStatus de l'adaptateur). */
export function StatusBar({ status = {}, phase = "ready" }) {
    const context = typeof status.context === "number" ? Math.round(status.context) : null;
    const contextLevel = context == null ? "" : context >= 85 ? "high" : context >= 60 ? "medium" : "low";

    return (
        <div className="statusbar">
            <span className={`phase ${phase}`}>
                {phase === "booting"
                    ? "Connexion…"
                    : phase === "failed"
                      ? "Hors session"
                      : status.busy
                        ? "Occupé"
                        : "Prêt"}
            </span>
            {status.mode ? <span>mode {status.mode}</span> : null}
            {status.workspace ? <span title={status.workspace}>{baseName(status.workspace)}</span> : null}
            {status.autoApprove ? <span className="warn">auto-approbation</span> : null}
            {status.jobs > 0 ? <span>{status.jobs} job(s)</span> : null}
            {context != null ? <span className={`context ${contextLevel}`}>contexte {context} %</span> : null}
        </div>
    );
}
