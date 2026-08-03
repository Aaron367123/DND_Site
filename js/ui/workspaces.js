// ============================================================
// WORKSPACES
// ============================================================
// Named panel arrangements you switch between, replacing the single
// 5000x5000 pannable canvas.
//
// A workspace is just a `layout` snapshot — the SAME shape state.js already
// keeps in skt-layout-v1 ({panelId: {x,y,w,h,z,open,minimized,locked}}).
// Switching writes the live layout back into the outgoing workspace, tears
// down every mounted panel, swaps `layout` wholesale, and mounts whatever the
// incoming one wants open. Panel CONTENT is untouched: combat, party, notes
// and the rest live in their own keys and are shared by every workspace. Only
// which windows are open, and where, is per-workspace.
//
// This supersedes "focuses" (skt-focuses-v1, the right-click menu presets).
// A focus was a preset: applying one didn't make it current, so moving a
// window afterwards was lost unless you remembered to hit Update. Existing
// focuses are migrated in as workspaces on first run — see _wsMigrate.
//
// Per-device, deliberately, exactly like skt-layout-v1: a layout tuned for a
// 27" monitor is wrong on a laptop, so this key is not in SKT_SYNC_KEYS.
const WS_KEY = 'skt-workspaces-v1';
const WS_LEGACY_FOCUS_KEY = 'skt-focuses-v1';
const WS_MAX = 12;

let _wsState = null;      // {active, list:[{id,name,icon,panels}]}
// True while switching. saveLayout() fires repeatedly during teardown (every
// closePanel writes) and each of those writes would otherwise be committed
// into the workspace we are in the middle of leaving, replacing the
// arrangement we just saved with a set of closed panels.
let _wsSwitching = false;

function _wsId(){ return 'ws_' + (typeof uid === 'function' ? uid() : Math.random().toString(36).slice(2,9)); }
function _wsClone(o){ try { return JSON.parse(JSON.stringify(o || {})); } catch(e){ return {}; } }

function _wsLoad(){
  try {
    const raw = localStorage.getItem(WS_KEY);
    if (raw){
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.list) && d.list.length) return d;
    }
  } catch(e){}
  return null;
}
function wsSave(){
  if (!_wsState) return;
  try { localStorage.setItem(WS_KEY, JSON.stringify(_wsState)); } catch(e){}
}

// Fold the current layout and any saved focuses into a first workspace set.
// Runs once; after this WS_KEY is authoritative and the focus key is left
// alone as a rollback copy (never written again).
function _wsMigrate(){
  const list = [{ id: _wsId(), name: 'Main', panels: _wsClone(layout) }];
  let focuses = [];
  try { focuses = JSON.parse(localStorage.getItem(WS_LEGACY_FOCUS_KEY) || '[]') || []; } catch(e){}
  focuses.forEach((f, i) => {
    if (!f || list.length >= WS_MAX) return;
    // A focus snapshot only holds the panels that were OPEN, as
    // {x,y,w,h,minimized}, either bare (legacy) or under .panels. Everything
    // absent from it was closed, so start from all-closed and open those.
    const snap = (f.snap && f.snap.panels) ? f.snap.panels : (f.snap || {});
    const panels = {};
    Object.keys(layout).forEach(pid => { panels[pid] = { ...layout[pid], open: false }; });
    Object.keys(snap).forEach(pid => {
      panels[pid] = { ...(layout[pid] || {}), ...snap[pid], open: true };
    });
    list.push({ id: _wsId(), name: String(f.name || ('Focus ' + (i+1))).slice(0, 24), panels });
  });
  return { active: list[0].id, list };
}

// Strict: no "|| list[0]" fallback. wsDelete parks active on null precisely so
// the commit inside the following wsSwitch is a no-op, and a fallback turned
// that into "commit the outgoing workspace's layout into the FIRST one" —
// deleting a workspace silently overwrote Main with whatever had been on
// screen. Boot repairs a dangling active id instead; see initWorkspaces.
function wsActive(){
  if (!_wsState || !_wsState.active) return null;
  return _wsState.list.find(w => w.id === _wsState.active) || null;
}

