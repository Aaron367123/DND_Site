#!/usr/bin/env python3
"""
make-thumbs.py — generate browse-sized thumbnails for the art pack.

WHY
---
The map picker renders up to 200 cards using FULL-RESOLUTION adventure maps
(498 KB average, 15.7 MB worst case). One search can pull ~100 MB and a
10000x7000 poster decodes to ~280 MB of RGBA just to draw a 180 px card.
This generates small stand-ins so browsing costs a few hundred KB instead.

SCOPE — deliberately narrow
---------------------------
Only images the *grid* UIs actually show:
  * maps  -> every image tagged imageType "map"/"mapPlayer" in
             data/adventure/*.json and data/book/*.json. That's the exact same
             filter the picker itself uses (extractMaps in battlemap.js), so
             the thumbnail set matches what gets rendered — no more, no less.
  * covers/ -> adventure + book cover cards.
Bestiary tokens are skipped: ~150 KB average is already thumbnail-sized.

OUTPUT
------
Mirrors the source tree under a top-level `thumbs/` prefix, matching
assetThumbUrl() in js/core/utils.js:
    img/adventure/SKT/foo.webp  ->  thumbs/adventure/SKT/foo.webp
`thumbs/` is gitignored and uploaded next to the originals; a missing
thumbnail is harmless because callers fall back to the full-size URL.

USAGE
    pip install Pillow
    python tools/make-thumbs.py            # generate (skips up-to-date)
    python tools/make-thumbs.py --force    # regenerate everything
    python tools/make-thumbs.py --dry-run  # just report what it would do
"""
import concurrent.futures
import json
import os
import sys

ROOT     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR  = os.path.join(ROOT, 'img')
OUT_DIR  = os.path.join(ROOT, 'thumbs')
MAX_EDGE = 400          # longest edge, px — ~4x the 180px card for retina
QUALITY  = 72

FORCE   = '--force'   in sys.argv
DRY_RUN = '--dry-run' in sys.argv


def collect_map_paths():
    """Every image tagged as a map in the adventure/book data.

    Mirrors extractMaps() in js/panels/battlemap.js: recursive walk, keep
    nodes whose type is 'image' and imageType is 'map' or 'mapPlayer'.
    """
    found = set()

    def walk(node):
        if isinstance(node, list):
            for n in node:
                walk(n)
            return
        if not isinstance(node, dict):
            return
        if (node.get('type') == 'image'
                and node.get('imageType') in ('map', 'mapPlayer')):
            href = node.get('href') or {}
            p = href.get('path')
            if p:
                found.add(p)
        for v in node.values():
            walk(v)

    for sub in ('adventure', 'book'):
        d = os.path.join(ROOT, 'data', sub)
        if not os.path.isdir(d):
            continue
        for name in os.listdir(d):
            if not name.endswith('.json'):
                continue
            try:
                with open(os.path.join(d, name), encoding='utf-8') as fh:
                    walk(json.load(fh))
            except Exception as e:                      # noqa: BLE001
                print('  ! skipped %s (%s)' % (name, e))
    return found


def collect_covers():
    covers = os.path.join(IMG_DIR, 'covers')
    if not os.path.isdir(covers):
        return set()
    return {
        'covers/' + f
        for f in os.listdir(covers)
        if f.lower().endswith(('.webp', '.png', '.jpg', '.jpeg'))
    }


def make_one(rel):
    """Resize one image. Returns (status, rel) where status is
    'ok' | 'skip' | 'missing' | 'error: ...'."""
    src = os.path.join(IMG_DIR, rel.replace('/', os.sep))
    dst = os.path.join(OUT_DIR, rel.replace('/', os.sep))
    if not os.path.isfile(src):
        return ('missing', rel)
    # Up to date? (thumbnail newer than source)
    if not FORCE and os.path.isfile(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
        return ('skip', rel)
    if DRY_RUN:
        return ('ok', rel)
    try:
        from PIL import Image
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with Image.open(src) as im:
            im.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
            # RGBA->RGB only when the source has no real transparency, so map
            # art doesn't gain a black background.
            if im.mode in ('RGBA', 'LA', 'P'):
                im = im.convert('RGBA')
            im.save(dst, 'WEBP', quality=QUALITY, method=4)
        return ('ok', rel)
    except Exception as e:                              # noqa: BLE001
        return ('error: %s' % e, rel)


def main():
    if not os.path.isdir(IMG_DIR):
        print('No img/ directory at %s — nothing to do.' % IMG_DIR)
        return 1
    if not DRY_RUN:
        try:
            import PIL  # noqa: F401
        except ImportError:
            print('Pillow is required:  pip install Pillow')
            return 1

    print('Scanning data/ for map-tagged images…')
    targets = sorted(collect_map_paths() | collect_covers())
    print('%d images in scope (maps + covers)' % len(targets))
    if DRY_RUN:
        print('--dry-run: no files written. First 5:')
        for t in targets[:5]:
            print('   ', t)
        return 0

    counts = {'ok': 0, 'skip': 0, 'missing': 0, 'error': 0}
    errors = []
    workers = min(8, (os.cpu_count() or 4))
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for i, (status, rel) in enumerate(pool.map(make_one, targets), 1):
            key = 'error' if status.startswith('error') else status
            counts[key] += 1
            if key == 'error':
                errors.append('%s -> %s' % (rel, status))
            if i % 250 == 0:
                print('  %d/%d…' % (i, len(targets)))

    print('\nDone. generated=%(ok)d skipped=%(skip)d missing=%(missing)d errors=%(error)d' % counts)
    # `missing` is expected and harmless: the data references art for books
    # whose images aren't in the local pack. Callers fall back to full size.
    for e in errors[:10]:
        print('  !', e)
    if not DRY_RUN and counts['ok']:
        total = sum(
            os.path.getsize(os.path.join(dp, f))
            for dp, _, fs in os.walk(OUT_DIR) for f in fs
        )
        print('thumbs/ is now %.1f MB' % (total / 1048576.0))
    return 0


if __name__ == '__main__':
    sys.exit(main())
