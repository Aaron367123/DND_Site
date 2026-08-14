// ============================================================
// PLAYER APP — the player's own surface, not the DM's with bits removed
// ============================================================
// The old player view was the DM workspace with panels subtracted: floating
// draggable windows, DM tools with the DM parts hidden, and sharing measured
// in panels. Most of its machinery existed to fight that mismatch — an
// at-most-one-panel invariant on phones, a rotate-back ratchet, a placement
// bug that opened the Combat Tracker 77% underneath the battle map.
//
// This replaces it with one screen and a tab bar. Three things follow from
// that and are worth stating up front:
//
//  1. IT KNOWS WHO YOU ARE. You pick your character once. That is the change
//     everything else hangs off — "your turn" instead of "Ogre's turn", your
//     own HP as the home screen, your death saves when you are down.
//  2. YOUR CHARACTER IS ALWAYS THERE. It needs no sharing from the DM,
//     because it is yours. Only the shared tabs wait on them.
//  3. READ-ONLY BY CONSTRUCTION. These are the player's own renderers, so
//     there was never a mutating control to remember to hide — which is how
//     a player ended up with HP steppers and a map Rotate button before.
//
// The DM's sharing control is unchanged: the 👁 on a window title bar still
// writes state.sharedPanels. It is simply read here as "what information may
// this player see" rather than "which windows may they open".

const PA_ME_KEY = 'skt-me-v1';

// Which PC this browser is. Stored beside the existing presence identity
// rather than in a new key, because it IS the same answer to a slightly
// bigger question — the app already knew "which browser", now it knows
// "which character".
function paMe(){
  try { return JSON.parse(localStorage.getItem(PA_ME_KEY) || 'null') || {}; }
  catch(e){ return {}; }
}
function paSetPc(id){
  const me = paMe();
  me.pcId = id;
  if (!me.id) me.id = 'u_' + (typeof uid === 'function' ? uid() : Math.random().toString(36).slice(2));
  const pc = (state.party || []).find(p => p.id === id);
  if (pc) me.name = pc.name;
  try { localStorage.setItem(PA_ME_KEY, JSON.stringify(me)); } catch(e){}
}
function paPc(){
  const id = paMe().pcId;
  return id ? (state.party || []).find(p => p.id === id) || null : null;
}
// The combatant slot for your character, when the fight includes you.
function paCombatant(){
  const pc = paPc();
  return pc ? (state.combatants || []).find(c => c.isPC && c.id === pc.id) || null : null;
}

const paShared = () => new Set(state.sharedPanels || []);
const paEsc = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s));

// Monster numbers follow the DM's own show / conceal / hide setting, read
// through the Combat Tracker so a second surface can't disagree with the
// first about what has been hidden.
function paStatsMode(){
  const C = panelDefs.combat;
  return (C && typeof C._statsMode === 'function') ? C._statsMode() : 'show';
}
function paHpText(c){
  if (c.isPC || paStatsMode() === 'show') return `${c.hp}/${c.hpMax}`;
  if (paStatsMode() === 'conceal'){
    const C = panelDefs.combat;
    return (C && typeof C._hpTier === 'function') ? C._hpTier(c) : '';
  }
  return '';
}

// ─── Shell ───────────────────────────────────────────────────────────────────
// Tabs are gated by what the DM has shared, except "You", which is yours.
const PA_TABS = [
  { id:'you',   label:'You',   icon:'i-heart',  always:true },
  { id:'map',   label:'Map',   icon:'i-map',    needs:'battlemap' },
  { id:'party', label:'Party', icon:'i-user',   needs:'party' },
  { id:'notes', label:'Notes', icon:'i-note',   needs:'notes' },
];
let paTab = 'you';

function paVisibleTabs(){
  const sh = paShared();
  return PA_TABS.filter(t => t.always || sh.has(t.needs));
}

function initPlayerApp(){
  const app = document.getElementById('app');
  if (!app) return;
  document.body.classList.add('player-app');
  // Keep the floating toolbar: search is genuinely useful to a player looking
  // up a spell mid-turn, and settings carries the font-scale slider.
  const keep = document.getElementById('float-toolbar');
  app.innerHTML = '';
  if (keep) app.appendChild(keep);
  const shell = document.createElement('div');
  shell.className = 'pa';
  shell.innerHTML = `
    <div class="pa-turn" id="pa-turn"></div>
    <div class="pa-prompt" id="pa-prompt" hidden></div>
    <main class="pa-screen" id="pa-screen"></main>
    <nav class="pa-tabs" id="pa-tabs"></nav>`;
  app.appendChild(shell);

  shell.addEventListener('click', paOnClick);
  shell.addEventListener('change', paOnChange);
  paRender();
}

