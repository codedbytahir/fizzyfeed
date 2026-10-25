# AGENTS.md — operating manual for AI agents working in this repo

> **fizzyfeed** (dev codename `kroma`) — *"your year in posts."*
> A Buffer Commit 2026 product: connect Buffer (read-only OAuth), turn 12 months of
> publishing into a deck of 7 story cards, an AI-named alter ego, and a recap post
> queued to every channel in one click. This repo currently holds the **brand kit + specs
> + landing page**; the app (Cloudflare Workers + React + Hono + D1) is built from the
> specs in [`docs/specs/`](docs/specs/).

This file is the entry point for any AI agent (Claude, Codex, Cursor, Copilot, OpenClaw…).
Read it fully before writing code. Then read the spec for the area you're touching.

---

## 0 · Read order (mandatory)

| When | Read |
|---|---|
| Always | this file → [`IDEA.md`](IDEA.md) → the spec for your task |
| Designing UI/brand | [`BRAND-GUIDELINES.md`](BRAND-GUIDELINES.md) → [`tokens.css`](tokens.css) / [`tokens.json`](tokens.json) |
| Building the app | [`docs/specs/00-PRODUCT.md`](docs/specs/00-PRODUCT.md) → [`01-ARCHITECTURE.md`](docs/specs/01-ARCHITECTURE.md) → your area's spec |
| Touching the landing page | [`docs/ANIMATIONS.md`](docs/ANIMATIONS.md) → `landing/animations/<id>/index.html` |
| Picking up work | [`tasks/TASKS.json`](tasks/TASKS.json) → claim a `todo` task → follow its `spec_ref` |

## 1 · Non-negotiable rules

1. **The product is name-agnostic.** Never bake `kroma`, `fizzyfeed`, or `feezyfeed` into
   code identifiers. Use a single `BRAND_NAME` constant (`src/shared/brand.ts`) and the
   pre-built wordmark/lockup SVGs (`logo/svg/`). The Deck mark never changes on rename.
2. **The word "wrapped" is banned** in all UI, copy, comments, docs, and commits
   (trademark conflict with a certain music app). `scripts/agent-check.sh` enforces this.
3. **Colors only from tokens.** No raw hex in component code — use `tokens.css` custom
   properties or the Tailwind v4 `@theme` mapping. The 7 card gradients are fixed; never
   recolor the yearline spark or the deck gradients.
4. **Dark-first.** `ink-950 #05070E` canvas, electric blue as the light source, 60/30/10
   usage ratio (ink / electric+volt / chroma moments).
5. **Honest numbers.** Never invent, inflate, or fake engagement metrics. Chart data comes
   from the yearize pipeline only. Lowercase headlines (Space Grotesk), sentence-case UI.
6. **Security floor.** Buffer tokens are AES-GCM encrypted at rest in D1, never in KV,
   never logged. Read-only OAuth by default. The one write (`POST /post`) requires explicit
   user consent in the UI. Secrets live in `.dev.vars` (gitignored) / Worker secrets.
7. **TypeScript strict, no `any` escapes** in shipped code. Every exported function the
   pipeline or API exposes has a typed contract in `src/shared/`.

## 2 · Repo map

```
AGENTS.md, CLAUDE.md        ← you are here; agent entry points
.cursor/rules/              ← Cursor always-on rules
.github/                    ← copilot-instructions.md (+ workflows later)
BRAND-GUIDELINES.md         ← brand law: mark, palette, type, voice, a11y
IDEA.md                     ← product concept, flow, chapters, principles
tokens.css / tokens.json    ← design tokens (CSS custom props / W3C shape)
logo/ social/ preview/      ← brand assets & board (do not hand-edit PNGs)
docs/
  specs/                    ← THE build specs (00–08) — read before building
  ANIMATIONS.md             ← landing motion spec + module contract
  RUNBOOK.md                ← setup, dev, deploy commands
tasks/TASKS.json            ← machine-readable task backlog (claim → build → mark done)
scripts/agent-check.sh      ← guardrail checks (run before every commit)
landing/                    ← marketing landing page
  animations/<id>/index.html← self-contained motion modules (fx-01…fx-06)
skills/                     ← ClawHub skills (ponytail, graphify, vercel packs)
.claude/skills/impeccable/  ← impeccable design skill + engine (run /impeccable init)
app/                        ← (future) the product code — scaffold per spec 01
```

## 3 · Workflow protocol for agents

1. **Claim**: pick a task from `tasks/TASKS.json` with `"status": "todo"`, set it to
   `"in_progress"` with your agent id and a timestamp. One task at a time.
2. **Ground**: read the task's `spec_ref` document fully. Check `worklog.md` for prior
   context on the area (agents before you log their work there).
3. **Build**: smallest complete change that satisfies the task's `acceptance` criteria
   (ponytail discipline — see §5). Reuse existing helpers/patterns before adding code.
4. **Verify**: run `bash scripts/agent-check.sh` (must pass), run `npm run typecheck`
   and `npm test` once `app/` exists. For UI work, view the rendered result at the sizes
   it ships at before calling it done.
5. **Update state**: set the task to `"done"` with evidence notes; append a short section
   to `worklog.md` (`---` header, Task ID, what changed, risks). Append — never overwrite.
6. **Critic gate (landing page only)**: after ANY round of landing-page changes, dispatch
   a fresh Critic subagent whose system prompt is [`critic/CRITIC.md`](critic/CRITIC.md)
   before committing. Loop: fix → re-critic → fix. Ship only when the Critic reports
   **≥ 9/10 overall**. Log every score (append-only) in `critic/score-log.md`.

## 4 · Commands

```bash
bash scripts/agent-check.sh     # guardrails: banned word, token discipline, name baking
npx serve landing/              # preview the landing page (or open animations directly)
# once app/ exists (spec 01):
cd app && npm install && npm run dev        # vite + wrangler dev
cd app && npm run typecheck && npm test     # tsc --noEmit + vitest
cd app && npx wrangler d1 migrations apply fizzyfeed --local
cd app && npm run deploy                    # workers builds
```

## 5 · Skills available in-repo (use them)

| Skill | Path | Use for |
|---|---|---|
| **impeccable** | `.claude/skills/impeccable/` | design direction, UI critique/polish, DESIGN.md systems. Run `/impeccable init` once, then `/impeccable <command>` |
| **ponytail** | `skills/@dietrichgebert/` | lazy-senior-dev discipline: smallest complete change; end replies with skipped/risks |
| **graphify** | `skills/@fantox/graphify/` | build a queryable knowledge graph of the codebase (`pip install graphify; graphify .`) once `app/` grows past ~50 files; check `graphify-out/GRAPH_REPORT.md` before grepping |
| **web-design-guidelines** | `skills/web-design-guidelines/` | landing/UI review checklist (Vercel) |
| **react-best-practices** | `skills/react-best-practices/` | React patterns while building the SPA (Vercel) |

## 6 · Definition of done (any task)

- [ ] `scripts/agent-check.sh` passes
- [ ] Typecheck + tests green (once app exists); animations/landing render without console errors
- [ ] Brand rules §1 honored (tokens, name-agnostic, banned word, dark-first)
- [ ] Task marked `done` in `tasks/TASKS.json` with evidence; `worklog.md` appended
- [ ] No secrets, no debug leftovers, no unrelated file churn in the diff
