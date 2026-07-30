// ============================================================
// REALTIME SYNC — Firebase Realtime Database
// ============================================================
//
// SETUP (one-time, takes ~5 minutes):
//   1. Go to https://console.firebase.google.com
//   2. Click "Add project" → give it any name → Continue
//   3. In the left sidebar: Build → Realtime Database → Create database
//      → Choose a region → Start in TEST MODE → Enable
//   4. In the left sidebar: Project Settings (gear icon) → Your apps
//      → Click the </> (web) button → Register app → copy the firebaseConfig object
//   5. Paste the 7 values from that config into FIREBASE_CONFIG below
//   6. Done — host the folder online and share the URL
//
// ⚠ The REPLACE_ME values below will prevent sync until you fill them in.
//   The app still works fully offline with localStorage while config is missing.
//

const firebaseConfig = {
  apiKey: "AIzaSyA0gavae4qacYehTJiouwVzmeVvqFnIPSk",
  authDomain: "dnd-campaign-92c87.firebaseapp.com",
  databaseURL: "https://dnd-campaign-92c87-default-rtdb.firebaseio.com",
  projectId: "dnd-campaign-92c87",
  storageBucket: "dnd-campaign-92c87.firebasestorage.app",
  messagingSenderId: "358879445671",
  appId: "1:358879445671:web:4e285602117f566af1d182"
};

// localStorage keys to sync across all connected clients.
// skt-layout-v1 is intentionally excluded — each user manages their own panel positions.
const SKT_SYNC_KEYS = [
  // The old combined 'skt-workspace-v1' blob is split into per-domain keys:
  // an HP tick now ships ~1KB of combat state instead of the whole
  // workspace, and edits in different domains can never conflict.
  'skt-party-v1',      // party tracker characters
  'skt-combat-v1',     // combat tracker (combatants, round, active turn)
  'skt-shop-v1',       // shop inventory
  'skt-settings-v1',   // shared campaign settings
  'skt-battlemap-v1',  // battle map tokens & fog
  'skt-enc-v1',        // encounter builder
  'skt-loot-v1',       // loot tracker
  'skt-notes-v2',      // session notes — per-note entity nodes (see below).
  // Notes were originally excluded ("payloads can be 200KB+ per push") and
  // rode on Dropbox polling instead. The entity layer removes that concern:
  // only the note being edited pushes, so Firebase now carries notes too and
  // Dropbox is demoted to a write-through backup (no polling, no pull).
  'skt-npcs-v2',       // NPC library
  'skt-bestiary-v1',   // bestiary
  'skt-shared-panels-v1',  // which panels the DM is sharing with players
  'skt-books-hidden-v1',   // hidden-books filter — propagates to every tab
                           // so the DM's curated source list affects every
                           // player's search / shop / encounter dropdowns too
  'skt-adventures-hidden-v1', // same idea for hidden adventures (LMoP, SKT,
                              // ToA, …). Adventure IDs match `_source` tags
                              // on items / monsters from those modules.
];

// Record a handled-but-unexpected failure into the diagnostics log
// (Settings → Diagnostics) without changing behaviour: no toast, no rethrow.
//
// The sync layer used to swallow these into bare `catch(e){}`. That's the
// right *behaviour* — one corrupt node must not abort a whole assemble — but
// it left no trace, so "a combatant vanished" or "sync just stopped" was
// unfalsifiable after the fact. Self-contained and null-guarded so a missing
// errors.js can never turn a swallowed error into a thrown one.
function _diag(what, e) {
  try { if (window.sktErrors) sktErrors.report('realtime:' + what, e); } catch(_){}
}

// Firebase keys cannot contain hyphens or dots — convert to underscores
function _toFbKey(lsKey) { return lsKey.replace(/[-\.]/g, '_'); }

let _remoteUpdate = false;        // true while applying remote changes → prevents echo writes
let _pushTimer    = null;         // debounce handle for outgoing writes
let _fbDb         = null;         // Firebase database reference
const _dirtyKeys  = new Set();    // sync keys that have changed since last flush
// Echo-suppression registry. Each value is a {pushed: Map<value, count>}
// — a multiset of values we've pushed since the last echo for them came
// back. Tracking only the LATEST push (the old single-string design) loses
// the suppression key whenever a second flush overwrites it before the
// first echo arrives, leading to silent data loss (the older echo gets
// applied and clobbers the newer local value). The multiset matches each
// inbound echo to whichever value it carries, regardless of how many
// flushes have piled up in flight.
const _justWrote  = {};
// True conflicts: keys where a remote value arrived while a local change was
// still pending its first flush. {[key]: {local, remote, ts}} until the user
// resolves via the conflict bar. No automatic merge — JSON shapes vary too
// much. Display labels for the keys are in _CONFLICT_LABELS below.
const _conflicts = {};
const _CONFLICT_LABELS = {
  'skt-party-v1':         'Party tracker',
  'skt-combat-v1':        'Combat tracker',
  'skt-shop-v1':          'Shop',
  'skt-settings-v1':      'Settings',
  'skt-shared-panels-v1': 'Shared panels',
  'skt-notes-data':       'Notes',
  'skt-bestiary-v1':      'Bestiary',
  'skt-loot-data':        'Loot',
  'skt-npclib-data':      'NPC Library',
  'skt-battlemap-v1':     'Battle map',
  'skt-books-hidden-v1':      'Hidden books',
  'skt-adventures-hidden-v1': 'Hidden adventures',
};

// Which panels to refresh when a particular sync key changes. Avoids re-rendering
// the whole world when a single subsystem updates.
const _PANELS_FOR_KEY = {
  // party and combat cross-refresh: combat cards mirror PC hp/ac, and party
  // cards show the "in combat" badge.
  'skt-party-v1':    ['party', 'combat'],
  'skt-combat-v1':   ['combat', 'party'],
  'skt-shop-v1':     ['shop'],
  'skt-settings-v1': ['combat', 'party', 'shop'],      // display modes, hp bars, filters
  'skt-battlemap-v1': ['battlemap'],
  'skt-enc-v1':       ['encounter'],
  'skt-loot-v1':      ['loot'],
  // 'skt-notes-v2' deliberately omitted — notes sync via Dropbox/local FS.
  'skt-npcs-v2':      ['npclib'],
  'skt-bestiary-v1':  ['bestiary'],
  // skt-shared-panels-v1 has no per-panel render — it's dispatched manually
  // in _applyRemoteKey so the player view can mount/unmount whole panels.
};

