// ============================================================
// COMMAND PALETTE  —  Ctrl+K (⌘K on a Mac)
// ============================================================
// One box that gets you anywhere: open any panel, switch workspace, run the
// things you otherwise hunt for in a menu (next turn, long rest, arrange
// windows…), or jump to a monster / spell / item. Type a few letters, press
// Enter.
//
// It does not replace the / search. That one browses the rules with tabs and
// a detail pane; this one is for DOING things, and only lists rules entries
// as a shortcut to their pop-out. The rules matches reuse the search pool
// (getSearchPool / _getVisiblePool), so hidden sources stay hidden here too.
//
// DM view only: players have no panels, workspaces or combat controls.

const CP_MAX_CONTENT = 6;

function _cpIsPlayer(){
  if (document.body.classList.contains('player-mode')) return true;
  try { return new URLSearchParams(location.search).get('player') === '1'; } catch(e){ return false; }
}

// Everything the palette can do, rebuilt on every open so it reflects what is
// open, which workspaces exist and whether a fight is running.
function _cpCommands(){
  const out = [];
  const add = (group, label, run, keys, hint) => out.push({ group, label, run, keys: keys || '', hint: hint || '' });

  // Panels: every dock button, by the name the dock shows.
  document.querySelectorAll('.panel-dock .dock-btn[data-panel]').forEach(b => {
    const id = b.dataset.panel;
    const name = b.dataset.label || panelDefs[id]?.title || id;
    const open = !!(layout[id] && layout[id].open && !layout[id].minimized);
    add('Panels', name, () => { if (!open) openPanel(id); focusPanel(id); },
        (panelDefs[id]?.title || '') + ' panel window', open ? 'open' : '');
  });

  // Workspaces.
  if (typeof _wsState !== 'undefined' && _wsState && Array.isArray(_wsState.list)){
    _wsState.list.forEach((w, i) => {
      if (w.id === _wsState.active) return;
      add('Workspaces', 'Switch to ' + (w.name || 'workspace ' + (i + 1)),
          () => wsSwitch(w.id), 'workspace layout', i < 9 ? String(i + 1) : '');
    });
  }

  // Combat. Runs through the tracker's own methods, mounting it if it is
  // closed, so the turn logic (rage rounds, buff expiry, the log) all runs.
  const combat = fn => () => {
    if (!mounted.has('combat')) ensurePanel('combat');
    const C = panelDefs.combat;
    if (C && typeof C[fn] === 'function') C[fn]();
  };
  const fighting = (state.combatants || []).length > 0;
  if (fighting){
    add('Combat', 'Next turn',      combat('_nextTurn'),       'advance end turn');
    add('Combat', 'Previous turn',  combat('_prevTurn'),       'back undo turn');
    add('Combat', 'Roll initiative for monsters', combat('_rollInitiative'), 'npc init d20');
  }

  // Party.
  if ((state.party || []).length){
    const party = fn => () => {
      if (!mounted.has('party')) ensurePanel('party');
      const P = panelDefs.party;
      if (P && typeof P[fn] === 'function') P[fn]();
    };
    add('Party', 'Long rest (whole party)',  party('_longRestAll'),  'rest sleep recover');
    add('Party', 'Short rest (whole party)', party('_shortRestAll'), 'rest hit dice');
  }

  // Workspace and app.
  if (typeof window.smartArrange === 'function')
    add('Windows', 'Arrange windows', () => window.smartArrange(), 'tile tidy layout', 'Ctrl Shift A');
  const expand = document.getElementById('dock-expand-btn');
  if (expand) add('Windows', document.body.classList.contains('dock-expanded') ? 'Hide panel names' : 'Show panel names',
                  () => expand.click(), 'sidebar dock labels');
  add('App', 'Settings', () => document.getElementById('settings-drawer')?.classList.add('open'), 'preferences options theme font');
  if (typeof sktOpenCampaignManager === 'function')
    add('App', 'Switch campaign', () => sktOpenCampaignManager(), 'campaigns manage');
  const pv = document.getElementById('player-view-btn');
  if (pv) add('App', 'Open the player view', () => pv.click(), 'players screen');
  if (typeof window.showHelpOverlay === 'function')
    add('App', 'Keyboard shortcuts', () => window.showHelpOverlay(), 'help keys', '?');
  return out;
}

