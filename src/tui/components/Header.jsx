import os from "node:os";
import { Box, Text, useStdout } from "ink";
import { useTerminalColumns, usableWidth } from "./LiveMessage.jsx";

/** Hauteur de l'en-tête fixe : 2 lignes de texte + bordures haut et bas. */
export const HEADER_ROWS = 4;

/**
 * Chemin court pour l'en-tête : dossier personnel remplacé par « ~ », et au-delà
 * de 3 segments seuls le premier et le dernier sont gardés (« ~/…/projet »).
 */
export function shortPath(dir, home = os.homedir()) {
    if (!dir) return "";
    let text = String(dir).replace(/\\/g, "/");
    const homeText = home ? String(home).replace(/\\/g, "/").replace(/\/+$/, "") : "";
    if (homeText && (text.toLowerCase() === homeText.toLowerCase() || text.toLowerCase().startsWith(`${homeText.toLowerCase()}/`))) {
        text = `~${text.slice(homeText.length)}`;
    }
    const segments = text.split("/").filter(Boolean);
    if (segments.length <= 3) return text;
    const first = text.startsWith("/") ? `/${segments[0]}` : segments[0];
    return `${first}/…/${segments[segments.length - 1]}`;
}

/**
 * En-tête fixe du mode plein écran : il reste en haut pendant que la
 * conversation défile en dessous (comme Claude Code).
 */
export function Header({ version, model, workspace, cwd, branch = null, width, color = true }) {
    const { stdout } = useStdout();
    const columns = useTerminalColumns(stdout);
    const directory = shortPath(workspace || cwd || process.cwd()) + (branch ? ` (⎇ ${branch})` : "");
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
