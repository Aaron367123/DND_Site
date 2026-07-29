#!/usr/bin/env bash
#
# Purge img/ from all git history. IRREVERSIBLE once force-pushed.
#
# WHY
# ---
# 14,278 committed images make .git 5.7 GB; webp can't be delta-compressed, so
# the pack is ~5.6 GB of image blobs against ~0.06 GB of everything else. The
# images now serve from Cloudflare R2, so the copies in history are dead weight
# that every clone and every Pages deploy still drags along.
#
# WHAT THIS SCRIPT WILL AND WON'T DO
# ----------------------------------
# It rewrites history in a FRESH CLONE and stops. It does not force-push, and
# it does not touch your working repo — that stays a complete, working fallback
# until you decide otherwise. The push and the folder swap are yours to run,
# and the script prints the exact commands at the end.
#
# Run it only after the soak is clean:
#   • one real session played with players connected
#   • every device you care about has loaded the new build
#   • Settings > Data > Diagnostics shows no "Failed to load img" entries
#   • a fresh incognito window renders images (bypasses the service worker,
#     which will otherwise happily mask a broken deploy with cached copies)
#
# Usage:  bash tools/purge-img-history.sh
set -euo pipefail

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
say(){ printf '%s\n' "$*"; }
ok(){  printf '%s  ok %s %s\n' "$GRN" "$OFF" "$*"; }
warn(){ printf '%s  !! %s %s\n' "$YEL" "$OFF" "$*"; }
die(){ printf '%s ABORT %s %s\n' "$RED" "$OFF" "$*" >&2; exit 1; }
step(){ printf '\n%s=== %s ===%s\n' "$DIM" "$*" "$OFF"; }

REPO="$(git rev-parse --show-toplevel 2>/dev/null)" || die "not inside a git repository"
cd "$REPO"
NAME="$(basename "$REPO")"
PARENT="$(dirname "$REPO")"
STAMP="$(date +%Y%m%d-%H%M%S)"
BUNDLE="$PARENT/${NAME}-backup-${STAMP}.bundle"
FRESH="$PARENT/${NAME}-purged-${STAMP}"
TAG="pre-cdn-purge"

# git-filter-repo ships as a single Python file. On Windows pip installs the
# module but no `git-filter-repo` CLI shim, so `git filter-repo` doesn't exist.
# Resolve the module path and run it directly rather than depending on PATH.
resolve_gfr(){
  if git filter-repo --version >/dev/null 2>&1; then echo "git filter-repo"; return; fi
  local p
  p="$(python -c 'import git_filter_repo,sys; sys.stdout.write(git_filter_repo.__file__)' 2>/dev/null)" || true
  [ -n "${p:-}" ] && [ -f "$p" ] || die "git-filter-repo not found. Install with: pip install git-filter-repo"
  echo "python|$p"
}
GFR="$(resolve_gfr)"
run_gfr(){
  if [ "$GFR" = "git filter-repo" ]; then git filter-repo "$@";
  else python "${GFR#python|}" "$@"; fi
}

# ─── 1. Preflight ────────────────────────────────────────────────────────────
# Every check here exists because failing it makes the rewrite either
# destructive or pointless.
step "1/6  Preflight"

[ -z "$(git status --porcelain)" ] || die "working tree is dirty — commit or stash first"
ok "working tree clean"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] || die "on branch '$BRANCH', expected main"
ok "on main"

git rev-parse --verify origin/main >/dev/null 2>&1 || die "no origin/main — is the remote configured?"
AHEAD="$(git rev-list --count origin/main..HEAD)"
BEHIND="$(git rev-list --count HEAD..origin/main)"
# Unpushed work would be silently discarded by the force-push at the end.
[ "$AHEAD" = "0" ] || die "$AHEAD unpushed commit(s). Push them first — the force-push would discard them."
[ "$BEHIND" = "0" ] || die "$BEHIND commit(s) behind origin/main. Pull first."
ok "in sync with origin/main"

IMG_TRACKED="$(git ls-files img | wc -l | tr -d ' ')"
[ "$IMG_TRACKED" -gt 0 ] || die "img/ is not tracked — history may already be purged. Nothing to do."
ok "img/ tracked: $IMG_TRACKED files"

grep -qE '^/?img/?$' .gitignore 2>/dev/null \
  || die ".gitignore does not ignore img/ — without it the next commit re-adds all $IMG_TRACKED files"
ok ".gitignore covers img/"

