// ============================================================
// WORKSPACE CONTEXT MENU
// ============================================================
// Right-click on the workspace background to open a categorized
// panel-toggle menu plus saved "focuses" (layout presets).

const CTX_PANEL_GROUPS = [
  { label: 'Combat Tools', items: [
    { id: 'party',    name: 'Party Tracker' },
    { id: 'combat',   name: 'Combat Tracker' },
    { id: 'bestiary', name: 'Bestiary' },
  ]},
  { label: 'References', items: [
    { id: 'adventures', name: 'Adventures' },
    { id: 'books',      name: 'Books' },
  ]},
  { label: 'NPC Management', items: [
    { id: 'npcgen', name: 'NPC Generator' },
    { id: 'npclib', name: 'NPC Library' },
  ]},
  { label: 'Utilities', items: [
    { id: 'notes',     name: 'Session Notes' },
    { id: 'shop',      name: 'Shop Generator' },
    { id: 'loot',      name: 'Loot Tracker' },
    { id: 'encounter', name: 'Encounter Builder' },
    { id: 'weather',   name: 'Weather Tool' },
    { id: 'time',      name: 'Time Tracker' },
  ]},
  { label: 'Audio Visual', items: [
    { id: 'battlemap',  name: 'Battle Map' },
    { id: 'soundboard', name: 'Sound Board' },
  ]},
];

const CTX_FOCUS_KEY = 'skt-focuses-v1';
let _ctxLastFocusId = null;

function _ctxLoadFocuses(){
  try { return JSON.parse(localStorage.getItem(CTX_FOCUS_KEY) || '[]'); }
  catch(e) { return []; }
}
function _ctxSaveFocuses(list){
  try { localStorage.setItem(CTX_FOCUS_KEY, JSON.stringify(list)); } catch(e) {}
}

// Snapshot the current open panels + their positions/sizes. Pulls live
// position from each window's inline style when available — `layout[id]`
// can lag behind the DOM by a few pixels right after a drag/resize,
// which is why focuses used to load slightly off.
function _ctxSnapshot(){
  const panels = {};
  Object.entries(layout).forEach(([id, l]) => {
    if (!l || !l.open) return;
    const el = document.querySelector('.window[data-panel="'+id+'"]');
    const px = (str, fb) => {
      const n = parseFloat(str);
      return Number.isFinite(n) ? Math.round(n) : Math.round(fb);
    };
    if (el){
      panels[id] = {
        x: px(el.style.left,   l.x),
        y: px(el.style.top,    l.y),
        w: px(el.style.width,  l.w),
        h: px(el.style.height, l.h),
        minimized: el.classList.contains('minimized'),
      };
    } else {
      panels[id] = { x:Math.round(l.x), y:Math.round(l.y), w:Math.round(l.w), h:Math.round(l.h), minimized:!!l.minimized };
    }
  });
  // Wrap in a snapshot envelope so we can carry per-focus metadata
  // alongside the panel positions. Today: workspace zoom. Future: scroll
  // position, shared-panels filter, etc.
  return {
    panels,
    zoom: (typeof getZoom === 'function') ? getZoom() : 1,
  };
}

// True when an old-style snapshot — a flat {panelId: {x,y,w,h}} map saved
// before we wrapped them. Legacy focuses load and apply transparently.
function _ctxIsLegacySnap(snap){
  return snap && typeof snap === 'object' && !snap.panels;
}

