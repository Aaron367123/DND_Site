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

const paShared = () => new Set(typeof sktCanonShared === 'function' ? sktCanonShared(state.sharedPanels) : (state.sharedPanels || []));
const paEsc = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s));

// Monster numbers follow the DM's own show / conceal / hide setting, read
// through the Combat Tracker so a second surface can't disagree with the
// first about what has been hidden.
function paStatsMode(){
  const C = panelDefs.combat;
  // Fail CLOSED. The combat panel is loaded in the player view today, so this
  // fallback does not fire — but it guards an information-hiding control, and
  // 'show' as the default meant "if I cannot find out what the DM hid, reveal
  // everything". A lighter player bundle later would start leaking exact
  // monster HP with nothing failing to signal it. 'hide' is the answer that is
  // wrong in a way somebody notices and asks about.
  return (C && typeof C._statsMode === 'function') ? C._statsMode() : 'hide';
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
  // Always there: every player keeps their own notes here. What the DM has
  // shared appears alongside only when the Notes panel is shared as well.
  { id:'notes', label:'Notes', icon:'i-note',   always:true },
  // Loot is fully interactive for players, deliberately. The party's haul is
  // the party's business — claiming an item, splitting coin and adding what
  // they picked up is bookkeeping the DM should not have to relay. The panel
  // mounts unrestricted, which is also why it needs no player-mode branches of
  // its own.
  { id:'loot',  label:'Loot',  icon:'i-chest',  needs:'loot'  },
  // The date and the sky. Both are things the party can simply see, and
  // both were previously DM-only for no stated reason — the keys were not
  // even synced, so the DM's own second device disagreed about the date.
  //
  // Read-only over here: the controls are hidden by the .pa-mount rules,
  // and realtime.js refuses to push either key from a player device, so a
  // phone cannot rewind the clock even if something did reach a handler.
  // One tab, the World window as the DM has it: the date and the clock with
  // the weather beside them. They were two tabs, Time and Sky, each a
  // single small card.
  { id:'world', label:'World', icon:'i-cloud',  needs:'world' },
  // Phones only. The floating toolbar is hidden on a phone (main.css), and
  // everything in it a player can use lives here instead: search, settings,
  // sync status, the campaign, and the way back to the DM view.
  { id:'more',  label:'More',  icon:'i-dots',   always:true, phoneOnly:true },
];

// The same gate the phone layout uses in main.css — one definition of
// "phone", or the tab and the hidden toolbar could disagree.
const PA_PHONE_Q = '(max-width: 768px) and (pointer: coarse)';
function paIsPhone(){ try { return matchMedia(PA_PHONE_Q).matches; } catch(e){ return false; } }
let paTab = 'you';

// What the player view can actually surface, kept next to the tab list so the
// two cannot drift. The DM's per-window "Share with player view" menu reads
// this: without it, every one of the seventeen panels offered to be shared and
// only these did anything. Sharing Loot or Shop set a flag, showed the eye
// icon, synced the list to every device — and produced nothing on the player's
// screen, with no way to tell that from a bug.
//
// `combat` has no tab of its own but drives the turn strip and the monster-stat
// reveal, so sharing it is meaningful.
const PA_SHAREABLE = new Set(PA_TABS.filter(t => t.needs).map(t => t.needs).concat(['combat']));

function paVisibleTabs(){
  const sh = paShared();
  const phone = paIsPhone();
  return PA_TABS.filter(t => (t.always || sh.has(t.needs) || (t.when && t.when())) && (!t.phoneOnly || phone));
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
  paInitMore();
  paRender();
  paOnHandouts();
  paOnRollRequest();
}

// ─── "Everyone, roll…" ───────────────────────────────────────────────────────
// One pop-up for whatever the DM asks the table to roll at once
// (js/features/roll-requests.js): initiative, a saving throw, an ability or
// skill check — and for a short rest, the hit-dice screen. Roll here, with
// advantage or disadvantage, or type the total off real dice. The DC shows
// only if the DM ticked it, and then the phone says at once whether the roll
// made it. Initiative also goes straight onto this character's combatant, so
// the tracker fills in without the DM's window relaying it.
const PA_ABS = { STR: 'Strength', DEX: 'Dexterity', CON: 'Constitution',
                 INT: 'Intelligence', WIS: 'Wisdom', CHA: 'Charisma' };
