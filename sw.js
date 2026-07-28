/*
 * SKT Campaign Workspace — service worker.
 *
 * Generated fields (BUILD, PRECACHE) are stamped by tools/stamp-build.js.
 * DO NOT hand-edit them; run `node tools/stamp-build.js` instead.
 *
 * CACHING STRATEGY, and why each choice
 * -------------------------------------
 * Navigations (HTML)  → network-first, cache fallback.
 *     The HTML is tiny (~17 KB) and is the pointer to every hashed asset URL.
 *     Fetching it fresh whenever we're online is what makes stale code
 *     IMPOSSIBLE: a new build changes the ?v= hashes inside it, which are
 *     cache misses, which pull the new JS. Offline, we fall back to the
 *     precached copy so the app still boots.
 * js/ + styles/       → cache-first.
 *     Safe precisely because the URLs are content-hashed — a changed file is
 *     a different URL, so "cache forever" can never serve stale code.
 * data/*.json         → stale-while-revalidate.
 *     ~24 MB of 5etools data that changes rarely. Serve instantly from cache,
 *     refresh in the background, so an edited data file self-heals on the
 *     next load without any manual version bump.
 * img/                → cache-on-use, hard-capped.
 *     3.7 GB on disk — precaching is impossible. Cache what's actually used
 *     and trim oldest-first so a session browsing maps can't fill the quota.
 * Anything cross-origin (Firebase, gstatic) → NOT INTERCEPTED AT ALL.
 *     Realtime sync must always reach the network. The same-origin guard in
 *     the fetch handler is the single most important line in this file.
 */
'use strict';

const BUILD = '546c04f284';
const PRECACHE = [
  './',
  'skt-workspace.html',
  'styles/main.css?v=737cbe7d18',
  'js/data.js?v=4271d26464',
  'js/theme.js?v=533ffb6fb1',
  'js/utils.js?v=1afcb8d7ff',
  'js/state.js?v=f59175b98e',
  'js/window-manager.js?v=e88d7a8da0',
  'js/panels/combat.js?v=77e9effef0',
  'js/panels/party.js?v=4e582f8172',
  'js/panels/shop.js?v=9834741b8b',
  'js/notes-sync.js?v=8b74d04e3a',
  'js/dropbox-config.js?v=ccf8533d50',
  'js/dropbox-sync.js?v=90ddfd734c',
  'js/panels/notes.js?v=801ba3a8b8',
  'js/panels/battlemap.js?v=73645a81aa',
  'js/panels/npc-library.js?v=892b488fee',
  'js/panels/bestiary.js?v=8f31463083',
  'js/panels/adventures.js?v=d562953f3b',
  'js/panels/books.js?v=7a58b1a258',
  'js/panels/npc-generator.js?v=2be67577d7',
  'js/panels/loot.js?v=d486c19305',
  'js/panels/encounter.js?v=5351dd6bc0',
  'js/panels/soundboard.js?v=c57dfee938',
  'js/panels/weather.js?v=d7dd02abd8',
  'js/panels/timetracker.js?v=38051fc485',
  'js/data-loader.js?v=24ad236e15',
  'js/search.js?v=682b910e5d',
  'js/settings.js?v=a6c9492896',
  'js/context-menu.js?v=92f9a49378',
  'js/zoom-pan.js?v=0e8544341a',
  'js/pdf-import.js?v=0ae3653bd8',
  'js/player-view.js?v=a806602667',
  'js/realtime.js?v=46c05adbd0',
  'js/tutorial.js?v=0f28ad967f',
  'js/onboarding.js?v=7e4c89c909',
  'js/app.js?v=05d965a6b5',
];

const SHELL_CACHE = 'skt-shell-' + BUILD;   // swapped wholesale each build
const DATA_CACHE  = 'skt-data-v1';          // survives builds; self-refreshing
const IMG_CACHE   = 'skt-img-v1';           // survives builds; capped
const IMG_MAX_ENTRIES = 120;

const KEEP = [SHELL_CACHE, DATA_CACHE, IMG_CACHE];

// ─── Install: precache the shell ─────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Individually, not addAll: addAll rejects the whole batch if any single
    // request fails, which would leave the worker uninstalled over one
    // missing file. A partial shell still beats no offline support.
    await Promise.all(PRECACHE.map(async url => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (e) { console.warn('[sw] precache skipped', url, e); }
    }));
    // NOTE: no skipWaiting() here. The new worker waits until the page tells
    // it to activate (see the SKIP_WAITING message below), so the user gets a
    // deliberate "new version — reload" prompt instead of having code swapped
    // underneath a live session.
  })());
});

// ─── Activate: drop every bucket that isn't current ──────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(n => {
      if (KEEP.includes(n)) return null;
      // Only touch our own buckets — never delete another app's cache.
      if (!/^skt-(shell|data|img)-/.test(n)) return null;
      return caches.delete(n);
    }));
    await self.clients.claim();
  })());
});

// The page posts this when the user accepts the update prompt.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function trimCache(name, max){
  const cache = await caches.open(name);
  const keys = await cache.keys();
  // Cache.keys() returns insertion order, so the oldest entries are first.
  if (keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length - max).map(k => cache.delete(k)));
}

async function cacheFirst(request, cacheName){
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}

// `event` is threaded in so the background refresh can be registered with
// event.waitUntil() — without it the browser is free to kill the worker as
// soon as respondWith settles, silently cancelling the revalidation.
async function staleWhileRevalidate(event, request, cacheName){
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request).then(res => {
    if (res && res.ok) return cache.put(request, res.clone()).then(() => res);
    return res;
  }).catch(() => null);
  // Serve the cached copy immediately when we have one; the refresh continues
  // in the background and lands for the next load.
  if (hit){ event.waitUntil(network); return hit; }
  const res = await network;
  if (res) return res;
  throw new Error('offline and uncached: ' + request.url);
}

async function networkFirst(request, cacheName){
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(request) || await cache.match('skt-workspace.html');
    if (hit) return hit;
    throw e;
  }
}

// ─── Fetch router ────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;

  // GUARD — everything below this line is same-origin GET only.
  // Firebase (realtime sync, auth) and gstatic are cross-origin and must
  // always go straight to the network; intercepting them would break sync.
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  // Navigations: always try the network so the freshest HTML (and therefore
  // the freshest asset hashes) wins whenever we're online.
  if (req.mode === 'navigate'){
    event.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }

  const p = url.pathname;
  if (/\/data\/.+\.json$/i.test(p)){
    event.respondWith(staleWhileRevalidate(event, req, DATA_CACHE));
    return;
  }
  if (/\/img\//i.test(p)){
    event.respondWith(cacheFirst(req, IMG_CACHE));
    event.waitUntil(trimCache(IMG_CACHE, IMG_MAX_ENTRIES));
    return;
  }
  if (/\.(js|css|svg|woff2?|png|webp|ico)$/i.test(p)){
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }
  // Anything else same-origin: plain network, no caching.
});
