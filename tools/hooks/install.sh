#!/bin/sh
# Install this repo's git hooks. Run once per clone / per machine:
#   sh tools/hooks/install.sh
#
# .git/hooks is deliberately not version-controlled by git, so the hooks live
# here (tracked) and get copied into place by this script.
set -e
root="$(git rev-parse --show-toplevel)"
cp "$root/tools/hooks/pre-commit" "$root/.git/hooks/pre-commit"
chmod +x "$root/.git/hooks/pre-commit"
echo "installed: .git/hooks/pre-commit"
