// ============================================================
// WINDOW MANAGER
// ============================================================
const panelDefs={};
const mounted=new Set();
let zCounter=10;

// Returns the next z-index to use, guaranteed to be greater than every
// currently-mounted window AND any saved panel z. This avoids a class of bugs
// where, on page load, zCounter resets to 10 while saved panels carry higher
// z values from a previous session — making freshly-focused windows sink
// behind them.
function _nextZ(){
  let max = zCounter;
  document.querySelectorAll('.window').forEach(el => {
    const z = parseInt(el.style.zIndex);
    if (!isNaN(z) && z > max) max = z;
  });
  Object.values(layout).forEach(l => {
    if (l && typeof l.z === 'number' && l.z > max) max = l.z;
  });
  zCounter = max + 1;
  return zCounter;
}

// Panel id → sprite symbol. Single source of truth for a panel's icon, used by
// the window title bar and the player view's tab bar. The dock buttons in
// skt-workspace.html carry the same ids in static markup; _checkPanelIcons()
// below asserts the two agree, because a silent mismatch would show one icon
// in the dock and a different one on the same panel's title bar.
//
// Panels still declare an emoji `icon:` and it is kept as the fallback — an
// entry with no sprite (or a floating window created ad hoc) renders that
// instead of a blank.
const PANEL_ICON = {
  combat:'i-combat', attacks:'i-target', party:'i-heart', shop:'i-coins',
  notes:'i-note', battlemap:'i-map', npclib:'i-user', bestiary:'i-paw',
  adventures:'i-book-open', books:'i-books', npcgen:'i-dice', loot:'i-chest',
  encounter:'i-bolt', soundboard:'i-speaker', weather:'i-cloud', time:'i-clock',
};
// Icon markup for a panel: sprite when we have one, the panel's own emoji when
// we don't. Both callers go through here so they can't drift apart.
function panelIconHtml(id, def){
  const sym = PANEL_ICON[id];
  if (sym && typeof ICO === 'function') return ICO(sym);
  return (def && def.icon) || '◇';
}
// Dev check: every dock button's sprite must match PANEL_ICON. Returns the
// mismatches rather than throwing — a wrong icon is cosmetic and must never
// stop the app booting.
function _checkPanelIcons(){
  const out = [];
  document.querySelectorAll('.dock-btn[data-panel]').forEach(b => {
    const id = b.dataset.panel;
    const used = b.querySelector('use')?.getAttribute('href')?.replace('#','') || null;
    if (PANEL_ICON[id] !== used) out.push({ panel:id, dock:used, map:PANEL_ICON[id] || null });
  });
  return out;
}

function registerPanel(id,def){panelDefs[id]=def;}

// ── Window placement ───────────────────────────────────────────────────────
// DEFAULT_LAYOUT gives every panel a fixed x/y, and they were chosen panel by
// panel rather than as a set: opening the eight main panels put 24 of the 28
// possible pairs on top of each other. Weather landed on Combat, Bestiary and
// Shop both landed on Party.
//
// So a window that is still sitting at its DEFAULT position gets placed at open
// time instead. Keying on "still at the default" is deliberate — it means this
// can never fight a position the user chose. Move a window once and it reopens
// exactly where you left it, forever.
function _wmIsAtDefaultPos(id){
  const d = (typeof DEFAULT_LAYOUT !== 'undefined') && DEFAULT_LAYOUT[id];
  const l = layout[id];
  if (!d || !l) return false;
  return l.x === d.x && l.y === d.y;
}

// Cascade until the rect clears every open window, then clamp into view.
// Cascade rather than a tiling/first-fit search: with panels this varied in
// size, tiling leaves odd gaps, while a stagger keeps every title bar visible
// and reads as a deliberate stack.
function _wmPlaceWindow(id){
  if (_isMobileLayout()) return;              // fullscreen there; nothing to place
  if (!_wmIsAtDefaultPos(id)) return;         // user has moved it — leave alone
  const l = layout[id];
  if (!l) return;

  const ws = document.getElementById('workspace');
  const zoom = (typeof getZoom === 'function' ? getZoom() : 1) || 1;
  const maxW = ws ? ws.clientWidth  / zoom : 1440;
  const maxH = ws ? ws.clientHeight / zoom : 900;

  const others = [];
  Object.keys(layout).forEach(k => {
    if (k === id) return;
    const o = layout[k];
    if (o && o.open && !o.minimized) others.push(o);
  });
  if (!others.length) return;

  // Total area this rect would cover of other windows. A window peeking out
  // from behind another is fine and normal; what isn't is one landing almost
  // exactly on top of another, so we score by area rather than yes/no.
  const cost = (x, y) => others.reduce((sum, o) => {
    const ox = Math.max(x, o.x), oy = Math.max(y, o.y);
    const ex = Math.min(x + l.w, o.x + o.w), ey = Math.min(y + l.h, o.y + o.h);
    return sum + Math.max(0, ex - ox) * Math.max(0, ey - oy);
  }, 0);
  // "Clear enough to stop looking". Deliberately strict: at 45% the search
  // settled for the first merely-tolerable spot and left the battle map
  // covering 40% of the party panel. 12% means it keeps hunting for a genuinely
  // free slot and only falls back to the best-scoring one when the workspace
  // really is full — which it legitimately is once you open eight panels, whose
  // combined area is 1.9x the screen.
  const FREE = 0.12 * l.w * l.h;

  // Candidates: the panel's own default first (so a tidy layout stays put),
  // then a cascade, then a coarse grid sweep. The first attempt at this just
  // cascaded and reset to a handful of fallback spots when it ran out of room
  // — and three panels promptly landed on the same fallback. Scoring every
  // candidate and keeping the best is what stops that.
  const STEP = 30;
  const cands = [[l.x, l.y]];
  for (let i = 1; i <= 8; i++) cands.push([l.x + i * STEP, l.y + i * STEP]);
  for (let gy = 16; gy + l.h <= maxH; gy += 90)
    for (let gx = 16; gx + l.w <= maxW; gx += 120) cands.push([gx, gy]);

  let best = [l.x, l.y], bestCost = Infinity;
  for (const [cx, cy] of cands){
    if (cx < 0 || cy < 0 || cx + l.w > maxW || cy + l.h > maxH) continue;
    const c = cost(cx, cy);
    if (c < bestCost){ best = [cx, cy]; bestCost = c; }
    if (c < FREE) break;           // good enough — take the earliest such spot
  }
  l.x = Math.max(0, Math.min(best[0], Math.max(0, maxW - l.w)));
  l.y = Math.max(0, Math.min(best[1], Math.max(0, maxH - l.h)));
}

