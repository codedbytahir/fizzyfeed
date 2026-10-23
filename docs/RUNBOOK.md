# RUNBOOK — local dev, preview, deploy

## Landing page (static, no build)

```bash
cd /path/to/fizzyfeed
npx serve landing/            # or: python3 -m http.server -d landing 8080
# open http://localhost:8080
# individual animations: landing/animations/fx-0*/index.html (each is standalone)
```

## Brand board

Open `preview/index.html` in any browser — logo variants, clearspace, palette, card
gradients, type specimen, usage do/don'ts.

## App (once `app/` is scaffolded per docs/specs/01)

```bash
cd app
npm install
cp .dev.vars.example .dev.vars       # fill BUFFER_CLIENT_ID/SECRET, SESSION_SECRET, TOKEN_AES_KEY
npx wrangler d1 create fizzyfeed     # once; paste database_id into wrangler.jsonc
npx wrangler d1 migrations apply fizzyfeed --local
npm run dev                          # vite + wrangler dev on one origin
npm run typecheck && npm test
npm run deploy                       # workers builds (push-to-deploy in CI)
```

### Secrets

| Secret | Generate |
|---|---|
| `TOKEN_AES_KEY` | `openssl rand -base64 32` |
| `SESSION_SECRET` | `openssl rand -base64 32` |
| `BUFFER_CLIENT_SECRET` | Buffer developer console |

`.dev.vars` is gitignored — never commit it. Rotate by `wrangler secret put`; token rows
re-encrypt lazily on next refresh (AAD is `user_id`, key versioning unnecessary at v1 scale).

## Agent guardrails

```bash
bash scripts/agent-check.sh     # run before every commit; CI runs it too
```

## Useful queries while developing

```bash
npx wrangler d1 execute fizzyfeed --local --command "SELECT COUNT(*) FROM posts"
npx wrangler kv key get --binding CACHE "card:demo:2026:card3-ab12cd34" | wc -c
npx wrangler tail                # live worker logs (tokens/PATs never appear — by design)
```
