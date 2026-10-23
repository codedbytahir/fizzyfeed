# Spec 01 · Architecture — single Worker, one deploy

> Status: approved. Derived from IDEA.md "Under the hood" + contest constraints (17-day build, $5/mo Cloudflare plan).

## 1 · System shape

```
┌─────────────────────────── Cloudflare Worker (single deploy) ───────────────────────────┐
│  Static Assets (Vite-built React SPA)          Hono API (/api/*)                        │
│  ─ landing + app shell, dark-first             ─ auth: /api/auth/buffer/*               │
│                                                ─ data: /api/yearize /api/deck /api/cards│
│  Cron Triggers (hourly yearize fetches)        ─ ai: /api/persona /api/recap/*          │
│  ─ polling within 250 req/day/token            ─ opt-in: /api/greatest-hits/*           │
│                                                                                          │
│  Bindings: D1 (state) · KV (cache only) · Workers AI · Static Assets · Secrets           │
└──────────────────────────────────────────────────────────────────────────────────────┘
        │ HTTPS                                     │
        ▼                                           ▼
  Buffer API (OAuth2 PKCE, GET/POST /post)     Workers AI (llama-3.3-70b, 3.1-8b)
```

Rules: one Worker, one log, one deploy. No SSR framework — the SPA is static; the API is
Hono. OAuth state lives in signed cookies + D1, **never** in eventually-consistent KV.
KV caches AI output and rendered-card PNGs only.

## 2 · Repository scaffold (build this exactly)

```
app/
  package.json            # single package; scripts: dev, build, deploy, typecheck, test
  wrangler.jsonc          # worker + assets + d1 + kv + ai + cron bindings
  vite.config.ts          # React SPA build → dist/client (served as static assets)
  tsconfig.json           # strict: true, noUncheckedIndexedAccess: true
  vitest.config.ts
  public/                 # favicon.svg, icons (copied from logo/png at build)
  migrations/0001_init.sql
  src/
    shared/               # types + constants shared by client & worker
      brand.ts            # export const BRAND_NAME = "fizzyfeed" (single rename point)
      types.ts            # Deck, CardData, Persona, RecapDraft, BufferChannel…
      schema.ts           # D1 row types mirroring migrations
    client/
      main.tsx, App.tsx   # SPA shell; react-router: / → landing CTA, /app flow
      routes/Connect.tsx  # step 1
      routes/Deck.tsx     # step 3 (cards grid + share)
      routes/Persona.tsx  # step 4
      routes/Recap.tsx    # step 5 (preview + queue)
      routes/GreatestHits.tsx
      components/         # CardSurface, Yearline, StatCounter, Button…
      styles/tokens.css   # imported from repo root tokens.css (single source)
    worker/
      index.ts            # Hono app mount + assets fallback
      routes/auth.ts      # spec 02
      routes/yearize.ts   # spec 03
      routes/deck.ts      # specs 03+04 (aggregates + card slugs)
      routes/cards.ts     # spec 04 (PNG render, KV cache)
      routes/persona.ts   # spec 05
      routes/recap.ts     # spec 06
      routes/greatestHits.ts # spec 07
      lib/crypto.ts       # AES-GCM encrypt/decrypt (spec 02 §5)
      lib/buffer.ts       # Buffer API client (typed)
      lib/session.ts      # signed session cookie helpers
      cron/yearize.ts     # scheduled handler
```

Non-goals: monorepo tooling, SSR, edge-side component rendering.

## 3 · D1 schema (migrations/0001_init.sql)

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,                      -- nanoid
  buffer_id TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,              -- unix seconds
  updated_at INTEGER NOT NULL
);

CREATE TABLE buffer_tokens (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_enc BLOB NOT NULL,                 -- AES-GCM ciphertext
  refresh_enc BLOB NOT NULL,
  iv BLOB NOT NULL, salt BLOB NOT NULL,     -- per-row random
  expires_at INTEGER NOT NULL,
  scopes TEXT NOT NULL,
  rotated_at INTEGER NOT NULL
);

