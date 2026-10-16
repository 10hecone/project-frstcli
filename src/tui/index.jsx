import { createRequire } from "node:module";
import { render } from "ink";
import { App } from "./app.jsx";

const requireCjs = createRequire(import.meta.url);

export { App };

export async function start() {
    const { setUiBackend } = requireCjs("../src/ui-bridge.js");
    const { createStore } = requireCjs("../src/tui/store.js");
    const { createTuiBackend } = requireCjs("../src/tui/adapter.js");
    const { state } = requireCjs("../src/state.js");
    const session = requireCjs("../src/core/session.js");

    let version = "";
    try {
        version = requireCjs("../package.json").version || "";
    } catch {
    }

    const store = createStore();
    const backend = createTuiBackend(store);
    setUiBackend(backend);

    const instance = render(<App store={store} version={version} cwd={process.cwd()} />, {
        exitOnCtrlC: false
    });

    backend.banner();

    let result;
    try {
        result = await session.bootstrap();
    } catch (error) {
        result = { ok: false, reason: error && error.message ? error.message : String(error) };
    }

    if (!result.ok) {
        backend.error(result.reason);
        process.exitCode = 1;
    } else {
        backend.info(`Modèle : ${state.model}. La saisie arrive à l'étape 6 : utilise frstcli en attendant.`);
    }

    instance.unmount();
    await instance.waitUntilExit();
    setUiBackend(null);
    return result;
}

if (process.env.FRST_TUI_NO_START !== "1") {
    await start();
}
