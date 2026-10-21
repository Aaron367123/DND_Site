// ============================================================
// ROLL REQUESTS — "Everyone, roll…" from the DM to the players' phones
// ============================================================
// One system for everything the DM asks the table to roll at once. There
// used to be two near-identical ones — initiative and saving throws, each
// with its own synced key, pop-up and code — and a third was about to be
// written for group checks. Now:
//
//   'skt-rollreq-v1' = { id, askedAt, kind, ab, skill, dc, showDc, name,
//                        via, pcs:[ids], answers:{ pcId:{ v, done, rid, at } },
//                        closed }
//   kind  'init'  — initiative; answers also set the combatant's initiative
//         'save'  — a saving throw (ab, dc, showDc)
//         'check' — an ability or skill check (ab, skill, dc, showDc)
//         'rest'  — a short rest: each phone spends its own hit dice, then
//                   answers done; the DM finishes it for whoever didn't
//   via   'area'  — asked from the area-save dialog, which shows the answers
//                   itself, so the results card stays out of the way
//
// One field per character in `answers`, so two phones answering at the same
// moment merge rather than one overwriting the other. Answers carry the
// request id, so a late answer to an earlier request never counts against
// this one.
//
// On the DM's screen: an "Ask the players to roll…" dialog, and one results
// card that fills in as answers land. On a phone: one pop-up (player-app.js).

const SKT_RR_KEY = 'skt-rollreq-v1';
const SKT_RR_FRESH = 20 * 60 * 1000;   // an older request is stale and doesn't pop up
const SKT_RR_ABS = { STR: 'Strength', DEX: 'Dexterity', CON: 'Constitution', INT: 'Intelligence', WIS: 'Wisdom', CHA: 'Charisma' };

function sktRollReq(){ try { return JSON.parse(localStorage.getItem(SKT_RR_KEY) || 'null'); } catch(e){ return null; } }
function sktRollOpen(){ const r = sktRollReq(); return r && !r.closed && Array.isArray(r.pcs) ? r : null; }

// What the request is called, on the phone and on the card.
function sktRollTitle(r){
  if (!r) return '';
  if (r.kind === 'init') return 'Initiative';
  if (r.kind === 'rest') return 'Short rest';
  if (r.kind === 'save') return (SKT_RR_ABS[r.ab] || r.ab) + ' saving throw';
  if (r.skill && typeof SKT_SKILL_LABEL !== 'undefined') return (SKT_SKILL_LABEL[r.skill] || r.skill) + ' check';
  return (SKT_RR_ABS[r.ab] || r.ab || 'Ability') + ' check';
}

// Ask. opts: { kind, ab, skill, dc, showDc, name, via, pcs }
function sktAskRoll(opts){
  opts = opts || {};
  const pcs = (opts.pcs || []).filter(Boolean);
  const say = m => { if (typeof showToast === 'function') showToast(m); };
  if (!pcs.length){ say(opts.kind === 'init' ? 'No characters in the fight to ask' : 'No one to ask'); return null; }
  const r = {
    id: 'rr_' + (typeof uid === 'function' ? uid() : Date.now().toString(36)),
    askedAt: Date.now(), kind: opts.kind || 'check',
    ab: opts.ab ? String(opts.ab).slice(0, 3).toUpperCase() : '',
    skill: opts.skill || '', dc: opts.dc ? Math.max(1, parseInt(opts.dc, 10) || 10) : null,
    showDc: opts.showDc !== false && !!opts.dc, name: opts.name || '', via: opts.via || '',
    pcs, answers: {}, closed: false,
  };
  saveJson(SKT_RR_KEY, r, 'roll request');
  _sktRrApplied = {}; _sktRrAllToasted = null;
  say('📱 Asked ' + pcs.length + ' player' + (pcs.length === 1 ? '' : 's') + ' — ' + sktRollTitle(r)
      + (r.showDc ? ' (DC ' + r.dc + ' shown)' : ''));
  sktRollCardPaint();
  return r;
}

function sktCloseRoll(){
  const r = sktRollReq(); if (!r || r.closed) return;
  r.closed = true;
  saveJson(SKT_RR_KEY, r, 'roll request');
  sktRollCardPaint();
}

// Who has answered this request, and who is still to.
function sktRollStatus(){
  const r = sktRollOpen(); if (!r) return null;
  const ans = r.answers || {};
  const inIds = r.pcs.filter(id => ans[id] && ans[id].rid === r.id);
  return { r, inIds, waiting: r.pcs.filter(id => !inIds.includes(id)) };
}
function _sktRrName(id){
  const p = (state.party || []).find(x => x.id === id) || (state.combatants || []).find(x => x.id === id);
  return p ? p.name : 'Someone';
}