function openPanel(id){
  const wasOpen = layout[id] && layout[id].open;
  layout[id]={...layout[id],open:true,minimized:false,z:_nextZ()};
  // Only on an actual open — re-focusing an already-open panel must not move it.
  if (!wasOpen) _wmPlaceWindow(id);
  saveLayout();ensurePanel(id);updateDock();
}
function closePanel(id){
  layout[id]={...layout[id],open:false};
  saveLayout();
  // Drop any in-progress drag/resize for this window so a mid-drag close
  // doesn't leave orphaned state in the global mousemove handler.
  if (typeof _wmDrag   !== 'undefined') _wmDrag.delete(id);
  if (typeof _wmResize !== 'undefined') _wmResize.delete(id);
  const el=document.querySelector(`.window[data-panel="${id}"]`);
  if(el){if(panelDefs[id]?.unmount)panelDefs[id].unmount();el.remove();mounted.delete(id);}
  updateDock();
  _updateToolbarOcclusion();
}
// True when the phone layout is active: every panel is fullscreen and stacked,
// and the dock is a bottom tab bar. Matches the CSS breakpoint exactly — if one
// moves, the other has to.
function _isMobileLayout(){
  try { return window.matchMedia('(max-width: 768px) and (pointer: coarse)').matches; }
  catch(e){ return false; }
}
function togglePanel(id){
  // On the mobile layout the dock is a SWITCHER, not a toggle. Panels are
  // fullscreen and stacked, so tapping one that's already open — but behind
  // another — has to bring it forward; closing it instead would look like the
  // tap did nothing except lose your place. Closing is the title bar's ✕.
  if (_isMobileLayout()){
    if (layout[id]?.open && !layout[id]?.minimized) focusPanel(id);
    else openPanel(id);
    return;
  }
  if(layout[id]?.open&&!layout[id]?.minimized)closePanel(id);else openPanel(id);
}
function focusPanel(id){
  layout[id]={...layout[id],z:_nextZ()};saveLayout();
  document.querySelectorAll('.window').forEach(w=>w.classList.remove('focused'));
  const el=document.querySelector(`.window[data-panel="${id}"]`);
  if(el){el.classList.add('focused');el.style.zIndex=layout[id].z;}
  _updateToolbarOcclusion();
}

// Toolbar-occlusion helper: when an open window's ⋯ _ ✕ controls slide under
// the floating top-right toolbar, fade the toolbar via a body class so those
// controls stay usable. CSS handles the actual opacity + hover-restore. This
// function is cheap (a few rect reads) so we call it on every event that could
// move a title bar (drag, resize, open/close/focus, scroll, zoom).
//
// It tests `.window-actions`, not the whole `.window-head`. The head spans the
// full window width, so on the phone layout — where every window is fullscreen
// at top 0 — it ALWAYS intersected the toolbar and the fade was permanently
// on, leaving the toolbar ghosted at 20% forever. Only the buttons need
// protecting; the title text underneath is not interactive.
function _updateToolbarOcclusion(){
  const tb = document.getElementById('float-toolbar');
  if (!tb) return;
  const r = tb.getBoundingClientRect();
  if (r.width === 0 || r.height === 0){
    document.body.classList.remove('toolbar-occluded');
    return;
  }
  // Publish the measured width so the phone layout can reserve room for the
  // toolbar in the title bar. Measured rather than hard-coded because the
  // toolbar grows and shrinks with the sync indicator's label.
  document.documentElement.style.setProperty('--toolbar-w', Math.ceil(r.width) + 'px');
  document.documentElement.style.setProperty('--toolbar-h', Math.ceil(r.height) + 'px');
  let occluded = false;
  document.querySelectorAll('.window:not(.minimized)').forEach(w => {
    if (occluded) return;
    const acts = w.querySelector('.window-actions');
    if (!acts) return;
    const h = acts.getBoundingClientRect();
    if (h.right > r.left && h.left < r.right && h.bottom > r.top && h.top < r.bottom){
      occluded = true;
    }
  });
  document.body.classList.toggle('toolbar-occluded', occluded);
}
window._updateToolbarOcclusion = _updateToolbarOcclusion;

