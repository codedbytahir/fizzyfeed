#!/usr/bin/env bash
# agent-check.sh — fizzyfeed guardrails (run before every commit; CI runs it too)
# Fails when a hard brand/security rule is violated. See AGENTS.md §1.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
note() { printf '  \033[0;31m✗\033[0m %s\n' "$1"; fail=1; }
pass() { printf '  \033[0;32m✓\033[0m %s\n' "$1"; }

echo "fizzyfeed agent-check"

# 0 · required structure
for f in AGENTS.md CLAUDE.md docs/ANIMATIONS.md docs/specs/00-PRODUCT.md tasks/TASKS.json tokens.css; do
  [ -f "$f" ] || note "missing required file: $f"
done
[ $fail -eq 0 ] && pass "required files present"

# 1 · banned word "wrapped" in product source & copy (docs/specs may MENTION it as banned;
#     brand-asset svg/png paths and this script are excluded; ban is on code + landing + specs' copy checks below)
hits=$(rg -il 'wrapped' \
    --glob '!scripts/agent-check.sh' \
    --glob '!docs/specs/*.md' \
    --glob '!docs/ANIMATIONS.md' \
    --glob '!AGENTS.md' \
    --glob '!CLAUDE.md' \
    --glob '!.cursor/**' --glob '!.github/**' \
    --glob '!skills/**' --glob '!.claude/**' \
    --glob '!node_modules' --glob '!.wrangler' --glob '!app/node_modules' \
    landing/ app/src/ app/public/ 2>/dev/null || true)
[ -n "$hits" ] && note "banned word 'wrapped' found in: $(echo "$hits" | tr '\n' ' ')" || pass "banned word absent from product surfaces"

# 2 · product name must not be baked into code identifiers (app source only)
baked=$(rg -n -i '\b(kroma|feezyfeed)\b' --glob '!node_modules' app/src landing 2>/dev/null \
        | rg -v 'BRAND_NAME|data-brand-name|brandName' || true)
[ -n "$baked" ] && note "codename/alt name baked into code:\n$baked" || pass "name-agnostic (no kroma/feezyfeed identifiers)"
# 'fizzyfeed' allowed only via BRAND_NAME/data-brand-name contexts:
badfizzy=$(rg -n 'fizzyfeed' app/src 2>/dev/null | rg -v 'BRAND_NAME|data-brand-name|brandName|@import|tokens' || true)
[ -n "$badfizzy" ] && note "'fizzyfeed' outside BRAND_NAME contexts in app/src:\n$badfizzy" || pass "fizzyfeed only via BRAND_NAME"

# 3 · raw hex colors in app component code (tokens only rule)
hex=$(rg -n '#[0-9a-fA-F]{6}\b' --glob '!*.test.*' --glob '!tokens*' app/src 2>/dev/null \
      | rg -v '// *token|/\* *token|getComputedStyle|var\(' || true)
[ -n "$hex" ] && note "raw hex in app/src (use tokens.css vars):\n$hex" || pass "token color discipline in app/src"

# 4 · secrets never committed
sec=$(rg -l -i '(BUFFER_CLIENT_SECRET|SESSION_SECRET|TOKEN_AES_KEY)\s*=\s*["'"'"'][A-Za-z0-9+/=_-]{16,}' \
      --glob '!node_modules' --glob '!.dev.vars' --glob '!.wrangler' . 2>/dev/null || true)
[ -n "$sec" ] && note "possible committed secrets in: $sec" || pass "no committed secrets"
[ -f .dev.vars ] && [ -n "$(git check-ignore .dev.vars 2>/dev/null)" ] && pass ".dev.vars gitignored" || { [ -f .dev.vars ] && note ".dev.vars exists but NOT gitignored"; }

# 5 · animation module contract (landing/animations)
for m in landing/animations/fx-*/index.html; do
  [ -f "$m" ] || continue
  id=$(basename "$(dirname "$m")")
  grep -q 'FX-MODULE-START' "$m" || note "$id: missing FX-MODULE-START marker"
  grep -q 'FX-MODULE-END' "$m" || note "$id: missing FX-MODULE-END marker"
  grep -q 'prefers-reduced-motion' "$m" || note "$id: missing prefers-reduced-motion fallback"
  grep -qiE 'wrapped' "$m" && note "$id: banned word present"
done
mods=$(ls -d landing/animations/fx-* 2>/dev/null | wc -l)
[ "$mods" -ge 1 ] && pass "animation modules checked ($mods found)"

# 6 · tasks file is valid JSON with the queue protocol
python3 -c "
import json,sys
d=json.load(open('tasks/TASKS.json'))
assert isinstance(d.get('tasks'), list) and len(d['tasks'])>=20, 'task queue missing'
ids=[t['id'] for t in d['tasks']]
assert len(ids)==len(set(ids)), 'duplicate task ids'
bad=[t['id'] for t in d['tasks'] if t.get('status') not in ('todo','in_progress','done','blocked')]
assert not bad, 'invalid statuses: %s' % bad
" 2>/dev/null && pass "TASKS.json valid" || note "TASKS.json invalid"

echo
if [ $fail -eq 0 ]; then
  printf '\033[0;32magent-check: PASS\033[0m\n'; exit 0
else
  printf '\033[0;31magent-check: FAIL — fix the ✗ items above\033[0m\n'; exit 1
fi
