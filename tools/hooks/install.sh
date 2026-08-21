#!/bin/sh
# Install this repo's git hooks. Run once per clone / per machine:
#   sh tools/hooks/install.sh
#
# .git/hooks is deliberately not version-controlled by git, so the hooks live
# here (tracked) and get copied into place by this script.
set -e
root="$(git rev-parse --show-toplevel)"
for h in pre-commit pre-push; do
  cp "$root/tools/hooks/$h" "$root/.git/hooks/$h"
  chmod +x "$root/.git/hooks/$h"
  echo "installed: .git/hooks/$h"
done
