# Spec 02 · Buffer OAuth (PKCE) — connect step

> Status: approved. Prereq: [01-ARCHITECTURE](01-ARCHITECTURE.md). Route file: `app/src/worker/routes/auth.ts`.

## 1 · Flow (authorization code + PKCE, read-only default)

```
Browser                          Worker (/api/auth/buffer/*)                Buffer
  │ GET /api/auth/buffer/login       │                                        │
  │◄──302──────────────────────────►│ create state+verifier (PKCE S256)      │
  │   set cookie fb_oauth (5min)     │ store verifier in D1 (state table or   │
  │                                  │ signed cookie payload)                 │
  │─────────302 authorize_url──────────────────────────────────────────────►│ /oauth2/authorize
  │                                  │                                        │ user consents
  │◄──────────redirect_uri?code=…&state=…───────────────────────────────────│
  │ GET /api/auth/buffer/callback    │                                        │
  │─────────────────────────────────►│ verify state cookie, exchange code      │
  │                                  │──POST /oauth2/token (code_verifier)───►│
  │                                  │◄──{access, refresh, expires, scope}────│
  │                                  │ AES-GCM encrypt → buffer_tokens row    │
  │                                  │ upsert users row, set fizzy_session    │
  │◄──302 /app (deck loading)────────│                                        │
```

Endpoint constants (confirm exact paths against live Buffer docs during Phase 1; keep them
in `app/src/worker/lib/buffer.ts` as the single place):

```
BUFFER_AUTHZ_URL   = https://buffer.com/oauth2/authorize
BUFFER_TOKEN_URL   = https://api.buffer.com/1/oauth2/token.json
BUFFER_API_BASE    = https://api.buffer.com/1
```

## 2 · Scopes

- Default request: read-only profile + channels + posts scopes (minimal set that lists
  channels and reads posts). Record granted scopes in `buffer_tokens.scopes`.
- The write scope (needed only for spec 06 queue) is requested in a **separate upgrade
  consent** at recap time — never bundled into the login scopes.
- If Buffer returns scopes ⊂ requested, store what came back; yearize adapts.

## 3 · State & CSRF

- `state`: 32 random bytes (base64url). Cookie `fb_oauth`: `{state, verifier}` JSON,
  HMAC-signed with `SESSION_SECRET`, `HttpOnly; Secure; SameSite=Lax; Max-Age=300`.
- Callback MUST verify cookie state == query state, single-use (delete on match),
  else `400 invalid_state`. Check `Origin`/redirect exact match against `BUFFER_REDIRECT_URI`.

## 4 · Token lifecycle

| Event | Behavior |
|---|---|
| Stored | AES-GCM (spec 01 §6): fresh 12-byte IV + 16-byte salt per row; AAD = `user_id` |
| Refresh | proactively in the hourly cron if `expires_at < now + 24h`; reactively on 401 from any Buffer call; both paths rotate inside `db.batch()` (tokens + sync_state) |
| Read | decrypt in-memory only; never logged, never cached to KV |
| Logout | delete `fizzy_session` cookie (tokens retained so re-login is instant) |
| Revoke (in-app) | delete `buffer_tokens` + `sync_state` rows; UI shows "disconnected" |
| Buffer-side revoke | link out to Buffer's connected-apps page (we can't revoke remotely v1) |

## 5 · Client endpoints (typed in `shared/types.ts`)

```
GET  /api/auth/buffer/login     → 302 Buffer authorize
GET  /api/auth/buffer/callback  → 302 /app | 400/502 JSON error shape
POST /api/auth/logout           → 204 (clears cookie)
GET  /api/me                    → { id, displayName, avatarUrl, channels[] } | 401
```

## 6 · Acceptance criteria

- [ ] Real Buffer account completes connect → `users` + `buffer_tokens` rows exist, tokens
      encrypted (ciphertext ≠ plaintext anywhere in D1 dump)
- [ ] Replay of a used `code`/`state` fails with 400
- [ ] 401 from Buffer triggers one silent refresh + retry; second failure surfaces error UI
- [ ] Logout clears session; revoke removes token rows (verified by SQL query)
- [ ] No token material in logs (grep worker logs during the test pass)
