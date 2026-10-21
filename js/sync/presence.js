// ============================================================
// PRESENCE — who is connected, and is their screen the same as mine
// ============================================================
// Reported from the table: "the syncing buffers and different devices get
// desynced, so a drawing or a move just gets trapped on the screen." Every
// fix for that shipped blind — nobody could see, from the DM's seat, whether
// a phone was still connected, or whether what it was showing matched.
//
// So each device writes a small heartbeat and reads everyone else's:
//
//   skt/c/<campaign>/live/presence_<deviceId>
//     { ts, who, kind, sig }
//
// It goes under `live/` on purpose. That subtree already exists, is already
// campaign-scoped, is already cleared by the server when a device drops
// (onDisconnect), and is already allowed by the published database rules —
// a new top-level node would have needed those rules republished by hand.
//
// `sig` is a SEMANTIC signature, not a hash of the stored JSON. Two devices
// holding identical data can still store different bytes: the sync layer
// assembles the battle map as {...meta, tokens, fog, fogStrokes, drawings}
// while the panel writes its own key order, and tokens come back in whatever
// order the Firebase node keys enumerate. Hashing the string would have
// reported permanent disagreement between devices that agree. Hashing what
// is actually on screen — which creatures at what HP, which tokens on which
// squares — reports the thing we care about and nothing else.
//
// A device whose signature differs from ours for more than DRIFT_GRACE is
// shown as behind, with a Resync button: that asks it, through the same live
// channel, to re-read every key from Firebase. Which is what reloading the
// page does, without losing anyone's place.

const PRES_ID_KEY  = 'skt-device-v1';
const PRES_CHAN    = 'presence_';   // live-channel name prefix, one per device
const PRES_BEAT_MS  = 12000;   // keepalive, so "quiet" means quiet
const PRES_POLL_MS  = 4000;    // how often we re-check our own signature
const PRES_QUIET_MS = 45000;   // no heartbeat this long: amber
const PRES_GONE_MS  = 120000;  // …this long: drop the row entirely
const PRES_DRIFT_MS = 15000;   // disagreement younger than this is just sync

let _presOthers = {};          // deviceId → entry, as last read
let _presSig = null;           // our own, recomputed every poll
let _presLastSent = null;      // the one in our last heartbeat
let _presSent = 0;             // when we last wrote a heartbeat
let _presDriftSince = {};      // deviceId → THEIR timestamp when they first differed
let _presTimer = null;
let _presUnwatch = null;
let _presWatching = false;
let _presLastResync = 0;

function sktDeviceId(){
  let id = null;
  try { id = localStorage.getItem(PRES_ID_KEY); } catch(e){}
  if (!id){
    id = (typeof uid === 'function' ? uid() : 'd' + Math.random().toString(36).slice(2, 10));
    try { localStorage.setItem(PRES_ID_KEY, id); } catch(e){}
  }
  return id;
}

// This device, in the words someone at the table would use. A player's row
// is their character, because that is who the DM is looking for.
function _presWho(){
  const player = document.body.classList.contains('player-app')
              || document.body.classList.contains('player-mode');
  if (!player) return 'DM';
  try { const pc = (typeof paPc === 'function') && paPc(); if (pc && pc.name) return String(pc.name); } catch(e){}
  return 'Player';
}
function _presKind(){
  let coarse = false, w = 1200;
  try { coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch(e){}
  try { w = Math.min(screen.width || 1200, screen.height || 1200); } catch(e){}
  if (coarse && w <= 540) return 'phone';
  if (coarse) return 'tablet';
  return 'laptop';
}

function _presHash(s){
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h >>> 0).toString(36);
}
function _presJson(k){
  try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch(e){ return null; }
}

// What is on this screen, boiled down to three short strings. Each part is
// named so the strip can say WHICH of them disagrees — "map is behind" is a
// useful thing to read mid-fight; "something is behind" is not.
function sktPresenceSignature(){
  const combat = _presJson('skt-combat-v1') || {};
  const party  = _presJson('skt-party-v1');
  const map    = _presJson('skt-battlemap-v1') || {};
  const cs = [combat.combatRound || 0, combat.activeCombatantId || '-',
    (Array.isArray(combat.combatants) ? combat.combatants : [])
      .map(x => x ? (x.id + ':' + Math.round(+x.hp || 0) + ':' + (x.conditions || []).join('/')) : '-')
      .sort().join('|')].join('~');
  const ps = (Array.isArray(party) ? party : [])
    .map(x => x ? (x.id + ':' + Math.round(+x.hp || 0) + ':' + Math.round(+x.hpMax || 0)) : '-')
    .sort().join('|');
  const toks = (Array.isArray(map.tokens) ? map.tokens : [])
    .map((t, i) => t ? ((t.id || i) + ':' + Math.round((+t.x || 0) * 10) + ',' + Math.round((+t.y || 0) * 10)) : '-')
    .sort().join('|');
  const ms = [toks, (map.drawings || []).length, (map.fogStrokes || []).length,
              map.fog ? String(map.fog).length : 0].join('~');
  return { c: _presHash(cs), p: _presHash(ps), m: _presHash(ms) };
}

