// ============================================================
// FACTIONS — who the party stands well (or badly) with
// ============================================================
// The Harpers owe them; the Zhentarim want them dead; the Lords' Alliance is
// watching. The DM keeps each faction here: its standing with the party on a
// five-step scale, what the players know of it, notes only the DM sees, and a
// history of what changed it, dated by the in-game calendar. A faction is
// hidden until the DM shows it; then it's on every player's phone (More →
// Factions, or a tab on a wide screen), and a change of standing pops up.
//
// One synced key, a list of factions with ids, written only by the DM
// (realtime.js refuses a player's push). As with quests, the DM's notes ride
// along to every device, hidden from the players' screens.

const SKT_FACTION_KEY = 'skt-factions-v1';
const SKT_FACTION_SEEN_KEY = 'skt-factions-seen-v1';   // this device: what's been announced
const SKT_STANDING = ['Hostile', 'Unfriendly', 'Neutral', 'Friendly', 'Allied'];   // -2 … +2
// The five factions of the Forgotten Realms that Storm King's Thunder uses.
const SKT_FACTION_STARTERS = [
  { name: 'The Harpers', summary: 'A scattered network of spellcasters and spies who work against tyranny and the abuse of power.' },
  { name: 'The Order of the Gauntlet', summary: 'Devout and vigilant warriors who stand against evil wherever it rises.' },
  { name: 'The Emerald Enclave', summary: 'Rangers and druids who keep the balance between civilization and the wild.' },
  { name: 'The Lords’ Alliance', summary: 'A coalition of cities and their rulers, protecting the North’s settlements and trade.' },
  { name: 'The Zhentarim', summary: 'The Black Network: mercenaries and merchants who trade in influence, wealth and fear.' },
];

function sktFactions(){ try { const a = JSON.parse(localStorage.getItem(SKT_FACTION_KEY) || '[]'); return Array.isArray(a) ? a.filter(f => f && f.id) : []; } catch(e){ return []; } }
function _sktFactionsSave(list){
  try { localStorage.setItem(SKT_FACTION_KEY, JSON.stringify(list)); } catch(e){ if (typeof warnStorageFailure === 'function') warnStorageFailure('factions', e); }
}
function _sktFactionId(){ return 'f' + (typeof uid === 'function' ? uid() : Date.now().toString(36) + Math.random().toString(36).slice(2, 6)); }
function sktFactionAdd(fields){
  const f = Object.assign({ id: _sktFactionId(), name: '', summary: '', notes: '', standing: 0, shown: false, log: [], at: Date.now() }, fields || {});
  _sktFactionsSave(sktFactions().concat([f]));
  return f;
}
function sktFactionUpdate(id, patch){
  const list = sktFactions(), f = list.find(x => x.id === id); if (!f) return null;
  Object.assign(f, typeof patch === 'function' ? patch(f) || {} : patch);
  _sktFactionsSave(list);
  return f;
}
function sktFactionRemove(id){ _sktFactionsSave(sktFactions().filter(f => f.id !== id)); }
function sktStandingName(n){ return SKT_STANDING[Math.max(-2, Math.min(2, +n || 0)) + 2]; }
// Today in the campaign's calendar, for a history entry.
function _sktFactionDate(){
  try {
    if (typeof _timeHydrate !== 'function' || typeof TIME_MONTHS === 'undefined') return '';
    const t = _timeHydrate();
    return t.day + ' ' + TIME_MONTHS[t.month] + ' ' + t.year + ' DR';
  } catch(e){ return ''; }
}
// Standing up or down a step, with what happened (shown to the players with
// the faction unless marked otherwise).
function sktFactionShift(id, step, text){
  return sktFactionUpdate(id, f => {
    const to = Math.max(-2, Math.min(2, (+f.standing || 0) + step));
    const entry = { id: _sktFactionId(), at: Date.now(), date: _sktFactionDate(), from: +f.standing || 0, to, text: String(text || '').trim() };
    return { standing: to, log: (f.log || []).concat([entry]).slice(-60) };
  });
}
// What the players may see: shown factions, without the DM's notes.
function sktFactionsForPlayers(){
  return sktFactions().filter(f => f.shown).sort((a, b) => (b.standing || 0) - (a.standing || 0) || String(a.name).localeCompare(String(b.name)))
    .map(f => ({ id: f.id, name: f.name, summary: f.summary, standing: +f.standing || 0, log: (f.log || []).filter(e => !e.hidden) }));
}

