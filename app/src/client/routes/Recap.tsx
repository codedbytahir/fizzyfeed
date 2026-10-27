import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { RecapChannelResult, RecapPreview, RecapQueueResult } from "@shared/types";
import {
  newQueueId,
  postJson,
  toFailure,
  useApi,
  type ApiFailure,
} from "../lib/api";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import Loading from "../components/Loading";
import ChannelPicker from "../components/ChannelPicker";
import RecapResults from "../components/RecapResults";
import { BRAND_NAME } from "@shared/brand";

const LIMIT = 500;

function withReturnTo(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}returnTo=/app/recap`;
}

/** Step 5 — the only write in the product (spec 06 §2): preview, edit, consent by click. */
export default function Recap() {
  const preview = useApi<RecapPreview>("/api/recap/preview");

  useEffect(() => {
    document.title = `${BRAND_NAME} — queue the recap`;
  }, []);

  const [text, setText] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<RecapChannelResult[] | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const hydratedRef = useRef(false);

  // hydrate once from the server-composed draft; edits then live in state only
  useEffect(() => {
    if (preview.data && !hydratedRef.current) {
      hydratedRef.current = true;
      setText(preview.data.text.slice(0, LIMIT));
      setChecked(new Set(preview.data.channels.map((c) => c.id)));
    }
  }, [preview.data]);

  const order = new Map((preview.data?.channels ?? []).map((c, i) => [c.id, i]));
  const merge = (next: RecapChannelResult[]): RecapChannelResult[] => {
    const map = new Map((results ?? []).map((r) => [r.channelId, r]));
    for (const r of next) map.set(r.channelId, r);
    return [...map.values()].sort(
      (a, b) => (order.get(a.channelId) ?? 99) - (order.get(b.channelId) ?? 99)
    );
  };

  // every submit is a distinct intent → fresh idempotency key (critic r1,
  // major-2): a retry after partial failure targets only the failed channels,
  // so re-execution can't double-post, and the fresh key never replays a
  // stored failure. The key still guards network-level retries of this attempt.
  const submit = async (channelIds: string[]) => {
    if (text === null || channelIds.length === 0 || pending) return;
    setPending(true);
    setFailure(null);
    try {
      const res = await postJson<RecapQueueResult>("/api/recap/queue", {
        text,
        channelIds,
        consent: true,
        queueId: newQueueId(),
      });
      setResults(merge(res.results));
    } catch (err: unknown) {
      setFailure(toFailure(err));
    } finally {
      setPending(false);
    }
  };

  const toggle = (id: string, on: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  if (preview.loading) {
    return (
      <div className="route route--narrow">
        <Loading label="composing your recap…" />
      </div>
    );
  }
  if (preview.error && !preview.data) {
    return (
      <div className="route route--narrow">
        <ErrorState error={preview.error} onRetry={preview.reload} />
        <p>
          <Link className="linkbtn" to="/app">
            ← your deck
          </Link>
        </p>
      </div>
    );
  }

  const data = preview.data;
  if (!data || text === null) return null;

  const needsUpgrade = data.needsWriteScope || failure?.code === "upgrade_required";
  const upgradeHref = withReturnTo(failure?.upgradeUrl ?? "/api/auth/buffer/upgrade");
  const allQueued = results !== null && results.every((r) => r.ok);

  return (
    <div className="route route--narrow">
      <header className="deck-head">
        <p className="overline">step 05 — the recap</p>
        <h1 className="headline headline--lg">queue the recap</h1>
        <p className="sub">
          one post, every channel. edit the text if you like — your words go out as written.
        </p>
      </header>

      <label className="field-label" htmlFor="recap-text">
        recap text
      </label>
      <textarea
        id="recap-text"
        className="textarea"
        value={text}
        maxLength={LIMIT}
        rows={7}
        aria-label="recap text"
        aria-describedby="recap-charcount"
        onChange={(e) => setText(e.target.value.slice(0, LIMIT))}
      />
      <div className="charcount-row">
        <span
          id="recap-charcount"
          className={text.length > LIMIT - 20 ? "charcount charcount--warn" : "charcount"}
        >
          {text.length} / {LIMIT}
        </span>
        <span className="charcount-hint">enforced here and again on the server.</span>
      </div>

      {data.channels.length === 0 ? (
        <EmptyState
          title="no channels connected"
          body="the recap queues everywhere you publish — connect a channel on buffer first."
          action={
            <Link className="btn btn--ghost" to="/app">
              ← your deck
            </Link>
          }
        />
      ) : (
        <ChannelPicker channels={data.channels} checked={checked} onChange={toggle} />
      )}

      {needsUpgrade && (
        <div className="notice">
          <p>
            this needs write access — you'll approve it on buffer's screen. your edited text is
            kept right here, nothing is lost.
          </p>
        </div>
      )}
      {failure && failure.code !== "upgrade_required" && (
        <p className="inline-note" role="alert">
          {failure.message}
        </p>
      )}

      <div className="recap-actions">
        {needsUpgrade ? (
          <a className="btn btn--primary" href={upgradeHref}>
            upgrade on buffer
          </a>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            disabled={pending || checked.size === 0 || text.length === 0 || text.length > LIMIT}
            onClick={() => void submit([...checked])}
          >
            {pending ? "queuing…" : "queue the recap"}
          </button>
        )}
        <span className="recap-consent">
          the click is the consent — nothing publishes without it.
        </span>
      </div>

      {results && (
        <div className="recap-done">
          {allQueued && <h2 className="headline headline--sm">queued — check your buffer dashboard.</h2>}
          <RecapResults
            results={results}
            channels={data.channels}
            busy={pending}
            onRetry={(id) => void submit([id])}
          />
          <a className="linkbtn" href="https://buffer.com/app" target="_blank" rel="noopener noreferrer">
            open buffer dashboard
          </a>
        </div>
      )}
    </div>
  );
}
