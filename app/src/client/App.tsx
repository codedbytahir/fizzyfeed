import { Routes, Route } from "react-router-dom";
import { BRAND_NAME } from "@shared/brand";
import Connect from "./routes/Connect";
import Deck from "./routes/Deck";
import Persona from "./routes/Persona";
import Recap from "./routes/Recap";
import GreatestHits from "./routes/GreatestHits";

/**
 * SPA shell (spec 01 §2): "/" is the in-app CTA; /app/* is the 5-step flow.
 * Route bodies are filled by the client task; contracts come from shared/types.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Connect />} />
      <Route path="/app" element={<Deck />} />
      <Route path="/app/persona" element={<Persona />} />
      <Route path="/app/recap" element={<Recap />} />
      <Route path="/app/greatest-hits" element={<GreatestHits />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function NotFound() {
  return (
    <main className="page">
      <h1 className="headline">page not found</h1>
      <a className="btn btn--primary" href="/">
        back to {BRAND_NAME}
      </a>
    </main>
  );
}
