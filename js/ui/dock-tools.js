// ============================================================
// DOCK TOOLS — the top-right toolbar's tools, in the dock
// ============================================================
// The floating pill in the top-right corner (search, campaign, sync, player
// view, help, settings) sat over the workspace, so windows kept ending up
// under it. On a wide screen its tools move into the dock instead: search
// at the top, the rest at the bottom, each a dock button with its name
// beside it when the dock is widened (or as a label on hover). The full
// search box opens centred over the workspace.
//
// The elements themselves move, ids and listeners intact, so everything that
// drives them (search.js, realtime's sync chip, campaign-ui, settings) keeps
// working without knowing where they are. A phone keeps the pill — its
// windows reserve room for it in their title bars — and so does the player
// view; crossing between the two puts them back.

const DT_PHONE = '(max-width: 768px) and (pointer: coarse)';
// [id, where, name when it has no title to take one from]
const DT_TOOLS = [
  ['float-search-btn', 'top', 'Search  ( / or Ctrl+K )'],
  ['campaign-btn', 'bottom', 'Campaign'],
  ['sync-status', 'bottom', 'Sync'],
  ['player-view-btn', 'bottom', 'Player view'],
  ['tutorial-btn', 'bottom', 'Help'],
  ['settings-btn', 'bottom', 'Settings'],
];
let _dtOrder = null, _dtObs = null;

// A tool's name: the campaign's own name, the sync chip's state, or fixed.
function _dtName(el, fallback){
  if (el.id === 'campaign-btn') return (document.getElementById('campaign-name') || {}).textContent || fallback;
  if (el.id === 'sync-status'){ const t = (el.querySelector('.sync-dot + span') || {}).textContent; return t ? 'Sync: ' + t : fallback; }
  return fallback;
}
function _dtLabel(el, fallback){
  const name = _dtName(el, fallback);
  // Written only when it changed: the observer below watches these
  // elements, and a write it didn't need would wake it again, forever.
  if (el.dataset.label !== name) el.dataset.label = name;
  let lab = el.querySelector(':scope > .dock-label.dt-label');
  if (!lab){ lab = document.createElement('span'); lab.className = 'dock-label dt-label'; el.appendChild(lab); }
  if (lab.textContent !== name) lab.textContent = name;
  // The campaign chip is a name and a caret in the pill; in the dock it
  // needs an icon like its neighbours.
  if (el.id === 'campaign-btn' && !el.querySelector(':scope > .dt-ico'))
    el.insertAdjacentHTML('afterbegin', '<svg class="ico dt-ico" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-scroll"/></svg>');
  // The hover label replaces the native tooltip, as for the panel buttons
  // (initDockNames); the full description stays as the accessible name.
  const t = el.getAttribute('title');
  if (t){ el.dataset.dtTitle = t; el.setAttribute('aria-label', t); el.removeAttribute('title'); }
}

function sktDockToolsApply(){
  const bar = document.getElementById('float-toolbar');
  const top = document.getElementById('dock-tools-top'), bottom = document.getElementById('dock-tools-bottom');
  if (!bar || !top || !bottom) return;
  if (!_dtOrder) _dtOrder = [...bar.children];
  const wide = !document.body.classList.contains('player-mode') && !matchMedia(DT_PHONE).matches;
  const was = document.body.classList.contains('tools-in-dock');
  if (wide === was && (wide ? top.children.length : bar.children.length)) return;
  document.body.classList.toggle('tools-in-dock', wide);
  const wrap = document.getElementById('search-wrap');
  if (wide){
    DT_TOOLS.forEach(([id, where, name]) => {
      const el = document.getElementById(id); if (!el) return;
      (where === 'top' ? top : bottom).appendChild(el);
      el.classList.add('dock-btn', 'dt-tool');
      _dtLabel(el, name);
    });
    // The full search box: centred over the workspace, not squeezed into a
    // 44px dock.
    if (wrap) document.body.appendChild(wrap);
    // The campaign's name and the sync state change; their labels follow.
    if (!_dtObs && typeof MutationObserver === 'function'){
      _dtObs = new MutationObserver(() => {
        if (!document.body.classList.contains('tools-in-dock')) return;
        DT_TOOLS.forEach(([id, , name]) => { const el = document.getElementById(id); if (el && el.closest('.dock-tools')) _dtLabel(el, name); });
      });
      DT_TOOLS.forEach(([id]) => { const el = document.getElementById(id); if (el) _dtObs.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title'] }); });
    }
  } else {
    _dtOrder.forEach(el => {
      bar.appendChild(el);
      el.classList.remove('dock-btn', 'dt-tool');
      el.querySelector(':scope > .dt-label')?.remove();
      el.querySelector(':scope > .dt-ico')?.remove();
      delete el.dataset.label;
      if (el.dataset.dtTitle){ el.setAttribute('title', el.dataset.dtTitle); delete el.dataset.dtTitle; }
    });
  }
  if (typeof _updateToolbarOcclusion === 'function') _updateToolbarOcclusion();
}

function sktDockTools(){
  sktDockToolsApply();
  try { matchMedia(DT_PHONE).addEventListener('change', sktDockToolsApply); } catch(e){}
}