function ensurePanel(id){
  if(mounted.has(id)){
    const el=document.querySelector(`.window[data-panel="${id}"]`);
    if(el){const l=layout[id];el.style.left=l.x+'px';el.style.top=l.y+'px';el.style.width=l.w+'px';el.style.height=l.h+'px';el.style.zIndex=l.z;el.classList.toggle('minimized',!!l.minimized);}
    return;
  }
  const def=panelDefs[id];if(!def)return;
  const l=layout[id]||{x:40,y:40,w:320,h:400,z:_nextZ(),minimized:false,locked:false};
  const canvas=document.getElementById('workspace-canvas')||document.getElementById('workspace');
  const el=document.createElement('div');
  el.className='window'+(l.minimized?' minimized':'')+(l.locked?' locked':'');
  el.dataset.panel=id;
  Object.assign(el.style,{left:l.x+'px',top:l.y+'px',width:l.w+'px',height:l.h+'px',zIndex:l.z});
  // Share / lock / snap collapse into a single ⋯ overflow menu so the title
  // bar stays uncluttered; only minimize and close are always-visible. The
  // current share/lock states are surfaced inside the menu items themselves.
  el.innerHTML=`<div class="window-head"><div class="window-title"><span class="window-title-icon">${panelIconHtml(id, def)}</span><span>${def.title}</span></div><div class="window-actions"><button class="btn icon-btn" data-wact="menu" title="Window options"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-dots"/></svg></button><button class="btn icon-btn" data-wact="min" title="Minimize"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-minus"/></svg></button><button class="btn icon-btn" data-wact="close" title="Close"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-close"/></svg></button></div></div><div class="window-body" id="panel-body-${id}"></div>
    <div class="rh rh-n"  data-rh="n"></div>
    <div class="rh rh-s"  data-rh="s"></div>
    <div class="rh rh-e"  data-rh="e"></div>
    <div class="rh rh-w"  data-rh="w"></div>
    <div class="rh rh-ne" data-rh="ne"></div>
    <div class="rh rh-nw" data-rh="nw"></div>
    <div class="rh rh-se" data-rh="se"></div>
    <div class="rh rh-sw" data-rh="sw"></div>`;
  canvas.appendChild(el);
  def.mount(el.querySelector('.window-body'));
  mounted.add(id);
  wireWindow(el,id);
  // A panel whose stored geometry predates a smaller window — or a default
  // authored for the old 5000px canvas — would otherwise open off-screen with
  // nowhere to scroll to. Clamp on the way in; the canvas then grows if it has
  // to (zoomed in), so nothing is ever stranded.
  if (typeof wsClampAll === 'function') wsClampAll();
  _updateToolbarOcclusion();
}

// Snap a moving rect to nearby static rects + the workspace top/left edge.
// Returns adjusted {x,y}. Threshold scales with zoom so the visual snap
// distance feels the same regardless of zoom level.
const _SNAP_PX = 8;
function _snapMove(id, x, y, w, h) {
  if (!state.settings?.snapWindows) return {x, y};
  const z = (typeof getZoom==='function') ? getZoom() : 1;
  const T = _SNAP_PX / z;
  let bestDx = T, bestDy = T, sx = x, sy = y;
  // Workspace top-left corner
  if (Math.abs(x) < bestDx)     { bestDx = Math.abs(x);     sx = 0; }
  if (Math.abs(y) < bestDy)     { bestDy = Math.abs(y);     sy = 0; }
  Object.entries(layout).forEach(([oid, l]) => {
    if (oid === id || !l || !l.open) return;
    const l2={x:l.x, y:l.y, w:l.w, h:l.h};
    const r = x + w, b = y + h;
    const ol = l2.x, or = l2.x + l2.w, ot = l2.y, ob = l2.y + l2.h;
    // Vertically overlapping → can snap left/right
    if (y < ob && b > ot) {
      [[r, ol, ol - w], [x, or, or], [r, or, or - w], [x, ol, ol]].forEach(([from, to, snapX]) => {
        const d = Math.abs(from - to);
        if (d < bestDx) { bestDx = d; sx = snapX; }
      });
      // Top/bottom edge alignment with vertically overlapping window
      [[y, ot, ot], [b, ob, ob - h], [y, ob, ob], [b, ot, ot - h]].forEach(([from, to, snapY]) => {
        const d = Math.abs(from - to);
        if (d < bestDy) { bestDy = d; sy = snapY; }
      });
    }
    // Horizontally overlapping → can snap top/bottom
    if (x < or && r > ol) {
      [[b, ot, ot - h], [y, ob, ob], [b, ob, ob - h], [y, ot, ot]].forEach(([from, to, snapY]) => {
        const d = Math.abs(from - to);
        if (d < bestDy) { bestDy = d; sy = snapY; }
      });
      [[x, ol, ol], [r, or, or - w], [x, or, or], [r, ol, ol - w]].forEach(([from, to, snapX]) => {
        const d = Math.abs(from - to);
        if (d < bestDx) { bestDx = d; sx = snapX; }
      });
    }
  });
  return {x: sx, y: sy};
}

