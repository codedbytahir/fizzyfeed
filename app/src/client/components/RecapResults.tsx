import type { BufferChannel, RecapChannelResult } from "@shared/types";

/**
 * Per-channel queue results (spec 06 §4): ✓ "queued" in electric, ✗ with the
 * server's message and a per-failed-channel retry — never all-or-nothing.
 */
export default function RecapResults({
  results,
  channels,
  busy,
  onRetry,
}: {
  results: RecapChannelResult[];
  channels: BufferChannel[];
  busy: boolean;
  onRetry: (channelId: string) => void;
}) {
  const nameOf = (id: string) => channels.find((c) => c.id === id)?.name;
  return (
    <div className="results" role="status" aria-live="polite">
      {results.map((r) => {
        const name = nameOf(r.channelId) ?? r.service;
        return (
          <div key={r.channelId} className="result-row">
            {r.ok ? (
              <>
                <span className="result-mark result-mark--ok" aria-hidden="true">
                  ✓
                </span>
                <span className="result-name">
                  {r.service} · {name}
                </span>
                <span className="result-ok">queued</span>
              </>
            ) : (
              <>
                <span className="result-mark result-mark--err" aria-hidden="true">
                  ✗
                </span>
                <span className="result-name">
                  {r.service} · {name}
                </span>
                <span className="result-err">{r.error?.message ?? "failed — try again"}</span>
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() => onRetry(r.channelId)}
                  disabled={busy}
                >
                  retry
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