// Mirror the live layout into the active workspace. Called from saveLayout(),
// so every move/resize/open/close lands in the workspace automatically —
// that's the whole difference between a workspace and the old focus preset.
function wsCommitLayout(){
  if (!_wsState || _wsSwitching) return;
  const a = wsActive();
  if (!a) return;
  a.panels = _wsClone(layout);
  wsSave();
}

// ─── The canvas ──────────────────────────────────────────────────────────────
// Size the canvas to the viewport instead of a fixed 5000x5000, so there is
// nowhere off-screen to lose a window. Two subtleties:
//   • Divide by zoom. The canvas is transform-scaled, so at 2x a 1000px-wide
//     canvas paints 2000px. Layout coordinates are pre-transform, so the
//     usable coordinate space is viewport/zoom.
//   • Never shrink below the content. Zooming IN reduces the usable space, and
//     clamping windows inward on every zoom tick would be destructive — so
//     instead the canvas grows to cover whatever is out there and the scroller
//     can still reach it. At zoom 1 with clamped windows the two are equal and
//     there is nothing to scroll, which is the point.
function wsSizeCanvas(){
  if (document.body.classList.contains('player-mode')) return;
  const ws = document.getElementById('workspace');
  const c  = document.getElementById('workspace-canvas');
  if (!ws || !c) return;
  const z = ((typeof getZoom === 'function' ? getZoom() : 1) || 1);
  let w = Math.max(1, ws.clientWidth  / z);
  let h = Math.max(1, ws.clientHeight / z);
  Object.values(layout).forEach(l => {
    if (!l || !l.open) return;
    w = Math.max(w, (l.x || 0) + (l.w || 0));
    h = Math.max(h, (l.y || 0) + (l.h || 0));
  });
  c.style.width  = Math.round(w) + 'px';
  c.style.height = Math.round(h) + 'px';
}

// The usable coordinate box for window placement, in layout px.
function wsCanvasBox(){
  const ws = document.getElementById('workspace');
  const z = ((typeof getZoom === 'function' ? getZoom() : 1) || 1);
  if (!ws) return { w: Infinity, h: Infinity };
  return { w: Math.max(1, ws.clientWidth / z), h: Math.max(1, ws.clientHeight / z) };
}

// Clamp one window's position so it stays reachable. Keeps the whole window
// inside where it fits; for a window LARGER than the viewport, pins the
// top-left at 0 rather than pushing it negative, because the title bar (and
// therefore drag and close) has to stay on screen.
function wsClampPos(x, y, w, h){
  const box = wsCanvasBox();
  return {
    x: Math.max(0, Math.min(x, Math.max(0, box.w - w))),
    y: Math.max(0, Math.min(y, Math.max(0, box.h - h))),
  };
}

// Pull every open window back inside. Used after a switch and on viewport
// resize — a layout arranged on a wide screen would otherwise put windows
// past the right edge with no way to pan to them.
function wsClampAll(){
  if (document.body.classList.contains('player-mode')) return;
  const box = wsCanvasBox();
  let changed = false;
  Object.keys(layout).forEach(id => {
    const l = layout[id];
    if (!l || !l.open) return;
    // Shrink an oversized window to fit before moving it, or clamping alone
    // would leave most of it unreachable off the right/bottom edge.
    const w = Math.max(240, Math.min(l.w || 320, Math.floor(box.w)));
    const h = Math.max(120, Math.min(l.h || 400, Math.floor(box.h)));
    const p = wsClampPos(l.x || 0, l.y || 0, w, h);
    if (p.x !== l.x || p.y !== l.y || w !== l.w || h !== l.h){
      layout[id] = { ...l, x: p.x, y: p.y, w, h };
      changed = true;
      const el = document.querySelector(`.window[data-panel="${id}"]`);
      if (el){
        el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
        el.style.width = w + 'px';  el.style.height = h + 'px';
      }
    }
  });
  if (changed) saveLayout();
  wsSizeCanvas();
}

