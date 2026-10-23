# tasks/ — the agent backlog

`TASKS.json` is the single task queue for AI agents (and humans) building fizzyfeed.

## Protocol

1. **Claim** — set `"status": "in_progress"`, add `"claimant": "<agent-id>"`,
   `"updated_at": "<iso-ts>"`. One task per agent at a time.
2. **Ground** — read the task's `spec_ref` doc fully + skim `worklog.md` for context.
3. **Build** — the smallest complete change that satisfies every string in `acceptance`.
4. **Verify** — `bash scripts/agent-check.sh` (+ typecheck/tests once `app/` exists).
5. **Close** — `"status": "done"`, replace `acceptance` items with checked evidence or add
   an `"evidence"` field; append a short note to `worklog.md`.

## Rules

- Never edit `spec_ref` documents to match your code silently — spec changes are explicit
  edits noted in the task.
- New work discovered mid-task → add a new `Txx` task with `"status": "todo"`, finish the
  claimed one first.
- Statuses: `todo | in_progress | done | blocked` (blocked requires a `blocked_reason`).
