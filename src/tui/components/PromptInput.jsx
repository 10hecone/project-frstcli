import { useRef, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import inputModel from "../input-model.js";
import { useTerminalColumns, usableWidth } from "./LiveMessage.jsx";

const {
    empty,
    fromText,
    toText,
    isEmpty,
    insert,
    newline,
    backspace,
    left,
    right,
    home,
    end,
    up,
    down,
    killToStart,
    killToEnd,
    endsWithContinuation,
    continueLine,
    createHistoryNav,
    historyPrev,
    historyNext,
    completeSlash,
    slashSuggestions
} = inputModel;

/** Commandes slash proposées par Tab (même liste que /help). */
export const SLASH_COMMANDS = [
    "/help", "/project", "/unproject", "/pwd", "/tree", "/read", "/index", "/init", "/plan",
    "/resume", "/undo", "/changes", "/memory", "/remember", "/forget", "/permissions", "/jobs",
    "/auto", "/mode", "/new", "/compact", "/chat-id", "/history", "/messages", "/usage", "/model", "/web",
    "/auth", "/login", "/clear", "/exit", "/quit"
];

const HOME_SEQUENCES = new Set(["\u001b[H", "\u001b[1~", "\u001bOH", "[H", "[1~"]);
const END_SEQUENCES = new Set(["\u001b[F", "\u001b[4~", "\u001bOF", "[F", "[4~"]);
const EXIT_HINT = "Ctrl+C à nouveau pour quitter.";

function appendHistory(entries, text) {
    if (!text.trim() || entries[entries.length - 1] === text) return entries;
    return [...entries, text];
}

function resetNav(nav) {
    return { ...nav, index: nav.entries.length, draft: "" };
}

/**
 * Zone de saisie multiligne.
 * - Entrée envoie. « \ » + Entrée, Ctrl+J ou Alt+Entrée ajoutent une ligne.
 * - ↑/↓ changent de ligne, puis parcourent l'historique. Tab complète les commandes slash.
 * - Échap efface. Ctrl+U/K coupent. Ctrl+L appelle onClear. Ctrl+V colle le presse-papiers.
 * - Ctrl+C appelle onInterrupt(); s'il ne renvoie pas true, la saisie est effacée, et un second appui appelle onExit().
 * - Ctrl+D sur une saisie vide appelle onExit().
 */
export function PromptInput({
    label = "> ",
    secret = false,
    isActive = true,
    history = [],
    commands = SLASH_COMMANDS,
    onSubmit,
    onHistoryAdd,
    onInterrupt,
    onExit,
    onClear,
    clipboard
}) {
    const stateRef = useRef(null);
    if (stateRef.current === null) {
        stateRef.current = { model: empty(), nav: createHistoryNav(history), armed: false, hint: "", sel: 0 };
    }
    const [, setTick] = useState(0);

    const update = (patch) => {
        stateRef.current = { ...stateRef.current, ...patch };
        setTick((tick) => tick + 1);
    };
    const setModel = (model, extra = {}) => update({ model, armed: false, hint: "", sel: 0, picked: false, ...extra });

    // Menu des commandes slash sous la saisie (comme Claude Code) : une seule ligne qui commence par « / ».
    const menuFor = (model) => (secret || model.lines.length > 1 ? [] : slashSuggestions(toText(model), commands));

    const submit = () => {
        const { model, nav } = stateRef.current;
        const text = toText(model);
        const entries = secret ? nav.entries : appendHistory(nav.entries, text);
        setModel(empty(), { nav: createHistoryNav(entries) });
        if (!secret && text.trim() && onHistoryAdd) onHistoryAdd(text);
        if (onSubmit) onSubmit(text);
    };

    const pasteClipboard = () => {
        if (typeof clipboard !== "function") return;
        Promise.resolve()
            .then(() => clipboard())
            .then((text) => {
                if (text) setModel(insert(stateRef.current.model, String(text)));
            })
            .catch(() => update({ hint: "Presse-papiers illisible." }));
    };

    useInput((input, key) => {
        // Séquences souris (molette, clic) : gérées par ConversationView, jamais insérées dans la saisie.
        if (typeof input === "string" && /\[<\d+;\d+;\d+[Mm]/.test(input)) return;
        const { model, nav, armed } = stateRef.current;

        if (key.ctrl && input === "c") {
            const interrupted = onInterrupt ? onInterrupt() === true : false;
            if (interrupted) return setModel(model);
            if (!isEmpty(model)) return update({ model: empty(), nav: resetNav(nav), armed: true, hint: EXIT_HINT });
            if (armed) {
                update({ armed: false, hint: "" });
                if (onExit) onExit();
                return;
            }
            return update({ armed: true, hint: EXIT_HINT });
        }
        if (key.ctrl && input === "d") {
            if (isEmpty(model) && onExit) onExit();
            return;
        }

        // Menu des commandes slash ouvert : ↑/↓ choisissent, Tab complète, Entrée lance la commande choisie.
        // Fermé si le texte est déjà une commande complète (l'historique reste accessible avec ↑/↓).
        const typed = toText(model);
        const menu = commands.includes(typed) ? [] : menuFor(model);
        if (menu.length) {
            const sel = Math.min(stateRef.current.sel || 0, menu.length - 1);
            if (key.upArrow) return update({ sel: (sel - 1 + menu.length) % menu.length });
            if (key.downArrow) return update({ sel: (sel + 1) % menu.length });
            if (key.tab && (menu.length === 1 || sel > 0)) return setModel(fromText(`${menu[sel]} `));
            if (key.return && !key.meta && input !== "\n") {
                setModel(fromText(menu[sel]));
                return submit();
            }
        }

        // Nouvelle ligne : Ctrl+J (LF) ou Alt+Entrée.
        if ((key.ctrl && input === "j") || input === "\n" || (key.meta && key.return)) {
            return setModel(newline(model));
        }
        if (key.return) {
            if (endsWithContinuation(model)) return setModel(continueLine(model));
            return submit();
        }
        if (key.escape) return setModel(empty(), { nav: resetNav(nav) });
        if (key.backspace || key.delete) return setModel(backspace(model));
        if (key.leftArrow) return setModel(left(model));
        if (key.rightArrow) return setModel(right(model));
        if (key.home || (key.ctrl && input === "a") || HOME_SEQUENCES.has(input)) return setModel(home(model));
        if (key.end || (key.ctrl && input === "e") || END_SEQUENCES.has(input)) return setModel(end(model));
        if (key.ctrl && input === "u") return setModel(killToStart(model));
        if (key.ctrl && input === "k") return setModel(killToEnd(model));
        if (key.ctrl && input === "l") {
            if (onClear) onClear();
            return setModel(model);
        }
        if (key.ctrl && input === "v") return pasteClipboard();

        if (key.upArrow) {
            const moved = up(model);
            if (moved) return setModel(moved);
            if (secret) return;
            const step = historyPrev(nav, toText(model));
            if (step) setModel(fromText(step.text), { nav: step.nav });
            return;
        }
        if (key.downArrow) {
            const moved = down(model);
            if (moved) return setModel(moved);
            if (secret) return;
            const step = historyNext(nav);
            if (step) setModel(fromText(step.text), { nav: step.nav });
            return;
        }
        if (key.tab) {
            if (secret || model.lines.length > 1) return;
            const result = completeSlash(toText(model), commands);
            const hint = result.matches.length > 1 ? result.matches.join("  ") : "";
            return setModel(fromText(result.text), { hint });
        }

        // Saisie normale ou collage (le texte collé peut contenir des retours à la ligne).
        if (input && !key.ctrl && !key.meta) return setModel(insert(model, input));
    }, { isActive: Boolean(isActive) });

    // Largeur fixe (colonnes - 1) recalculée au redimensionnement : les bordures ne se replient pas.
    const { stdout } = useStdout();
    const width = usableWidth(useTerminalColumns(stdout));

    const { model, hint } = stateRef.current;
    const pad = " ".repeat(label.length);
    const mask = (text) => (secret ? "•".repeat(text.length) : text);
    const typedNow = toText(model);
    const menu = isActive && !commands.includes(typedNow) ? menuFor(model) : [];
    const selected = Math.min(stateRef.current.sel || 0, Math.max(0, menu.length - 1));

    // Comme Claude Code : une ligne horizontale au-dessus et une en dessous de la zone de saisie,
    // puis le menu des commandes slash qui correspondent aux lettres tapées.
    return (
        <Box flexDirection="column" width={width} marginTop={1}>
        <Box
            flexDirection="column"
            width={width}
            borderStyle="single"
            borderTop
            borderBottom
            borderLeft={false}
            borderRight={false}
            borderDimColor
        >
            {model.lines.map((line, row) => {
                const prefix = row === 0 ? <Text color="cyan" bold>{label}</Text> : <Text>{pad}</Text>;
                if (row !== model.row) return <Text key={row}>{prefix}{mask(line)}</Text>;
                const at = line.slice(model.col, model.col + 1);
                return (
                    <Text key={row}>
                        {prefix}
                        {mask(line.slice(0, model.col))}
                        <Text inverse>{at ? mask(at) : " "}</Text>
                        {mask(line.slice(model.col + 1))}
                    </Text>
                );
            })}
            {hint ? <Text dimColor>{hint}</Text> : null}
        </Box>
        {menu.length ? (
            <Box flexDirection="column" width={width}>
                {menu.map((command, index) => (
                    <Text
                        key={command}
                        wrap="truncate-end"
                        color={index === selected ? "cyan" : undefined}
                        bold={index === selected}
                        dimColor={index !== selected}
                    >
                        {`${index === selected ? "› " : "  "}${command}`}
                    </Text>
                ))}
            </Box>
        ) : null}
        </Box>
    );
}

export default PromptInput;