function paRollReq(){ return typeof sktRollReq === 'function' ? sktRollReq() : null; }
function paInitBonus(pcId){
  const p = (state.party || []).find(x => x.id === pcId);
  if (p && typeof p.init === 'number') return p.init;
  const c = (state.combatants || []).find(x => x.id === pcId);
  return c && typeof c.initBonus === 'number' ? c.initBonus : 0;
}
// The character's own bonus for a save, from the same place the DM's
// tracker reads it, so the two never disagree.
function paSaveBonus(pcId, ab){
  const C = (typeof panelDefs !== 'undefined') && panelDefs.combat;
  if (C && typeof C.saveBonus === 'function'){
    try { return C.saveBonus({ isPC: true, id: pcId }, ab) || 0; } catch(e){}
  }
  const pc = (state.party || []).find(p => p.id === pcId) || {};
  const k = String(ab || '').slice(0, 3).toLowerCase();
  let v = pc.sheet && pc.sheet.saves ? pc.sheet.saves[k] : null;
  if (typeof v === 'string') v = parseInt(v, 10);
  if (typeof v === 'number' && !isNaN(v)) return v;
  const sc = pc.abilities && pc.abilities[k];
  return typeof sc === 'number' ? Math.floor((sc - 10) / 2) : 0;
}
// A check: the skill's modifier off the sheet, or the bare ability modifier.
function paCheckBonus(pcId, ab, skill){
  const pc = (state.party || []).find(p => p.id === pcId) || {};
  const sk = pc.sheet && pc.sheet.skills;
  if (skill && sk && typeof sk[skill] === 'number') return sk[skill];
  const k = String(ab || '').slice(0, 3).toLowerCase();
  const sc = pc.abilities && pc.abilities[k];
  return typeof sc === 'number' ? Math.floor((sc - 10) / 2) : 0;
}
function paRollBonus(r, me){
  if (r.kind === 'init') return paInitBonus(me);
  if (r.kind === 'save') return paSaveBonus(me, r.ab);
  return paCheckBonus(me, r.ab, r.skill);
}
function paRollAsked(r, me){
  return !!(r && !r.closed && me && Array.isArray(r.pcs) && r.pcs.includes(me)
    && !(r.answers && r.answers[me] && r.answers[me].rid === r.id)
    && Date.now() - (r.askedAt || 0) < (typeof SKT_RR_FRESH !== 'undefined' ? SKT_RR_FRESH : 1200000));
}
function paOnRollRequest(){
  if (!document.body.classList.contains('player-app')) return;
  const r = paRollReq(), me = paMe().pcId;
  const cur = document.getElementById('pa-roll-req');
  if (!paRollAsked(r, me)){
    if (cur) cur.remove();
    // A rest the DM finished (or called off) closes the hit-dice screen too.
    const rest = document.getElementById('pa-rest');
    if (rest && rest.dataset.rid && (!r || r.id !== rest.dataset.rid || r.closed)) rest.remove();
    return;
  }
  // A short rest is the hit-dice screen, not a roll.
  if (r.kind === 'rest'){
    const rest = document.getElementById('pa-rest');
    if (!rest || rest.dataset.rid !== r.id) paOpenShortRest(r);
    return;
  }
  if (cur && cur.dataset.rid === r.id) return;          // already up for this one
  if (cur) cur.remove();
  const pc = (state.party || []).find(x => x.id === me) || {};
  const bonus = paRollBonus(r, me);
  const sign = n => (n >= 0 ? '+' : '') + n;
  const title = r.kind === 'init' ? '⚔ Roll initiative!'
    : r.kind === 'save' ? '🛡 ' + (PA_ABS[r.ab] || r.ab) + ' saving throw!'
    : '🎲 ' + (typeof sktRollTitle === 'function' ? sktRollTitle(r) : 'Check') + '!';
  const ov = document.createElement('div');
  ov.id = 'pa-roll-req'; ov.className = 'pa-init'; ov.dataset.rid = r.id; ov.dataset.kind = r.kind;
  ov.innerHTML = '<div class="pa-init-card" role="dialog" aria-modal="true" aria-label="' + paEsc(title) + '">'
    + '<div class="pa-init-l">' + paEsc(title) + '</div>'
    + '<div class="pa-init-who">' + paEsc(pc.name || 'Your character') + ' · bonus <b>' + sign(bonus) + '</b>'
    +   (r.showDc && r.dc ? ' · beat <b>' + r.dc + '</b>' : '')
    +   (r.name ? '<span class="pa-save-src">' + paEsc(r.name) + '</span>' : '') + '</div>'
    + '<div class="pa-init-roll">'
    +   '<button class="btn primary" data-pa-rr="roll">🎲 Roll for me</button>'
    +   '<button class="btn" data-pa-rr="adv" title="Advantage">🎲🎲 Adv</button>'
    +   '<button class="btn" data-pa-rr="dis" title="Disadvantage">🎲🎲 Dis</button>'
    + '</div>'
    + '<div class="pa-init-dice" id="pa-rr-dice"></div>'
    + '<label class="pa-init-type">Or type your total <input id="pa-rr-val" type="number" inputmode="numeric" placeholder="e.g. 17"></label>'
    + '<button class="btn primary pa-init-send" data-pa-rr="send" disabled>Send</button>'
    + '</div>';
  const val = ov.querySelector('#pa-rr-val'), send = ov.querySelector('[data-pa-rr="send"]');
  const dice = ov.querySelector('#pa-rr-dice');
  const verdict = total => (r.showDc && r.dc) ? (total >= r.dc ? ' — made it' : ' — missed it') : '';
  val.addEventListener('input', () => { send.disabled = val.value === ''; dice.textContent = ''; });
  ov.addEventListener('click', e => {
    const b = e.target.closest('[data-pa-rr]'); if (!b) return;
    const act = b.dataset.paRr;
    if (act === 'roll' || act === 'adv' || act === 'dis'){
      const a = sktD(20), c = act === 'roll' ? null : sktD(20);
      const d = c == null ? a : (act === 'adv' ? Math.max(a, c) : Math.min(a, c));
      const total = d + bonus;
      val.value = String(total); send.disabled = false;
      dice.textContent = (c == null ? 'd20 (' + a + ')' : '2d20 (' + a + ', ' + c + ') keep ' + d)
        + ' ' + sign(bonus) + ' = ' + total + verdict(total);
    } else if (act === 'send' && val.value !== ''){
      paAnswerRoll(parseInt(val.value, 10));
    }
  });
  document.body.appendChild(ov);
  try { navigator.vibrate && navigator.vibrate([120, 60, 120]); } catch(e){}
}
// This character's answer: a number, or for a rest, done.
function paAnswerRoll(v, done){
  const r = paRollReq(), me = paMe().pcId;
  if (!r || r.closed || !me || (!done && isNaN(v))) return false;
  r.answers = r.answers || {};
  r.answers[me] = done ? { done: true, rid: r.id, at: Date.now() } : { v, rid: r.id, at: Date.now() };
  saveJson(typeof SKT_RR_KEY !== 'undefined' ? SKT_RR_KEY : 'skt-rollreq-v1', r, 'roll request');
  if (r.kind === 'init'){
    const c = (state.combatants || []).find(x => x.id === me && x.isPC);
    if (c){ c.initiative = v; save(); }
  }
  document.getElementById('pa-roll-req')?.remove();
  if (typeof showToast === 'function' && !done){
    showToast(r.kind === 'init' ? 'Sent — initiative ' + v
      : 'Sent — ' + v + (r.showDc && r.dc ? ' vs DC ' + r.dc + (v >= r.dc ? ': made it' : ': missed it') : ''));
  }
  paRender();
  return true;
}
// The names other code and older pages call.
const paOnInitRequest = paOnRollRequest, paOnSaveRequest = paOnRollRequest;

// ─── Handouts ────────────────────────────────────────────────────────────────
// What the DM sent (js/panels/handouts.js), filtered to this phone: everyone's,
// plus any addressed to this phone's character. A handout pops up full screen
// when it arrives or is shown again — once per showing, remembered on this
// device — and stays in Notes, under "From the DM". One that was shown long
// before this phone joined waits there rather than popping up out of nowhere.
const PA_HO_SEEN = 'skt-ho-seen-v1';
const PA_HO_FRESH = 15 * 60 * 1000;
function paMyHandouts(){
  let d = null;
  try { d = JSON.parse(localStorage.getItem('skt-handouts-v1') || 'null'); } catch(e){}
  const me = paMe().pcId;
  return (d && Array.isArray(d.list) ? d.list : [])
    .filter(h => h && (h.to === 'all' || (Array.isArray(h.to) && me && h.to.includes(me))));
}
function paHoSeen(){ try { return JSON.parse(localStorage.getItem(PA_HO_SEEN) || '{}') || {}; } catch(e){ return {}; } }
function paOnHandouts(){
  if (!document.body.classList.contains('player-app')) return;
  const seen = paHoSeen();
  const fresh = paMyHandouts().filter(h => (h.shownAt || 0) > (seen[h.id] || 0) && Date.now() - (h.shownAt || 0) < PA_HO_FRESH);
  paRender();
  if (fresh.length) paShowHandout(fresh[0].id, true);
}
function paHandoutBody(h){
  return (typeof sktHoImgTag === 'function' ? sktHoImgTag(h, 'pa-ho-img') : (h.img ? '<img class="pa-ho-img" src="' + h.img + '" alt="">' : ''))
    + (h.text ? '<div class="pa-ho-text">' + paEsc(h.text).replace(/\n/g, '<br>') + '</div>' : '');
}
function paShowHandout(id, arriving){
  const h = paMyHandouts().find(x => x.id === id); if (!h) return;
  document.getElementById('pa-handout')?.remove();
  const ov = document.createElement('div');
  ov.id = 'pa-handout'; ov.className = 'pa-handout';
  ov.innerHTML = '<div class="pa-ho-card" role="dialog" aria-modal="true" aria-label="Handout">'
    + '<div class="pa-ho-head">' + (arriving ? '<span class="pa-ho-new">' + (h.whisper ? 'For you alone' : 'New handout') + '</span>' : '')
    + '<b>' + paEsc(h.title || 'Handout') + '</b></div>'
    + '<div class="pa-ho-body">' + paHandoutBody(h) + '</div>'
    + '<button class="btn primary pa-ho-close">Close</button></div>';
  const close = () => {
    const seen = paHoSeen(); seen[h.id] = h.shownAt || Date.now();
    try { localStorage.setItem(PA_HO_SEEN, JSON.stringify(seen)); } catch(e){}
    ov.remove();
  };
  ov.querySelector('.pa-ho-close').addEventListener('click', close);
  if (typeof sktHoFillImgs === 'function') sktHoFillImgs(ov);
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  document.body.appendChild(ov);
  if (arriving){ try { navigator.vibrate && navigator.vibrate(120); } catch(e){} }
}

