// ============================================================
// UNDO — for everything that isn't the map
// ============================================================
// The battle map has had undo since the day it got a pencil. Nothing else
// did, and the things that need it most live in the tracker: damage typed
// into the wrong card, a combatant removed instead of duplicated, a long
// rest taken one fight early. Those are reconstructed from memory today, at
// the table, with six people waiting.
//
// Two rules shaped this:
//
//   1. Undo is SURGICAL, not a rewind. Restoring the whole party record
//      would throw away whatever the other five devices did in the seconds
//      since — exactly the class of bug the record merge in realtime.js was
//      written to end. So an entry remembers the before AND after of each
//      key it touched, and on undo it reverts only the records that differ
//      between the two, on top of whatever the key holds NOW.
//
//   2. It goes through save(). Writing localStorage directly would skip the
//      token reconciler, the Attack Runner's refresh and the sync push — the
//      undo would show on this screen and nowhere else.
//
// Call sites wrap the mutation, not the click:
//
//   sktUndoable('Ogre took 12 damage', () => this._applyHpDelta(i, -12));
//
// A promise-returning fn is waited on, so a confirm dialog can sit in the
// middle of one. Nothing changed means no entry and no toast.

const SKT_UNDO_MAX = 25;
const _sktUndoStack = [];
const _sktRedoStack = [];

// Which loadDomain() call puts a restored key back into `state`.
const SKT_UNDO_DOMAIN = {
  'skt-party-v1':    'party',
  'skt-combat-v1':   'combat',
  'skt-shop-v1':     'shop',
  'skt-settings-v1': 'settings',
  'skt-prompt-v1':   'prompt',
};
const SKT_UNDO_MAP_KEY = 'skt-battlemap-v1';
const SKT_UNDO_DEFAULT_KEYS = ['skt-combat-v1', 'skt-party-v1'];
// A map snapshot is the whole map — background geometry, fog and every
// stroke. Worth keeping for "end combat" (which sweeps the tracker's tokens
// off the board) and not worth keeping 25 of, so an oversized one is simply
// not captured: the undo still restores the tracker, and the tokens come
// back where sktEnsureCombatTokens puts them.
const SKT_UNDO_MAX_SNAP = 2000000;

function _sktUndoSnap(keys){
  const o = {};
  keys.forEach(k => {
    let v = null;
    try { v = localStorage.getItem(k); } catch(e){ v = null; }
    o[k] = (v != null && v.length > SKT_UNDO_MAX_SNAP) ? undefined : v;
  });
  return o;
}

// Records keyed by id: party members, combatants. Returns `cur` with only
// the records this action changed put back to `target`.
// One record, field by field. Restoring the whole record would be simpler
// and wrong: removing a combatant renumbers the rest of its group, so an
// undone removal would also roll back the hit points someone else took off
// "Goblin 2" in the meantime. Only the fields the action itself moved go
// back.
function _sktRevertFields(t, o, c){
  const out = { ...c };
  new Set(Object.keys(t).concat(Object.keys(o))).forEach(k => {
    if (JSON.stringify(t[k]) === JSON.stringify(o[k])) return;   // untouched
    if (t[k] === undefined) delete out[k];                       // the action added it
    else out[k] = t[k];
  });
  return out;
}

function _sktRevertRecords(targetArr, otherArr, curArr){
  const byId = l => {
    const m = new Map();
    (Array.isArray(l) ? l : []).forEach((r, i) => { if (r && r.id != null && !m.has(r.id)) m.set(r.id, { r, i }); });
    return m;
  };
  const T = byId(targetArr), O = byId(otherArr);
  const out = (Array.isArray(curArr) ? curArr : []).slice();
  new Set([...T.keys(), ...O.keys()]).forEach(id => {
    const t = T.get(id), o = O.get(id);
    if (JSON.stringify(t && t.r) === JSON.stringify(o && o.r)) return;  // not ours
    const ci = out.findIndex(r => r && r.id === id);
    if (!t){ if (ci >= 0) out.splice(ci, 1); return; }                  // we added it
    if (ci >= 0) out[ci] = o ? _sktRevertFields(t.r, o.r, out[ci]) : t.r;   // we changed it
    else out.splice(Math.min(t.i, out.length), 0, t.r);                 // we removed it
  });
  return out;
}

