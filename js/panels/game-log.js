// ============================================================
// GAME LOG — everyone's rolls, in order, on every screen
// ============================================================
// Every roll a character makes already passes through sktKeepRoll (the sheet,
// the phone's checks, attacks and casts), which kept the last six on the
// character and popped a toast on the DM's screen. Nothing showed the table's
// rolls together: a player's attack on their phone was a toast the DM might
// miss, and the other players never saw it at all.
//
// The log is one synced key, a list of entries with ids, so two phones rolling
// at the same moment both land (whole keys merge by record id). The DM's own
// quick rolls can stay private: those live in a device-only key and show only
// on the DM's screen. Kept to the last SKT_LOG_MAX entries.
//
// Also here: sktRollExpr, a dice-expression roller ("2d6+3", "1d8+1d6+2",
// "2d20kh1", "4d6dl1", "d20+5 Stealth"), and the quick roller that feeds the
// log — in this window, on the phone's Game log screen, and in search.

const SKT_LOG_KEY = 'skt-gamelog-v1';
const SKT_LOG_PRIVATE_KEY = 'skt-gamelog-private-v1';   // the DM's hidden rolls, this device only
const SKT_LOG_MAX = 100;

function _sktLogRead(k){ try { const a = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(a) ? a.filter(e => e && e.id) : []; } catch(e){ return []; } }
function sktLogEntries(){
  return _sktLogRead(SKT_LOG_KEY).concat(_sktLogRead(SKT_LOG_PRIVATE_KEY)).sort((a, b) => (a.at || 0) - (b.at || 0));
}
// Add one entry. `hidden` keeps it on this device (the DM rolling in secret).
function sktLogAdd(e, hidden){
  const entry = Object.assign({ id: 'g' + (typeof uid === 'function' ? uid() : Date.now().toString(36)), at: Date.now() }, e);
  const k = hidden ? SKT_LOG_PRIVATE_KEY : SKT_LOG_KEY;
  if (hidden) entry.hidden = true;
  const list = _sktLogRead(k).concat([entry]).slice(-SKT_LOG_MAX);
  try { localStorage.setItem(k, JSON.stringify(list)); } catch(err){ if (typeof warnStorageFailure === 'function') warnStorageFailure('game log', err); }
  sktLogChanged();
  return entry;
}
// Something changed (here, or arriving from another device): redraw what shows it.
function sktLogChanged(){
  try { const P = panelDefs.gamelog; if (P && P._body) P._render(); else if (P) P._badge(); } catch(e){}
  try { if (typeof paOnGameLog === 'function') paOnGameLog(); } catch(e){}
}
// Who is rolling on this device, for a roll that isn't from a sheet.
function sktLogMe(){
  if (document.body.classList.contains('player-mode') && typeof paPc === 'function'){
    const pc = paPc(); if (pc) return { who: pc.name, pcId: pc.id, from: 'player' };
    return { who: 'Player', from: 'player' };
  }
  return { who: 'DM', from: 'dm' };
}

