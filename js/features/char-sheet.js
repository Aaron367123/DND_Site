// ============================================================
// THE CHARACTER SHEET
// ============================================================
// A full sheet for one party member, laid out like D&D Beyond's: the numbers
// down the side (abilities, saving throws, skills, senses, proficiencies),
// hit points and the day's state across the top, and tabs for Actions,
// Spells, Inventory, Features & Traits, Background and Notes. The DM opens it
// from a party card; a player from their phone for their own character, and
// read-only for anyone else's.
//
// It edits the party record and saves, like every other panel. A character
// made in the builder is worked out again from its build after a change that
// moves the numbers (preparing a spell, equipping armour, a custom bonus) —
// the same call the builder makes when it saves.

let CS = null;   // { id, tab, mode, readOnly, log, R, open, q }

const CS_TABS = [
  // On a phone the side column becomes the first tab.
  { id: 'abilities', label: 'Abilities & Skills', phone: true },
  { id: 'actions',   label: 'Actions' },
  { id: 'spells',    label: 'Spells' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'features',  label: 'Features & Traits' },
  { id: 'background',label: 'Background' },
  { id: 'notes',     label: 'Notes' },
];
const CS_CONDITIONS = ['Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible',
                       'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious'];
const CS_XP = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
const CS_AB = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const CS_SKILLS = {
  acrobatics: ['Acrobatics', 'dex'], animal_handling: ['Animal Handling', 'wis'], arcana: ['Arcana', 'int'], athletics: ['Athletics', 'str'],
  deception: ['Deception', 'cha'], history: ['History', 'int'], insight: ['Insight', 'wis'], intimidation: ['Intimidation', 'cha'],
  investigation: ['Investigation', 'int'], medicine: ['Medicine', 'wis'], nature: ['Nature', 'int'], perception: ['Perception', 'wis'],
  performance: ['Performance', 'cha'], persuasion: ['Persuasion', 'cha'], religion: ['Religion', 'int'], sleight_of_hand: ['Sleight of Hand', 'dex'],
  stealth: ['Stealth', 'dex'], survival: ['Survival', 'wis'],
};