// News for a phone: a faction shown, or its standing changed. What's been
// announced is kept per device, so a reload doesn't repeat it.
function sktFactionNews(){
  const fs = sktFactionsForPlayers(), now = {};
  let seen = null; try { seen = JSON.parse(localStorage.getItem(SKT_FACTION_SEEN_KEY) || 'null'); } catch(e){}
  fs.forEach(f => { now[f.id] = f.standing; });
  try { localStorage.setItem(SKT_FACTION_SEEN_KEY, JSON.stringify(now)); } catch(e){}
  if (!seen) return [];
  const news = [];
  fs.forEach(f => {
    const name = f.name || 'A faction';
    if (!(f.id in seen)) news.push(name + ': ' + sktStandingName(f.standing));
    else if (seen[f.id] !== f.standing) news.push('Standing with ' + name + (f.standing > seen[f.id] ? ' rose' : ' fell') + ' to ' + sktStandingName(f.standing));
  });
  return news;
}
function sktFactionsChanged(){
  try { const P = panelDefs.factions; if (P && P._body) P._render(); } catch(e){}
  try { if (typeof paOnFactions === 'function') paOnFactions(); } catch(e){}
}

// The five steps, the current one marked.
function sktStandingHtml(n){
  return '<span class="fac-scale" role="img" aria-label="' + sktStandingName(n) + '">' + SKT_STANDING.map((s, k) => '<i class="' + (k - 2 === n ? 'on s' + (k - 2 + 2) : '') + '" title="' + s + '"></i>').join('') + '</span>';
}
// A faction as the players see it.
function sktFactionCardHtml(f){
  const log = (f.log || []).slice(-6).reverse();
  return '<div class="fac-pc"><div class="fac-pc-h"><span class="fac-pc-t">' + esc(f.name || 'A faction') + '</span><span class="fac-st s' + (f.standing + 2) + '">' + sktStandingName(f.standing) + '</span></div>'
    + sktStandingHtml(f.standing)
    + (f.summary ? '<div class="fac-pc-s">' + esc(f.summary).replace(/\n/g, '<br>') + '</div>' : '')
    + (log.length ? '<ul class="fac-log">' + log.map(e => '<li><span class="fac-arrow ' + (e.to > e.from ? 'up' : e.to < e.from ? 'down' : '') + '">' + (e.to > e.from ? '▲' : e.to < e.from ? '▼' : '•') + '</span>'
        + '<span>' + esc(e.text || (e.to > e.from ? 'Standing rose' : e.to < e.from ? 'Standing fell' : '')) + (e.date ? ' <small>' + esc(e.date) + '</small>' : '') + '</span></li>').join('') + '</ul>' : '')
    + '</div>';
}
function sktFactionListHtml(fs){
  return fs.length ? fs.map(sktFactionCardHtml).join('') : '<div class="msg-empty">No factions yet. The DM adds them as the party meets them.</div>';
}

