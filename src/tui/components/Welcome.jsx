import { Box, Text } from "ink";

/** Ligne « session » de l'accueil, d'après le résultat de session.bootstrap (null si inconnu). */
export function sessionLabel(session) {
    if (!session || !session.kind) return null;
    if (session.kind === "none") return "aucun dossier (chat sans outils, --no-project)";
    if (session.kind === "resumed") return `reprise : ${session.title || "(sans titre)"}`;
    return "nouvelle session";
}

export function Welcome({ version, model, workspace, cwd, session = null, color = true }) {
    const noFolder = Boolean(session && session.kind === "none");
    const directory = noFolder ? "aucun" : workspace || cwd || process.cwd();
    const modelLabel = model == null || model === "" ? "inconnu" : String(model);
    const label = sessionLabel(session);

    return (
        <Box flexDirection="column" borderStyle="round" borderColor={color ? "cyan" : undefined} paddingX={1} marginBottom={1}>
            <Text>
                <Text color={color ? "cyan" : undefined} bold={color}>FranceStudent Code</Text>
                {version ? <Text dimColor={color}>{` v${version}`}</Text> : null}
            </Text>
            <Text> </Text>
            <Text>
                <Text dimColor={color}>Modèle : </Text>
                <Text>{modelLabel}</Text>
            </Text>
            <Text>
                <Text dimColor={color}>Dossier : </Text>
                <Text>{directory}</Text>
            </Text>
            {label ? (
                <Text>
                    <Text dimColor={color}>Session : </Text>
                    <Text>{label}</Text>
                </Text>
            ) : null}
            <Text> </Text>
            <Text dimColor={color}>Astuces : /help pour afficher les commandes · Shift+Tab change de mode.</Text>
        </Box>
    );
}

export default Welcome;
