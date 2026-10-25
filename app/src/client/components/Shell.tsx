import { useEffect, useState } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { useMe } from "../lib/me";
import { BRAND_NAME } from "@shared/brand";

/**
 * App shell (T13): minimal top nav — wordmark left, session right —
 * content outlet, and the trust-line footer shared by every route.
 */
export default function Shell() {
  const me = useMe();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  useEffect(() => () => setBusy(false), []);

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
      <nav className="app-nav" aria-label="primary">
        <div className="app-nav__inner">
          <Link to="/" className="wordmark" aria-label={`${BRAND_NAME} — home`}>
            {BRAND_NAME}
          </Link>
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
          read-only by default · tokens encrypted at rest · you approve before anything publishes
        </p>
      </footer>
    </div>
  );
}
