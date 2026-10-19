import { Box, Text } from "ink";

// Longueur maximale d'une consigne affichée sur une ligne.
export const SUBAGENT_TASK_CHARS = 60;

export const SUBAGENT_LABELS = {
    running: "en cours",
    done: "terminé",
    limit: "limite atteinte",
    cancelled: "annulé",
    error: "erreur"
};

/** Consigne raccourcie sur une ligne. */
export function shortTask(task, max = SUBAGENT_TASK_CHARS) {
    const value = String(task ?? "").replace(/\s+/g, " ").trim();
    return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** true si au moins un sous-agent est à afficher. */
export function subagentsVisible(list) {
    return Array.isArray(list) && list.length > 0;
}

/** Nombre de lignes occupées (titre + une ligne par sous-agent), 0 si masquée. */
export function subagentRows(list) {
    return subagentsVisible(list) ? 1 + list.length : 0;
}

/** Une ligne par sous-agent : consigne courte, nombre de tours et statut. Échap annule. */
export function SubagentList({ subagents, color = true }) {
    if (!subagentsVisible(subagents)) return null;
    const running = subagents.some(item => item && item.status === "running");

    return (
        <Box flexDirection="column">
            <Text>
                <Text bold>Sous-agents</Text>
                <Text color={color ? "gray" : undefined}>
                    {running ? ` (${subagents.length}) · Échap pour annuler` : ` (${subagents.length})`}
                </Text>
            </Text>
            {subagents.map((item, index) => {
                const status = item.status || "running";
                const symbol = status === "running" ? "◐" : status === "done" ? "●" : "✕";
                const tone = status === "running" ? "cyan" : status === "done" ? "green" : "red";
                const label = SUBAGENT_LABELS[status] || String(status);
                return (
                    <Text key={index}>
                        <Text color={color ? tone : undefined}>{`  ${symbol}`}</Text>
                        <Text>{` ${shortTask(item.task)}`}</Text>
                        <Text color={color ? "gray" : undefined}>{` · ${item.turns ?? 0} tour(s) · ${label}`}</Text>
                    </Text>
                );
            })}
        </Box>
    );
}
