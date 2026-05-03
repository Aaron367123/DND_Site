// ============================================================
// PLAYER VIEW
// ============================================================
// Activated by opening this same HTML file with ?player=1 in the URL.
//
// Reuses the regular workspace + panel system, gated to read-only and
// constrained to whatever panels the DM has shared via the 👁 button on
// each window. Live updates come through the same per-key Firebase sync
// the DM tab uses, so a remote player on their own laptop sees changes
// without any custom transport.

// The player keeps their own "visible" set in localStorage — a subset of what
// the DM has shared. First-time players see everything; afterwards their
// closed-window choices stick across reloads.
const _PV_VISIBLE_KEY = 'skt-player-visible-v1';
function _readPlayerVisible(){
  try {
    const raw = localStorage.getItem(_PV_VISIBLE_KEY);
    if (raw == null) return null; // null = first run, show everything
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch(e){ return new Set(); }
}
function _writePlayerVisible(set){
  try { localStorage.setItem(_PV_VISIBLE_KEY, JSON.stringify([...set])); } catch(e){}
}
let _playerVisible = null; // populated in initPlayerView

function _applySharedPanelsToPlayerView(){
  const shared = new Set(state.sharedPanels || []);
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  // First time: default to first shared panel on mobile, all on desktop.
  if (_playerVisible == null){
    if (isMobile){
      const first = [...shared][0];
      _playerVisible = new Set(first ? [first] : []);
    } else {
      _playerVisible = new Set(shared);
    }
  }
  // Remove anything from _playerVisible that's no longer shared.
  for (const id of [..._playerVisible]) if (!shared.has(id)) _playerVisible.delete(id);

  const desired = new Set([..._playerVisible].filter(id => shared.has(id)));
  const open = new Set(Array.from(document.querySelectorAll('.window[data-panel]'))
    .map(el => el.dataset.panel));

  desired.forEach(id => {
    if (!open.has(id) && panelDefs[id]){
      if (!layout[id]) layout[id] = (DEFAULT_LAYOUT[id] ? {...DEFAULT_LAYOUT[id]} : {x:40,y:40,w:480,h:520,open:true,minimized:false,z:1});
      layout[id] = {...layout[id], open:true, minimized:false};
      ensurePanel(id);
    }
  });
  open.forEach(id => {
    if (!desired.has(id)) closePanel(id);
  });

  _renderPlayerDock();
  _writePlayerVisible(_playerVisible);

  // Empty-state placeholder
  const canvas = document.getElementById('workspace-canvas');
  if (!canvas) return;
  const empty = canvas.querySelector('#pv-empty');
  if (!shared.size && !empty){
    canvas.insertAdjacentHTML('beforeend',
      '<div id="pv-empty" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#666;font-size:14px;text-align:center;pointer-events:none">'
      + 'Waiting for the DM to share something…<br><br>'
      + '<span style="font-size:11px">Click the 👁 in any panel\'s title bar on the DM tab.</span>'
      + '</div>');
  } else if (shared.size && empty){
    empty.remove();
  }
}

// Floating mini-dock for the player: one chip per DM-shared panel. Click to
// toggle visibility. Active = currently open in this player view.
function _renderPlayerDock(){
  const shared = state.sharedPanels || [];
  let dock = document.getElementById('pv-dock');
  if (!shared.length){ dock?.remove(); return; }
  if (!dock){
    dock = document.createElement('div');
    dock.id = 'pv-dock';
    dock.className = 'pv-dock';
    document.body.appendChild(dock);
  }
  dock.innerHTML = shared.map(id => {
    const def = panelDefs[id]; if (!def) return '';
    const visible = _playerVisible.has(id);
    return `<button class="pv-dock-btn ${visible?'active':''}" data-pv-toggle="${id}" title="${def.title}">${def.icon || '◇'}</button>`;
  }).join('');
  dock.querySelectorAll('[data-pv-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.pvToggle;
      const isMobile = window.matchMedia('(max-width: 768px)').matches;
      if (isMobile){
        // Tab-bar behavior: tapping a chip shows ONLY that panel; tapping the
        // active chip again hides it (back to empty state).
        if (_playerVisible.has(id) && _playerVisible.size === 1) {
          _playerVisible.delete(id);
        } else {
          _playerVisible = new Set([id]);
        }
      } else {
        // Desktop: free toggle — multiple panels can coexist.
        if (_playerVisible.has(id)) _playerVisible.delete(id);
        else _playerVisible.add(id);
      }
      _applySharedPanelsToPlayerView();
    });
  });
}

// Patch closePanel so player-mode closes also remove the panel from the
// player-visible set (without this, the next sync would reopen it).
function _patchClosePanelForPlayer(){
  if (typeof closePanel !== 'function') return;
  const orig = closePanel;
  window.closePanel = function(id){
    if (document.body.classList.contains('player-mode') && _playerVisible){
      _playerVisible.delete(id);
      _writePlayerVisible(_playerVisible);
      _renderPlayerDock();
    }
    return orig.call(this, id);
  };
}

// Hide the bottom dock on scroll-down, reveal on scroll-up. Only active on
// mobile breakpoint. Listens in capture phase because scroll events don't
// bubble — this catches scrolls inside any .window-body in the player view.
function _initMobileDockHideOnScroll(){
  const dockSelector = () => document.getElementById('pv-dock');
  // Per-element last-scroll-Y, so panels with independent scroll positions
  // don't clobber each other when the user switches tabs.
  const lastY = new WeakMap();
  let ticking = false;
  document.addEventListener('scroll', e => {
    if (!window.matchMedia('(max-width: 768px)').matches) return;
    const target = e.target;
    if (!target || target.nodeType !== 1) return;
    if (!target.classList || !target.classList.contains('window-body')) return;
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const cur = target.scrollTop;
      const prev = lastY.get(target) ?? 0;
      const dock = dockSelector();
      if (dock){
        // Always show when at the very top.
        if (cur <= 4) dock.classList.remove('hidden-on-scroll');
        else if (cur > prev + 6) dock.classList.add('hidden-on-scroll');
        else if (cur < prev - 6) dock.classList.remove('hidden-on-scroll');
      }
      lastY.set(target, cur);
      ticking = false;
    });
  }, true);
}

function initPlayerView(){
  document.body.classList.add('player-mode');
  load();
  initRealtime();
  initZoomPan();
  if (typeof initSettings === 'function'){
    try { initSettings(); } catch(e){ console.warn('initSettings failed in player view', e); }
  }
  _playerVisible = _readPlayerVisible();
  _patchClosePanelForPlayer();
  _applySharedPanelsToPlayerView();
  _initMobileDockHideOnScroll();
  // Re-apply on viewport flip (rotate, desktop⇄mobile breakpoint cross). When
  // entering mobile mode, collapse to a single panel; when leaving, leave the
  // current set alone (player can re-open whatever they want from the dock).
  let _wasMobile = window.matchMedia('(max-width: 768px)').matches;
  window.addEventListener('resize', () => {
    const nowMobile = window.matchMedia('(max-width: 768px)').matches;
    if (nowMobile && !_wasMobile && _playerVisible && _playerVisible.size > 1){
      const first = [..._playerVisible][0];
      _playerVisible = new Set([first]);
      _applySharedPanelsToPlayerView();
    }
    _wasMobile = nowMobile;
  });
}
