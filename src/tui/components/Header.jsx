import { Box, Text, useStdout } from "ink";
import { useTerminalColumns, usableWidth } from "./LiveMessage.jsx";

/** Hauteur de l'en-tête fixe : 2 lignes de texte + bordures haut et bas. */
export const HEADER_ROWS = 4;

/**
 * En-tête fixe du mode plein écran : il reste en haut pendant que la
 * conversation défile en dessous (comme Claude Code).
 */
export function Header({ version, model, workspace, cwd, width, color = true }) {
    const { stdout } = useStdout();
    const columns = useTerminalColumns(stdout);
    const directory = workspace || cwd || process.cwd();
    const modelLabel = model == null || model === "" ? "inconnu" : String(model);

    return (
        <Box
            flexDirection="column"
            flexShrink={0}
            borderStyle="round"
            borderColor={color ? "cyan" : undefined}
            paddingX={1}
            width={width ?? usableWidth(columns)}
        >
            <Text wrap="truncate-end">
                <Text color={color ? "cyan" : undefined} bold={color}>FranceStudent Code</Text>
                {version ? <Text dimColor={color}>{` v${version}`}</Text> : null}
                <Text dimColor={color}>{"  ·  Modèle : "}</Text>
                <Text>{modelLabel}</Text>
            </Text>
            <Text wrap="truncate-end" dimColor={color}>{`${directory}  ·  /help  ·  molette ou PgUp/PgDn pour défiler`}</Text>
        </Box>
    );
}

export default Header;
