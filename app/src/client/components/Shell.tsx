import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { useMe } from "../lib/me";
import { BRAND_NAME } from "@shared/brand";
import { currentTheme, toggleTheme, type Theme } from "../lib/theme";
import { IconCards, IconLoop, IconMoon, IconSpark, IconStar, IconSun } from "./icons";

/** Section nav shown once a session is connected — NavLink drives the active state.
 *  The mono index is the product's 5-step flow, carried in the chrome. */
const NAV_LINKS = [
  { to: "/app", label: "deck", idx: "01", end: true, Icon: IconCards },
  { to: "/app/persona", label: "persona", idx: "04", end: false, Icon: IconSpark },
  { to: "/app/recap", label: "recap", idx: "05", end: false, Icon: IconLoop },
  { to: "/app/greatest-hits", label: "greatest hits", idx: "+", end: false, Icon: IconStar },
] as const;

/**
 * App shell (T13): minimal top nav — wordmark left, section links center,
 * session right — content outlet, and the trust-line footer shared by every route.
 */
export default function Shell() {
  const me = useMe();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  // the bootstrap in index.html set data-theme before first paint; mirror it here
  const [theme, setThemeState] = useState<Theme>(() => currentTheme());
  const flipTheme = () => setThemeState(toggleTheme());

  useEffect(() => () => setBusy(false), []);

  // the nav gains weight once the wall scrolls under it
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const disconnect = async () => {
    setBusy(true);
    try {
      await apiFetch<void>("/api/auth/revoke", { method: "POST" });
    } catch {
      // revoke failing must not trap the user — the cookie is cleared on logout anyway
    }
    me.refresh();
    navigate("/");
  };

  const ready = me.state.status === "ready" ? me.state.me : null;
  const needsReconnect = ready?.needsReconnect === true;

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        skip to content
      </a>
      <nav className={scrolled ? "app-nav is-scrolled" : "app-nav"} aria-label="primary">
        <div className="app-nav__inner">
          <Link to="/" className="wordmark" aria-label={`${BRAND_NAME} — home`}>
            <img
              className="wordmark__mark"
              src="/logo/mark-gradient.svg"
              alt=""
              width={26}
              height={26}
            />
            {/* both stocks ship; CSS shows the one the room is lit for (the
              link carries the aria-label, so the imgs stay decorative) */}
            <img
              className="wordmark__text wordmark__text--light"
              src="/logo/wordmark-on-light.svg"
              alt=""
              height={17}
            />
            <img
              className="wordmark__text wordmark__text--dark"
              src="/logo/wordmark-on-dark.svg"
              alt=""
              height={17}
            />
          </Link>
          {ready && (
            <div className="app-nav__links">
              {NAV_LINKS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    ["app-nav__link", isActive ? "app-nav__link--active" : ""]
                      .filter(Boolean)
                      .join(" ")
                  }
                >
                  <span className="app-nav__icon" aria-hidden="true">
                    <item.Icon size={15} />
                  </span>
                  <span className="app-nav__idx" aria-hidden="true">
                    {item.idx}
                  </span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          )}
          <div className="app-nav__user">
            <button
              type="button"
              className="theme-toggle"
              onClick={flipTheme}
              aria-label={theme === "dark" ? "switch to the light theme" : "switch to the dark theme"}
            >
              <span className="theme-toggle__icon" aria-hidden="true">
                {theme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
              </span>
            </button>
            {ready && (
              <>
                {ready.avatarUrl && (
                  <img
                    className="avatar"
                    src={ready.avatarUrl}
                    alt={`${ready.displayName}'s avatar`}
                    width={28}
                    height={28}
                  />
                )}
                <span className="app-nav__name">{ready.displayName}</span>
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() => void disconnect()}
                  disabled={busy}
                >
                  {busy ? "disconnecting…" : "disconnect"}
                </button>
              </>
            )}
          </div>
        </div>
      </nav>
      {needsReconnect && (
        <div className="reconnect-banner" role="status">
          <p className="reconnect-banner__text">
            buffer access expired. your deck and posts are safe; reconnect to keep syncing and
            sharing.
          </p>
          <a className="btn btn--primary reconnect-banner__cta" href="/api/auth/buffer/login">
            reconnect buffer
          </a>
        </div>
      )}
      <main id="main" className="app-main">
        <Outlet />
      </main>
      <footer className="app-footer">
        <p className="app-footer__line">
          <span className="app-footer__fizz" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="app-footer__trust">read-only by default</span>
          <span className="app-footer__trust">tokens encrypted at rest</span>
          <span className="app-footer__trust">you approve before anything publishes</span>
        </p>
      </footer>
    </div>
  );
}