# The whole point of the purge is that the CDN is already carrying the load.
BASE="$(grep -oE "imgBase: *'[^']*'" js/core/asset-config.js | sed "s/.*'\(.*\)'/\1/")"
[ -n "$BASE" ] || die "js/core/asset-config.js has an empty imgBase — the site is still serving images from this repo. Purging now breaks every image."
ok "imgBase set: $BASE"

# Sample across the tree rather than probing one arbitrary file. Every one
# must answer 200: after the purge the CDN is the only source, so a single
# gap is a permanently broken image.
say "  probing CDN (8 files sampled across the tree) …"
PROBE_FAIL=0
# `shuf`-free sampling so this works on a bare Git Bash: take every Nth path.
TOTAL_IMG="$IMG_TRACKED"
STRIDE=$(( TOTAL_IMG / 8 )); [ "$STRIDE" -lt 1 ] && STRIDE=1
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  enc="$(python -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$rel")"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$BASE/$enc")"
  if [ "$code" = "200" ]; then printf '    %s  %s\n' "$code" "$rel"
  else printf '    %s%s  %s%s\n' "$RED" "$code" "$rel" "$OFF"; PROBE_FAIL=$((PROBE_FAIL+1)); fi
done < <(git ls-files img | sed 's|^img/||' | awk -v s="$STRIDE" 'NR % s == 1' | head -8)
[ "$PROBE_FAIL" = "0" ] || die "$PROBE_FAIL of 8 CDN probes failed — fix the upload before purging"
ok "CDN serving all sampled files"

BEFORE_SIZE="$(du -sh .git | cut -f1)"
COMMITS="$(git rev-list --count HEAD)"
HEAD_SHA="$(git rev-parse HEAD)"

# filter-repo drops commits that become empty, so a commit that only ever
# added images disappears entirely. Predict the number now rather than
# discovering it afterwards and having to guess whether it's correct.
say "  scanning history for image-only commits …"
IMGONLY=0
for c in $(git log --format=%H -- img); do
  tot="$(git show --pretty=format: --name-only "$c" | grep -c . || true)"
  onlyimg="$(git show --pretty=format: --name-only "$c" | grep -c '^img/' || true)"
  [ "$tot" -gt 0 ] && [ "$tot" = "$onlyimg" ] && IMGONLY=$((IMGONLY+1))
done
EXPECTED_COMMITS=$(( COMMITS - IMGONLY ))

say ""
say "  repo      : $REPO"
say "  commits   : $COMMITS   (HEAD $HEAD_SHA)"
say "  .git      : $BEFORE_SIZE"
say "  to remove : $IMG_TRACKED files under img/"
say "  history   : $IMGONLY image-only commit(s) will disappear → $EXPECTED_COMMITS remain"

say ""
printf 'Type %sPURGE%s to continue: ' "$YEL" "$OFF"
read -r CONFIRM
[ "$CONFIRM" = "PURGE" ] || die "not confirmed"

# ─── 2. Backup ───────────────────────────────────────────────────────────────
step "2/6  Backup"

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  warn "tag $TAG already exists — leaving it alone"
else
  git tag -a "$TAG" -m "State before img/ history purge ($IMG_TRACKED files, .git $BEFORE_SIZE)"
  ok "tagged $TAG"
fi

say "  writing bundle (this takes a few minutes for 5.7 GB) …"
git bundle create "$BUNDLE" --all
ok "bundle: $BUNDLE ($(du -sh "$BUNDLE" | cut -f1))"

# ─── 3. Verify the backup RESTORES ───────────────────────────────────────────
# `git bundle verify` only checks that prerequisites are satisfiable. It does
# not prove the bundle produces a usable repo. Actually cloning from it does,
# and this is the single most important step in the script — everything after
# depends on this being a real fallback.
step "3/6  Verify backup restores"

git bundle verify "$BUNDLE" >/dev/null 2>&1 || die "bundle failed verification"
ok "bundle structurally valid"

VDIR="$PARENT/.${NAME}-verify-$STAMP"
rm -rf "$VDIR"
git clone -q --branch main "$BUNDLE" "$VDIR" 2>/dev/null || die "bundle did not clone — DO NOT PROCEED"
V_HEAD="$(git -C "$VDIR" rev-parse HEAD)"
V_COMMITS="$(git -C "$VDIR" rev-list --count HEAD)"
V_IMG="$(git -C "$VDIR" ls-files img | wc -l | tr -d ' ')"
rm -rf "$VDIR"

