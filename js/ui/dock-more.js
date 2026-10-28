// ============================================================
// DOCK — More: the windows used least, one click away
// ============================================================
// Nineteen windows made a dock taller than a laptop screen, so the icons
// had been shrunk to fit. Now the icons are full size and the windows a DM
// reaches for least sit behind a ⋯ More button at the foot of the dock. Which
// ones is the DM's choice, kept on this device: right-click an icon → Move to
// More, or Pin to dock from the pop-out. A window behind More still shows
// it's open (More lights up) and has news (a dot on More).
//
// Wide screens only. A phone's dock is a bar it scrolls sideways, with room
// for everything.

const SKT_DOCK_MORE_KEY = 'skt-dock-more-v1';
const SKT_DOCK_MORE_DEFAULT = ['homebrew', 'library', 'bestiary', 'soundboard', 'npclib'];

function sktDockMoreIds(){
  try { const a = JSON.parse(localStorage.getItem(SKT_DOCK_MORE_KEY) || 'null'); if (Array.isArray(a)) return a; } catch(e){}
  return SKT_DOCK_MORE_DEFAULT.slice();
}
function sktDockMoreSet(ids){
  try { localStorage.setItem(SKT_DOCK_MORE_KEY, JSON.stringify(ids)); } catch(e){}
  sktDockMoreRefresh();
}
function sktDockMove(id, toMore){
  const ids = sktDockMoreIds().filter(x => x !== id);
  if (toMore) ids.push(id);
  sktDockMoreSet(ids);
}
// Hide what's behind More, light More up for what's open there, a dot for
// news, and drop a group heading whose every window has moved.
function sktDockMoreRefresh(){
  const panels = document.querySelector('.panel-dock .dock-panels'); if (!panels) return;
  const more = document.getElementById('dock-more-btn'); if (!more) return;
  const ids = new Set(sktDockMoreIds());
  let anyHidden = false, anyOpen = false, anyNews = false;
  panels.querySelectorAll('.dock-btn[data-panel]').forEach(b => {
    const hid = ids.has(b.dataset.panel);
    b.classList.toggle('in-more', hid);
    if (!hid) return;
    anyHidden = true;
    if (typeof layout !== 'undefined' && layout[b.dataset.panel] && layout[b.dataset.panel].open) anyOpen = true;
    if (b.querySelector('.dock-badge')) anyNews = true;
  });
  more.classList.toggle('in-more', !anyHidden);   // nothing behind it: no button
  more.classList.toggle('active', anyOpen);
  more.classList.toggle('has-news', anyNews);
  // A heading with nothing left under it goes too.
  let div = null, shown = 0;
  const close = () => { if (div) div.classList.toggle('in-more', shown === 0); };
  [...panels.children].forEach(el => {
    if (el.classList.contains('dock-divider')){ close(); div = el; shown = 0; }
    else if (el.classList.contains('dock-btn') && el.dataset.panel && !el.classList.contains('in-more')) shown++;
  });
  close();
  const pop = document.getElementById('dock-more-pop'); if (pop) sktDockMoreFill(pop);
}

