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

function registerPanel(id,def){panelDefs[id]=def;}

function openPanel(id){
  layout[id]={...layout[id],open:true,minimized:false,z:_nextZ()};
  saveLayout();ensurePanel(id);updateDock();
}
function closePanel(id){
  layout[id]={...layout[id],open:false};
  saveLayout();
  const el=document.querySelector(`.window[data-panel="${id}"]`);
  if(el){if(panelDefs[id]?.unmount)panelDefs[id].unmount();el.remove();mounted.delete(id);}
  updateDock();
  _updateToolbarOcclusion();
}
function togglePanel(id){
  if(layout[id]?.open&&!layout[id]?.minimized)closePanel(id);else openPanel(id);
}
function focusPanel(id){
  layout[id]={...layout[id],z:_nextZ()};saveLayout();
  document.querySelectorAll('.window').forEach(w=>w.classList.remove('focused'));
  const el=document.querySelector(`.window[data-panel="${id}"]`);
  if(el){el.classList.add('focused');el.style.zIndex=layout[id].z;}
  _updateToolbarOcclusion();
}

// Toolbar-occlusion helper: when any open window's title bar overlaps the
// floating top-right toolbar, fade the toolbar via a body class so the
// window's ⋯ _ ✕ controls are usable. CSS handles the actual opacity +
// hover-restore. This function is cheap (a few rect reads) so we call it on
// every event that could move a title bar (drag, resize, open/close/focus,
// scroll, zoom).
function _updateToolbarOcclusion(){
  const tb = document.getElementById('float-toolbar');
  if (!tb) return;
  const r = tb.getBoundingClientRect();
  if (r.width === 0 || r.height === 0){
    document.body.classList.remove('toolbar-occluded');
    return;
  }
  let occluded = false;
  document.querySelectorAll('.window:not(.minimized)').forEach(w => {
    if (occluded) return;
    const head = w.querySelector('.window-head');
    if (!head) return;
    const h = head.getBoundingClientRect();
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
  el.innerHTML=`<div class="window-head"><div class="window-title"><span class="window-title-icon">${def.icon||'◇'}</span><span>${def.title}</span></div><div class="window-actions"><button class="btn icon-btn" data-wact="menu" title="Window options">⋯</button><button class="btn" data-wact="min">_</button><button class="btn" data-wact="close">✕</button></div></div><div class="window-body" id="panel-body-${id}"></div>
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

function wireWindow(el,id){
  el.addEventListener('mousedown',()=>focusPanel(id));
  const head=el.querySelector('.window-head');
  let drag=null,rs=null;
  head.addEventListener('mousedown',e=>{
    if(e.target.closest('button')) return;
    if(layout[id]?.locked) return;       // locked → no drag
    if(document.body.classList.contains('player-mode')) return; // player view → no drag
    const l=layout[id];
    drag={sx:e.clientX,sy:e.clientY,ox:l.x,oy:l.y};
    e.preventDefault();
  });
  document.addEventListener('mousemove',e=>{
    const z = (typeof getZoom==='function') ? getZoom() : 1;
    if(drag){
      let nx=Math.max(0,drag.ox+(e.clientX-drag.sx)/z);
      let ny=Math.max(0,drag.oy+(e.clientY-drag.sy)/z);
      const snapped = _snapMove(id, nx, ny, layout[id].w, layout[id].h);
      nx = snapped.x; ny = snapped.y;
      el.style.left=nx+'px'; el.style.top=ny+'px';
      // Edge-snap detection: if cursor is at a viewport edge / corner, queue
      // a snap-zone for mouseup and show a preview overlay.
      drag.pending = _detectEdgeSnap(e.clientX, e.clientY);
      if (drag.pending) _showSnapPreview(drag.pending.zone);
      else _hideSnapPreview();
      _updateToolbarOcclusion();
    }
    if(rs){
      const dx=(e.clientX-rs.sx)/z, dy=(e.clientY-rs.sy)/z;
      let x=rs.ox, y=rs.oy, w=rs.ow, h=rs.oh;
      if(rs.dir.includes('e')) w = Math.max(240, rs.ow + dx);
      if(rs.dir.includes('s')) h = Math.max(120, rs.oh + dy);
      if(rs.dir.includes('w')) {
        const nw = Math.max(240, rs.ow - dx);
        x = rs.ox + (rs.ow - nw);
        w = nw;
      }
      if(rs.dir.includes('n')) {
        const nh = Math.max(120, rs.oh - dy);
        y = rs.oy + (rs.oh - nh);
        h = nh;
      }
      const snapped = _snapResize(id, x, y, w, h, rs.dir);
      el.style.left=snapped.x+'px'; el.style.top=snapped.y+'px';
      el.style.width=snapped.w+'px'; el.style.height=snapped.h+'px';
      _updateToolbarOcclusion();
    }
  });
  document.addEventListener('mouseup',()=>{
    if(drag){
      if (drag.pending){
        // Cursor was at an edge/corner on release — apply that snap zone
        // instead of the dragged position.
        snapWindowToZone(id, drag.pending.zone);
      } else {
        layout[id]={...layout[id],x:parseInt(el.style.left),y:parseInt(el.style.top)};
        saveLayout();
      }
      _hideSnapPreview();
      drag=null;
      _updateToolbarOcclusion();
    }
    if(rs){
      layout[id]={...layout[id],x:parseInt(el.style.left),y:parseInt(el.style.top),w:parseInt(el.style.width),h:parseInt(el.style.height)};
      saveLayout();
      rs=null;
      _updateToolbarOcclusion();
    }
  });
  el.querySelectorAll('.rh').forEach(handle => {
    handle.addEventListener('mousedown', e => {
      e.stopPropagation();
      if(layout[id]?.locked) return;     // locked → no resize
      const l=layout[id];
      rs={sx:e.clientX,sy:e.clientY,ox:l.x,oy:l.y,ow:l.w,oh:l.h,dir:handle.dataset.rh};
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
function syncPartyToCombat(partyIdx){
  // When party HP/AC changes, mirror to their combat slot if in combat
  const p=state.party[partyIdx];
  const ci=state.combatants.findIndex(c=>c.isPC&&c.id===p.id);
  if(ci>=0){
    state.combatants[ci]={...state.combatants[ci],hp:p.hp,hpMax:p.hpMax,ac:p.ac};
    panelDefs.combat?._render?.();
  }
}

function syncCombatToParty(combatantId){
  // When combat HP/AC changes, mirror to party card
  const c=state.combatants.find(x=>x.id===combatantId);
  if(!c||!c.isPC)return;
  const pi=state.party.findIndex(p=>p.id===c.id);
  if(pi>=0){
    state.party[pi]={...state.party[pi],hp:c.hp,hpMax:c.hpMax,ac:c.ac};
    panelDefs.party?._render?.();
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

  // Build menu items. Share + Lock are DM-only (player tab can still snap).
  const items = [];
  if (!isPlayer){
    items.push({ act:'share', label: (isShared?'👁':'◌')+' '+(isShared?'Shared with players (click to unshare)':'Share with player view') });
    items.push({ act:'lock',  label: (isLocked?'🔒':'🔓')+' '+(isLocked?'Locked (click to unlock)':'Lock window') });
  }
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
