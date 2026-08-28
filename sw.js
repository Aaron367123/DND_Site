/*
 * SKT Campaign Workspace — service worker.
 *
 * Generated fields (BUILD, PRECACHE, DATA_STAMP) are stamped by
 * tools/stamp-build.js.
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
 * data/*.json         → cache-first, bucket keyed to DATA_STAMP.
 *     ~30 MB of 5etools data that only changes when the dump is refreshed.
 *     This was stale-while-revalidate, which sounds right but fires fetch()
 *     even on a cache hit — so every page load re-downloaded all 289 files,
 *     29.9 MB, per device, forever, to replace them with identical bytes.
 *     Freshness instead comes from the bucket name: bump DATA_STAMP in
 *     js/content/data-loader.js when the data changes and every client
 *     re-fetches once. That stamp already gates the in-app index cache, so
 *     there is exactly one thing to bump.
 * img/                → cache-on-use, hard-capped.
 *     3.7 GB on disk — precaching is impossible. Cache what's actually used
 *     and trim oldest-first so a session browsing maps can't fill the quota.
 * Anything cross-origin (Firebase, gstatic) → NOT INTERCEPTED AT ALL.
 *     Realtime sync must always reach the network. The same-origin guard in
 *     the fetch handler is the single most important line in this file.
 */
'use strict';

const BUILD = 'ae22d6d1f3';
const PRECACHE = [
  'skt-workspace.html',
  'styles/main.css?v=337138e9a5',
  'js/core/errors.js?v=67c70f2e1d',
  'js/core/data.js?v=28f4faf7d2',
  'js/core/theme.js?v=4589bc6790',
  'js/core/asset-config.js?v=9b018a4988',
  'js/generated/token-index.js?v=e043a461be',
  'js/core/utils.js?v=2adfa184c6',
  'js/core/state.js?v=3360b6540c',
  'js/core/window-manager.js?v=5ba37f5fde',
  'js/panels/combat.js?v=c6af9aaec1',
  'js/panels/attacks.js?v=cbee1aeeb4',
  'js/generated/reactions.js?v=faa668dc18',
  'js/generated/rules.js?v=8efb8beae9',
  'js/panels/turnview.js?v=66900e6a7e',
  'js/panels/party.js?v=bbf4c68ecf',
  'js/panels/shop.js?v=fadf7d5fe3',
  'js/sync/notes-sync.js?v=8c42540638',
  'js/sync/dropbox-config.js?v=ccf8533d50',
  'js/sync/dropbox-sync.js?v=ab773edfd6',
  'js/panels/notes.js?v=a79f810a45',
  'js/panels/battlemap.js?v=c82ea72a66',
  'js/panels/npc-library.js?v=6986b9c7c2',
  'js/panels/bestiary.js?v=bc58b530c6',
  'js/panels/content-panel.js?v=5e25eeb8a7',
  'js/panels/adventures.js?v=adbf195007',
  'js/panels/books.js?v=beba2c9cfd',
  'js/panels/npc-generator.js?v=924ebfdef8',
  'js/panels/loot.js?v=0f5520abe8',
  'js/panels/encounter.js?v=2262d7be9a',
  'js/panels/soundboard.js?v=6ee51d8589',
  'js/panels/weather.js?v=ab1bd498ab',
  'js/panels/timetracker.js?v=9749770a5a',
  'js/content/data-loader.js?v=7bd91b7bcf',
  'js/content/search.js?v=833e7d7f77',
  'js/features/backup.js?v=3ea025e529',
  'js/ui/settings.js?v=19cb2d3859',
  'js/ui/context-menu.js?v=5402b4bfbf',
  'js/ui/zoom-pan.js?v=31a2882b02',
  'js/ui/workspaces.js?v=bdaf579267',
  'js/features/pdf-import.js?v=06787122c5',
  'js/player/player-app.js?v=12fbc158a2',
  'js/ui/player-view.js?v=7519877ed8',
  'js/sync/realtime.js?v=0d8e54cb78',
  'js/ui/tutorial.js?v=e47e670b86',
  'js/ui/onboarding.js?v=42199a671a',
  'js/app.js?v=f950284ed2',
];

const SHELL_CACHE = 'skt-shell-' + BUILD;   // swapped wholesale each build
// Versioned by DATA_STAMP (stamped in from js/content/data-loader.js by
// tools/stamp-build.js — do not edit by hand). The 5etools dump is immutable
// between refreshes, so the bucket only needs to change when the data does.
// Bumping DATA_STAMP already invalidates the in-app index cache; now it
// invalidates the HTTP cache too, from the same single source of truth.
// The activate handler deletes any skt-data-* bucket that isn't this one, so
// the changeover is automatic.
const DATA_STAMP  = '20260804a';
const DATA_CACHE  = 'skt-data-' + DATA_STAMP;
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
    // One-time repair: thumbnails were being filed into IMG_CACHE because the
    // /thumbs/ route was unreachable for cross-origin URLs. IMG_CACHE is in
    // KEEP, so those entries survive the sweep above and go on crowding the
    // 120-entry cap that full-size maps share. Evict them here; they will be
    // re-fetched into THUMB_CACHE where they belong.
    try {
      const img = await caches.open(IMG_CACHE);
      const stale = (await img.keys()).filter(k => /\/thumbs\//i.test(new URL(k.url).pathname));
      await Promise.all(stale.map(k => img.delete(k)));
    } catch (e) { /* a failed repair must never block activation */ }
    await self.clients.claim();
  })());
});

