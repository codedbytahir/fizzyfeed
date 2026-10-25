import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMe } from "../lib/me";

/**
 * Step 1 — connect (T13). Full navigation to the oauth endpoint, never a
 * client route. Already-connected visitors auto-resume into the deck.
 */
export default function Connect() {
  const me = useMe();
  const navigate = useNavigate();

  useEffect(() => {
    if (me.state.status === "ready" && me.state.me.connected) {
      navigate("/app", { replace: true });
    }
  }, [me, navigate]);

  const connectedName =
    me.state.status === "ready" && me.state.me.connected ? me.state.me.displayName : null;

  return (
    <section className="connect">
      <div className="connect__deck" aria-hidden="true">
        <span className="minicard minicard--left" />
        <span className="minicard minicard--center" />
        <span className="minicard minicard--right" />
      </div>
      <p className="overline">the year, carded</p>
      <h1 className="headline headline--xl">your year in posts.</h1>
      <p className="sub connect__sub">
        connect buffer, and 12 months of publishing becomes 7 story cards, an alter ego, and a
        recap queued everywhere — your numbers, honestly drawn.
      </p>
      <div className="connect__cta">
        {connectedName ? (
          <>
            <p className="connect__as">connected as {connectedName}</p>
            <Link className="btn btn--primary" to="/app">
              open your deck
            </Link>
          </>
        ) : (
          <>
            <a className="btn btn--primary" href="/api/auth/buffer/login">
              connect buffer
            </a>
            <p className="connect__micro">
              read-only access — you approve every step on buffer's screen.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
