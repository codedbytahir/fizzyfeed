# CLAUDE.md

@AGENTS.md

## Notes for Claude Code specifically

- **Skills**: the impeccable design skill lives at `.claude/skills/impeccable/` (with the
  engine binary at `.claude/skills/impeccable/scripts/bin/`). Run `/impeccable init` once
  per project before design work. The other skills (ponytail, graphify, vercel packs)
  live in `skills/` — read their `SKILL.md` when relevant to the task.
- **Hooks**: `.claude/settings.local.json` contains impeccable's hook manifest; keep it
  in sync when updating the skill (`npx impeccable update`).
- **Landing animations**: modules in `landing/animations/<id>/index.html` are
  self-contained; when editing them, preserve the `<!-- FX-MODULE-START/END -->` markers
  and the scoping rules in `docs/ANIMATIONS.md` §2 — the landing page embeds those blocks.
- Worklog protocol: append session notes to `/home/z/my-project/worklog.md` after
  multi-step work (it is shared with other agents).
