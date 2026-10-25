#!/usr/bin/env bash
# deploy-gh-pages.sh — rebuild the orphan gh-pages branch from landing/ and push.
# gh-pages layout = landing/* at repo root + .nojekyll (+ _smoke screenshots).
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="landing"
SHA="$(git rev-parse --short HEAD)"
STAGE="$(mktemp -d)"

cp -r "$SRC"/. "$STAGE"/
rm -rf "$STAGE/_smoke"          # smoke pngs stay out of the deploy artifact
touch "$STAGE/.nojekyll"

cd "$STAGE"
git init -q -b gh-pages
git add -A
git -c user.name="deploy-bot" -c user.email="deploy@local" \
    commit -q -m "deploy: landing @ $SHA"
git remote add origin "$(git -C "$OLDPWD" remote get-url origin)"
git push -q origin gh-pages --force
cd /
rm -rf "$STAGE"
echo "gh-pages deployed from main@$SHA"
