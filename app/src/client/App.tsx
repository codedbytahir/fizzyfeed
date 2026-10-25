import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { BRAND_NAME } from "@shared/brand";
import { MeProvider } from "./lib/me";
import Shell from "./components/Shell";
import Connect from "./routes/Connect";
import Deck from "./routes/Deck";
import Persona from "./routes/Persona";
import Recap from "./routes/Recap";
import GreatestHits from "./routes/GreatestHits";

/**
 * SPA shell (spec 01 §2): "/" is the in-app connect screen; /app/* is the
 * 5-step flow inside the shared chrome. Route paths are the contract.
 */
export default function App() {
  return (
    <MeProvider>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<Connect />} />
          <Route path="/app" element={<Deck />} />
          <Route path="/app/persona" element={<Persona />} />
          <Route path="/app/recap" element={<Recap />} />
          <Route path="/app/greatest-hits" element={<GreatestHits />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </MeProvider>
  );
}

function NotFound() {
  useEffect(() => {
    document.title = `${BRAND_NAME} — page not found`;
  }, []);
  return (
    <main className="page">
      <h1 className="headline">page not found</h1>
      <a className="btn btn--primary" href="/">
        back to {BRAND_NAME}
      </a>
    </main>
  );
}