function _sktRevertCombat(target, other, cur){
  const T = JSON.parse(target || '{}'), O = JSON.parse(other || '{}'), C = JSON.parse(cur || '{}');
  const out = { ...C };
  out.combatants = _sktRevertRecords(T.combatants, O.combatants, C.combatants);
  ['combatRound', 'activeCombatantId'].forEach(k => {
    if (JSON.stringify(T[k]) !== JSON.stringify(O[k])) out[k] = (T[k] === undefined ? null : T[k]);
  });
  return JSON.stringify(out);
}

// The string to write for `key` to get back to `target`, given that the
// action moved it from `target` to `other` and the key now holds `cur`.
function _sktRevertKey(key, target, other){
  let cur = null;
  try { cur = localStorage.getItem(key); } catch(e){}
  if (cur === other || cur == null) return target;   // nothing else moved since
  try {
    if (key === 'skt-combat-v1') return _sktRevertCombat(target, other, cur);
    if (key === 'skt-party-v1'){
      return JSON.stringify(_sktRevertRecords(JSON.parse(target || '[]'), JSON.parse(other || '[]'), JSON.parse(cur || '[]')));
    }
  } catch(e){ /* fall through to the blunt restore */ }
  return target;
}

function _sktUndoRedraw(){
  if (typeof panelDefs !== 'undefined'){
    ['combat', 'party', 'attacks', 'turnview'].forEach(id => {
      const d = panelDefs[id];
      if (d && d._body && typeof d._render === 'function'){ try { d._render(); } catch(e){} }
    });
  }
  if (typeof paRender === 'function' && document.body.classList.contains('player-app')){
    try { paRender(); } catch(e){}
  }
}

function _sktUndoGoto(entry, target, other){
  const domains = new Set();
  let mapBack = false;
  entry.keys.forEach(k => {
    if (target[k] === other[k]) return;              // this key sat the action out
    if (target[k] === undefined) return;             // too big to have been captured
    const v = _sktRevertKey(k, target[k], other[k]);
    try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch(e){}
    if (k === SKT_UNDO_MAP_KEY) mapBack = true;
    const d = SKT_UNDO_DOMAIN[k];
    if (d) domains.add(d);
  });
  domains.forEach(d => { try { loadDomain(d); } catch(e){} });
  try { save(); } catch(e){}
  if (mapBack && typeof panelDefs !== 'undefined' && panelDefs.battlemap){
    try {
      panelDefs.battlemap.applyMapState(JSON.parse(localStorage.getItem(SKT_UNDO_MAP_KEY) || '{}'), { source: 'undo' });
    } catch(e){}
  }
  _sktUndoRedraw();
}

// Run `fn`, and if it changed anything, remember how to put it back.
// opts.keys  — which localStorage keys the action can touch (default combat + party)
// opts.quiet — record it, but don't show the toast (the caller shows its own)
function sktUndoable(label, fn, opts){
  const keys = (opts && opts.keys) || SKT_UNDO_DEFAULT_KEYS;
  const before = _sktUndoSnap(keys);
  const finish = () => _sktUndoRecord(label, keys, before, opts);
  let r;
  try { r = fn(); }
  catch(e){ finish(); throw e; }
  if (r && typeof r.then === 'function'){
    return r.then(v => { finish(); return v; }, e => { finish(); throw e; });
  }
  finish();
  return r;
}

function _sktUndoRecord(label, keys, before, opts){
  const after = _sktUndoSnap(keys);
  if (keys.every(k => before[k] === after[k])) return false;   // the click did nothing
  _sktUndoStack.push({ label, keys, before, after });
  while (_sktUndoStack.length > SKT_UNDO_MAX) _sktUndoStack.shift();
  _sktRedoStack.length = 0;
  if (!(opts && opts.quiet)) _sktUndoToast(label, 'Undo', sktUndo);
  return true;
}

