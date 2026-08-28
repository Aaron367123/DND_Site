// ============================================================
// BACKUP — whole-campaign snapshot, restore, and rolling autosaves
// ============================================================
// WHY THIS EXISTS
// ---------------
// The original Settings "Export JSON" wrote exactly six fields:
//     party, combatants, combatRound, activeCombatantId, shop, settings
// The app owns ~50 localStorage keys. Everything else — session notes, the
// battle map (tokens, fog, drawings, saved and starred maps), the bestiary,
// the NPC library, loot, encounters, the soundboard's scene layout, time,
// weather, bookmarks — was silently absent from every "backup" ever taken.
// A user restoring one would have believed they were whole and quietly lost
// the rest.
//
// This module snapshots EVERY key the app owns, minus a short denylist of
// things that are per-browser rather than per-campaign (documented below).
//
// WHAT IS STILL NOT COVERED (be honest about it in the UI):
//   • Soundboard AUDIO. Raw Blobs in the `skt-soundboard` IndexedDB store,
//     routinely hundreds of MB. The scene/pad LAYOUT is backed up; the
//     audio files are not — re-add them from disk after a restore.
//   • The 5e data index (`skt-5edata` IndexedDB). A derived cache; it
//     rebuilds itself from data/*.json on next load.
'use strict';

