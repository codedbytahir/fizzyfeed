# Spec 08 · Build plan — phases, acceptance gates, demo checklist

> Timeline: build window **Oct 28 → Nov 13** (Buffer Commit 2026). Specs 00–07 define the
> what; this defines the when and the done-gates. Tasks are tracked in
> [`tasks/TASKS.json`](../../tasks/TASKS.json) — agents claim from there, not from this file.

## Phase 0 — scaffold (day 1) → gate: "it runs"

| Task | Output |
|---|---|
| Scaffold `app/` per spec 01 §2 (Vite + React + Hono + wrangler) | `npm run dev` serves SPA + `/api/health` |
| Import `tokens.css` (root) into client; wire `BRAND_NAME` const | one rename point proven by grep |
| CI: typecheck + vitest + `scripts/agent-check.sh` | green on main |

**Gate**: fresh clone → `npm i && npm run dev` works in < 5 min; agent-check passes.

## Phase 1 — OAuth + tokens (days 2–4) → gate: "connected"

Spec 02. OAuth PKCE round-trip with a real Buffer account; AES-GCM token store; session
cookie; logout + revoke; error shapes.

**Gate**: D1 dump shows ciphertext only; replayed state fails; silent refresh works.
Demo beat: "connected in one click — and here's proof we can't read your tokens."

## Phase 2 — yearize + deck (days 5–9) → gate: "the deck exists"

Spec 03 (sync + aggregates + fixtures) then spec 04 (satori PNG pipeline + KV cache).
UI: connect → loading → 7-card deck grid; card share links work.

**Gate**: real account backfills within ceiling; deck renders 7 cards < 60s from OAuth;
fixtures A/B/C pass; PNGs legible + cached.
Demo beat: "your year, drawn — no fake numbers anywhere."

## Phase 3 — persona + recap queue (days 10–13) → gate: "it's a tool"

Spec 05 (persona naming + cache + regenerate) then spec 06 (deterministic compose,
consent, write-scope upgrade, queue with idempotency).

**Gate**: persona origin references card stats; recap queued to 2+ channels and visible
in Buffer's dashboard; double-submit doesn't double-post.
Demo beat: "AI names your year — then one click queues the post for real."

## Phase 4 — Greatest Hits + polish + demo (days 14–17) → gate: "contest-ready"

Spec 07 (opt-in PAT chapter) + hardening: a11y pass (focus rings, contrast, reduced
motion), empty states, error states, landing page final copy, demo video script, load
test the card cache, D1 backup.

**Gate**: end-to-end on a fresh real account in one sitting ≤ 5 min; a11y checklist green;
demo video recorded against the real product.

## Cross-phase rules

1. Each phase ends with: tasks marked done + `worklog.md` updated + tag `phase-N`.
2. Agents work only from `tasks/TASKS.json`; new discoveries become new tasks, not scope
   creep inside an open task.
3. Any spec change = edit the spec + note it in the task, never "just code it".
4. The brand rules (AGENTS.md §1) outrank deadlines. A gorgeous deck with baked-in names
   loses to a correct rename-agnostic one.

## Final 48h demo checklist

- [ ] Fresh real Buffer account: connect → deck < 60s → persona → queue → visible in Buffer
- [ ] Landing page loads < 2s; animations run 60fps; reduced-motion fallback verified
- [ ] `agent-check.sh` clean; no console errors; no secrets in repo
- [ ] Demo video: 90s, follows the 5-step flow, ends on the queued post in Buffer
- [ ] Repo tidied: README current, specs match shipped behavior, tags pushed