// ─── The phone's More tab ────────────────────────────────────────────────────
// Search is the REAL search box, not a copy: it lives inside the floating
// toolbar, so while searching the toolbar comes back as a full-width strip
// holding only the box and a Done button (body.pa-searching, main.css). A
// second search UI built here would drift from the first the day either
// changed.
function paInitMore(){
  try { matchMedia(PA_PHONE_Q).addEventListener('change', () => paRender()); } catch(e){}
  const bar = document.getElementById('float-toolbar');
  if (bar && !document.getElementById('pa-search-close')){
    const done = document.createElement('button');
    done.id = 'pa-search-close';
    done.className = 'btn';
    done.textContent = 'Done';
    done.addEventListener('click', () => { if (typeof closeSearch === 'function') closeSearch(); paEndSearch(); });
    bar.appendChild(done);
  }
  // However the search closes — Done, Escape, a tap outside it — leave
  // search mode with it, or the strip would sit over the screen empty.
  const wrap = document.getElementById('search-wrap');
  if (wrap && typeof MutationObserver === 'function'){
    new MutationObserver(() => { if (!wrap.classList.contains('open')) paEndSearch(); })
      .observe(wrap, { attributes: true, attributeFilter: ['class'] });
  }
  // Keep the Sync row live while it is on screen.
  const sync = document.getElementById('sync-status');
  if (sync && typeof MutationObserver === 'function'){
    new MutationObserver(() => {
      const row = document.getElementById('pa-more-sync');
      if (row) row.innerHTML = sync.innerHTML;
    }).observe(sync, { childList: true, subtree: true, characterData: true, attributes: true });
  }
}
function paStartSearch(){
  document.body.classList.add('pa-searching');
  if (typeof openSearch === 'function') openSearch();
  setTimeout(() => document.getElementById('search-input')?.focus(), 60);
}
function paEndSearch(){ document.body.classList.remove('pa-searching'); }

function paMoreScreen(){
  const camp = (typeof sktActiveCampaignName === 'function') ? sktActiveCampaignName() : '';
  const sync = document.getElementById('sync-status');
  const back = document.getElementById('player-view-btn');
  const ico = id => (typeof ICO === 'function') ? ICO(id) : '';
  const row = (act, icon, title, sub) =>
    '<button class="pa-more-row" data-more="' + act + '">' + ico(icon)
    + '<span class="pa-more-text"><span class="pa-more-title">' + title + '</span>'
    + (sub ? '<span class="pa-more-sub">' + sub + '</span>' : '') + '</span></button>';
  return '<div class="pa-card pa-more">'
    + row('search', 'i-search', 'Search', 'Spells, monsters, items, rules')
    + row('settings', 'i-gear', 'Settings', 'Text size, theme and display')
    + '<div class="pa-more-row pa-more-static">' + ico('i-cloud')
    +   '<span class="pa-more-text"><span class="pa-more-title">Sync</span>'
    +   '<span class="pa-more-sub" id="pa-more-sync">' + (sync ? sync.innerHTML : '') + '</span></span></div>'
    // Who else is here, and whether their screen agrees with this one. A
    // player seeing "DM · quiet" knows the table has a problem before anyone
    // says "wait, did my move go through?"
    + '<button class="pa-more-row" data-more="devices">' + ico('i-monitor')
    +   '<span class="pa-more-text"><span class="pa-more-title">Who&#8217;s connected</span>'
    +   '<span class="pa-more-sub" id="pa-more-devices">'
    +     (typeof sktPresenceRows === 'function' ? (() => { const r = sktPresenceRows();
            return r.length + (r.length === 1 ? ' device' : ' devices') + (sktPresenceTrouble() ? ' · one is behind' : ''); })() : 'Checking…')
    +   '</span></span></button>'
    // Which campaign, shown but not switchable: the link decides it, and a
    // switcher here would let a player wander into another group's table.
    + (camp ? '<div class="pa-more-row pa-more-static">' + ico('i-folder')
      + '<span class="pa-more-text"><span class="pa-more-title">Campaign</span>'
      + '<span class="pa-more-sub">' + paEsc(camp) + '</span></span></div>' : '')
    + (back ? row('dm', 'i-monitor', 'Back to DM view', 'Switches this device to the DM screen') : '')
    + '</div>';
}
function paWireMore(el){
  el.querySelectorAll('[data-more]').forEach(b => b.addEventListener('click', () => {
    const act = b.dataset.more;
    if (act === 'search') paStartSearch();
    // Opened directly rather than by poking the hidden gear: the gear toggles
    // on mousedown, and a toggle would close a drawer that is already open.
    else if (act === 'settings') document.getElementById('settings-drawer')?.classList.add('open');
    else if (act === 'dm') document.getElementById('player-view-btn')?.click();
    else if (act === 'devices' && typeof paShowDevices === 'function') paShowDevices();
  }));
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
  if (!paShared().has('combat') || !list.length){ el.innerHTML = ''; el.hidden = true; paTurnAlert(null, false, null); return; }
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
  el.classList.toggle('mine', mine);
  paTurnAlert(cur, mine, until);
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

// ─── "Your turn" / "you're up next" ──────────────────────────────────────────
// "Your turn" in the strip is easy to miss on a phone lying face-up on the
// table. So when the turn ARRIVES — the moment it changes to you, not on every
// redraw while it stays yours — the phone buzzes and a banner takes the
// screen. One turn earlier, a smaller heads-up so the player can think
// before they're asked.
//
// Keyed on round + whose turn, so a redraw from an HP change mid-turn never
// re-fires it. The first render only records the key: a reload during your
// turn has nothing to announce, and the strip already says so.
let paTurnKey = null;
function paTurnAlert(cur, mine, until){
  // '' for no fight, so a fight STARTING on your turn still announces itself.
  const key = cur ? (state.combatRound || 1) + ':' + cur.id : '';
  if (key === paTurnKey) return;
  const first = paTurnKey === null;
  paTurnKey = key;
  if (first || !key){ paHideTurnBanner(); return; }
  const buzz = p => { try { navigator.vibrate && navigator.vibrate(p); } catch(e){} };
  if (mine){
    buzz([220, 90, 220]);
    paShowTurnBanner();
  } else {
    paHideTurnBanner();
    if (until === 1){
      buzz(90);
      if (typeof showToast === 'function') showToast("You're up next");
    }
  }
}
let paBannerTimer = null;
function paShowTurnBanner(){
  paHideTurnBanner();
  const pc = paPc();
  const b = document.createElement('button');
  b.id = 'pa-turn-alert';
  b.className = 'pa-turn-alert';
  b.type = 'button';
  b.innerHTML = '<span class="pa-turn-alert-l">Your turn</span>'
    + (pc ? '<span class="pa-turn-alert-n">' + paEsc(pc.name) + '</span>' : '')
    + '<span class="pa-turn-alert-h">Tap to close</span>';
  b.addEventListener('click', paHideTurnBanner);
  document.body.appendChild(b);
  paBannerTimer = setTimeout(paHideTurnBanner, 6000);
}
function paHideTurnBanner(){
  clearTimeout(paBannerTimer);
  document.getElementById('pa-turn-alert')?.remove();
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
  // Tear the outgoing panel down before wiping its DOM. This shell never
  // called unmount() at all, so leaving the Map tab left the battle map
  // panel believing it was still on screen: _body pointed at a detached
  // node, its ResizeObserver kept firing, its document mouseup listener and
  // its undo key handler stayed bound, and every visit added another set.
  //
  // The stale _body is the part that misleads other code — _reloadPanel and
  // applyMapState both use it to decide the panel is visible, so an incoming
  // map change was being applied and painted into nothing.
  paUnmountCurrent(el);
  el.innerHTML = '';
  if (paTab === 'you')   { el.innerHTML = paYouScreen(); return; }
  if (paTab === 'more')  { el.innerHTML = paMoreScreen(); paWireMore(el); return; }
  if (paTab === 'party') { el.innerHTML = paPartyScreen(); return; }
  if (paTab === 'map')   { paMountPanel(el, 'battlemap'); return; }
  if (paTab === 'notes') { paMountPanel(el, 'notes');     return; }
  if (paTab === 'loot')  { paMountPanel(el, 'loot');      return; }
  if (paTab === 'world') { paMountPanel(el, 'world');     return; }
}

// The map and the notes are the DM panels, mounted whole. Not rewritten:
// the map carries fog, the background image, rotation, scale and its own live
// sync, and a second renderer would be a second set of those to keep right.
// Its editing toolbar is hidden by CSS in this shell — see .pa-mount rules.
// The inverse of paMountPanel. Reads which panel is mounted off the DOM
// rather than a variable, so it stays right even if a render is missed.
function paUnmountCurrent(host){
  const box = host.querySelector('.pa-mount');
  if (!box) return;
  const tab = box.dataset.paMount;
  const id = tab === 'map' ? 'battlemap' : tab === 'notes' ? 'notes'
           : tab === 'loot' ? 'loot' : tab === 'world' ? 'world' : null;
  const def = id && panelDefs[id];
  if (!def) return;
  try { if (typeof def.unmount === 'function') def.unmount(); } catch(e){}
  // unmount() is supposed to clear this; make sure, because everything
  // downstream treats a set _body as "on screen".
  def._body = null;
}

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
  const id = tab === 'map' ? 'battlemap' : tab === 'notes' ? 'notes'
           : tab === 'world' ? 'world' : null;
  if (!id) return;
  const def = panelDefs[id];
  try { def && def._render && def._render(); } catch(e){}
}

