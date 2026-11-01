import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMe } from "../lib/me";
import { BRAND_NAME } from "@shared/brand";
import Chip from "../components/Chip";

/**
 * Step 1 — connect (T13). Full navigation to the oauth endpoint, never a
 * client route. Already-connected visitors auto-resume into the deck.
 *
 * Gallery entrance: wall text left, the mechanism itself right — seven real
 * story cards fanned on the lit wall. The demo is the hero.
 */

/** The seven chapters in deck order — gradients are the fixed brand mapping. */
const FAN_CARDS = [
  { idx: "01", gradient: "var(--grad-bolt)" },
  { idx: "02", gradient: "var(--grad-aurora)" },
  { idx: "03", gradient: "var(--grad-fizz)" },
  { idx: "04", gradient: "var(--grad-grape)" },
  { idx: "05", gradient: "var(--grad-sunset)" },
  { idx: "06", gradient: "var(--grad-nebula)" },
  { idx: "07", gradient: "var(--grad-coral)" },
] as const;

export default function Connect() {
  const me = useMe();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = `${BRAND_NAME} — your year in posts`;
  }, []);

  useEffect(() => {
    if (me.state.status === "ready" && me.state.me.connected) {
      navigate("/app", { replace: true });
    }
  }, [me, navigate]);

  const connectedName =
    me.state.status === "ready" && me.state.me.connected ? me.state.me.displayName : null;

  return (
    <section className="connect">
      <div className="connect__copy">
        <h1 className="headline headline--xl">
          your year in <span className="grad-text">posts.</span>
        </h1>
        <p className="sub connect__sub">
          connect buffer, and 12 months of publishing becomes 7 story cards, an alter ego, and a
          recap queued everywhere — your numbers, honestly drawn.
        </p>
        <div className="connect__chips">
          <Chip>read-only</Chip>
          <Chip>encrypted</Chip>
          <Chip>you approve</Chip>
        </div>
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
                <span className="btn__icon" aria-hidden="true">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 18 18"
                    fill="none"
                    focusable="false"
                  >
                    <path
                      d="M7.5 10.5 15.5 2.5M15.5 2.5h-5.6M15.5 2.5v5.6M12.5 10.5v3a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2h3"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </a>
              <p className="connect__micro">
                read-only access — you approve every step on buffer's screen.
              </p>
            </>
          )}
        </div>
        <p className="connect__steps">
          connect <span aria-hidden="true">→</span> we draw the year{" "}
          <span aria-hidden="true">→</span> you queue the recap
        </p>
      </div>

      <div className="connect__stage" aria-hidden="true">
        <div className="deck-fan">
          {FAN_CARDS.map((card) => (
            <span key={card.idx} className="fan-card" style={{ background: card.gradient }}>
              <span className="fan-card__idx">{card.idx}</span>
              <span className="fan-card__spark" />
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
