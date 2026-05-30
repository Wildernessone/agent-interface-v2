#!/usr/bin/env bash
#
# update.sh — refresh the pinned web-interface-guidelines snapshot.
#
# Downloads the upstream command.md, shows you the diff against the current
# pinned copy, and only overwrites guidelines.md after you confirm. This keeps
# the skill running against vendored, reviewed rules instead of fetching mutable
# remote instructions at review time.
#
# Usage:
#   ./update.sh          # download, show diff, prompt before applying
#   ./update.sh --yes    # apply without prompting (skip the confirmation)

set -euo pipefail

UPSTREAM="https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PINNED="$DIR/guidelines.md"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

AUTO_YES=0
[ "${1:-}" = "--yes" ] && AUTO_YES=1

echo "Fetching upstream guidelines…"
curl -fsSL "$UPSTREAM" -o "$TMP"

if [ ! -s "$TMP" ]; then
  echo "error: download was empty — aborting." >&2
  exit 1
fi

if [ -f "$PINNED" ] && diff -q "$PINNED" "$TMP" >/dev/null 2>&1; then
  echo "Already up to date — no changes."
  exit 0
fi

echo
echo "=== diff (current pinned  →  upstream) ==="
diff -u "$PINNED" "$TMP" || true
echo "=========================================="
echo

if [ "$AUTO_YES" -ne 1 ]; then
  printf "Apply this update to guidelines.md? [y/N] "
  read -r reply
  case "$reply" in
    [yY]|[yY][eE][sS]) ;;
    *) echo "Aborted — guidelines.md unchanged."; exit 0 ;;
  esac
fi

cp "$TMP" "$PINNED"
echo "Updated: $PINNED"
