/**
 * Barre de titre personnalisée : la fenêtre Electron n'a plus de barre native
 * (titleBarStyle "hidden"), cette bande est donc la zone de déplacement de la fenêtre.
 * Un double-clic dessus agrandit ou restaure la fenêtre (comportement du système).
 * Les boutons système (réduire, agrandir, fermer) sont dessinés par Electron à droite
 * (titleBarOverlay) ; sur macOS, les feux tricolores sont à gauche.
 * Les contrôles ajoutés ici doivent porter la classe « titlebar-control » (zone non déplaçable).
 */
export function TitleBar({ title = "FranceStudent Code", project = null, folder = null, children = null }) {
    return (
        <div className="titlebar" role="banner">
            <span className="titlebar-title">
                {folder ? <span className="titlebar-folder">{folder} — </span> : null}
                <span className="titlebar-app">FranceStudent Code</span>
                {title ? <span className="titlebar-thread"> — {title}</span> : null}
                {project ? <span className="titlebar-project"> · {project}</span> : null}
            </span>
            {children ? <div className="titlebar-controls">{children}</div> : null}
        </div>
    );
}