// ─── Switching ───────────────────────────────────────────────────────────────
function wsSwitch(id){
  if (!_wsState || id === _wsState.active) return;
  const target = _wsState.list.find(w => w.id === id);
  if (!target) return;
  wsCommitLayout();                     // bank the outgoing arrangement
  _wsSwitching = true;
  try {
    // closePanel rather than a bare remove(): it runs the panel's unmount(),
    // drops any in-flight drag/resize registry entry, and keeps the dock
    // honest. Its saveLayout() writes are harmless while _wsSwitching.
    Array.from(mounted).forEach(pid => { try { closePanel(pid); } catch(e){} });
    Object.keys(layout).forEach(k => { delete layout[k]; });
    Object.assign(layout, _wsClone(target.panels));
    _wsState.active = id;
  } finally {
    _wsSwitching = false;
  }
  saveLayout();                          // also commits into the NEW active ws
  Object.keys(layout).forEach(pid => {
    if (layout[pid] && layout[pid].open && panelDefs[pid]) ensurePanel(pid);
  });
  wsClampAll();
  if (typeof updateDock === 'function') updateDock();
  wsRenderSwitcher();
}

function wsAdd(name, panels){
  if (!_wsState || _wsState.list.length >= WS_MAX) return null;
  // An empty panels map is not the same as "nothing open": switching to it
  // would leave `layout` with no entry for any panel, so reopening one from
  // the dock would land on the hardcoded 40,40/320x400 fallback instead of
  // where that panel normally lives. Default to every panel closed but
  // positioned.
  if (!panels || !Object.keys(panels).length){
    panels = {};
    Object.keys(layout).forEach(pid => { panels[pid] = { ...layout[pid], open: false }; });
  }
  // No default icon: the dock label falls back to the workspace's POSITION, so
  // it always matches the 1–9 shortcut even after a delete renumbers things.
  const ws = { id: _wsId(), name: String(name || 'Workspace').slice(0, 24), panels };
  _wsState.list.push(ws);
  wsSave();
  return ws;
}

function wsDelete(id){
  if (!_wsState || _wsState.list.length <= 1) return false;
  const i = _wsState.list.findIndex(w => w.id === id);
  if (i < 0) return false;
  const wasActive = _wsState.active === id;
  _wsState.list.splice(i, 1);
  wsSave();
  // Switching AFTER the splice, so the outgoing commit can't resurrect it.
  if (wasActive){
    _wsState.active = null;
    wsSwitch(_wsState.list[Math.max(0, i - 1)].id);
  } else {
    wsRenderSwitcher();
  }
  return true;
}

// ─── Switcher UI (top of the icon dock) ──────────────────────────────────────
function wsRenderSwitcher(){
  const host = document.getElementById('ws-switch');
  if (!host || !_wsState) return;
  const active = _wsState.active;
  host.innerHTML = _wsState.list.map((w, i) => {
    const num = i + 1;
    const key = num <= 9 ? ` (press ${num})` : '';
    return `<button class="dock-btn ws-btn${w.id === active ? ' on' : ''}" data-ws="${esc(w.id)}"
      title="${esc(w.name)}${key} — click to switch, right-click to rename or delete"
      >${esc(w.icon || String(num))}</button>`;
  }).join('')
  + (_wsState.list.length < WS_MAX
      ? `<button class="dock-btn ws-add" id="ws-add-btn" title="New workspace">+</button>` : '');
}

async function _wsPromptAdd(){
  const r = await showModal('New workspace', [
    { id:'name', label:'Name', value:'Workspace ' + ((_wsState?.list.length || 0) + 1) },
    { id:'copy', label:'Start from', type:'select', value:'empty',
      options:[{value:'empty', label:'No panels open'}, {value:'current', label:'Copy the current layout'}] },
  ], 'Create');
  if (!r) return;
  // An empty workspace still needs every panel's geometry, or reopening one
  // would fall back to the 40,40/320x400 default instead of where it lives.
  const panels = {};
  Object.keys(layout).forEach(pid => { panels[pid] = { ...layout[pid], open: r.copy === 'current' ? !!layout[pid].open : false }; });
  const ws = wsAdd(r.name, panels);
  if (ws) wsSwitch(ws.id);
}