function _presSigEq(a, b){ return !!a && !!b && a.c === b.c && a.p === b.p && a.m === b.m; }
function _presDiffParts(a, b){
  if (!a || !b) return [];
  const out = [];
  if (a.c !== b.c) out.push('combat');
  if (a.p !== b.p) out.push('party');
  if (a.m !== b.m) out.push('map');
  return out;
}

function _presNow(){
  const L = window.realtimeLive;
  return (L && typeof L.serverNow === 'function') ? L.serverNow() : Date.now();
}

// Our own signature, at most half a second old. Recomputed rather than
// cached for the whole heartbeat because the list is drawn right after a
// change as often as not, and a stale local signature makes every other
// device look briefly behind.
let _presSigAt = 0;
function _presMySig(){
  const t = Date.now();
  if (!_presSig || t - _presSigAt > 500){ _presSig = sktPresenceSignature(); _presSigAt = t; }
  return _presSig;
}

function _presBeat(force){
  _presSig = null;                       // the beat always measures afresh
  const sig = _presMySig();
  const changed = !_presSigEq(sig, _presSent ? _presLastSent : null);
  const now = Date.now();
  if (!force && !changed && now - _presSent < PRES_BEAT_MS) return;
  _presSent = now;
  _presLastSent = sig;
  const L = window.realtimeLive;
  if (L && typeof L.push === 'function'){
    L.push(PRES_CHAN + sktDeviceId(), { who: _presWho(), kind: _presKind(), sig });
  }
  if (changed) _presPaint();
}

// ─── Reading the room ────────────────────────────────────────────────────────

// One row per device, this one included, newest heartbeat first. `state` is
// 'ok' (agrees with us), 'behind' (has disagreed for a while) or 'quiet'
// (stopped sending). Exported for the self test and for both UIs.
function sktPresenceRows(){
  const now = _presNow();
  const me = sktDeviceId();
  const mine = _presMySig();
  const rows = [{ id: me, who: _presWho(), kind: _presKind(), mine: true, state: 'ok', diff: [], ago: 0 }];
  Object.keys(_presOthers || {}).forEach(id => {
    if (id === me) return;
    const e = _presOthers[id] || {};
    const ago = Math.max(0, now - (+e.ts || 0));
    if (ago > PRES_GONE_MS) return;
    // How long THEY have been reporting a different state, measured on
    // their own heartbeats rather than on our clock. A page opened a second
    // ago would otherwise call a device that has been wrong for ten minutes
    // "fine" for the next fifteen seconds.
    const diff = _presDiffParts(mine, e.sig);
    if (!diff.length) delete _presDriftSince[id];
    else if (!_presDriftSince[id]) _presDriftSince[id] = +e.ts || 0;
    const drifted = diff.length && ((+e.ts || 0) - _presDriftSince[id] > PRES_DRIFT_MS);
    rows.push({
      id, who: e.who || 'Someone', kind: e.kind || '', mine: false,
      state: ago > PRES_QUIET_MS ? 'quiet' : (drifted ? 'behind' : 'ok'),
      diff: drifted ? diff : [], ago,
    });
  });
  rows.sort((a, b) => (a.mine ? -1 : b.mine ? 1 : a.ago - b.ago));
  return rows;
}

function sktPresenceCount(){ return sktPresenceRows().length; }
function sktPresenceTrouble(){ return sktPresenceRows().some(r => r.state !== 'ok'); }

