# Spec 07 · Greatest Hits — opt-in real engagement (honest limits)

> Status: approved. Route file: `app/src/worker/routes/greatestHits.ts`.

## 1 · The honest problem

Buffer's standard OAuth flow does not expose post metrics (likes, clicks, impressions).
We will not fake them. Greatest Hits is an **opt-in** chapter for power users who want
their top posts of the year by real performance, unlocked by pasting a **Buffer personal
access token** (PAT) with metrics-read access.

## 2 · UX contract

- Entry: a clearly-labeled optional card after the deck: "want your real top posts?
  paste a buffer personal access token — used only to read metrics, encrypted, one-click
  revoke." + link to Buffer's token page. Default state: **absent** (not hidden-and-shamed;
  the deck is complete without it).
- Enabled state: card 6.5 "Greatest Hits" (fizz gradient, between Peaks and Alter Ego in
  the web flow only — the shareable deck stays 7 cards).
- Revoke: one button, one click, immediate; card disappears from the flow.

## 3 · Storage & handling

- PAT encrypted AES-GCM exactly like Buffer tokens (spec 01 §6 / 02 §4): per-row IV+salt,
  AAD `user_id`, stored in `metrics_tokens.pat_enc`. Never in KV, never logged, never
  returned to the client (not even masked — the UI shows only "token active since {date}").
- Used exclusively for the metrics read (`GET /post` metrics endpoints) once per
  `POST /api/greatest-hits/refresh` (debounced 10 min) and once during yearize backfill
  when enabled.

## 4 · API

```
POST /api/greatest-hits/enable   { token } → 204 (validates with one cheap read first)
POST /api/greatest-hits/refresh            → { top: [{ postId, excerpt, channel, metric }] } (top 9)
POST /api/greatest-hits/revoke             → 204 (row deleted; cached results purged)
```

Failure modes: invalid token on enable → 400 with link back to Buffer docs; expired on
refresh → 410 + UI returns to "absent" state with a gentle note. Metric semantics
(whichever metric Buffer exposes) are labeled exactly as the API names them — no renaming
"impressions" into "views".

## 5 · Acceptance criteria

- [ ] Enable → validate → store encrypted (ciphertext ≠ plaintext in D1 dump)
- [ ] Refresh returns top posts sorted by the real metric; visible honest label
- [ ] Revoke removes row + cache; subsequent refresh → 410
- [ ] Grepping the worker logs for the PAT yields nothing (test with a sentinel token)
- [ ] Without a PAT, the entire flow works and the deck feels complete (no broken states)
