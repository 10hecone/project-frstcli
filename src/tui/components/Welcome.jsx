import { Box, Text } from "ink";

export function Welcome({ version, model, workspace, cwd, color = true }) {
    const directory = workspace || cwd || process.cwd();
    const modelLabel = model == null || model === "" ? "inconnu" : String(model);

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
            <Text> </Text>
            <Text dimColor={color}>Astuces : /help pour les commandes, frst --classic pour l'ancienne interface.</Text>
        </Box>
    );
}

export default Welcome;
