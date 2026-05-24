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
  'skt-workspace-v1',  // party, combat tracker, shop, settings
  'skt-battlemap-v1',  // battle map tokens & fog
  'skt-enc-v1',        // encounter builder
  'skt-loot-v1',       // loot tracker
  // 'skt-notes-v2'  — session notes ride on Dropbox (or local-folder vault
  // sync) instead of Firebase. Notes payloads can be the biggest single key
  // in the workspace (200 KB+ for a chatty campaign × every commit × every
  // listener) and Dropbox already covers cross-device updates within ~8 s.
  'skt-npcs-v2',       // NPC library
  'skt-bestiary-v1',   // bestiary
  'skt-shared-panels-v1',  // which panels the DM is sharing with players
  'skt-books-hidden-v1',   // hidden-books filter — propagates to every tab
                           // so the DM's curated source list affects every
                           // player's search / shop / encounter dropdowns too
];

// Firebase keys cannot contain hyphens or dots — convert to underscores
function _toFbKey(lsKey) { return lsKey.replace(/[-\.]/g, '_'); }

let _remoteUpdate = false;        // true while applying remote changes → prevents echo writes
let _pushTimer    = null;         // debounce handle for outgoing writes
let _fbDb         = null;         // Firebase database reference
const _dirtyKeys  = new Set();    // sync keys that have changed since last flush
const _justWrote  = {};           // {key: value} of our most recent push, used to suppress one echo
// True conflicts: keys where a remote value arrived while a local change was
// still pending its first flush. {[key]: {local, remote, ts}} until the user
// resolves via the conflict bar. No automatic merge — JSON shapes vary too
// much. Display labels for the keys are in _CONFLICT_LABELS below.
const _conflicts = {};
const _CONFLICT_LABELS = {
  'skt-workspace-v1':     'Workspace (party, combat, settings)',
  'skt-shared-panels-v1': 'Shared panels',
  'skt-notes-data':       'Notes',
  'skt-bestiary-v1':      'Bestiary',
  'skt-loot-data':        'Loot',
  'skt-npclib-data':      'NPC Library',
  'skt-battlemap-v1':     'Battle map',
};

// Which panels to refresh when a particular sync key changes. Avoids re-rendering
// the whole world when a single subsystem updates.
const _PANELS_FOR_KEY = {
  'skt-workspace-v1': ['combat', 'party', 'shop'],     // panels that read from `state`
  'skt-battlemap-v1': ['battlemap'],
  'skt-enc-v1':       ['encounter'],
  'skt-loot-v1':      ['loot'],
  // 'skt-notes-v2' deliberately omitted — notes sync via Dropbox/local FS.
  'skt-npcs-v2':      ['npclib'],
  'skt-bestiary-v1':  ['bestiary'],
  // skt-shared-panels-v1 has no per-panel render — it's dispatched manually
  // in _applyRemoteKey so the player view can mount/unmount whole panels.
};