// ── The pop-out ─────────────────────────────────────────────────────────────
function sktDockMoreFill(pop){
  const ids = sktDockMoreIds();
  const btns = ids.map(id => document.querySelector('.panel-dock .dock-panels .dock-btn[data-panel="' + id + '"]')).filter(Boolean);
  pop.innerHTML = (btns.length ? btns.map(b => {
      const id = b.dataset.panel, ico = b.querySelector('svg') ? b.querySelector('svg').outerHTML : '';
      const open = typeof layout !== 'undefined' && layout[id] && layout[id].open;
      return '<div class="dmp-row"><button class="dmp-open' + (open ? ' on' : '') + '" data-dmp-open="' + id + '">' + ico + '<span>' + esc(b.dataset.label || id) + '</span>'
        + (b.querySelector('.dock-badge') ? '<i class="dmp-news" aria-label="new"></i>' : '') + '</button>'
        + '<button class="dmp-pin" data-dmp-pin="' + id + '" title="Pin to the dock" aria-label="Pin ' + esc(b.dataset.label || id) + ' to the dock">Pin</button></div>';
    }).join('') : '<div class="dmp-empty">Nothing here.</div>')
    + '<div class="dmp-hint">Right-click a dock icon to move it here.</div>';
}
function sktDockMoreClose(){ document.getElementById('dock-more-pop')?.remove(); document.getElementById('dock-more-btn')?.setAttribute('aria-expanded', 'false'); }
function sktDockMoreOpen(){
  const btn = document.getElementById('dock-more-btn'); if (!btn) return;
  sktDockMoreClose(); sktDockCtxClose();
  const pop = document.createElement('div');
  pop.id = 'dock-more-pop'; pop.className = 'dock-pop'; pop.setAttribute('role', 'menu');
  sktDockMoreFill(pop);
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect(), h = pop.offsetHeight;
  pop.style.left = Math.round(r.right + 8) + 'px';
  pop.style.top = Math.round(Math.max(8, Math.min(window.innerHeight - h - 8, r.top + r.height / 2 - h + 24))) + 'px';
  btn.setAttribute('aria-expanded', 'true');
  pop.addEventListener('click', e => {
    const o = e.target.closest('[data-dmp-open]'), p = e.target.closest('[data-dmp-pin]');
    if (o){ sktDockMoreClose(); if (typeof togglePanel === 'function') togglePanel(o.dataset.dmpOpen); }
    else if (p) sktDockMove(p.dataset.dmpPin, false);
  });
}

// ── Right-click an icon: Move to More ───────────────────────────────────────
function sktDockCtxClose(){ document.getElementById('dock-ctx')?.remove(); }
function sktDockCtx(btn, x, y){
  sktDockCtxClose(); sktDockMoreClose();
  const m = document.createElement('div');
  m.id = 'dock-ctx'; m.className = 'dock-pop dock-ctx'; m.setAttribute('role', 'menu');
  m.innerHTML = '<button class="dmp-open" role="menuitem" data-dock-tomore="' + btn.dataset.panel + '">Move ' + esc(btn.dataset.label || '') + ' to More</button>';
  document.body.appendChild(m);
  m.style.left = Math.round(Math.min(x, window.innerWidth - m.offsetWidth - 8)) + 'px';
  m.style.top = Math.round(Math.min(y, window.innerHeight - m.offsetHeight - 8)) + 'px';
  m.querySelector('[data-dock-tomore]').addEventListener('click', () => { sktDockCtxClose(); sktDockMove(btn.dataset.panel, true); });
}

function initDockMore(){
  const panels = document.querySelector('.panel-dock .dock-panels');
  if (!panels || document.getElementById('dock-more-btn') || document.body.classList.contains('player-mode')) return;
  const more = document.createElement('button');
  more.className = 'dock-btn dock-more'; more.id = 'dock-more-btn';
  more.dataset.label = 'More'; more.setAttribute('aria-label', 'More windows'); more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
  more.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-dots"/></svg><span class="dock-label">More</span>';
  panels.appendChild(more);
  more.addEventListener('click', e => { e.stopPropagation(); if (document.getElementById('dock-more-pop')) sktDockMoreClose(); else sktDockMoreOpen(); });
  panels.addEventListener('contextmenu', e => {
    const b = e.target.closest('.dock-btn[data-panel]');
    if (!b || !document.body.classList.contains('tools-in-dock')) return;
    e.preventDefault(); sktDockCtx(b, e.clientX, e.clientY);
  });
  document.addEventListener('mousedown', e => {
    if (!e.target.closest('#dock-more-pop, #dock-more-btn')) sktDockMoreClose();
    if (!e.target.closest('#dock-ctx')) sktDockCtxClose();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape'){ sktDockMoreClose(); sktDockCtxClose(); } });
  // A badge appearing on a window behind More puts the dot on More.
  if (typeof MutationObserver === 'function') new MutationObserver(() => sktDockMoreRefresh()).observe(panels, { childList: true, subtree: true });
  sktDockMoreRefresh();
}
