import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { useMe } from "../lib/me";
import { BRAND_NAME } from "@shared/brand";

/** Section nav shown once a session is connected — NavLink drives the active state.
 *  The mono index is the product's 5-step flow, carried in the chrome. */
const NAV_LINKS = [
  { to: "/app", label: "deck", idx: "01", end: true },
  { to: "/app/persona", label: "persona", idx: "04", end: false },
  { to: "/app/recap", label: "recap", idx: "05", end: false },
  { to: "/app/greatest-hits", label: "greatest hits", idx: "+", end: false },
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

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        skip to content
      </a>
      <nav className={scrolled ? "app-nav is-scrolled" : "app-nav"} aria-label="primary">
        <div className="app-nav__inner">
          <Link to="/" className="wordmark" aria-label={`${BRAND_NAME} — home`}>
            {BRAND_NAME}
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
                  <span className="app-nav__idx" aria-hidden="true">
                    {item.idx}
                  </span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          )}
          <div className="app-nav__user">
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
          read-only by default · tokens encrypted at rest · you approve before anything
          publishes
        </p>
      </footer>
    </div>
  );
}