// Snap a resize edge: only the moving edge(s) get snapped.
function _snapResize(id, x, y, w, h, dir) {
  if (!state.settings?.snapWindows) return {x, y, w, h};
  const z = (typeof getZoom==='function') ? getZoom() : 1;
  const T = _SNAP_PX / z;
  const r = x + w, b = y + h;
  let bestDx = T, bestDy = T, snapR = r, snapB = b, snapL = x, snapT = y;
  Object.entries(layout).forEach(([oid, l]) => {
    if (oid === id || !l || !l.open) return;
    const ol = l.x, or = l.x + l.w, ot = l.y, ob = l.y + l.h;
    if (y < ob && b > ot) {
      if (dir.includes('e')) {
        [or, ol].forEach(t => { const d = Math.abs(r - t); if (d < bestDx) { bestDx = d; snapR = t; } });
      }
      if (dir.includes('w')) {
        [ol, or].forEach(t => { const d = Math.abs(x - t); if (d < bestDx) { bestDx = d; snapL = t; } });
      }
    }
    if (x < or && r > ol) {
      if (dir.includes('s')) {
        [ob, ot].forEach(t => { const d = Math.abs(b - t); if (d < bestDy) { bestDy = d; snapB = t; } });
      }
      if (dir.includes('n')) {
        [ot, ob].forEach(t => { const d = Math.abs(y - t); if (d < bestDy) { bestDy = d; snapT = t; } });
      }
    }
  });
  if (dir.includes('e')) w = Math.max(240, snapR - x);
  if (dir.includes('s')) h = Math.max(120, snapB - y);
  if (dir.includes('w')) { const nw = Math.max(240, r - snapL); x = r - nw; w = nw; }
  if (dir.includes('n')) { const nh = Math.max(120, b - snapT); y = b - nh; h = nh; }
  return {x, y, w, h};
}

// ─── Module-level drag/resize registries ──────────────────────────────────
// Previously every wireWindow() call attached its own anonymous mousemove +
// mouseup handlers to `document`, with the per-window drag/rs state captured
// in closures. Those listeners were never removed, so opening N windows over
// the page lifetime meant 2N global handlers all firing on every mouse event.
// Now we register one pair of handlers for the whole page and look up the
// affected window by id at dispatch time.
const _wmDrag   = new Map(); // id → { sx, sy, ox, oy, pending? }
const _wmResize = new Map(); // id → { sx, sy, ox, oy, ow, oh, dir }
let   _wmGlobalsWired = false;

function _wmOnMove(e){
  if (!_wmDrag.size && !_wmResize.size) return;
  const z = (typeof getZoom==='function') ? getZoom() : 1;
  _wmDrag.forEach((drag, id) => {
    const el = document.querySelector(`.window[data-panel="${id}"]`);
    if (!el || !layout[id]){ _wmDrag.delete(id); return; }
    let nx = Math.max(0, drag.ox + (e.clientX - drag.sx) / z);
    let ny = Math.max(0, drag.oy + (e.clientY - drag.sy) / z);
    const snapped = _snapMove(id, nx, ny, layout[id].w, layout[id].h);
    nx = snapped.x; ny = snapped.y;
    // Keep the window inside the workspace. The canvas is viewport-sized now,
    // so anything dragged past the edge would be unreachable rather than
    // merely off to one side. Applied AFTER snapping, so an edge snap can't
    // push it back out.
    if (typeof wsClampPos === 'function'){
      const c = wsClampPos(nx, ny, layout[id].w, layout[id].h);
      nx = c.x; ny = c.y;
    }
    el.style.left = nx + 'px'; el.style.top = ny + 'px';
    drag.pending = _detectEdgeSnap(e.clientX, e.clientY);
    if (drag.pending) _showSnapPreview(drag.pending.zone);
    else _hideSnapPreview();
    _updateToolbarOcclusion();
  });
  _wmResize.forEach((rs, id) => {
    const el = document.querySelector(`.window[data-panel="${id}"]`);
    if (!el || !layout[id]){ _wmResize.delete(id); return; }
    const dx = (e.clientX - rs.sx) / z, dy = (e.clientY - rs.sy) / z;
    let x = rs.ox, y = rs.oy, w = rs.ow, h = rs.oh;
    if (rs.dir.includes('e')) w = Math.max(240, rs.ow + dx);
    if (rs.dir.includes('s')) h = Math.max(120, rs.oh + dy);
    if (rs.dir.includes('w')){ const nw = Math.max(240, rs.ow - dx); x = rs.ox + (rs.ow - nw); w = nw; }
    if (rs.dir.includes('n')){ const nh = Math.max(120, rs.oh - dy); y = rs.oy + (rs.oh - nh); h = nh; }
    const snapped = _snapResize(id, x, y, w, h, rs.dir);
    // Cap the moving edge at the canvas rather than repositioning: a resize
    // must not teleport the opposite edge, so this trims the size instead of
    // shifting x/y the way the drag clamp does.
    if (typeof wsCanvasBox === 'function'){
      const box = wsCanvasBox();
      if (snapped.x + snapped.w > box.w) snapped.w = Math.max(240, box.w - snapped.x);
      if (snapped.y + snapped.h > box.h) snapped.h = Math.max(120, box.h - snapped.y);
    }
    el.style.left = snapped.x + 'px'; el.style.top = snapped.y + 'px';
    el.style.width = snapped.w + 'px'; el.style.height = snapped.h + 'px';
    _updateToolbarOcclusion();
  });
}