// One entry point for every redraw, called by realtime and by local edits.
// Cheap enough to run whole: the player screen is one column of small parts.
function paRender(){
  if (!document.body.classList.contains('player-app')) return;
  const tabs = paVisibleTabs();
  if (!tabs.some(t => t.id === paTab)) paTab = 'you';
  paRenderTurn();
  paRenderPrompt();
  paRenderTabs(tabs);
  paRenderScreen();
}

// ─── The reaction prompt ─────────────────────────────────────────────────────
// The one thing this app can do that a shared screen can't: the DM swings, and
// the question "do you want to spend your reaction?" arrives on the phone of
// the person whose reaction it is, with the cost and the effect already worked
// out. They answer; the DM's screen applies it.
//
// It takes over the screen deliberately. This is the one moment in a fight
// where the table is waiting on THIS player, and a chip somewhere would be
// missed.
const PA_PROMPT_MAX_AGE = 5 * 60 * 1000;

function paMyOffers(){
  const p = state.prompt;
  const meId = paMe().pcId;
  if (!p || !meId || p.answer) return null;
  // A prompt whose DM has gone away must not sit on a phone forever.
  if (p.ts && Date.now() - p.ts > PA_PROMPT_MAX_AGE) return null;
  const mine = (p.offers || []).filter(o => o.pcId === meId);
  return mine.length ? { p, mine } : null;
}

function paRenderPrompt(){
  const host = document.getElementById('pa-prompt');
  if (!host) return;
  const got = paMyOffers();
  if (!got || paDismissed === (state.prompt && state.prompt.id)){ host.innerHTML = ''; host.hidden = true; return; }
  const { p, mine } = got;
  const others = (p.offers || []).map(o => o.who).filter((v, i, a) => a.indexOf(v) === i && v !== mine[0].who);
  host.hidden = false;
  host.innerHTML = `<div class="pa-prompt-in">
    <div class="pa-prompt-what">
      <span class="pa-prompt-l">Reaction?</span>
      <span class="pa-prompt-line"><b>${paEsc(p.attacker)}</b>'s ${paEsc(p.label)}
        ${p.target.name ? `hits <b>${paEsc(p.target.name)}</b>` : ''}
        for <b>${p.dmg} ${paEsc(p.type || 'damage')}</b></span>
    </div>
    ${mine.map((o, i) => `
      <button class="pa-prompt-b" data-pa-react="${i}">
        <span class="pa-prompt-n">${paEsc(o.name)}</span>
        ${o.preview ? `<span class="pa-prompt-p">${paEsc(o.preview)}</span>` : ''}
        ${o.cost ? `<span class="pa-prompt-c">${paEsc(o.cost)}</span>` : ''}
        ${o.ft ? `<span class="pa-prompt-c">${o.ft} ft away</span>` : ''}
      </button>`).join('')}
    <button class="pa-prompt-pass" data-pa-pass="1">Pass</button>
    ${others.length ? `<div class="pa-prompt-else">${paEsc(others.join(' and '))} can also answer —
      whoever gets there first resolves it.</div>` : ''}
  </div>`;
}

// Passing hides it here only. Somebody else may still want to answer, so it
// would be wrong for one player's "no" to take the question off everyone.
let paDismissed = null;

function paAnswerPrompt(i){
  const got = paMyOffers(); if (!got) return;
  const o = got.mine[i]; if (!o) return;
  // First write wins. If two phones answer at once one of them loses the
  // race, which is the same thing that happens when two people shout.
  state.prompt = { ...got.p, answer: { pcId:o.pcId, who:o.who, key:o.key, at: Date.now() } };
  save();
  const box = document.getElementById('pa-prompt');
  if (box) box.innerHTML = `<div class="pa-prompt-in sent">
    <span class="pa-prompt-l">Sent</span>
    <span class="pa-prompt-line">${paEsc(o.name)} — over to the DM.</span></div>`;
}

function paRenderTabs(tabs){
  const el = document.getElementById('pa-tabs'); if (!el) return;
  el.innerHTML = tabs.map(t =>
    `<button class="pa-tab ${t.id === paTab ? 'on' : ''}" data-pa-tab="${t.id}">
       ${typeof ICO === 'function' ? ICO(t.icon) : ''}<span>${t.label}</span>
     </button>`).join('');
}

