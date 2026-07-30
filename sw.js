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

const BUILD = '48c6f3a2ec';
const PRECACHE = [
  'skt-workspace.html',
  'styles/main.css?v=35667c8e20',
  'js/core/errors.js?v=568f89ffd1',
  'js/core/data.js?v=4271d26464',
  'js/core/theme.js?v=533ffb6fb1',
  'js/core/asset-config.js?v=9b018a4988',
  'js/generated/token-index.js?v=e043a461be',
  'js/core/utils.js?v=3ede2d8e37',
  'js/core/state.js?v=f59175b98e',
  'js/core/window-manager.js?v=e88d7a8da0',
  'js/panels/combat.js?v=1f8612d914',
  'js/panels/party.js?v=4e582f8172',
  'js/panels/shop.js?v=39acf9d21b',
  'js/sync/notes-sync.js?v=8c42540638',
  'js/sync/dropbox-config.js?v=ccf8533d50',
  'js/sync/dropbox-sync.js?v=3814f317a9',
  'js/panels/notes.js?v=4baaf07127',
  'js/panels/battlemap.js?v=77deba5e98',
  'js/panels/npc-library.js?v=ef2e523574',
  'js/panels/bestiary.js?v=82bf3c5db4',
  'js/panels/content-panel.js?v=4d5ee5f31a',
  'js/panels/adventures.js?v=66fdb095a9',
  'js/panels/books.js?v=75cd5addb6',
  'js/panels/npc-generator.js?v=8d9da454f7',
  'js/panels/loot.js?v=824fbb5705',
  'js/panels/encounter.js?v=76d4f06a4b',
  'js/panels/soundboard.js?v=611bf224d4',
  'js/panels/weather.js?v=b318dd7112',
  'js/panels/timetracker.js?v=3906d0ae60',
  'js/content/data-loader.js?v=6545556640',
  'js/content/search.js?v=b9d72e0409',
  'js/features/backup.js?v=aa3d74defd',
  'js/ui/settings.js?v=19cb2d3859',
  'js/ui/context-menu.js?v=92f9a49378',
  'js/ui/zoom-pan.js?v=0e8544341a',
  'js/features/pdf-import.js?v=0ae3653bd8',
  'js/ui/player-view.js?v=a806602667',
  'js/sync/realtime.js?v=cd6d078825',
  'js/ui/tutorial.js?v=0f28ad967f',
  'js/ui/onboarding.js?v=7e4c89c909',
  'js/app.js?v=9045fd4214',
];

const SHELL_CACHE = 'skt-shell-' + BUILD;   // swapped wholesale each build
const DATA_CACHE  = 'skt-data-v1';          // survives builds; self-refreshing
const IMG_CACHE   = 'skt-img-v1';           // survives builds; capped
const IMG_MAX_ENTRIES = 120;
// Separate bucket for browse thumbnails — small (~27 KB) and numerous, so
// they get a far higher cap and can't evict full-size maps.
const THUMB_CACHE = 'skt-thumb-v1';
const THUMB_MAX_ENTRIES = 1500;

// Cross-origin hosts allowed to be intercepted for image caching. Keep this
// in sync with ASSET_CONFIG.imgBase in js/core/asset-config.js — if they disagree,
// images silently stop being cached offline (no error, just misses).
// Origin only: 'https://pub-xxxx.r2.dev', no path, no trailing slash.
const IMG_ORIGINS = ['https://pub-4b8864700c38402395c9f9951ed106ce.r2.dev'];

const KEEP = [SHELL_CACHE, DATA_CACHE, IMG_CACHE, THUMB_CACHE];

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
      if (!/^skt-(shell|data|img|thumb)-/.test(n)) return null;
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

  // GUARD — same-origin GET only, with ONE narrow exception below.
  // Firebase (realtime sync, auth) and gstatic are cross-origin and must
  // always go straight to the network; intercepting them would break sync.
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  if (url.origin !== self.location.origin) {
    // The image CDN is the only cross-origin host we ever touch. This is
    // strictly narrower than "block everything cross-origin" — it matches one
    // exact origin string — so Firebase/gstatic still fall straight through.
    // Empty until the images actually move (see js/core/asset-config.js); while
    // empty this branch can never match and behavior is unchanged.
    //
    // IMPORTANT: the bucket must send CORS headers and the <img> tags must
    // carry crossorigin="anonymous". Without that, responses come back
    // `opaque` — cacheFirst's `res.ok` check is always false so nothing is
    // ever cached, and force-caching them instead would charge ~7 MB of
    // padding PER ENTRY against origin quota, risking eviction of the app
    // shell itself. CORS is the fix; do not relax the res.ok check.
    if (IMG_ORIGINS.length && IMG_ORIGINS.indexOf(url.origin) !== -1) {
      event.respondWith(cacheFirst(req, IMG_CACHE));
      event.waitUntil(trimCache(IMG_CACHE, IMG_MAX_ENTRIES));
    }
    return;
  }

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
  // Thumbnails get their OWN bucket with a much higher cap. They're ~27 KB
  // each (vs ~500 KB for a full map), so a single map-picker scroll would
  // otherwise evict every cached full-size map from IMG_CACHE. They must also
  // not fall through to the .webp rule below, which would put them in the
  // shell bucket and wipe them on every build.
  if (/\/thumbs\//i.test(p)){
    event.respondWith(cacheFirst(req, THUMB_CACHE));
    event.waitUntil(trimCache(THUMB_CACHE, THUMB_MAX_ENTRIES));
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
