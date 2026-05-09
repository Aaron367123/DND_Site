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
}
function togglePanel(id){
  if(layout[id]?.open&&!layout[id]?.minimized)closePanel(id);else openPanel(id);
}
function focusPanel(id){
  layout[id]={...layout[id],z:_nextZ()};saveLayout();
  document.querySelectorAll('.window').forEach(w=>w.classList.remove('focused'));
  const el=document.querySelector(`.window[data-panel="${id}"]`);
  if(el){el.classList.add('focused');el.style.zIndex=layout[id].z;}
}

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
  const lockIcon = l.locked ? '🔒' : '🔓';
  const shared = (state.sharedPanels||[]).includes(id);
  // Share button is a DM-only toggle that adds/removes this panel from the
  // player view. Hidden in player mode via CSS (`body.player-mode .window-actions`).
  const shareBtn = `<button class="btn icon-btn" data-wact="share" title="Share with player view">${shared?'👁':'◌'}</button>`;
  el.innerHTML=`<div class="window-head"><div class="window-title"><span class="window-title-icon">${def.icon||'◇'}</span><span>${def.title}</span></div><div class="window-actions">${shareBtn}<button class="btn icon-btn" data-wact="lock" title="Lock window">${lockIcon}</button><button class="btn icon-btn" data-wact="snap" title="Snap to layout">▢</button><button class="btn" data-wact="min">_</button><button class="btn" data-wact="close">✕</button></div></div><div class="window-body" id="panel-body-${id}"></div>
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
    }
  });
  document.addEventListener('mouseup',()=>{
    if(drag){layout[id]={...layout[id],x:parseInt(el.style.left),y:parseInt(el.style.top)};saveLayout();drag=null;}
    if(rs){layout[id]={...layout[id],x:parseInt(el.style.left),y:parseInt(el.style.top),w:parseInt(el.style.width),h:parseInt(el.style.height)};saveLayout();rs=null;}
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
  el.querySelector('[data-wact="share"]')?.addEventListener('click',e=>{
    e.stopPropagation();
    togglePanelShare(id);
    const shared = (state.sharedPanels||[]).includes(id);
    e.currentTarget.textContent = shared ? '👁' : '◌';
  });
  el.querySelector('[data-wact="lock"]').addEventListener('click',e=>{
    e.stopPropagation();
    const cur = !!layout[id]?.locked;
    layout[id] = {...layout[id], locked: !cur};
    saveLayout();
    el.classList.toggle('locked', !cur);
    e.currentTarget.textContent = !cur ? '🔒' : '🔓';
    e.currentTarget.title = !cur ? 'Unlock window' : 'Lock window';
  });
  el.querySelector('[data-wact="snap"]').addEventListener('click',e=>{
    e.stopPropagation();
    openSnapLayoutsPicker(id, e.currentTarget);
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

// Returns the workspace's pixel rect (in unzoomed coords) so the snap math is
// independent of current zoom level.
function _workspaceRect(){
  const canvas = document.getElementById('workspace-canvas') || document.getElementById('workspace');
  if (!canvas) return { w: window.innerWidth, h: window.innerHeight };
  const z = (typeof getZoom === 'function') ? getZoom() : 1;
  // clientWidth/Height is the on-screen size; divide by zoom to get the
  // logical/unzoomed workspace size that window x/y/w/h are stored in.
  return { w: canvas.clientWidth / z, h: canvas.clientHeight / z };
}

function snapWindowToZone(id, zone){
  const ws = _workspaceRect();
  const x = Math.round(zone.x * ws.w);
  const y = Math.round(zone.y * ws.h);
  const w = Math.round(zone.w * ws.w);
  const h = Math.round(zone.h * ws.h);
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