// ─── Entity-level sync (sync redesign, step 2) ───────────────────────────────
// Combat and the battlemap sync as SMALL PER-ENTITY Firebase nodes under a
// v2 subtree instead of one whole-key string:
//
//   skt/combat_v2/meta            {round, activeId, order:[ids]}
//   skt/combat_v2/items/{id}      one combatant each
//   skt/battlemap_v2/meta         grid/scale/rotation/… scalars
//   skt/battlemap_v2/tokens/{id}  one token each
//   skt/battlemap_v2/fog|fogStrokes|drawings
//
// Locally NOTHING changes — panels still read/write the same localStorage
// keys; explode() splits the stored JSON into nodes on push and assemble()
// rebuilds it on receive. What it buys:
//   • an HP tick ships ~200 bytes (that combatant) instead of the whole key;
//   • edits to DIFFERENT combatants/tokens from two devices MERGE at the
//     entity level instead of last-write-wins clobbering the loser;
//   • same-entity races stay LWW — acceptable for this app, and no worse
//     than before.
const _ENTITY_KEYS = {
  'skt-combat-v1': {
    base: 'skt/combat_v2',
    legacyNode: 'skt/skt_combat_v1',   // step-1 whole-key node, migration fallback
    explode(s){
      const d = JSON.parse(s) || {};
      const list = Array.isArray(d.combatants) ? d.combatants : [];
      const nodes = { meta: JSON.stringify({
        combatRound: d.combatRound || 0,
        activeCombatantId: d.activeCombatantId ?? null,
        order: list.map(c => _fbSafeId(c.id)),
      }) };
      list.forEach(c => { nodes['items/' + _fbSafeId(c.id)] = JSON.stringify(c); });
      return nodes;
    },
    assemble(nodes){
      let meta = {}; try { meta = JSON.parse(nodes.meta || '{}') || {}; } catch(e){ _diag('combat meta', e); }
      const items = {};
      Object.keys(nodes).forEach(n => {
        if (!n.startsWith('items/')) return;
        try { const c = JSON.parse(nodes[n]); if (c && c.id != null) items[_fbSafeId(c.id)] = c; } catch(e){ _diag('combat node ' + n, e); }
      });
      const combatants = [], used = new Set();
      (Array.isArray(meta.order) ? meta.order : []).forEach(id => {
        if (items[id]){ combatants.push(items[id]); used.add(id); }
      });
      Object.keys(items).forEach(id => { if (!used.has(id)) combatants.push(items[id]); });
      return JSON.stringify({ combatants, combatRound: meta.combatRound || 0, activeCombatantId: meta.activeCombatantId ?? null });
    },
    postApply(){ loadDomain('combat'); ['combat','party'].forEach(_reloadPanel); },
  },
  'skt-battlemap-v1': {
    base: 'skt/battlemap_v2',
    legacyNode: 'skt/skt_battlemap_v1',
    explode(s){
      const d = JSON.parse(s) || {};
      const nodes = {};
      (Array.isArray(d.tokens) ? d.tokens : []).forEach(t => {
        nodes['tokens/' + _fbSafeId(t.id)] = JSON.stringify(t);
      });
      nodes.fog        = JSON.stringify(d.fog ?? null);
      nodes.fogStrokes = JSON.stringify(d.fogStrokes || []);
      nodes.drawings   = JSON.stringify(d.drawings || []);
      const meta = {...d};
      delete meta.tokens; delete meta.fog; delete meta.fogStrokes; delete meta.drawings;
      nodes.meta = JSON.stringify(meta);
      return nodes;
    },
    assemble(nodes){
      let meta = {}; try { meta = JSON.parse(nodes.meta || '{}') || {}; } catch(e){ _diag('battlemap meta', e); }
      const tokens = [];
      Object.keys(nodes).forEach(n => {
        if (!n.startsWith('tokens/')) return;
        try { const t = JSON.parse(nodes[n]); if (t) tokens.push(t); } catch(e){ _diag('battlemap node ' + n, e); }
      });
      const parse = (n, fb) => { try { return nodes[n] != null ? JSON.parse(nodes[n]) : fb; } catch(e){ return fb; } };
      return JSON.stringify({ ...meta, tokens, fog: parse('fog', null), fogStrokes: parse('fogStrokes', []), drawings: parse('drawings', []) });
    },
    postApply(){ _reloadPanel('battlemap'); },
    // Don't stomp an in-flight token drag — the drag-end save re-pushes
    // local state (LWW) and reconciles.
    holdOff(){ const d = (typeof panelDefs !== 'undefined') && panelDefs.battlemap; return !!(d && d._drag); },
  },
  'skt-notes-v2': {
    base: 'skt/notes_v3',
    legacyNode: null,  // notes never had a whole-key Firebase node
    explode(s){
      const d = JSON.parse(s) || {};
      const items = Array.isArray(d.items) ? d.items : [];
      const nodes = { meta: JSON.stringify({
        order: items.map(i => _fbSafeId(i.id)),
        authors: d.authors || {},
      }) };
      items.forEach(it => { nodes['items/' + _fbSafeId(it.id)] = JSON.stringify(it); });
      return nodes;
    },
    assemble(nodes){
      let meta = {}; try { meta = JSON.parse(nodes.meta || '{}') || {}; } catch(e){ _diag('notes meta', e); }
      const map = {};
      Object.keys(nodes).forEach(n => {
        if (!n.startsWith('items/')) return;
        try { const it = JSON.parse(nodes[n]); if (it && it.id != null) map[_fbSafeId(it.id)] = it; } catch(e){ _diag('notes node ' + n, e); }
      });
      const items = [], used = new Set();
      (Array.isArray(meta.order) ? meta.order : []).forEach(id => {
        if (map[id]){ items.push(map[id]); used.add(id); }
      });
      Object.keys(map).forEach(id => { if (!used.has(id)) items.push(map[id]); });
      // selectedId is per-device UI state — keep whatever THIS device had,
      // falling back to the first file if the selection was deleted remotely.
      let selectedId = null;
      try { selectedId = (JSON.parse(localStorage.getItem('skt-notes-v2') || '{}')).selectedId ?? null; } catch(e){ _diag('notes selectedId', e); }
      if (selectedId && !items.find(i => i.id === selectedId)) selectedId = null;
      if (!selectedId) selectedId = (items.find(i => i.type === 'file') || {}).id || null;
      return JSON.stringify({ items, selectedId, authors: meta.authors || {} });
    },
    postApply(){ _reloadPanel('notes'); },
    // Never re-render under the user's cursor mid-edit; the next event or
    // the focus-refresh reconciles once they're done typing.
    holdOff(){ const d = (typeof panelDefs !== 'undefined') && panelDefs.notes; return !!(d && d._editing); },
  },
};
function _fbSafeId(id){ return String(id).replace(/[.#$\/\[\]]/g, '_'); }
// Last known SERVER state per entity key: {nodeName: jsonString}. Flush
// diffs against it (only changed nodes go out); receive compares against it
// (identical snapshot = our own echo / no-op → skip).
const _entityCache = {};
function _flattenEntitySnap(val){
  const out = {};
  if (!val || typeof val !== 'object') return out;
  Object.keys(val).forEach(k1 => {
    const v = val[k1];
    if (v && typeof v === 'object'){
      Object.keys(v).forEach(k2 => { out[k1 + '/' + k2] = typeof v[k2] === 'string' ? v[k2] : JSON.stringify(v[k2]); });
    } else {
      out[k1] = typeof v === 'string' ? v : JSON.stringify(v);
    }
  });
  return out;
}

// Returns a promise resolving true once the push lands, false if it didn't
// (or if there was nothing to do). Callers that just want fire-and-forget
// can ignore it; the backup restore awaits it, because it must not reload
// the page until the server actually holds the restored data.
function _flushEntityKey(k){
  if (!_fbDb) return Promise.resolve(false);
  const spec = _ENTITY_KEYS[k];
  const local = localStorage.getItem(k);
  // Key deliberately emptied or removed (backup restore clearing state the
  // file doesn't contain). Returning early here would leave every exploded
  // node sitting on the server, and the next load would pull the deleted
  // data straight back. Drop the whole subtree instead.
  if (local == null || local === ''){
    _entityCache[k] = {};
    return _fbDb.ref(spec.base).remove()
      .then(() => { delete _retryCounts[k]; return true; })
      .catch(err => { console.warn('[realtime] Entity clear failed for ' + k, err); return false; });
  }
  let nodes;
  try { nodes = spec.explode(local); } catch(e){ return Promise.resolve(false); }
  const prev = _entityCache[k] || {};
  const updates = {};
  Object.keys(nodes).forEach(n => { if (prev[n] !== nodes[n]) updates[spec.base + '/' + n] = nodes[n]; });
  Object.keys(prev).forEach(n => { if (!(n in nodes)) updates[spec.base + '/' + n] = null; });
  if (!Object.keys(updates).length) return Promise.resolve(true);
  // Optimistic cache update — the echo snapshot must match the cache so it
  // gets recognized and skipped. Rolled back on failure so a retry re-diffs.
  _entityCache[k] = nodes;
  return _fbDb.ref().update(updates).then(() => {
    delete _retryCounts[k];
    return true;
  }).catch(err => {
    _entityCache[k] = prev;
    const n = (_retryCounts[k] || 0) + 1;
    _retryCounts[k] = n;
    if (n <= _MAX_RETRIES){
      _dirtyKeys.add(k);
      const delay = Math.min(5000, 300 * Math.pow(2, n - 1)) + Math.random() * 300;
      setTimeout(_flushDirtyKeys, delay);
      console.warn('[realtime] Entity push failed for ' + k + ' (retry ' + n + '/' + _MAX_RETRIES + ')', err);
    } else {
      console.error('[realtime] Entity push gave up for ' + k, err);
      delete _retryCounts[k];
      if (typeof showToast === 'function') showToast('Live sync failed — your last change may not have reached other players');
    }
    return false;
  });
}

function _applyEntitySnapshot(k, snapVal){
  const spec = _ENTITY_KEYS[k];
  const serverNodes = _flattenEntitySnap(snapVal);
  const prevCache = _entityCache[k] || {};
  const sNames = Object.keys(serverNodes);
  if (sNames.length === Object.keys(prevCache).length && sNames.every(n => serverNodes[n] === prevCache[n])){
    return; // echo of our own push, or no-op
  }
  // Per-key hold-off: skip applying while the user is mid-interaction
  // (battlemap token drag, notes editing) — the next event or the focus
  // refresh reconciles once they're done.
  if (spec.holdOff && spec.holdOff()) return;
  // Entity-level merge: keep OUR locally-pending entity changes (dirty key,
  // not yet flushed), take the server's version of everything else. This is
  // the step-2 payoff — a peer's goblin damage and our token move both land.
  let merged = {...serverNodes};
  if (_dirtyKeys.has(k)){
    try {
      const localNodes = spec.explode(localStorage.getItem(k) || 'null');
      new Set([...Object.keys(localNodes), ...Object.keys(prevCache)]).forEach(n => {
        if (localNodes[n] !== prevCache[n]){
          if (localNodes[n] === undefined) delete merged[n];
          else merged[n] = localNodes[n];
        }
      });
    } catch(e){ _diag('entity merge ' + k, e); }
  }
  _entityCache[k] = serverNodes;
  let assembled;
  // A throw here silently discards the ENTIRE remote update for this key —
  // the most consequential swallow in the file, and previously invisible.
  try { assembled = spec.assemble(merged); } catch(e){ _diag('assemble ' + k, e); return; }
  if (assembled === localStorage.getItem(k)) return; // nothing visible changed
  _remoteUpdate = true;
  try { localStorage.setItem(k, assembled); } finally { _remoteUpdate = false; }
  spec.postApply();
}

// ─── Intercept localStorage writes ────────────────────────────────────────────
// Any panel that calls localStorage.setItem('skt-*', ...) marks that key dirty
// and schedules a debounced push of only the dirty keys.
function _patchLocalStorage() {
  const _orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    // No-op writes (byte-identical value) neither store nor mark dirty.
    // save() serializes all four state domains on every call — this check
    // is what makes only the domain(s) that actually CHANGED sync out.
    if (SKT_SYNC_KEYS.includes(key) && this.getItem(key) === String(value)) return;
    _orig.call(this, key, value);
    if (!_remoteUpdate && SKT_SYNC_KEYS.includes(key) && _fbDb) {
      _dirtyKeys.add(key);
      clearTimeout(_pushTimer);
      _pushTimer = setTimeout(_flushDirtyKeys, 300);
    }
  };
}

// Push only the keys that changed. Originally used a single multi-path
// `update()` call but at least one Firebase configuration delivers the
// child-path `on('value')` listener inconsistently when the change comes
// from a multi-path update. Per-key `set()` is one extra HTTP round-trip
// per dirty key but reliably wakes each path's listener.
// Retry state keyed by sync key. Tracks how many attempts have been made
// for each in-flight push so we don't loop forever on a persistent failure
// (auth expired, server unreachable). Capped at MAX_RETRIES — after that
// the key sits dirty again and the next user write re-enqueues it.
const _retryCounts = {};
const _MAX_RETRIES = 4;
// Returns a promise resolving to an array of per-key booleans (true = the
// value reached the server). Fire-and-forget callers ignore it.
function _flushDirtyKeys() {
  if (!_fbDb || _dirtyKeys.size === 0) return Promise.resolve([]);
  const keys = Array.from(_dirtyKeys);
  _dirtyKeys.clear();
  return Promise.all(keys.map(k => {
    // Entity keys diff per-node and multi-path update() instead of pushing
    // the whole string.
    if (_ENTITY_KEYS[k]) return _flushEntityKey(k);
    const val = localStorage.getItem(k);
    // Remember exactly what we pushed so the listener can drop the one echo
    // that comes back to us. (Don't use a `localStorage===fbVal` check for
    // this — same-browser tabs share localStorage, which would falsely
    // suppress legitimate cross-tab updates.)
    //
    // Multiset: increment a counter per (key, value) pair. When the echo
    // for that exact value lands, we decrement; only when the counter hits
    // zero do we delete the entry. Two rapid flushes for the same key with
    // DIFFERENT values both get tracked; each echo matches the one it
    // carries. (The old single-string design overwrote the entry on the
    // second flush, causing the first echo to slip through and clobber
    // the second flush's value — silent data loss.)
    const norm = val != null ? val : '__null__';
    if (!_justWrote[k]) _justWrote[k] = new Map();
    _justWrote[k].set(norm, (_justWrote[k].get(norm) || 0) + 1);
    return _fbDb.ref('skt/' + _toFbKey(k)).set(val != null ? val : null).then(() => {
      // Success — clear retry counter so a future failure starts fresh.
      delete _retryCounts[k];
      return true;
    }).catch((err) => {
      // Failure — re-mark the key dirty + bump retry counter so the next
      // debounce tick (300ms) tries again. After _MAX_RETRIES attempts give
      // up silently rather than spinning. The next user edit re-enqueues it.
      const n = (_retryCounts[k] || 0) + 1;
      _retryCounts[k] = n;
      if (n <= _MAX_RETRIES){
        _dirtyKeys.add(k);
        // Exponential-ish backoff: 300ms × 2^(n-1) capped at 5s, plus up to
        // 300ms of random jitter so multiple tabs hitting the same outage
        // don't all retry in lockstep and re-trigger it together.
        const delay = Math.min(5000, 300 * Math.pow(2, n - 1)) + Math.random() * 300;
        setTimeout(_flushDirtyKeys, delay);
        console.warn('[realtime] Push failed for ' + k + ' (retry ' + n + '/' + _MAX_RETRIES + ' in ' + Math.round(delay) + 'ms)', err);
      } else {
        console.error('[realtime] Push gave up for ' + k + ' after ' + _MAX_RETRIES + ' retries', err);
        delete _retryCounts[k];
        if (typeof showToast === 'function') showToast('Live sync failed — your last change may not have reached other players');
      }
      return false;
    });
  }));
}

// ─── Apply one incoming remote key ────────────────────────────────────────────
// Called per-listener when a single sync key changes on the server. Only the
// panels that depend on that key get refreshed.
function _applyRemoteKey(key, fbVal) {
  // Defensive: some Firebase configurations auto-decode JSON-looking strings
  // into objects. Re-stringify so the rest of the pipeline always sees a string.
  if (fbVal == null) return;
  if (typeof fbVal !== 'string'){
    try { fbVal = JSON.stringify(fbVal); }
    catch(e){ return; }
  }
  // Echo suppression: if this echo matches a value we recently pushed,
  // drop exactly that one fire. Anything else (cross-tab write, edit from
  // a different client, manual Firebase Console edit) always processes —
  // we can't rely on "localStorage === fbVal" because same-browser tabs
  // share localStorage and that would suppress legitimate updates.
  //
  // Multiset lookup: decrement the counter for this exact value; if zero,
  // remove the entry. Anything still left after this represents in-flight
  // echoes for OTHER values we've also pushed since.
  const pending = _justWrote[key];
  if (pending){
    const norm = fbVal != null ? fbVal : '__null__';
    const count = pending.get(norm) || 0;
    if (count > 0){
      if (count === 1) pending.delete(norm);
      else             pending.set(norm, count - 1);
      if (pending.size === 0) delete _justWrote[key];
      return;
    }
  }

  // Conflict detection: if the local copy is "dirty" (queued for the next
  // flush) AND differs from the incoming remote value, both sides have
  // diverged. Park the conflict in `_conflicts` and let the user resolve.
  // Without this, the apply below would silently overwrite their pending
  // local edit.
  //
  // EXCEPTION — battle map is last-write-wins. Both sides write it on every
  // token drag / fog stroke, so the 300ms dirty window is hit constantly
  // during play; parking a conflict then silently FREEZES all map updates on
  // this device until the bar is resolved (easy to miss, especially on
  // mobile — "the map stopped updating"). Losing one in-flight stroke to a
  // race is far cheaper than a frozen map, and the local push that's still
  // queued re-asserts this device's latest state moments later anyway.
  if (_dirtyKeys.has(key) && key !== 'skt-battlemap-v1'){
    const localVal = localStorage.getItem(key);
    if (localVal != null && localVal !== fbVal){
      _conflicts[key] = { local: localVal, remote: fbVal, ts: Date.now() };
      _renderConflictBar();
      return; // Don't apply; user decides.
    }
  }

  _remoteUpdate = true;
  localStorage.setItem(key, fbVal);
  _remoteUpdate = false;

  // The split state keys back the global `state` object — re-read just the
  // domain that changed (a party update no longer re-parses combat/shop/
  // settings, and vice versa).
  const _STATE_DOMAINS = {'skt-party-v1':'party','skt-combat-v1':'combat','skt-shop-v1':'shop','skt-settings-v1':'settings'};
  if (_STATE_DOMAINS[key]) loadDomain(_STATE_DOMAINS[key]);

  // Shared-panels list is its own little world — apply it to the player tab
  // by mounting/unmounting panels, and refresh the DM tab's share toggles.
  if (key === 'skt-shared-panels-v1'){
    try { state.sharedPanels = JSON.parse(fbVal) || []; } catch(_){ state.sharedPanels = []; }
    if (typeof _applySharedPanelsToPlayerView === 'function' && document.body.classList.contains('player-mode')){
      _applySharedPanelsToPlayerView();
    }
    // DM tab: nothing to refresh here. Share state moved into the window ⋯
    // menu, which reads state.sharedPanels live each time it opens — the old
    // code probed for a [data-wact="share"] head button that no longer exists.
    return;
  }

  // Hidden-books filter — refresh the global cache that shop / search /
  // bestiary / encounter all read from, and re-render the Books panel if
  // it's mounted so the user sees the new state immediately.
  if (key === 'skt-books-hidden-v1'){
    try {
      const arr = JSON.parse(fbVal) || [];
      if (typeof window.SKT_HIDDEN_SOURCES_REBUILD === 'function') window.SKT_HIDDEN_SOURCES_REBUILD();
      const def = panelDefs && panelDefs.books;
      if (def){
        def._hiddenBooks = new Set(arr);
        if (def._body) def._render();
      }
    } catch(e){ _diag('apply hidden books', e); }
    return;
  }
  // Same handling for hidden adventures.
  if (key === 'skt-adventures-hidden-v1'){
    try {
      const arr = JSON.parse(fbVal) || [];
      if (typeof window.SKT_HIDDEN_SOURCES_REBUILD === 'function') window.SKT_HIDDEN_SOURCES_REBUILD();
      const def = panelDefs && panelDefs.adventures;
      if (def){
        def._hiddenAdventures = new Set(arr);
        if (def._body) def._render();
      }
    } catch(e){ _diag('apply hidden adventures', e); }
    return;
  }

  const panels = _PANELS_FOR_KEY[key] || [];
  panels.forEach(id => _reloadPanel(id));
}

// Per-panel reload. Panels that cache data into their own property need a
// remount; panels that read straight from `state` just need a re-render.
function _reloadPanel(id) {
  const def = panelDefs[id];
  if (!def || !def._body) return;

  if (id === 'battlemap') {
    // A token drag is in flight — replacing _tokens and re-rendering now
    // would destroy the dragged element and orphan the drag's object, so
    // the move would be silently discarded on mouseup. Skip this update;
    // the map is last-write-wins, and the drag-end _saveMap() makes this
    // device's state canonical moments later anyway.
    if (def._drag) return;
    // Update internal data directly so the BroadcastChannel doesn't fire
    // a duplicate event into the player view.
    //
    // This is the ONLY live-update path a cross-device client (phone/tablet
    // on another machine) has — BroadcastChannel is same-browser only. It
    // must therefore apply every shared map field. It used to skip gridType,
    // fogStrokes, the align offsets, scale, and rotation, which is why grid
    // changes and free-fog paint never showed up on other devices.
    try {
      const d = JSON.parse(localStorage.getItem('skt-battlemap-v1') || '{}');
      // Everything that changes the STAGE's geometry. If none of it moved,
      // this update can be painted with _repaintRemote() instead of a full
      // _render(). Captured before the fields are overwritten below.
      const _struct = () => [def._cols, def._rows, def._cellSize, def._gridType,
        def._bgMapScale, def._mapRotation, def._gridOffsetX, def._gridOffsetY].join('|');
      const _structBefore = _struct();
      def._tokens     = d.tokens   || [];
      def._fog        = d.fog      ? new Set(d.fog) : null;
      def._drawings   = Array.isArray(d.drawings)   ? d.drawings   : [];
      def._fogStrokes = Array.isArray(d.fogStrokes) ? d.fogStrokes : [];
      def._bgColor    = d.bgColor  || def._bgColor;
      def._cellSize   = d.cellSize || def._cellSize;
      def._cols       = d.cols     || def._cols;
      def._rows       = d.rows     || def._rows;
      def._gridType   = d.gridType || (d.showGrid !== false ? 'square' : 'none');
      def._showGrid   = def._gridType !== 'none';
      if (d.gridOffsetX != null) def._gridOffsetX = d.gridOffsetX;
      if (d.gridOffsetY != null) def._gridOffsetY = d.gridOffsetY;
      const _prevPath = def._bgMapPath || null;
      const _nextPath = d.bgMapPath || null;
      if (d.bgMapScale  != null) {
        // Zoom is per-device now, so bgMapScale only moves for a real reason:
        // a map swap, a saved-map restore, or a device still on old code that
        // zoomed. In the last two cases absorb the change into this device's
        // view scale so its on-screen size doesn't lurch. A map swap re-fits
        // below regardless, so skip it there.
        if (_nextPath === _prevPath) def._absorbWorldScaleChange?.(def._bgMapScale || 1, d.bgMapScale);
        def._bgMapScale = d.bgMapScale; def._lastTokenScale = d.bgMapScale;
      }
      if (d.mapRotation != null) def._mapRotation = d.mapRotation;
      if (d.gridOpacity != null) def._gridOpacity = d.gridOpacity;
      if (d.gridWidth   != null) def._gridWidth   = d.gridWidth;
      def._bgMapPath  = _nextPath;

      // Three tiers, most expensive first. Only the last one is common.
      if (def._bgMapPath && (_nextPath !== _prevPath || !def._bgMapNaturalW)){
        // A genuinely different map (or the image isn't loaded on this device
        // yet). Reload it; _loadBgFromPath renders on load. autoFit only when
        // the map actually changed, so each device re-fits to its own screen.
        // Previously this ran on EVERY update — a fog tick re-created the
        // Image and forced a second full render on top of the one above.
        def._loadBgFromPath?.(def._bgMapPath, _nextPath !== _prevPath);
      } else if (_struct() !== _structBefore || (!def._bgMapPath && _prevPath)){
        // Stage geometry moved (grid resize, Align offset, rotation, world
        // scale) or the map was cleared — the canvases have to be rebuilt.
        // _repaintRemote isn't involved on this branch, so re-baseline undo
        // here too: the stack would otherwise describe a history that no
        // longer matches shared state.
        def._resetUndoBaseline?.();
        def._render();
      } else {
        // The common case by far: a token moved or fog changed. Repaint the
        // canvas layers only. Same path the same-browser BroadcastChannel
        // handler has always used; cross-device clients were paying a full
        // innerHTML rebuild for it.
        if (typeof def._repaintRemote === 'function'){
          def._repaintRemote({ drawings: true, tokens: def._tokens });
        } else {
          def._render();
        }
      }
    } catch(e) { _diag('apply battlemap', e); }
    return;
  }

  // Cached-into-property panels: clear the cache, re-mount.
  const resets = {
    npclib:    () => { def._npcs = null; },
    loot:      () => { def._loot = null; },
    notes:     () => { def._data = null; },
    bestiary:  () => { def._data = null; },
    encounter: () => { /* mount() always re-reads */ },
  };
  if (resets[id]) {
    resets[id]();
    def.mount(def._body);
    return;
  }

  // Plain re-render (panels that read from global `state`).
  def._render?.();
}

// ─── Sync indicator ───────────────────────────────────────────────────────────
function _setSyncStatus(state) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  if (state === 'live') {
    el.innerHTML = '<span class="sync-dot live"></span><span>Live</span>';
    el.title = 'Connected — changes sync in real time';
  } else if (state === 'offline') {
    el.innerHTML = '<span class="sync-dot offline"></span><span>Offline</span>';
    el.title = 'No connection — changes saved locally';
  } else {
    el.innerHTML = '<span class="sync-dot"></span><span>Connecting…</span>';
    el.title = '';
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

// Local-only escape hatch: `?nosync=1` runs the whole app against localStorage
// and never opens a Firebase connection. It sticks for the tab via
// sessionStorage so in-app navigation (player view, pop-outs) can't silently
// reconnect after the param falls off the URL.
//
// This exists because there was previously NO way to open the app without
// joining the live campaign — and a throwaway browser profile doing exactly
// that once pushed an empty battlemap over the real one. Any local
// development, screenshot, or debugging session should use this.
// `?nosync=0` clears the flag again.
function _syncDisabled() {
  try {
    const q = new URLSearchParams(location.search).get('nosync');
    if (q === '0' || q === 'false') { sessionStorage.removeItem('skt-nosync'); return false; }
    if (q != null && q !== '') sessionStorage.setItem('skt-nosync', '1');
    return sessionStorage.getItem('skt-nosync') === '1';
  } catch(e) {
    // sessionStorage can throw in hardened/private modes — fall back to the
    // URL alone rather than failing open into a live connection.
    return /[?&]nosync=(?!0|false)/.test(location.search);
  }
}

function initRealtime() {
  if (_syncDisabled()) {
    _setSyncStatus('offline');
    console.info('[SKT] nosync — local-only mode, Firebase never contacted. Reload with ?nosync=0 to rejoin the campaign.');
    return;
  }

  // Skip if config hasn't been filled in yet
  if (firebaseConfig.apiKey === 'REPLACE_ME') {
    _setSyncStatus('offline');
    console.info('[SKT] Firebase not configured — running in local-only mode.\nSee js/sync/realtime.js for setup instructions.');
    return;
  }

  // Skip on file:// (Firebase requires http/https)
  if (location.protocol === 'file:') {
    _setSyncStatus('offline');
    console.info('[SKT] Running from file:// — open via a web server for real-time sync.');
    return;
  }

  try {
    // Avoid duplicate init if module is re-loaded
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    _fbDb = firebase.database();
  } catch(e) {
    console.error('[SKT] Firebase init failed:', e);
    _setSyncStatus('offline');
    return;
  }

  // Anonymous auth (sync redesign step 4). Once the database rules require
  // `auth != null` (see firebase-rules.json), only clients that sign in here
  // can read or write — someone who merely scraped the public config out of
  // this file gets permission-denied. Sign-in failure is NON-fatal: we fall
  // through and run unauthenticated so existing deployments keep working
  // until the Anonymous provider is enabled in the console. Do NOT flip the
  // rules until every device runs this code and the provider is on.
  if (firebase.auth){
    // Start listeners from onAuthStateChanged, NOT from the signInAnonymously
    // promise. Resolving that promise only means `currentUser` is populated —
    // the Realtime Database's websocket may not have been handed the token
    // yet. Listeners attached in that window are rejected with
    // permission_denied, and Firebase NEVER retries a revoked listener, so
    // sync stays dead for the whole page life. onAuthStateChanged fires after
    // the token has propagated. (_startRealtime is idempotent.)
    firebase.auth().onAuthStateChanged(user => {
      if (!user) return;
      console.info('[SKT] signed in anonymously (uid ' + user.uid + ')');
      _startRealtime();
    });
    firebase.auth().signInAnonymously().catch(err => {
      console.warn('[SKT] anonymous sign-in failed (' + (err && err.code) + ') — running unauthenticated. '
        + 'Enable Authentication → Sign-in method → Anonymous in the Firebase console to complete the lockdown.');
      _startRealtime();   // unauthenticated fallback, for pre-lockdown setups
    });
  } else {
    console.warn('[SKT] firebase-auth SDK not loaded — running unauthenticated.');
    _startRealtime();
  }
}

let _realtimeStarted = false;
function _startRealtime() {
  if (_realtimeStarted) return; // auth callback + fallback can both land here
  _realtimeStarted = true;

  _patchLocalStorage();

  // One listener per sync key. A change to one subsystem only re-downloads
  // that subsystem's blob — not the entire dataset. Massive bandwidth win
  // during play, when most edits touch a single key (HP, token positions, etc).
  SKT_SYNC_KEYS.forEach(k => {
    if (_ENTITY_KEYS[k]) return; // handled by the subtree listeners below
    _attachKeyListener(k);
  });

  // Entity-key subtree listeners.
  Object.keys(_ENTITY_KEYS).forEach(k => _attachEntityListener(k));

  _startRealtimeExtras();
}

// A permission_denied here is FATAL to that listener — Firebase revokes it and
// never retries, so the subsystem silently stops syncing for the rest of the
// page's life. That's exactly what happens if a listener is attached in the
// window between "signed in" and "the database connection has the token", so
// re-attach a couple of times before giving up.
const _listenRetries = {};
function _onListenError(label, path, err, reattach){
  const code = (err && err.code) || '';
  console.error('[SKT] Firebase read error for ' + label + ':', err);
  if (code === 'permission_denied' || code === 'PERMISSION_DENIED'){
    const n = (_listenRetries[label] || 0) + 1;
    _listenRetries[label] = n;
    if (n <= 3){
      const delay = 800 * n;
      console.warn('[SKT] re-attaching listener for ' + label + ' in ' + delay + 'ms (attempt ' + n + '/3)');
      setTimeout(() => { try { reattach(); } catch(e){ _diag('reattach ' + label, e); } }, delay);
      return;
    }
    console.error('[SKT] giving up on ' + label + '. If the database rules require auth, '
      + 'make sure Authentication → Sign-in method → Anonymous is ENABLED in the Firebase console.');
    if (typeof showToast === 'function') showToast('Sync permission denied — check Firebase auth settings');
  }
  _setSyncStatus('offline');
}

function _attachKeyListener(k){
  const path = 'skt/' + _toFbKey(k);
  _fbDb.ref(path).off();   // drop any revoked listener before re-adding
  _fbDb.ref(path).on('value', snap => {
      if (!snap.exists()){
        // No remote value yet for this key — seed it from local if we have one.
        const local = localStorage.getItem(k);
        if (local != null){
          _dirtyKeys.add(k);
          clearTimeout(_pushTimer);
          _pushTimer = setTimeout(_flushDirtyKeys, 100);
        }
        return;
      }
      _applyRemoteKey(k, snap.val());
    }, err => _onListenError(k, path, err, () => _attachKeyListener(k)));
}

// Entity-key subtree listener. The realtime protocol only sends changed
// children over the wire for a subtree value listener, so receive traffic
// is already incremental — we just reassemble locally.
function _attachEntityListener(k){
    const spec = _ENTITY_KEYS[k];
    _fbDb.ref(spec.base).off();   // drop any revoked listener before re-adding
    _fbDb.ref(spec.base).on('value', snap => {
      if (snap.exists()){ _applyEntitySnapshot(k, snap.val()); return; }
      // v2 subtree absent — first client on the new layout. Seed from local
      // if we have data; otherwise fall back to the old whole-key node
      // (written by pre-step-2 clients) and re-push it in v2 form.
      const local = localStorage.getItem(k);
      if (local != null){
        _dirtyKeys.add(k);
        clearTimeout(_pushTimer);
        _pushTimer = setTimeout(_flushDirtyKeys, 100);
        return;
      }
      if (!spec.legacyNode) return; // no pre-v2 node ever existed for this key
      _fbDb.ref(spec.legacyNode).once('value').then(ls => {
        if (!ls.exists()) return;
        let v = ls.val();
        if (typeof v !== 'string'){ try { v = JSON.stringify(v); } catch(e){ return; } }
        _remoteUpdate = true;
        try { localStorage.setItem(k, v); } finally { _remoteUpdate = false; }
        spec.postApply();
        _dirtyKeys.add(k);
        clearTimeout(_pushTimer);
        _pushTimer = setTimeout(_flushDirtyKeys, 100);
        console.log('[SKT] migrated ' + k + ' from legacy whole-key node into v2 subtree');
      }).catch(()=>{});
    }, err => _onListenError(spec.base, spec.base, err, () => _attachEntityListener(k)));
}

// Everything that only needs to happen once per page, after listeners exist.
function _startRealtimeExtras() {
  // Track connection state for the status indicator. Firebase queues writes
  // automatically while offline and flushes them on reconnect — no manual
  // re-push needed here.
  _fbDb.ref('.info/connected').on('value', snap => {
    _setSyncStatus(snap.val() ? 'live' : 'offline');
  });

  // Safety net: if the tab regains focus, re-pull every sync key once. This
  // covers cases where the long-running on('value') listener missed events
  // (background tab throttling, transient connection blips) so the UI never
  // sits on stale data after the user comes back to the tab.
  const _refreshAll = () => {
    if (!_fbDb) return;
    SKT_SYNC_KEYS.forEach(k => {
      if (_ENTITY_KEYS[k]){
        _fbDb.ref(_ENTITY_KEYS[k].base).once('value').then(snap => {
          if (snap.exists()) _applyEntitySnapshot(k, snap.val());
        }).catch(()=>{});
        return;
      }
      _fbDb.ref('skt/' + _toFbKey(k)).once('value').then(snap => {
        if (snap.exists()) _applyRemoteKey(k, snap.val());
      }).catch(()=>{});
    });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') _refreshAll();
  });
  window.addEventListener('focus', _refreshAll);

  // Legacy-blob migration, Firebase side. load() migrates a LOCAL
  // 'skt-workspace-v1' blob into the split keys, but a client with a fresh
  // profile (new device, cleared storage) has no local blob — and if no
  // device has migrated yet, Firebase only has the legacy node, which new
  // code no longer listens to. Without this, such a client boots showing
  // DEFAULTS and its first edit would seed default data over the campaign.
  // Pull the legacy node once, stage it locally, and let load() do the
  // same split-and-seed it does for a local blob.
  //
  // The "already migrated?" test is LOCAL, so it runs BEFORE the network read
  // rather than after it. It used to sit inside the .then(), which meant every
  // client downloaded the ~24 KB legacy blob on every single load and then
  // threw it away — about a third of this app's total Firebase download, for
  // a migration that finished long ago.
  //
  // It is still re-tested after the read, and that is not redundant: on a
  // genuinely fresh profile the key listeners may deliver real data while this
  // request is in flight, and if they do, their (newer) data must win over the
  // legacy blob.
  const SPLIT = ['skt-party-v1','skt-combat-v1','skt-shop-v1','skt-settings-v1'];
  const _migrated = () => SPLIT.some(k => localStorage.getItem(k) != null);
  if (_migrated()) return;   // nothing to do — and nothing to download
  _fbDb.ref('skt/' + _toFbKey('skt-workspace-v1')).once('value').then(snap => {
    if (!snap.exists()) return;
    if (_migrated()) return; // a listener beat us to it while in flight
    let val = snap.val();
    if (typeof val !== 'string'){ try { val = JSON.stringify(val); } catch(e){ return; } }
    try {
      localStorage.setItem('skt-workspace-v1', val); // not a sync key anymore — no push
      load();                                        // splits + seeds the new keys
      ['party','combat','shop'].forEach(_reloadPanel);
      console.log('[SKT] migrated legacy workspace blob from Firebase into split keys');
    } catch(e){ console.warn('[SKT] legacy blob migration failed', e); }
  }).catch(()=>{});
}

// ─── Live ephemeral channels ─────────────────────────────────────────────────
// Bypass the localStorage-mirrored sync queue for high-frequency, transient
// data (e.g. an in-progress pencil stroke being broadcast at ~10fps). These
// writes hit Firebase directly and are NOT persisted in localStorage — they're
// meant to be overwritten or cleared a moment later. A connected client uses
// `listen(path, cb)` to subscribe and `push(path, val)` / `clear(path)` to
// emit. No-ops gracefully when Firebase isn't configured.
// Expose a "force flush" hook for the Settings drawer's "Sync now" button.
// Returns true if Firebase is configured and a flush ran (even if there was
// nothing to flush); false otherwise so the UI can tell the user "no sync
// configured" instead of pretending it worked.
window.realtimeFlush = function(){
  if (!_fbDb) return false;
  try { _flushDirtyKeys(); } catch(e){ return false; }
  return true;
};

// Flush now and RESOLVE ONLY ONCE THE SERVER HAS IT. Used by the backup
// restore, which must not reload the page until the restored data is on the
// server — otherwise the listeners come up on the next load, read the old
// pre-restore state, and apply it over everything, wiping the restore with
// no error shown anywhere.
//
// Resolves: 'published' (everything landed) · 'partial' (some key failed and
// is queued for retry) · 'offline' (no Firebase configured) · 'timeout'
// (still in flight after timeoutMs — the caller should warn rather than
// assume either outcome).
window.realtimeFlushAndWait = function(timeoutMs){
  if (!_fbDb) return Promise.resolve('offline');
  // The setItem hook debounces by 300ms; jump the queue so we're waiting on
  // the real write rather than on the timer.
  clearTimeout(_pushTimer);
  let settled = false;
  const flushed = Promise.resolve()
    .then(() => _flushDirtyKeys())
    .then(results => {
      settled = true;
      return (results || []).every(Boolean) ? 'published' : 'partial';
    })
    .catch(() => { settled = true; return 'partial'; });
  const timer = new Promise(res => setTimeout(() => res(settled ? null : 'timeout'),
                                              timeoutMs || 8000));
  return Promise.race([flushed, timer]).then(r => r || flushed);
};

window.realtimeLive = {
  push(path, value){
    if (!_fbDb) return;
    try { _fbDb.ref(path).set(value).catch(()=>{}); } catch(e){}
  },
  clear(path){
    if (!_fbDb) return;
    try { _fbDb.ref(path).remove().catch(()=>{}); } catch(e){}
  },
  listen(path, callback){
    if (!_fbDb) return () => {};
    try {
      const ref = _fbDb.ref(path);
      const handler = ref.on('value', snap => {
        try { callback(snap.val()); } catch(e){}
      });
      return () => { try { ref.off('value', handler); } catch(e){} };
    } catch(e){ return () => {}; }
  },
};

// ─── Conflict UI ──────────────────────────────────────────────────────────
// Paints (or updates, or removes) a fixed-bottom bar listing every key that
// currently has a local↔remote conflict. Each row gets three resolver
// buttons. The bar auto-removes when _conflicts becomes empty.
function _renderConflictBar(){
  let bar = document.getElementById('rt-conflict-bar');
  const entries = Object.entries(_conflicts);
  if (entries.length === 0){ bar?.remove(); return; }
  if (!bar){
    bar = document.createElement('div');
    bar.id = 'rt-conflict-bar';
    bar.className = 'rt-conflict-bar';
    document.body.appendChild(bar);
  }
  const _esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  bar.innerHTML = '<div class="rt-conflict-head">⚠ ' + entries.length + ' sync conflict' + (entries.length===1?'':'s')
    + '<span class="rt-conflict-hint">Remote changes arrived while you were editing. Pick one per row.</span></div>'
    + entries.map(([k]) => {
        const label = _CONFLICT_LABELS[k] || k;
        return '<div class="rt-conflict-row" data-rtkey="' + _esc(k) + '">'
          + '<span class="rt-conflict-label">' + _esc(label) + '</span>'
          + '<div class="rt-conflict-actions">'
          + '<button class="btn small" data-rtact="compare">Compare</button>'
          + '<button class="btn small" data-rtact="theirs">Use theirs</button>'
          + '<button class="btn small primary" data-rtact="mine">Keep mine</button>'
          + '</div></div>';
      }).join('');
  bar.querySelectorAll('[data-rtact]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const row = btn.closest('[data-rtkey]');
    const key = row?.dataset.rtkey;
    if (!key || !_conflicts[key]) return;
    const act = btn.dataset.rtact;
    if (act === 'mine') _resolveConflict(key, 'mine');
    else if (act === 'theirs') _resolveConflict(key, 'theirs');
    else if (act === 'compare') _openConflictCompare(key);
  }));
}