// ── Dice expressions ─────────────────────────────────────────────────────────
// Terms joined by + or −: NdS (N up to 100, S up to 1000), with an optional
// kh/kl/dh/dl/k count (keep or drop highest/lowest), or a plain number. What
// follows the dice is the label: "2d6+3 fire" rolls 2d6+3 labelled "fire".
// Returns null when the text doesn't start with dice.
function sktRollExpr(input){
  let s = String(input || '').trim(), rest = s;
  const terms = [];
  const re = /^\s*([+\-−])?\s*(?:(\d*)\s*d\s*(\d+)(?:\s*(kh|kl|dh|dl|k)\s*(\d+))?|(\d+))(?![a-z\d])/i;
  let m, first = true;
  while ((m = re.exec(rest)) && terms.length < 20){
    if (!first && !m[1]) break;                // "2d6 3" — the 3 starts the label
    const sign = m[1] === '-' || m[1] === '−' ? -1 : 1;
    if (m[3] != null){
      const n = Math.min(100, Math.max(1, parseInt(m[2] || '1', 10))), sides = Math.min(1000, Math.max(1, parseInt(m[3], 10)));
      terms.push({ sign, n, sides, op: m[4] ? m[4].toLowerCase() : '', k: m[5] != null ? Math.min(n, parseInt(m[5], 10)) : null });
    } else terms.push({ sign, value: parseInt(m[6], 10) });
    rest = rest.slice(m[0].length); first = false;
  }
  if (!terms.some(t => t.sides)) return null;
  const label = rest.replace(/^[\s:,—-]+/, '').trim();
  let total = 0;
  const parts = terms.map(t => {
    if (t.value != null){ total += t.sign * t.value; return { t, text: String(t.value) }; }
    const rolls = []; for (let i = 0; i < t.n; i++) rolls.push(typeof sktD === 'function' ? sktD(t.sides) : 1 + Math.floor(Math.random() * t.sides));
    const order = rolls.map((v, i) => i).sort((a, b) => rolls[a] - rolls[b]);   // low → high
    const keep = new Set(rolls.map((v, i) => i));
    if (t.op && t.k != null){
      const c = Math.max(0, Math.min(t.n, t.k));
      const op = t.op === 'k' ? 'kh' : t.op;
      if (op === 'kh') order.slice(0, t.n - c).forEach(i => keep.delete(i));
      if (op === 'kl') order.slice(c).forEach(i => keep.delete(i));
      if (op === 'dh') order.slice(t.n - c).forEach(i => keep.delete(i));
      if (op === 'dl') order.slice(0, c).forEach(i => keep.delete(i));
    }
    const sum = rolls.reduce((a, v, i) => a + (keep.has(i) ? v : 0), 0);
    total += t.sign * sum;
    return { t, rolls, keep, text: t.n + 'd' + t.sides + (t.op ? t.op + t.k : '') + ' (' + rolls.map((v, i) => keep.has(i) ? String(v) : '~~' + v + '~~').join(', ') + ')' };
  });
  const expr = parts.map((p, i) => (i ? (p.t.sign < 0 ? ' − ' : ' + ') : (p.t.sign < 0 ? '−' : '')) + (p.t.value != null ? p.t.value : p.t.n + 'd' + p.t.sides + (p.t.op ? p.t.op + p.t.k : ''))).join('');
  const detail = parts.map((p, i) => (i ? (p.t.sign < 0 ? ' − ' : ' + ') : (p.t.sign < 0 ? '−' : '')) + p.text).join('').replace(/~~(\d+)~~/g, '$1̶');
  // A single kept d20 (a check, or advantage as 2d20kh1): its natural roll.
  const dice = parts.filter(p => p.t.sides);
  let natural = null;
  if (dice.length === 1 && dice[0].t.sides === 20 && [...dice[0].keep].length === 1) natural = dice[0].rolls[[...dice[0].keep][0]];
  return { expr, label, total, detail, natural, crit: natural === 20, fumble: natural === 1,
           d20: natural != null, mod: terms.filter(t => t.value != null).reduce((a, t) => a + t.sign * t.value, 0),
           rolls: natural != null ? dice[0].rolls : null };
}

// Roll typed text and show it: the dice tray on the DM screen, the roll card on
// the phone, and the log everywhere (or only here, when hidden).
function sktQuickRoll(text, opts){
  opts = opts || {};
  const r = sktRollExpr(text);
  if (!r){ if (typeof showToast === 'function') showToast('That isn’t a dice roll — try 2d6+3 or 1d20+5'); return null; }
  const me = sktLogMe(), label = r.label || r.expr;
  const fx = r.d20 ? { label, total: r.total, natural: r.natural, rolls: r.rolls, mod: r.mod, mode: 'normal', crit: r.crit, fumble: r.fumble }
                   : { kind: 'dmg', label, total: r.total, expr: r.expr, detail: r.detail };
  if (document.body.classList.contains('player-mode') && typeof paShowRoll === 'function'){
    const die = typeof sktDieHtml === 'function' ? sktDieHtml(r.d20 ? 20 : sktDieSides(fx), r.d20 ? r.natural : r.total, r.crit ? 'crit' : r.fumble ? 'fumble' : '') : '';
    paShowRoll('<div class="pa-roll-in' + (r.crit ? ' crit' : r.fumble ? ' fumble' : '') + '">' + die + '<span class="pa-roll-l">' + esc(label) + '</span>'
      + '<span class="pa-roll-hit">' + r.total + '</span><span class="pa-roll-d">' + esc(r.detail) + '</span></div>');
  } else if (!(typeof sktDiceFx === 'function' && sktDiceFx(fx)) && typeof showToast === 'function') showToast('🎲 ' + label + ': ' + r.total + ' — ' + r.detail);
  sktLogAdd(Object.assign({}, me, { kind: 'free', label, total: r.total, text: r.detail, expr: r.expr, crit: r.crit || undefined, fumble: r.fumble || undefined }), !!opts.hidden);
  return r;
}

