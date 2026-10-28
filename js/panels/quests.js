// ============================================================
// QUESTS — what the party is out to do, kept by the DM
// ============================================================
// "Wait, what were we doing for the duke again?" The DM keeps each quest
// here: who gave it, the reward, the steps, notes only the DM sees, and
// whether it's still on, done or failed. A quest is hidden until the DM shows
// it; then it's on every player's phone (More → Quests, or a Quests tab on a
// wide screen), and showing one, finishing one or ticking off a step pops up
// there.
//
// One synced key, a list of quests with ids, so two DM screens editing
// different quests both keep their changes. DM-authored: realtime.js refuses a
// player's push of it. Like the NPC library, the DM's notes ride along to
// every device — hidden from the players' screens, not secret from someone
// reading their browser's storage.

const SKT_QUEST_KEY = 'skt-quests-v1';
const SKT_QUEST_SEEN_KEY = 'skt-quests-seen-v1';   // this device: what's been announced

function sktQuests(){ try { const a = JSON.parse(localStorage.getItem(SKT_QUEST_KEY) || '[]'); return Array.isArray(a) ? a.filter(q => q && q.id) : []; } catch(e){ return []; } }
function _sktQuestsSave(list){
  try { localStorage.setItem(SKT_QUEST_KEY, JSON.stringify(list)); } catch(e){ if (typeof warnStorageFailure === 'function') warnStorageFailure('quests', e); }
}
function _sktQuestId(p){ return p + (typeof uid === 'function' ? uid() : Date.now().toString(36) + Math.random().toString(36).slice(2, 6)); }
function sktQuestAdd(fields){
  const q = Object.assign({ id: _sktQuestId('q'), title: '', giver: '', reward: '', summary: '', notes: '', steps: [], status: 'active', shown: false, at: Date.now() }, fields || {});
  _sktQuestsSave(sktQuests().concat([q]));
  return q;
}
function sktQuestUpdate(id, patch){
  const list = sktQuests(), q = list.find(x => x.id === id); if (!q) return null;
  Object.assign(q, typeof patch === 'function' ? patch(q) || {} : patch);
  _sktQuestsSave(list);
  return q;
}
function sktQuestRemove(id){ _sktQuestsSave(sktQuests().filter(q => q.id !== id)); }
const _sktQuestOrder = { active: 0, done: 1, failed: 2 };
function _sktQuestSort(a, b){ return (_sktQuestOrder[a.status] || 0) - (_sktQuestOrder[b.status] || 0) || (b.at || 0) - (a.at || 0); }
// What the players may see: shown quests, the DM's notes left out.
function sktQuestsForPlayers(){
  return sktQuests().filter(q => q.shown).sort(_sktQuestSort)
    .map(q => ({ id: q.id, title: q.title, giver: q.giver, reward: q.reward, summary: q.summary, steps: q.steps || [], status: q.status }));
}

// A change, here or from another device: redraw, and on a phone, say what's
// new. What's been announced is kept per device, so a reload doesn't repeat it.
function _sktQuestSeen(){ try { return JSON.parse(localStorage.getItem(SKT_QUEST_SEEN_KEY) || 'null'); } catch(e){ return null; } }
function sktQuestNews(){
  const qs = sktQuestsForPlayers(), seen = _sktQuestSeen(), now = {};
  qs.forEach(q => { now[q.id] = { s: q.status, d: (q.steps || []).filter(x => x.done).length }; });
  try { localStorage.setItem(SKT_QUEST_SEEN_KEY, JSON.stringify(now)); } catch(e){}
  if (!seen) return [];   // first time on this device: what's there is old news
  const news = [];
  qs.forEach(q => {
    const was = seen[q.id], name = q.title || 'Untitled quest';
    if (!was) news.push('New quest: ' + name);
    else if (was.s !== q.status) news.push((q.status === 'done' ? 'Quest complete: ' : q.status === 'failed' ? 'Quest failed: ' : 'Quest back on: ') + name);
    else if (now[q.id].d > was.d) news.push('Quest updated: ' + name);
  });
  return news;
}
function sktQuestsChanged(){
  try { const P = panelDefs.quests; if (P && P._body) P._render(); } catch(e){}
  try { if (typeof paOnQuests === 'function') paOnQuests(); } catch(e){}
}

