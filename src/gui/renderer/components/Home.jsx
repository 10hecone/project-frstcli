import { relativeTime } from "../lib/format.js";

/**
 * Écran d'accueil, affiché quand aucun dossier n'est ouvert.
 * - recent : dossiers connus { name, path, branch, lastOpenedAt } (voir src/gui/folders.js) ;
 * - onPick() ouvre le sélecteur natif, onOpen(path) rouvre un dossier récent ;
 * - onContinue() poursuit sans dossier (aucun outil de fichier ne sera utilisable).
 * error : dernier refus ou échec d'ouverture, affiché sous le bouton.
 */
export function Home({ recent = [], error = null, onPick, onOpen, onContinue }) {
    return (
        <section className="home" aria-labelledby="home-title">
            <h1 id="home-title">Choisis un dossier de travail</h1>
            <p className="home-hint">L’assistant lit et modifie les fichiers du dossier que tu ouvres, rien d’autre.</p>
            <button type="button" className="home-open" onClick={onPick}>
                Ouvrir un dossier…
            </button>
            {error ? (
                <p className="home-error" role="alert">
                    {error}
                </p>
            ) : null}
            {recent.length > 0 ? (
                <div className="home-recent">
                    <h2>Récents</h2>
                    <ul>
                        {recent.map((folder) => (
                            <li key={folder.path}>
                                <button type="button" className="home-folder" title={folder.path} onClick={() => onOpen(folder.path)}>
                                    <span className="home-folder-name">{folder.name}</span>
                                    {folder.branch ? <span className="home-folder-branch">{folder.branch}</span> : null}
                                    <span className="home-folder-time">{relativeTime(folder.lastOpenedAt)}</span>
                                    <span className="home-folder-path">{folder.path}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
            <button type="button" className="ghost home-skip" onClick={onContinue}>
                Continuer sans dossier
            </button>
        </section>
    );
}
