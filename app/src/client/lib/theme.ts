/**
 * Theme state: the bootstrap in index.html sets data-theme on <html> before
 * first paint (stored choice -> system preference); this module owns runtime
 * switches. The browser-chrome swatches live as data attributes on the meta
 * tag, so no hex lands in product code (AGENTS.md §1.3).
 */
export type Theme = "light" | "dark";

const KEY = "theme";

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyMeta(t: Theme): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) return;
  const swatch = t === "dark" ? meta.dataset.themeDark : meta.dataset.themeLight;
  if (swatch) meta.setAttribute("content", swatch);
}

export function setTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* storage can be blocked (private mode) — the choice still holds for the session */
  }
  applyMeta(t);
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}
