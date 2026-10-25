# Deploy — Cloudflare Workers (one Worker, one deploy)

The whole product ships as a **single Cloudflare Worker** (spec 01): Hono API +
static SPA assets + D1 + KV + Workers AI + hourly cron. This doc takes a fresh
clone to a live URL.

## 0 · Prereqs

- Node 22+, npm
- A Cloudflare account (Workers paid plan recommended — card rendering is
  CPU-bound; free tier works for demos but throttles PNG renders)
- wrangler: `cd app && npx wrangler login`

## 1 · Create the bindings (once)

```bash
cd app
npx wrangler d1 create fizzyfeed          # → copy database_id
npx wrangler kv namespace create CACHE    # → copy id
```

Paste both ids into `app/wrangler.jsonc` (`REPLACE_WITH_D1_DATABASE_ID`,
`REPLACE_WITH_KV_NAMESPACE_ID`). Update the `vars` too:

| var | value |
|---|---|
| `BUFFER_CLIENT_ID` | your Buffer app client id |
| `BUFFER_REDIRECT_URI` | `https://<your-worker>.workers.dev/api/auth/buffer/callback` |
| `APP_ORIGIN` | `https://<your-worker>.workers.dev` |

Register the same redirect URI on your Buffer OAuth app.

## 2 · Secrets

```bash
npx wrangler secret put BUFFER_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET     # openssl rand -base64 32
npx wrangler secret put TOKEN_AES_KEY      # openssl rand -base64 32
```

Local dev: copy `app/.dev.vars.example` → `app/.dev.vars` (gitignored) and fill
it in. `npm run dev` serves everything on `http://localhost:8787`.

## 3 · First deploy

```bash
npx wrangler d1 migrations apply fizzyfeed --remote
npm run deploy          # typecheck + build + wrangler deploy
```

Verify: `curl https://<your-worker>.workers.dev/api/health` → `{"ok":true,...}`.

## 4 · GitHub Actions (CI/CD)

| workflow | trigger | does |
|---|---|---|
| `ci.yml` | push/PR | agent-check.sh + typecheck + vitest + vite build + wrangler dry-run |
| `deploy.yml` | push to `main` touching `app/**` (or manual) | verify → build → **D1 migrations → wrangler deploy** → health smoke |
| `schedule.yml` | cron `0 4 * * *` daily / `0 5 * * 1` Monday | health ping + weekly keep-warm redeploy |

Required repo secrets (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN` — create at dash.cloudflare.com → My Profile → API
  Tokens → "Edit Cloudflare Workers" template (includes D1/KV edit perms).
- `CLOUDFLARE_ACCOUNT_ID` — dashboard home → right column.

After the first deploy, replace `<fill-your-subdomain>` in
`.github/workflows/deploy.yml` + `schedule.yml` with your real workers.dev
subdomain (or custom domain) so the smoke checks hit the right URL.

Every push to `main` that touches `app/**` lands on hosting automatically —
no manual step. The cron workflow redeploys weekly and pings nightly, so the
hosting can never silently drift or die.

## 5 · Custom domain (optional)

wrangler.jsonc → add:

```jsonc
"routes": [{ "pattern": "app.yourdomain.com", "custom_domain": true }]
```

…then update `BUFFER_REDIRECT_URI` + `APP_ORIGIN` vars (both Cloudflare vars
and the Buffer OAuth app settings) and redeploy.

## 6 · Operational notes

- **Cron**: the Worker's own trigger (`0 * * * *`, hourly) runs the yearize
  sync + proactive token refresh inside the 240 req/day/token ceiling (spec 03).
- **KV is cache-only** — card PNGs + rate counters. Losing it is harmless.
- **D1 is the only durable state.** Back it up:
  `npx wrangler d1 export fizzyfeed --remote --output=backup.sql`.
- Rollback: `npx wrangler rollback` (or redeploy an older commit — CI rebuilds
  deterministically).