CREATE TABLE posts (
  id TEXT PRIMARY KEY,                      -- buffer post id
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  channel_service TEXT NOT NULL,            -- 'twitter','instagram',...
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,              -- published time (unix)
  year INTEGER NOT NULL, month INTEGER NOT NULL, dow INTEGER NOT NULL, hour INTEGER NOT NULL
);
CREATE INDEX idx_posts_user_time ON posts(user_id, created_at);
CREATE UNIQUE INDEX idx_posts_unique ON posts(id, user_id);

CREATE TABLE sync_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  backfill_done INTEGER NOT NULL DEFAULT 0, -- 12-month initial fetch complete
  last_polled_at INTEGER NOT NULL DEFAULT 0,
  poll_cursor TEXT
);

CREATE TABLE metrics_tokens (               -- Greatest Hits opt-in (spec 07)
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pat_enc BLOB NOT NULL, iv BLOB NOT NULL, salt BLOB NOT NULL,
  created_at INTEGER NOT NULL, revoked_at INTEGER
);

CREATE TABLE ai_cache (                     -- persona output (KV holds card PNGs only)
  user_id TEXT NOT NULL, kind TEXT NOT NULL, -- 'persona' | 'recap'
  year INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, year)
);
```

## 4 · Wrangler bindings & environment

| Binding | Kind | Key/name | Content policy |
|---|---|---|---|
| `DB` | D1 | `fizzyfeed` | tables above — the only durable state |
| `CACHE` | KV | `FIZZY_CACHE` | `card:{userId}:{year}:{slug}` PNGs, `ai:{userId}:{year}` — cache only |
| `AI` | Workers AI | — | llama-3.3-70b (persona), 3.1-8b (card copy lines) |
| `ASSETS` | Static Assets | `dist/client` | SPA + landing |
| vars | — | `BUFFER_CLIENT_ID`, `BUFFER_REDIRECT_URI`, `APP_ORIGIN` | non-secret |
| secrets | — | `BUFFER_CLIENT_SECRET`, `SESSION_SECRET`, `TOKEN_AES_KEY` | via `wrangler secret put`; local: `.dev.vars` (gitignored) |

Cron: `"triggers": { "crons": ["0 * * * *"] }` → hourly yearize fetch, respecting the
250 req/day/token ceiling (spec 03 §4).

## 5 · Cross-cutting contracts

- **Sessions**: `fizzy_session` cookie — `userId.expiry.hmac` (HMAC-SHA256, `SESSION_SECRET`),
  `HttpOnly; Secure; SameSite=Lax; Path=/`, 30d sliding. Logout deletes cookie; "revoke"
  additionally deletes `buffer_tokens` row.
- **Error shape**: every `/api/*` failure returns `{ "error": { "code": string, "message": string } }`
  with proper status (400 malformed, 401 no session, 403 scope, 429 rate limit, 502 upstream).
- **Client data contract**: `GET /api/deck` returns typed `Deck` from `src/shared/types.ts`
  — the single source of truth for card data (spec 04 §2).
- **Logging**: never log tokens, PATs, or full post text (truncate to 64 chars in logs).

## 6 · Security model (summary — details in specs 02/07)

1. Buffer access/refresh tokens: AES-GCM per-row random IV+salt, key from `TOKEN_AES_KEY`
   (32-byte base64 secret), rotated inside `db.batch()` on refresh.
2. Read-only by default; the only write is the recap queue (spec 06) with consent flag.
3. CSRF: same-site cookie + `Origin` check on mutating routes; OAuth state: httpOnly
   short-lived signed cookie.
4. Rate limits: per-user debounce on yearize/persona/recap endpoints (KV counters, 60s).
5. No PII beyond Buffer profile name/avatar; posts text stored only for the yearized year.

## 7 · Acceptance criteria (architecture)

- [ ] `npm run dev` boots SPA + `/api/health` on one origin
- [ ] `npm run typecheck` (strict) and `npm test` (vitest) pass in CI
- [ ] D1 migrations apply clean on fresh local + remote
- [ ] One `npm run deploy` ships worker + assets together
- [ ] agent-check.sh passes (no banned word, no name baking, no raw hex in src/)
