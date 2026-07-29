#!/usr/bin/env python3
"""Report data/ files the app can never reach.

Reachability has three sources, and all three have to be modelled or the
report is worthless:
  1. paths hardcoded in js/            (data/items.json, data/feats.json, ...)
  2. index-driven directories          (bestiary/spells/class list their own
                                        files in index.json / fluff-index.json)
  3. on-demand content                 (adventures.json and books.json name the
                                        per-adventure / per-book files the
                                        panels fetch when you open one)

Anything left over is shipped but unreachable. Read-only: prints, never deletes.
"""
import json, io, os, re, sys, collections

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
os.chdir(ROOT)


def norm(p):
    return p.replace(os.sep, '/')


on_disk = set()
for root, _, files in os.walk('data'):
    for f in files:
        on_disk.add(norm(os.path.join(root, f)))

reach = set()


def add(p):
    p = norm(p)
    if p in on_disk:
        reach.add(p)


# 1. hardcoded in js/
src = []
for root, _, files in os.walk('js'):
    for f in files:
        if f.endswith('.js'):
            src.append(io.open(os.path.join(root, f), encoding='utf-8').read())
for m in re.findall(r'data/[A-Za-z0-9._/-]+\.json', '\n'.join(src)):
    add(m)

# 2. index-driven directories
for d in ('bestiary', 'spells', 'class'):
    for idx in ('index.json', 'fluff-index.json'):
        p = 'data/%s/%s' % (d, idx)
        if not os.path.exists(p):
            continue
        add(p)
        try:
            for v in json.load(io.open(p, encoding='utf-8')).values():
                add('data/%s/%s' % (d, v))
                add('data/%s/fluff-%s' % (d, v))
        except Exception:
            pass

# 3. on-demand adventure / book content
for idxf, sub, key in (('data/adventures.json', 'adventure', 'adventure'),
                       ('data/books.json', 'book', 'book')):
    if not os.path.exists(idxf):
        continue
    add(idxf)
    try:
        j = json.load(io.open(idxf, encoding='utf-8'))
        for e in j.get(key, []):
            ident = e.get('id') or e.get('source')
            if ident:
                add('data/%s/%s-%s.json' % (sub, sub, str(ident).lower()))
    except Exception:
        pass

dead = sorted(on_disk - reach)
total = sum(os.path.getsize(p) for p in dead)
sys.stdout.write('data files on disk : %d\n' % len(on_disk))
sys.stdout.write('reachable          : %d\n' % len(reach))
sys.stdout.write('UNREACHABLE        : %d  (%.1f MB)\n\n' % (len(dead), total / 1048576.0))

by_dir = collections.Counter()
for p in dead:
    by_dir['/'.join(p.split('/')[:2])] += os.path.getsize(p)
for d, s in by_dir.most_common(15):
    sys.stdout.write('  %-28s %7.2f MB\n' % (d, s / 1048576.0))

sys.stdout.write('\nlargest unreachable files:\n')
for p in sorted(dead, key=os.path.getsize, reverse=True)[:15]:
    sys.stdout.write('   %-52s %7.0f KB\n' % (p, os.path.getsize(p) / 1024.0))