function _wmOnUp(){
  if (!_wmDrag.size && !_wmResize.size) return;
  _wmDrag.forEach((drag, id) => {
    const el = document.querySelector(`.window[data-panel="${id}"]`);
    if (!el || !layout[id]) return;
    if (drag.pending){
      snapWindowToZone(id, drag.pending.zone);
    } else {
      layout[id] = { ...layout[id], x:parseInt(el.style.left), y:parseInt(el.style.top) };
      saveLayout();
    }
    _hideSnapPreview();
  });
  _wmDrag.clear();
  _wmResize.forEach((rs, id) => {
    const el = document.querySelector(`.window[data-panel="${id}"]`);
    if (!el || !layout[id]) return;
    layout[id] = { ...layout[id],
      x: parseInt(el.style.left), y: parseInt(el.style.top),
      w: parseInt(el.style.width), h: parseInt(el.style.height) };
    saveLayout();
  });
  _wmResize.clear();
  _updateToolbarOcclusion();
}

// POINTER events, not mouse. The window manager was mouse-only — 13 mouse
// listeners, zero touch — so on any touch device a window could not be dragged,
// resized or snapped at all. Phones now get a fullscreen layout where that
// doesn't matter, but a tablet in landscape is over the mobile breakpoint and
// still uses real floating windows, so it very much does.
//
// Pointer events are one code path for mouse, touch and pen, which is why this
// is a migration rather than a second set of touch handlers bolted alongside —
// two paths would drift, and the snap/clamp logic is subtle enough already.
function _ensureWmGlobalHandlers(){
  if (_wmGlobalsWired) return;
  _wmGlobalsWired = true;
  document.addEventListener('pointermove', _wmOnMove);
  document.addEventListener('pointerup',   _wmOnUp);
  // A touch drag that leaves the screen, or is stolen by the browser, fires
  // pointercancel and NOT pointerup. Without this the window would stay stuck
  // to the finger and the next tap anywhere would teleport it.
  document.addEventListener('pointercancel', _wmOnUp);
}

function wireWindow(el,id){
  _ensureWmGlobalHandlers();
  el.addEventListener('pointerdown',()=>focusPanel(id));
  const head=el.querySelector('.window-head');
  head.addEventListener('pointerdown',e=>{
    if(e.target.closest('button')) return;
    if(layout[id]?.locked) return;       // locked → no drag
    // Primary contact only: a second finger landing mid-drag would otherwise
    // re-anchor the drag and make the window jump.
    if(e.isPrimary === false) return;
    const l=layout[id];
    _wmDrag.set(id, { sx:e.clientX, sy:e.clientY, ox:l.x, oy:l.y });
    e.preventDefault();
  });
  el.querySelectorAll('.rh').forEach(handle => {
    handle.addEventListener('pointerdown', e => {
      e.stopPropagation();
      if(layout[id]?.locked) return;     // locked → no resize
      if(e.isPrimary === false) return;
      const l=layout[id];
      _wmResize.set(id, { sx:e.clientX, sy:e.clientY, ox:l.x, oy:l.y, ow:l.w, oh:l.h, dir:handle.dataset.rh });
      e.preventDefault();
    });
  });
  el.querySelector('[data-wact="menu"]').addEventListener('click',e=>{
    e.stopPropagation();
    openWindowMenu(id, e.currentTarget);
  });
  el.querySelector('[data-wact="min"]').addEventListener('click',e=>{e.stopPropagation();const cur=layout[id]?.minimized;layout[id]={...layout[id],minimized:!cur};saveLayout();el.classList.toggle('minimized',!cur);});
  el.querySelector('[data-wact="close"]').addEventListener('click',e=>{e.stopPropagation();closePanel(id);});
}

function updateDock(){
  document.querySelectorAll('.dock-btn[data-panel]').forEach(btn=>{
    btn.classList.toggle('active',!!layout[btn.dataset.panel]?.open);
  });
}

// ============================================================
// PARTY <-> COMBAT SYNC HELPERS
// ============================================================
// Normalize a PC name so "Zoey(Rogue)", "Zoey (rogue)", and "Zoey " all
// match each other as the same character. Used by the party↔combat sync
// helpers as a fallback when ids don't match (e.g. the combatant was
// added by hand with a class-tagged name instead of dragged from party).
function _normalizePcName(s){
  return String(s || '').replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
}

// Find the combatant matching a party member. First tries id (the strong
// match when the combatant was dragged from party); falls back to
// normalized name match for manually-added "Zoey(Rogue)" style names.
function _findCombatantForPartyMember(p){
  if (!p) return -1;
  let ci = state.combatants.findIndex(c => c.isPC && c.id === p.id);
  if (ci >= 0) return ci;
  const want = _normalizePcName(p.name);
  if (!want) return -1;
  return state.combatants.findIndex(c => c.isPC && _normalizePcName(c.name) === want);
}

// Reverse — find a party member matching a combatant.
function _findPartyMemberForCombatant(c){
  if (!c) return -1;
  let pi = state.party.findIndex(p => p.id === c.id);
  if (pi >= 0) return pi;
  const want = _normalizePcName(c.name);
  if (!want) return -1;
  return state.party.findIndex(p => _normalizePcName(p.name) === want);
}