function _cpNorm(s){ return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

// Every typed word must START a word in the label or its hidden keywords —
// "ra" finds Random and Ramius, not the middle of "Tracker". Groups stay
// together (a heading never appears twice), ordered by their best match:
// a label that starts with the query, then a label word that does, then a
// keyword-only match.
function _cpMatch(list, q){
  const toks = _cpNorm(q).split(' ').filter(Boolean);
  if (!toks.length) return list.slice();
  const qq = toks.join(' ');
  const scored = [];
  list.forEach((c, i) => {
    const lab = _cpNorm(c.label);
    const words = (lab + ' ' + _cpNorm(c.keys) + ' ' + _cpNorm(c.group)).split(' ');
    if (!toks.every(t => words.some(w => w.startsWith(t)))) return;
    const lw = lab.split(' ');
    const score = lab.startsWith(qq) ? 0 : toks.every(t => lw.some(w => w.startsWith(t))) ? 1 : 2;
    scored.push({ c, score, i });
  });
  const best = {};
  scored.forEach(s => { const g = s.c.group; if (!(g in best) || s.score < best[g].score || (s.score === best[g].score && s.i < best[g].i)) best[g] = s; });
  scored.sort((a, b) => {
    const ga = best[a.c.group], gb = best[b.c.group];
    return ga.score - gb.score || ga.i - gb.i || a.score - b.score || a.i - b.i;
  });
  return scored.map(s => s.c);
}

// Rules entries, straight from the search pool. Only once something is typed:
// an empty palette is a list of commands, not the first six monsters A–Z.
function _cpContent(q){
  const n = _cpNorm(q);
  if (n.length < 2 || typeof _getVisiblePool !== 'function') return [];
  let pool;
  try { pool = _getVisiblePool(); } catch(e){ return []; }
  const toks = n.split(' ');
  const hits = [];
  for (const r of pool){
    const nm = r._n || (r._n = _cpNorm(r.name));
    if (!toks.every(t => nm.split(' ').some(w => w.startsWith(t)))) continue;
    hits.push(r);
    if (hits.length > 200) break;
  }
  hits.sort((a, b) => ((a._n || '').startsWith(n) ? 0 : 1) - ((b._n || '').startsWith(n) ? 0 : 1)
                   || a.name.length - b.name.length || a.name.localeCompare(b.name));
  // One row per name: the same Goblin in six books is one answer here. The
  // / search lists every printing when the book matters.
  const seen = new Set(), uniq = [];
  for (const r of hits){
    const k = r.cat + '|' + (r._n || r.name);
    if (seen.has(k)) continue;
    seen.add(k); uniq.push(r);
    if (uniq.length >= CP_MAX_CONTENT) break;
  }
  const src = r => (r._source && typeof _formatSource === 'function') ? ' · ' + _formatSource(r._source) : '';
  return uniq.map(r => ({
    group: 'Rules', label: r.name, hint: r.cat + src(r),
    run: () => { if (typeof popOutDetail === 'function') popOutDetail(r); }
  }));
}

function openCommandPalette(){
  if (document.getElementById('cp-backdrop')) return;
  const commands = _cpCommands();
  const back = document.createElement('div');
  back.className = 'modal-backdrop cp-backdrop';
  back.id = 'cp-backdrop';
  back.innerHTML = `<div class="cp" role="dialog" aria-modal="true" aria-label="Go to anything">
      <input class="cp-input" id="cp-input" type="text" autocomplete="off" spellcheck="false"
             placeholder="Open a panel, run a command, or find a monster, spell or item…">
      <div class="cp-list" id="cp-list" role="listbox"></div>
      <div class="cp-foot"><span><kbd>↑</kbd><kbd>↓</kbd> choose</span><span><kbd>Enter</kbd> go</span><span><kbd>Esc</kbd> close</span></div>
    </div>`;
  document.body.appendChild(back);
  const inp = back.querySelector('#cp-input');
  const listEl = back.querySelector('#cp-list');
  let items = [], sel = 0;

  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
  const run = i => {
    const it = items[i]; if (!it) return;
    close();
    try { it.run(); } catch(e){ console.warn('[palette]', it.label, e); }
  };
  const paint = () => {
    const q = inp.value;
    items = _cpMatch(commands, q).concat(_cpContent(q));
    if (sel >= items.length) sel = Math.max(0, items.length - 1);
    if (!items.length){
      listEl.innerHTML = '<div class="cp-empty">Nothing matches "' + esc(q) + '"</div>';
      return;
    }
    let last = null;
    listEl.innerHTML = items.map((it, i) => {
      const head = it.group !== last ? '<div class="cp-group">' + esc(it.group) + '</div>' : '';
      last = it.group;
      return head + '<div class="cp-item' + (i === sel ? ' on' : '') + '" data-i="' + i + '" role="option" aria-selected="' + (i === sel) + '">'
        + '<span class="cp-label">' + esc(it.label) + '</span>'
        + (it.hint ? '<span class="cp-hint">' + esc(it.hint) + '</span>' : '')
        + '</div>';
    }).join('');
    listEl.querySelector('.cp-item.on')?.scrollIntoView({ block: 'nearest' });
  };
  // Capture phase, so the workspace's own keys (1–9, /, ?) never see what is
  // typed here.
  const onKey = e => {
    if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K'))){
      e.preventDefault(); e.stopPropagation(); close(); return;
    }
    if (e.key === 'ArrowDown'){ e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); paint(); return; }
    if (e.key === 'ArrowUp'){ e.preventDefault(); sel = Math.max(sel - 1, 0); paint(); return; }
    if (e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); run(sel); return; }
    e.stopPropagation();
  };
  document.addEventListener('keydown', onKey, true);
  inp.addEventListener('input', () => { sel = 0; paint(); });
  listEl.addEventListener('mousemove', e => {
    const el = e.target.closest('.cp-item'); if (!el) return;
    const i = +el.dataset.i; if (i !== sel){ sel = i; listEl.querySelectorAll('.cp-item').forEach(x => x.classList.toggle('on', +x.dataset.i === i)); }
  });
  listEl.addEventListener('click', e => { const el = e.target.closest('.cp-item'); if (el) run(+el.dataset.i); });
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  paint();
  inp.focus();
}
window.openCommandPalette = openCommandPalette;

(function _initCommandPalette(){
  if (_cpIsPlayer()) return;
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    if (e.key !== 'k' && e.key !== 'K') return;
    // Works from inside a text field too — that is where your hands are —
    // but not over another dialog, which would strand it underneath.
    if (document.querySelector('.modal-backdrop:not(#cp-backdrop)')) return;
    e.preventDefault();
    openCommandPalette();   // a second Ctrl+K while open is handled by its own key listener
  });
})();