// ── Drawing the log ──────────────────────────────────────────────────────────
function _sktLogColour(e){
  if (e.from === 'dm' && !e.pcId) return 'var(--accent)';
  const pc = e.pcId && (state.party || []).find(p => p.id === e.pcId);
  const c = pc && (pc.theme || (panelDefs.party && panelDefs.party._classColor ? panelDefs.party._classColor(pc) : ''));
  return c ? 'color-mix(in srgb, ' + c + ' 75%, var(--text))' : 'var(--text)';
}
function _sktLogAgo(at){
  const s = Math.max(0, Math.round((Date.now() - (at || 0)) / 1000));
  if (s < 45) return 'now';
  if (s < 3600) return Math.round(s / 60) + 'm';
  if (s < 86400) return Math.round(s / 3600) + 'h';
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function sktLogHtml(entries){
  if (!entries.length) return typeof emptyState === 'function'
    ? emptyState({ icon: 'i-dice', title: 'No rolls yet', hint: 'Rolls from every sheet and phone show up here, newest at the bottom.', roomy: true })
    : '<div class="glog-empty">No rolls yet. Rolls from every sheet and phone show up here.</div>';
  let last = 0, h = '';
  entries.forEach(e => {
    // A gap of half an hour or more: a break, marked with the time.
    if (e.at - last > 30 * 60 * 1000) h += '<div class="glog-gap">' + esc(new Date(e.at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })) + '</div>';
    last = e.at;
    // A sheet roll's text starts with its total ("17 (d20 15 +2)"); a quick roll's is the dice.
    const detail = String(e.text || '').replace(/^\s*-?\d+(?=\s|\(|$)\s*/, '').replace(/^—\s*/, '');
    h += '<div class="glog-e' + (e.crit ? ' crit' : '') + (e.fumble ? ' fumble' : '') + (e.hidden ? ' hidden' : '') + '" data-glog-id="' + esc(e.id) + '">'
      + '<span class="glog-who" style="color:' + _sktLogColour(e) + '">' + esc(e.who || '?') + (e.hidden ? ' <i class="glog-lock" title="Only you can see this roll">' + ICO('i-lock') + '</i>' : '') + '</span>'
      + '<span class="glog-l">' + esc(e.label || 'Roll') + '</span>'
      + '<b class="glog-t">' + esc(String(e.total)) + '</b>'
      + (detail ? '<span class="glog-d">' + esc(detail) + '</span>' : '')
      + '<time class="glog-at" datetime="' + new Date(e.at).toISOString() + '">' + _sktLogAgo(e.at) + '</time></div>';
  });
  return h;
}
// The quick roller's row: a box for any expression, and the common dice.
function sktLogRollerHtml(withHidden){
  return '<div class="glog-roller"><form class="glog-form" data-glog-form>'
    + '<input type="text" class="glog-input" data-glog-input autocomplete="off" spellcheck="false" placeholder="Roll… 2d6+3, 1d20+5 Stealth, 2d20kh1" aria-label="Dice to roll">'
    + '<button class="btn primary" type="submit">Roll</button></form>'
    + '<div class="glog-dice">' + [4, 6, 8, 10, 12, 20, 100].map(d => '<button type="button" class="glog-die" data-glog-die="' + d + '">d' + d + '</button>').join('')
    + (withHidden ? '<label class="glog-hidden" title="Your roll shows only on this screen"><input type="checkbox" data-glog-hidden' + (sktLogHiddenPref() ? ' checked' : '') + '> Only me</label>' : '')
    + '</div></div>';
}
function sktLogHiddenPref(){ try { return localStorage.getItem('skt-gamelog-hide-v1') !== '0'; } catch(e){ return true; } }
// Wire a roller inside `root` (the window body, or the phone's screen).
function sktLogWireRoller(root, opts){
  const form = root.querySelector('[data-glog-form]'), inp = root.querySelector('[data-glog-input]');
  const hidden = () => { const c = root.querySelector('[data-glog-hidden]'); return !!(c && c.checked); };
  if (form) form.addEventListener('submit', e => {
    e.preventDefault();
    const v = inp.value.trim(); if (!v) return;
    if (sktQuickRoll(v, { hidden: hidden() })){ inp.value = ''; if (opts && opts.onRoll) opts.onRoll(); }
  });
  root.querySelectorAll('[data-glog-die]').forEach(b => b.addEventListener('click', () => {
    // A typed modifier or label still applies: "+3" then d8 rolls 1d8+3.
    const extra = inp && inp.value.trim();
    const expr = '1d' + b.dataset.glogDie + (extra && /^[+\-−]/.test(extra) ? extra : extra ? ' ' + extra : '');
    sktQuickRoll(expr, { hidden: hidden() });
    if (inp) inp.value = '';
    if (opts && opts.onRoll) opts.onRoll();
  }));
  const hc = root.querySelector('[data-glog-hidden]');
  if (hc) hc.addEventListener('change', () => { try { localStorage.setItem('skt-gamelog-hide-v1', hc.checked ? '1' : '0'); } catch(e){} });
}

// ── The DM's window ──────────────────────────────────────────────────────────
registerPanel('gamelog', {
  title: 'Game Log', icon: '🎲',
  _seen: 0,
  mount(body){ this._body = body; this._render(); },
  unmount(){ this._body = null; },
  _render(){
    const b = this._body; if (!b) return;
    const list = b.querySelector('.glog-list');
    const atBottom = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    const typed = b.querySelector('[data-glog-input]'), keep = typed ? typed.value : '', focused = typed && document.activeElement === typed;
    if (!b.querySelector('.glog')){
      b.innerHTML = '<div class="glog">' + sktLogRollerHtml(true) + '<div class="glog-list" role="log" aria-live="polite"></div>'
        + '<div class="glog-foot"><span class="glog-count"></span><button class="btn small" data-glog-clear>Clear the log</button></div></div>';
      sktLogWireRoller(b);
      b.querySelector('[data-glog-clear]').addEventListener('click', () => {
        const go = () => { try { localStorage.setItem(SKT_LOG_KEY, '[]'); localStorage.setItem(SKT_LOG_PRIVATE_KEY, '[]'); } catch(e){} sktLogChanged(); };
        if (typeof showConfirm === 'function') showConfirm('Clear the game log on every screen?', { title: 'Clear the log', confirmLabel: 'Clear', danger: true }).then(ok => { if (ok) go(); });
        else go();
      });
    }
    const entries = sktLogEntries();
    const l = b.querySelector('.glog-list');
    l.innerHTML = sktLogHtml(entries);
    b.querySelector('.glog-count').textContent = entries.length ? entries.length + ' roll' + (entries.length === 1 ? '' : 's') : '';
    // Nothing to clear on an empty log, so no button offering to.
    b.querySelector('.glog-foot').style.display = entries.length ? '' : 'none';
    if (atBottom) l.scrollTop = l.scrollHeight;
    const t2 = b.querySelector('[data-glog-input]'); if (t2 && keep){ t2.value = keep; } if (t2 && focused) t2.focus();
    this._seen = Date.now(); this._badge();
  },
  // Rolls since the window was last looked at, on its dock button.
  _badge(){
    const btn = document.querySelector('.dock-btn[data-panel="gamelog"]'); if (!btn) return;
    const open = !!this._body;
    const n = open ? 0 : _sktLogRead(SKT_LOG_KEY).filter(e => (e.at || 0) > (this._seen || this._loadedAt) && e.from === 'player').length;
    let badge = btn.querySelector('.dock-badge');
    if (!n){ if (badge) badge.remove(); return; }
    if (!badge){ badge = document.createElement('span'); badge.className = 'dock-badge'; btn.appendChild(badge); }
    badge.textContent = n > 9 ? '9+' : String(n);
  },
  _loadedAt: Date.now(),
});
// The relative times ("2m") stay right while the window is open.
setInterval(() => { try { const P = panelDefs.gamelog; if (P && P._body) P._body.querySelectorAll('.glog-at').forEach(t => { const at = Date.parse(t.getAttribute('datetime')); if (at) t.textContent = _sktLogAgo(at); }); } catch(e){} }, 30000);
