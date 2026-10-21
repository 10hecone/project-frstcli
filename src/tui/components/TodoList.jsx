import { Box, Text } from "ink";

// Nombre maximal de tâches affichées ; au-delà, une ligne « + N autres ».
export const TODO_MAX_ROWS = 8;

export const TODO_SYMBOLS = { pending: "○", in_progress: "◐", done: "●" };

/** true si la liste doit être affichée : non vide et pas entièrement terminée. */
export function todosVisible(todos) {
    const list = Array.isArray(todos) ? todos : [];
    return list.length > 0 && list.some(todo => todo && todo.status !== "done");
}

/**
 * Tâches à afficher (TODO_MAX_ROWS au maximum) et nombre de tâches masquées.
 * La tâche en cours reste toujours visible.
 */
export function visibleTodos(todos, max = TODO_MAX_ROWS) {
    const list = Array.isArray(todos) ? todos : [];
    if (list.length <= max) return { items: list, hidden: 0 };
    let start = 0;
    const current = list.findIndex(todo => todo && todo.status === "in_progress");
    if (current >= max) start = Math.min(current - max + 1, list.length - max);
    return { items: list.slice(start, start + max), hidden: list.length - max };
}

/** Nombre de lignes occupées par la liste (titre + tâches + « + N autres »), 0 si masquée. */
export function todoRows(todos) {
    if (!todosVisible(todos)) return 0;
    const { items, hidden } = visibleTodos(todos);
    return 1 + items.length + (hidden > 0 ? 1 : 0);
}

/** Liste de tâches en direct, au-dessus de la saisie : ○ en attente, ◐ en cours, ● terminée. */
export function TodoList({ todos, color = true }) {
    if (!todosVisible(todos)) return null;
    const { items, hidden } = visibleTodos(todos);
    const done = todos.filter(todo => todo && todo.status === "done").length;

    return (
        <Box flexDirection="column">
            <Text>
                <Text bold={color}>Tâches</Text>
                <Text color={color ? "gray" : undefined}>{` (${done}/${todos.length})`}</Text>
            </Text>
            {items.map((todo, index) => {
                const symbol = TODO_SYMBOLS[todo.status] || TODO_SYMBOLS.pending;
                const text = String(todo.content ?? "");
                if (todo.status === "in_progress") {
                    return (
                        <Text key={todo.id ?? index}>
                            <Text color={color ? "cyan" : undefined}>{`  ${symbol}`}</Text>
                            <Text bold={color}>{` ${text}`}</Text>
                        </Text>
                    );
                }
                if (todo.status === "done") {
                    return (
                        <Text key={todo.id ?? index}>
                            <Text color={color ? "green" : undefined}>{`  ${symbol}`}</Text>
                            <Text dimColor={color}>{` ${text}`}</Text>
                        </Text>
                    );
                }
                return (
                    <Text key={todo.id ?? index}>
                        <Text color={color ? "gray" : undefined}>{`  ${symbol}`}</Text>
                        <Text>{` ${text}`}</Text>
                    </Text>
                );
            })}
            {hidden > 0 ? <Text dimColor={color}>{`  + ${hidden} autres`}</Text> : null}
        </Box>
    );
}

export default TodoList;