function syncPartyToCombat(partyIdx){
  // When party HP/AC changes, mirror to their combat slot if in combat
  const p=state.party[partyIdx];
  const ci=_findCombatantForPartyMember(p);
  if(ci>=0){
    // Mirror name too, not just stats — otherwise a party rename leaves the
    // combat card showing the old name (and, when matching falls back to
    // name, the two slowly drift apart).
    const prev = state.combatants[ci];
    const nameChanged = prev.name !== p.name;
    state.combatants[ci]={...prev,hp:p.hp,hpMax:p.hpMax,ac:p.ac,name:p.name};
    // Try a surgical repaint first. A full combat _render() re-serializes
    // every combatant card, and this fires on every HP tick — one click used
    // to rebuild BOTH panels end to end. A rename still needs the full path
    // (the name lives in an input rendered per card).
    if (nameChanged || !panelDefs.combat?._patchHp?.(ci)) panelDefs.combat?._render?.();
  }
}

function syncCombatToParty(combatantId){
  // When combat HP/AC changes, mirror to party card
  const c=state.combatants.find(x=>x.id===combatantId);
  if(!c||!c.isPC)return;
  const pi=_findPartyMemberForCombatant(c);
  if(pi>=0){
    state.party[pi]={...state.party[pi],hp:c.hp,hpMax:c.hpMax,ac:c.ac};
    // Surgical first — see the matching comment in syncPartyToCombat.
    if (!panelDefs.party?._patchHp?.(pi)) panelDefs.party?._render?.();
  }
}

// ─── Windows-11-style snap layouts ────────────────────────────────────────────
// A small popover triggered by the ▢ title-bar button. Shows the same six
// layout previews Windows 11 surfaces on hover-over-maximize, except they snap
// the panel into a zone of the WORKSPACE (not the OS screen).
//
// Each layout is a list of zones expressed as fractional bounds {x,y,w,h} of
// the workspace canvas (0–1). Click a zone to snap the active panel there;
// click any non-active zone in a layout that has more than one zone and you'll
// just see the preview — actual snap targets the zone that was clicked.
const SNAP_LAYOUTS = [
  // Side-by-side 50/50
  { id:'split2', zones:[
    {x:0,    y:0, w:1/2,  h:1},
    {x:1/2,  y:0, w:1/2,  h:1},
  ]},
  // 1/3 + 2/3
  { id:'third13', zones:[
    {x:0,    y:0, w:1/3,  h:1},
    {x:1/3,  y:0, w:2/3,  h:1},
  ]},
  // 2/3 + 1/3
  { id:'third23', zones:[
    {x:0,    y:0, w:2/3,  h:1},
    {x:2/3,  y:0, w:1/3,  h:1},
  ]},
  // 4 quadrants
  { id:'quad', zones:[
    {x:0,    y:0,    w:1/2, h:1/2},
    {x:1/2,  y:0,    w:1/2, h:1/2},
    {x:0,    y:1/2,  w:1/2, h:1/2},
    {x:1/2,  y:1/2,  w:1/2, h:1/2},
  ]},
  // 3 columns
  { id:'col3', zones:[
    {x:0,    y:0, w:1/3, h:1},
    {x:1/3,  y:0, w:1/3, h:1},
    {x:2/3,  y:0, w:1/3, h:1},
  ]},
  // 50% + 2 quarters (left half + top-right + bottom-right)
  { id:'mix', zones:[
    {x:0,    y:0,    w:1/2, h:1},
    {x:1/2,  y:0,    w:1/2, h:1/2},
    {x:1/2,  y:1/2,  w:1/2, h:1/2},
  ]},
];

// ─── Drag-to-edge snap detection (Windows-style) ─────────────────────────────
// While dragging a window, if the cursor is within `_EDGE_T` of a viewport
// edge we propose a snap zone (left half, right half, maximize, or one of the
// four corners). On mouseup the proposed zone — if any — is applied via
// snapWindowToZone(). A translucent preview rectangle floats over the target
// area while the cursor is in the snap region.
const _EDGE_T = 8;     // px from a viewport edge that triggers an edge snap
const _CORNER_SPAN = 80; // along the top/bottom edge, this many px from a side
                         // upgrades the edge snap to a corner (quarter) snap

function _detectEdgeSnap(clientX, clientY){
  const ws = document.getElementById('workspace');
  if (!ws) return null;
  const r = ws.getBoundingClientRect();
  // Cursor must be over the workspace area to trigger snap previews.
  if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
  const dl = clientX - r.left, dt = clientY - r.top;
  const dr = r.right - clientX, db = r.bottom - clientY;
  const atTop = dt < _EDGE_T, atBottom = db < _EDGE_T;
  const atLeft = dl < _EDGE_T, atRight = dr < _EDGE_T;
  // Corners are detected as edge-touch + within CORNER_SPAN of the side.
  if (atTop    && dl < _CORNER_SPAN) return { zone:{x:0,    y:0,    w:1/2, h:1/2}, kind:'tl' };
  if (atTop    && dr < _CORNER_SPAN) return { zone:{x:1/2,  y:0,    w:1/2, h:1/2}, kind:'tr' };
  if (atBottom && dl < _CORNER_SPAN) return { zone:{x:0,    y:1/2,  w:1/2, h:1/2}, kind:'bl' };
  if (atBottom && dr < _CORNER_SPAN) return { zone:{x:1/2,  y:1/2,  w:1/2, h:1/2}, kind:'br' };
  if (atTop)   return { zone:{x:0,   y:0, w:1,   h:1}, kind:'max'   };
  if (atLeft)  return { zone:{x:0,   y:0, w:1/2, h:1}, kind:'left'  };
  if (atRight) return { zone:{x:1/2, y:0, w:1/2, h:1}, kind:'right' };
  return null;
}