// ── Opening and closing ──────────────────────────────────────────────────────
function openCharSheet(id, opts){
  opts = opts || {};
  const pc = (state.party || []).find(p => p.id === id); if (!pc) return;
  document.getElementById('cs-root')?.remove();
  // A player may change only their own character.
  const mine = typeof paMe === 'function' ? paMe().pcId === id : true;
  const isPlayer = document.body.classList.contains('player-mode');
  const narrow = window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
  CS = { id, tab: opts.tab || (narrow ? 'abilities' : 'actions'), mode: 'normal', readOnly: isPlayer && !mine, log: [], R: null, open: {}, q: '' };
  const root = document.createElement('div');
  root.id = 'cs-root'; root.className = 'cb cs';
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Character sheet');
  document.body.appendChild(root);
  root.addEventListener('click', csOnClick);
  root.addEventListener('change', csOnChange);
  root.addEventListener('input', csOnInput);
  document.addEventListener('keydown', csOnKey);
  csRender();
  // The rules data, for spell details and for working a built character out
  // again. The sheet draws without it.
  const ed = (pc.build && pc.build.edition) || pc.rules || '2024';
  if (typeof sktRulesLoad === 'function') sktRulesLoad(ed).then(R => { if (CS && CS.id === id){ CS.R = R; csRender(); } }).catch(() => {});
}
function csClose(){
  document.getElementById('cs-root')?.remove();
  document.removeEventListener('keydown', csOnKey);
  CS = null;
}
function csOnKey(e){ if (e.key === 'Escape' && CS) csClose(); }
function csPc(){ return CS ? (state.party || []).find(p => p.id === CS.id) || null : null; }
function csIdx(){ return CS ? (state.party || []).findIndex(p => p.id === CS.id) : -1; }
function csE(s){ return typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function csSigned(n){ n = +n || 0; return (n >= 0 ? '+' : '') + n; }
function csMod(score){ return Math.floor(((+score || 10) - 10) / 2); }

// Redraw, keeping the scroll positions (the sheet is long on a phone).
function csRender(){
  const root = document.getElementById('cs-root'); if (!root || !CS) return;
  const pc = csPc(); if (!pc){ csClose(); return; }
  const keep = [...root.querySelectorAll('[data-cs-scroll]')].map(e => [e.dataset.csScroll, e.scrollTop]);
  root.innerHTML = csHead(pc) + '<div class="cs-body"><aside class="cs-side" data-cs-scroll="side">' + csSide(pc) + '</aside>'
    + '<div class="cs-main" data-cs-scroll="main">' + (CS.customize && !CS.readOnly ? csCustomizeHtml(pc) : '') + csTop(pc)
    + '<nav class="cs-tabs">' + CS_TABS.map(t => '<button class="cs-tab' + (t.phone ? ' cs-phone' : '') + (CS.tab === t.id ? ' on' : '') + '" data-cs-tab="' + t.id + '">' + t.label + '</button>').join('') + '</nav>'
    + '<div class="cs-pane">' + (CS_TAB_RENDER[CS.tab] || (() => ''))(pc) + '</div></div></div>';
  keep.forEach(([k, t]) => { const e = root.querySelector('[data-cs-scroll="' + k + '"]'); if (e) e.scrollTop = t; });
}
// Save, mirror to the combat card, redraw everything that shows this PC.
function csCommit(){
  const i = csIdx();
  save();
  if (i >= 0 && typeof syncPartyToCombat === 'function') syncPartyToCombat(i);
  try { panelDefs.party && panelDefs.party._render && panelDefs.party._render(); } catch(e){}
  if (typeof paRender === 'function' && document.body.classList.contains('player-mode')) { try { paRender(); } catch(e){} }
  csRender();
}
function csEdit(label, fn){
  if (CS.readOnly) return;
  const run = () => { const pc = csPc(); if (pc) fn(pc); csCommit(); };
  if (typeof sktUndoable === 'function') sktUndoable(label, run); else run();
}
// A built character worked out again after a change to its build.
async function csRebuild(label, mut){
  if (CS.readOnly) return;
  const pc = csPc(); if (!pc || !pc.build || typeof sktComputeCharacter !== 'function') return;
  const R = CS.R || await sktRulesLoad(pc.build.edition || pc.rules || '2024');
  const run = () => {
    const i = csIdx(); const p = state.party[i]; if (!p) return;
    const b = JSON.parse(JSON.stringify(p.build));
    mut(b);
    const rec = sktComputeCharacter(b, R, p);
    state.party[i] = Object.assign({}, p, rec, { id: p.id, portrait: p.portrait });
    csCommit();
  };
  if (typeof sktUndoable === 'function') sktUndoable(label, run); else run();
}

// ── The header: who, and the day's buttons ───────────────────────────────────
function csClassLine(pc){
  const sh = pc.sheet || {};
  const cl = Array.isArray(sh.classLevels) && sh.classLevels.length > 1
    ? sh.classLevels.map(p => _csTitle(p.cls) + ' ' + p.level).join(' / ')
    : [_csTitle(pc.cls || sh.class || ''), pc.subclass ? '(' + pc.subclass + ')' : '', pc.level ? 'Level ' + pc.level : ''].filter(Boolean).join(' ');
  return [pc.race || sh.race || '', cl].filter(Boolean).join(' · ');
}
function _csTitle(s){ s = String(s || ''); return s ? s.replace(/\b\w/g, c => c.toUpperCase()) : ''; }
function csHead(pc){
  const icon = typeof renderIcon === 'function' ? renderIcon(pc.icon, pc.name) : csE(String(pc.name || '?').charAt(0));
  const ro = CS.readOnly;
  const xpOn = pc.build && pc.build.advancement === 'xp';
  const lvl = pc.level || 1, xp = +pc.xp || 0, next = CS_XP[Math.min(19, lvl)];
  const ready = xpOn && lvl < 20 && xp >= next;
  return '<div class="cb-head cs-head"><span class="cs-avatar">' + icon + '</span>'
    + '<div class="cs-who"><b class="cb-title">' + csE(pc.name) + '</b><span class="cs-sub">' + csE(csClassLine(pc)) + '</span>'
    + (xpOn ? '<span class="cs-xp' + (ready ? ' ready' : '') + '">XP ' + xp.toLocaleString() + (lvl < 20 ? ' / ' + next.toLocaleString() : '')
      + '<i class="cs-xpbar"><i style="width:' + (lvl < 20 ? Math.min(100, Math.round(100 * (xp - CS_XP[lvl - 1]) / Math.max(1, next - CS_XP[lvl - 1]))) : 100) + '%"></i></i>'
      + (ro ? '' : '<input type="number" min="0" data-cs-xp placeholder="+XP" aria-label="Add experience points"><button class="btn small" data-cs="addxp">Add</button>') + '</span>' : '')
    + '</div>'
    + (ro ? '' : '<button class="btn" data-cs="short">💤 Short rest</button><button class="btn" data-cs="long">🛌 Long rest</button>')
    + (!ro && pc.build && typeof openCharBuilder === 'function' ? '<button class="btn' + (ready ? ' primary' : '') + '" data-cs="levelup"' + ((pc.build.level || 1) >= 20 ? ' disabled' : '') + '>⬆ Level up</button><button class="btn" data-cs="edit">Edit</button>' : '')
    + (!ro && pc.build ? '<button class="btn" data-cs="customize" title="Custom bonuses">⚙ Customize</button>' : '')
    + '<button class="cb-x" data-cs="close" aria-label="Close">✕</button></div>';
}

// ── Across the top: hit points, defences, the day's state, rolls ─────────────
function csTop(pc){
  const ro = CS.readOnly, sh = pc.sheet || {};
  const hold = typeof sktDeathSaveHolder === 'function' ? sktDeathSaveHolder(pc) : pc;
  const hp = Math.max(0, pc.hp || 0), max = pc.hpMax || 0;
  const pct = max ? Math.max(0, Math.min(100, Math.round(100 * hp / max))) : 0;
  const conds = typeof _csConditions === 'function' ? _csConditions(pc) : [];
  let h = '<div class="cs-top">';
  // Hit points.
  h += '<div class="cs-hp"><div class="cs-hp-n"><b>' + hp + '</b><span>/ ' + max + '</span>'
    + (pc.tempHp > 0 ? '<i title="Temporary hit points">+' + pc.tempHp + ' temp</i>' : '') + '</div>'
    + '<div class="cs-hpbar"><i style="width:' + pct + '%"></i></div>'
    + (ro ? '' : '<div class="cs-hp-ctl"><input type="number" min="0" data-cs-amt value="' + (CS.amt || 5) + '" aria-label="Amount">'
      + '<button class="btn" data-cs-hp="-1">Damage</button><button class="btn" data-cs-hp="1">Heal</button><button class="btn" data-cs-hp="temp">Temp</button>'
      + '<select class="cb-sel" data-cs-dtype aria-label="Damage type"><option value="">type…</option>' + ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder']
        .map(t => '<option' + (CS.dtype === t ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></div>')
    + '</div>';
  // The boxes D&D Beyond puts along the top.
  const box = (l, v, act, title) => '<' + (act ? 'button data-cs-roll="' + act + '"' : 'div') + ' class="cs-box"' + (title ? ' title="' + csE(title) + '"' : '') + '><span>' + l + '</span><b>' + v + '</b></' + (act ? 'button' : 'div') + '>';
  h += '<div class="cs-boxes">' + box('AC', pc.ac ?? '—', null, sh.acSource || '')
    + box('Initiative', csSigned(pc.init ?? csMod((pc.abilities || {}).dex)), 'init')
    + box('Speed', (pc.spd ?? 30) + ' ft')
    + box('Proficiency', csSigned(sh.profBonus || 2))
    + '<button class="cs-box cs-insp' + (pc.inspiration ? ' on' : '') + '" data-cs="insp"' + (ro ? ' disabled' : '') + ' title="Heroic Inspiration"><span>Inspiration</span><b>' + (pc.inspiration ? '✦' : '—') + '</b></button></div>';
  // Conditions, exhaustion, concentration, death saves.
  h += '<div class="cs-state">'
    + conds.map(c => '<span class="cs-chip">' + csE(c) + (ro ? '' : '<button data-cs-cond="' + csE(c) + '" aria-label="Remove ' + csE(c) + '">×</button>') + '</span>').join('')
    + (ro ? '' : '<select class="cb-sel cs-addcond" data-cs-addcond><option value="">+ Condition</option>' + CS_CONDITIONS.filter(c => !conds.includes(c)).map(c => '<option>' + c + '</option>').join('') + '</select>')
    + '<span class="cs-exh">Exhaustion ' + (ro ? '' : '<button class="btn small" data-cs-exh="-1" aria-label="Less exhaustion">−</button>') + '<b>' + (+pc.exhaustion || 0) + '</b>' + (ro ? '' : '<button class="btn small" data-cs-exh="1" aria-label="More exhaustion">+</button>') + '</span>'
    + (pc.concentration ? '<span class="cs-chip conc">Concentrating: ' + csE(pc.concentration) + (ro ? '' : '<button data-cs="dropconc" aria-label="Drop concentration">×</button>') + '</span>' : '')
    + '</div>';
  if (hp <= 0 && max > 0){
    const ds = hold.deathSaves || { success: 0, fail: 0 };
    const pips = (k) => [0, 1, 2].map(n => '<i class="' + ((ds[k] || 0) > n ? 'on' : '') + '"></i>').join('');
    h += '<div class="cs-death">' + (hold.dead ? '<b>Dead</b>' : hold.stable ? '<b>Stable at 0 HP</b>'
      : '<b>Death saves</b><span class="ok">' + pips('success') + '</span><span class="no">' + pips('fail') + '</span>' + (ro ? '' : '<button class="btn primary" data-cs="death">Roll</button>')) + '</div>';
  }
  // How a click rolls, and what it rolled.
  h += '<div class="cs-rollbar"><span class="cb-seg cs-mode">' + [['normal', 'Normal'], ['adv', 'Advantage'], ['dis', 'Disadvantage']]
      .map(([k, l]) => '<button class="' + (CS.mode === k ? 'on' : '') + '" data-cs-mode="' + k + '">' + l + '</button>').join('') + '</span>'
    + '<span class="cs-last" aria-live="polite">' + (CS.log[0] ? csRollText(CS.log[0]) : '<span class="cb-dim">Click a score, save, skill or attack to roll.<span class="cs-keys"> Shift: advantage · Alt: disadvantage.</span></span>') + '</span></div>';
  return h + '</div>';
}
function _csConditions(pc){
  const co = (state.combatants || []).find(x => x.id === pc.id);
  return [...new Set([...(pc.conditions || []), ...((co && co.conditions) || [])])];
}

// ── Down the side: abilities, saves, skills, senses, proficiencies ───────────
function csSide(pc){
  const sh = pc.sheet || {}, ab = pc.abilities || {};
  const pb = sh.profBonus || 2;
  const saveOf = k => sh.saves && sh.saves[k] != null ? sh.saves[k] : csMod(ab[k]) + ((sh.saveProf || []).includes(k) ? pb : 0);
  const skillOf = k => sh.skills && sh.skills[k] != null ? sh.skills[k] : csMod(ab[CS_SKILLS[k][1]]);
  let h = '<div class="cs-abs">' + Object.keys(CS_AB).map(k => '<button class="cs-ab" data-cs-roll="ab:' + k + '" title="' + CS_AB[k] + ' check">'
    + '<span>' + k.toUpperCase() + '</span><b>' + csSigned(csMod(ab[k])) + '</b><i>' + (ab[k] ?? '—') + '</i></button>').join('') + '</div>';
  h += '<h5>Saving throws</h5><div class="cs-list">' + Object.keys(CS_AB).map(k => '<button class="cs-row" data-cs-roll="save:' + k + '">'
    + '<span class="cs-dot' + ((sh.saveProf || []).includes(k) ? ' on' : '') + '"></span><span>' + CS_AB[k] + '</span><b>' + csSigned(saveOf(k)) + '</b></button>').join('') + '</div>';
  h += '<h5>Skills</h5><div class="cs-list">' + Object.keys(CS_SKILLS).map(k => {
    const p = (sh.skillProf || {})[k] || 0;
    return '<button class="cs-row" data-cs-roll="skill:' + k + '"><span class="cs-dot' + (p >= 2 ? ' exp' : p ? ' on' : '') + '" title="' + (p >= 2 ? 'Expertise' : p ? 'Proficient' : '') + '"></span>'
      + '<span>' + CS_SKILLS[k][0] + ' <i>' + CS_SKILLS[k][1].toUpperCase() + '</i></span><b>' + csSigned(skillOf(k)) + '</b></button>';
  }).join('') + '</div>';
  const pas = k => 10 + skillOf(k);
  h += '<h5>Senses</h5><div class="cs-kv"><span>Passive Perception</span><b>' + (sh.passivePerception || pas('perception')) + '</b></div>'
    + '<div class="cs-kv"><span>Passive Investigation</span><b>' + pas('investigation') + '</b></div>'
    + '<div class="cs-kv"><span>Passive Insight</span><b>' + pas('insight') + '</b></div>'
    + (sh.senses ? '<div class="cs-note">' + csE(sh.senses) + '</div>' : '');
  const pr = sh.proficiencies || {};
  const line = (l, v) => v && v.length ? '<div class="cs-prof"><b>' + l + '</b> ' + csE(Array.isArray(v) ? v.map(_csTitle).join(', ') : v) + '</div>' : '';
  h += '<h5>Proficiencies &amp; languages</h5>' + line('Armor', pr.armor) + line('Weapons', pr.weapons) + line('Tools', pr.tools) + line('Languages', sh.languages)
    + (!pr.armor && !pr.weapons && !sh.languages ? '<div class="cb-dim">None recorded.</div>' : '');
  const def = [['Resistant', pc.resistances], ['Immune', pc.immunities], ['Vulnerable', pc.vulnerabilities]].filter(([, v]) => v && v.length);
  if (def.length) h += '<h5>Defenses</h5>' + def.map(([l, v]) => line(l, v)).join('');
  return h;
}

// ── Rolling ──────────────────────────────────────────────────────────────────
function csD(n){ return typeof sktD === 'function' ? sktD(n) : 1 + Math.floor(Math.random() * n); }
function csRollD20(label, mod, ev){
  const mode = ev && ev.shiftKey ? 'adv' : ev && ev.altKey ? 'dis' : CS.mode;
  const a = csD(20), b = mode === 'normal' ? null : csD(20);
  const nat = b == null ? a : mode === 'adv' ? Math.max(a, b) : Math.min(a, b);
  const r = { kind: 'd20', label, mod: +mod || 0, rolls: b == null ? [a] : [a, b], natural: nat, total: nat + (+mod || 0), mode, crit: nat === 20, fumble: nat === 1 };
  csLog(r);
  // The party card's own strip shows the DM the same roll.
  const pc = csPc();
  try { if (panelDefs.party && panelDefs.party._setLastRoll && !document.body.classList.contains('player-mode'))
          panelDefs.party._setLastRoll(pc, Object.assign({ kept: 0 }, r, { mode: mode === 'normal' ? 'normal' : mode })); } catch(e){}
  return r;
}
// "2d6+1d4+3 slashing", "1d10+4 force ×2 beams": every term, crits double the dice.
function sktDamageRoll(expr, crit){
  const s = String(expr || '');
  const math = s.split(/[a-z]{2,}/i)[0];
  const type = s.slice(math.length).trim();
  let total = 0; const parts = [];
  math.replace(/([+-]?)\s*(\d*)d(\d+)|([+-]?)\s*(\d+)/gi, (m, sg, n, d, sg2, k) => {
    if (d){
      const cnt = (parseInt(n || '1', 10) || 1) * (crit ? 2 : 1), rs = [];
      for (let i = 0; i < cnt; i++) rs.push(csD(+d));
      const sum = rs.reduce((x, y) => x + y, 0) * (sg === '-' ? -1 : 1);
      total += sum; parts.push(cnt + 'd' + d + ' [' + rs.join(', ') + ']');
    } else if (k){ const v = (+k) * (sg2 === '-' ? -1 : 1); total += v; parts.push(String(v)); }
    return m;
  });
  return { total: Math.max(0, total), detail: parts.join(' + '), type, crit: !!crit };
}
function csRollDamage(label, expr, crit){
  const r = Object.assign({ kind: 'dmg', label }, sktDamageRoll(expr, crit));
  csLog(r);
  return r;
}
function csLog(r){
  CS.log.unshift(r); CS.log = CS.log.slice(0, 8);
  if (typeof showToast === 'function') showToast(csRollPlain(r));
  const pc = csPc();
  if (pc && !CS.readOnly) sktKeepRoll(pc, csRollPlain(r).replace(/^[^:]*: /, ''), r);
}
function sktKeepRoll(pc, text, r){
  pc.rolls = [{ label: r.label, total: r.total, text, at: Date.now(),
                from: document.body.classList.contains('player-mode') ? 'player' : 'dm' }].concat(pc.rolls || []).slice(0, 6);
  save();
}
function csRollPlain(r){
  if (r.kind === 'dmg') return r.label + ': ' + r.total + (r.type ? ' ' + r.type : '') + (r.crit ? ' (crit)' : '') + ' — ' + r.detail;
  return r.label + ': ' + r.total + ' (d20 ' + r.rolls.join(' / ') + (r.mod ? ' ' + csSigned(r.mod) : '') + (r.mode !== 'normal' ? ', ' + (r.mode === 'adv' ? 'advantage' : 'disadvantage') : '') + ')'
    + (r.crit ? ' — natural 20' : r.fumble ? ' — natural 1' : '');
}
function csRollText(r){
  return '<b class="cs-last-n' + (r.crit ? ' crit' : r.fumble ? ' fumble' : '') + '">' + r.total + '</b> ' + csE(csRollPlain(r).replace(/^[^:]*: \d+ ?/, r.label + ' '));
}

// ── The tabs ─────────────────────────────────────────────────────────────────
const CS_TAB_RENDER = {};

// Actions: attacks, then what each action type can do, then limited uses.
CS_TAB_RENDER.abilities = pc => '<div class="cs-side-tab">' + csSide(pc) + '</div>';
CS_TAB_RENDER.actions = pc => {
  const sh = pc.sheet || {}, ro = CS.readOnly;
  const atks = (sh.attacks || []).filter(a => a && a.name);
  let h = '<h4>Attacks' + (sh.attacksPerAction > 1 ? ' <span class="cb-dim">' + sh.attacksPerAction + ' per Attack action</span>' : '') + '</h4>';
  h += atks.length ? '<div class="cs-atks"><div class="cs-atk cs-atk-h"><span>Name</span><span>Hit / DC</span><span>Damage</span><span>Notes</span></div>'
    + atks.map((a, i) => '<div class="cs-atk"><b>' + csE(a.name) + '</b>'
      + (/^[+-]?\d+$/.test(String(a.atkBonus || '').trim()) ? '<button class="btn small" data-cs-atk="' + i + '">' + csE(a.atkBonus) + '</button>' : '<span>' + csE(a.atkBonus || '') + '</span>')
      + (a.damage ? '<button class="btn small" data-cs-dmg="' + i + '">' + csE(a.damage) + '</button>' : '<span></span>')
      + '<span class="cb-dim">' + csE([a.mastery ? 'Mastery: ' + a.mastery : '', a.versatile ? 'Two hands ' + a.versatile : '', a.range ? a.range + ' ft' : ''].filter(Boolean).join(' · ')) + '</span></div>').join('') + '</div>'
    : '<div class="cb-dim">No attacks recorded.</div>';
  const acts = sh.activations || [];
  const groups = [['Action', 'Actions'], ['Bonus Action', 'Bonus actions'], ['Reaction', 'Reactions']];
  groups.forEach(([k, l]) => {
    const list = acts.filter(a => (a.action || 'Action') === k);
    if (list.length) h += '<h4>' + l + '</h4>' + list.map(a => csActHtml(pc, a)).join('');
  });
  const other = acts.filter(a => !groups.some(([k]) => k === (a.action || 'Action')));
  if (other.length) h += '<h4>Other</h4>' + other.map(a => csActHtml(pc, a)).join('');
  const res = pc.resources || [];
  if (res.length){
    h += '<h4>Limited use</h4>' + res.map((r, i) => '<div class="cs-res"><b>' + csE(r.name) + '</b>'
      + '<span class="cs-pips">' + Array.from({ length: Math.min(r.max || 0, 20) }, (_, n) => '<button class="cs-pip' + (n < (r.current || 0) ? ' on' : '') + '" data-cs-res="' + i + ':' + n + '"' + (ro ? ' disabled' : '') + ' aria-label="' + csE(r.name) + ' ' + (n + 1) + '"></button>').join('') + '</span>'
      + '<span class="cb-dim">' + (r.current || 0) + '/' + (r.max || 0) + (r.recharge ? ' · ' + (/short/.test(r.recharge) ? 'short rest' : 'long rest') : '') + '</span></div>').join('');
  }
  h += '<details class="cs-std"><summary>Standard actions</summary><div class="cb-dim">'
    + ((pc.rules || (pc.build && pc.build.edition)) === '2014'
      ? 'Attack · Cast a Spell · Dash · Disengage · Dodge · Help · Hide · Ready · Search · Use an Object · Grapple · Shove'
      : 'Attack · Dash · Disengage · Dodge · Help · Hide · Influence · Magic · Ready · Search · Study · Utilize') + '</div></details>';
  return h;
};
function csActHtml(pc, a){
  const r = a.resource ? (pc.resources || []).find(x => x.name === a.resource) : null;
  const can = !CS.readOnly && r && (r.current || 0) >= (a.amount || 1);
  return '<div class="cs-act"><div class="cs-act-h"><b>' + csE(a.name) + '</b>'
    + (r ? '<span class="cb-dim">' + (a.amount || 1) + ' ' + csE(r.name) + ' · ' + (r.current || 0) + ' left</span>'
         + '<button class="btn small" data-cs-use="' + csE(a.name) + '"' + (can ? '' : ' disabled') + '>Use</button>' : '')
    + '</div>' + (a.desc ? '<div class="cs-act-d">' + csE(a.desc) + '</div>' : '') + '</div>';
}

// Features & Traits: everything the character has, by where it comes from.
CS_TAB_RENDER.features = pc => {
  const sh = pc.sheet || {};
  const list = (sh.featureList || []).filter(f => !f.info);
  if (!list.length){
    // An imported character: the party card's own feature lookup.
    const P = panelDefs.party;
    return P && P._tabFeatures ? '<div class="cs-legacy">' + P._tabFeatures(pc) + '</div>' : '<div class="cb-dim">No features recorded.</div>';
  }
  const FROM = [['class', 'Class features'], ['subclass', 'Subclass features'], ['species', 'Species traits'], ['background', 'Background'], ['feat', 'Feats'], ['optional', 'Options']];
  let h = (sh.notes || []).length ? '<h4>Always in effect</h4>' + sh.notes.map(n => '<div class="cs-note">' + csE(n) + '</div>').join('') : '';
  FROM.forEach(([k, l]) => {
    const fs = list.filter(f => f.from === k); if (!fs.length) return;
    h += '<h4>' + l + '</h4>' + fs.map(f => '<details class="cs-feat"><summary><b>' + csE(f.name) + '</b>'
      + (f.level ? ' <span class="cb-dim">' + (f.cls ? _csTitle(f.cls) + ' ' : 'level ') + f.level + '</span>' : '')
      + (f.mech ? ' <span class="cb-badge">applied</span>' : '') + '</summary><div class="cs-feat-t">' + csE(f.text || '').replace(/\n/g, '<br>') + '</div></details>').join('');
  });
  return h;
};

// Background: who they are. Written into the build too, so the builder shows it.
CS_TAB_RENDER.background = pc => {
  const sh = pc.sheet || {}, d = sh.details || (pc.build && pc.build.details) || {}, ro = CS.readOnly;
  const bgFeat = (sh.featureList || []).filter(f => f.from === 'background');
  let h = '<h4>' + csE(pc.background || (pc.build && pc.build.background) || 'Background') + '</h4>'
    + bgFeat.map(f => '<div class="cs-feat-t"><b>' + csE(f.name) + '</b><br>' + csE(f.text || '').replace(/\n/g, '<br>') + '</div>').join('');
  const facts = [['alignment', 'Alignment'], ['faith', 'Faith'], ['age', 'Age'], ['height', 'Height'], ['weight', 'Weight'], ['eyes', 'Eyes'], ['hair', 'Hair'], ['skin', 'Skin']];
  h += '<div class="cs-facts">' + (sh.size ? '<div class="cs-kv"><span>Size</span><b>' + csE(sh.size) + '</b></div>' : '')
    + facts.map(([k, l]) => '<label class="cs-kv"><span>' + l + '</span>' + (ro ? '<b>' + csE(d[k] || '—') + '</b>' : '<input data-cs-detail="' + k + '" value="' + csE(d[k] || '') + '" maxlength="40">') + '</label>').join('') + '</div>';
  [['personality', 'Personality traits'], ['ideals', 'Ideals'], ['bonds', 'Bonds'], ['flaws', 'Flaws'], ['appearance', 'Appearance'], ['backstory', 'Backstory']].forEach(([k, l]) => {
    if (ro && !d[k]) return;
    h += '<h5>' + l + '</h5>' + (ro ? '<div class="cs-text">' + csE(d[k]).replace(/\n/g, '<br>') + '</div>'
      : '<textarea data-cs-detail="' + k + '" rows="' + (k === 'backstory' ? 6 : 2) + '" maxlength="4000">' + csE(d[k] || '') + '</textarea>');
  });
  return h;
};

// Notes: the player's own page.
CS_TAB_RENDER.notes = pc => {
  if (CS.readOnly) return pc.playerNotes ? '<div class="cs-text">' + csE(pc.playerNotes).replace(/\n/g, '<br>') + '</div>' : '<div class="cb-dim">No notes.</div>';
  return '<div class="cb-dim">Anything worth remembering: names, debts, the map you were promised. Saved as you type.</div>'
    + '<textarea class="cs-notes" data-cs-notes rows="16" maxlength="20000">' + csE(pc.playerNotes || '') + '</textarea>';
};

// Spells and Inventory are filled in by their own sections below.
CS_TAB_RENDER.spells = pc => typeof csSpellsHtml === 'function' ? csSpellsHtml(pc) : '';
CS_TAB_RENDER.inventory = pc => typeof csInventoryHtml === 'function' ? csInventoryHtml(pc) : '';

// ── Events ───────────────────────────────────────────────────────────────────
function csOnClick(e){
  if (!CS) return;
  const t = e.target.closest('button, [data-cs-tab]'); if (!t) return;
  const d = t.dataset, pc = csPc(); if (!pc) return;
  if (d.cs === 'close') return csClose();
  if (d.csTab){ CS.tab = d.csTab; return csRender(); }
  if (d.csMode){ CS.mode = d.csMode; return csRender(); }
  if (d.csRoll) return csRollFor(pc, d.csRoll, e);
  if (d.csAtk != null){
    const a = (pc.sheet.attacks || [])[+d.csAtk]; if (!a) return;
    const r = csRollD20(a.name + ' attack', parseInt(a.atkBonus, 10) || 0, e);
    CS.lastAtkCrit = { i: +d.csAtk, crit: r.crit };
    return csRender();
  }
  if (d.csDmg != null){
    const a = (pc.sheet.attacks || [])[+d.csDmg]; if (!a) return;
    const crit = !!(CS.lastAtkCrit && CS.lastAtkCrit.i === +d.csDmg && CS.lastAtkCrit.crit);
    csRollDamage(a.name + ' damage', a.damage, crit); CS.lastAtkCrit = null;
    return csRender();
  }
  if (CS.readOnly) return;
  if (d.csHp){
    const n = Math.abs(parseInt((document.querySelector('#cs-root [data-cs-amt]') || {}).value, 10) || 0); if (!n) return;
    CS.amt = n;
    if (d.csHp === 'temp') return csEdit('Temp HP ' + n, p => { p.tempHp = Math.max(p.tempHp || 0, n); });
    const i = csIdx(), sign = +d.csHp, type = sign < 0 ? (CS.dtype || null) : null;
    const run = () => { panelDefs.party._applyHpDelta(i, sign * n, type); csCommit(); };
    if (typeof sktUndoable === 'function') return sktUndoable((sign < 0 ? 'Took ' : 'Healed ') + n, run);
    return run();
  }
  if (d.cs === 'insp') return csEdit(pc.inspiration ? 'Spent Heroic Inspiration' : 'Heroic Inspiration', p => { p.inspiration = !p.inspiration; });
  if (d.cs === 'dropconc') return csEdit('Dropped concentration', p => { p.concentration = null; });
  if (d.csCond) return csEdit('Condition', () => panelDefs.party._toggleCondition(csIdx(), d.csCond));
  if (d.csExh) return csEdit('Exhaustion', p => { p.exhaustion = Math.max(0, Math.min(6, (+p.exhaustion || 0) + (+d.csExh))); });
  if (d.cs === 'death'){
    const r = sktRollDeathSave(pc);
    csLog({ kind: 'd20', label: 'Death save', mod: 0, rolls: [r.nat], natural: r.nat, total: r.nat, mode: 'normal', crit: r.nat === 20, fumble: r.nat === 1 });
    return csCommit();
  }
  if (d.csRes){
    const [i, n] = d.csRes.split(':').map(Number);
    return csEdit('Used a feature', p => {
      const r = p.resources[i]; if (!r) return;
      // Tap a lit pip to spend down to it; an unlit one to get it back.
      r.current = n < (r.current || 0) ? n : n + 1;
    });
  }
  if (d.csUse){
    const a = (pc.sheet.activations || []).find(x => x.name === d.csUse); if (!a) return;
    return csEdit('Used ' + a.name, p => {
      const r = (p.resources || []).find(x => x.name === a.resource);
      if (r) r.current = Math.max(0, (r.current || 0) - (a.amount || 1));
    });
  }
  if (d.cs === 'short'){
    const P = panelDefs.party, i = csIdx();
    if (document.body.classList.contains('player-mode') && typeof paOpenShortRest === 'function'){ csClose(); return paOpenShortRest(); }
    return csEdit(pc.name + ' took a short rest', () => P._shortRestOne(state.party[i], i));
  }
  if (d.cs === 'long'){
    const go = () => csEdit(pc.name + ' took a long rest', () => panelDefs.party._longRestOne(state.party[csIdx()], csIdx()));
    if (typeof showConfirm === 'function') return showConfirm('Hit points to full, half the hit dice, every slot and feature back, one level of exhaustion gone.', { title: 'Long rest', confirmLabel: 'Rest' }).then(ok => { if (ok) go(); });
    return go();
  }
  if (d.cs === 'levelup' || d.cs === 'edit'){
    const i = csIdx(); csClose();
    return openCharBuilder({ idx: i, levelup: d.cs === 'levelup' });
  }
  if (d.cs === 'customize' && typeof csCustomizeOpen === 'function') return csCustomizeOpen(pc);
  if (d.cs === 'addxp'){
    const n = parseInt((document.querySelector('#cs-root [data-cs-xp]') || {}).value, 10) || 0;
    if (!n) return;
    return csEdit((n > 0 ? 'Gained ' : 'Lost ') + Math.abs(n) + ' XP', p => {
      const before = +p.xp || 0; p.xp = Math.max(0, before + n);
      const lv = p.level || 1;
      if (lv < 20 && before < CS_XP[lv] && p.xp >= CS_XP[lv] && typeof showToast === 'function') showToast(p.name + ' can reach level ' + (lv + 1) + ' — Level up');
    });
  }
  if (typeof csSpellsClick === 'function' && csSpellsClick(e, t, d, pc)) return;
  if (typeof csInventoryClick === 'function' && csInventoryClick(e, t, d, pc)) return;
}
function csRollFor(pc, what, e){
  const sh = pc.sheet || {}, ab = pc.abilities || {}, pb = sh.profBonus || 2;
  const [kind, k] = what.split(':');
  if (kind === 'init') csRollD20('Initiative', pc.init ?? csMod(ab.dex), e);
  else if (kind === 'ab') csRollD20(CS_AB[k] + ' check', csMod(ab[k]), e);
  else if (kind === 'save') csRollD20(CS_AB[k] + ' save', sh.saves && sh.saves[k] != null ? sh.saves[k] : csMod(ab[k]) + ((sh.saveProf || []).includes(k) ? pb : 0), e);
  else if (kind === 'skill') csRollD20(CS_SKILLS[k][0], sh.skills && sh.skills[k] != null ? sh.skills[k] : csMod(ab[CS_SKILLS[k][1]]), e);
  csRender();
}
function csOnChange(e){
  if (!CS) return;
  const t = e.target, d = t.dataset, pc = csPc(); if (!pc) return;
  if ('csDtype' in d){ CS.dtype = t.value; return; }
  if (CS.readOnly) return;
  if ('csAddcond' in d){ if (t.value) csEdit('Condition', () => panelDefs.party._toggleCondition(csIdx(), t.value)); return; }
  if (typeof csSpellsChange === 'function' && csSpellsChange(e, t, d, pc)) return;
  if (typeof csInventoryChange === 'function' && csInventoryChange(e, t, d, pc)) return;
}
// Typing: saved as it goes, no redraw, so the box keeps the caret.
function csOnInput(e){
  if (!CS || CS.readOnly) return;
  const t = e.target, d = t.dataset, pc = csPc(); if (!pc) return;
  if ('csNotes' in d){ pc.playerNotes = t.value; csSaveSoon(); return; }
  if (d.csDetail){
    pc.sheet = pc.sheet || {};
    pc.sheet.details = Object.assign({}, pc.sheet.details, { [d.csDetail]: t.value });
    if (pc.build) pc.build.details = Object.assign({}, pc.build.details, { [d.csDetail]: t.value });
    csSaveSoon(); return;
  }
  if (typeof csInventoryInput === 'function') csInventoryInput(e, t, d, pc);
}
let _csSaveT = null;
function csSaveSoon(){ clearTimeout(_csSaveT); _csSaveT = setTimeout(() => save(), 400); }

// ── Spells ───────────────────────────────────────────────────────────────────
// Slots to spend, every spell the character has by level with what it does,
// a Cast button that spends the slot (at a higher level if wanted) and starts
// concentration, and — for a character made in the builder — preparing and
// unpreparing on the sheet, the way D&D Beyond does it.
function csSpell(name){
  const R = CS && CS.R;
  const s = R && typeof sktRulesSpell === 'function' ? sktRulesSpell(R, name) : null;
  if (s) return s;
  if (typeof _5eData !== 'undefined' && Array.isArray(_5eData)){
    const n = String(name || '').toLowerCase();
    const d = _5eData.find(x => x.cat === 'spell' && String(x.name).toLowerCase() === n);
    if (d && d._raw) return { name: d.name, level: d._raw.level, entries: d._raw.entries, time: d._raw.time, range: d._raw.range,
      duration: [].concat(d._raw.duration || []), components: d._raw.components, concentration: [].concat(d._raw.duration || []).some(x => x && x.concentration),
      ritual: !!(d._raw.meta && d._raw.meta.ritual), spellAttack: d._raw.spellAttack, savingThrow: d._raw.savingThrow };
  }
  return null;
}
function csSpellMeta(s){
  if (!s) return '';
  const t = [].concat(s.time || [])[0], r = s.range || {}, du = [].concat(s.duration || [])[0] || {};
  const time = t ? t.number + ' ' + String(t.unit).replace('bonus', 'bonus action') : '';
  const range = r.type === 'point' && r.distance ? (r.distance.amount ? r.distance.amount + ' ' + r.distance.type : _csTitle(r.distance.type)) : r.type ? _csTitle(r.type) : '';
  const dur = du.type === 'timed' && du.duration ? du.duration.amount + ' ' + du.duration.type + (du.duration.amount > 1 ? 's' : '') : du.type === 'instant' ? 'Instantaneous' : _csTitle(du.type || '');
  const c = s.components || {};
  const comp = [c.v ? 'V' : '', c.s ? 'S' : '', c.m ? 'M' : ''].filter(Boolean).join(', ');
  return [time, range, comp, dur].filter(Boolean).join(' · ');
}
const CS_ORD = ['Cantrips', '1st level', '2nd level', '3rd level', '4th level', '5th level', '6th level', '7th level', '8th level', '9th level'];
function csSpellsHtml(pc){
  const sh = pc.sheet || {}, ro = CS.readOnly;
  const slots = sh.spellSlots || {};
  const lvls = Object.keys(slots).map(Number).filter(l => (slots[l].total || 0) > 0).sort((a, b) => a - b);
  let h = '';
  if (sh.spellSaveDc) h += '<div class="cs-spellhead"><div class="cs-box"><span>Ability</span><b>' + csE(String(sh.spellAbility || '').toUpperCase() || '—') + '</b></div>'
    + '<div class="cs-box"><span>Save DC</span><b>' + sh.spellSaveDc + '</b></div>'
    + '<button class="cs-box" data-cs-spatk="1"><span>Spell attack</span><b>' + csE(sh.spellAtkBonus || '') + '</b></button></div>';
  if (lvls.length) h += '<div class="cs-slots">' + lvls.map(l => {
    const s = slots[l];
    return '<div class="cs-slot"><span>' + CS_ORD[l] + (s.pact ? ' (pact)' : '') + '</span><span class="cs-pips">'
      + Array.from({ length: s.total }, (_, n) => '<button class="cs-pip slot' + (n < (s.total - (s.expended || 0)) ? ' on' : '') + '" data-cs-slot="' + l + ':' + n + '"' + (ro ? ' disabled' : '') + ' aria-label="Level ' + l + ' slot ' + (n + 1) + '"></button>').join('')
      + '</span></div>';
  }).join('') + '</div>';
  // Where each spell comes from, for the labels.
  const from = {};
  (sh.alwaysPrepared || []).forEach(n => { from[n] = 'Always prepared'; });
  (sh.featSpells || []).forEach(g => g.spells.forEach(n => { from[n] = g.feat; }));
  if (sh.speciesSpells) sh.speciesSpells.spells.forEach(n => { from[n] = 'Species'; });
  const daily = new Set([].concat(...(sh.featSpells || []).map(g => g.daily || []), (sh.speciesSpells && sh.speciesSpells.daily) || []));
  const names = [...new Set(sh.spells || [])];
  if (!names.length) h += '<div class="cb-dim">No spells.</div>';
  const by = {};
  names.forEach(n => { const s = csSpell(n); const l = s ? +s.level || 0 : 0; (by[l] = by[l] || []).push({ n, s }); });
  Object.keys(by).map(Number).sort((a, b) => a - b).forEach(l => {
    h += '<h4>' + CS_ORD[l] + '</h4>' + by[l].sort((a, b) => a.n.localeCompare(b.n)).map(({ n, s }) => {
      const open = CS.open['sp:' + n];
      const tags = (s && s.concentration ? '<i class="cs-tag" title="Concentration">C</i>' : '') + (s && s.ritual ? '<i class="cs-tag" title="Ritual">R</i>' : '');
      const avail = l ? lvls.filter(x => x >= l && (slots[x].total - (slots[x].expended || 0)) > 0) : [];
      const cast = ro ? '' : l === 0 ? '<button class="btn small" data-cs-cast="' + csE(n) + ':0">Cast</button>'
        : (avail.length ? (avail.length > 1 ? '<select class="cb-sel cs-castlvl" data-cs-castlvl="' + csE(n) + '">' + avail.map(x => '<option value="' + x + '">' + CS_ORD[x] + '</option>').join('') + '</select>' : '')
          + '<button class="btn small" data-cs-cast="' + csE(n) + ':' + avail[0] + '">Cast</button>' : '<span class="cb-dim">no slots</span>')
          + (daily.has(n) ? '<button class="btn small" data-cs-cast="' + csE(n) + ':free" title="Once per long rest without a slot">Free</button>' : '')
          + (s && s.ritual ? '<button class="btn small" data-cs-cast="' + csE(n) + ':ritual" title="As a ritual: 10 minutes longer, no slot">Ritual</button>' : '');
      return '<div class="cs-spell"><button class="cs-spell-n" data-cs-open="sp:' + csE(n) + '"><b>' + csE(n) + '</b>' + tags
        + '<span class="cb-dim">' + csE(csSpellMeta(s)) + '</span>' + (from[n] ? '<span class="cs-from">' + csE(from[n]) + '</span>' : '') + '</button>'
        + '<span class="cs-spell-c">' + cast + '</span>'
        + (open ? '<div class="cs-feat-t">' + (s ? csE(typeof sktRulesText === 'function' ? sktRulesText(s.entries) : '').replace(/\n/g, '<br>') : 'Loading the rules…') + '</div>' : '') + '</div>';
    }).join('');
  });
  if (!ro && pc.build) h += csManageSpellsHtml(pc);
  return h;
}
// Preparing on the sheet: each casting class's list, its limits from the rules.
function csManageSpellsHtml(pc){
  const R = CS.R, b = pc.build;
  if (!R || typeof sktBuildSpellcasting !== 'function') return '';
  const sc = sktBuildSpellcasting(b, R, sktBuildAbilities(b, R));
  if (!sc) return '';
  let h = '<button class="btn cs-manage" data-cs="manage">' + (CS.manage ? 'Done' : 'Manage spells') + '</button>';
  if (!CS.manage) return h;
  (sc.classes || [{ primary: true, sc, cls: b.cls, view: b, entry: null }]).forEach(x => {
    const s = x.sc, lst = x.primary ? b : (x.entry || {}), view = x.view || b;
    const mi = x.primary ? -1 : (b.multi || []).indexOf(x.entry);
    const want = s.prepared || s.known;
    const always = typeof sktBuildAlwaysPrepared === 'function' ? sktBuildAlwaysPrepared(view, R) : [];
    const key = (kind, n) => mi + '|' + kind + '|' + n;
    const box = (opts, chosen, max, kind) => '<div class="cs-checks">' + opts.map(n => {
      const on = (chosen || []).includes(n), full = max != null && (chosen || []).length >= max;
      return '<label class="cs-check' + (on ? ' on' : '') + '"><input type="checkbox" data-cs-prep="' + csE(key(kind, n)) + '"' + (on ? ' checked' : '') + (!on && full ? ' disabled' : '') + '>' + csE(n) + '</label>';
    }).join('') + '</div>';
    h += '<h4>' + csE(_csTitle(x.cls)) + ' spells</h4>';
    if (s.cantrips) h += '<h5>Cantrips ' + (lst.cantrips || []).length + ' / ' + s.cantrips + '</h5>' + box(sktSpellOptions(R, view, 0).map(o => o.name), lst.cantrips, s.cantrips, 'cantrips');
    const book = s.spellbook ? ((lst.spellbook && lst.spellbook.length) ? lst.spellbook : (lst.spells || [])) : null;
    if (s.spellbook){
      // A wizard copies found spells into the book: no limit here.
      h += '<h5>Spellbook ' + book.length + '</h5>';
      for (let lv = 1; lv <= s.maxSpellLevel; lv++){
        const opts = sktSpellOptions(R, view, lv).map(o => o.name).filter(n => !always.includes(n));
        if (opts.length) h += '<div class="cb-dim">' + CS_ORD[lv] + '</div>' + box(opts, book, null, 'spellbook');
      }
    }
    if (want){
      h += '<h5>' + (s.prepared ? 'Prepared' : 'Known') + ' ' + (lst.spells || []).length + ' / ' + want + '</h5>';
      if (book) h += box(book.filter(n => !always.includes(n)), lst.spells, want, 'spells');
      else for (let lv = 1; lv <= s.maxSpellLevel; lv++){
        const opts = sktSpellOptions(R, view, lv).map(o => o.name).filter(n => !always.includes(n));
        if (opts.length) h += '<div class="cb-dim">' + CS_ORD[lv] + '</div>' + box(opts, lst.spells, want, 'spells');
      }
    }
  });
  return h;
}
function csSpellsClick(e, t, d, pc){
  if (d.csOpen){ CS.open[d.csOpen] = !CS.open[d.csOpen]; csRender(); return true; }
  if (d.csSpatk){ csRollD20('Spell attack', parseInt((pc.sheet || {}).spellAtkBonus, 10) || 0, e); csRender(); return true; }
  if (CS.readOnly) return false;
  if (d.cs === 'manage'){ CS.manage = !CS.manage; csRender(); return true; }
  if (d.csSlot){
    const [l, n] = d.csSlot.split(':').map(Number);
    csEdit('Spell slot', p => {
      const s = p.sheet.spellSlots[l]; if (!s) return;
      const left = s.total - (s.expended || 0);
      // A lit pip spends down to it; an unlit one gives it back.
      const nowLeft = n < left ? n : n + 1;
      s.expended = Math.max(0, Math.min(s.total, s.total - nowLeft));
    });
    return true;
  }
  if (d.csCast){
    const i = d.csCast.lastIndexOf(':'), name = d.csCast.slice(0, i);
    let how = d.csCast.slice(i + 1);
    const sel = document.querySelector('#cs-root [data-cs-castlvl="' + CSS.escape(name) + '"]');
    if (sel && /^\d+$/.test(how) && how !== '0') how = sel.value;
    const s = csSpell(name);
    csEdit('Cast ' + name, p => {
      if (/^\d+$/.test(how) && +how > 0){
        const slot = p.sheet.spellSlots[+how];
        if (!slot || slot.total - (slot.expended || 0) <= 0) return;
        slot.expended = (slot.expended || 0) + 1;
      }
      if (s && s.concentration){
        if (p.concentration && p.concentration !== name && typeof showToast === 'function') showToast('Concentration on ' + p.concentration + ' ends');
        p.concentration = name;
      }
    });
    if (typeof showToast === 'function') showToast('Cast ' + name + (/^\d+$/.test(how) && +how > 0 ? ' (' + CS_ORD[+how] + ' slot)' : how === 'ritual' ? ' as a ritual' : how === 'free' ? ' (free use)' : ''));
    return true;
  }
  return false;
}
// ── Inventory ────────────────────────────────────────────────────────────────
// Everything carried, with quantities, weight against what the character can
// carry, equipped and attuned toggles, and coins. For a character made in the
// builder the starting kit becomes an ordinary list the first time anything
// is changed here — from then on the inventory, not the kit, is what they
// carry, and the sheet's AC and attacks follow what is equipped.
const CS_COINS = [['pp', 10], ['gp', 1], ['ep', 0.5], ['sp', 0.1], ['cp', 0.01]];
function csItems(pc){
  if (pc.build){
    const eq = pc.build.equipment || {};
    if (eq.materialized || !CS.R || typeof sktKitItems !== 'function') return pc.build.items || [];
    return sktKitItems(pc.build, CS.R, CS.gear).concat(pc.build.items || []);
  }
  return pc.inventory || [];
}
function csCoins(pc){ return Object.assign({ pp: 0, ep: 0, sp: 0, cp: 0 }, pc.coins || {}, { gp: +pc.gold || 0 }); }
function csInventoryHtml(pc){
  const ro = CS.readOnly;
  if (!CS.gear && !CS.gearLoading && typeof sktGearLoad === 'function' && CS.R){
    CS.gearLoading = true;
    const ed = CS.R.edition;
    Promise.all([sktGearLoad(ed), typeof sktMagicLoad === 'function' ? sktMagicLoad(ed) : []]).then(([g, m]) => {
      if (!CS) return; CS.gear = g; CS.magic = m; CS.gearLoading = false; if (CS.tab === 'inventory') csRender();
    }).catch(() => { if (CS) CS.gearLoading = false; });
  }
  const items = csItems(pc), coins = csCoins(pc);
  const lb = items.reduce((n, m) => n + (+m.weight || 0) * (m.qty || 1), 0) + CS_COINS.reduce((n, [k]) => n + (+coins[k] || 0), 0) / 50;
  const str = (pc.abilities || {}).str || 10, size = ((pc.sheet || {}).size || 'Medium');
  const cap = str * 15 * (size === 'Tiny' ? 0.5 : size === 'Large' ? 2 : 1);
  const attuned = items.filter(m => m.reqAttune && m.attuned).length;
  let h = '<div class="cs-coins">' + CS_COINS.map(([k]) => '<label class="cs-coin"><span>' + k.toUpperCase() + '</span>'
    + (ro ? '<b>' + (coins[k] || 0) + '</b>' : '<input type="number" min="0" data-cs-coin="' + k + '" value="' + (coins[k] || 0) + '">') + '</label>').join('')
    + '<span class="cb-dim">Worth ' + Math.round(CS_COINS.reduce((n, [k, v]) => n + (+coins[k] || 0) * v, 0) * 100) / 100 + ' gp</span></div>';
  h += '<div class="cs-carry' + (lb > cap ? ' over' : '') + '">Carrying <b>' + Math.round(lb * 10) / 10 + ' lb</b> of ' + cap + ' lb'
    + (lb > cap ? ' — over the limit: speed drops to 5 ft' : '') + (items.some(m => m.reqAttune) ? ' · attuned ' + attuned + ' of 3' : '') + '</div>';
  const gearType = m => { const st = m.stats || (m.base && CS.R && CS.R.items[m.base]); return st && /^(M|R|LA|MA|HA|S)(\||$)/.test(String(st.type)); };
  h += '<div class="cs-inv">' + (items.length ? items.map((m, i) => '<div class="cs-item' + (m.equipped === false ? ' off' : '') + '">'
    + (gearType(m) ? '<label class="cs-eq" title="Equipped"><input type="checkbox" data-cs-equip="' + i + '"' + (m.equipped !== false ? ' checked' : '') + (ro ? ' disabled' : '') + '></label>' : '<span class="cs-eq"></span>')
    + '<b>' + csE(m.name) + '</b>'
    + (m.reqAttune ? '<label class="cs-att"><input type="checkbox" data-cs-attune="' + i + '"' + (m.attuned ? ' checked' : '') + (ro || (!m.attuned && attuned >= 3) ? ' disabled' : '') + '> attuned</label>' : '')
    + '<span class="cs-qty">' + (ro ? '' : '<button class="btn small" data-cs-qty="' + i + ':-1" aria-label="One fewer">−</button>') + '×' + (m.qty || 1)
    + (ro ? '' : '<button class="btn small" data-cs-qty="' + i + ':1" aria-label="One more">+</button>') + '</span>'
    + '<span class="cb-dim cs-wt">' + (m.weight ? Math.round((+m.weight) * (m.qty || 1) * 10) / 10 + ' lb' : '') + '</span>'
    + (ro ? '' : '<button class="btn small" data-cs-del="' + i + '" aria-label="Remove ' + csE(m.name) + '">✕</button>') + '</div>').join('')
    : '<div class="cb-dim">Nothing carried.</div>') + '</div>';
  if (!ro){
    const e = csGearFind(CS.q);
    const bases = e && e.kind === 'variant' && typeof sktMagicBases === 'function' ? sktMagicBases(CS.R, e) : null;
    h += '<h5>Add an item</h5><div class="cs-add"><input data-cs-q list="cs-gear-dl" placeholder="' + (CS.gear ? 'Search gear and magic items…' : 'Loading the item list…') + '" value="' + csE(CS.q || '') + '">'
      + (bases ? '<select class="cb-sel" data-cs-qbase><option value="">Which one?</option>' + bases.map(k => '<option value="' + csE(k) + '"' + (CS.qBase === k ? ' selected' : '') + '>' + csE(CS.R.items[k].name) + '</option>').join('') + '</select>' : '')
      + '<button class="btn" data-cs="additem"' + (e && (!bases || (CS.qBase && bases.includes(CS.qBase))) ? '' : ' disabled') + '>Add</button></div>'
      + '<datalist id="cs-gear-dl">' + csGearEntries().map(x => '<option value="' + csE(x.name) + '">' + csE(x.rarity && x.rarity !== 'none' ? x.rarity : '') + '</option>').join('') + '</datalist>'
      + '<div class="cs-add"><input data-cs-custom placeholder="Or a custom item…" maxlength="60"><input type="number" min="0" step="0.1" data-cs-customwt placeholder="lb" aria-label="Weight"><button class="btn" data-cs="addcustom">Add</button></div>';
  }
  return h;
}
function csGearEntries(){ return [].concat(CS.magic || [], CS.gear || []); }
function csGearFind(name){
  const n = String(name || '').trim().toLowerCase();
  return n ? csGearEntries().find(e => e.name.toLowerCase() === n) || null : null;
}
// Change the list: for a built character, materialize the kit first.
function csItemsEdit(label, fn){
  const pc = csPc(); if (!pc) return;
  if (pc.build){
    const kit = !(pc.build.equipment || {}).materialized && typeof sktKitItems === 'function' && CS.R ? sktKitItems(pc.build, CS.R, CS.gear) : null;
    return csRebuild(label, b => {
      b.equipment = b.equipment || {};
      if (!b.equipment.materialized){ b.items = (kit || []).concat(b.items || []); b.equipment.materialized = true; }
      b.items = (b.items || []).map(x => Object.assign({}, x));
      fn(b.items, b);
    });
  }
  csEdit(label, p => { p.inventory = (p.inventory || []).map(x => Object.assign({}, x)); fn(p.inventory, p); });
}
function csInventoryClick(e, t, d, pc){
  if (CS.readOnly) return false;
  if (d.csQty){ const [i, n] = d.csQty.split(':').map(Number); csItemsEdit('Quantity', l => { if (l[i]) l[i].qty = Math.max(1, (l[i].qty || 1) + n); }); return true; }
  if (d.csDel != null){ csItemsEdit('Removed an item', l => { l.splice(+d.csDel, 1); }); return true; }
  if (d.cs === 'additem'){
    const g = csGearFind(CS.q); if (!g) return true;
    let it;
    if (g.kind === 'item' || g.kind === 'variant') it = sktMagicMake(CS.R, g, CS.qBase);
    else it = { name: g.name, base: g.base || undefined, weight: g.weight || 0 };
    if (!it) return true;
    if (it.weight == null){ const bi = it.base && CS.R.items[it.base]; it.weight = (g.weight != null ? g.weight : bi && bi.weight) || 0; }
    it.qty = 1;
    CS.q = ''; CS.qBase = '';
    csItemsEdit('Added ' + it.name, l => { l.push(it); });
    return true;
  }
  if (d.cs === 'addcustom'){
    const nm = (document.querySelector('#cs-root [data-cs-custom]') || {}).value || '';
    const wt = parseFloat((document.querySelector('#cs-root [data-cs-customwt]') || {}).value) || 0;
    if (!nm.trim()) return true;
    csItemsEdit('Added ' + nm.trim(), l => { l.push({ name: nm.trim(), qty: 1, weight: wt, custom: true }); });
    return true;
  }
  return false;
}
function csInventoryChange(e, t, d, pc){
  if (d.csEquip != null){ const i = +d.csEquip; csItemsEdit(t.checked ? 'Equipped' : 'Unequipped', l => { if (l[i]) l[i].equipped = t.checked; }); return true; }
  if (d.csAttune != null){
    const i = +d.csAttune;
    csItemsEdit(t.checked ? 'Attuned' : 'Ended attunement', l => {
      if (!l[i]) return;
      if (t.checked && l.filter(x => x.reqAttune && x.attuned).length >= 3) return;
      l[i].attuned = t.checked;
    });
    return true;
  }
  if (d.csCoin){
    const v = Math.max(0, parseInt(t.value, 10) || 0);
    csEdit('Coins', p => { if (d.csCoin === 'gp') p.gold = v; else p.coins = Object.assign({}, p.coins, { [d.csCoin]: v }); });
    return true;
  }
  if ('csQ' in d){ CS.q = t.value; CS.qBase = ''; csRender(); return true; }
  if ('csQbase' in d){ CS.qBase = t.value; csRender(); return true; }
  return false;
}
function csInventoryInput(e, t, d){ if ('csQ' in d) CS.q = t.value; }

// ── Customize ────────────────────────────────────────────────────────────────
// Bonuses the rules don't know about — a blessing, a house rule, an item the
// list lacks: added to AC, initiative, speed, hit points, saves, skills and
// spellcasting. Kept on the build, so they survive levelling up.
const CS_OV = [['ac', 'Armor Class'], ['init', 'Initiative'], ['speed', 'Speed (ft)'], ['hpMax', 'Hit point maximum'], ['saveAll', 'All saving throws'],
               ['spellAttack', 'Spell attack'], ['spellDc', 'Spell save DC'], ['passive', 'Passive Perception']];
function csCustomizeOpen(){ CS.customize = !CS.customize; csRender(); }
function csCustomizeHtml(pc){
  const o = (pc.build && pc.build.overrides) || {};
  const num = (k, v) => '<input type="number" step="1" data-cs-ov="' + k + '" value="' + (v || 0) + '">';
  return '<div class="cs-custom"><h4>Customize <button class="btn small" data-cs="customize">Done</button></h4>'
    + '<div class="cb-dim">Added on top of what the rules work out. Use negative numbers to take away.</div>'
    + '<div class="cs-ovgrid">' + CS_OV.map(([k, l]) => '<label class="cs-kv"><span>' + l + '</span>' + num(k, o[k]) + '</label>').join('')
    + Object.keys(CS_AB).map(k => '<label class="cs-kv"><span>' + CS_AB[k] + ' save</span>' + num('save:' + k, (o.saves || {})[k]) + '</label>').join('')
    + Object.keys(CS_SKILLS).map(k => '<label class="cs-kv"><span>' + CS_SKILLS[k][0] + '</span>' + num('skill:' + k, (o.skills || {})[k]) + '</label>').join('')
    + '</div></div>';
}

function csSpellsChange(e, t, d, pc){
  if (d.csOv){
    const v = parseInt(t.value, 10) || 0;
    csRebuild('Custom bonus', b => {
      const o = b.overrides = Object.assign({}, b.overrides);
      const [k, sub] = d.csOv.split(':');
      if (sub){ o[k + 's'] = Object.assign({}, o[k + 's'], { [sub]: v }); }
      else o[k] = v;
    });
    return true;
  }
  if (!d.csPrep) return false;
  const [mi, kind, name] = d.csPrep.split('|');
  csRebuild((t.checked ? 'Prepared ' : 'Unprepared ') + name, b => {
    const lst = +mi < 0 ? b : (b.multi || [])[+mi]; if (!lst) return;
    lst[kind] = (lst[kind] || []).slice();
    const at = lst[kind].indexOf(name);
    if (t.checked && at < 0) lst[kind].push(name);
    if (!t.checked && at >= 0) lst[kind].splice(at, 1);
    if (kind === 'spellbook') lst.spells = (lst.spells || []).filter(n => lst.spellbook.includes(n));
  });
  return true;
}
