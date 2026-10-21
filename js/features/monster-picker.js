// ============================================================
// ONE MONSTER PICKER — combat, bestiary, encounter builder
// ============================================================
// There were three, each written on its own: the Combat Tracker's "Add
// monster", the Bestiary's "+", and the Encounter Builder's inline search.
// The same "goblin" gave different results in each — the combat one searched
// names, meta and source; the encounter one names and meta only, capped at
// 30, and searched a dozen hard-coded monsters until the data loaded — and
// the combat one ignored the books hidden in the Books panel while the other
// two honoured them.
//
// Now every caller gets the same search, the same CR and type filters, the
// same preview, and the same hidden-book rule (by the caller's scope, the
// toggles in the Books panel). Only the button differs: "Add to combat",
// "Add to bestiary", "Add to encounter" — with a "how many" where a count
// means something. It stays open after adding, so building a fight is a
// few picks and one Done.
//
//   sktPickMonster({
//     title, action,          // dialog title, primary button label
//     scope,                  // hidden-books consumer: 'encounter' | 'bestiary'
//     count,                  // show "how many"
//     extra,                  // optional { html, read(root) } — e.g. a folder select
//     query,                  // optional starting search
//     onPick(entry, n, extra) // return a short "Added …" line, or false to refuse
//   })

const SKT_MP_LIMIT = 200;
const SKT_MP_CRS = ['0', '1/8', '1/4', '1/2'].concat(Array.from({ length: 30 }, (_, i) => String(i + 1)));

