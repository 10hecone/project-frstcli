import { useSyncExternalStore } from "react";
import { Box, Text } from "ink";
import { Transcript } from "./components/Transcript.jsx";

function useStore(store) {
    return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

export function App({ store, version = "", cwd = process.cwd() }) {
    const current = useStore(store);

    return (
        <Box flexDirection="column">
            <Transcript transcript={current.transcript} version={version} cwd={cwd} />
            {current.live && current.live.text ? <Text>{current.live.text}</Text> : null}
            {current.spinner ? <Text color="cyan">{`… ${current.spinner.label ?? ""}`}</Text> : null}
        </Box>
    );
}

export default App;
