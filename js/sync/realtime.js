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
  'skt-prompt-v1',         // the open reaction prompt, DM → players → DM
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
    // The player view's turn bar is not a panel, so _reloadPanel can't reach
    // it — and it is the one surface a player watches between their turns.
    postApply(){
      loadDomain('combat'); ['combat','party'].forEach(_reloadPanel);
      if (typeof paRender === 'function') paRender();
    },
  },
  // Party is a bare array of characters with stable string ids, so this split
  // is simpler than combat's — the only shared state is the display order.
  //
  // It is also the one that was most worth doing. Party is 15KB of five
  // records that the DM and the players both edit constantly, and as a single
  // blob two people touching DIFFERENT characters inside the 300ms window
  // produced a conflict whose two buttons were "lose their edit" and "lose
  // mine" — knock Zoey to 9 while a player heals Namroc to 19 and the correct
  // answer, both, was not on offer. Per-character nodes make that collision
  // a merge instead of a question.
  'skt-party-v1': {
    base: 'skt/party_v2',
    legacyNode: 'skt/skt_party_v1',   // whole-key node written by older clients
    explode(s){
      const parsed = JSON.parse(s);
      const arr = Array.isArray(parsed) ? parsed : [];
      const nodes = { meta: JSON.stringify({ order: arr.map((c, i) => _partyNodeId(c, i)) }) };
      arr.forEach((c, i) => { nodes['items/' + _partyNodeId(c, i)] = JSON.stringify(c); });
      return nodes;
    },
    assemble(nodes){
      let meta = {}; try { meta = JSON.parse(nodes.meta || '{}') || {}; } catch(e){ _diag('party meta', e); }
      // Keyed by NODE NAME, not by a re-derived c.id. They agree whenever the
      // record has an id, and when it doesn't this still round-trips instead
      // of dropping the character on the floor.
      const items = {};
      Object.keys(nodes).forEach(n => {
        if (!n.startsWith('items/')) return;
        try { const c = JSON.parse(nodes[n]); if (c) items[n.slice(6)] = c; } catch(e){ _diag('party node ' + n, e); }
      });
      const out = [], used = new Set();
      (Array.isArray(meta.order) ? meta.order : []).forEach(id => {
        if (items[id]){ out.push(items[id]); used.add(id); }
      });
      // Anything the server has that `order` doesn't mention — a character
      // added by a client whose meta push hasn't landed yet — still appears.
      Object.keys(items).forEach(id => { if (!used.has(id)) out.push(items[id]); });
      return JSON.stringify(out);
    },
    postApply(){
      loadDomain('party'); ['party', 'combat'].forEach(_reloadPanel);
      if (typeof paRender === 'function') paRender();
    },
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
    postApply(){ _reloadPanel('battlemap'); if (typeof paRender === 'function') paRender(); },
    // The only nodes a PLAYER view may write. Mirrors what the battle map
    // panel accepts from a player over BroadcastChannel, so the two routes
    // can't drift: pencil strokes, and moves of tokens that ALREADY EXIST on
    // the server. A token id absent from `prev` would be a creation, which a
    // player isn't allowed to make — the panel-side merge drops unknown ids
    // for the same reason. `meta`, `fog` and `fogStrokes` are DM-only.
    playerWritable(node, prev){
      if (node === 'drawings') return true;
      if (node.indexOf('tokens/') === 0) return (node in prev);
      return false;
    },
    // Don't stomp an in-flight token drag — the drag-end save re-pushes
    // local state (LWW) and reconciles.
    holdOff(){ const d = (typeof panelDefs !== 'undefined') && panelDefs.battlemap; return !!(d && d._body && d._drag); },
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
    postApply(){ _reloadPanel('notes'); if (typeof paRender === 'function') paRender(); },
    // Never re-render under the user's cursor mid-edit; the next event or
    // the focus-refresh reconciles once they're done typing.
    // Only while the panel is actually MOUNTED. A flag left set by a panel
    // that is no longer on screen cannot be cleared by anything the user
    // does, so requiring _body as well turns a permanent stall into a
    // temporary one whatever else goes wrong upstream.
    holdOff(){ const d = (typeof panelDefs !== 'undefined') && panelDefs.notes; return !!(d && d._body && d._editing); },
  },
};
function _fbSafeId(id){ return String(id).replace(/[.#$\/\[\]]/g, '_'); }
// Node name for one party character. Both push sites assign uid(), so the
// fallback only fires for a record that arrived without one (hand-edited
// backup, older import). An index keeps such records distinct rather than
// letting them collapse onto a single "undefined" node and eat each other.
function _partyNodeId(c, i){ return _fbSafeId(c && c.id != null ? c.id : ('idx_' + i)); }
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
// Read at call time, never cached: body.player-mode is added by
// initPlayerView() long after this file parses.
function _isPlayerMode(){
  try { return document.body.classList.contains('player-mode'); } catch(e){ return false; }
}

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
  // A player view is a RESTRICTED writer. The battle map panel already limits
  // what it accepts FROM a player (token positions and pencil strokes, nothing
  // else) but that guard lives on the receiving end, and Firebase bypasses it
  // entirely: whatever a player's localStorage holds gets exploded and pushed
  // like any other client's. So a phone that was momentarily behind would push
  // its stale `meta` — one node holding the map path, grid, cols/rows and
  // scale — over everyone's, and the deletion sweep below would drop
  // `tokens/<id>` for any token the phone hadn't heard about yet. Intermittent,
  // and exactly as destructive as it sounds.
  //
  // Enforce the same allowlist here, where the write actually happens.
  const restrict = (spec.playerWritable && _isPlayerMode()) ? spec.playerWritable : null;
  // What this client will believe the server holds afterwards. Built from prev
  // rather than assigning `nodes` wholesale, because a filtered-out node was
  // NOT pushed and must stay diffable — claiming otherwise would make the next
  // legitimate change to it look unchanged and silently skip it. With no
  // filter this is byte-identical to `nodes`.
  const applied = {...prev};
  Object.keys(nodes).forEach(n => {
    if (prev[n] === nodes[n]) return;
    if (restrict && !restrict(n, prev)) return;
    updates[spec.base + '/' + n] = nodes[n];
    applied[n] = nodes[n];
  });
  Object.keys(prev).forEach(n => {
    if (n in nodes) return;
    // A player never deletes. Their absent node means "I don't know about it",
    // not "remove it" — only the DM can actually remove anything.
    if (restrict) return;
    updates[spec.base + '/' + n] = null;
    delete applied[n];
  });
  if (!Object.keys(updates).length) return Promise.resolve(true);
  // Optimistic cache update — the echo snapshot must match the cache so it
  // gets recognized and skipped. Rolled back on failure so a retry re-diffs.
  _entityCache[k] = applied;
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
      _lastServer[k] = val;   // the server now holds this; base for next merge
      return true;
    }).catch((err) => {
      // The push never landed, so no echo is coming for it — take the entry
      // back out of the echo multiset. Left in, it suppresses a LATER
      // legitimate update that happens to carry the same bytes, and that is
      // a real desync rather than a wasted entry: push V, fail, edit locally
      // to X, then another device sets it back to V — we drop their update
      // as our own echo and sit on X while the table is on V. A retry
      // re-registers it, so the bookkeeping stays honest either way.
      const pend = _justWrote[k];
      if (pend){
        const c = pend.get(norm) || 0;
        if (c > 1) pend.set(norm, c - 1);
        else { pend.delete(norm); if (pend.size === 0) delete _justWrote[k]; }
      }
      // Re-mark the key dirty + bump retry counter so the next debounce tick
      // (300ms) tries again. After _MAX_RETRIES attempts give up silently
      // rather than spinning. The next user edit re-enqueues it.
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
// ============================================================
// THREE-WAY MERGE for whole-key JSON domains
// ============================================================
// Entity-split keys merge per record because _applyEntitySnapshot has a base
// to diff against (_entityCache). The whole-key domains had no base, so the
// only thing the code could do when both sides changed was ask the user which
// copy to throw away — and for the collision that actually happens (two people
// editing different parts of the same blob) neither answer was right.
//
// _lastServer gives those keys the same base, so they can merge instead of
// asking. Structural, not textual: recurse objects per field, match records by
// id, treat scalar arrays as sets.
const _lastServer = {};   // key -> last value we know the server held

// Keys whose value is ONE indivisible fact. Field-wise merging is not just
// unnecessary for these, it is wrong: it can assemble a record that neither
// side ever held.
//
// skt-prompt-v1 is the whole of it today. A reaction prompt is one question
// and one answer, bound together. The DM rolls a second attack, which clears
// the prompt and publishes p2, at the moment a player taps their answer to
// p1 — merge the two and `id` comes from the server (p2, it changed) while
// `answer` comes from us (the server's is still null, so ours looks like the
// only edit). The result is question p2 carrying p1's answer, and the DM's
// staleness guard cannot see it: it compares p.id against _promptId, and the
// id says p2. It would spend the wrong character's reaction against an attack
// aimed at somebody else.
//
// Atomic keys take the remote value whole, which is what this key did before
// merging existed. Add a key here when its fields are only meaningful
// together.
const _ATOMIC_KEYS = new Set(['skt-prompt-v1']);

function _idOf(o){
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  if (o.id != null) return 'id:' + o.id;
  if (o.name != null) return 'name:' + o.name;
  return null;
}
function _isPlainObj(v){ return v !== null && typeof v === 'object' && !Array.isArray(v); }
// An array we can merge element-wise: every entry is a record with a stable
// identity. Mixed or anonymous arrays (settings.healthTiers) fail this and
// fall back to whole-value resolution, which is the honest answer for them.
function _keyedArray(a){
  if (!Array.isArray(a) || !a.length) return null;
  const ids = a.map(_idOf);
  if (ids.some(x => x == null) || new Set(ids).size !== ids.length) return null;
  return ids;
}
function _allScalars(a){
  return Array.isArray(a) && a.every(v => v === null || typeof v !== 'object');
}
const _eq = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

// Returns the merged value.
//
// `baseKnown` decides who wins a leaf both sides genuinely changed, and it has
// to be THEIRS whenever we can tell. "Mine wins" is symmetric — both clients
// keep their own copy, and since a merge that keeps something of ours re-marks
// the key dirty, both re-push on every exchange and never converge. Two tabs
// sat on gp 20 and gp 30 will trade writes forever. Preferring the remote value
// is the one answer both sides compute identically: it converges in a single
// exchange, and because the result then equals what the server already holds,
// neither side pushes at all.
//
// The exception is a base we never had (first sync of the session, edits made
// offline). There we cannot tell what either side changed, and defaulting to
// theirs would throw the local work away — so mine wins. That is a one-shot:
// applying the update records a base, so the next exchange resolves normally.
function _merge3(base, mine, theirs, baseKnown){
  if (_eq(mine, theirs)) return theirs;
  if (baseKnown){
    if (_eq(base, mine))   return theirs;   // we didn't touch it
    if (_eq(base, theirs)) return mine;     // they didn't touch it
  }

  // Both sides changed. Try to push the decision down a level.
  if (_isPlainObj(mine) && _isPlainObj(theirs)){
    const b = _isPlainObj(base) ? base : {};
    const out = {};
    const keys = new Set([...Object.keys(b), ...Object.keys(mine), ...Object.keys(theirs)]);
    keys.forEach(k => {
      const inB = k in b, inM = k in mine, inT = k in theirs;
      if (inB && !inM) return;             // I deleted the field
      if (inB && !inT) return;             // they deleted it
      if (!inM) { out[k] = theirs[k]; return; }
      if (!inT) { out[k] = mine[k];   return; }
      out[k] = _merge3(b[k], mine[k], theirs[k], baseKnown);
    });
    return out;
  }

  const mIds = _keyedArray(mine), tIds = _keyedArray(theirs);
  if (mIds && tIds){
    const bIds = _keyedArray(base) || [];
    const bAt = {}, mAt = {}, tAt = {};
    bIds.forEach((id, i) => bAt[id] = base[i]);
    mIds.forEach((id, i) => mAt[id] = mine[i]);
    tIds.forEach((id, i) => tAt[id] = theirs[i]);
    const out = [], seen = new Set();
    // Their order is the spine; records only I have are appended. Keeps a
    // reorder on either side from scrambling the list.
    tIds.forEach(id => {
      seen.add(id);
      const inB = id in bAt, inM = id in mAt;
      if (inB && !inM) return;             // I deleted this record
      out.push(inM ? _merge3(bAt[id], mAt[id], tAt[id], baseKnown) : tAt[id]);
    });
    mIds.forEach(id => {
      if (seen.has(id)) return;
      if (id in bAt) return;               // they deleted it
      out.push(mAt[id]);                   // I added it
    });
    return out;
  }

  if (_allScalars(mine) && _allScalars(theirs)){
    // Set semantics — this is what the hidden-source lists and the shared
    // panel list actually are. Two people hiding different books both stick.
    const b = _allScalars(base) ? base : [];
    const bs = new Set(b), ms = new Set(mine), ts = new Set(theirs);
    const keep = v => (bs.has(v) ? (ms.has(v) && ts.has(v)) : (ms.has(v) || ts.has(v)));
    const out = [];
    theirs.forEach(v => { if (keep(v) && !out.includes(v)) out.push(v); });
    mine.forEach(v => { if (keep(v) && !out.includes(v)) out.push(v); });
    return out;
  }

  // Shapes disagree, an array with no stable identity, or two scalars that
  // both moved. Deterministic tiebreak — see baseKnown above.
  return baseKnown ? theirs : mine;
}

// String wrapper. Any parse failure falls back to the remote value: the server
// copy is the one every other client already has, so converging on it beats
// keeping unparseable local bytes.
function _mergeJsonStr(baseStr, mineStr, theirsStr){
  let mine, theirs, base;
  try { mine = JSON.parse(mineStr); theirs = JSON.parse(theirsStr); }
  catch(e){ return theirsStr; }
  let baseKnown = false;
  try { if (baseStr != null){ base = JSON.parse(baseStr); baseKnown = true; } } catch(e){ baseKnown = false; }
  try { return JSON.stringify(_merge3(base, mine, theirs, baseKnown)); }
  catch(e){ return theirsStr; }
}

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
  //
  // Only the whole-key domains get here at all. Every entity-split key
  // (combat, battle map, notes, party) is routed to _applyEntitySnapshot by
  // both the live listener and the focus refresh, and merges per record.
  //
  // The battle-map name check below is therefore unreachable today. It is
  // kept as a backstop because that key is the one where getting this wrong
  // does the most damage: both sides write it on every token drag and fog
  // stroke, so the 300ms dirty window is hit constantly during play.
  //
  // Both sides changed this key inside that window. There is no need to ask
  // which copy to keep — with _lastServer as the base we can work out what
  // each side actually did and apply both. If the merge contributes anything
  // of ours, the key stays dirty so the result propagates and the other
  // client converges on it; if it comes out identical to the server's copy we
  // had nothing to add, and the flag is cleared (below) so we don't push bytes
  // the node already holds.
  let applyVal = fbVal, mergedOurs = false;
  if (_dirtyKeys.has(key) && key !== 'skt-battlemap-v1' && !_ATOMIC_KEYS.has(key)){
    const localVal = localStorage.getItem(key);
    if (localVal != null && localVal !== fbVal){
      applyVal = _mergeJsonStr(_lastServer[key], localVal, fbVal);
      mergedOurs = (applyVal !== fbVal);
    }
  }

  // try/finally, like the other two sites. This one was bare, and the flag it
  // sets gates the dirty-marking hook in _patchLocalStorage — so a throw here
  // leaves _remoteUpdate stuck true and NOTHING this client does is ever
  // marked dirty again. Not notes, not combat, not the map: every local
  // change stops reaching the table, silently, for the rest of the session.
  // setItem throwing is not hypothetical either; quota is the realistic case
  // and this app already carries warnStorageFailure because it happens.
  _remoteUpdate = true;
  try {
    localStorage.setItem(key, applyVal);
  } catch(e){
    _diag('apply ' + key, e);
    if (typeof warnStorageFailure === 'function') warnStorageFailure('incoming ' + key, e);
    return;                       // finally still clears the flag
  } finally {
    _remoteUpdate = false;
  }

  // localStorage now byte-matches what the server holds, so a queued push for
  // this key has nothing left to send, so clear the dirty flag.
  //
  // Leaving it set is not merely a wasted write. The flush pushes bytes the
  // node already holds, Firebase raises no value event for an unchanged set,
  // so nothing ever consumes the _justWrote entry that push registered. That
  // entry then swallows the next genuine remote update carrying those same
  // bytes: the table goes V -> W -> V and this device applies W, drops the
  // return to V as its own echo, and sits on W for the rest of the session.
  //
  // Reachable whenever a remote value lands inside the 300ms dirty window
  // holding what we were about to send — two people making the same change,
  // or the DM window and the player window on one machine, which share
  // localStorage and both push.
  // Base for the next merge is what the SERVER holds, not what we just wrote.
  _lastServer[key] = fbVal;

  if (mergedOurs){
    // The merge kept something of ours, so the server's copy is now stale.
    // Push the result rather than leaving the two sides different.
    _dirtyKeys.add(key);
    clearTimeout(_pushTimer);
    _pushTimer = setTimeout(_flushDirtyKeys, 100);
  } else {
    _dirtyKeys.delete(key);
  }

  // The split state keys back the global `state` object — re-read just the
  // domain that changed (a party update no longer re-parses combat/shop/
  // settings, and vice versa).
  const _STATE_DOMAINS = {'skt-party-v1':'party','skt-combat-v1':'combat','skt-shop-v1':'shop','skt-settings-v1':'settings','skt-prompt-v1':'prompt'};
  if (_STATE_DOMAINS[key]) loadDomain(_STATE_DOMAINS[key]);

  // A reaction prompt travels both ways: the DM raises it, a player answers
  // it, the DM applies the answer. Both ends are told the moment it changes.
  if (key === 'skt-prompt-v1'){
    if (typeof paRender === 'function') paRender();
    try { panelDefs.turnview && panelDefs.turnview._onPromptChange(); } catch(e){ _diag('prompt', e); }
    return;
  }

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
      const arr = JSON.parse(applyVal) || [];
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
      const arr = JSON.parse(applyVal) || [];
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
    // One applier, shared with the same-browser BroadcastChannel route (see
    // battlemap.applyMapState). This block used to be a second, independent
    // copy of the same logic and the two drifted apart repeatedly — the
    // cross-device path silently missed gridType, fogStrokes, the align
    // offsets, scale and rotation for a long time, and later the BC path was
    // the one missing a geometry check. Whatever the panel learns to handle,
    // both routes now get for free.
    try {
      def.applyMapState(JSON.parse(localStorage.getItem('skt-battlemap-v1') || '{}'),
                        { source: 'firebase' });
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