// A quest as the players see it (the phone, and the DM's preview).
function sktQuestCardHtml(q){
  const steps = q.steps || [], done = steps.filter(s => s.done).length;
  const chip = q.status === 'done' ? '<span class="qst-chip done">Done</span>' : q.status === 'failed' ? '<span class="qst-chip failed">Failed</span>' : '';
  return '<div class="qst-pc st-' + esc(q.status || 'active') + '"><div class="qst-pc-h"><span class="qst-pc-t">' + esc(q.title || 'Untitled quest') + '</span>' + chip + '</div>'
    + (q.giver ? '<div class="qst-pc-g">From ' + esc(q.giver) + '</div>' : '')
    + (q.summary ? '<div class="qst-pc-s">' + esc(q.summary).replace(/\n/g, '<br>') + '</div>' : '')
    + (steps.length ? '<ul class="qst-pc-steps" aria-label="' + done + ' of ' + steps.length + ' done">' + steps.map(s => '<li class="' + (s.done ? 'done' : '') + '">' + esc(s.text || '') + '</li>').join('') + '</ul>' : '')
    + (q.reward ? '<div class="qst-pc-r"><span>Reward</span> ' + esc(q.reward) + '</div>' : '')
    + '</div>';
}
function sktQuestListHtml(qs){
  if (!qs.length) return '<div class="msg-empty">No quests yet. The DM adds them as the story unfolds.</div>';
  const on = qs.filter(q => q.status === 'active'), off = qs.filter(q => q.status !== 'active');
  return (on.length ? on.map(sktQuestCardHtml).join('') : '<div class="msg-empty">Nothing on right now.</div>')
    + (off.length ? '<details class="qst-past"><summary>Finished (' + off.length + ')</summary>' + off.map(sktQuestCardHtml).join('') + '</details>' : '');
}

