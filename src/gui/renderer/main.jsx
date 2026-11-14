import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { getClient } from "./api/client.js";
import "./styles/app.css";

// Le client est choisi une seule fois : Electron (window.frst) ou mode hors ligne.
const client = getClient();

createRoot(document.getElementById("root")).render(
    <StrictMode>
        <App client={client} />
    </StrictMode>
);