[ "$V_HEAD"    = "$HEAD_SHA"    ] || die "restored HEAD $V_HEAD != $HEAD_SHA"
[ "$V_COMMITS" = "$COMMITS"     ] || die "restored $V_COMMITS commits, expected $COMMITS"
[ "$V_IMG"     = "$IMG_TRACKED" ] || die "restored $V_IMG img files, expected $IMG_TRACKED"
ok "restored clone matches: $V_COMMITS commits, $V_IMG images, HEAD identical"

# ─── 4. Rewrite in a fresh clone ─────────────────────────────────────────────
# --no-local forces a real object copy. A default same-filesystem clone
# hardlinks objects, and rewriting one would corrupt the source repo — the
# thing we are relying on as our fallback.
step "4/6  Rewrite history (fresh clone)"

rm -rf "$FRESH"
say "  cloning to $FRESH (full copy, several minutes) …"
git clone -q --no-local --no-hardlinks "$REPO" "$FRESH"
ok "clone created"

cd "$FRESH"
say "  running git-filter-repo …"
run_gfr --path img/ --invert-paths --force
ok "history rewritten"

# ─── 5. Verify the rewrite ───────────────────────────────────────────────────
step "5/6  Verify rewrite"

N_COMMITS="$(git rev-list --count HEAD)"
N_IMG="$(git ls-files img | wc -l | tr -d ' ')"
# The real test: does ANY commit anywhere still reference an img/ path?
HIST_IMG="$(git log --all --oneline --name-only --pretty=format: -- img | grep -c . || true)"
AFTER_SIZE="$(du -sh .git | cut -f1)"

[ "$N_IMG" = "0" ]    || die "img/ still tracked in the rewrite ($N_IMG files)"
[ "$HIST_IMG" = "0" ] || die "img/ still present in history ($HIST_IMG path entries)"
ok "img/ gone from index and from all history"

if [ "$N_COMMITS" = "$EXPECTED_COMMITS" ]; then
  ok "$N_COMMITS commits, exactly as predicted ($COMMITS − $IMGONLY image-only)"
else
  # Not fatal, but it means the prediction was wrong, so something about the
  # history isn't what we assumed. Worth a look before pushing.
  warn "expected $EXPECTED_COMMITS commits, got $N_COMMITS — inspect with: git -C \"$FRESH\" log --oneline | head -20"
fi

# Code must survive intact.
for f in skt-workspace.html js/app.js js/features/backup.js js/core/errors.js sw.js; do
  [ -f "$f" ] || die "$f missing from the rewrite"
done
ok "key source files intact"

say ""
say "  .git before : $BEFORE_SIZE"
say "  .git after  : $AFTER_SIZE"

# filter-repo removes the remote by design, so a stray push can't hit the
# wrong place. Put it back explicitly.
ORIGIN="$(git -C "$REPO" remote get-url origin)"
git remote add origin "$ORIGIN" 2>/dev/null || git remote set-url origin "$ORIGIN"
ok "origin restored: $ORIGIN"

# ─── 6. Hand back ────────────────────────────────────────────────────────────
step "6/6  Next steps (nothing has been pushed)"
cat <<EOF

  Rewritten repo : $FRESH
  Backup bundle  : $BUNDLE
  Backup tag     : $TAG  (in your ORIGINAL repo — push it before the force-push)

  Your original repo at
    $REPO
  is untouched and still fully working. Keep it until you're satisfied.

  1) Push the safety tag from the ORIGINAL repo:
       git -C "$REPO" push origin $TAG

  2) Force-push the rewritten history from the NEW clone:
       git -C "$FRESH" push --force origin main

  3) Verify the deployed site in a FRESH INCOGNITO WINDOW.
     Not your normal browser — the service worker will serve cached images
     and make a broken deploy look perfectly fine.

  4) Only once that's confirmed, make the new clone your working copy.
     Move the art across (both are gitignored, so they stay untracked) —
     a move, not a copy, and it's instant on the same drive:
       mv "$REPO/img"    "$FRESH/img"
       mv "$REPO/thumbs" "$FRESH/thumbs"
     Then rename the folders so your usual path still works.

  ${RED}NEVER run 'git reset --hard' in the original repo after the force-push.${OFF}
  Against an img-less history that deletes all $IMG_TRACKED images from disk.
  If you want the original repo on the new history, don't — use the new clone.

  Rollback, if anything goes wrong:
       git -C "$REPO" push --force origin main      # original still has everything

EOF