// ─── Intercept localStorage writes ────────────────────────────────────────────
// Any panel that calls localStorage.setItem('skt-*', ...) marks that key dirty
// and schedules a debounced push of only the dirty keys.
function _patchLocalStorage() {
  const _orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
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
function _flushDirtyKeys() {
  if (!_fbDb || _dirtyKeys.size === 0) return;
  const keys = Array.from(_dirtyKeys);
  _dirtyKeys.clear();
  keys.forEach(k => {
    const val = localStorage.getItem(k);
    // Remember exactly what we pushed so the listener can drop the one echo
    // that comes back to us. (Don't use a `localStorage===fbVal` check for
    // this — same-browser tabs share localStorage, which would falsely
    // suppress legitimate cross-tab updates.)
    _justWrote[k] = val;
    _fbDb.ref('skt/' + _toFbKey(k)).set(val != null ? val : null).then(() => {
      // Success — clear retry counter so a future failure starts fresh.
      delete _retryCounts[k];
    }).catch((err) => {
      // Failure — re-mark the key dirty + bump retry counter so the next
      // debounce tick (300ms) tries again. After _MAX_RETRIES attempts give
      // up silently rather than spinning. The next user edit re-enqueues it.
      const n = (_retryCounts[k] || 0) + 1;
      _retryCounts[k] = n;
      if (n <= _MAX_RETRIES){
        _dirtyKeys.add(k);
        // Exponential-ish backoff: 300ms × 2^(n-1) capped at 5s.
        const delay = Math.min(5000, 300 * Math.pow(2, n - 1));
        setTimeout(_flushDirtyKeys, delay);
        console.warn('[realtime] Push failed for ' + k + ' (retry ' + n + '/' + _MAX_RETRIES + ' in ' + delay + 'ms)', err);
      } else {
        console.error('[realtime] Push gave up for ' + k + ' after ' + _MAX_RETRIES + ' retries', err);
        delete _retryCounts[k];
      }
    });
  });
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
  // Echo suppression: if this matches the value we most recently pushed,
  // drop exactly that one fire. Anything else (cross-tab write, edit from
  // a different client, manual Firebase Console edit) always processes —
  // we can't rely on "localStorage === fbVal" because same-browser tabs
  // share localStorage and that would suppress legitimate updates.
  if (_justWrote[key] === fbVal){
    delete _justWrote[key];
    return;
  }

  // Conflict detection: if the local copy is "dirty" (queued for the next
  // flush) AND differs from the incoming remote value, both sides have
  // diverged. Park the conflict in `_conflicts` and let the user resolve.
  // Without this, the apply below would silently overwrite their pending
  // local edit.
  if (_dirtyKeys.has(key)){
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

  // skt-workspace-v1 backs the global `state` object — re-read it.
  if (key === 'skt-workspace-v1') load();

  // Shared-panels list is its own little world — apply it to the player tab
  // by mounting/unmounting panels, and refresh the DM tab's share toggles.
  if (key === 'skt-shared-panels-v1'){
    try { state.sharedPanels = JSON.parse(fbVal) || []; } catch(_){ state.sharedPanels = []; }
    if (typeof _applySharedPanelsToPlayerView === 'function' && document.body.classList.contains('player-mode')){
      _applySharedPanelsToPlayerView();
    } else {
      // DM tab — refresh share-button icon on each open window.
      document.querySelectorAll('.window').forEach(el => {
        const id = el.dataset.panel;
        const btn = el.querySelector('[data-wact="share"]');
        if (id && btn) btn.textContent = (state.sharedPanels||[]).includes(id) ? '👁' : '◌';
      });
    }
    return;
  }

  // Hidden-books filter — refresh the global cache that shop / search /
  // bestiary / encounter all read from, and re-render the Books panel if
  // it's mounted so the user sees the new state immediately.
  if (key === 'skt-books-hidden-v1'){
    try {
      const arr = JSON.parse(fbVal) || [];
      window.SKT_HIDDEN_SOURCES = new Set((Array.isArray(arr) ? arr : []).map(s => String(s).toLowerCase()));
      const def = panelDefs && panelDefs.books;
      if (def){
        // Replace the panel-local copy with the synced one so toggles done
        // in this tab don't fight the remote authority. _render() rebuilds
        // the list with the new hidden set; the search query etc. survive.
        def._hiddenBooks = new Set(arr);
        if (def._body) def._render();
      }
    } catch(_){}
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
    // Update internal data directly so the BroadcastChannel doesn't fire
    // a duplicate event into the player view.
    try {
      const d = JSON.parse(localStorage.getItem('skt-battlemap-v1') || '{}');
      def._tokens     = d.tokens   || [];
      def._fog        = d.fog      ? new Set(d.fog) : null;
      def._drawings   = Array.isArray(d.drawings) ? d.drawings : [];
      def._bgColor    = d.bgColor  || def._bgColor;
      def._cellSize   = d.cellSize || def._cellSize;
      def._cols       = d.cols     || def._cols;
      def._rows       = d.rows     || def._rows;
      def._showGrid   = d.showGrid !== false;
      def._bgMapPath  = d.bgMapPath || null;
      def._render();
      if (def._bgMapPath) def._loadBgFromPath?.(def._bgMapPath);
    } catch(e) {}
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
function initRealtime() {
  // Skip if config hasn't been filled in yet
  if (firebaseConfig.apiKey === 'REPLACE_ME') {
    _setSyncStatus('offline');
    console.info('[SKT] Firebase not configured — running in local-only mode.\nSee js/realtime.js for setup instructions.');
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

  _patchLocalStorage();

  // One listener per sync key. A change to one subsystem only re-downloads
  // that subsystem's blob — not the entire dataset. Massive bandwidth win
  // during play, when most edits touch a single key (HP, token positions, etc).
  SKT_SYNC_KEYS.forEach(k => {
    const path = 'skt/' + _toFbKey(k);
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
    }, err => {
      console.error('[SKT] Firebase read error for ' + k + ':', err);
      _setSyncStatus('offline');
    });
  });

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
      _fbDb.ref('skt/' + _toFbKey(k)).once('value').then(snap => {
        if (snap.exists()) _applyRemoteKey(k, snap.val());
      }).catch(()=>{});
    });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') _refreshAll();
  });
  window.addEventListener('focus', _refreshAll);
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