async function _wsPromptEdit(id){
  const w = _wsState?.list.find(x => x.id === id);
  if (!w) return;
  const canDelete = _wsState.list.length > 1;
  const r = await showModal('Workspace: ' + w.name, [
    { id:'name', label:'Name', value:w.name },
    { id:'icon', label:'Dock label (1–2 characters, blank = its number)', value:w.icon || '' },
    ...(canDelete ? [{ id:'del', label:'Delete this workspace', type:'select', value:'no',
                       options:[{value:'no',label:'No'},{value:'yes',label:'Yes, delete it'}] }] : []),
  ], 'Save');
  if (!r) return;
  if (canDelete && r.del === 'yes'){ wsDelete(id); return; }
  w.name = String(r.name || w.name).slice(0, 24);
  // Blank clears back to the position number rather than defaulting to the
  // first letter — the number is what the keyboard shortcut uses.
  const ic = String(r.icon || '').trim().slice(0, 2);
  if (ic) w.icon = ic; else delete w.icon;
  wsSave();
  wsRenderSwitcher();
}

function initWorkspaces(){
  // Players get one fullscreen panel at a time and no dock — nothing here
  // applies, and sizing the canvas would fight the mobile CSS.
  if (document.body.classList.contains('player-mode')) return;
  _wsState = _wsLoad() || _wsMigrate();
  // Repair a dangling or missing active id HERE, which is the only place that
  // should — wsActive() is deliberately strict so a mid-delete commit can't
  // land in the wrong workspace.
  if (!_wsState.list.some(w => w.id === _wsState.active)) _wsState.active = _wsState.list[0].id;
  // The live layout (skt-layout-v1) is what the user last had on screen and
  // wins over the stored copy, which can lag if the tab was closed abruptly.
  const a = wsActive();
  if (a) a.panels = _wsClone(layout);
  wsSave();
  wsRenderSwitcher();

  const host = document.getElementById('ws-switch');
  if (host){
    host.addEventListener('click', e => {
      const add = e.target.closest('#ws-add-btn');
      if (add){ _wsPromptAdd(); return; }
      const btn = e.target.closest('[data-ws]');
      if (!btn) return;
      // Clicking the one you're already on opens its settings — otherwise
      // rename would be right-click only, which is undiscoverable on a laptop.
      if (btn.dataset.ws === _wsState.active) _wsPromptEdit(btn.dataset.ws);
      else wsSwitch(btn.dataset.ws);
    });
    host.addEventListener('contextmenu', e => {
      const btn = e.target.closest('[data-ws]');
      if (!btn) return;
      e.preventDefault();
      _wsPromptEdit(btn.dataset.ws);
    });
  }

  // 1–9 jump straight to a workspace. Bare digits were entirely unbound —
  // Ctrl+0 (zoom reset) is the only digit shortcut in the app, and it carries
  // a modifier, so there is no conflict.
  //
  // The number is the workspace's POSITION in the dock, not a stored id, so it
  // always matches what you can see. Deleting one renumbers the rest, which is
  // the behaviour that matches a visible strip.
  document.addEventListener('keydown', e => {
    if (!_wsState) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key < '1' || e.key > '9') return;
    // Never steal a digit from a field. contentEditable covers the notes
    // panel, whose editor is a div — a bare keydown listener that ignored it
    // would eat every number the DM typed into their session notes.
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    // A modal is a focus trap; switching underneath one would leave it
    // floating over a workspace it was never opened from.
    if (document.querySelector('.modal-backdrop')) return;
    const target = _wsState.list[+e.key - 1];
    if (!target || target.id === _wsState.active) return;
    e.preventDefault();
    wsSwitch(target.id);
  });

  wsSizeCanvas();
  wsClampAll();
  let _wsResizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(_wsResizeTimer);
    _wsResizeTimer = setTimeout(() => { wsClampAll(); }, 120);
  });
}
