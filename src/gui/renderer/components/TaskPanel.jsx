const TODO_SYMBOLS = { pending: "○", in_progress: "◐", done: "●" };

/** Liste de tâches (todo_write) et sous-agents (delegate), au-dessus de la saisie. */
export function TaskPanel({ todos = [], subagents = [] }) {
    const showTodos = todos.length > 0 && todos.some((todo) => todo && todo.status !== "done");
    if (!showTodos && subagents.length === 0) return null;

    const done = todos.filter((todo) => todo && todo.status === "done").length;

    return (
        <aside className="tasks">
            {showTodos ? (
                <section>
                    <h3>
                        Tâches{" "}
                        <span className="muted">
                            {done}/{todos.length}
                        </span>
                    </h3>
                    <ul>
                        {todos.map((todo, index) => (
                            <li key={index} className={`todo ${todo.status || "pending"}`}>
                                <span aria-hidden="true">{TODO_SYMBOLS[todo.status] || TODO_SYMBOLS.pending}</span>{" "}
                                {String(todo.content ?? "")}
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}
            {subagents.length > 0 ? (
                <section>
                    <h3>Sous-agents</h3>
                    <ul>
                        {subagents.map((item, index) => (
                            <li key={index} className={`subagent ${item.status || "running"}`}>
                                <span className="badge">{item.status || "running"}</span> {String(item.task ?? "")}
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}
        </aside>
    );
}