// ─── You ─────────────────────────────────────────────────────────────────────
// The character's own activatable features, off their imported sheet. Same
// derivation the Turn View uses — see sktDeriveActivations in js/core/utils.js.
//
// Only the resource is spent here, not the action economy: a player on this
// screen is often not in an initiative order at all, and marking their bonus
// action used out of combat would be wrong. The pool lives in state.party, so
// the DM's Turn View shows the same number a moment later.
function paActivations(pc){
  if (pc && typeof sktActivationsOf === 'function'){ try { return sktActivationsOf(pc) || []; } catch(e){ return []; } }
  if (!pc || typeof sktDeriveActivations !== 'function') return [];
  const text = (pc.sheet && pc.sheet.bio && pc.sheet.bio.features) || '';
  try { return sktDeriveActivations(text) || []; } catch(e){ return []; }
}
function paPoolFor(pc, a){
  const name = a.resource || a.name;
  return (Array.isArray(pc.resources) ? pc.resources : []).find(r => r.name === name) || null;
}
// Which feature's description is open, by index. Tapping a chip used to
// spend it outright, which made a mis-tap cost a Focus Point and left
// nowhere to answer "what does this one do again".
let paFeatOpen = null;
function paPickActivation(i){
  paFeatOpen = (paFeatOpen === i) ? null : i;
  paRender();
}
function paUseActivation(i){
  const pc = paPc(); if (!pc) return;
  const a = paActivations(pc)[i]; if (!a) return;
  // Bardic Inspiration goes to someone: ask who, and the grant spends the use.
  if (a.name === 'Bardic Inspiration' && typeof sktAskBardic === 'function'){
    sktAskBardic({ from: pc.id, after: () => { paFeatOpen = null; paRender(); } });
    return;
  }
  const pool = paPoolFor(pc, a);
  const n = a.amount || 1;
  const short = pool && pool.current < n;
  if (!short && pool) pool.current = Math.max(0, pool.current - n);
  if (!short){ save(); paFeatOpen = null; }
  paRender();
  // After the re-render, or this writes into a box that is about to be
  // replaced — the same order paRollAttack uses.
  const box = document.getElementById('pa-roll');
  if (!box) return;
  box.innerHTML = short
    ? `<div class="pa-roll-in fumble"><span class="pa-roll-l">${paEsc(a.name)}</span>
         <span class="pa-roll-d">no ${paEsc(String(pool.name).toLowerCase())} left</span></div>`
    : `<div class="pa-roll-in"><span class="pa-roll-l">${paEsc(a.name)}</span>
         <span class="pa-roll-d">${paEsc(a.action || '')}</span>
         ${pool ? `<span class="pa-roll-hit">${pool.current}<i>/${pool.max} ${paEsc(pool.name)}</i></span>` : ''}</div>`;
}
function paYouScreen(){
  const pc = paPc();
  if (!pc) return paPickerScreen();
  const c = paCombatant();
  const hp = c ? c.hp : pc.hp, hpMax = c ? c.hpMax : pc.hpMax;
  const pct = hpMax ? Math.max(0, (hp / hpMax) * 100) : 0;
  const col = pct <= 0 ? '#5a3a3a' : pct < 35 ? 'var(--danger)' : pct < 75 ? 'var(--warning)' : 'var(--success)';
  // Exhaustion is a LEVEL on the character sheet (0–6), not a tag, so it
  // never showed here unless someone also added it as a condition. Shown
  // first, with its level; tapping it opens the rule like any condition.
  const exh = Math.max(0, Math.min(6, +pc.exhaustion || 0));
  const condNames = (c && c.conditions || []).filter(x => !(exh && /^exhaustion\b/i.test(x)));
  const chip = (x, label) => `<button class="pa-cond${paCondOpen === x ? ' on' : ''}" data-pa-cond="${paEsc(x)}" aria-expanded="${paCondOpen === x}">${paEsc(label || x)}<span class="pa-cond-i" aria-hidden="true">?</span></button>`;
  const conds = (exh ? chip('Exhaustion', 'Exhaustion ' + exh) : '') + condNames.map(x => chip(x)).join('');
  const condDet = condNames.includes(paCondOpen) ? paConditionDetail(paCondOpen)
                : (paCondOpen === 'Exhaustion' && exh) ? paConditionDetail('Exhaustion', 'Level ' + exh + ' of 6') : '';
  // Down in a fight (the combatant holds the saves) or out of one (the party
  // slot does — see sktRollDeathSave).
  const down = c ? !!(c.isPC && (c.hp || 0) <= 0) : (pc.hp || 0) <= 0 && pc.hpMax > 0;

  // Tap a lit pip to spend one, an empty one to get one back — one at a
  // time, so a fat-fingered tap on a phone never spends three.
  const res = (pc.resources || []).map((r, ri) => {
    const max = Math.max(0, Math.min(24, r.max || 0));
    let pips = '';
    for (let i = 0; i < max; i++) pips += `<button class="pa-res-pip ${i < r.current ? '' : 'off'}" data-pa-res="${ri}" aria-label="${i < r.current ? 'Use one ' + paEsc(r.name) : 'Get one ' + paEsc(r.name) + ' back'}"></button>`;
    return `<div class="pa-res"><span class="pa-res-n">${paEsc(r.name)}</span>
      <span class="pa-res-pips">${pips}</span>
      <span class="pa-res-c">${r.current}/${r.max}</span></div>`;
  }).join('');

  const slots = pc.sheet && pc.sheet.spellSlots ? Object.keys(pc.sheet.spellSlots)
    .map(n => parseInt(n)).filter(n => n >= 1).sort((a, b) => a - b).map(l => {
      const s = pc.sheet.spellSlots[l], total = s.total || 0, left = total - (s.expended || 0);
      let pips = '';
      for (let i = 0; i < total; i++) pips += `<button class="pa-res-pip ${i < left ? '' : 'off'}" data-pa-slot="${l}" aria-label="${i < left ? 'Use a level ' + l + ' slot' : 'Get a level ' + l + ' slot back'}"></button>`;
      return `<div class="pa-res"><span class="pa-res-n">Level ${l}</span>
        <span class="pa-res-pips">${pips}</span><span class="pa-res-c">${left}/${total}</span></div>`;
    }).join('') : '';

  // Two daggers are one row reading "Dagger ×2" — the sheet lists each
  // weapon carried, and identical rows read like a mistake.
  const atkRows = [];
  (pc.sheet && Array.isArray(pc.sheet.attacks) ? pc.sheet.attacks : []).forEach((a, i) => {
    if (!a || !a.name) return;
    const k = [a.name, a.atkBonus || '', a.damage || ''].join('|').toLowerCase();
    const same = atkRows.find(r => r.k === k);
    if (same) same.n++; else atkRows.push({ k, a, i, n: 1 });
  });
  const atks = atkRows.map(({ a, i, n }) => `
      <button class="pa-atk" data-pa-atk="${i}">
        <span class="pa-atk-n">${paEsc(a.name)}${n > 1 ? ' <span class="pa-atk-x">×' + n + '</span>' : ''}</span>
        <span class="pa-atk-d">${paEsc(a.atkBonus || '')}${a.atkBonus ? ' · ' : ''}${paEsc(a.damage || '')}</span>
        ${typeof ICO === 'function' ? ICO('i-dice') : '🎲'}
      </button>`).join('');

  const feats = paActivations(pc).map((a, i) => {
    const pool = paPoolFor(pc, a);
    const n = a.amount || 1;
    // "1 Focus Point", not "1 Focus Points" — the pool is named in the plural
    // because that is how it is tracked, but a cost of one reads wrong.
    const unit = pool ? (n === 1 ? String(pool.name).replace(/s$/, '') : pool.name) : '';
    const cost = pool ? `${n} ${unit} · ${pool.current}/${pool.max}` : (a.uses || '');
    const dry = !!(pool && pool.current < n);
    return `<button class="pa-feat${dry ? ' off' : ''}${paFeatOpen === i ? ' on' : ''}" data-pa-feat="${i}">
      <span class="pa-feat-n">${paEsc(a.name)}</span>
      <span class="pa-feat-d">${paEsc(a.action || '')}${cost ? ' · ' + paEsc(cost) : ''}</span>
    </button>`;
  }).join('');

  const featDet = (() => {
    const a = paActivations(pc)[paFeatOpen];
    if (!a) return '';
    const pool = paPoolFor(pc, a);
    const n = a.amount || 1;
    const unit = pool ? (n === 1 ? String(pool.name).replace(/s$/, '') : pool.name) : '';
    const meta = [a.feature && a.feature !== a.name ? a.feature : '', a.action,
                  pool ? `${n} ${unit} · ${pool.current}/${pool.max}` : (a.uses || '')]
                 .filter(Boolean).join(' · ');
    const dry = !!(pool && pool.current < n);
    return `<div class="pa-featdet">
      <div class="pa-featdet-h"><b>${paEsc(a.name)}</b><span>${paEsc(meta)}</span>
        <button class="pa-featdet-x" data-pa-featclose="1" aria-label="Close">✕</button></div>
      ${a.desc ? `<p>${paEsc(a.desc)}</p>` : '<p class="pa-dim">The sheet doesn\'t describe this one.</p>'}
      <div class="pa-featdet-f">${dry
        ? `<span class="pa-dim">No ${paEsc(String(pool.name).toLowerCase())} left</span>`
        : `<button class="btn primary" data-pa-featuse="${paFeatOpen}">Use</button>`}</div>
    </div>`;
  })();

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
        <div class="pa-hp-bar"><i style="width:${paBarW(c || pc, pct)}%;background:${col}"></i>${paLostSeg(c || pc)}</div>
        ${paMaxLossLine(pc)}
        <div class="pa-hp-ctl">
          <button class="btn" data-pa-hp="-1">− Damage</button>
          <input class="pa-in" id="pa-hp-amt" type="number" value="5" aria-label="Amount">
          <button class="btn" data-pa-hp="1">+ Heal</button>
          <button class="btn" data-pa-temp="1" title="Temporary hit points — the higher of the two stays">Temp</button>
        </div>
        <select class="pa-in pa-hp-type" id="pa-hp-type" aria-label="Damage type">
          <option value="">Damage type…</option>${PA_DMG_TYPES.map(t => `<option value="${t}">${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}
        </select>
        ${pc.inspiration ? '<button class="pa-insp" data-pa-insp="1" title="Spend it to give yourself advantage">✦ Heroic Inspiration — tap to spend</button>' : ''}
      </div>

      ${conds ? `<div class="pa-conds">${conds}</div>${condDet}` : ''}
      ${paConcRow(pc)}
      ${down ? paDeathBlock(c || pc) : ''}
      ${res ? `<div class="pa-sec"><h4>Resources</h4>${res}</div>` : ''}
      ${slots ? `<div class="pa-sec"><h4>Spell slots</h4>${slots}</div>` : ''}
      ${pc.hitDice && pc.hitDice.max ? `<div class="pa-sec pa-rest-row"><span>Hit dice <b>${Math.max(0, pc.hitDice.current ?? pc.hitDice.max)}/${pc.hitDice.max}</b> ${paEsc(pc.hitDice.dieType || 'd8')}</span>
        <button class="btn" data-pa-rest="open">💤 Short rest</button><button class="btn" data-pa-longrest="1">🛌 Long rest</button></div>` : `<div class="pa-sec pa-rest-row"><span></span><button class="btn" data-pa-longrest="1">🛌 Long rest</button></div>`}
      ${atks ? `<div class="pa-sec"><h4>Attacks</h4><div class="pa-atks">${atks}</div></div>` : ''}
      ${feats ? `<div class="pa-sec"><h4>Features</h4><div class="pa-feats">${feats}</div>${featDet}</div>` : ''}
      <div class="pa-roll" id="pa-roll"></div>
      ${pc.build && (pc.build.level || 1) < 20 && typeof openCharBuilder === 'function'
        ? '<button class="btn pa-levelup" data-pa-build="levelup">⬆ Level up to ' + ((pc.build.level || 1) + 1) + '</button>' : ''}
      <button class="btn primary pa-sheet-t" data-pa-sheet="${paEsc(pc.id)}">📜 Character sheet</button>
    </div>`;
}

// ─── What a condition does ────────────────────────────────────────────────────
// "PRONE" on a phone told the player they were prone and nothing else. Tap it
// and the rule text opens underneath, from the same 5e data the search uses.
// The DM's own label may carry a level or a note ("Exhaustion 2",
// "Frightened (dragon)"), so the lookup tries the leading words.
let paCondOpen = null;
function paConditionEntry(name){
  if (typeof _5eData === 'undefined' || !Array.isArray(_5eData)) return null;
  const words = String(name || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  for (let n = words.length; n > 0; n--){
    const want = words.slice(0, n).join(' ');
    const hits = _5eData.filter(d => (d.cat === 'condition' || d.cat === 'disease' || d.cat === 'status')
                                  && String(d.name).toLowerCase() === want);
    if (hits.length){
      // The 2024 rules when both printings are loaded.
      return hits.find(d => /XPHB|2024/.test(String(d._source || ''))) || hits[0];
    }
  }
  return null;
}
function paConditionDetail(name, extra){
  const d = paConditionEntry(name);
  const loaded = typeof _5eLoaded !== 'undefined' && _5eLoaded;
  let body;
  if (d && typeof renderConditionFull === 'function') body = renderConditionFull(d);
  else body = '<p class="pa-dim">' + (loaded ? 'No rules entry for this one — ask your DM.' : 'Loading the rules…') + '</p>';
  return `<div class="pa-conddet">
      <div class="pa-conddet-h"><b>${paEsc(name)}${extra ? ' <span class="pa-conddet-x">' + paEsc(extra) + '</span>' : ''}</b>
        <button class="pa-featdet-x" data-pa-condclose="1" aria-label="Close">✕</button></div>
      <div class="pa-conddet-b">${body}</div>
    </div>`;
}

// A lowered maximum: the bar is measured against the NORMAL maximum and the
// part taken away shows as a striped end; the You screen says it in words.
function paBarW(rec, pct){
  const g = (typeof sktHpBarParts === 'function') ? sktHpBarParts(rec || {}) : null;
  return (g && g.loss) ? g.pct : pct;
}
function paLostSeg(rec){
  const g = (typeof sktHpBarParts === 'function') ? sktHpBarParts(rec || {}) : null;
  return (g && g.loss) ? '<b class="pa-hp-lost" style="width:' + g.lostPct + '%"></b>' : '';
}
function paMaxLossLine(pc){
  const loss = (typeof sktMaxHpLoss === 'function') ? sktMaxHpLoss(pc) : 0;
  if (!loss) return '';
  return '<div class="pa-hp-loss">Max HP lowered by ' + loss + ' until a long rest (normally ' + pc.hpMaxNormal + ')'
    + (pc.hpMaxNote ? ' — ' + paEsc(pc.hpMaxNote) : '') + '</div>';
}

// ─── The player's own bookkeeping ─────────────────────────────────────────────
// Spending a slot, a Ki point or a hit die, and saying what you concentrate
// on, used to mean asking the DM to tap it on their screen. These write the
// character's own party record — the sync merges it field by field, so a
// player marking a slot and the DM changing HP at the same moment both land.
function paMyIdx(){ const id = paMe().pcId; return id ? (state.party || []).findIndex(p => p.id === id) : -1; }
function paTick(){ try { navigator.vibrate && navigator.vibrate(12); } catch(e){} }
function paTapResource(ri, refund){
  const i = paMyIdx(); if (i < 0) return;
  const pc = state.party[i], list = (pc.resources || []).slice(), r = list[ri]; if (!r) return;
  const max = Math.max(0, r.max || 0);
  const cur = Math.max(0, Math.min(max, (r.current || 0) + (refund ? 1 : -1)));
  if (cur === r.current) return;
  list[ri] = { ...r, current: cur };
  state.party[i] = { ...pc, resources: list };
  save(); paTick(); paRenderScreen();
}
function paTapSlot(level, refund){
  const i = paMyIdx(); if (i < 0) return;
  const pc = state.party[i];
  const slots = (pc.sheet && pc.sheet.spellSlots) || {}, s = slots[level]; if (!s) return;
  const total = s.total || 0;
  const exp = Math.max(0, Math.min(total, (s.expended || 0) + (refund ? -1 : 1)));
  if (exp === (s.expended || 0)) return;
  state.party[i] = { ...pc, sheet: { ...pc.sheet, spellSlots: { ...slots, [level]: { ...s, expended: exp } } } };
  save(); paTick(); paRenderScreen();
}
// Concentration lives on the party record — the combat card reads it there,
// so setting it here shows on the DM's tracker too.
function paConcRow(pc){
  if (pc.concentration){
    return '<div class="pa-conc">🌀 Concentrating on <b>' + paEsc(pc.concentration) + '</b>'
      + '<button class="btn small" data-pa-conc="drop">Drop</button></div>';
  }
  const caster = !!(pc.sheet && ((pc.sheet.spellSlots && Object.keys(pc.sheet.spellSlots).length) || (Array.isArray(pc.sheet.spells) && pc.sheet.spells.length)));
  return caster ? '<button class="pa-conc-set" data-pa-conc="set">🌀 Concentrate on a spell…</button>' : '';
}
function paSetConcentration(name){
  const i = paMyIdx(); if (i < 0) return;
  const pc = state.party[i], was = pc.concentration;
  state.party[i] = { ...pc, concentration: name || null };
  save(); paRenderScreen();
  try { panelDefs.combat && panelDefs.combat._render && panelDefs.combat._render(); } catch(e){}
  if (typeof showToast === 'function'){
    if (!name && was) showToast('🌀 ' + was + ' ends');
    else if (name) showToast('🌀 Concentrating on ' + name + (was && was !== name ? ' — ' + was + ' ends' : ''));
  }
}
function paPromptConcentration(){
  if (typeof showModal !== 'function') return;
  showModal('🌀 Concentrate on…', [
    { id: 'spell', label: 'Spell', type: 'text', value: '', placeholder: 'Bless, Hex, Hold Person…' },
  ], 'Concentrate').then(r => {
    const n = r && String(r.spell || '').trim();
    if (n) paSetConcentration(n);
  });
}
// Short rest: spend hit dice one at a time (the party sheet's own roll, so
// the house ruling on minimum healing is the same everywhere), then finish
// the rest — short-rest resources and Pact Magic come back, concentration
// and rage end, exactly as the DM's party short rest does.
// Who else is at the table, from a phone. Same list the DM sees, same
// Resync button — if the DM's laptop is the one that drifted, the player
// holding the phone can fix it without anyone getting up.
function paShowDevices(){
  document.getElementById('pa-devices')?.remove();
  if (typeof sktPresenceListHtml !== 'function') return;
  const ov = document.createElement('div');
  ov.id = 'pa-devices'; ov.className = 'pa-handout';
  const paint = () => {
    ov.innerHTML = '<div class="pa-ho-card" role="dialog" aria-modal="true" aria-label="Who is connected">'
      + '<div class="pa-ho-head"><b>Who&#8217;s connected</b></div>'
      + '<div class="pa-ho-body">' + sktPresenceListHtml() + '</div>'
      + '<div class="pa-rest-btns"><button class="btn" data-dev="close">Close</button></div></div>';
  };
  const t = setInterval(paint, 4000);
  ov.addEventListener('click', e => {
    if (e.target.closest('[data-dev="close"]') || e.target === ov){ clearInterval(t); ov.remove(); }
    else if (e.target.closest('[data-pres-resync]')) setTimeout(paint, 50);
  });
  paint();
  document.body.appendChild(ov);
}

function paOpenShortRest(req){
  const i = paMyIdx(); if (i < 0) return;
  document.getElementById('pa-rest')?.remove();
  const P = panelDefs.party;
  const ov = document.createElement('div');
  ov.id = 'pa-rest'; ov.className = 'pa-handout';
  // Opened by the DM's party short rest: finishing it tells the DM this
  // character is done, and the DM finishing the rest closes this screen.
  if (req && req.id) ov.dataset.rid = req.id;
  const log = [];
  const paint = () => {
    const pc = state.party[paMyIdx()]; if (!pc) return ov.remove();
    const hd = pc.hitDice || { current: 0, max: 0 };
    const con = (pc.abilities && typeof pc.abilities.con === 'number') ? Math.floor((pc.abilities.con - 10) / 2) : 0;
    ov.innerHTML = '<div class="pa-ho-card pa-rest-card" role="dialog" aria-modal="true" aria-label="Short rest">'
      + '<div class="pa-ho-head"><b>💤 Short rest</b></div>'
      + '<div class="pa-ho-body">'
      +   '<div class="pa-rest-hp">HP <b>' + pc.hp + '</b> / ' + pc.hpMax + ' · Hit dice <b>' + (hd.current || 0) + '/' + hd.max + '</b> ' + paEsc(hd.dieType || 'd8')
      +   ' · CON ' + (con >= 0 ? '+' : '') + con + '</div>'
      +   '<button class="btn primary pa-rest-spend" data-rest="spend"' + ((hd.current || 0) > 0 && pc.hp < pc.hpMax ? '' : ' disabled') + '>🎲 Spend a hit die</button>'
      +   (log.length ? '<div class="pa-rest-log">' + log.map(l => '<div>' + l + '</div>').join('') + '</div>' : '')
      + '</div>'
      + '<div class="pa-rest-btns"><button class="btn" data-rest="cancel">Not now</button>'
      + '<button class="btn primary" data-rest="finish">Finish the short rest</button></div></div>';
  };
  ov.addEventListener('click', e => {
    const b = e.target.closest('[data-rest]'); if (!b) return;
    const idx = paMyIdx(); if (idx < 0) return ov.remove();
    if (b.dataset.rest === 'spend' && P && typeof P._rollHitDie === 'function'){
      const r = P._rollHitDie(idx);
      if (r) log.push(paEsc('d' + r.sides + ' (' + r.roll + ') ' + (r.conMod >= 0 ? '+' : '') + r.conMod + ' = ' + r.heal + ' HP'));
      paTick(); paint(); paRenderScreen();
    } else if (b.dataset.rest === 'finish'){
      if (P && typeof P._shortRestOne === 'function'){ P._shortRestOne(state.party[idx], idx); save(); }
      if (ov.dataset.rid) paAnswerRoll(0, true);
      ov.remove(); paRenderScreen();
      if (typeof showToast === 'function') showToast('💤 Short rest done');
    } else if (b.dataset.rest === 'cancel') ov.remove();
  });
  paint();
  document.body.appendChild(ov);
}

const PA_DMG_TYPES = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'];
function paDeathBlock(c){
  if (c.dead) return '<div class="pa-death"><span class="pa-death-l">You have died.</span></div>';
  if (c.stable) return '<div class="pa-death"><span class="pa-death-l">Stable at 0 HP.</span></div>';
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
  // sktPlayerParty, not state.party: a rival is stored in the same array
  // and would otherwise appear here with its hit points on every phone.
  const list = sktPlayerParty();
  // A player can make their own character here; it joins the party like
  // any other and this phone becomes that character.
  const build = typeof openCharBuilder === 'function'
    ? '<button class="btn primary pa-build" data-pa-build="new">🧙 Build a new character</button>' : '';
  if (!list.length){
    return `<div class="pa-card">${typeof emptyState === 'function' ? emptyState({
      icon:'i-heart', title:'No party yet',
      hint:'Once the DM has added characters, pick yours here — or build one.' }) : 'No party yet.'}${build}</div>`;
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
    ${build}
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
  if (sh.size && sh.size !== 'Medium') bits.push(sh.size);
  if (sh.details && sh.details.alignment) bits.push(sh.details.alignment);
  if (typeof p.gold === 'number') bits.push(`${p.gold} gp`);

  const abils = PA_ABIL.filter(([k]) => typeof ab[k] === 'number').map(([k, l]) =>
    `<div class="pa-ab"><span class="pa-ab-l">${l}</span><span class="pa-ab-v">${ab[k]}</span>
      <span class="pa-ab-m">${paSign(paMod(ab[k]))}</span></div>`).join('');

  const saves = Object.keys(sh.saves || {}).filter(k => typeof sh.saves[k] === 'number')
    .map(k => `<span class="pa-kv"><b>${k.toUpperCase()}</b> ${paSign(sh.saves[k])}</span>`).join('');

  const skills = Object.keys(sh.skills || {}).filter(k => typeof sh.skills[k] === 'number')
    .sort((a, b) => (PA_SKILLS[a] || a).localeCompare(PA_SKILLS[b] || b))
    .map(k => `<span class="pa-kv"><b>${paEsc(PA_SKILLS[k] || k)}</b> ${paSign(sh.skills[k])}</span>`).join('');

  // One store for slots — resource pools named "Spell Slots L1" are migrated
  // into sheet.spellSlots on load, so there is nothing to de-duplicate here.
  const res = (p.resources || []).map(r =>
    `<span class="pa-kv"><b>${paEsc(r.name)}</b> ${r.current}/${r.max}</span>`).join('');
  const slots = sh.spellSlots ? Object.keys(sh.spellSlots).map(n => parseInt(n))
    .filter(n => n >= 1 && (sh.spellSlots[n].total || 0) > 0).sort((a, b) => a - b)
    .map(l => { const s = sh.spellSlots[l];
      return `<span class="pa-kv"><b>Slots L${l}</b> ${(s.total || 0) - (s.expended || 0)}/${s.total || 0}</span>`;
    }).join('') : '';

  const atks = (Array.isArray(sh.attacks) ? sh.attacks : []).filter(a => a && a.name).map(a =>
    `<div class="pa-mate-atk"><b>${paEsc(a.name)}</b>
      <span>${paEsc(a.atkBonus || '')}${a.atkBonus && a.damage ? ' · ' : ''}${paEsc(a.damage || '')}</span></div>`).join('');

  const spells = (Array.isArray(sh.spells) ? sh.spells : [])
    .map(s => `<span class="pa-chip">${paEsc(s)}</span>`).join('');
  // A wizard's book holds more than is prepared today.
  const book = (Array.isArray(sh.spellbook) ? sh.spellbook : []).filter(s => !(sh.spells || []).includes(s))
    .map(s => `<span class="pa-chip dim">${paEsc(s)}</span>`).join('');
  // Who they are, from the builder's Details step.
  const det = sh.details || {};
  const about = [['appearance', 'Appearance'], ['personality', 'Personality'], ['ideals', 'Ideals'], ['bonds', 'Bonds'], ['flaws', 'Flaws'], ['backstory', 'Backstory']]
    .filter(([k]) => det[k]).map(([k, l]) => `<div class="pa-about"><b>${l}</b><div>${paEsc(det[k]).replace(/\n/g, '<br>')}</div></div>`).join('');
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
    ${sec('Also in the spellbook', book)}
    ${about ? `<div class="pa-mate-sec"><h5>About</h5>${about}</div>` : ''}
  </div>`;
}

function paPartyScreen(){
  // A rival is not one of the players, so it is not on the list of who you
  // might be.
  const list = sktPlayerParty();
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
        <span class="pa-hp-bar sm"><i style="width:${paBarW(c || p, pct)}%;background:${col}"></i>${paLostSeg(c || p)}</span>
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
  // A phone is the easiest place to hit the wrong button, so the same undo
  // the DM gets is on the toast here too.
  if (typeof sktUndoable === 'function'){
    const label = (sign < 0 ? 'Took ' : 'Healed ') + n;
    return sktUndoable(label, () => _paApplyHp(sign, n));
  }
  return _paApplyHp(sign, n);
}
function _paApplyHp(sign, n){
  const pc = paPc(); if (!pc) return;
  const c = paCombatant();
  const C = panelDefs.combat, P = panelDefs.party;
  const type = (document.getElementById('pa-hp-type') || {}).value || null;
  const pi = (state.party || []).indexOf(pc);
  if (c && C && typeof C._applyHpDelta === 'function'){
    const i = (state.combatants || []).indexOf(c);
    if (i >= 0) C._applyHpDelta(i, sign < 0 ? -n : n, sign < 0 ? type : null);
  } else if (P && typeof P._applyHpDelta === 'function' && pi >= 0){
    // Out of a fight the party card's own rules: temporary hit points soak
    // first and resistances apply. This used to subtract straight from hp.
    P._applyHpDelta(pi, sign < 0 ? -n : n, sign < 0 ? type : null);
  } else {
    // Not in the fight — write to the party slot directly, then mirror. The
    // mirror is not dead code just because paCombatant() found nothing:
    // paCombatant() matches on id only, while syncPartyToCombat falls back to
    // a normalized name, so a PC added to the tracker by hand under a
    // slightly different id lands here and MUST still update their combat
    // card. Without it the two records drift and never converge.
    const before = pc.hp;
    pc.hp = Math.max(0, Math.min(pc.hpMax, before + (sign < 0 ? -n : n)));
    const pi = (state.party || []).indexOf(pc);
    if (pi >= 0 && typeof syncPartyToCombat === 'function') syncPartyToCombat(pi);
  }
  save(); paRender();
}

// Temporary hit points don't stack: the higher of the two stays.
function paSetTemp(){
  const pc = paPc(); if (!pc) return;
  const n = Math.abs(parseInt((document.getElementById('pa-hp-amt') || {}).value, 10) || 0);
  const run = () => { pc.tempHp = Math.max(pc.tempHp || 0, n); save(); paRender(); };
  if (typeof sktUndoable === 'function') return sktUndoable('Temp HP ' + n, run);
  run();
}
function paLongRest(){
  const pc = paPc(); if (!pc) return;
  const pi = state.party.indexOf(pc), P = panelDefs.party;
  if (pi < 0 || !P) return;
  const go = () => {
    const run = () => { P._longRestOne(pc, pi); save(); paRender(); };
    if (typeof sktUndoable === 'function') sktUndoable(pc.name + ' took a long rest', run); else run();
    if (typeof showToast === 'function') showToast('🛌 Long rest: hit points, slots and features back');
  };
  if (typeof showConfirm === 'function')
    showConfirm('Hit points to full, half your hit dice, every spell slot and feature back, one level of exhaustion gone.', { title: 'Long rest', confirmLabel: 'Rest' }).then(ok => { if (ok) go(); });
  else go();
}

function paRollAttack(i){
  const pc = paPc(); if (!pc) return;
  const a = (pc.sheet && pc.sheet.attacks || [])[i]; if (!a) return;
  const d = sktD;                       // shared roller, see js/core/utils.js
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
  const pc = paPc(); if (!pc || typeof sktRollDeathSave !== 'function') return;
  const msg = sktRollDeathSave(pc).msg;
  save();
  const box = document.getElementById('pa-roll');
  if (box) box.innerHTML = `<div class="pa-roll-in"><span class="pa-roll-l">Death save</span>
    <span class="pa-roll-hit">${paEsc(msg)}</span></div>`;
  paRender();
}

function paOnClick(e){
  const ho = e.target.closest('[data-pa-ho]');
  if (ho){ paShowHandout(ho.dataset.paHo, false); return; }
  const tab = e.target.closest('[data-pa-tab]');
  if (tab){ paTab = tab.dataset.paTab; paRender(); return; }
  const pick = e.target.closest('[data-pa-pick]');
  if (pick){ paSetPc(pick.dataset.paPick); paRender(); return; }
  if (e.target.closest('[data-pa-swap]')){ paSetPc(null); paRender(); return; }
  const bld = e.target.closest('[data-pa-build]');
  if (bld && typeof openCharBuilder === 'function'){
    if (bld.dataset.paBuild === 'new'){
      openCharBuilder({ onDone: rec => { if (rec && rec.id){ paSetPc(rec.id); paTab = 'you'; paRender(); } } });
    } else {
      const i = paMyIdx();
      if (i >= 0) openCharBuilder({ idx: i, levelup: true, onDone: () => paRender() });
    }
    return;
  }
  const hp = e.target.closest('[data-pa-hp]');
  if (hp){ paApplyHp(+hp.dataset.paHp); return; }
  const atk = e.target.closest('[data-pa-atk]');
  if (atk){ paRollAttack(+atk.dataset.paAtk); return; }
  const feat = e.target.closest('[data-pa-feat]');
  if (feat){ paPickActivation(+feat.dataset.paFeat); return; }
  const featUse = e.target.closest('[data-pa-featuse]');
  if (featUse){ paUseActivation(+featUse.dataset.paFeatuse); return; }
  if (e.target.closest('[data-pa-featclose]')){ paFeatOpen = null; paRender(); return; }
  const rp = e.target.closest('[data-pa-res]');
  if (rp){ paTapResource(+rp.dataset.paRes, rp.classList.contains('off')); return; }
  const sp = e.target.closest('[data-pa-slot]');
  if (sp){ paTapSlot(sp.dataset.paSlot, sp.classList.contains('off')); return; }
  const cc = e.target.closest('[data-pa-conc]');
  if (cc){ cc.dataset.paConc === 'drop' ? paSetConcentration(null) : paPromptConcentration(); return; }
  if (e.target.closest('[data-pa-rest]')){ paOpenShortRest(); return; }
  if (e.target.closest('[data-pa-longrest]')){ paLongRest(); return; }
  if (e.target.closest('[data-pa-temp]')){ paSetTemp(); return; }
  if (e.target.closest('[data-pa-insp]')){
    const pc = paPc(); if (!pc) return;
    const run = () => { pc.inspiration = false; save(); paRender(); };
    if (typeof sktUndoable === 'function') sktUndoable('Spent Heroic Inspiration', run); else run();
    return;
  }
  const cond = e.target.closest('[data-pa-cond]');
  if (cond){ paCondOpen = paCondOpen === cond.dataset.paCond ? null : cond.dataset.paCond; paRenderScreen(); return; }
  if (e.target.closest('[data-pa-condclose]')){ paCondOpen = null; paRenderScreen(); return; }
  if (e.target.closest('[data-pa-death]')){ paRollDeathSave(); return; }
  const sheetBtn = e.target.closest('[data-pa-sheet]');
  if (sheetBtn && typeof openCharSheet === 'function'){ openCharSheet(sheetBtn.dataset.paSheet); return; }
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
