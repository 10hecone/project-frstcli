import { percent } from "../lib/format.js";
import { level } from "../lib/usage.js";

/** Jauge horizontale : remplissage par transform (animable sans relayout). */
export function Gauge({ label, value, detail }) {
    const p = percent(value);
    return (
        <div className="gauge">
            <div className="gauge-head">
                <span>{label}</span>
                <span className="gauge-value">{p == null ? "—" : `${Math.round(p)} %`}</span>
            </div>
            <div
                className="gauge-track"
                role="progressbar"
                aria-label={label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={p == null ? undefined : Math.round(p)}
            >
                <span className={`gauge-fill ${level(p)}`} style={{ transform: `scaleX(${(p || 0) / 100})` }} />
            </div>
            {detail ? <div className="gauge-detail">{detail}</div> : null}
        </div>
    );
}
