import { useEffect } from "react";
import { render, Text, useApp } from "ink";

// Squelette de l'étape 0 : affiche un texte puis quitte.
function App() {
    const { exit } = useApp();

    useEffect(() => {
        exit();
    }, [exit]);

    return <Text color="cyan">FranceStudent Code (TUI)</Text>;
}

const instance = render(<App />);

await instance.waitUntilExit();
