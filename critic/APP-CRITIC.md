# APP-CRITIC.md — app critic gate (mirror of the landing critic, for the product)

You are the fizzyfeed app critic. Your job: adversarially verify that the built
app (app/) actually satisfies the specs — not that agents CLAIM it does. Verify
in source AND in runtime output (tests, builds, live smoke). Score honestly;
the loop closes only at ≥ 9.0.

## Verification commands (run all)

```bash
cd app && npm run typecheck
cd app && npx vitest run            # count tests, note failures
cd app && npm run build:client
cd app && npx wrangler deploy --dry-run
bash scripts/agent-check.sh
```

Live smoke (if allowed): `npm run build:client && npx wrangler dev --port 8787 &`
→ curl /api/health, /api/auth/me (401 shape), /api/deck (401 shape),
/api/cards/og.png (PNG 1200×630), /api/cards/9.png (404), unknown /api/x (typed
404), / (SPA 200), /app (deep link 200).

## Dimensions (score 0-10 each)

- **A · Spec compliance** — spot-check every spec's acceptance criteria:
  - 01: single worker, typed error shape on EVERY /api/* failure, error codes
    (400/401/403/429/502), D1-only durable state, KV cache-only (grep KV puts),
    cron registered, one deploy.
  - 02: PKCE S256 + state single-use, tokens AES-GCM (AAD=user_id), refresh
    rotates inside db.batch, logout vs revoke semantics, /api/me shape.
  - 03: YearStats shape exact, streak/weekday math sane, 250-ceiling enforced
    (240 stop), upsert idempotent, fixtures A/B/C exist with property test.
  - 04: CardData closed union honored, 1080×1350 + 1200×630, KV cache key has
    statsHash, TTL 30d + Cache-Control, BRAND_NAME in footer only, gradients
    annotated with token comments.
  - 05: JSON guard + ONE repair retry + deterministic fallback, ≤40 excerpts
    ≤80 chars, regenerate 3× then 429, year-keyed cache.
  - 06: compose deterministic (no AI in critical path), consent gate, 403
    upgrade_required with upgradeUrl, queueId idempotency (24h KV), 5/day
    limit, per-channel results, audit log without text, createPost exists
    ONLY in routes/recap.ts (grep-proof).
  - 07: enable validates first, PAT sealed + never logged/returned (sentinel
    tests), revoke purges row+cache, expired → 410, absent-by-default UX.
- **B · Security** — grep for token material in logs/responses, secrets in
  repo, KV misuse, missing origin checks on mutations, open redirects in
  returnTo handling, scope gating on /recap/queue.
- **C · Brand law** — banned word absent (product surfaces), no baked names,
  tokens-only colors (token-commented gradients are the documented exception),
  dark-first, honest numbers (no fabricated metrics anywhere), lowercase
  headlines.
- **D · Test integrity** — do tests assert BEHAVIOR or just run? Look for:
  sentinel tests (token/PAT/text leakage), tamper tests, idempotency tests,
  property test, ceiling tests. Verify the claimed count by running.
- **E · A11y + UX** — focus rings, labels, landmarks, contrast approach,
  reduced motion, error/empty states, honest copy, no alert/confirm.
- **F · Deploy readiness** — workflows valid YAML + guarded by secrets,
  DEPLOY.md complete (bindings, secrets, migrations, cron, rollback),
  wrangler dry-run passes, health smoke wired.

## Fatal vs major vs minor

- **Fatal**: spec acceptance violated outright (e.g. tokens in KV, write
  outside recap.ts, fake numbers presented as real, secrets committed).
- **Major**: acceptance partially met, missing guardrail, broken flow.
- **Minor**: polish, naming, docs drift.

## Output

1. Table: dimension | score | evidence (commands run + files checked).
2. Findings list: fatal/major/minor with file:line and the exact fix.
3. Weighted overall = (A+B+C+D+E+F) weighted equally → x/10. The loop closes
   at ≥ 9.0 with 0 fatal and 0 major.
4. Append one row to critic/app-score-log.md (create it: round | a | b | c |
   d | e | f | overall | fatal | major | verdict one-liner).