function _sktMpType(d){ return String(d._type || '').split(/[\s(]/)[0].toLowerCase(); }
function _sktMpCr(d){ return d._cr != null ? String(d._cr) : (d._raw && d._raw.challenge_rating != null ? String(d._raw.challenge_rating) : '?'); }

// Every monster the scope allows, A–Z. Built per call: the hidden-books
// toggles can change between opens.
function sktMonsterPool(scope){
  if (typeof _5eData === 'undefined' || !Array.isArray(_5eData)) return [];
  const hidden = (typeof window.SKT_IS_SOURCE_HIDDEN === 'function') ? window.SKT_IS_SOURCE_HIDDEN : null;
  return _5eData.filter(d => d.cat === 'monster' && !(hidden && scope && hidden(scope, d._source)))
    .sort((a, b) => a.name.localeCompare(b.name) || String(a._source || '').localeCompare(String(b._source || '')));
}

// One search rule for every picker: each word must appear in the name, the
// size/type/CR line, or the book (by code or by name).
function sktMonsterMatches(d, q){
  const toks = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return true;
  const hay = (d.name + ' ' + (d.meta || '') + ' ' + (d._source || '') + ' '
    + (typeof _formatSource === 'function' ? (_formatSource(d._source) || '') : '')).toLowerCase();
  return toks.every(t => hay.includes(t));
}

function sktPickMonster(o){
  o = o || {};
  if (typeof _5eData === 'undefined' || typeof _5eLoaded === 'undefined' || !_5eLoaded){
    if (typeof showToast === 'function') showToast('5e data still loading — try again in a moment');
    return null;
  }
  document.getElementById('mp-back')?.remove();
  const all = sktMonsterPool(o.scope);
  const types = [...new Set(all.map(_sktMpType).filter(Boolean))].sort();
  const back = document.createElement('div');
  back.className = 'modal-backdrop'; back.id = 'mp-back';
  back.innerHTML = '<div class="modal mp" role="dialog" aria-modal="true" aria-label="' + esc(o.title || 'Pick a monster') + '">'
    + '<h3>' + esc(o.title || 'Pick a monster') + '</h3>'
    + '<div class="mp-filters">'
    +   '<input type="search" id="mp-q" placeholder="Search monsters — name, type, book…" autocomplete="off" value="' + esc(o.query || '') + '">'
    +   '<select id="mp-cr" aria-label="Challenge rating"><option value="">Any CR</option>'
    +     SKT_MP_CRS.map(c => '<option value="' + c + '">CR ' + c + '</option>').join('') + '</select>'
    +   '<select id="mp-type" aria-label="Creature type"><option value="">Any type</option>'
    +     types.map(t => '<option value="' + esc(t) + '">' + esc(t.charAt(0).toUpperCase() + t.slice(1)) + '</option>').join('') + '</select>'
    + '</div>'
    + (o.extra && o.extra.html ? '<div class="mp-extra">' + o.extra.html + '</div>' : '')
    + '<div class="mp-main"><div class="mp-list" id="mp-list" role="listbox"></div><div class="mp-preview" id="mp-preview"></div></div>'
    + '<div class="mp-count" id="mp-count"></div>'
    + '<div class="modal-actions mp-actions"><span class="mp-done-line" id="mp-status" role="status" aria-live="polite"></span>'
    +   (o.count ? '<label class="mp-n">How many <input type="number" id="mp-n" min="1" max="50" value="1"></label>' : '')
    +   '<button class="btn" data-mp="close">Done</button>'
    +   '<button class="btn primary" data-mp="add" disabled>' + esc(o.action || 'Add') + '</button></div>'
    + '</div>';
  document.body.appendChild(back);
  const $ = s => back.querySelector(s);
  const list = $('#mp-list'), prev = $('#mp-preview'), countEl = $('#mp-count'), addBtn = $('[data-mp="add"]');
  // Rows index into the pool that drew them: 685 slugs are shared between
  // books, so looking a row up by slug reached the other book's stat block.
  let pool = [], sel = -1;

  const preview = d => {
    if (!d){ prev.innerHTML = '<div class="mp-hint">Pick a monster to see it here.</div>'; return; }
    const mod = v => { const n = Math.floor(((+v || 10) - 10) / 2); return (n >= 0 ? '+' : '') + n; };
    const sp = d.speed && typeof d.speed === 'object' ? Object.entries(d.speed).map(([k, v]) => (k === 'walk' ? '' : k + ' ') + (typeof v === 'object' ? v.number : v) + ' ft').join(', ') : (d.speed || '');
    prev.innerHTML = '<div class="mp-pv-name">' + esc(d.name) + '</div>'
      + '<div class="mp-pv-meta">' + esc(d.meta || '') + (d._source ? ' · ' + esc(typeof _formatSource === 'function' ? _formatSource(d._source) : d._source) : '') + '</div>'
      + '<div class="mp-pv-row"><span><b>AC</b> ' + esc(String(d.ac ?? '?')) + '</span><span><b>HP</b> ' + esc(String(d.hp ?? '?')) + '</span>'
      +   (sp ? '<span><b>Speed</b> ' + esc(String(sp)) + '</span>' : '') + '</div>'
      + '<div class="mp-pv-abs">' + ['str', 'dex', 'con', 'int', 'wis', 'cha'].map(k =>
          '<span><b>' + k.toUpperCase() + '</b>' + esc(String(d[k] ?? '—')) + ' (' + mod(d[k]) + ')</span>').join('') + '</div>'
      + (typeof popOutDetail === 'function' ? '<button class="btn small" data-mp="stat">Full stat block</button>' : '');
  };
  const choose = i => {
    sel = i;
    list.querySelectorAll('.mp-row').forEach(r => r.classList.toggle('on', +r.dataset.i === i));
    addBtn.disabled = !pool[i];
    preview(pool[i]);
  };
  const paint = () => {
    const q = $('#mp-q').value, cr = $('#mp-cr').value, ty = $('#mp-type').value;
    const matches = all.filter(d => (!cr || _sktMpCr(d) === cr) && (!ty || _sktMpType(d) === ty) && sktMonsterMatches(d, q));
    pool = matches.slice(0, SKT_MP_LIMIT);
    list.innerHTML = pool.map((d, k) => '<div class="mp-row" role="option" data-i="' + k + '">'
      + '<span class="mp-row-name">' + esc(d.name)
      +   (d._source ? ' <span class="detail-source-badge">' + esc(typeof _formatSource === 'function' ? _formatSource(d._source) : d._source) + '</span>' : '') + '</span>'
      + '<span class="mp-row-cr">CR ' + esc(_sktMpCr(d)) + '</span></div>').join('')
      || '<div class="mp-hint">No matches</div>';
    // Say when the list is cut off, or an absent monster looks like a missing one.
    countEl.textContent = matches.length > SKT_MP_LIMIT
      ? 'Showing the first ' + SKT_MP_LIMIT + ' of ' + matches.length + ' — keep typing, or narrow by CR or type'
      : matches.length + ' match' + (matches.length === 1 ? '' : 'es');
    choose(pool.length === 1 ? 0 : -1);
  };
  const add = () => {
    const d = pool[sel]; if (!d) return;
    const n = o.count ? Math.max(1, Math.min(50, parseInt(($('#mp-n') || {}).value, 10) || 1)) : 1;
    const extra = o.extra && typeof o.extra.read === 'function' ? o.extra.read(back) : null;
    let said;
    try { said = o.onPick ? o.onPick(d, n, extra) : null; } catch(e){ console.warn('[monster picker]', e); said = false; }
    if (said === false) return;
    const st = $('#mp-status');
    st.textContent = '✓ ' + (typeof said === 'string' ? said : 'Added ' + (n > 1 ? n + ' × ' : '') + d.name);
    st.classList.remove('flash'); void st.offsetWidth; st.classList.add('flash');
  };
  const close = () => { document.removeEventListener('keydown', onKey, true); back.remove(); };
  const onKey = e => {
    if (!back.isConnected){ document.removeEventListener('keydown', onKey, true); return; }
    if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && e.target.id === 'mp-q'){ e.preventDefault(); if (sel < 0 && pool.length) choose(0); add(); }
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.target.id === 'mp-q' && pool.length){
      e.preventDefault();
      choose(Math.max(0, Math.min(pool.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1))));
      list.querySelector('.mp-row.on')?.scrollIntoView({ block: 'nearest' });
    }
  };
  document.addEventListener('keydown', onKey, true);
  let t = null;
  $('#mp-q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(paint, 120); });
  $('#mp-cr').addEventListener('change', paint);
  $('#mp-type').addEventListener('change', paint);
  list.addEventListener('click', e => { const r = e.target.closest('.mp-row'); if (r) choose(+r.dataset.i); });
  list.addEventListener('dblclick', e => { const r = e.target.closest('.mp-row'); if (r){ choose(+r.dataset.i); add(); } });
  back.addEventListener('click', e => {
    const b = e.target.closest('[data-mp]'); if (!b) return;
    if (b.dataset.mp === 'close') close();
    else if (b.dataset.mp === 'add') add();
    else if (b.dataset.mp === 'stat' && pool[sel]) popOutDetail(pool[sel]);
  });
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  paint();
  setTimeout(() => $('#mp-q')?.focus(), 30);
  return back;
}
