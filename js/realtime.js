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
  'skt-notes-v1',      // session notes
  'skt-npcs-v1',       // NPC library
];

// Firebase keys cannot contain hyphens or dots — convert to underscores
function _toFbKey(lsKey) { return lsKey.replace(/[-\.]/g, '_'); }

let _remoteUpdate = false; // true while applying remote changes → prevents echo writes
let _pushTimer    = null;  // debounce handle for outgoing writes
let _fbDb         = null;  // Firebase database reference

// ─── Intercept localStorage writes ────────────────────────────────────────────
// Any panel that calls localStorage.setItem('skt-*', ...) will automatically
// trigger a push to Firebase. No panel code needs to change.
function _patchLocalStorage() {
  const _orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    _orig.call(this, key, value);
    if (!_remoteUpdate && SKT_SYNC_KEYS.includes(key) && _fbDb) {
      clearTimeout(_pushTimer);
      _pushTimer = setTimeout(_pushToCloud, 300); // debounce: batch rapid saves
    }
  };
}

function _pushToCloud() {
  if (!_fbDb) return;
  const payload = {};
  SKT_SYNC_KEYS.forEach(k => {
    const val = localStorage.getItem(k);
    if (val != null) payload[_toFbKey(k)] = val;
  });
  _fbDb.ref('skt/data').set(payload).catch(() => {});
}

// ─── Apply incoming remote changes ────────────────────────────────────────────
function _applyRemoteData(data) {
  let changed = false;

  _remoteUpdate = true;
  SKT_SYNC_KEYS.forEach(k => {
    const fbVal = data[_toFbKey(k)];
    if (fbVal != null && localStorage.getItem(k) !== fbVal) {
      localStorage.setItem(k, fbVal); // won't echo back (remoteUpdate = true)
      changed = true;
    }
  });
  _remoteUpdate = false;

  if (!changed) return;

  // Re-read main state object from the updated localStorage
  load();

  // Re-render every open panel whose data may have changed
  _reloadPanels();
}

function _reloadPanels() {
  // Panels that read directly from the global `state` object
  ['combat', 'party', 'shop'].forEach(id => {
    const def = panelDefs[id];
    if (def && def._body) def._render?.();
  });

  // Panels that cache localStorage into their own property
  _remountPanel('npclib',    () => { panelDefs.npclib._npcs  = null; });
  _remountPanel('loot',      () => { panelDefs.loot._loot    = null; });
  _remountPanel('notes',     () => { panelDefs.notes._pages  = null; });
  _remountPanel('encounter', () => { /* mount() always re-reads */ });

  // Battle map: update internal data directly to avoid duplicate BroadcastChannel
  const bm = panelDefs.battlemap;
  if (bm && bm._body) {
    try {
      const d = JSON.parse(localStorage.getItem('skt-battlemap-v1') || '{}');
      bm._tokens   = d.tokens   || [];
      bm._fog      = d.fog      ? new Set(d.fog) : null;
      bm._bgColor  = d.bgColor  || bm._bgColor;
      bm._cellSize = d.cellSize || bm._cellSize;
      bm._cols     = d.cols     || bm._cols;
      bm._rows     = d.rows     || bm._rows;
      bm._render();
    } catch(e) {}
  }
}

function _remountPanel(id, resetFn) {
  const def = panelDefs[id];
  if (!def || !def._body) return;
  resetFn();
  def.mount(def._body);
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

  // Watch for changes from any connected client (including ourselves on first load)
  _fbDb.ref('skt/data').on('value', snapshot => {
    if (!snapshot.exists()) {
      // Database empty — we're the first user; seed it with our local data
      _pushToCloud();
      return;
    }
    _applyRemoteData(snapshot.val());
  }, err => {
    console.error('[SKT] Firebase read error:', err);
    _setSyncStatus('offline');
  });

  // Track connection state for the status indicator
  _fbDb.ref('.info/connected').on('value', snap => {
    _setSyncStatus(snap.val() ? 'live' : 'offline');
    // On reconnect after being offline, push any local changes we accumulated
    if (snap.val()) {
      clearTimeout(_pushTimer);
      _pushTimer = setTimeout(_pushToCloud, 500);
    }
  });
}