// Floating translucent rectangle that previews the snap target while dragging.
function _showSnapPreview(zone){
  const ws = document.getElementById('workspace'); if (!ws) return;
  const r = ws.getBoundingClientRect();
  let p = document.getElementById('drag-snap-preview');
  if (!p){
    p = document.createElement('div');
    p.id = 'drag-snap-preview';
    document.body.appendChild(p);
  }
  p.style.left   = (r.left + zone.x * r.width)  + 'px';
  p.style.top    = (r.top  + zone.y * r.height) + 'px';
  p.style.width  = (zone.w * r.width)  + 'px';
  p.style.height = (zone.h * r.height) + 'px';
  p.style.display = 'block';
}
function _hideSnapPreview(){
  const p = document.getElementById('drag-snap-preview');
  if (p) p.style.display = 'none';
}

// The CURRENTLY VISIBLE area of the workspace in canvas-space (un-zoomed,
// un-scrolled) coordinates — i.e. what the user can actually see right now.
// Snap layouts are computed inside this rect rather than the whole 5000-px
// canvas so "left half" means "left half of what's on screen", regardless of
// zoom or pan.
function _viewportRect(){
  const ws = document.getElementById('workspace');
  if (!ws) return { x:0, y:0, w: window.innerWidth, h: window.innerHeight };
  const z = (typeof getZoom === 'function') ? getZoom() : 1;
  return {
    x: ws.scrollLeft / z,
    y: ws.scrollTop  / z,
    w: ws.clientWidth  / z,
    h: ws.clientHeight / z,
  };
}

function snapWindowToZone(id, zone){
  const v = _viewportRect();
  const x = Math.round(v.x + zone.x * v.w);
  const y = Math.round(v.y + zone.y * v.h);
  const w = Math.round(zone.w * v.w);
  const h = Math.round(zone.h * v.h);
  // Bump z so the snapped window comes to the front of any overlapping ones.
  const z = _nextZ();
  layout[id] = { ...layout[id], x, y, w, h, z, minimized: false };
  saveLayout();
  // Apply to the live element if mounted.
  const el = document.querySelector(`.window[data-panel="${id}"]`);
  if (el){
    el.classList.remove('minimized');
    Object.assign(el.style, { left:x+'px', top:y+'px', width:w+'px', height:h+'px', zIndex:z });
  }
}

// Smart-arrange — auto-tile every open, non-minimized panel into a clean
// grid sized to the workspace. The grid shape adapts to panel count so 2
// panels split horizontally, 4 form a 2×2, 9 form a 3×3, etc. Order
// follows the z-stack (most recently focused goes to the top-left cell)
// so the user's "current" panel stays where their eyes are.
function smartArrange(){
  const open = Object.entries(layout)
    .filter(([id, l]) => l && l.open && !l.minimized)
    .sort(([, a], [, b]) => (b.z||0) - (a.z||0))   // highest z first → top-left
    .map(([id]) => id);
  if (!open.length){ if (typeof showToast === 'function') showToast('No windows to arrange'); return; }
  // Pick rows × cols just-big-enough for the count. Prefers more columns
  // than rows (wide aspect ratios are more common than tall).
  const n = open.length;
  let cols = Math.ceil(Math.sqrt(n));
  let rows = Math.ceil(n / cols);
  // Special-case small counts for a tighter look:
  if (n === 2){ cols = 2; rows = 1; }
  else if (n === 3){ cols = 3; rows = 1; }
  else if (n === 4){ cols = 2; rows = 2; }
  const cellW = 1 / cols, cellH = 1 / rows;
  open.forEach((id, i) => {
    const cx = i % cols;
    const cy = Math.floor(i / cols);
    snapWindowToZone(id, { x: cx*cellW, y: cy*cellH, w: cellW, h: cellH });
  });
  if (typeof showToast === 'function') showToast('Arranged ' + n + ' window' + (n===1?'':'s') + ' into ' + cols + '×' + rows);
}
// Expose globally so the context menu, keyboard handler, and console can hit it.
window.smartArrange = smartArrange;

let _snapPickerEl = null;
function _closeSnapPicker(){
  if (_snapPickerEl){ _snapPickerEl.remove(); _snapPickerEl = null; }
  document.removeEventListener('mousedown', _snapPickerOutside, true);
  document.removeEventListener('keydown', _snapPickerEsc, true);
}
function _snapPickerOutside(e){
  if (_snapPickerEl && !_snapPickerEl.contains(e.target)) _closeSnapPicker();
}
function _snapPickerEsc(e){ if (e.key === 'Escape') _closeSnapPicker(); }