function _resolveConflict(key, choice){
  const c = _conflicts[key];
  if (!c) return;
  delete _conflicts[key];
  if (choice === 'mine'){
    // Re-push local as the canonical value. _flushDirtyKeys handles the
    // actual network write; just ensure the key is dirty.
    _dirtyKeys.add(key);
    clearTimeout(_pushTimer);
    _pushTimer = setTimeout(_flushDirtyKeys, 100);
  } else {
    // Apply remote — runs the normal apply path, but bypass conflict
    // detection by clearing dirty first (we're explicitly accepting remote).
    _dirtyKeys.delete(key);
    _applyRemoteKey(key, c.remote);
  }
  _renderConflictBar();
}

// Side-by-side diff modal for a single key. Pretty-prints both sides as
// JSON so the user can eyeball what differs before picking a side.
function _openConflictCompare(key){
  const c = _conflicts[key]; if (!c) return;
  const pretty = (s) => {
    try { return JSON.stringify(JSON.parse(s), null, 2); }
    catch(e){ return String(s); }
  };
  const _esc = s => String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  const label = _CONFLICT_LABELS[key] || key;
  back.innerHTML = '<div class="modal rt-conflict-modal" role="dialog" aria-modal="true" style="width:880px;max-width:96vw;max-height:88vh;display:flex;flex-direction:column">'
    + '<h3 style="margin:0 0 4px">Compare conflict — ' + _esc(label) + '</h3>'
    + '<p style="margin:0 0 10px;font-size:11px;color:var(--text-muted)">Local copy is what you just edited. Remote is what arrived from another tab / device.</p>'
    + '<div class="rt-conflict-diff">'
    + '<div class="rt-conflict-pane"><div class="rt-conflict-pane-head">Mine (local)</div><pre>' + _esc(pretty(c.local))   + '</pre></div>'
    + '<div class="rt-conflict-pane"><div class="rt-conflict-pane-head">Theirs (remote)</div><pre>' + _esc(pretty(c.remote)) + '</pre></div>'
    + '</div>'
    + '<div class="modal-actions" style="margin-top:12px">'
    + '<button class="btn" data-rtact="cancel">Cancel</button>'
    + '<span style="flex:1"></span>'
    + '<button class="btn" data-rtact="theirs">Use theirs</button>'
    + '<button class="btn primary" data-rtact="mine">Keep mine</button>'
    + '</div></div>';
  document.body.appendChild(back);
  const close = () => back.remove();
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  back.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  back.querySelector('[data-rtact="cancel"]').addEventListener('click', close);
  back.querySelector('[data-rtact="mine"]').addEventListener('click', () => { _resolveConflict(key, 'mine'); close(); });
  back.querySelector('[data-rtact="theirs"]').addEventListener('click', () => { _resolveConflict(key, 'theirs'); close(); });
}

