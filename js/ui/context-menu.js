// ============================================================
// WORKSPACE CONTEXT MENU
// ============================================================
// Right-click on the workspace background to open a categorized
// panel-toggle menu plus your workspaces (js/ui/workspaces.js). It used to
// keep its own saved layouts, "focuses", beside the workspaces — two ways to
// save the same thing, and a focus saved after workspaces arrived never
// appeared among them.

const CTX_PANEL_GROUPS = [
  { label: 'Combat Tools', items: [
    { id: 'party',    name: 'Party Tracker' },
    { id: 'combat',   name: 'Combat Tracker' },
    { id: 'bestiary', name: 'Bestiary' },
  ]},
  { label: 'References', items: [
    { id: 'library',    name: 'Library (books & adventures)' },
  ]},
  { label: 'NPC Management', items: [
    { id: 'npclib', name: 'NPC Library' },
  ]},
  { label: 'Utilities', items: [
    { id: 'notes',     name: 'Session Notes' },
    { id: 'shop',      name: 'Shop Generator' },
    { id: 'loot',      name: 'Loot Tracker' },
    { id: 'encounter', name: 'Encounter Builder' },
    { id: 'world',     name: 'World (time & weather)' },
  ]},
  { label: 'Audio Visual', items: [
    { id: 'battlemap',  name: 'Battle Map' },
    { id: 'soundboard', name: 'Sound Board' },
  ]},
];

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
  // Workspaces: switch, or save what's on screen as a new one.
  const wsList = (typeof _wsState !== 'undefined' && _wsState) ? _wsState.list : [];
  if (wsList.length){
    html += `<div class="ctx-section-label">Workspaces</div>`;
    wsList.forEach((w, i) => {
      html += `<div class="ctx-item" data-ws-id="${esc(w.id)}">
        <span class="ctx-radio${_wsState.active === w.id ? ' on' : ''}"></span>
        <span class="ctx-item-label">${esc(w.name)}</span>
        ${i < 9 ? `<span class="ctx-shortcut" style="margin-left:auto;font-size:var(--fs-2xs);color:var(--text-dim)">${i + 1}</span>` : ''}
      </div>`;
    });
  }
  html += `<div class="ctx-item" data-ctx-act="ws-add">
    <span class="ctx-radio-icon">+</span>
    <span class="ctx-item-label">New workspace…</span>
  </div>`;
  // Smart-arrange: workspace-wide tile of all open windows. Sits at the
  // bottom because it's a one-shot action, not a stored preference.
  html += `<div class="ctx-divider"></div>`;
  html += `<div class="ctx-item" data-ctx-act="smart-arrange">
    <span class="ctx-radio-icon">▦</span>
    <span class="ctx-item-label">Smart arrange (auto-tile)</span>
    <span class="ctx-shortcut" style="margin-left:auto;font-size:var(--fs-2xs);color:var(--text-dim);letter-spacing:.04em">Ctrl+Shift+A</span>
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
    // workspaces/panels from anywhere, not just from the sliver of literal
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
    if (item.dataset.wsId) {
      _ctxClose();
      if (typeof wsSwitch === 'function') wsSwitch(item.dataset.wsId);
      return;
    }
    if (item.dataset.ctxAct === 'ws-add') {
      _ctxClose();
      if (typeof _wsPromptAdd === 'function') _wsPromptAdd();
      return;
    }
  });

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') _ctxClose();
  });
}