function openSnapLayoutsPicker(id, anchorBtn){
  _closeSnapPicker();
  const pop = document.createElement('div');
  pop.className = 'snap-picker';
  pop.innerHTML = SNAP_LAYOUTS.map(L => `
    <div class="snap-layout" data-layout="${L.id}">
      ${L.zones.map((z, zi) => `
        <button class="snap-zone" data-li="${L.id}" data-zi="${zi}"
          style="left:${z.x*100}%;top:${z.y*100}%;width:${z.w*100}%;height:${z.h*100}%"
          title="Snap here"></button>
      `).join('')}
    </div>
  `).join('');
  document.body.appendChild(pop);
  _snapPickerEl = pop;

  // Position the popover under the anchor button.
  const r = anchorBtn.getBoundingClientRect();
  // Default below button; flip up if it would clip the viewport.
  const popH = pop.offsetHeight || 130;
  const popW = pop.offsetWidth  || 280;
  let top = r.bottom + 6;
  if (top + popH > window.innerHeight - 8) top = Math.max(8, r.top - popH - 6);
  let left = r.right - popW;
  left = Math.max(8, Math.min(window.innerWidth - popW - 8, left));
  pop.style.top  = top  + 'px';
  pop.style.left = left + 'px';

  // Wire zone clicks.
  pop.querySelectorAll('.snap-zone').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const layoutId = btn.dataset.li;
      const zi = +btn.dataset.zi;
      const L = SNAP_LAYOUTS.find(l => l.id === layoutId);
      if (L && L.zones[zi]){
        snapWindowToZone(id, L.zones[zi]);
      }
      _closeSnapPicker();
    });
  });

  // Outside-click + Esc dismisses. Capture phase + a tick of delay so the
  // click that opened the picker doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener('mousedown', _snapPickerOutside, true);
    document.addEventListener('keydown',   _snapPickerEsc,    true);
  }, 0);
}

// ─── Per-window overflow menu (⋯) ────────────────────────────────────────────
// Holds the secondary actions that used to be standalone buttons in the title
// bar (share / lock / snap) so the title bar stays clean. Two always-visible
// actions remain: minimize and close.
let _windowMenuEl = null;
function _closeWindowMenu(){
  if (_windowMenuEl){ _windowMenuEl.remove(); _windowMenuEl = null; }
  document.removeEventListener('mousedown', _windowMenuOutside, true);
  document.removeEventListener('keydown', _windowMenuEsc, true);
}
function _windowMenuOutside(e){
  if (_windowMenuEl && !_windowMenuEl.contains(e.target)) _closeWindowMenu();
}
function _windowMenuEsc(e){ if (e.key === 'Escape') _closeWindowMenu(); }

function openWindowMenu(id, anchorBtn){
  _closeWindowMenu();
  _closeSnapPicker();
  const l = layout[id] || {};
  const isPlayer = document.body.classList.contains('player-mode');
  const isShared = (state.sharedPanels || []).includes(id);
  const isLocked = !!l.locked;

  // Build menu items. Share is DM-only ("with players" makes no sense from
  // the player side); Lock + Snap are available to both since they only
  // affect this tab's layout.
  const items = [];
  if (!isPlayer){
    items.push({ act:'share', label: (isShared?'👁':'◌')+' '+(isShared?'Shared with players (click to unshare)':'Share with player view') });
  }
  items.push({ act:'lock',  label: (isLocked?'🔒':'🔓')+' '+(isLocked?'Locked (click to unlock)':'Lock window') });
  items.push({ act:'snap',  label:'▢ Snap to layout…' });

  // Panel-specific items, registered via panelDefs[id].menuItems (array or
  // function returning an array). Each item: { label, run() } — `act` is
  // synthesized as `panel:<n>` so the click handler can dispatch back.
  const def = panelDefs[id] || {};
  let panelItems = [];
  if (typeof def.menuItems === 'function')      panelItems = def.menuItems() || [];
  else if (Array.isArray(def.menuItems))        panelItems = def.menuItems;
  if (panelItems.length){
    items.push({ act:'__sep' });
    panelItems.forEach((it, idx) => {
      if (it && it.label && typeof it.run === 'function'){
        items.push({ act:'panel:'+idx, label: it.label, _run: it.run });
      }
    });
  }

  const menu = document.createElement('div');
  menu.className = 'window-menu';
  menu.innerHTML = items.map(it =>
    it.act === '__sep'
      ? '<div class="window-menu-sep"></div>'
      : `<button class="window-menu-item" data-act="${it.act}">${it.label}</button>`
  ).join('');
  document.body.appendChild(menu);
  _windowMenuEl = menu;

  // Position under the anchor button, right-aligned. Flip up if it would clip
  // the bottom of the viewport.
  const r = anchorBtn.getBoundingClientRect();
  const mw = menu.offsetWidth || 220;
  const mh = menu.offsetHeight || 100;
  let top = r.bottom + 4;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  let left = r.right - mw;
  left = Math.max(8, Math.min(window.innerWidth - mw - 8, left));
  menu.style.top  = top  + 'px';
  menu.style.left = left + 'px';

  menu.querySelectorAll('.window-menu-item').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'share'){
        togglePanelShare(id);
      } else if (act === 'lock'){
        const cur = !!layout[id]?.locked;
        layout[id] = { ...layout[id], locked: !cur };
        saveLayout();
        const winEl = document.querySelector(`.window[data-panel="${id}"]`);
        if (winEl) winEl.classList.toggle('locked', !cur);
      } else if (act === 'snap'){
        // Hand off to the layout picker, anchored at the same ⋯ button.
        _closeWindowMenu();
        openSnapLayoutsPicker(id, anchorBtn);
        return;
      } else if (act.startsWith('panel:')){
        const idx = parseInt(act.slice(6), 10);
        const item = items.find(i => i.act === 'panel:'+idx);
        if (item && typeof item._run === 'function'){
          try { item._run(); } catch(err){ console.error(err); }
        }
      }
      _closeWindowMenu();
    });
  });

  setTimeout(() => {
    document.addEventListener('mousedown', _windowMenuOutside, true);
    document.addEventListener('keydown',   _windowMenuEsc,    true);
  }, 0);
}