// ─── The turn strip ──────────────────────────────────────────────────────────
// Whose turn it is and how many until yours — the question a player asks all
// evening. Only when the DM has shared the order.
function paRenderTurn(){
  const el = document.getElementById('pa-turn'); if (!el) return;
  const list = state.combatants || [];
  if (!paShared().has('combat') || !list.length){ el.innerHTML = ''; el.hidden = true; return; }
  el.hidden = false;
  const meC = paCombatant();
  const activeId = state.activeCombatantId;
  const i = list.findIndex(c => c.id === activeId);
  const cur = list[i] || list[0];
  const mine = !!(meC && cur && cur.id === meC.id);
  // Turns until yours, counting round the order — the number a player is
  // actually computing in their head while they wait.
  let until = null;
  if (meC && !mine && i >= 0){
    const j = list.findIndex(c => c.id === meC.id);
    if (j >= 0) until = (j - i + list.length) % list.length;
  }
  const pips = list.map(c => {
    const hp = paHpText(c);
    const isMe = !!(meC && c.id === meC.id);
    return `<span class="pa-pip${c.id === activeId ? ' cur' : ''}${(c.hp || 0) <= 0 ? ' down' : ''}${isMe ? ' me' : ''}${c.isPC ? ' pc' : ''}">`
      + `<b>${paEsc(c.name)}</b>${hp ? `<i>${paEsc(hp)}</i>` : ''}</span>`;
  }).join('');
  el.innerHTML = `
    <div class="pa-turn-head">
      <span class="pa-round">Round ${state.combatRound || 1}</span>
      ${mine
        ? `<span class="pa-now mine">Your turn</span>`
        : `<span class="pa-now"><b>${paEsc(cur ? cur.name : '—')}</b>'s turn</span>`}
      ${until != null && until > 0 ? `<span class="pa-until">${until} turn${until === 1 ? '' : 's'} until you</span>` : ''}
    </div>
    <div class="pa-strip">${pips}</div>`;
}

// ─── Screens ─────────────────────────────────────────────────────────────────
function paRenderScreen(){
  const el = document.getElementById('pa-screen'); if (!el) return;
  // Panels that are mounted into the screen keep their DOM between renders —
  // remounting the battle map on every HP tick would throw away its scroll,
  // its zoom and its canvases.
  const mount = el.querySelector('.pa-mount');
  if (mount && mount.dataset.paMount === paTab){
    paRefreshMount(paTab);
    if (paTab === 'map' && !el.querySelector('.pa-draw')) paAddDrawBar(el);
    return;
  }
  el.innerHTML = '';
  if (paTab === 'you')   { el.innerHTML = paYouScreen(); return; }
  if (paTab === 'party') { el.innerHTML = paPartyScreen(); return; }
  if (paTab === 'map' || paTab === 'notes') { paMountPanel(el, paTab === 'map' ? 'battlemap' : 'notes'); return; }
}

// The map and the notes are the DM panels, mounted whole. Not rewritten:
// the map carries fog, the background image, rotation, scale and its own live
// sync, and a second renderer would be a second set of those to keep right.
// Its editing toolbar is hidden by CSS in this shell — see .pa-mount rules.
function paMountPanel(host, id){
  const def = panelDefs[id];
  const box = document.createElement('div');
  box.className = 'pa-mount';
  box.dataset.paMount = paTab;
  host.appendChild(box);
  if (!def){ box.innerHTML = '<div class="pa-empty">Not available.</div>'; return; }
  try { def.mount(box); } catch(e){ box.innerHTML = '<div class="pa-empty">Could not load.</div>'; }
  if (id === 'battlemap') paAddDrawBar(host);
}

// ─── Drawing on the map ──────────────────────────────────────────────────────
// Players draw on the map — marking a route, circling the thing they want to
// investigate, sketching the room as they picture it. That is table
// conversation, not DM authority, so it stays.
//
// It is a small bar of our own rather than the DM's toolbar unhidden, because
// that toolbar also carries rotate, scale, fog, grid alignment and the token
// controls. Three buttons, driven by the panel's own actions so the drawing,
// the undo stack and the sync are all the ones that already work.
const PA_DRAW = [
  { act:'tool-draw',  icon:'i-pencil', label:'Draw',  tool:'draw'  },
  { act:'tool-erase', icon:'i-trash',  label:'Erase', tool:'erase' },
  { act:'undo',       icon:'i-undo',   label:'Undo'                },
];
function paAddDrawBar(host){
  const B = panelDefs.battlemap;
  const bar = document.createElement('div');
  bar.className = 'pa-draw';
  bar.innerHTML = PA_DRAW.map(d =>
    `<button class="pa-draw-b ${d.tool && B && B._tool === d.tool ? 'on' : ''}" data-pa-draw="${d.act}">
       ${typeof ICO === 'function' ? ICO(d.icon) : ''}<span>${d.label}</span>
     </button>`).join('');
  host.appendChild(bar);
}
function paDraw(act){
  const B = panelDefs.battlemap; if (!B) return;
  // Straight through the panel's own toolbar handler, so a player's stroke is
  // the same object the DM's is and lands in the same undo stack.
  const btn = document.querySelector('.pa-mount [data-mact="' + act + '"]');
  if (btn){ btn.click(); }
  else if (act.startsWith('tool-')){
    const t = act.slice(5);
    B._tool = B._tool === t ? '' : t;
    try { B._render(); } catch(e){}
  } else if (typeof B._undo === 'function'){ try { B._undo(); } catch(e){} }
  // The panel re-rendered its own DOM; put our bar back on top of it.
  const host = document.getElementById('pa-screen');
  const old = host && host.querySelector('.pa-draw');
  if (old) old.remove();
  if (host) paAddDrawBar(host);
}
function paRefreshMount(tab){
  const id = tab === 'map' ? 'battlemap' : tab === 'notes' ? 'notes' : null;
  if (!id) return;
  const def = panelDefs[id];
  try { def && def._render && def._render(); } catch(e){}
}

// ─── You ─────────────────────────────────────────────────────────────────────
function paYouScreen(){
  const pc = paPc();
  if (!pc) return paPickerScreen();
  const c = paCombatant();
  const hp = c ? c.hp : pc.hp, hpMax = c ? c.hpMax : pc.hpMax;
  const pct = hpMax ? Math.max(0, (hp / hpMax) * 100) : 0;
  const col = pct <= 0 ? '#5a3a3a' : pct < 35 ? 'var(--danger)' : pct < 75 ? 'var(--warning)' : 'var(--success)';
  const conds = (c && c.conditions || []).map(x => `<span class="pa-cond">${paEsc(x)}</span>`).join('');
  const down = !!(c && c.isPC && (c.hp || 0) <= 0 && !c.dead && !c.stable);

  const res = (pc.resources || []).map(r => {
    const max = Math.max(0, Math.min(24, r.max || 0));
    let pips = '';
    for (let i = 0; i < max; i++) pips += `<span class="pa-res-pip ${i < r.current ? '' : 'off'}"></span>`;
    return `<div class="pa-res"><span class="pa-res-n">${paEsc(r.name)}</span>
      <span class="pa-res-pips">${pips}</span>
      <span class="pa-res-c">${r.current}/${r.max}</span></div>`;
  }).join('');

  const slots = pc.sheet && pc.sheet.spellSlots ? Object.keys(pc.sheet.spellSlots)
    .map(n => parseInt(n)).filter(n => n >= 1).sort((a, b) => a - b).map(l => {
      const s = pc.sheet.spellSlots[l], total = s.total || 0, left = total - (s.expended || 0);
      let pips = '';
      for (let i = 0; i < total; i++) pips += `<span class="pa-res-pip ${i < left ? '' : 'off'}"></span>`;
      return `<div class="pa-res"><span class="pa-res-n">Level ${l}</span>
        <span class="pa-res-pips">${pips}</span><span class="pa-res-c">${left}/${total}</span></div>`;
    }).join('') : '';

  const atks = (pc.sheet && Array.isArray(pc.sheet.attacks) ? pc.sheet.attacks : [])
    .filter(a => a && a.name).map((a, i) => `
      <button class="pa-atk" data-pa-atk="${i}">
        <span class="pa-atk-n">${paEsc(a.name)}</span>
        <span class="pa-atk-d">${paEsc(a.atkBonus || '')}${a.atkBonus ? ' · ' : ''}${paEsc(a.damage || '')}</span>
        ${typeof ICO === 'function' ? ICO('i-dice') : '🎲'}
      </button>`).join('');

  return `
    <div class="pa-card pa-you">
      <div class="pa-you-head">
        <div class="pa-avatar">${paEsc(String(pc.name || '?').trim().charAt(0).toUpperCase())}</div>
        <div class="pa-you-id">
          <div class="pa-you-name">${paEsc(pc.name)}</div>
          <div class="pa-you-sub">${paEsc([pc.cls, pc.subclass, pc.level ? 'level ' + pc.level : ''].filter(Boolean).join(' · ') || 'Your character')}</div>
        </div>
        <button class="pa-swap" data-pa-swap="1" title="Play a different character">Change</button>
      </div>

      <div class="pa-hp">
        <div class="pa-hp-row">
          <span class="pa-hp-n">${hp}</span><span class="pa-hp-max">/ ${hpMax}</span>
          ${pc.tempHp > 0 ? `<span class="pa-hp-temp" title="Temporary HP — absorbs damage first">+${pc.tempHp}</span>` : ''}
          <span class="pa-hp-sp"></span>
          <span class="pa-stat">AC <b>${pc.ac ?? '–'}</b></span>
          <span class="pa-stat">Speed <b>${pc.spd ?? '–'}</b></span>
        </div>
        <div class="pa-hp-bar"><i style="width:${pct}%;background:${col}"></i></div>
        <div class="pa-hp-ctl">
          <button class="btn" data-pa-hp="-1">− Damage</button>
          <input class="pa-in" id="pa-hp-amt" type="number" value="5" aria-label="Amount">
          <button class="btn" data-pa-hp="1">+ Heal</button>
        </div>
      </div>

      ${conds ? `<div class="pa-conds">${conds}</div>` : ''}
      ${down ? paDeathBlock(c) : ''}
      ${res || slots ? `<div class="pa-sec"><h4>Resources</h4>${res}${slots}</div>` : ''}
      ${atks ? `<div class="pa-sec"><h4>Attacks</h4><div class="pa-atks">${atks}</div></div>` : ''}
      <div class="pa-roll" id="pa-roll"></div>
      <button class="pa-sheet-t" data-pa-mate="${paEsc(pc.id)}">
        ${paOpenMates.has(pc.id) ? '▾ Hide full sheet' : '▸ Full sheet'}
      </button>
      ${paOpenMates.has(pc.id) ? paSheetDetail(pc) : ''}
    </div>`;
}

function paDeathBlock(c){
  const ds = c.deathSaves || { success:0, fail:0 };
  const row = kind => Array.from({ length:3 }, (_, i) =>
    `<span class="pa-ds-pip ${kind} ${(ds[kind] || 0) > i ? 'on' : ''}"></span>`).join('');
  return `<div class="pa-death">
    <span class="pa-death-l">Death saves</span>
    <span class="pa-ds">✓ ${row('success')}</span>
    <span class="pa-ds">✗ ${row('fail')}</span>
    <button class="btn primary" data-pa-death="roll">Roll</button>
  </div>`;
}

// First run: pick who you are. Also reachable later via Change, because a
// shared tablet passed round the table is one device and several players.
function paPickerScreen(){
  const list = (state.party || []);
  if (!list.length){
    return `<div class="pa-card">${typeof emptyState === 'function' ? emptyState({
      icon:'i-heart', title:'No party yet',
      hint:'Once the DM has added characters, pick yours here.' }) : 'No party yet.'}</div>`;
  }
  return `<div class="pa-card">
    <h3 class="pa-pick-h">Which one are you?</h3>
    <p class="pa-pick-p">Kept on this device. Everything else on this screen follows from it —
      whose turn it is, your HP, your reactions.</p>
    <div class="pa-pick">${list.map(p => `
      <button class="pa-pick-b" data-pa-pick="${paEsc(p.id)}">
        <span class="pa-avatar sm">${paEsc(String(p.name || '?').trim().charAt(0).toUpperCase())}</span>
        <span class="pa-pick-n">${paEsc(p.name)}</span>
        <span class="pa-pick-s">${paEsc([p.cls, p.level ? 'lvl ' + p.level : ''].filter(Boolean).join(' · '))}</span>
      </button>`).join('')}</div>
  </div>`;
}

// ─── Party ───────────────────────────────────────────────────────────────────
// Collapsed it answers the question a player asks at a glance — who is hurt.
// Expanded it is the rest of the character sheet, because the other half of
// what a player asks is "what can you actually do?" and the alternative is
// leaning over to read somebody else's phone.
const PA_ABIL = [['str','STR'],['dex','DEX'],['con','CON'],['int','INT'],['wis','WIS'],['cha','CHA']];
const PA_SKILLS = {
  acrobatics:'Acrobatics', animalHandling:'Animal Handling', arcana:'Arcana',
  athletics:'Athletics', deception:'Deception', history:'History', insight:'Insight',
  intimidation:'Intimidation', investigation:'Investigation', medicine:'Medicine',
  nature:'Nature', perception:'Perception', performance:'Performance',
  persuasion:'Persuasion', religion:'Religion', sleightOfHand:'Sleight of Hand',
  stealth:'Stealth', survival:'Survival',
};
const paSign = n => (n >= 0 ? '+' : '') + n;
const paMod = v => (typeof v === 'number' ? Math.floor((v - 10) / 2) : null);

// Which sheets are open, by character id. Kept in memory, not stored: a
// glance at somebody else's sheet is not a preference.
const paOpenMates = new Set();

// Everything a player might reasonably want off another character's sheet,
// read-only, and each block skipped entirely when there is nothing in it —
// a hand-entered character with no imported skills shows no skills section
// rather than eighteen dashes.
function paSheetDetail(p){
  const sh = p.sheet || {};
  const ab = p.abilities || {};
  const bits = [];
  if (p.spd) bits.push(`Speed ${p.spd} ft`);
  if (sh.passivePerception || p.pp) bits.push(`Passive Perception ${sh.passivePerception || p.pp}`);
  if (sh.profBonus) bits.push(`Proficiency ${paSign(sh.profBonus)}`);
  if (sh.spellSaveDc) bits.push(`Spell save DC ${sh.spellSaveDc}`);
  if (sh.spellAtkBonus) bits.push(`Spell attack ${paSign(sh.spellAtkBonus)}`);
  if (p.hitDice) bits.push(`Hit dice ${p.hitDice.current}/${p.hitDice.max}${p.hitDice.dieType || ''}`);

  const abils = PA_ABIL.filter(([k]) => typeof ab[k] === 'number').map(([k, l]) =>
    `<div class="pa-ab"><span class="pa-ab-l">${l}</span><span class="pa-ab-v">${ab[k]}</span>
      <span class="pa-ab-m">${paSign(paMod(ab[k]))}</span></div>`).join('');

  const saves = Object.keys(sh.saves || {}).filter(k => typeof sh.saves[k] === 'number')
    .map(k => `<span class="pa-kv"><b>${k.toUpperCase()}</b> ${paSign(sh.saves[k])}</span>`).join('');

  const skills = Object.keys(sh.skills || {}).filter(k => typeof sh.skills[k] === 'number')
    .sort((a, b) => (PA_SKILLS[a] || a).localeCompare(PA_SKILLS[b] || b))
    .map(k => `<span class="pa-kv"><b>${paEsc(PA_SKILLS[k] || k)}</b> ${paSign(sh.skills[k])}</span>`).join('');

  // Spell slots can live in TWO places — a resource pool named "Spell Slots
  // L1" and sheet.spellSlots — and a character can carry both with different
  // numbers. Showing each would print the same slot twice and disagree with
  // itself. The resource pool wins, matching what the Turn View spends from,
  // and only levels it doesn't cover fall back to the sheet.
  const res = (p.resources || []).map(r =>
    `<span class="pa-kv"><b>${paEsc(r.name)}</b> ${r.current}/${r.max}</span>`).join('');
  const covered = new Set((p.resources || [])
    .map(r => /^Spell Slots L(\d)$/.exec(r.name)).filter(Boolean).map(m => +m[1]));
  const slots = sh.spellSlots ? Object.keys(sh.spellSlots).map(n => parseInt(n))
    .filter(n => n >= 1 && !covered.has(n) && (sh.spellSlots[n].total || 0) > 0).sort((a, b) => a - b)
    .map(l => { const s = sh.spellSlots[l];
      return `<span class="pa-kv"><b>Slots L${l}</b> ${(s.total || 0) - (s.expended || 0)}/${s.total || 0}</span>`;
    }).join('') : '';

  const atks = (Array.isArray(sh.attacks) ? sh.attacks : []).filter(a => a && a.name).map(a =>
    `<div class="pa-mate-atk"><b>${paEsc(a.name)}</b>
      <span>${paEsc(a.atkBonus || '')}${a.atkBonus && a.damage ? ' · ' : ''}${paEsc(a.damage || '')}</span></div>`).join('');

  const spells = (Array.isArray(sh.spells) ? sh.spells : [])
    .map(s => `<span class="pa-chip">${paEsc(s)}</span>`).join('');
  const feats = (Array.isArray(p.feats) ? p.feats : [])
    .map(f => `<span class="pa-chip">${paEsc(f)}</span>`).join('');

  const sec = (title, body) => body ? `<div class="pa-mate-sec"><h5>${title}</h5><div class="pa-kvs">${body}</div></div>` : '';
  const any = bits.length || abils || saves || skills || res || slots || atks || spells || feats;
  if (!any) return `<div class="pa-mate-body"><div class="pa-mate-none">
    Nothing on this sheet yet — the DM fills these in on the party card, or a
    character-sheet PDF import brings them across.</div></div>`;
  return `<div class="pa-mate-body">
    ${bits.length ? `<div class="pa-mate-line">${bits.map(paEsc).join(' · ')}</div>` : ''}
    ${abils ? `<div class="pa-abs">${abils}</div>` : ''}
    ${sec('Saving throws', saves)}
    ${sec('Skills', skills)}
    ${sec('Resources', res + slots)}
    ${atks ? `<div class="pa-mate-sec"><h5>Attacks</h5>${atks}</div>` : ''}
    ${sec('Feats', feats)}
    ${sec('Spells', spells)}
  </div>`;
}

function paPartyScreen(){
  const list = state.party || [];
  const meId = paMe().pcId;
  if (!list.length) return `<div class="pa-card"><div class="pa-empty">No party yet.</div></div>`;
  return `<div class="pa-card">${list.map(p => {
    const c = (state.combatants || []).find(x => x.isPC && x.id === p.id);
    const hp = c ? c.hp : p.hp, hpMax = c ? c.hpMax : p.hpMax;
    const pct = hpMax ? Math.max(0, (hp / hpMax) * 100) : 0;
    const col = pct <= 0 ? '#5a3a3a' : pct < 35 ? 'var(--danger)' : pct < 75 ? 'var(--warning)' : 'var(--success)';
    const conds = (c && c.conditions || []).map(x => `<span class="pa-cond sm">${paEsc(x)}</span>`).join('');
    const open = paOpenMates.has(p.id);
    const sub = [p.cls, p.subclass, p.level ? 'lvl ' + p.level : ''].filter(Boolean).join(' · ');
    return `<div class="pa-mate${p.id === meId ? ' me' : ''}${open ? ' open' : ''}">
      <button class="pa-mate-head" data-pa-mate="${paEsc(p.id)}" aria-expanded="${open}">
        <span class="pa-mate-row">
          <span class="pa-caret">${open ? '▾' : '▸'}</span>
          <span class="pa-mate-n">${paEsc(p.name)}${p.id === meId ? ' <i>you</i>' : ''}</span>
          <span class="pa-mate-hp">${hp}/${hpMax}</span>
          <span class="pa-mate-ac">AC ${p.ac ?? '–'}</span>
        </span>
        <span class="pa-hp-bar sm"><i style="width:${pct}%;background:${col}"></i></span>
        ${sub ? `<span class="pa-mate-sub">${paEsc(sub)}</span>` : ''}
      </button>
      ${conds ? `<div class="pa-conds sm">${conds}</div>` : ''}
      ${open ? paSheetDetail(p) : ''}
    </div>`;
  }).join('')}</div>`;
}

// ─── Interaction ─────────────────────────────────────────────────────────────
// A player may change their OWN hit points and nobody else's. That is the
// single biggest reduction in the DM's bookkeeping, it is their character, and
// the write goes through the Combat Tracker's own _applyHpDelta so resistances
// and death saves behave exactly as they do on the DM's screen.
function paApplyHp(sign){
  const pc = paPc(); if (!pc) return;
  const el = document.getElementById('pa-hp-amt');
  const n = Math.abs(parseInt(el && el.value, 10) || 0); if (!n) return;
  const c = paCombatant();
  const C = panelDefs.combat;
  if (c && C && typeof C._applyHpDelta === 'function'){
    const i = (state.combatants || []).indexOf(c);
    if (i >= 0) C._applyHpDelta(i, sign < 0 ? -n : n, null);
  } else {
    // Not in the fight — write to the party slot directly.
    const before = pc.hp;
    pc.hp = Math.max(0, Math.min(pc.hpMax, before + (sign < 0 ? -n : n)));
  }
  save(); paRender();
}

function paRollAttack(i){
  const pc = paPc(); if (!pc) return;
  const a = (pc.sheet && pc.sheet.attacks || [])[i]; if (!a) return;
  const d = n => 1 + Math.floor(Math.random() * n);
  const bonus = parseInt(String(a.atkBonus || '').replace(/[^\d+-]/g, ''), 10) || 0;
  const nat = d(20), total = nat + bonus;
  // Damage expression off the sheet: "1d8+3 slashing".
  const m = String(a.damage || '').match(/(\d*)d(\d+)\s*([+-]\s*\d+)?\s*(.*)/i);
  let dmg = '', type = '';
  if (m){
    const n = parseInt(m[1] || '1'), sides = parseInt(m[2]), mod = parseInt(String(m[3] || '0').replace(/\s+/g, '')) || 0;
    const crit = nat === 20;
    const rolls = [];
    for (let k = 0; k < n * (crit ? 2 : 1); k++) rolls.push(d(sides));
    dmg = String(Math.max(0, rolls.reduce((s, x) => s + x, 0) + mod));
    type = (m[4] || '').trim();
  }
  const box = document.getElementById('pa-roll');
  if (!box) return;
  // Shown, not applied. The player reads it out; the DM decides whether it
  // hit. Applying a player's damage to a monster from here would be the
  // player running the DM's side of the table.
  box.innerHTML = `<div class="pa-roll-in${nat === 20 ? ' crit' : nat === 1 ? ' fumble' : ''}">
    <span class="pa-roll-l">${paEsc(a.name)}</span>
    <span class="pa-roll-hit">${total}<i> to hit</i></span>
    <span class="pa-roll-d">d20 ${nat}${bonus ? (bonus > 0 ? ' + ' + bonus : ' − ' + Math.abs(bonus)) : ''}</span>
    ${dmg ? `<span class="pa-roll-dmg">${dmg}<i> ${paEsc(type)}</i></span>` : ''}
    ${nat === 20 ? '<span class="pa-roll-tag">crit</span>' : nat === 1 ? '<span class="pa-roll-tag">nat 1</span>' : ''}
  </div>`;
}

function paRollDeathSave(){
  const c = paCombatant(); if (!c) return;
  const C = panelDefs.combat; if (!C) return;
  const d = n => 1 + Math.floor(Math.random() * n);
  const nat = d(20);
  let msg;
  if (nat === 20){
    const i = (state.combatants || []).indexOf(c);
    c.deathSaves = null;
    if (i >= 0) C._applyHpDelta(i, 1, null);
    msg = 'Natural 20 — you are conscious at 1 HP.';
  } else {
    const kind = nat >= 10 ? 'success' : 'fail';
    const outcome = C._addDeathSave(c.id, kind, nat === 1 ? 2 : 1);
    msg = `${nat} — ${nat === 1 ? 'natural 1, two failures' : kind}`
        + (outcome === 'stable' ? '. Stable.' : outcome === 'dead' ? '. You have died.' : '.');
  }
  save();
  const box = document.getElementById('pa-roll');
  if (box) box.innerHTML = `<div class="pa-roll-in"><span class="pa-roll-l">Death save</span>
    <span class="pa-roll-hit">${paEsc(msg)}</span></div>`;
  paRender();
}

function paOnClick(e){
  const tab = e.target.closest('[data-pa-tab]');
  if (tab){ paTab = tab.dataset.paTab; paRender(); return; }
  const pick = e.target.closest('[data-pa-pick]');
  if (pick){ paSetPc(pick.dataset.paPick); paRender(); return; }
  if (e.target.closest('[data-pa-swap]')){ paSetPc(null); paRender(); return; }
  const hp = e.target.closest('[data-pa-hp]');
  if (hp){ paApplyHp(+hp.dataset.paHp); return; }
  const atk = e.target.closest('[data-pa-atk]');
  if (atk){ paRollAttack(+atk.dataset.paAtk); return; }
  if (e.target.closest('[data-pa-death]')){ paRollDeathSave(); return; }
  const mate = e.target.closest('[data-pa-mate]');
  if (mate){
    const id = mate.dataset.paMate;
    if (paOpenMates.has(id)) paOpenMates.delete(id); else paOpenMates.add(id);
    paRenderScreen(); return;
  }
  const draw = e.target.closest('[data-pa-draw]');
  if (draw){ paDraw(draw.dataset.paDraw); return; }
  const react = e.target.closest('[data-pa-react]');
  if (react){ paAnswerPrompt(+react.dataset.paReact); return; }
  if (e.target.closest('[data-pa-pass]')){
    paDismissed = state.prompt && state.prompt.id;
    paRenderPrompt(); return;
  }
}
function paOnChange(){ /* inputs are read on use; nothing to do */ }