(function(){

// Snapshot format. Bump only for a breaking layout change — added keys are
// not breaking, since restore just writes whatever it finds.
const FORMAT  = 'skt-backup';
const VERSION = 2;

// Keys deliberately excluded from a snapshot. Each is per-BROWSER, not
// per-campaign, so carrying it into another profile is wrong rather than
// merely redundant.
const EXCLUDE = new Set([
  // Per-browser author identity for notes line-coloring. Restoring this onto
  // a second device would make two people the same author — the one case
  // here that actively corrupts data rather than just being noise. Same
  // reasoning that keeps it out of SKT_SYNC_KEYS (see realtime.js).
  'skt-me-v1',
  // One-shot UI flags. Harmless to carry, but they aren't campaign data and
  // restoring them re-suppresses onboarding on a fresh browser where the
  // user probably wants it.
  'skt-tutorial-seen-v2',
  'skt-pv-dock-hint-seen',
  'skt-changelog-seen-version',
  // The pre-demo stash of real data. Transient by design (onboarding.js
  // writes it, then restores from it); snapshotting it would double the
  // payload and could resurrect stale state on restore.
  'skt-demo-snapshot-v1',
  // A salvage artifact written when notes JSON fails to parse. Potentially
  // large, definitely not live data.
  'skt-notes-v2-corrupt-backup',
  // Transient UI noise.
  'skt-search-recent-v1',
  // The per-device half of state.settings — font scale, hidden chrome, panel
  // density. Exactly the same argument as the battle-map zoom below: these
  // describe a screen, not a campaign, and restoring one screen's onto
  // another is wrong rather than merely redundant.
  'skt-view-prefs-v1',
  // Per-device battle-map zoom, one key per window role. A zoom fitted to a
  // 27" monitor restored onto a phone is exactly the "wrong, not merely
  // redundant" case above — and per-device zoom exists precisely so screens
  // of different sizes stop inheriting each other's view.
  'skt-bm-view-v1',
  'skt-bm-view-player-v1',
  // Workspace canvas zoom. Same reasoning one step out: it is fitted to the
  // screen that set it. Restoring a desktop's zoom onto a phone was one of the
  // two ways a phone ended up scaled off its own screen (see _zoomLocked() in
  // zoom-pan.js); the phone layout now ignores it, but carrying it across is
  // still wrong on any device.
  'skt-zoom-v1',
]);

// Friendly names for the restore preview. Anything unlisted still gets
// backed up and restored — it just shows under "other".
const LABELS = {
  'skt-party-v1':             'Party',
  'skt-combat-v1':            'Combat tracker',
  'skt-notes-v2':             'Session notes',
  'skt-battlemap-v1':         'Battle map',
  'skt-battlemap-saved-v1':   'Saved maps',
  'skt-battlemap-starred-v1': 'Starred maps',
  'skt-bestiary-v1':          'Bestiary',
  'skt-npcs-v2':              'NPC library',
  'skt-loot-v1':              'Loot',
  'skt-enc-v1':               'Encounters',
  'skt-shop-v1':              'Shop',
  'skt-settings-v1':          'Settings',
  'skt-time-v1':              'Time tracker',
  'skt-weather-v2':           'Weather',
  'skt-sb-scenes-v1':         'Soundboard scenes',
  'skt-sb-ambient-v1':        'Soundboard ambience',
  'skt-book-bookmarks-v1':    'Book bookmarks',
  'skt-adv-bookmarks-v1':     'Adventure bookmarks',
  'skt-books-hidden-v1':      'Hidden books',
  'skt-adventures-hidden-v1': 'Hidden adventures',
  'skt-layout-v1':            'Panel layout',
  'skt-shared-panels-v1':     'Shared panels',
};

// Count the interesting things inside a key's JSON so the preview can say
// "Party (5 members)" instead of "Party (14 KB)". Best-effort: anything
// unparseable or unrecognised just reports no count.
function _count(key, raw){
  let d; try { d = JSON.parse(raw); } catch(e){ return null; }
  if (d == null) return null;
  const n = (v) => Array.isArray(v) ? v.length : null;
  switch (key){
    case 'skt-party-v1':     return n(d) ?? n(d.party);
    case 'skt-combat-v1':    return n(d.combatants);
    case 'skt-notes-v2':     return n(d.notes) ?? (d.tree ? null : n(d));
    case 'skt-bestiary-v1':  return n(d) ?? n(d.monsters);
    case 'skt-npcs-v2':      return n(d) ?? n(d.npcs);
    case 'skt-loot-v1':      return n(d.items) ?? n(d);
    case 'skt-battlemap-v1': return n(d.tokens);
    case 'skt-battlemap-saved-v1': return n(d);
    default: return Array.isArray(d) ? d.length : null;
  }
}

// A build fingerprint for the file header. There's no global build constant,
// but tools/stamp-build.js rewrites every script's ?v= to a content hash, so
// app.js's hash identifies the build and needs nothing extra to maintain.
function _buildId(){
  try {
    const el = document.querySelector('script[src*="js/app.js"]');
    const m = el && /[?&]v=([a-f0-9]+)/i.exec(el.getAttribute('src') || '');
    return m ? m[1] : null;
  } catch(e){ return null; }
}

function _bytes(n){
  if (n < 1024) return n + ' B';
  if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB';
  return (n/(1024*1024)).toFixed(1) + ' MB';
}

// ─── Snapshot ────────────────────────────────────────────────────────────────
// Values are stored as RAW STRINGS, never re-parsed and re-serialized. A
// round trip through JSON.parse/stringify would silently reorder keys, drop
// undefined, and mangle any value the app happens to store non-canonically —
// so the restore would not be byte-identical to what was backed up.
function snapshot(){
  const keys = {};
  for (let i = 0; i < localStorage.length; i++){
    const k = localStorage.key(i);
    if (!k || k.indexOf('skt-') !== 0 || EXCLUDE.has(k)) continue;
    const v = localStorage.getItem(k);
    if (v != null) keys[k] = v;
  }
  return {
    format: FORMAT,
    version: VERSION,
    created: new Date().toISOString(),
    // Which build wrote it — useful when a restore behaves oddly later.
    build: _buildId(),
    keys,
  };
}

function snapshotSize(snap){
  let n = 0;
  Object.keys(snap.keys || {}).forEach(k => { n += k.length + snap.keys[k].length; });
  return n;
}

// ─── Read a file back ────────────────────────────────────────────────────────
// Accepts both the current format and the ORIGINAL six-field export, so
// backups taken before this module existed still restore. Returns a
// normalized {keys, created, version, legacy} or throws with a plain reason.
function parse(text){
  let d;
  try { d = JSON.parse(text); }
  catch(e){ throw new Error('Not valid JSON — ' + e.message); }
  if (!d || typeof d !== 'object') throw new Error('Not a backup file.');

  if (d.format === FORMAT && d.keys && typeof d.keys === 'object'){
    return { keys: d.keys, created: d.created || null, version: d.version || 1, legacy: false };
  }

  // Legacy v1: top-level state fields, no wrapper. Rebuild the two keys the
  // old export actually covered. state.js owns the exact shape of
  // skt-combat-v1, so mirror it here rather than guessing.
  const hasLegacy = ['party','combatants','shop','settings'].some(f => f in d);
  if (!hasLegacy) throw new Error('Unrecognised file — no backup data found.');
  const keys = {};
  if (Array.isArray(d.party)) keys['skt-party-v1'] = JSON.stringify(d.party);
  if (Array.isArray(d.combatants)){
    keys['skt-combat-v1'] = JSON.stringify({
      combatants: d.combatants,
      combatRound: typeof d.combatRound === 'number' ? d.combatRound : 0,
      activeCombatantId: d.activeCombatantId ?? null,
    });
  }
  if (d.shop)     keys['skt-shop-v1']     = JSON.stringify(d.shop);
  if (d.settings) keys['skt-settings-v1'] = JSON.stringify(d.settings);
  return { keys, created: null, version: 1, legacy: true };
}

// ─── Human-readable preview ──────────────────────────────────────────────────
// Shown before a restore so the user can back out. Lists what will be
// REPLACED and — just as importantly — what is present locally but absent
// from the file, because those are the things a restore will destroy.
function describe(parsed){
  const keys = parsed.keys || {};
  const names = Object.keys(keys);
  const lines = [];
  const known = [], other = [];
  names.forEach(k => {
    const label = LABELS[k];
    const c = _count(k, keys[k]);
    const txt = (label || k) + (c != null ? ' (' + c + ')' : '');
    (label ? known : other).push(txt);
  });
  known.sort();
  known.forEach(t => lines.push('• ' + t));
  if (other.length) lines.push('• ' + other.length + ' other setting' + (other.length===1?'':'s'));
  if (!lines.length) lines.push('• Nothing recognisable — the file may be from a different tool');

  // What exists here but not in the file. Restore clears these, and that is
  // the failure mode most likely to surprise someone.
  const localOnly = [];
  for (let i = 0; i < localStorage.length; i++){
    const k = localStorage.key(i);
    if (!k || k.indexOf('skt-') !== 0 || EXCLUDE.has(k)) continue;
    if (!(k in keys) && LABELS[k]) localOnly.push(LABELS[k]);
  }
  return { lines, localOnly: localOnly.sort(), legacy: !!parsed.legacy, created: parsed.created };
}

// ─── Restore ─────────────────────────────────────────────────────────────────
// THE ORDER HERE IS THE WHOLE POINT.
//
// Writing the keys locally is the easy part. The trap is Firebase: on the
// next page load the sync listeners attach, read the server's copy — which
// is still the PRE-restore campaign — and apply it over everything we just
// wrote. The restore vanishes with no error anywhere.
//
// So: write locally, then wait for the push to actually land on the server,
// and only reload once it has. If the push can't be confirmed we say so and
// let the user decide, rather than reloading into a silent rollback.
async function restore(parsed, opts){
  opts = opts || {};
  const keys = parsed.keys || {};
  const names = Object.keys(keys);
  if (!names.length) throw new Error('Nothing to restore.');

  // Safety net: stash what's here now, so a mistaken restore is undoable.
  // Deliberately not fatal — a failure here must not block the restore.
  let undo = null;
  try { undo = await autosave.write('before-restore'); }
  catch(e){ console.warn('[backup] pre-restore autosave failed', e); }

  // Clear app keys the file doesn't carry. Without this a restore MERGES:
  // an NPC deleted before the backup was taken would come back to life.
  const stale = [];
  for (let i = 0; i < localStorage.length; i++){
    const k = localStorage.key(i);
    if (!k || k.indexOf('skt-') !== 0 || EXCLUDE.has(k)) continue;
    if (!(k in keys)) stale.push(k);
  }
  // setItem THEN removeItem, in that order, and both are load-bearing:
  //   • setItem is the only thing realtime.js hooks, so it's what marks the
  //     key dirty. A bare removeItem would clear it locally and leave the old
  //     value on the server, which the next load would pull straight back.
  //   • removeItem then leaves localStorage actually clean. The flush reads
  //     the key at flush time and finds it gone, so it pushes null and the
  //     server node is deleted — which is what "not in the backup" means.
  // Stopping at setItem('') would leave empty-string debris in localStorage
  // that shows up in every later snapshot.
  stale.forEach(k => {
    try { localStorage.setItem(k, ''); localStorage.removeItem(k); } catch(e){}
  });

  names.forEach(k => {
    try { localStorage.setItem(k, keys[k]); }
    catch(e){
      // Quota is the realistic failure. Report it rather than half-restoring
      // in silence.
      throw new Error('Could not write ' + k + ' — ' + (e && e.name === 'QuotaExceededError'
        ? 'browser storage is full.' : (e.message || e)));
    }
  });

  // Publish, and confirm it landed. Returns 'published' | 'offline' |
  // 'timeout' so the caller can be specific about what happened.
  let sync = 'offline';
  if (typeof window.realtimeFlushAndWait === 'function'){
    sync = await window.realtimeFlushAndWait(opts.syncTimeoutMs || 8000);
  }
  return { restored: names.length, cleared: stale.length, sync, undo };
}

// ─── Rolling automatic snapshots ─────────────────────────────────────────────
// A backup you have to remember to click is a backup you don't have. These
// run on their own and are what actually saves a bad day.
//
// IndexedDB, not localStorage: snapshots are roughly the size of all app
// state combined, and localStorage's ~5 MB ceiling is already shared with
// that state. Same reasoning as the soundboard's Blob store.
const autosave = (function(){
  const DB = 'skt-backups', STORE = 'snapshots', VER = 1;
  const KEEP = 10;              // rolling depth
  const INTERVAL_MS = 15 * 60 * 1000;
  let _timer = null, _lastJson = null;

  function _open(){
    return new Promise((res, rej) => {
      let req;
      try { req = indexedDB.open(DB, VER); }
      catch(e){ return rej(e); }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)){
          db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
  }
  function _tx(db, mode){ return db.transaction(STORE, mode).objectStore(STORE); }

  async function write(reason){
    const snap = snapshot();
    const json = JSON.stringify(snap.keys);
    // Skip byte-identical consecutive snapshots so an idle tab doesn't push
    // ten copies of the same state out of the ring and evict real history.
    if (reason === 'auto' && json === _lastJson) return null;
    const db = await _open();
    const rec = { created: snap.created, reason: reason || 'auto', size: snapshotSize(snap), snap };
    const id = await new Promise((res, rej) => {
      const r = _tx(db, 'readwrite').add(rec);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    _lastJson = json;
    await prune(db);
    db.close();
    return { id, ...rec };
  }

  async function list(){
    const db = await _open();
    const all = await new Promise((res, rej) => {
      const r = _tx(db, 'readonly').getAll();
      r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
    });
    db.close();
    // Newest first, and drop the bulky payload — callers that want it use get().
    return all.sort((a,b) => (b.id||0) - (a.id||0))
              .map(r => ({ id:r.id, created:r.created, reason:r.reason, size:r.size }));
  }

  async function get(id){
    const db = await _open();
    const rec = await new Promise((res, rej) => {
      const r = _tx(db, 'readonly').get(id);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    db.close();
    return rec || null;
  }

  // Two independent rings, newest KEEP of each. Timed snapshots must not be
  // able to push out the deliberate ones ('manual', 'before-restore') — those
  // are the ones someone took because they were about to do something risky.
  // Both are capped, though: an uncapped ring is an unbounded disk leak.
  async function prune(openDb){
    const db = openDb || await _open();
    const all = await new Promise((res, rej) => {
      const r = _tx(db, 'readonly').getAll();
      r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
    });
    const newestFirst = (a,b) => (b.id||0) - (a.id||0);
    const kill = [
      ...all.filter(r => r.reason === 'auto').sort(newestFirst).slice(KEEP),
      ...all.filter(r => r.reason !== 'auto').sort(newestFirst).slice(KEEP),
    ].map(r => r.id);
    if (kill.length){
      const st = _tx(db, 'readwrite');
      kill.forEach(id => { try { st.delete(id); } catch(e){} });
    }
    if (!openDb) db.close();
    return kill.length;
  }

  async function remove(id){
    const db = await _open();
    await new Promise((res, rej) => {
      const r = _tx(db, 'readwrite').delete(id);
      r.onsuccess = () => res(); r.onerror = () => rej(r.error);
    });
    db.close();
  }

  function start(){
    if (_timer || !window.indexedDB) return;
    // First one shortly after load rather than immediately — let the panels
    // finish mounting and any incoming sync settle, so snapshot #1 reflects
    // real state instead of a half-initialised app.
    setTimeout(() => { write('auto').catch(e => console.warn('[backup] autosave failed', e)); }, 60000);
    _timer = setInterval(() => {
      write('auto').catch(e => console.warn('[backup] autosave failed', e));
    }, INTERVAL_MS);
    // Best-effort snapshot on the way out. visibilitychange, not unload:
    // mobile browsers routinely kill a backgrounded tab without ever firing
    // unload, and IndexedDB writes started in unload get cancelled anyway.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden'){
        write('auto').catch(()=>{});
      }
    });
  }

  return { write, list, get, remove, prune, start, KEEP, INTERVAL_MS };
})();

// ─── File download ───────────────────────────────────────────────────────────
function download(snap){
  snap = snap || snapshot();
  const blob = new Blob([JSON.stringify(snap, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = (snap.created || new Date().toISOString()).slice(0,10);
  const a = Object.assign(document.createElement('a'), { href:url, download:'skt-backup-' + stamp + '.json' });
  a.click();
  // Revoke on the next tick — revoking synchronously can cancel the download
  // in some browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return snapshotSize(snap);
}

window.sktBackup = {
  snapshot, snapshotSize, parse, describe, restore, download, autosave,
  formatBytes: _bytes,
  EXCLUDE, LABELS,
};

})();