// ── The DM's window ──────────────────────────────────────────────────────────
registerPanel('factions', {
  title: 'Factions', icon: '⚜',
  _open: null,
  mount(body){ this._body = body; this._render(); },
  unmount(){ this._body = null; },
  _render(){
    const b = this._body; if (!b) return;
    const f0 = document.activeElement && b.contains(document.activeElement) ? document.activeElement : null;
    const fk = f0 && f0.dataset.ff ? f0.dataset.ff : f0 && f0.dataset.fWhy != null ? 'why' : null;
    const sel = fk && 'selectionStart' in f0 ? [f0.selectionStart, f0.selectionEnd] : null;
    const scroll = (b.querySelector('.fac-list') || {}).scrollTop || 0;
    const all = sktFactions().sort((x, y) => String(x.name).localeCompare(String(y.name)));
    if (this._open && !all.some(f => f.id === this._open)) this._open = null;
    b.innerHTML = '<div class="fac">'
      + '<div class="qst-bar"><button class="btn primary small" data-f-new>+ New faction</button>'
      + (all.length ? '' : '<button class="btn small" data-f-starters title="The Harpers, the Order of the Gauntlet, the Emerald Enclave, the Lords’ Alliance and the Zhentarim">Add the five Realms factions</button>') + '</div>'
      + '<div class="fac-list">' + (all.length ? all.map(f => this._cardHtml(f)).join('') : emptyState({ icon: 'i-crest', title: 'No factions yet', hint: 'Add the ones the party has met, and show each to the players when they know of it.', roomy: true })) + '</div></div>';
    this._wire(b);
    const l = b.querySelector('.fac-list'); if (l) l.scrollTop = scroll;
    if (fk){
      const g = fk === 'why' ? b.querySelector('.qst-card.open [data-f-why]') : b.querySelector('.qst-card.open [data-ff="' + fk + '"]');
      if (g){ g.focus(); if (sel) try { g.setSelectionRange(sel[0], sel[1]); } catch(e){} }
    }
  },
  _cardHtml(f){
    const st = +f.standing || 0;
    const vis = f.shown ? '<span class="qst-vis on" title="The players see this">' + (typeof ICO === 'function' ? ICO('i-eye') : '') + 'Shown</span>'
                        : '<span class="qst-vis" title="Only you see this">' + (typeof ICO === 'function' ? ICO('i-eye-off') : '') + 'Hidden</span>';
    const head = '<button class="qst-head" data-f-toggle="' + esc(f.id) + '" aria-expanded="' + (this._open === f.id) + '"><span class="qst-title">' + esc(f.name || 'Unnamed faction') + '</span>'
      + '<span class="fac-st s' + (st + 2) + '">' + sktStandingName(st) + '</span>' + vis + '</button>';
    if (this._open !== f.id) return '<div class="qst-card">' + head + '</div>';
    const log = (f.log || []).slice().reverse();
    return '<div class="qst-card open" data-f="' + esc(f.id) + '">' + head + '<div class="qst-ed">'
      + '<label class="qst-f"><span>Faction</span><input class="input" data-ff="name" value="' + esc(f.name || '') + '" placeholder="The Harpers"></label>'
      + '<div class="qst-f"><span>Standing with the party</span><div class="fac-shift">'
      + '<button class="btn small" data-f-shift="-1"' + (st <= -2 ? ' disabled' : '') + ' title="Standing falls a step">▼</button>'
      + '<span class="fac-now">' + sktStandingHtml(st) + '<b class="fac-st s' + (st + 2) + '">' + sktStandingName(st) + '</b></span>'
      + '<button class="btn small" data-f-shift="1"' + (st >= 2 ? ' disabled' : '') + ' title="Standing rises a step">▲</button></div>'
      + '<input class="input" data-f-why placeholder="What happened? (goes in the history with the change)"></div>'
      + '<label class="qst-f"><span>What the players know</span><textarea class="input" data-ff="summary" rows="2" placeholder="Who they are, in a line or two">' + esc(f.summary || '') + '</textarea></label>'
      + '<label class="qst-f"><span>Only you see this</span><textarea class="input" data-ff="notes" rows="2" placeholder="Their agent in town, what they really want">' + esc(f.notes || '') + '</textarea></label>'
      + (log.length ? '<div class="qst-f"><span>History</span><ul class="fac-log">' + log.map(e => '<li><span class="fac-arrow ' + (e.to > e.from ? 'up' : e.to < e.from ? 'down' : '') + '">' + (e.to > e.from ? '▲' : e.to < e.from ? '▼' : '•') + '</span><span>'
          + esc(e.text || '') + ' <small>' + esc(sktStandingName(e.from)) + ' → ' + esc(sktStandingName(e.to)) + (e.date ? ' · ' + esc(e.date) : '') + '</small></span>'
          + '<button class="btn small" data-f-logdel="' + esc(e.id) + '" title="Remove from the history" aria-label="Remove from the history">✕</button></li>').join('') + '</ul></div>' : '')
      + '<div class="qst-foot"><button class="btn small' + (f.shown ? '' : ' primary') + '" data-f-shown>' + (f.shown ? 'Hide from players' : 'Show to players') + '</button>'
      + '<button class="btn small danger" data-f-del>Delete</button></div>'
      + '</div></div>';
  },
  _wire(b){
    b.querySelector('[data-f-new]').addEventListener('click', () => {
      const f = sktFactionAdd(); this._open = f.id; this._render();
      const t = b.querySelector('.qst-card.open [data-ff="name"]'); if (t) t.focus();
    });
    b.querySelector('[data-f-starters]')?.addEventListener('click', () => {
      SKT_FACTION_STARTERS.forEach(x => sktFactionAdd(Object.assign({}, x)));
      this._render();
    });
    b.querySelectorAll('[data-f-toggle]').forEach(x => x.addEventListener('click', () => { this._open = this._open === x.dataset.fToggle ? null : x.dataset.fToggle; this._render(); }));
    const card = b.querySelector('.qst-card.open'); if (!card) return;
    const id = card.dataset.f;
    card.querySelectorAll('[data-ff]').forEach(x => x.addEventListener('input', () => {
      sktFactionUpdate(id, { [x.dataset.ff]: x.value });
      if (x.dataset.ff === 'name') card.querySelector('.qst-title').textContent = x.value || 'Unnamed faction';
    }));
    const why = card.querySelector('[data-f-why]');
    card.querySelectorAll('[data-f-shift]').forEach(x => x.addEventListener('click', () => {
      sktFactionShift(id, +x.dataset.fShift, why.value);
      this._render();
    }));
    card.querySelectorAll('[data-f-logdel]').forEach(x => x.addEventListener('click', () => {
      sktFactionUpdate(id, f => ({ log: (f.log || []).filter(e => e.id !== x.dataset.fLogdel) }));
      this._render();
    }));
    card.querySelector('[data-f-shown]').addEventListener('click', () => {
      const f = sktFactionUpdate(id, f => ({ shown: !f.shown }));
      this._render();
      if (f && f.shown && typeof showToast === 'function') showToast('Shown to the players: ' + (f.name || 'the faction'));
    });
    card.querySelector('[data-f-del]').addEventListener('click', () => {
      const f = sktFactions().find(x => x.id === id);
      const go = () => { sktFactionRemove(id); this._open = null; this._render(); };
      if (typeof showConfirm === 'function') showConfirm('Delete “' + ((f && f.name) || 'this faction') + '”' + (f && f.shown ? ' from every screen' : '') + '?', { title: 'Delete faction', confirmLabel: 'Delete', danger: true }).then(ok => { if (ok) go(); });
      else go();
    });
  },
});