// ── Answers landing on the DM's screen ───────────────────────────────────────
let _sktRrApplied = {}, _sktRrAllToasted = null;
function sktOnRollAnswers(){
  if (document.body.classList.contains('player-mode')) return;
  const st = sktRollStatus();
  if (st){
    const C = (typeof panelDefs !== 'undefined') && panelDefs.combat;
    // Initiative goes onto the combatants, once per answer, so a number the
    // DM corrects by hand isn't overwritten by the next update.
    if (st.r.kind === 'init' && C){
      let changed = false;
      st.inIds.forEach(id => {
        const k = id + '|' + st.r.id; if (_sktRrApplied[k]) return;
        _sktRrApplied[k] = true;
        const a = st.r.answers[id], c = state.combatants.find(x => x.id === id);
        if (c && +c.initiative !== +a.v){ c.initiative = +a.v; changed = true; }
        if (typeof C._log === 'function') C._log((c ? c.name : 'A player') + ' rolled initiative: ' + a.v);
      });
      if (changed) save();
      if (!st.waiting.length && _sktRrAllToasted !== st.r.id){
        _sktRrAllToasted = st.r.id;
        if (typeof showToast === 'function') showToast('📱 Everyone has rolled initiative',
          { action: { label: 'Sort', run: () => { C._sortByInitiative(); sktCloseRoll(); } } });
      }
      try { C._render(); } catch(e){}
    }
    // A save asked from the area dialog: the dialog fills in its rows.
    if (st.r.kind === 'save' && C && typeof C._areaSaveOnAnswers === 'function'){
      try { C._areaSaveOnAnswers(st.r); } catch(e){ console.warn('[roll answers]', e); }
    }
  }
  sktRollCardPaint();
}

// ── The results card ─────────────────────────────────────────────────────────
// One card, bottom right, for whatever is being waited on. Not for a save
// asked from the area dialog, which shows the answers in its own table.
function sktRollCardPaint(){
  if (document.body.classList.contains('player-mode')) return;
  const st = sktRollStatus();
  let el = document.getElementById('rr-card');
  if (!st || st.r.via === 'area'){ if (el) el.remove(); return; }
  if (!el){
    el = document.createElement('div');
    el.id = 'rr-card'; el.className = 'rr-card'; el.setAttribute('role', 'status');
    document.body.appendChild(el);
    el.addEventListener('click', _sktRrClick);
  }
  const r = st.r, all = !st.waiting.length;
  const row = id => {
    const a = (r.answers || {})[id];
    const got = a && a.rid === r.id;
    let val = '';
    if (got) val = r.kind === 'rest' ? '✓ done' : String(a.v);
    const pass = got && r.dc && r.kind !== 'init' && r.kind !== 'rest' ? (+a.v >= r.dc) : null;
    return '<div class="rr-row' + (got ? ' in' : '') + (pass === true ? ' ok' : pass === false ? ' bad' : '') + '">'
      + '<span>' + esc(_sktRrName(id)) + '</span><b>' + (got ? esc(val) + (pass === true ? ' ✓' : pass === false ? ' ✗' : '') : '<i>' + (r.kind === 'rest' ? 'resting…' : 'waiting…') + '</i>') + '</b></div>';
  };
  const actions = r.kind === 'init'
    ? '<button class="btn small' + (all ? ' primary' : '') + '" data-rr="sort">Sort by initiative</button>'
    : r.kind === 'rest'
      ? '<button class="btn small' + (all ? ' primary' : '') + '" data-rr="finish" title="Finish the short rest for everyone — anyone who hasn’t finished on their phone gets the rest without spending dice">Finish the rest</button>'
      : '';
  el.innerHTML = '<div class="rr-head"><b>📱 ' + esc(sktRollTitle(r)) + '</b>'
    + (r.dc && r.kind !== 'init' && r.kind !== 'rest' ? '<span class="rr-dc">DC ' + r.dc + '</span>' : '')
    + '<span class="rr-count">' + st.inIds.length + ' of ' + r.pcs.length + '</span>'
    + '<button class="rr-x" data-rr="close" aria-label="Close" title="Stop waiting — phones that haven’t answered drop the pop-up">✕</button></div>'
    + '<div class="rr-rows">' + r.pcs.map(row).join('') + '</div>'
    + (actions ? '<div class="rr-acts">' + actions + '</div>' : '');
  el.classList.toggle('done', all);
}
function _sktRrClick(e){
  const b = e.target.closest('[data-rr]'); if (!b) return;
  const k = b.dataset.rr, r = sktRollOpen();
  if (k === 'close') return sktCloseRoll();
  if (k === 'sort'){
    const C = panelDefs.combat;
    if (C && typeof C._sortByInitiative === 'function') C._sortByInitiative();
    return sktCloseRoll();
  }
  if (k === 'finish' && r && panelDefs.party && typeof panelDefs.party._finishShortRest === 'function'){
    panelDefs.party._finishShortRest(r);
  }
}

