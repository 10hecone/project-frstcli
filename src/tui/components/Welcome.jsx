import { Box, Text } from "ink";

export function Welcome({ version, model, workspace, cwd }) {
    const directory = workspace || cwd || process.cwd();
    const modelLabel = model == null || model === "" ? "inconnu" : String(model);

    return (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
            <Text>
                <Text color="cyan" bold>FranceStudent Code</Text>
                {version ? <Text dimColor>{` v${version}`}</Text> : null}
            </Text>
            <Text> </Text>
            <Text>
                <Text dimColor>Modèle : </Text>
                <Text>{modelLabel}</Text>
            </Text>
            <Text>
                <Text dimColor>Dossier : </Text>
                <Text>{directory}</Text>
            </Text>
            <Text> </Text>
            <Text dimColor>Astuces : /help pour les commandes, frst --classic pour l'ancienne interface.</Text>
        </Box>
    );
}

export default Welcome;
