import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
// self-hosted Chillax (tokens.css @font-face serves /fonts/chillax-*.woff2) —
// one face carries display and body; no third family
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