// The battle map's toolbar buttons name what they would undo; keep them
// current whatever just changed.
function _sktUndoChanged(){
  try { const m = (typeof panelDefs !== 'undefined') && panelDefs.battlemap; if (m && m._body) m._updateUndoButtons(); } catch(e){}
}

function _sktUndoToast(msg, actionLabel, run){
  _sktUndoChanged();
  if (typeof showToast !== 'function') return;
  showToast(msg, { action: { label: actionLabel, run } });
}

// The pair passed to _sktUndoGoto is always (where we want to end up, where
// the action left things). Passing "the state right now" as the second half
// looks equivalent and is not: _sktRevertKey compares it against what the key
// holds to decide whether anyone else has touched it, and "now" always
// matches, so every undo took the blunt path and overwrote the other
// devices' work — the exact thing this file exists to avoid.
function sktUndo(){
  const e = _sktUndoStack.pop();
  if (!e){ if (typeof showToast === 'function') showToast('Nothing to undo'); return false; }
  if (e.custom){
    if (!_sktCustomGo(e, true)) return false;      // stale: dropped, not moved to redo
    _sktRedoStack.push(e);
    _sktUndoToast('Undone — ' + e.label, 'Redo', sktRedo);
    return true;
  }
  _sktRedoStack.push(e);
  _sktUndoGoto(e, e.before, e.after);
  _sktUndoToast('Undone — ' + e.label, 'Redo', sktRedo);
  return true;
}

function sktRedo(){
  const e = _sktRedoStack.pop();
  if (!e){ if (typeof showToast === 'function') showToast('Nothing to redo'); return false; }
  if (e.custom){
    if (!_sktCustomGo(e, false)) return false;
    _sktUndoStack.push(e);
    _sktUndoToast('Redone — ' + e.label, 'Undo', sktUndo);
    return true;
  }
  _sktUndoStack.push(e);
  while (_sktUndoStack.length > SKT_UNDO_MAX) _sktUndoStack.shift();
  _sktUndoGoto(e, e.after, e.before);
  _sktUndoToast('Redone — ' + e.label, 'Undo', sktUndo);
  return true;
}

// An entry that knows its own way back and forward, for state that isn't
// one of the synced keys above — the battle map's tokens, fog and strokes,
// which live on the panel. `valid()` lets the owner refuse an undo that
// would now revert someone else's work (the map, after a remote change).
function sktUndoRecordCustom(label, undoFn, redoFn, opts){
  opts = opts || {};
  _sktUndoStack.push({ label, custom: { undo: undoFn, redo: redoFn, valid: opts.valid || null } });
  while (_sktUndoStack.length > SKT_UNDO_MAX) _sktUndoStack.shift();
  _sktRedoStack.length = 0;
  if (!opts.quiet) _sktUndoToast(label, 'Undo', sktUndo);
}
function _sktCustomGo(e, back){
  if (e.custom.valid && !e.custom.valid()){
    if (typeof showToast === 'function') showToast('Can\u2019t undo \u201c' + e.label + '\u201d \u2014 it has changed on another device since');
    return false;
  }
  try { (back ? e.custom.undo : e.custom.redo)(); } catch(err){ console.warn('[undo]', err); return false; }
  return true;
}

function sktUndoLabel(){ const e = _sktUndoStack[_sktUndoStack.length - 1]; return e ? e.label : null; }
function sktRedoLabel(){ const e = _sktRedoStack[_sktRedoStack.length - 1]; return e ? e.label : null; }
function sktUndoDepth(){ return _sktUndoStack.length; }

// Ctrl+Z / Ctrl+Shift+Z anywhere except inside a field. One history for the
// whole app, the battle map included: there used to be two, and Ctrl+Z in
// the map window undid the last map change even when the last thing done
// there was damage from a token's panel, which lived in the other one.
function initUndoKeys(){
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = String(e.key || '').toLowerCase();
    if (k !== 'z' && k !== 'y') return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
    e.preventDefault();
    if (k === 'y' || e.shiftKey) sktRedo(); else sktUndo();
  });
}
