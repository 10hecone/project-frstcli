import { useEffect, useState } from "react";

/**
 * Panneau Paramètres : préférences de ~/.francestudent-cli/settings.json.
 * Chaque changement est enregistré aussitôt (validé par le processus principal).
 * Un champ fixé par une variable d'environnement est affiché mais verrouillé.
 * Le chemin du shell et les règles allow/deny sont en lecture seule (à changer dans le fichier).
 */
export function SettingsPanel({ settings, disabled, disabledReason, onSave, onOpenFile }) {
    const [pending, setPending] = useState(null);
    const [error, setError] = useState(null);
    const data = settings && settings.data;
    const fields = data && Array.isArray(data.fields) ? data.fields : [];
    const readonly = (data && data.readonly) || { shellPath: "", allow: [], deny: [] };

    const save = async (key, value) => {
        setPending(key);
        setError(null);
        const result = await onSave({ [key]: value });
        setPending(null);
        if (result && result.ok === false) setError(result.reason || "Enregistrement impossible.");
    };

    return (
        <div className="panel settings-panel">
            {settings && settings.error ? <p className="panel-error">{settings.error}</p> : null}
            {data && data.error ? <p className="panel-error">{data.error}</p> : null}
            {error ? (
                <p className="panel-error" role="alert">
                    {error}
                </p>
            ) : null}
            {settings && settings.loading && !data ? <p className="panel-empty">Chargement…</p> : null}

            <ul className="settings-list">
                {fields.map((field) => (
                    <SettingRow
                        key={field.key}
                        field={field}
                        disabled={disabled || pending === field.key || Boolean(field.locked)}
                        title={field.locked ? `Fixé par la variable d'environnement ${field.locked}` : disabledReason}
                        onSave={(value) => save(field.key, value)}
                    />
                ))}
            </ul>

            {data ? (
                <section className="settings-readonly" aria-label="Réglages en lecture seule">
                    <h3>Dans le fichier seulement</h3>
                    <dl>
                        <dt>Chemin du shell</dt>
                        <dd>{readonly.shellPath || "détection automatique"}</dd>
                        <dt>Commandes autorisées</dt>
                        <dd>{readonly.allow.length ? readonly.allow.join(", ") : "aucune"}</dd>
                        <dt>Commandes interdites</dt>
                        <dd>{readonly.deny.length ? readonly.deny.join(", ") : "aucune"}</dd>
                    </dl>
                    <button type="button" className="secondary" onClick={onOpenFile} title={data.file || undefined}>
                        Ouvrir settings.json
                    </button>
                </section>
            ) : null}
        </div>
    );
}

function SettingRow({ field, disabled, title, onSave }) {
    const id = `setting-${field.key}`;
    const isDefault = field.value === field.default;
    return (
        <li className={"setting" + (field.locked ? " locked" : "")}>
            <div className="setting-text">
                <label htmlFor={id} className="setting-label">
                    {field.label}
                </label>
                {field.hint ? <span className="setting-hint">{field.hint}</span> : null}
                {field.locked ? <span className="setting-hint">Fixé par {field.locked}.</span> : null}
            </div>
            <div className="setting-control">
                <SettingInput id={id} field={field} disabled={disabled} title={title} onSave={onSave} />
                {field.saved && !isDefault && !field.locked ? (
                    <button
                        type="button"
                        className="secondary setting-reset"
                        disabled={disabled}
                        title={`Revenir à la valeur par défaut (${String(field.default)})`}
                        onClick={() => onSave(null)}
                    >
                        Défaut
                    </button>
                ) : null}
            </div>
        </li>
    );
}

function SettingInput({ id, field, disabled, title, onSave }) {
    if (field.type === "bool") {
        return (
            <button
                id={id}
                type="button"
                role="switch"
                aria-checked={Boolean(field.value)}
                className="switch"
                disabled={disabled}
                title={title}
                onClick={() => onSave(!field.value)}
            >
                <span className="knob" />
            </button>
        );
    }
    if (field.type === "select") {
        const options = Array.isArray(field.options) ? field.options : [];
        const known = options.some((option) => String(option.value) === String(field.value));
        return (
            <select
                id={id}
                value={String(field.value)}
                disabled={disabled}
                title={title}
                onChange={(event) => {
                    const option = options.find((item) => String(item.value) === event.target.value);
                    if (option) onSave(option.value);
                }}
            >
                {known ? null : <option value={String(field.value)}>{String(field.value)}</option>}
                {options.map((option) => (
                    <option key={String(option.value)} value={String(option.value)}>
                        {option.label}
                    </option>
                ))}
            </select>
        );
    }
    return <NumberInput id={id} field={field} disabled={disabled} title={title} onSave={onSave} />;
}

/** Nombre : enregistré à la sortie du champ ou avec Entrée, seulement s'il a changé. */
function NumberInput({ id, field, disabled, title, onSave }) {
    const [text, setText] = useState(String(field.value));
    useEffect(() => setText(String(field.value)), [field.value]);

    const commit = () => {
        if (text.trim() === String(field.value)) return;
        const n = Number(text);
        if (text.trim() === "" || !Number.isInteger(n)) {
            setText(String(field.value));
            return;
        }
        onSave(n);
    };

    return (
        <input
            id={id}
            type="number"
            inputMode="numeric"
            min={field.min ?? undefined}
            max={field.max ?? undefined}
            step="1"
            value={text}
            disabled={disabled}
            title={title}
            onChange={(event) => setText(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
                if (event.key === "Enter") commit();
                if (event.key === "Escape") setText(String(field.value));
            }}
        />
    );
}
