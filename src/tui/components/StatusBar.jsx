import { Box, Text, useStdout } from "ink";
import { useTerminalColumns, usableWidth } from "./LiveMessage.jsx";

/** Nom du projet : dernier segment du chemin du workspace. */
export function projectName(workspace) {
    if (!workspace) return null;
    const parts = String(workspace).split(/[\\/]+/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : String(workspace);
}

/** Nombre lisible : 950, 1,2 k, 3,4 M. */
export function formatCount(value) {
    const n = Math.max(0, Math.round(Number(value) || 0));
    if (n < 1000) return String(n);
    if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(".", ",")} k`;
    return `${(n / 1_000_000).toFixed(1).replace(".", ",")} M`;
}

/**
 * Tokens de la session d'après api.usage : valeurs réelles si l'API en a fourni,
 * sinon estimation à partir des caractères envoyés (préfixe≈).
 */
export function sessionTokens(usage) {
    if (!usage || !usage.requests) return null;
    if (usage.reported > 0) {
        return { count: (usage.inputTokens || 0) + (usage.outputTokens || 0), estimated: false };
    }
    return { count: Math.round((usage.chars || 0) / 3.5), estimated: true };
}

/**
 * Barre d'état : mode, modèle, projet, auto-approbation, jobs actifs,
 * tokens de la session et branche git (si connue). Composant pur.
 */
export function StatusBar({
    mode = null,
    model = null,
    workspace = null,
    autoApprove = false,
    jobs = 0,
    usage = null,
    branch = null,
    color = true
}) {
    // Hooks avant tout retour anticipé : largeur fixe (colonnes - 1), suivie au redimensionnement.
    const { stdout } = useStdout();
    const width = usableWidth(useTerminalColumns(stdout));

    const parts = [];
    if (mode) parts.push({ key: "mode", text: mode, color: "cyan" });
    if (model) parts.push({ key: "model", text: String(model) });
    const project = projectName(workspace);
    if (project) parts.push({ key: "project", text: project });
    if (branch) parts.push({ key: "branch", text: `⎇ ${branch}` });
    if (autoApprove) parts.push({ key: "auto", text: "auto-approbation", color: "yellow" });
    const activeJobs = Math.max(0, Number(jobs) || 0);
    if (activeJobs > 0) parts.push({ key: "jobs", text: `${activeJobs} job${activeJobs > 1 ? "s" : ""}`, color: "magenta" });
    const tokens = sessionTokens(usage);
    if (tokens) parts.push({ key: "tokens", text: `${tokens.estimated ? "≈ " : ""}${formatCount(tokens.count)} tokens` });

    if (parts.length === 0) return null;

    // Une seule ligne, tronquée si la fenêtre est trop étroite (pas de repli sur plusieurs lignes).
    return (
        <Box width={width}>
            <Text wrap="truncate-end">
                {parts.map((part, index) => (
                    <Text key={part.key} dimColor={!part.color || !color} color={color && part.color ? part.color : undefined}>
                        {`${index > 0 ? " · " : ""}${part.text}`}
                    </Text>
                ))}
            </Text>
        </Box>
    );
}

export default StatusBar;
