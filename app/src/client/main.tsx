import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
// self-hosted fonts (BRAND-GUIDELINES §5: Space Grotesk display / Inter UI / JetBrains Mono stats)
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/500.css";
import App from "./App";
import "./styles/app.css";
import "./styles/cards.css";
import { BRAND_NAME } from "@shared/brand";

document.title = `${BRAND_NAME} — your year in posts`;

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root");

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