// Apply a snapshot: close panels not in the snapshot, open + position those that are.
function _ctxApplyFocus(snap){
  if (!snap) return;
  const panels = _ctxIsLegacySnap(snap) ? snap : (snap.panels || {});
  // Close panels that aren't in the snapshot
  Object.keys(layout).forEach(id => {
    if (layout[id] && layout[id].open && !panels[id]) closePanel(id);
  });
  // Open + position the ones that are
  Object.entries(panels).forEach(([id, pos]) => {
    layout[id] = { ...(layout[id]||{}), ...pos, open: true, z: _nextZ() };
    ensurePanel(id);
  });
  saveLayout();
  updateDock();
  // Restore zoom if the snapshot carried one. Skips the smooth animation
  // because focus-loading is a "snap into place" action, not a deliberate
  // zoom gesture. Falls back to no-op if zoom-pan.js isn't available.
  if (!_ctxIsLegacySnap(snap) && typeof snap.zoom === 'number' && typeof setZoom === 'function'){
    setZoom(snap.zoom);
  }
}

// Build the menu DOM. Mounted lazily on first right-click.
function _ctxBuildMenu(){
  let el = document.getElementById('workspace-ctx-menu');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'workspace-ctx-menu';
  el.className = 'ctx-menu';
  document.body.appendChild(el);
  return el;
}

function _ctxRender(menu){
  const focuses = _ctxLoadFocuses();
  let html = '';
  CTX_PANEL_GROUPS.forEach(group => {
    html += `<div class="ctx-section-label">${esc(group.label)}</div>`;
    group.items.forEach(item => {
      const open = !!(layout[item.id] && layout[item.id].open && !layout[item.id].minimized);
      html += `<div class="ctx-item" data-panel="${item.id}">
        <span class="ctx-radio${open?' on':''}"></span>
        <span class="ctx-item-label">${esc(item.name)}</span>
      </div>`;
    });
  });
  // Focuses section
  html += `<div class="ctx-section-label">Focuses</div>`;
  html += `<div class="ctx-item" data-focus-act="last">
    <span class="ctx-radio-icon">↺</span>
    <span class="ctx-item-label">Use Last Setup</span>
  </div>`;
  if (focuses.length) {
    html += `<div class="ctx-section-label">My Focuses</div>`;
    focuses.forEach((f, i) => {
      html += `<div class="ctx-item" data-focus-i="${i}">
        <span class="ctx-radio${_ctxLastFocusId===f.id?' on':''}"></span>
        <span class="ctx-item-label">${esc(f.name)}</span>
        <button class="ctx-mini-btn" data-focus-update="${i}" title="Update with current layout">💾</button>
        <button class="ctx-mini-btn" data-focus-delete="${i}" title="Delete">🗑</button>
      </div>`;
    });
  }
  html += `<div class="ctx-divider"></div>`;
  html += `<div class="ctx-item" data-focus-act="save">
    <span class="ctx-radio-icon">+</span>
    <span class="ctx-item-label">Save Current as Focus…</span>
  </div>`;
  // Smart-arrange: workspace-wide tile of all open windows. Sits at the
  // bottom because it's a one-shot action, not a stored preference.
  html += `<div class="ctx-divider"></div>`;
  html += `<div class="ctx-item" data-ctx-act="smart-arrange">
    <span class="ctx-radio-icon">▦</span>
    <span class="ctx-item-label">Smart arrange (auto-tile)</span>
    <span class="ctx-shortcut" style="margin-left:auto;font-size:9px;color:var(--text-dim);letter-spacing:.04em">Ctrl+Shift+A</span>
  </div>`;
  menu.innerHTML = html;
}

function _ctxOpen(x, y){
  const menu = _ctxBuildMenu();
  _ctxRender(menu);
  menu.classList.add('open');
  // Position, then clamp to viewport so it never spills off-screen.
  menu.style.left = '0px';
  menu.style.top  = '0px';
  const { offsetWidth: w, offsetHeight: h } = menu;
  const maxX = window.innerWidth  - w - 4;
  const maxY = window.innerHeight - h - 4;
  menu.style.left = Math.min(Math.max(4, x), maxX) + 'px';
  menu.style.top  = Math.min(Math.max(4, y), maxY) + 'px';
}
function _ctxClose(){
  const menu = document.getElementById('workspace-ctx-menu');
  if (menu) menu.classList.remove('open');
}

