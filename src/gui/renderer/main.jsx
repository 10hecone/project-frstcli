import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { getClient, withWorkspace } from "./api/client.js";
import "./styles/app.css";
import "./styles/sidebar.css";
import "./styles/titlebar.css";
import "./styles/activity.css";
import "./styles/chat.css";
import "./styles/markdown.css";

// Le client est choisi une seule fois : Electron (window.frst) ou mode hors ligne.
// withWorkspace complète les méthodes d'espace de travail absentes (repli hors ligne).
const client = withWorkspace(getClient());

// Plateforme exposée au CSS (la barre de titre s'adapte : feux tricolores à gauche sur macOS).
document.documentElement.dataset.platform = client.platform || "web";

createRoot(document.getElementById("root")).render(
    <StrictMode>
        <App client={client} />
    </StrictMode>
);
