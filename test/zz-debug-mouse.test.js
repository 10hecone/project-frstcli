"use strict";

// Diagnostic temporaire (à supprimer) : par quel canal une séquence souris SGR arrive-t-elle ?

const test = require("node:test");

const tick = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));

test("diagnostic canaux stdin souris", async () => {
    const React = await import("react");
    const ink = await import("ink");
    const { render } = await import("ink-testing-library");
    const seen = { keys: [], useInput: [], emitter: [], data: [] };
    function Probe() {
        const ctx = ink.useStdin();
        seen.keys = Object.keys(ctx || {});
        React.useEffect(() => {
            const em = ctx && ctx.internal_eventEmitter;
            const onInput = (chunk) => seen.emitter.push(String(chunk));
            const onData = (chunk) => seen.data.push(String(chunk));
            if (em && em.on) em.on("input", onInput);
            if (ctx && ctx.stdin && ctx.stdin.on) ctx.stdin.on("data", onData);
            return () => {
                if (em && em.off) em.off("input", onInput);
                if (ctx && ctx.stdin && ctx.stdin.off) ctx.stdin.off("data", onData);
            };
        }, [ctx]);
        ink.useInput((input) => {
            seen.useInput.push(String(input));
        });
        return React.createElement(ink.Text, null, "probe");
    }
    const view = render(React.createElement(Probe));
    await tick();
    view.stdin.write("\u001b[<64;10;5M");
    await tick();
    view.stdin.write("\u001b[<65;10;5M");
    await tick();
    view.stdin.write("\u001b[5~");
    await tick();
    console.log("DEBUG-MOUSE " + JSON.stringify(seen));
    view.unmount();
});
