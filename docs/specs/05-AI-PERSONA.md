# Spec 05 · AI alter ego — persona naming

> Status: approved. Route file: `app/src/worker/routes/persona.ts`. Model: Workers AI.

## 1 · Job

Study the user's real posting patterns (`YearStats` + up to 40 sampled post excerpts) and
produce a **posting alter ego**: a lowercase name, a one-line origin story, and 3 trait
chips. This is delight built on honesty — the persona must be derivable from the data we
show on the cards; if a judge cross-checks, the numbers must agree.

## 2 · Models & budget

| Model | Use | Budget |
|---|---|---|
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | persona naming (JSON out) | 1 call per user-year, cached in `ai_cache` |
| `@cf/meta/llama-3.1-8b-instruct-fast` | card-copy polish lines (fallback only) | ≤ 3 calls/user |

10k free neurons/day ≈ ~55 persona generations — fine for demo scale; the cache makes it
~1 per user ever.

## 3 · Prompt contract (persona call)

System: `You name a social posting alter ego from real, honest posting statistics. Be
playful-precise, never hype. Lowercase names. Two to four words. No emoji in the name.`

User payload (JSON): totals, rhythm (bestDow, favoriteHour, postsPerWeek), streaks, mix
top 3 channels + topTopics, peaks, plus ≤ 40 excerpts truncated to 80 chars each.

Output schema (enforce with a JSON-mode prompt + `JSON.parse` guard + one repair retry):

```json
{ "name": "the midnight archivist",
  "origin": "posted 214 nights after 11pm — consistency masquerading as insomnia",
  "traits": ["night-shift poet", "streak keeper", "quiet volume"] }
```

Guardrails:
- Name ≤ 28 chars, lowercase, banned-word check (spec guardrail: no "wrapped", no
  trademarked product names, no slurs — reject + retry once, else fall back to
  deterministic name built from rhythm: "the {favoriteHour}o'clock regular").
- Origin ≤ 90 chars, must reference at least one stat that appears in YearStats.
- Traits ≤ 18 chars each.
- Temperature 0.7, max_tokens 200.

## 4 · API + caching

```
POST /api/persona   → { persona }  (generates if `ai_cache` miss for (user, 'persona', year))
POST /api/persona/regenerate → new generation, replaces cache (max 3/user-year, debounced 60s)
```

The persona is **year-keyed**: a new posting year names a new alter ego (delightful
return-hook, honest scope).

## 5 · Acceptance criteria

- [ ] Demo account persona name + origin visibly consistent with card stats (origin's
      numbers appear on some card)
- [ ] Cache hit path returns in < 50ms (no AI call); regenerate works 3× then 429s
- [ ] Repair path: malformed JSON triggers 1 retry; deterministic fallback never fails
- [ ] No post text longer than 80 chars ever reaches the model (log assertion)
- [ ] Output contains no banned word / no product-name collision with "wrapped"
