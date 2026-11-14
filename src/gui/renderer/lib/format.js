/** Formats d'affichage partagés par la barre latérale et la barre de chat. */

const toDate = (value) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

/** « à l'instant », « il y a 5 min », « hier », « 12 nov. ». */
export function relativeTime(value, now = Date.now()) {
    const date = toDate(value);
    if (!date) return "";
    const seconds = Math.round((now - date.getTime()) / 1000);
    if (seconds < 60) return "à l’instant";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `il y a ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `il y a ${hours} h`;
    const days = Math.round(hours / 24);
    if (days === 1) return "hier";
    if (days < 7) return `il y a ${days} j`;
    return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/** Date de remise à zéro : « dans 3 h », « demain », « le 20 nov. ». */
export function resetTime(value, now = Date.now()) {
    const date = toDate(value);
    if (!date) return "";
    const minutes = Math.round((date.getTime() - now) / 60000);
    if (minutes <= 0) return "maintenant";
    if (minutes < 60) return `dans ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `dans ${hours} h`;
    if (hours < 48) return "demain";
    return `le ${date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`;
}

/** 1 234 → « 1,2 k », 2 500 000 → « 2,5 M ». */
export function compactNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function percent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, n));
}

export function bytes(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return "—";
    const units = ["o", "Ko", "Mo", "Go"];
    let size = n;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit += 1;
    }
    return `${size.toLocaleString("fr-FR", { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`;
}

/** Libellé lisible d'une limite de débit (type et bucket de UserRateLimitUsageDto). */
export function limitLabel(limit = {}) {
    const names = { chat: "Messages", message: "Messages", image: "Images", file: "Fichiers", agent: "Agents" };
    const periods = { minute: "par minute", hour: "par heure", day: "par jour", week: "par semaine", month: "par mois" };
    const type = String(limit.type || "").toLowerCase();
    const bucket = String(limit.bucket || "").toLowerCase();
    const name = names[type] || limit.type || "Limite";
    const period = periods[bucket] || limit.bucket || "";
    return period ? `${name} ${period}` : name;
}
