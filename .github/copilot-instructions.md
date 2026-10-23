# GitHub Copilot instructions — fizzyfeed

Read `AGENTS.md` for the full operating manual. Non-negotiables:

- **Name-agnostic**: never hardcode `kroma`, `fizzyfeed`, or `feezyfeed` as identifiers;
  use the `BRAND_NAME` constant. Wordmark swaps come from `logo/svg/`, not code.
- **Banned word**: never write "wrapped" in UI, copy, comments, or commit messages.
- **Tokens only**: use `tokens.css` custom properties; the 7 recap-card gradients and the
  yearline spark are fixed colors. Dark-first `#05070E` canvas, lowercase headlines.
- **Honesty**: never fabricate metrics; stats come from the yearize pipeline.
- **Security**: Buffer tokens are AES-GCM encrypted in D1 (never KV, never logs);
  read-only OAuth by default; the only write endpoint requires explicit consent.
- **Style**: TypeScript strict, no `any`, reuse existing helpers, smallest complete change.
- Before committing run: `bash scripts/agent-check.sh`.
- Build specs live in `docs/specs/00`–`08`; task backlog in `tasks/TASKS.json`.
