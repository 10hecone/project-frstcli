/** Nom lisible du projet rattaché, quelle que soit sa forme (chaîne ou objet). */
export function projectName(project) {
    if (!project) return null;
    if (typeof project === "string") return project;
    return project.name || project.title || null;
}

/** En-tête de la zone principale : titre du chat courant et projet rattaché. */
export function Header({ title = "Nouveau thread", project = null }) {
    const name = projectName(project);
    return (
        <header className="header">
            <h1 className="thread-title" title={title}>
                {title}
            </h1>
            {name ? <span className="chip project-chip">{name}</span> : null}
        </header>
    );
}