// ── "Ask the players to roll…" ───────────────────────────────────────────────
// preset: { kind, ab, skill, dc, pcs }
function sktOpenAskRoll(preset){
  preset = preset || {};
  document.getElementById('rr-ask-back')?.remove();
  const fighting = (state.combatants || []).some(c => c.isPC);
  const party = (state.party || []).filter(p => p && !p.foe);
  let kind = preset.kind || (fighting && !(state.combatants || []).some(c => +c.initiative) ? 'init' : 'check');
  const skills = typeof SKT_SKILLS !== 'undefined' ? Object.keys(SKT_SKILLS) : [];
  const pickWho = k => k === 'init'
    ? (state.combatants || []).filter(c => c.isPC && !c.dead).map(c => c.id)
    : party.map(p => p.id);
  const back = document.createElement('div');
  back.className = 'modal-backdrop'; back.id = 'rr-ask-back';
  const paint = () => {
    const who = pickWho(kind);
    const people = kind === 'init' ? (state.combatants || []).filter(c => c.isPC && !c.dead) : party;
    back.innerHTML = '<div class="modal rr-ask" role="dialog" aria-modal="true" aria-label="Ask the players to roll">'
      + '<h3>📱 Ask the players to roll</h3>'
      + '<div class="rr-kinds">' + [['init', 'Initiative'], ['save', 'Saving throw'], ['check', 'Ability or skill check']]
          .map(([k, l]) => '<button class="' + (kind === k ? 'on' : '') + '" data-rk="' + k + '"' + (k === 'init' && !fighting ? ' disabled title="Nobody is in a fight"' : '') + '>' + l + '</button>').join('') + '</div>'
      + (kind === 'save' || kind === 'check'
        ? '<div class="rr-row2"><label>Ability <select id="rr-ab">' + Object.keys(SKT_RR_ABS).map(a => '<option' + ((preset.ab || 'DEX') === a ? ' selected' : '') + '>' + a + '</option>').join('') + '</select></label>'
          + (kind === 'check' ? '<label>Skill <select id="rr-skill"><option value="">— just the ability —</option>' + skills.map(k => '<option value="' + k + '"' + (preset.skill === k ? ' selected' : '') + '>' + (SKT_SKILL_LABEL[k] || k) + '</option>').join('') + '</select></label>' : '')
          + '<label>DC <input id="rr-dc" type="number" min="1" placeholder="—" value="' + (preset.dc || '') + '"></label></div>'
          + '<label class="as-showdc"><input type="checkbox" id="rr-showdc"' + (((state.settings || {}).saveShowDc !== false) ? ' checked' : '') + '> tell them the DC</label>'
        : '')
      + '<div class="rr-who"><b>Who</b>' + (people.length ? people.map(p => '<label><input type="checkbox" value="' + esc(p.id) + '" checked> ' + esc(p.name) + '</label>').join('') : '<span class="dim">No one to ask.</span>') + '</div>'
      + '<div class="modal-actions"><button class="btn" data-rr-go="cancel">Cancel</button><button class="btn primary" data-rr-go="ask"' + (who.length ? '' : ' disabled') + '>Ask</button></div></div>';
  };
  paint();
  document.body.appendChild(back);
  // A skill picked means a check of that skill's ability.
  back.addEventListener('change', e => {
    if (e.target.id === 'rr-skill' && e.target.value && typeof SKT_SKILLS !== 'undefined'){
      const ab = back.querySelector('#rr-ab'); if (ab) ab.value = SKT_SKILLS[e.target.value].toUpperCase();
    }
  });
  back.addEventListener('click', e => {
    const k = e.target.closest('[data-rk]');
    if (k && !k.disabled){ kind = k.dataset.rk; paint(); return; }
    const g = e.target.closest('[data-rr-go]'); if (!g) return;
    if (g.dataset.rrGo === 'cancel'){ back.remove(); return; }
    const pcs = [...back.querySelectorAll('.rr-who input:checked')].map(i => i.value);
    const dcEl = back.querySelector('#rr-dc'), sd = back.querySelector('#rr-showdc');
    if (sd && state.settings){ state.settings.saveShowDc = sd.checked; save(); }
    const req = sktAskRoll({ kind, pcs,
      ab: (back.querySelector('#rr-ab') || {}).value || '', skill: (back.querySelector('#rr-skill') || {}).value || '',
      dc: dcEl && dcEl.value ? +dcEl.value : null, showDc: sd ? sd.checked : true });
    if (req) back.remove();
  });
  back.addEventListener('mousedown', e => { if (e.target === back) back.remove(); });
}
