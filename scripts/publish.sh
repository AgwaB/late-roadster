#!/bin/sh
# Export the committed game (HEAD without research/) into the public repository checkout,
# commit and push it; Cloudflare Pages rebuilds the site from that push.
# usage: scripts/publish.sh ../late-roadster-public "commit message"
set -eu
DEST=$(cd "${1:?path to the public repo checkout}" && pwd)
MSG=${2:-"Update"}
cd "$(git rev-parse --show-toplevel)"
git diff --quiet HEAD -- . ':!research' || { echo "commit your changes first" >&2; exit 1; }
(cd "$DEST" && git rm -rq --ignore-unmatch .)
git archive HEAD -- . ':!research' | tar -x -C "$DEST"
cd "$DEST"
git add -A
git diff --cached --quiet && { echo "nothing to publish"; exit 0; }
git commit -qm "$MSG"
git push -q origin main
git log --oneline -1 | cat
