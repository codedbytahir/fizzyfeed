# Spec 06 · One-click recap — compose + queue (the only write)

> Status: approved. Route file: `app/src/worker/routes/recap.ts`. This is the product's
> **single Buffer write** and the feature that makes fizzyfeed a tool, not a toy.

## 1 · Compose

Recap text is assembled **deterministically from YearStats** (no AI in the critical path —
honest and testable), then optionally polished by the 8b model only for the closing line:

```
Template (≤ 500 chars, channel-agnostic):

"12 months of posting, carded:
5,214 posts · 389,102 words · 141-day streak
best hour: 11pm · biggest month: october
this year's alter ego: the midnight archivist
queue your year → {app origin}"
```

Rules: numbers come verbatim from `YearStats`; sentence case; the banned word never
appears; the persona line only renders when a persona exists; no engagement claims.

## 2 · Consent flow (strict)

1. `GET /api/recap/preview` → `{ text, channels: [{id, service, name}], needsWriteScope }`
2. UI shows the exact text, the exact channels, and a checkbox-free primary button
   **"queue the recap"** + a secondary "edit text" (client-side edit allowed, ≤ 500 chars
   still enforced server-side).
3. If `needsWriteScope`: run the OAuth upgrade consent (spec 02 §2) — request the write
   scope alone, user approves on Buffer's screen.
4. `POST /api/recap/queue` with body `{ text, channelIds[], consent: true }` →
   verifies session + write scope + `consent === true` → for each channel: Buffer
   `POST /post` (scheduled: next free slot per channel, or `top` if user picks "now").

## 3 · Queue semantics

| Concern | Behavior |
|---|---|
| Partial failure | per-channel results returned; UI marks each ✓/✗ with retry button; no all-or-nothing |
| Idempotency | client-generated `queueId` (uuid) sent along; worker keeps 24h KV set `recap:{queueId}` → duplicate POST returns the first result instead of double-posting |
| Rate limit | 5 queue operations/user/day (KV counter) |
| Audit | `console.log` stores only `queueId`, user, channel count — never text (privacy) |

## 4 · Response

```json
{ "queueId": "…", "results": [ { "channelId": "…", "service": "twitter", "ok": true, "postId": "…" },
                                { "channelId": "…", "service": "instagram", "ok": false, "error": { "code": "upstream", "message": "…" } } ] }
```

## 5 · Acceptance criteria

- [ ] Demo account: recap queued to 2+ channels, visible in the Buffer dashboard, text
      matches preview exactly
- [ ] Without write scope, `POST /api/recap/queue` → 403 with `upgrade` hint, and UI runs
     the upgrade consent smoothly (no data loss of edited text)
- [ ] Double-submit with same `queueId` doesn't double-post (KV idempotency verified)
- [ ] Edited text (user-modified) is respected verbatim; server rejects > 500 chars
- [ ] The only Buffer write in the entire codebase is inside `routes/recap.ts` (grep-proof)
