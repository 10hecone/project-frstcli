import { Box, Text, useStdout } from "ink";
import { useTerminalColumns, usableWidth } from "./LiveMessage.jsx";

/** Hauteur de l'en-tête fixe : 2 lignes de texte + bordures haut et bas. */
export const HEADER_ROWS = 4;

/**
 * En-tête fixe du mode plein écran : il reste en haut pendant que la
 * conversation défile en dessous (comme Claude Code).
 */
export function Header({ version, model, workspace, cwd, width }) {
    const { stdout } = useStdout();
    const columns = useTerminalColumns(stdout);
    const directory = workspace || cwd || process.cwd();
    const modelLabel = model == null || model === "" ? "inconnu" : String(model);

    return (
        <Box
            flexDirection="column"
            flexShrink={0}
            borderStyle="round"
            borderColor="cyan"
            paddingX={1}
            width={width ?? usableWidth(columns)}
        >
            <Text wrap="truncate-end">
                <Text color="cyan" bold>FranceStudent Code</Text>
                {version ? <Text dimColor>{` v${version}`}</Text> : null}
                <Text dimColor>{"  ·  Modèle : "}</Text>
                <Text>{modelLabel}</Text>
            </Text>
            <Text wrap="truncate-end" dimColor>{`${directory}  ·  /help  ·  molette ou PgUp/PgDn pour défiler`}</Text>
        </Box>
    );
}

export default Header;