function _presAgoText(ms){
  const s = Math.round(ms / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return s + 's ago';
  return Math.round(s / 60) + ' min ago';
}

function sktPresenceListHtml(){
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rows = sktPresenceRows();
  const body = rows.map(r => {
    const note = r.mine ? 'this device'
      : r.state === 'quiet' ? 'quiet · ' + _presAgoText(r.ago)
      : r.state === 'behind' ? r.diff.join(' and ') + (r.diff.length > 1 ? ' are behind' : ' is behind')
      : 'in sync · ' + _presAgoText(r.ago);
    return '<div class="pres-row pres-' + r.state + '">'
      + '<span class="pres-dot"></span>'
      + '<span class="pres-who">' + esc(r.who) + (r.kind ? '<span class="pres-kind">' + esc(r.kind) + '</span>' : '') + '</span>'
      + '<span class="pres-note">' + esc(note) + '</span>'
      + (r.mine ? '' : '<button class="btn small pres-sync" data-pres-resync="' + esc(r.id) + '">Resync</button>')
      + '</div>';
  }).join('');
  const n = rows.length;
  return '<div class="pres-list">'
    + '<div class="pres-head">' + n + (n === 1 ? ' device' : ' devices') + ' here</div>'
    + body
    + '<div class="pres-foot">Resync makes that device re-read everything. Nothing is lost.</div>'
    + '</div>';
}

// ─── The DM's popover, hung off the sync chip ────────────────────────────────

function sktPresencePopOpen(){ return !!document.getElementById('presence-pop'); }
function sktPresenceClose(){ document.getElementById('presence-pop')?.remove(); }
function sktPresenceToggle(){
  if (sktPresencePopOpen()){ sktPresenceClose(); return; }
  const pop = document.createElement('div');
  pop.id = 'presence-pop';
  pop.className = 'presence-pop';
  pop.innerHTML = sktPresenceListHtml();
  document.body.appendChild(pop);
  const anchor = document.getElementById('sync-status');
  const r = anchor ? anchor.getBoundingClientRect() : null;
  if (r){
    pop.style.top = (r.bottom + 6) + 'px';
    pop.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  }
  _presBeat(true);
}

// The count beside "Live", re-applied every time realtime.js rewrites the
// chip (it replaces the whole innerHTML on each connection change).
function sktPresenceDecorate(el){
  const host = el || document.getElementById('sync-status');
  if (!host) return;
  host.classList.add('sync-clickable');
  host.querySelector('.sync-count')?.remove();
  const rows = sktPresenceRows();
  if (rows.length < 2) return;
  const s = document.createElement('span');
  s.className = 'sync-count' + (sktPresenceTrouble() ? ' warn' : '');
  s.textContent = rows.length;
  host.appendChild(s);
}

function _presPaint(){
  sktPresenceDecorate();
  const pop = document.getElementById('presence-pop');
  if (pop) pop.innerHTML = sktPresenceListHtml();
  const sub = document.getElementById('pa-more-devices');
  if (sub){
    const rows = sktPresenceRows();
    sub.textContent = rows.length + (rows.length === 1 ? ' device' : ' devices')
                    + (sktPresenceTrouble() ? ' · one is behind' : '');
  }
}

// ─── Asking another device to re-read everything ─────────────────────────────

function sktPresenceResync(id){
  const L = window.realtimeLive;
  if (id === sktDeviceId()){ _presSelfResync(); return; }
  if (!L || typeof L.push !== 'function'){ if (typeof showToast === 'function') showToast('Not connected'); return; }
  L.push('resync', { who: id });
  if (typeof showToast === 'function') showToast('Asked that device to resync');
}
function _presSelfResync(){
  try { window.realtimeRefreshAll && window.realtimeRefreshAll(); } catch(e){}
  _presBeat(true);
  if (typeof showToast === 'function') showToast('Re-read everything from the table');
}

// ─── Boot ────────────────────────────────────────────────────────────────────

// The room as this device last heard it: deviceId → entry. Exposed so the
// self test can put a second device in it without a second browser.
// `keepDrift` leaves the "how long have they disagreed" clock running, so a
// test can show the same device twice, a few seconds apart.
function sktPresenceSeed(map, keepDrift){
  _presOthers = map || {};
  if (!keepDrift) _presDriftSince = {};
  _presPaint();
}

// Attach the two listeners, once there is a database to attach them to.
// Called by realtime.js after sign-in, and again from the heartbeat for the
// case where sync comes up later (a reconnect, a config arriving late).
// Returns whether this device is now listening.
function sktPresenceOnline(){
  if (_presWatching) return true;
  const L = window.realtimeLive;
  if (!L || typeof L.watchPrefix !== 'function') return false;
  const off = L.watchPrefix(PRES_CHAN, val => {
    _presOthers = (val && typeof val === 'object') ? val : {};
    _presPaint();
  });
  if (!off) return false;          // no database yet — try again later
  _presWatching = true;
  _presUnwatch = off;
  // "Resync" from another device. listen() already drops anything older than
  // its staleness window, so a command cannot be replayed at us on reconnect
  // hours later; the timestamp check below covers a repeat within it.
  L.listen('resync', val => {
    if (!val || val.who !== sktDeviceId()) return;
    if (val.ts && val.ts === _presLastResync) return;
    _presLastResync = val.ts || Date.now();
    _presSelfResync();
  });
  _presBeat(true);
  return true;
}

function initPresence(){
  if (_presTimer) return;
  sktPresenceOnline();
  const chip = document.getElementById('sync-status');
  if (chip) chip.addEventListener('click', () => sktPresenceToggle());
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-pres-resync]');
    if (b){ sktPresenceResync(b.dataset.presResync); return; }
    const pop = document.getElementById('presence-pop');
    if (pop && !pop.contains(e.target) && !(chip && chip.contains(e.target))) sktPresenceClose();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') sktPresenceClose(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') _presBeat(true); });
  _presBeat(true);
  _presTimer = setInterval(() => { sktPresenceOnline(); _presBeat(false); _presPaint(); }, PRES_POLL_MS);
}