// The page posts this when the user accepts the update prompt.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
// Serialized per cache name. Opening the map picker fires ~68 image requests
// at once, each of which schedules a trim; run concurrently they every one
// read the same pre-trim key list and each compute "delete keys.length - max"
// from it, so they collectively delete far more than the overflow — repeatedly
// emptying a cache that was only a little over its cap. Chaining them means
// each trim sees the previous one's result.
const _trimQueue = Object.create(null);
function trimCache(name, max){
  const prev = _trimQueue[name] || Promise.resolve();
  const next = prev.then(async () => {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    // Cache.keys() returns insertion order, so the oldest entries are first.
    if (keys.length <= max) return;
    await Promise.all(keys.slice(0, keys.length - max).map(k => cache.delete(k)));
  }).catch(() => {});
  _trimQueue[name] = next;
  return next;
}

// Write-behind. Never awaited, so its rejection has to be swallowed HERE or it
// surfaces as an unhandled rejection in the page console. A put can fail for
// reasons that are none of the caller's business — origin quota, a partial
// (206) response, the bucket being deleted by a concurrent activate sweep — and
// none of them should turn a served response into a visible error.
function _putQuiet(cache, request, res){
  try { cache.put(request, res).catch(() => {}); } catch (e) { /* sync throw */ }
}

async function cacheFirst(request, cacheName){
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  let res;
  try {
    res = await fetch(request);
  } catch (e) {
    // Observed against the R2 CDN: an edge node answered without an
    // Access-Control-Allow-Origin header, so this CORS fetch rejected with
    // "TypeError: Failed to fetch" and logged `Uncaught (in promise) ... at
    // cacheFirst` for every retry. Reject the respondWith and Chrome reports it
    // as an uncaught rejection; resolve with a synthetic error response and the
    // consumer sees exactly the same failure — an <img> still fires onerror,
    // fetch() still sees !res.ok — with no console noise and no lost detail,
    // because the reason travels in the status text.
    return new Response('', {
      status: 504,
      statusText: 'SW fetch failed: ' + ((e && e.name) || 'Error'),
    });
  }
  if (res && res.ok) _putQuiet(cache, request, res.clone());
  return res;
}

async function networkFirst(request, cacheName){
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok) _putQuiet(cache, request, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(request) || await cache.match('skt-workspace.html');
    if (hit) return hit;
    // Nothing cached and no network. Rethrowing here is deliberate and
    // different from cacheFirst: this is a NAVIGATION, and a browser error page
    // is far more useful to a DM mid-session than a blank 504 body.
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
      // Thumbnails go in their OWN bucket, and the check has to happen HERE.
      // The /thumbs/ route further down sits after this early return, so once
      // the images moved to the CDN it became unreachable: every thumbnail
      // was filed in IMG_CACHE instead, which is capped at 120 against
      // THUMB_CACHE's 1500. Opening the map picker fires ~68 thumbnail
      // requests at once, so a couple of picker visits blow straight through
      // the cap and evict the full-size maps — exactly the failure the
      // comment on the /thumbs/ route was written to prevent. skt-thumb-v1
      // never even got created on the deployed site; the live cache list was
      // shell/data/img only, which is what gave it away.
      const isThumb = /\/thumbs\//i.test(url.pathname);
      const bucket  = isThumb ? THUMB_CACHE : IMG_CACHE;
      const cap     = isThumb ? THUMB_MAX_ENTRIES : IMG_MAX_ENTRIES;
      event.respondWith(cacheFirst(req, bucket));
      event.waitUntil(trimCache(bucket, cap));
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
  // Cache-first, NOT stale-while-revalidate.
  //
  // SWR fires fetch() unconditionally — including on a cache hit — so every
  // single page load quietly re-downloaded the whole 5etools dump in the
  // background: 289 files, 29.9 MB, per device, per load, forever. Measured
  // against the live site. It bought nothing, because the payload is
  // byte-identical until the dump is refreshed, and it competed for bandwidth
  // with the index build (5.2 s cold on a real connection).
  //
  // Freshness now comes from DATA_CACHE being keyed to DATA_STAMP: change the
  // data, bump the stamp, every client fetches once and then stops.
  if (/\/data\/.+\.json$/i.test(p)){
    event.respondWith(cacheFirst(req, DATA_CACHE));
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