function initWorkspaceContextMenu(){
  const ws = document.getElementById('workspace');
  if (!ws) return;

  ws.addEventListener('contextmenu', e => {
    // Skip ONLY when the click is on a form field / contenteditable / canvas
    // — those are where the browser's native menu is genuinely useful
    // (Copy/Paste, Save image, etc.). Right-clicking on a window's blank
    // chrome still pops our workspace menu so the user can reach
    // focuses/panels from anywhere, not just from the sliver of literal
    // empty canvas between panels.
    if (e.target.closest('input, textarea, select, [contenteditable="true"], canvas, img, video, a')) return;
    // Panels can opt out per-element by tagging anything with data-allow-native-menu.
    if (e.target.closest('[data-allow-native-menu]')) return;
    e.preventDefault();
    _ctxOpen(e.clientX, e.clientY);
  });

  // Click handling on the menu (event delegation).
  document.addEventListener('click', e => {
    const menu = document.getElementById('workspace-ctx-menu');
    if (!menu) return;
    if (!menu.classList.contains('open')) return;

    const inside = e.target.closest('#workspace-ctx-menu');
    if (!inside) { _ctxClose(); return; }

    // Mini buttons (update/delete) — handled before the parent ctx-item click
    const updateIdx = e.target.closest('[data-focus-update]')?.dataset.focusUpdate;
    if (updateIdx != null) {
      e.stopPropagation();
      const focuses = _ctxLoadFocuses();
      const f = focuses[+updateIdx];
      if (f) { f.snap = _ctxSnapshot(); _ctxSaveFocuses(focuses); _ctxRender(menu); showToast('Focus updated: '+f.name); }
      return;
    }
    const delIdx = e.target.closest('[data-focus-delete]')?.dataset.focusDelete;
    if (delIdx != null) {
      e.stopPropagation();
      const focuses = _ctxLoadFocuses();
      focuses.splice(+delIdx, 1);
      _ctxSaveFocuses(focuses);
      _ctxRender(menu);
      return;
    }

    const item = e.target.closest('.ctx-item');
    if (!item) return;

    if (item.dataset.panel) {
      togglePanel(item.dataset.panel);
      _ctxRender(menu);  // redraw so the radio updates
      return;
    }
    if (item.dataset.ctxAct === 'smart-arrange') {
      if (typeof window.smartArrange === 'function') window.smartArrange();
      _ctxClose();
      return;
    }
    if (item.dataset.focusI != null) {
      const focuses = _ctxLoadFocuses();
      const f = focuses[+item.dataset.focusI];
      if (f) { _ctxApplyFocus(f.snap); _ctxLastFocusId = f.id; _ctxClose(); }
      return;
    }
    if (item.dataset.focusAct === 'last') {
      const focuses = _ctxLoadFocuses();
      const last = _ctxLastFocusId && focuses.find(f => f.id === _ctxLastFocusId);
      if (last) { _ctxApplyFocus(last.snap); _ctxClose(); }
      else showToast('No previous focus to restore');
      return;
    }
    if (item.dataset.focusAct === 'save') {
      _ctxClose();
      // Snapshot BEFORE the modal opens — once we await the prompt the user
      // could drag a window and the saved layout would no longer match what
      // they had on screen when they clicked Save.
      const snap = _ctxSnapshot();
      showModal('Save focus', [{id:'name', label:'Name', value:'My Layout', placeholder:'e.g. Combat, Roleplay, Travel'}], 'Save').then(r => {
        if (!r || !r.name || !r.name.trim()) return;
        const focuses = _ctxLoadFocuses();
        const f = { id: 'f_'+Date.now(), name: r.name.trim(), snap };
        focuses.push(f);
        _ctxSaveFocuses(focuses);
        _ctxLastFocusId = f.id;
        showToast('Saved focus: '+f.name);
      });
      return;
    }
  });

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') _ctxClose();
  });
}