// ── The DM's window ──────────────────────────────────────────────────────────
registerPanel('quests', {
  title: 'Quests', icon: '⚑',
  _view: 'active',
  _open: null,     // the quest being edited
  mount(body){ this._body = body; this._render(); },
  unmount(){ this._body = null; },
  _render(){
    const b = this._body; if (!b) return;
    // Keep the field being typed in, and where in it, across a redraw.
    const f = document.activeElement && b.contains(document.activeElement) ? document.activeElement : null;
    const fk = f && (f.dataset.qf ? 'qf:' + f.dataset.qf : f.dataset.qsText ? 'qs:' + f.dataset.qsText : null);
    const sel = fk && 'selectionStart' in f ? [f.selectionStart, f.selectionEnd] : null;
    const scroll = (b.querySelector('.qst-list') || {}).scrollTop || 0;
    const all = sktQuests().sort(_sktQuestSort);
    const on = all.filter(q => q.status === 'active'), off = all.filter(q => q.status !== 'active');
    if (this._open && !all.some(q => q.id === this._open)) this._open = null;
    const shown = this._view === 'active' ? on : off;
    b.innerHTML = '<div class="qst">'
      + '<div class="qst-bar"><button class="btn primary small" data-q-new>+ New quest</button>'
      + '<div class="qst-seg" role="tablist"><button role="tab" class="' + (this._view === 'active' ? 'on' : '') + '" data-q-view="active">Active (' + on.length + ')</button>'
      + '<button role="tab" class="' + (this._view !== 'active' ? 'on' : '') + '" data-q-view="past">Finished (' + off.length + ')</button></div></div>'
      + '<div class="qst-list">' + (shown.length ? shown.map(q => this._cardHtml(q)).join('')
        : '<div class="msg-empty">' + (this._view === 'active' ? 'No quests on. Add one, and show it to the players when they take it up.' : 'Nothing finished yet.') + '</div>') + '</div></div>';
    this._wire(b);
    const l = b.querySelector('.qst-list'); if (l) l.scrollTop = scroll;
    if (fk){
      const g = fk.startsWith('qf:') ? b.querySelector('.qst-card.open [data-qf="' + fk.slice(3) + '"]') : b.querySelector('[data-qs-text="' + fk.slice(3) + '"]');
      if (g){ g.focus(); if (sel) try { g.setSelectionRange(sel[0], sel[1]); } catch(e){} }
    }
  },
  _cardHtml(q){
    const steps = q.steps || [], done = steps.filter(s => s.done).length;
    const meta = [q.giver ? 'From ' + esc(q.giver) : '', steps.length ? done + '/' + steps.length + ' steps' : ''].filter(Boolean).join(' · ');
    const vis = q.shown ? '<span class="qst-vis on" title="The players see this">' + (typeof ICO === 'function' ? ICO('i-eye') : '') + 'Shown</span>'
                        : '<span class="qst-vis" title="Only you see this">' + (typeof ICO === 'function' ? ICO('i-eye-off') : '') + 'Hidden</span>';
    const head = '<button class="qst-head" data-q-toggle="' + esc(q.id) + '" aria-expanded="' + (this._open === q.id) + '"><span class="qst-title">' + esc(q.title || 'Untitled quest') + '</span>'
      + (q.status !== 'active' ? '<span class="qst-chip ' + esc(q.status) + '">' + (q.status === 'done' ? 'Done' : 'Failed') + '</span>' : '')
      + vis + (meta ? '<span class="qst-meta">' + meta + '</span>' : '') + '</button>';
    if (this._open !== q.id) return '<div class="qst-card st-' + esc(q.status) + '">' + head + '</div>';
    const fld = (k, label, ph) => '<label class="qst-f"><span>' + label + '</span><input class="input" data-qf="' + k + '" value="' + esc(q[k] || '') + '" placeholder="' + esc(ph) + '"></label>';
    return '<div class="qst-card open st-' + esc(q.status) + '" data-q="' + esc(q.id) + '">' + head + '<div class="qst-ed">'
      + fld('title', 'Quest', 'Rescue the duke’s daughter')
      + '<div class="qst-row">' + fld('giver', 'Given by', 'Duke Zalto') + fld('reward', 'Reward', '500 gp and a favour') + '</div>'
      + '<label class="qst-f"><span>What the players know</span><textarea class="input" data-qf="summary" rows="3" placeholder="What they were told, in a line or two">' + esc(q.summary || '') + '</textarea></label>'
      + '<div class="qst-f"><span>Steps</span><div class="qst-steps">' + steps.map(s =>
          '<div class="qst-step"><input type="checkbox" data-qs-done="' + esc(s.id) + '"' + (s.done ? ' checked' : '') + ' aria-label="Done">'
          + '<input class="input" data-qs-text="' + esc(s.id) + '" value="' + esc(s.text || '') + '" placeholder="Find the hidden door">'
          + '<button class="btn small" data-qs-del="' + esc(s.id) + '" title="Remove this step" aria-label="Remove this step">✕</button></div>').join('')
      + '<button class="btn small" data-qs-add>+ Add a step</button></div></div>'
      + '<label class="qst-f"><span>Only you see this</span><textarea class="input" data-qf="notes" rows="3" placeholder="Who’s really behind it, what happens if they wait">' + esc(q.notes || '') + '</textarea></label>'
      + '<div class="qst-foot"><div class="qst-seg">' + ['active', 'done', 'failed'].map(s => '<button class="' + (q.status === s ? 'on' : '') + '" data-q-status="' + s + '">' + { active: 'Active', done: 'Done', failed: 'Failed' }[s] + '</button>').join('') + '</div>'
      + '<button class="btn small' + (q.shown ? '' : ' primary') + '" data-q-shown>' + (q.shown ? 'Hide from players' : 'Show to players') + '</button>'
      + '<button class="btn small danger" data-q-del>Delete</button></div>'
      + '</div></div>';
  },
  _wire(b){
    b.querySelector('[data-q-new]').addEventListener('click', () => {
      const q = sktQuestAdd(); this._open = q.id; this._view = 'active'; this._render();
      const t = b.querySelector('.qst-card.open [data-qf="title"]'); if (t) t.focus();
    });
    b.querySelectorAll('[data-q-view]').forEach(x => x.addEventListener('click', () => { this._view = x.dataset.qView; this._render(); }));
    b.querySelectorAll('[data-q-toggle]').forEach(x => x.addEventListener('click', () => { this._open = this._open === x.dataset.qToggle ? null : x.dataset.qToggle; this._render(); }));
    const card = b.querySelector('.qst-card.open'); if (!card) return;
    const id = card.dataset.q;
    // Typing saves as it goes, without a redraw under the cursor.
    card.querySelectorAll('[data-qf]').forEach(x => x.addEventListener('input', () => {
      sktQuestUpdate(id, { [x.dataset.qf]: x.value });
      if (x.dataset.qf === 'title') card.querySelector('.qst-title').textContent = x.value || 'Untitled quest';
    }));
    const step = (sid, fn) => sktQuestUpdate(id, q => ({ steps: fn((q.steps || []).slice(), (q.steps || []).findIndex(s => s.id === sid)) }));
    card.querySelectorAll('[data-qs-text]').forEach(x => {
      x.addEventListener('input', () => step(x.dataset.qsText, (a, i) => { if (i >= 0) a[i] = Object.assign({}, a[i], { text: x.value }); return a; }));
      // Enter starts the next step.
      x.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); card.querySelector('[data-qs-add]').click(); } });
    });
    card.querySelectorAll('[data-qs-done]').forEach(x => x.addEventListener('change', () => { step(x.dataset.qsDone, (a, i) => { if (i >= 0) a[i] = Object.assign({}, a[i], { done: x.checked }); return a; }); this._render(); }));
    card.querySelectorAll('[data-qs-del]').forEach(x => x.addEventListener('click', () => { step(x.dataset.qsDel, (a, i) => { if (i >= 0) a.splice(i, 1); return a; }); this._render(); }));
    card.querySelector('[data-qs-add]').addEventListener('click', () => {
      const sid = _sktQuestId('s');
      sktQuestUpdate(id, q => ({ steps: (q.steps || []).concat([{ id: sid, text: '', done: false }]) }));
      this._render();
      const n = b.querySelector('[data-qs-text="' + sid + '"]'); if (n) n.focus();
    });
    card.querySelectorAll('[data-q-status]').forEach(x => x.addEventListener('click', () => {
      sktQuestUpdate(id, { status: x.dataset.qStatus });
      // A finished quest moves to Finished; follow it there.
      this._view = x.dataset.qStatus === 'active' ? 'active' : 'past'; this._render();
    }));
    card.querySelector('[data-q-shown]').addEventListener('click', () => {
      const q = sktQuestUpdate(id, q => ({ shown: !q.shown }));
      this._render();
      if (q && q.shown && typeof showToast === 'function') showToast('Shown to the players: ' + (q.title || 'Untitled quest'));
    });
    card.querySelector('[data-q-del]').addEventListener('click', () => {
      const q = sktQuests().find(x => x.id === id);
      const go = () => { sktQuestRemove(id); this._open = null; this._render(); };
      if (typeof showConfirm === 'function') showConfirm('Delete “' + ((q && q.title) || 'Untitled quest') + '”' + (q && q.shown ? ' from every screen' : '') + '?', { title: 'Delete quest', confirmLabel: 'Delete', danger: true }).then(ok => { if (ok) go(); });
      else go();
    });
  },
});
