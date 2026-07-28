#!/bin/sh
# verify-cdn.sh — sanity-check the image bucket BEFORE pointing the app at it.
#
#   sh tools/verify-cdn.sh https://pub-xxxxx.r2.dev
#
# Checks, in order:
#   1. plain fetch          — is the object public at all?
#   2. content-type         — webp served as image/webp, not octet-stream
#                             (wrong type makes browsers download instead of render)
#   3. cache-control        — long immutable caching actually applied
#   4. CORS preflight-ish   — access-control-allow-origin returned for our origin.
#                             REQUIRED: without it the battlemap's adaptive grid
#                             contrast breaks (tainted canvas) and the service
#                             worker silently caches nothing.
#   5. awkward filenames    — spaces / parens / apostrophes. 5,870 of the art
#                             files contain a space, so this is the single most
#                             likely way to break thousands of images at once.
#   6. thumbnails           — the thumbs/ prefix uploaded too.
set -u

BASE="${1:-}"
ORIGIN="https://aaron367123.github.io"
if [ -z "$BASE" ]; then
  echo "usage: sh tools/verify-cdn.sh <public-base-url>"
  echo "   eg: sh tools/verify-cdn.sh https://pub-abc123.r2.dev"
  exit 2
fi
BASE="${BASE%/}"

pass=0; fail=0
check() { # label, url-path
  label="$1"; path="$2"
  enc=$(printf '%s' "$path" | sed 's/ /%20/g')
  hdrs=$(curl -sS -I -L --max-time 25 -H "Origin: $ORIGIN" "$BASE/$enc" 2>&1)
  code=$(printf '%s' "$hdrs" | awk 'toupper($1) ~ /^HTTP/ {c=$2} END{print c}')
  ctype=$(printf '%s' "$hdrs" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print tolower($2)}' | tail -1)
  cc=$(printf '%s'   "$hdrs" | tr -d '\r' | awk -F': ' 'tolower($1)=="cache-control"{print $2}' | tail -1)
  acao=$(printf '%s' "$hdrs" | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}' | tail -1)

  if [ "$code" = "200" ]; then
    printf '  ok   %-34s 200' "$label"
    [ -n "$ctype" ] && printf ' · %s' "$ctype"
    [ -n "$cc" ]    && printf ' · cache ok'
    if [ -n "$acao" ]; then printf ' · CORS ok'; else printf ' · !! NO CORS HEADER'; fi
    printf '\n'
    if [ -z "$acao" ]; then fail=$((fail+1)); else pass=$((pass+1)); fi
    case "$ctype" in *webp*|*png*|*jpeg*) : ;; *) echo "       ^ unexpected content-type"; esac
  else
    printf '  FAIL %-34s HTTP %s\n' "$label" "${code:-no-response}"
    fail=$((fail+1))
  fi
}

echo "Verifying $BASE"
echo "(Origin header: $ORIGIN)"
echo

# A spread across top-level prefixes, plus the three awkward filename classes.
check "plain name"          "bestiary/tokens/MM/Goblin.webp"
check "name with space"     "bestiary/tokens/MM/Hill Giant.webp"
check "name with parens"    "adventure/LMoP/The Sword Coast (Player).webp"
check "adventure art"       "adventure/SKT/027-skt03-thenorth.webp"
check "cover"               "covers/SKT.webp"
check "thumbnail"           "thumbs/adventure/SKT/027-skt03-thenorth.webp"

echo
echo "passed=$pass failed=$fail"
if [ "$fail" -gt 0 ]; then
  echo
  echo "Do NOT set imgBase until these pass."
  echo "  404          -> object missing or bucket root doesn't mirror img/ contents"
  echo "                  (root should hold adventure/, bestiary/, covers/ … directly)"
  echo "  no CORS      -> add the CORS policy in bucket Settings"
  echo "  403          -> public access not enabled"
  exit 1
fi
echo "All good — safe to set imgBase in js/asset-config.js and IMG_ORIGINS in sw.js."
