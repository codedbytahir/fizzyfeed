import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMe } from "../lib/me";
import { BRAND_NAME } from "@shared/brand";
import Chip from "../components/Chip";

/**
 * Step 1 — connect (T13). Full navigation to the oauth endpoint, never a
 * client route. Already-connected visitors auto-resume into the deck.
 *
 * Gallery entrance: wall text left, the mechanism itself right: seven real
 * story cards fanned on the lit wall. The demo is the hero.
 */

/** The seven chapters in deck order — each fan card is a real deck sheet. */
const FAN_CARDS = [
  { idx: "01", fill: "var(--sheet-pear)" },
  { idx: "02", fill: "var(--sheet-sugar)" },
  { idx: "03", fill: "var(--sheet-mint)" },
  { idx: "04", fill: "var(--sheet-sand)" },
  { idx: "05", fill: "var(--sheet-blue)" },
  { idx: "06", fill: "var(--sheet-kraft)" },
  { idx: "07", fill: "var(--sheet-coral)" },
] as const;

export default function Connect() {
  const me = useMe();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = `${BRAND_NAME} — your year in posts`;
  }, []);

  const ready = me.state.status === "ready" ? me.state.me : null;
  const liveSession = ready !== null && ready.connected && !ready.needsReconnect;

  useEffect(() => {
    if (liveSession) navigate("/app", { replace: true });
  }, [liveSession, navigate]);

  // a live session resumes into the deck; a dead Buffer token gets its own
  // reconnect panel — the session itself is still good (no login loop)
  const reconnecting = ready !== null && ready.needsReconnect;
  const connectedName = liveSession ? ready?.displayName ?? null : null;

  return (
    <section className="connect">
      <div className="connect__copy">
        <h1 className="headline headline--xl">
          your year in <span className="hl">posts.</span>
        </h1>
        <p className="sub connect__sub">
          connect buffer once: we read your publishing history and draw it as 7 story cards. your
          rhythm, your streaks, your mix, an alter ego named by ai. then queue the recap to every
          channel in one click. no dashboards, no fake numbers.
        </p>
        <div className="connect__chips">
          <Chip>read-only</Chip>
          <Chip>encrypted</Chip>
          <Chip>you approve</Chip>
        </div>
        <div className="connect__cta">
          {reconnecting ? (
            <>
              <p className="connect__as">buffer access expired for {ready?.displayName}</p>
              <a className="btn btn--primary" href="/api/auth/buffer/login">
                reconnect buffer
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
                one tap restores the connection. your session and your indexed posts are untouched.
              </p>
            </>
          ) : connectedName ? (
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
                read-only access: you approve every step on buffer&rsquo;s screen.
              </p>
            </>
          )}
        </div>
        <ol className="connect__steps">
          <li>
            <span aria-hidden="true">01</span>
            connect buffer
          </li>
          <li>
            <span aria-hidden="true">02</span>
            we draw the year
          </li>
          <li>
            <span aria-hidden="true">03</span>
            you queue the recap
          </li>
        </ol>
      </div>

      <figure className="connect__stage">
        <div aria-hidden="true" className="deck-fan">
          {FAN_CARDS.map((card) => (
            <span key={card.idx} className="fan-card" style={{ background: card.fill }}>
              <span className="fan-card__idx">{card.idx}</span>
              <span className="fan-card__spark" />
            </span>
          ))}
        </div>
        <figcaption className="connect__plate">
          the deck your year becomes: one card per chapter, hung in the order you lived it
        </figcaption>
      </figure>
    </section>
  );
}
