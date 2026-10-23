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
  { id: 'extras',    label: 'Extras' },
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
  root.style.setProperty('--cs-accent', pc.theme || '');
  root.classList.toggle('themed', !!pc.theme);
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
  return '<div class="cb-head cs-head">' + (ro ? '<span class="cs-avatar">' + icon + '</span>' : '<button class="cs-avatar" data-cs="portrait" title="Change the portrait">' + icon + '</button>')
    + '<div class="cs-who"><b class="cb-title">' + csE(pc.name) + '</b><span class="cs-sub">' + csE(csClassLine(pc)) + '</span>'
    + (xpOn ? '<span class="cs-xp' + (ready ? ' ready' : '') + '">XP ' + xp.toLocaleString() + (lvl < 20 ? ' / ' + next.toLocaleString() : '')
      + '<i class="cs-xpbar"><i style="width:' + (lvl < 20 ? Math.min(100, Math.round(100 * (xp - CS_XP[lvl - 1]) / Math.max(1, next - CS_XP[lvl - 1]))) : 100) + '%"></i></i>'
      + (ro ? '' : '<input type="number" min="0" data-cs-xp placeholder="+XP" aria-label="Add experience points"><button class="btn small" data-cs="addxp">Add</button>') + '</span>' : '')
    + '</div>'
    + (ro ? '' : '<button class="btn" data-cs="short">💤 Short rest</button><button class="btn" data-cs="long">🛌 Long rest</button>')
    + (!ro && pc.build && typeof openCharBuilder === 'function' ? '<button class="btn' + (ready ? ' primary' : '') + '" data-cs="levelup"' + ((pc.build.level || 1) >= 20 ? ' disabled' : '') + '>⬆ Level up</button><button class="btn" data-cs="edit">Edit</button>' : '')
    + (!ro && pc.build ? '<button class="btn" data-cs="customize" title="Custom bonuses">⚙ Customize</button>' : '')
    + '<button class="btn" data-cs="print" title="Print the sheet, or save it as a PDF">🖨 Print</button>'
    + '<button class="btn" data-cs="export" title="Save the character to a file, to bring into another campaign">⤓ Export</button>'
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
  h += '<div class="cs-hp"' + (sh.hpDetail ? ' title="Maximum: ' + csE(sh.hpDetail) + '"' : '') + '><div class="cs-hp-n"><b>' + hp + '</b><span>/ ' + max + '</span>'
    + (pc.tempHp > 0 ? '<i title="Temporary hit points">+' + pc.tempHp + ' temp</i>' : '') + '</div>'
    + '<div class="cs-hpbar"><i style="width:' + pct + '%"></i></div>'
    + (ro ? '' : '<div class="cs-hp-ctl"><input type="number" min="0" data-cs-amt value="' + (CS.amt || 5) + '" aria-label="Amount">'
      + '<button class="btn" data-cs-hp="-1">Damage</button><button class="btn" data-cs-hp="1">Heal</button><button class="btn" data-cs-hp="temp">Temp</button>'
      + '<select class="cb-sel" data-cs-dtype aria-label="Damage type"><option value="">type…</option>' + ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder']
        .map(t => '<option' + (CS.dtype === t ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></div>')
    + '</div>';
  // The boxes D&D Beyond puts along the top.
  const box = (l, v, act, title) => '<' + (act ? 'button data-cs-roll="' + act + '"' : 'div') + ' class="cs-box"' + (title ? ' title="' + csE(title) + '"' : '') + '><span>' + l + '</span><b>' + v + '</b></' + (act ? 'button' : 'div') + '>';
  h += csRestHtml(pc);
  if (CS.conc && pc.concentration && !ro) h += '<div class="cs-conc">Concentration check: <b>CON save DC ' + CS.conc.dc + '</b> to keep ' + csE(CS.conc.spell)
    + ' <button class="btn primary" data-cs="concsave">Roll it</button><button class="btn" data-cs="dropconc">Drop it</button></div>';
  h += '<div class="cs-boxes">' + box('AC', pc.ac ?? '—', null, sh.acDetail || sh.acSource || '')
    + box('Initiative', csSigned(pc.init ?? csMod((pc.abilities || {}).dex)), 'init')
    + box('Speed', csSpeed(pc) + ' ft', null, csSpeed(pc) !== (pc.spd ?? 30) ? 'Exhaustion: ' + (pc.spd ?? 30) + ' ft normally' : '')
    + box('Proficiency', csSigned(sh.profBonus || 2))
    + '<button class="cs-box cs-insp' + (pc.inspiration ? ' on' : '') + '" data-cs="insp"' + (ro ? ' disabled' : '') + ' title="Heroic Inspiration"><span>Inspiration</span><b>' + (pc.inspiration ? '✦' : '—') + '</b></button></div>';
  h += csStatesHtml(pc);
  // Conditions, exhaustion, concentration, death saves.
  h += '<div class="cs-state">'
    + conds.map(c => '<span class="cs-chip">' + csE(c) + (ro ? '' : '<button data-cs-cond="' + csE(c) + '" aria-label="Remove ' + csE(c) + '">×</button>') + '</span>').join('')
    + (ro ? '' : '<select class="cb-sel cs-addcond" data-cs-addcond><option value="">+ Condition</option>' + CS_CONDITIONS.filter(c => !conds.includes(c)).map(c => '<option>' + c + '</option>').join('') + '</select>')
    + '<span class="cs-exh">Exhaustion ' + (ro ? '' : '<button class="btn small" data-cs-exh="-1" aria-label="Less exhaustion">−</button>') + '<b>' + (+pc.exhaustion || 0) + '</b>' + (ro ? '' : '<button class="btn small" data-cs-exh="1" aria-label="More exhaustion">+</button>') + '</span>'
    + (csEffectLine(pc) ? '<span class="cs-fx">' + csE(csEffectLine(pc)) + '</span>' : '')
    + (pc.rage ? '<span class="cs-chip conc">Raging' + (ro ? '' : '<button data-cs="endrage" aria-label="End the rage">×</button>') + '</span>' : '')
    + (pc.wildshape && pc.wildshape.name ? '<span class="cs-chip conc">Wild Shape: ' + csE(pc.wildshape.name) + ' ' + (pc.wildshape.hp ?? '') + '/' + (pc.wildshape.hpMax ?? '') + ' HP' + (ro ? '' : '<button data-cs="endwild" aria-label="End Wild Shape">×</button>') + '</span>' : '')
    + (pc.hitDice && pc.hitDice.max ? '<span class="cs-hd">Hit dice <b>' + Math.max(0, pc.hitDice.current ?? pc.hitDice.max) + '/' + pc.hitDice.max + '</b> ' + csE((pc.sheet && pc.sheet.hitDiceByClass) || pc.hitDice.dieType || '') + '</span>' : '')
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
    + (!ro && pc.inspiration && CS.log[0] && CS.log[0].kind === 'd20' && !CS.log[0].rerolled ? '<button class="btn small" data-cs="reroll" title="Spend Heroic Inspiration to roll that again">✦ Reroll</button>' : '')
    + (CS.log.length > 1 ? '<button class="btn small" data-cs="log">' + (CS.showLog ? 'Hide log' : 'Log') + '</button>' : '')
    + '<span class="cs-last" aria-live="polite">' + (CS.log[0] ? csRollText(CS.log[0]) : '<span class="cb-dim">Click a score, save, skill or attack to roll.<span class="cs-keys"> Shift: advantage · Alt: disadvantage.</span></span>') + '</span></div>'
    + (CS.showLog ? '<div class="cs-log">' + CS.log.map(r => '<div>' + csRollText(r) + '</div>').join('') + '</div>' : '');
  return h + '</div>';
}
// The on/off states (Rage, Bladesong, Shield, Bless…), D&D Beyond's
// toggles: each changes the numbers on the sheet while it's on. What the
// ones that are on do is spelled out under them, for a phone with no
// hover.
function csStatesHtml(pc){
  const st = (pc.sheet || {}).states || []; if (!st.length) return '';
  const ro = CS.readOnly;
  const on = st.filter(s => s.on);
  return '<div class="cs-states"><span class="cb-dim">Active effects</span>' + st.map(s => {
    const res = s.resource ? (pc.resources || []).find(r => r.name === s.resource) : null;
    const tip = s.desc + (s.conc ? ' Concentration.' : '') + (res && !s.on ? ' Uses one ' + s.resource + ' (' + (res.current || 0) + ' left).' : '');
    return '<button class="cs-stbtn' + (s.on ? ' on' : '') + '" data-cs-state="' + csE(s.key) + '" aria-pressed="' + s.on + '" title="' + csE(tip) + '"' + (ro ? ' disabled' : '') + '>'
      + csE(s.label) + (s.conc ? ' <i title="Concentration">C</i>' : '') + '</button>'
      + (s.on && s.options ? '<select class="cb-sel" data-cs-stateopt="' + csE(s.key) + '" aria-label="' + csE(s.label) + ' option"' + (ro ? ' disabled' : '') + '>'
        + s.options.map(o => '<option' + (o === s.value ? ' selected' : '') + '>' + csE(o) + '</option>').join('') + '</select>' : '');
  }).join('') + (on.length ? '<div class="cs-stdesc">' + on.map(s => '<span><b>' + csE(s.label) + (s.options ? ' (' + csE(s.value) + ')' : '') + ':</b> ' + csE(s.desc) + '</span>').join('') + '</div>' : '') + '</div>';
}
// Exhaustion slows: 5 ft a level in 2024; halved at 2 and nothing at 5 in 2014.
function csSpeed(pc){
  const s = pc.spd ?? 30, exh = +pc.exhaustion || 0;
  const ed = (pc.build && pc.build.edition) || pc.rules || '2024';
  if (!exh) return s;
  if (ed === '2024') return Math.max(0, s - 5 * exh);
  return exh >= 5 ? 0 : exh >= 2 ? Math.floor(s / 2) : s;
}
// In words, what the conditions are doing to rolls right now.
function csEffectLine(pc){
  const parts = [];
  const a = csRollEffects(pc, 'attack'), c = csRollEffects(pc, 'check'), s = csRollEffects(pc, 'save:dex');
  if (a.dis.length) parts.push('attacks at disadvantage'); else if (a.adv.length) parts.push('attacks at advantage');
  if (c.dis.length) parts.push('ability checks at disadvantage');
  if (c.bonus) parts.push('d20 tests ' + c.bonus);
  if (s.autoFail) parts.push('fails STR and DEX saves');
  return parts.join(' · ');
}
// The short rest panel: hit dice to spend, one at a time, then Finish.
function csRestHtml(pc){
  if (!CS.resting || CS.readOnly) return '';
  const hd = pc.hitDice || { current: 0, max: 0, dieType: 'd8' };
  return '<div class="cs-rest"><h4>Short rest</h4>'
    + '<div>Hit dice <b>' + Math.max(0, hd.current ?? hd.max) + ' / ' + hd.max + '</b> ' + csE(hd.dieType || '') + (pc.sheet && pc.sheet.hitDiceByClass ? ' <span class="cb-dim">(' + csE(pc.sheet.hitDiceByClass) + ')</span>' : '') + ' · HP <b>' + (pc.hp || 0) + ' / ' + (pc.hpMax || 0) + '</b></div>'
    + (CS.resting.rolls.length ? '<div class="cb-dim">Rolled ' + csE(CS.resting.rolls.join(', ')) + ' — healed ' + CS.resting.healed + '</div>' : '')
    + '<div class="cs-rest-b"><button class="btn" data-cs="restdie"' + ((hd.current || 0) > 0 && (pc.hp || 0) < (pc.hpMax || 0) ? '' : ' disabled') + '>🎲 Spend a hit die</button>'
    + '<button class="btn primary" data-cs="restdone">Finish the rest</button><button class="btn" data-cs="restcancel">Cancel</button></div>'
    + '<div class="cb-dim">Finishing gives back what a short rest restores (Second Wind, Action Surge, Pact Magic…).</div></div>';
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
  const why = pc.build && CS.R && typeof sktAbilityBreakdown === 'function' ? sktAbilityBreakdown(pc.build, CS.R) : {};
  let h = '<div class="cs-abs">' + Object.keys(CS_AB).map(k => '<button class="cs-ab" data-cs-roll="ab:' + k + '" title="' + CS_AB[k] + ' check' + (why[k] ? ' — ' + csE(why[k]) : '') + '">'
    + '<span>' + k.toUpperCase() + '</span><b>' + csSigned(csMod(ab[k])) + '</b><i>' + (ab[k] ?? '—') + '</i></button>').join('') + '</div>';
  h += '<h5>Saving throws</h5><div class="cs-list">' + Object.keys(CS_AB).map(k => '<button class="cs-row" data-cs-roll="save:' + k + '">'
    + '<span class="cs-dot' + ((sh.saveProf || []).includes(k) ? ' on' : '') + '"></span><span>' + CS_AB[k] + '</span><b>' + csSigned(saveOf(k)) + '</b></button>').join('') + '</div>';
  h += '<h5>Skills</h5><div class="cs-list">' + Object.keys(CS_SKILLS).map(k => {
    const p = (sh.skillProf || {})[k] || 0;
    const disad = k === 'stealth' && sh.stealthDis;
    return '<button class="cs-row" data-cs-roll="skill:' + k + '"><span class="cs-dot' + (p >= 2 ? ' exp' : p ? ' on' : '') + '" title="' + (p >= 2 ? 'Expertise' : p ? 'Proficient' : '') + '"></span>'
      + '<span>' + CS_SKILLS[k][0] + ' <i>' + CS_SKILLS[k][1].toUpperCase() + '</i>' + (disad ? ' <i class="cs-dis" title="Disadvantage from armour">D</i>' : '') + '</span><b>' + csSigned(skillOf(k)) + '</b></button>';
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

// ── A character to a file, and back ──────────────────────────────────────────
// The whole party record (and the build, so it can level up) as JSON. The
// portrait goes with it when it is a picture inside the record.
function sktCharacterFile(pc){
  return JSON.stringify({ format: 'skt-character', version: 1, exported: new Date().toISOString(), character: pc }, null, 1);
}
function sktExportCharacter(pc){
  const blob = new Blob([sktCharacterFile(pc)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = String(pc.name || 'character').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '.json';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return a.download;
}
// A file from Export (or a bare record) back into the party, as a new member.
function sktImportCharacter(text){
  let data;
  try { data = JSON.parse(text); } catch(e){ throw new Error('That isn’t a character file.'); }
  const pc = data && data.format === 'skt-character' ? data.character : data;
  if (!pc || typeof pc !== 'object' || !pc.name || !(pc.sheet || pc.build)) throw new Error('That file has no character in it.');
  const rec = JSON.parse(JSON.stringify(pc));
  rec.id = (typeof uid === 'function') ? uid() : 'pc_' + Date.now().toString(36);
  delete rec.rolls;
  const run = () => { state.party.push(rec); save(); try { panelDefs.party && panelDefs.party._render && panelDefs.party._render(); } catch(_){} };
  if (typeof sktUndoable === 'function') sktUndoable('Imported ' + rec.name, run); else run();
  return rec;
}

// ── Printing ─────────────────────────────────────────────────────────────────
// The whole sheet on paper (or a PDF from the print dialog): every tab at
// once, without the buttons.
function csPrint(pc){
  const ro = CS.readOnly;
  CS.readOnly = true;
  let html;
  try {
    html = '<div class="cs-p-head"><h1>' + csE(pc.name) + '</h1><div>' + csE(csClassLine(pc)) + '</div></div>'
      + '<div class="cs-p-grid"><div class="cs-p-side">' + csSide(pc) + '</div><div class="cs-p-main">'
      + '<div class="cs-boxes">' + [['AC', pc.ac], ['HP', pc.hpMax || 0], ['Initiative', csSigned(pc.init)], ['Speed', (pc.spd || 30) + ' ft'], ['Proficiency', csSigned((pc.sheet || {}).profBonus || 2)]]
        .map(([l, v]) => '<div class="cs-box"><span>' + l + '</span><b>' + csE(v) + '</b></div>').join('') + '</div>'
      + ['actions', 'spells', 'inventory', 'features', 'background'].map(t => '<h2>' + CS_TABS.find(x => x.id === t).label + '</h2>' + CS_TAB_RENDER[t](pc)).join('')
      + '</div></div>';
  } finally { CS.readOnly = ro; }
  document.getElementById('cs-print')?.remove();
  const box = document.createElement('div');
  box.id = 'cs-print'; box.className = 'cs cs-print'; box.innerHTML = html;
  document.body.appendChild(box);
  const done = () => { box.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  if (typeof window.print === 'function') window.print();
  return box;
}

// ── Rolling ──────────────────────────────────────────────────────────────────
function csD(n){ return typeof sktD === 'function' ? sktD(n) : 1 + Math.floor(Math.random() * n); }
// What the character's conditions do to a roll, the way D&D Beyond marks
// it: kind is 'check', 'init', 'attack' or 'save:<ability>'. Advantage and
// disadvantage from any number of sources cancel to a straight roll.
// What a roll is, for the states that change some rolls: 'attack',
// 'save', 'save:dex', 'check', 'skill:acrobatics', 'ab:str'…
function csRollTags(kind){
  kind = String(kind || '');
  const t = [kind];
  if (/^attack/.test(kind)) t.push('attack');
  if (/^save:/.test(kind)) t.push('save');
  if (/^check:/.test(kind)){ const sk = kind.slice(6); t.push('check', 'skill:' + sk); if (CS_SKILLS[sk]) t.push('ab:' + CS_SKILLS[sk][1]); }
  if (/^abcheck:/.test(kind)) t.push('check', 'ab:' + kind.slice(8));
  return t;
}
function csRollEffects(pc, kind){
  const conds = _csConditions(pc).map(c => String(c).toLowerCase());
  const has = c => conds.some(x => x === c || x.startsWith(c + ' '));
  const ed = (pc.build && pc.build.edition) || pc.rules || '2024';
  const exh = +pc.exhaustion || 0;
  const isCheck = kind === 'check' || kind === 'init' || /^(ab)?check:/.test(kind), isAtk = /^attack/.test(kind), save = /^save:/.test(kind) ? kind.slice(5) : '';
  const skill = /^check:/.test(kind) ? kind.slice(6) : '';
  const adv = [], dis = []; let bonus = 0, autoFail = '';
  if (exh){
    if (ed === '2024') bonus -= 2 * exh;
    else { if (isCheck) dis.push('exhaustion'); if (exh >= 3 && (isAtk || save)) dis.push('exhaustion'); }
  }
  if (has('poisoned') && (isAtk || isCheck)) dis.push('poisoned');
  if (has('frightened') && (isAtk || isCheck)) dis.push('frightened');
  ['blinded', 'prone', 'restrained'].forEach(c => { if (has(c) && isAtk) dis.push(c); });
  if (has('restrained') && save === 'dex') dis.push('restrained');
  if (has('invisible') && isAtk) adv.push('invisible');
  // Armour that's loud (chain mail, plate…): Stealth at disadvantage.
  if (skill === 'stealth' && pc.sheet && pc.sheet.stealthDis) dis.push('armour');
  if (save === 'str' || save === 'dex') ['paralyzed', 'stunned', 'petrified', 'unconscious'].forEach(c => { if (has(c) && !autoFail) autoFail = c; });
  // Rage, Haste, Bladesong…
  const tags = csRollTags(kind);
  ((pc.sheet || {}).rollAdv || []).forEach(x => { if ((x.on || []).some(t => tags.includes(t))) adv.push(x.label); });
  return { adv: [...new Set(adv)], dis: [...new Set(dis)], bonus, autoFail };
}
function csRollD20(label, mod, ev, kind){
  const pick = ev && ev.shiftKey ? 'adv' : ev && ev.altKey ? 'dis' : CS.mode;
  const fx = kind ? csRollEffects(csPc() || {}, kind) : { adv: [], dis: [], bonus: 0, autoFail: '' };
  const up = pick === 'adv' || fx.adv.length > 0, down = pick === 'dis' || fx.dis.length > 0;
  const mode = up && !down ? 'adv' : down && !up ? 'dis' : 'normal';
  const pcNow = csPc() || {};
  const has = n => ((pcNow.sheet || {}).featureList || []).some(f => f.name === n && !f.info);
  // Halfling Lucky: a 1 on the d20 is rolled again (and the new roll kept).
  const lucky = has('Lucky') && ((pcNow.sheet || {}).featureList || []).some(f => f.name === 'Lucky' && f.from === 'species');
  const die = () => { const x = csD(20); return lucky && x === 1 ? (fx._lucky = true, csD(20)) : x; };
  const a = die(), b = mode === 'normal' ? null : die();
  let nat = b == null ? a : mode === 'adv' ? Math.max(a, b) : Math.min(a, b);
  // Reliable Talent: a proficient ability check treats a roll under 10 as 10.
  const skillKey = /^check:/.test(kind || '') ? kind.slice(6) : '';
  if (skillKey && has('Reliable Talent') && ((pcNow.sheet || {}).skillProf || {})[skillKey] && nat < 10){ fx._reliable = nat; nat = 10; }
  mod = (+mod || 0) + fx.bonus;
  // Dice a state adds (Bless's d4).
  const tags = csRollTags(kind);
  const extra = ((pcNow.sheet || {}).rollDice || []).filter(x => (x.on || []).some(t => tags.includes(t))).map(x => ({ label: x.label, die: x.die, n: csD(x.die) }));
  const extraSum = extra.reduce((s, x) => s + x.n, 0);
  const why = [extra.map(x => x.label + ' d' + x.die + ': ' + x.n).join(', '), fx.adv.length ? 'advantage: ' + fx.adv.join(', ') : '', fx.dis.length ? 'disadvantage: ' + fx.dis.join(', ') : '', fx.bonus ? 'exhaustion ' + fx.bonus : '', fx.autoFail ? fx.autoFail + ' — automatic failure' : '',
               fx._lucky ? 'Lucky: rerolled a 1' : '', fx._reliable ? 'Reliable Talent: ' + fx._reliable + ' counts as 10' : ''].filter(Boolean).join('; ');
  const r = { kind: 'd20', label, mod: mod - fx.bonus, rolls: b == null ? [a] : [a, b], natural: nat, total: nat + mod + extraSum, mode, crit: nat === 20, fumble: nat === 1, why, autoFail: !!fx.autoFail, kindTag: kind || null };
  csLog(r);
  // The party card's own strip shows the DM the same roll.
  const pc = csPc();
  try { if (panelDefs.party && panelDefs.party._setLastRoll && !document.body.classList.contains('player-mode'))
          panelDefs.party._setLastRoll(pc, Object.assign({ kept: 0 }, r, { mode: mode === 'normal' ? 'normal' : mode })); } catch(e){}
  return r;
}
// "2d6+1d4+3 slashing", "1d10+4 force ×2 beams": every term, crits double the dice.
function sktDamageRoll(expr, crit, opts){
  opts = opts || {};
  const s = String(expr || '');
  const math = s.split(/[a-z]{2,}/i)[0];
  const type = s.slice(math.length).trim();
  let total = 0; const parts = [];
  math.replace(/([+-]?)\s*(\d*)d(\d+)|([+-]?)\s*(\d+)/gi, (m, sg, n, d, sg2, k) => {
    if (d){
      // A crit doubles the dice; Brutal Critical / Savage Attacks add more of
      // the first die; Great Weapon Fighting rerolls 1s and 2s (2014) or
      // counts them as 3s (2024).
      const first = !parts.length;
      const cnt = (parseInt(n || '1', 10) || 1) * (crit ? 2 : 1) + (crit && first ? (opts.extraDice || 0) : 0), rs = [];
      for (let i = 0; i < cnt; i++){
        let x = csD(+d);
        if (opts.gwf === '2014' && x <= 2) x = csD(+d);
        else if (opts.gwf === '2024' && x <= 2) x = 3;
        rs.push(x);
      }
      const sum = rs.reduce((x, y) => x + y, 0) * (sg === '-' ? -1 : 1);
      total += sum; parts.push(cnt + 'd' + d + ' [' + rs.join(', ') + ']');
    } else if (k){ const v = (+k) * (sg2 === '-' ? -1 : 1); total += v; parts.push(String(v)); }
    return m;
  });
  return { total: Math.max(0, total), detail: parts.join(' + '), type, crit: !!crit };
}
function csRollDamage(label, expr, crit, opts){
  const r = Object.assign({ kind: 'dmg', label }, sktDamageRoll(expr, crit, opts));
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
    + (r.crit ? ' — natural 20' : r.fumble ? ' — natural 1' : '') + (r.why ? ' [' + r.why + ']' : '');
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
  let h = '<div class="cs-asec" data-k="attack"><h4>Attacks' + (sh.attacksPerAction > 1 ? ' <span class="cb-dim">' + sh.attacksPerAction + ' per Attack action</span>' : '') + '</h4>';
  h += atks.length ? '<div class="cs-atks"><div class="cs-atk cs-atk-h"><span>Name</span><span>Hit / DC</span><span>Damage</span><span>Notes</span></div>'
    + atks.map((a, i) => '<div class="cs-atk"><b>' + csE(a.name) + '</b>'
      + (/^[+-]?\d+$/.test(String(a.atkBonus || '').trim()) ? '<button class="btn small" data-cs-atk="' + i + '">' + csE(a.atkBonus) + '</button>' : '<span>' + csE(a.atkBonus || '') + '</span>')
      + (a.damage ? '<span class="cs-dmgs"><button class="btn small" data-cs-dmg="' + i + '">' + csE(a.damage) + '</button>'
        + (a.versatile ? '<button class="btn small" data-cs-dmg2="' + i + '" title="Two-handed">' + csE(a.versatile) + '</button>' : '') + '</span>' : '<span></span>')
      + '<span class="cb-dim">' + csE([a.mastery ? 'Mastery: ' + a.mastery : '', a.range ? a.range + ' ft' : '', (a.props || []).includes('A') ? csAmmoLeft(pc, a) : ''].filter(Boolean).join(' · ')) + '</span></div>').join('') + '</div>'
    : '<div class="cb-dim">No attacks recorded.</div>';
  // Levelled spells that attack or call for a save, as D&D Beyond lists them.
  const spl = [...new Set(sh.spells || [])].map(n => csSpell(n)).filter(s => s && s.level > 0 && ((s.spellAttack || []).length || (s.savingThrow || []).length) && csSpellDamage(s, s.level));
  if (spl.length) h += '<h4>Spells</h4><div class="cs-atks">' + spl.map(s => '<div class="cs-atk"><b>' + csE(s.name) + ' <span class="cb-dim">' + CS_ORD[s.level] + '</span></b>'
    + ((s.spellAttack || []).length ? '<button class="btn small" data-cs-spatk="1">' + csE(sh.spellAtkBonus || '') + '</button>' : '<span>DC ' + (sh.spellSaveDc || '?') + ' ' + csE(String(s.savingThrow[0]).slice(0, 3).toUpperCase()) + '</span>')
    + '<button class="btn small" data-cs-spdmg="' + csE(s.name) + '">' + csE(csSpellDamage(s, s.level)) + '</button><span class="cb-dim">' + csE(csSpellMeta(s)) + '</span></div>').join('') + '</div>';
  h += csExtraDamageHtml(pc) + '</div>';
  const acts = sh.activations || [];
  // A 2024 Magic action is an action.
  const kind = a => a.action === 'Magic' ? 'Action' : (a.action || 'Action');
  const groups = [['Action', 'Actions', 'action'], ['Bonus Action', 'Bonus actions', 'bonus'], ['Reaction', 'Reactions', 'reaction']];
  groups.forEach(([k, l, tag]) => {
    const list = acts.filter(a => kind(a) === k);
    if (list.length) h += '<div class="cs-asec" data-k="' + tag + '"><h4>' + l + '</h4>' + list.map(a => csActHtml(pc, a)).join('') + '</div>';
  });
  const other = acts.filter(a => !groups.some(([k]) => k === kind(a)));
  if (other.length) h += '<div class="cs-asec" data-k="other"><h4>Other</h4>' + other.map(a => csActHtml(pc, a)).join('') + '</div>';
  const res = pc.resources || [];
  if (res.length){
    h += '<div class="cs-asec" data-k="limited"><h4>Limited use</h4>' + res.map((r, i) => '<div class="cs-res"><b>' + csE(r.name) + '</b>'
      + '<span class="cs-pips">' + Array.from({ length: Math.min(r.max || 0, 20) }, (_, n) => '<button class="cs-pip' + (n < (r.current || 0) ? ' on' : '') + '" data-cs-res="' + i + ':' + n + '"' + (ro ? ' disabled' : '') + ' aria-label="' + csE(r.name) + ' ' + (n + 1) + '"></button>').join('') + '</span>'
      + '<span class="cb-dim">' + (r.current || 0) + '/' + (r.max || 0) + (r.recharge ? ' · ' + (r.recharge === 'short-one' ? 'one back on a short rest' : /short/.test(r.recharge) ? 'short rest' : r.recharge === 'dawn' ? (r.note || 'at dawn') : 'long rest') : '') + '</span></div>').join('') + '</div>';
  }
  if (!ro && pc.build){
    h += '<details class="cs-addcustom"><summary>+ Add a tracker or an action</summary>'
      + '<div class="cs-add"><input data-cs-trk placeholder="Tracker — e.g. Wand charges" maxlength="40"><input type="number" min="1" max="99" data-cs-trkmax placeholder="Uses" aria-label="Uses">'
      + '<select class="cb-sel" data-cs-trkrec aria-label="Recharge"><option value="long">Long rest</option><option value="short">Short rest</option><option value="dawn">Dawn</option></select><button class="btn" data-cs="addtrk">Add tracker</button></div>'
      + '<div class="cs-add"><input data-cs-act placeholder="Action — e.g. Breath of the Wyrm" maxlength="40"><select class="cb-sel" data-cs-acttype aria-label="Kind"><option>Action</option><option>Bonus Action</option><option>Reaction</option><option>Free</option></select>'
      + '<input data-cs-actdesc placeholder="What it does" maxlength="200"><button class="btn" data-cs="addact">Add action</button></div>'
      + ((pc.build.customResources || []).length || (pc.build.customActions || []).length ? '<div class="cb-dim">Yours: '
        + (pc.build.customResources || []).map((r, i) => csE(r.name) + ' <button class="cs-linkbtn" data-cs-deltrk="' + i + '">remove</button>').concat(
          (pc.build.customActions || []).map((a, i) => csE(a.name) + ' <button class="cs-linkbtn" data-cs-delact="' + i + '">remove</button>')).join(' · ') + '</div>' : '')
      + '</details>';
  }
  h += '<details class="cs-std"><summary>Standard actions</summary><div class="cb-dim">'
    + ((pc.rules || (pc.build && pc.build.edition)) === '2014'
      ? 'Attack · Cast a Spell · Dash · Disengage · Dodge · Help · Hide · Ready · Search · Use an Object · Grapple · Shove'
      : 'Attack · Dash · Disengage · Dodge · Help · Hide · Influence · Magic · Ready · Search · Study · Utilize') + '</div></details>';
  const f = CS.actF || 'all';
  const pills = [['all', 'All'], ['attack', 'Attack'], ['action', 'Action'], ['bonus', 'Bonus action'], ['reaction', 'Reaction'], ['other', 'Other'], ['limited', 'Limited use']];
  return '<div class="cs-spfilter"><span class="cb-seg">' + pills.map(([k, l]) => '<button class="' + (f === k ? 'on' : '') + '" data-cs-actf="' + k + '">' + l + '</button>').join('') + '</span></div>'
    + '<div class="cs-actions" data-f="' + f + '">' + h + '</div>';
};
// Damage a hit can add: a rogue's Sneak Attack, a paladin's smite (paid
// with a slot), Hex and Hunter's Mark — rolled on their own, like D&D
// Beyond's damage buttons.
function csExtraDamageHtml(pc){
  const sh = pc.sheet || {}, ro = CS.readOnly;
  const rows = [];
  const sa = (pc.resources || []).find(r => r.name === 'Sneak Attack' && r.die);
  if (sa) rows.push('<div class="cs-act"><div class="cs-act-h"><b>Sneak Attack</b><span class="cb-dim">once a turn, with advantage or an ally beside the target</span>'
    + '<button class="btn small" data-cs-xdmg="Sneak Attack|' + csE(sa.die) + '">' + csE(sa.die) + '</button></div></div>');
  const smite = (sh.activations || []).some(a => /Divine Smite|Paladin.s Smite/.test(a.name)) || (sh.spells || []).includes('Divine Smite');
  if (smite){
    const slots = sh.spellSlots || {};
    const avail = Object.keys(slots).map(Number).filter(l => (slots[l].total - (slots[l].expended || 0)) > 0).sort((a, b) => a - b);
    rows.push('<div class="cs-act"><div class="cs-act-h"><b>Divine Smite</b><span class="cb-dim">on a melee hit: 2d8 radiant, +1d8 a slot level above 1st (+1d8 against fiends and undead)</span>'
      + (ro ? '' : avail.length ? '<select class="cb-sel" data-cs-smitelvl>' + avail.map(l => '<option value="' + l + '">' + CS_ORD[l] + ' slot</option>').join('') + '</select>'
        + '<label class="cb-inline"><input type="checkbox" data-cs-smiteundead> fiend/undead</label><button class="btn small" data-cs="smite">Smite</button>' : '<span class="cb-dim">no slots</span>') + '</div></div>');
  }
  if ((sh.spells || []).includes('Hex')) rows.push('<div class="cs-act"><div class="cs-act-h"><b>Hex</b><span class="cb-dim">each hit on the cursed target</span><button class="btn small" data-cs-xdmg="Hex|1d6 necrotic">1d6 necrotic</button></div></div>');
  if ((sh.spells || []).some(n => /Hunter.s Mark/.test(n))) rows.push('<div class="cs-act"><div class="cs-act-h"><b>Hunter’s Mark</b><span class="cb-dim">each weapon hit on the marked target</span><button class="btn small" data-cs-xdmg="Hunter’s Mark|1d6 force">1d6</button></div></div>');
  (sh.extraDamage || []).forEach(x => rows.push('<div class="cs-act"><div class="cs-act-h"><b>' + csE(x.label) + '</b><span class="cb-dim">' + csE(x.note || '') + '</span><button class="btn small" data-cs-xdmg="' + csE(x.label + '|' + x.dice) + '">' + csE(x.dice) + '</button></div></div>'));
  return rows.length ? '<h4>Extra damage</h4>' + rows.join('') : '';
}
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
      + (f.mech ? ' <span class="cb-badge">applied</span>' : '') + csFeatureUses(pc, f.name) + '</summary><div class="cs-feat-t">' + csE(f.text || '').replace(/\n/g, '<br>') + '</div></details>').join('');
  });
  return h;
};

// The uses a feature has left, with pips to spend and a Use button for its
// action, when it has a tracker.
function csFeatureUses(pc, name){
  const res = pc.resources || [];
  const ri = res.findIndex(r => r.name === name || (r.feature && r.feature === name));
  const act = ((pc.sheet || {}).activations || []).find(a => a.feature === name || a.name === name);
  if (ri < 0 && !act) return '';
  const r = res[ri], ro = CS.readOnly;
  let h = ' <span class="cs-fuses">';
  if (r && r.type !== 'toggle') h += '<span class="cs-pips">' + Array.from({ length: Math.min(r.max || 0, 20) }, (_, n) => '<button class="cs-pip' + (n < (r.current || 0) ? ' on' : '') + '" data-cs-res="' + ri + ':' + n + '"' + (ro ? ' disabled' : '') + ' aria-label="' + csE(r.name) + ' ' + (n + 1) + '"></button>').join('') + '</span>'
    + '<span class="cb-dim">' + (r.current || 0) + '/' + (r.max || 0) + '</span>';
  if (act && act.resource && !ro) h += '<button class="btn small" data-cs-use="' + csE(act.name) + '"' + ((res.find(x => x.name === act.resource) || {}).current >= (act.amount || 1) ? '' : ' disabled') + '>Use</button>';
  return h + '</span>';
}

// Background: who they are. Written into the build too, so the builder shows it.
CS_TAB_RENDER.background = pc => {
  const sh = pc.sheet || {}, d = sh.details || (pc.build && pc.build.details) || {}, ro = CS.readOnly;
  const bgFeat = (sh.featureList || []).filter(f => f.from === 'background');
  let h = '<h4>' + csE(pc.background || (pc.build && pc.build.background) || 'Background') + '</h4>'
    + bgFeat.map(f => '<div class="cs-feat-t"><b>' + csE(f.name) + '</b><br>' + csE(f.text || '').replace(/\n/g, '<br>') + '</div>').join('');
  const facts = [['alignment', 'Alignment'], ['gender', 'Gender'], ['faith', 'Faith'], ['lifestyle', 'Lifestyle'], ['age', 'Age'], ['height', 'Height'], ['weight', 'Weight'], ['eyes', 'Eyes'], ['hair', 'Hair'], ['skin', 'Skin']];
  h += '<div class="cs-facts">' + (sh.size ? '<div class="cs-kv"><span>Size</span><b>' + csE(sh.size) + '</b></div>' : '')
    + facts.map(([k, l]) => '<label class="cs-kv"><span>' + l + '</span>' + (ro ? '<b>' + csE(d[k] || '—') + '</b>' : '<input data-cs-detail="' + k + '" value="' + csE(d[k] || '') + '" maxlength="40">') + '</label>').join('') + '</div>';
  [['personality', 'Personality traits'], ['ideals', 'Ideals'], ['bonds', 'Bonds'], ['flaws', 'Flaws'], ['appearance', 'Appearance'],
   ['allies', 'Allies & organizations'], ['enemies', 'Enemies'], ['backstory', 'Backstory']].forEach(([k, l]) => {
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

// Extras: a familiar, a steed, a beast companion — any creature from the
// bestiary, with its hit points kept here and its stat block a tap away.
function csMonster(name){
  if (typeof _5eData === 'undefined' || !Array.isArray(_5eData)) return null;
  const n = String(name || '').toLowerCase();
  return _5eData.find(d => d.cat === 'monster' && String(d.name).toLowerCase() === n) || null;
}
// Companions a feature brings, as D&D Beyond adds them to Extras: the
// Battle Smith's Steel Defender, the Drakewarden's drake, the Beast Master's
// primal companion, the Wildfire Spirit, a Homunculus Servant infusion.
const CS_COMPANIONS = [
  { feature: 'Steel Defender', names: ['Steel Defender'] },
  { feature: 'Drake Companion', names: ['Drake Companion'] },
  { feature: 'Primal Companion', names: ['Beast of the Land', 'Beast of the Sea', 'Beast of the Sky'] },
  { feature: 'Summon Wildfire Spirit', names: ['Wildfire Spirit'] },
  { feature: 'Homunculus Servant', names: ['Homunculus Servant'], edition: '2014' },
];
// Creatures a spell or a pact calls, offered as a list: a familiar's forms,
// Pact of the Chain's special ones, a steed.
const CS_SUMMONS = [
  { label: 'Familiar', spell: 'Find Familiar', names: ['Bat', 'Cat', 'Crab', 'Frog', 'Hawk', 'Lizard', 'Octopus', 'Owl', 'Poisonous Snake', 'Venomous Snake', 'Quipper', 'Rat', 'Raven', 'Sea Horse', 'Spider', 'Weasel'] },
  { label: 'Pact familiar', feature: 'Pact of the Chain', names: ['Imp', 'Pseudodragon', 'Quasit', 'Sprite', 'Skeleton', 'Slaad Tadpole', 'Sphinx of Wonder'] },
  { label: 'Steed', spell: 'Find Steed', names: ['Warhorse', 'Pony', 'Camel', 'Elk', 'Mastiff', 'Otherworldly Steed'] },
];
// A stat block's AC or HP written as a formula ("5 + five times your
// Artificer level", "12 + your Intelligence modifier", "14 + PB"), worked
// out for this character. Null when it isn't one.
function csCompanionFormula(pc, text){
  let s = String(text || '').split('(')[0].toLowerCase();
  if (!/your|pb/.test(s)) return null;
  const NUM = { two: 2, three: 3, four: 4, five: 5, six: 6 };
  const lvl = cls => { const p = pc.build && CS.R ? sktClassLevels(pc.build, CS.R).find(x => x.key === cls) : null; return p ? p.level : (pc.level || 1); };
  const mod = ab => Math.floor((((pc.abilities || {})[ab.slice(0, 3)] || 10) - 10) / 2);
  const pb = (pc.sheet && pc.sheet.profBonus) || sktProfBonus(pc.level || 1);
  s = s.replace(/(two|three|four|five|six) times your (\w+) level/g, (_, n, c) => String(NUM[n] * lvl(c)))
       .replace(/your (\w+) level/g, (_, c) => String(lvl(c)))
       .replace(/your (strength|dexterity|constitution|intelligence|wisdom|charisma) modifier/g, (_, a) => String(mod(a)))
       .replace(/\bpb\b|your proficiency bonus/g, String(pb));
  const nums = s.match(/-?\d+/g);
  return nums ? nums.reduce((t, n) => t + +n, 0) : null;
}
// The edition's own printing where both books have the creature (the 2014
// and 2024 Steel Defender differ).
function csCompanionMonster(pc, name){
  if (typeof _5eData === 'undefined' || !Array.isArray(_5eData)) return null;
  const n = String(name).toLowerCase(), new24 = (pc.rules || (pc.build && pc.build.edition)) === '2024';
  const hits = _5eData.filter(d => d.cat === 'monster' && String(d.name).toLowerCase() === n);
  return hits.find(d => (typeof SKT_2024_ERA !== 'undefined' && SKT_2024_ERA.has(d._source || d.source)) === new24) || hits[0] || null;
}
function csCompanionStats(pc, m){
  const raw = (m && m._raw) || {};
  const ac = raw.ac_special ? csCompanionFormula(pc, raw.ac_special) : (((raw.armor_class || [])[0] || {}).value || parseInt(m && m.ac, 10) || null);
  const hp = raw.hp_special ? csCompanionFormula(pc, raw.hp_special) : (raw.hit_points || parseInt(m && m.hp, 10) || 0);
  return { ac, hp: Math.max(1, hp || 1) };
}
CS_TAB_RENDER.extras = pc => {
  const ro = CS.readOnly, list = pc.extras || [];
  let h = '<div class="cb-dim">Familiars, mounts, companions and summoned creatures.</div>';
  h += list.length ? list.map((x, i) => {
    const m = csMonster(x.name), open = CS.open['ex:' + i];
    return '<div class="cs-extra"><div class="cs-extra-h"><b>' + csE(x.name) + '</b><span>AC ' + csE(x.ac ?? '—') + '</span>'
      + '<span class="cs-qty">HP ' + (ro ? '' : '<button class="btn small" data-cs-exhp="' + i + ':-1" aria-label="Damage">−</button>') + '<b>' + (x.hp ?? 0) + '</b> / ' + (x.hpMax ?? 0)
      + (ro ? '' : '<button class="btn small" data-cs-exhp="' + i + ':1" aria-label="Heal">+</button>') + '</span>'
      + (m ? '<button class="btn small" data-cs-open="ex:' + i + '">' + (open ? 'Hide' : 'Stat block') + '</button>' : '')
      + (ro ? '' : '<button class="btn small" data-cs-exdel="' + i + '" aria-label="Remove ' + csE(x.name) + '">✕</button>') + '</div>'
      + (open && m && typeof buildDetailCard === 'function' ? '<div class="cs-extra-card">' + buildDetailCard(m, '-cs-' + i) + '</div>' : '') + '</div>';
  }).join('') : '<div class="cb-dim">None yet.</div>';
  if (!ro){
    const feats = new Set(((pc.sheet || {}).featureList || []).map(f => f.name));
    const ed = pc.rules || (pc.build && pc.build.edition);
    const have = new Set(list.map(x => x.name));
    const offer = [].concat(...CS_COMPANIONS.filter(c => feats.has(c.feature) && (!c.edition || c.edition === ed)).map(c => c.names)).filter(n => !have.has(n) && csCompanionMonster(pc, n));
    if (offer.length) h += '<h5>Your companions</h5><div class="cs-add">' + offer.map(n => '<button class="btn" data-cs-comp="' + csE(n) + '">+ ' + csE(n) + '</button>').join('') + '</div>';
    const known = new Set([].concat((pc.sheet || {}).spells || [], (pc.sheet || {}).spellbook || []));
    const opts = name => (pc.build && pc.build.optional && Object.values(pc.build.optional).some(l => (l || []).includes(name)));
    CS_SUMMONS.filter(c => (c.spell && known.has(c.spell)) || (c.feature && (feats.has(c.feature) || opts(c.feature)))).forEach(c => {
      const forms = c.names.filter(n => csCompanionMonster(pc, n));
      if (forms.length) h += '<h5>' + csE(c.label) + '</h5><div class="cs-add"><select class="cb-sel" data-cs-sumsel="' + csE(c.label) + '">' + forms.map(n => '<option>' + csE(n) + '</option>').join('') + '</select>'
        + '<button class="btn" data-cs="addsummon" data-cs-sumfor="' + csE(c.label) + '">Add</button></div>';
    });
    const names = typeof _5eData !== 'undefined' && Array.isArray(_5eData) ? [...new Set(_5eData.filter(d => d.cat === 'monster').map(d => d.name))].sort() : [];
    h += '<h5>Add a creature</h5><div class="cs-add"><input data-cs-exq list="cs-mon-dl" placeholder="Owl, Riding Horse, Wolf…"><button class="btn" data-cs="addextra">Add</button></div>'
      + '<datalist id="cs-mon-dl">' + names.map(n => '<option value="' + csE(n) + '">').join('') + '</datalist>';
  }
  return h;
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
  if (d.cs === 'print') return csPrint(pc);
  if (d.cs === 'portrait' && !CS.readOnly){
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.addEventListener('change', async ev => {
      const f = ev.target.files[0]; if (!f) return;
      try {
        const url = typeof showCropModal === 'function' ? await showCropModal(f, { size: 96, shape: 'circle', title: 'Crop the portrait' }) : await fileToIconDataUrl(f, 96);
        if (url) csEdit('New portrait', p => { p.icon = url; if (p.build) p.build.icon = url; });
      } catch(err){ if (typeof showToast === 'function') showToast('Upload failed: ' + err.message); }
    });
    inp.click(); return;
  }
  if (d.cs === 'export') return sktExportCharacter(pc);
  if (d.csTab){ CS.tab = d.csTab; return csRender(); }
  if (d.csMode){ CS.mode = d.csMode; return csRender(); }
  if (d.cs === 'log'){ CS.showLog = !CS.showLog; return csRender(); }
  if (d.cs === 'reroll' && !CS.readOnly && pc.inspiration){
    const last = CS.log[0]; if (!last || last.kind !== 'd20') return;
    csEdit('Spent Heroic Inspiration', p => { p.inspiration = false; });
    const r = csRollD20(last.label + ' (reroll)', last.mod - 0, null, last.kindTag || null);
    r.rerolled = true;
    return csRender();
  }
  if (d.csRoll) return csRollFor(pc, d.csRoll, e);
  if (d.csAtk != null){
    const a = (pc.sheet.attacks || [])[+d.csAtk]; if (!a) return;
    const r = csRollD20(a.name + ' attack', parseInt(a.atkBonus, 10) || 0, e, a.spell ? 'attack:spell' : 'attack');
    // A Champion crits on a 19 (or 18).
    if (!a.spell && r.natural >= ((pc.sheet || {}).critRange || 20) && !r.crit){ r.crit = true; r.why = [r.why, 'critical on ' + pc.sheet.critRange + '+'].filter(Boolean).join('; '); }
    csSpendAmmo(pc, a);
    CS.lastAtkCrit = { i: +d.csAtk, crit: r.crit };
    return csRender();
  }
  if (d.csXdmg){
    const [label, expr] = d.csXdmg.split('|');
    const crit = !!(CS.lastAtkCrit && CS.lastAtkCrit.crit);
    csRollDamage(label + (crit ? ' (crit)' : ''), expr, crit);
    return csRender();
  }
  if (d.cs === 'smite' && !CS.readOnly){
    const l = +((document.querySelector('#cs-root [data-cs-smitelvl]') || {}).value || 0); if (!l) return;
    const extra = (document.querySelector('#cs-root [data-cs-smiteundead]') || {}).checked ? 1 : 0;
    const ed = (pc.build && pc.build.edition) || pc.rules || '2024';
    const dice = Math.min(ed === '2014' ? 5 : 99, 1 + l) + extra;
    const crit = !!(CS.lastAtkCrit && CS.lastAtkCrit.crit);
    csEdit('Divine Smite', p => { const s = p.sheet.spellSlots[l]; if (s && s.total - (s.expended || 0) > 0) s.expended = (s.expended || 0) + 1; });
    csRollDamage('Divine Smite (' + CS_ORD[l] + ')', dice + 'd8 radiant', crit);
    return csRender();
  }
  if (d.csDmg2 != null){
    const a = (pc.sheet.attacks || [])[+d.csDmg2]; if (!a || !a.versatile) return;
    const crit = !!(CS.lastAtkCrit && CS.lastAtkCrit.i === +d.csDmg2 && CS.lastAtkCrit.crit);
    const type = (/[a-z]{3,}.*$/i.exec(a.damage || '') || [''])[0];
    csRollDamage(a.name + ' damage (two hands)', a.versatile + (type ? ' ' + type : ''), crit, csDamageOpts(pc, a, true)); CS.lastAtkCrit = null;
    return csRender();
  }
  if (d.csDmg != null){
    const a = (pc.sheet.attacks || [])[+d.csDmg]; if (!a) return;
    const crit = !!(CS.lastAtkCrit && CS.lastAtkCrit.i === +d.csDmg && CS.lastAtkCrit.crit);
    csRollDamage(a.name + ' damage', a.damage, crit, csDamageOpts(pc, a, false)); CS.lastAtkCrit = null;
    return csRender();
  }
  if (CS.readOnly) return;
  if (d.csHp){
    const n = Math.abs(parseInt((document.querySelector('#cs-root [data-cs-amt]') || {}).value, 10) || 0); if (!n) return;
    CS.amt = n;
    if (d.csHp === 'temp') return csEdit('Temp HP ' + n, p => { p.tempHp = Math.max(p.tempHp || 0, n); });
    const i = csIdx(), sign = +d.csHp, type = sign < 0 ? (CS.dtype || null) : null;
    // Hurt while concentrating: a CON save to keep it, DC 10 or half the damage.
    if (sign < 0 && pc.concentration) CS.conc = { dc: Math.max(10, Math.floor(n / 2)), spell: pc.concentration };
    const run = () => { panelDefs.party._applyHpDelta(i, sign * n, type); csCommit(); };
    if (typeof sktUndoable === 'function') return sktUndoable((sign < 0 ? 'Took ' : 'Healed ') + n, run);
    return run();
  }
  if (d.cs === 'insp') return csEdit(pc.inspiration ? 'Spent Heroic Inspiration' : 'Heroic Inspiration', p => { p.inspiration = !p.inspiration; });
  if (d.cs === 'dropconc'){ CS.conc = null; return csEdit('Dropped concentration', p => { p.concentration = null; }); }
  if (d.cs === 'concsave'){
    const c = CS.conc; if (!c) return;
    const sh = pc.sheet || {}, mod = (sh.saves && sh.saves.con != null ? sh.saves.con : csMod((pc.abilities || {}).con)) + (+sh.concBonus || 0);
    const r = csRollD20('Concentration (DC ' + c.dc + ')', mod, e, 'save:con');
    CS.conc = null;
    if (r.total < c.dc || r.autoFail){
      if (typeof showToast === 'function') showToast(pc.name + ' loses concentration on ' + c.spell);
      return csEdit('Lost concentration', p => { p.concentration = null; });
    }
    if (typeof showToast === 'function') showToast(pc.name + ' keeps concentrating on ' + c.spell);
    return csRender();
  }
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
    // Rage turns on what raging does (resistances, the damage bonus) via the
    // party card's own switch.
    const rage = /^Rage$/i.test(a.name) && !pc.rage;
    csEdit('Used ' + a.name, p => {
      const r = (p.resources || []).find(x => x.name === a.resource);
      if (r) r.current = Math.max(0, (r.current || 0) - (a.amount || 1));
    });
    if (rage && panelDefs.party && panelDefs.party._setRage){ panelDefs.party._setRage(csIdx(), true); csRender(); }
    return;
  }
  if (d.csState != null){
    if (CS.readOnly) return;
    const s = ((pc.sheet || {}).states || []).find(x => x.key === d.csState); if (!s) return;
    const P = panelDefs.party, i = csIdx();
    const res = !s.on && s.resource ? (pc.resources || []).find(x => x.name === s.resource) : null;
    if (res && (res.current || 0) <= 0){ if (typeof showToast === 'function') showToast('No ' + s.resource + ' left'); return; }
    const spend = p => { if (!res) return; const r = (p.resources || []).find(x => x.name === s.resource); if (r) r.current = Math.max(0, (r.current || 0) - 1); };
    // Rage is the party card's own switch (it ends concentration, and the
    // tracker counts its minute down).
    if (s.key === 'Rage'){
      if (!s.on) csEdit('Rage', spend);
      if (P && P._setRage) P._setRage(i, !s.on); else csEdit(s.on ? 'Rage ends' : 'Rage', p => { p.rage = !s.on; });
      return csRender();
    }
    return csEdit((s.on ? 'Ended ' : '') + s.label, p => {
      if (s.conc){
        if (s.on) p.concentration = null;
        else {
          if (p.concentration && p.concentration !== s.spell && typeof showToast === 'function') showToast('Concentration on ' + p.concentration + ' ends');
          p.concentration = s.spell;
        }
      } else {
        p.active = Object.assign({}, p.active);
        if (s.on) delete p.active[s.key]; else p.active[s.key] = true;
      }
      spend(p);
    });
  }
  if (d.cs === 'endrage'){ if (panelDefs.party && panelDefs.party._setRage) panelDefs.party._setRage(csIdx(), false); return csRender(); }
  if (d.cs === 'endwild') return csEdit('Wild Shape ends', p => { p.wildshape = null; });
  if (d.cs === 'short'){ CS.resting = { healed: 0, rolls: [] }; return csRender(); }
  if (d.cs === 'restdie'){
    const P = panelDefs.party, i = csIdx();
    const r = P && P._rollHitDie ? P._rollHitDie(i) : null;
    if (!r) return;
    CS.resting.healed += r.heal; CS.resting.rolls.push(r.roll + csSigned(r.conMod) + ' = ' + r.heal);
    const p = state.party[i]; p.hp = Math.min(p.hpMax || p.hp, (p.hp || 0));
    return csCommit();
  }
  if (d.cs === 'restdone'){
    const i = csIdx(); CS.resting = null;
    return csEdit(pc.name + ' took a short rest', () => panelDefs.party._shortRestOne(state.party[i], i));
  }
  if (d.cs === 'restcancel'){ CS.resting = null; return csRender(); }
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
  if (d.cs === 'addtrk'){
    const nm = ((document.querySelector('#cs-root [data-cs-trk]') || {}).value || '').trim(); if (!nm) return;
    const max = Math.max(1, Math.min(99, parseInt((document.querySelector('#cs-root [data-cs-trkmax]') || {}).value, 10) || 1));
    const rec = (document.querySelector('#cs-root [data-cs-trkrec]') || {}).value || 'long';
    return csRebuild('Added ' + nm, b => { b.customResources = (b.customResources || []).concat([{ name: nm, max, recharge: rec === 'short' ? 'short' : 'long' }]); });
  }
  if (d.cs === 'addact'){
    const nm = ((document.querySelector('#cs-root [data-cs-act]') || {}).value || '').trim(); if (!nm) return;
    const action = (document.querySelector('#cs-root [data-cs-acttype]') || {}).value || 'Action';
    const desc = ((document.querySelector('#cs-root [data-cs-actdesc]') || {}).value || '').trim();
    return csRebuild('Added ' + nm, b => { b.customActions = (b.customActions || []).concat([{ name: nm, action, desc }]); });
  }
  if (d.csDeltrk != null) return csRebuild('Removed a tracker', b => { b.customResources = (b.customResources || []).filter((x, i) => i !== +d.csDeltrk); });
  if (d.csDelact != null) return csRebuild('Removed an action', b => { b.customActions = (b.customActions || []).filter((x, i) => i !== +d.csDelact); });
  if (d.cs === 'notheme') return csEdit('Sheet colour', p => { delete p.theme; });
  if (d.cs === 'addsummon'){
    const sel = document.querySelector('#cs-root [data-cs-sumsel="' + CSS.escape(d.csSumfor || '') + '"]');
    const pc = csPc(), m = sel && pc && csCompanionMonster(pc, sel.value); if (!m) return true;
    const st = csCompanionStats(pc, m);
    return csEdit('Added ' + m.name, p => { p.extras = (p.extras || []).concat([{ name: m.name, hp: st.hp, hpMax: st.hp, ac: st.ac }]); });
  }
  if (d.csComp){
    const pc = csPc(), m = pc && csCompanionMonster(pc, d.csComp); if (!m || !pc) return true;
    const st = csCompanionStats(pc, m);
    return csEdit('Added ' + m.name, p => { p.extras = (p.extras || []).concat([{ name: m.name, hp: st.hp, hpMax: st.hp, ac: st.ac }]); });
  }
  if (d.cs === 'addextra'){
    const q = ((document.querySelector('#cs-root [data-cs-exq]') || {}).value || '').trim(); if (!q) return;
    const m = csMonster(q);
    const raw = (m && m._raw) || {};
    const hp = m ? (parseInt(m.hp, 10) || (raw.hp && raw.hp.average) || 0) : 0;
    const ac0 = Array.isArray(raw.ac) ? raw.ac[0] : null;
    const acv = m ? (parseInt(m.ac, 10) || (typeof ac0 === 'number' ? ac0 : ac0 && ac0.ac) || null) : null;
    return csEdit('Added ' + q, p => { p.extras = (p.extras || []).concat([{ name: m ? m.name : q, hp, hpMax: hp, ac: acv }]); });
  }
  if (d.csExhp){
    const [i, sg] = d.csExhp.split(':').map(Number);
    const n = Math.abs(parseInt((document.querySelector('#cs-root [data-cs-amt]') || {}).value, 10) || 1);
    return csEdit('Companion HP', p => { const x = p.extras[i]; if (x) x.hp = Math.max(0, Math.min(x.hpMax || 0, (x.hp || 0) + sg * n)); });
  }
  if (d.csExdel != null) return csEdit('Removed a companion', p => { p.extras = (p.extras || []).filter((x, i) => i !== +d.csExdel); });
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
// A bow uses an arrow, a crossbow a bolt, a sling a bullet, a blowgun a needle.
// What changes this weapon's damage roll for this character.
function csDamageOpts(pc, a, twoHands){
  const sh = pc.sheet || {}, props = a.props || [];
  const melee = !a.spell && !(props.includes('A')) && !/^Unarmed/.test(a.name);
  const ed = (pc.build && pc.build.edition) || pc.rules || '2024';
  return {
    extraDice: melee ? (sh.critExtraDice || 0) : 0,
    gwf: sh.greatWeaponFighting && melee && (props.includes('2H') || twoHands) ? ed : null,
  };
}
function csAmmoFor(a){
  const n = String(a.name || '').toLowerCase();
  return /crossbow/.test(n) ? /bolt/ : /bow/.test(n) ? /arrow/ : /sling/.test(n) ? /bullet/ : /blowgun/.test(n) ? /needle/ : null;
}
function csAmmoLeft(pc, a){
  const re = csAmmoFor(a); if (!re) return '';
  const n = csItems(pc).filter(x => re.test(String(x.name).toLowerCase())).reduce((t, x) => t + (x.qty || 1), 0);
  return n + ' ' + (re.source === 'arrow' ? 'arrows' : re.source + 's') + ' left';
}
function csSpendAmmo(pc, a){
  if (CS.readOnly || !(a.props || []).includes('A')) return;
  const re = csAmmoFor(a); if (!re) return;
  const items = csItems(pc), at = items.findIndex(x => re.test(String(x.name).toLowerCase()) && (x.qty || 1) > 0);
  if (at < 0){ if (typeof showToast === 'function') showToast('No ammunition for the ' + a.name + ' in the inventory'); return; }
  csItemsEdit('Used ammunition', l => { const x = l[at]; if (!x) return; x.qty = (x.qty || 1) - 1; if (x.qty <= 0) l.splice(at, 1); });
}
function csRollFor(pc, what, e){
  const sh = pc.sheet || {}, ab = pc.abilities || {}, pb = sh.profBonus || 2;
  const [kind, k] = what.split(':');
  if (kind === 'init'){
    const r = csRollD20('Initiative', pc.init ?? csMod(ab.dex), e, 'init');
    // In a fight: the combat card takes the roll.
    const ci = (typeof _findCombatantForPartyMember === 'function') ? _findCombatantForPartyMember(pc) : -1;
    if (ci >= 0 && !CS.readOnly){
      state.combatants[ci] = Object.assign({}, state.combatants[ci], { initiative: r.total });
      save(); try { panelDefs.combat && panelDefs.combat._render && panelDefs.combat._render(); } catch(_){}
      if (typeof showToast === 'function') showToast(pc.name + "'s initiative is " + r.total + ' on the Combat Tracker');
    }
  }
  else if (kind === 'ab') csRollD20(CS_AB[k] + ' check', csMod(ab[k]), e, 'abcheck:' + k);
  else if (kind === 'save') csRollD20(CS_AB[k] + ' save', sh.saves && sh.saves[k] != null ? sh.saves[k] : csMod(ab[k]) + ((sh.saveProf || []).includes(k) ? pb : 0), e, 'save:' + k);
  else if (kind === 'skill') csRollD20(CS_SKILLS[k][0], sh.skills && sh.skills[k] != null ? sh.skills[k] : csMod(ab[CS_SKILLS[k][1]]), e, 'check:' + k);
  csRender();
}
function csOnChange(e){
  if (!CS) return;
  const t = e.target, d = t.dataset, pc = csPc(); if (!pc) return;
  if ('csDtype' in d){ CS.dtype = t.value; return; }
  if ('csTheme' in d && !CS.readOnly) return csEdit('Sheet colour', p => { p.theme = t.value; });
  if (CS.readOnly) return;
  if ('csAddcond' in d){ if (t.value) csEdit('Condition', () => panelDefs.party._toggleCondition(csIdx(), t.value)); return; }
  if ('csStateopt' in d) return csEdit(d.csStateopt + ': ' + t.value, p => { p.active = Object.assign({}, p.active, { [d.csStateopt + ':opt']: t.value }); });
  if (typeof csSpellsChange === 'function' && csSpellsChange(e, t, d, pc)) return;
  if (typeof csInventoryChange === 'function' && csInventoryChange(e, t, d, pc)) return;
}
// Typing: saved as it goes, no redraw, so the box keeps the caret.
function csOnInput(e){
  if (!CS) return;
  const t = e.target, d = t.dataset, pc = csPc(); if (!pc) return;
  if (CS.readOnly && !('csSpq' in d)) return;
  if ('csNotes' in d){ pc.playerNotes = t.value; csSaveSoon(); return; }
  if (d.csDetail){
    pc.sheet = pc.sheet || {};
    pc.sheet.details = Object.assign({}, pc.sheet.details, { [d.csDetail]: t.value });
    if (pc.build) pc.build.details = Object.assign({}, pc.build.details, { [d.csDetail]: t.value });
    csSaveSoon(); return;
  }
  if ('csSpq' in d){
    CS.spQ = t.value; clearTimeout(CS._spT);
    CS._spT = setTimeout(() => { if (!CS) return; const at = t.selectionStart; csRender();
      const q = document.querySelector('#cs-root [data-cs-spq]'); if (q){ q.focus(); try { q.setSelectionRange(at, at); } catch(_){} } }, 200);
    return;
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
  // The character's own homebrew spells first.
  const pc0 = csPc();
  const own = pc0 && pc0.build && (pc0.build.customSpells || []).find(s => s.name === name);
  if (own) return { name: own.name, level: +own.level || 0, school: own.school || '', entries: [own.text || ''],
    time: [{ number: 1, unit: own.time || 'action' }], range: own.range ? { type: 'point', distance: { type: 'feet', amount: +own.range || 0 } } : {},
    duration: [own.concentration ? { type: 'timed', concentration: true, duration: { type: 'minute', amount: 1 } } : { type: 'instant' }],
    concentration: !!own.concentration, ritual: !!own.ritual, custom: true,
    // csSpellDamage reads {@damage …} from the text.
    entriesDamage: own.damage || '' };
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
// A spell's damage at a slot level: the first {@damage} in its text, plus
// the {@scaledamage} step for each level above its own.
function csSpellDamage(s, slot){
  if (!s) return '';
  if (s.custom) return s.entriesDamage || '';
  const m = /\{@damage ([^}|]+)/.exec(JSON.stringify(s.entries || []));
  if (!m) return '';
  let expr = m[1].trim();
  const sc = /\{@scaledamage [^|]+\|[^|]+\|([^}|]+)/.exec(JSON.stringify(s.higher || []));
  const up = Math.max(0, (slot || s.level) - s.level);
  if (sc && up){
    const st = /^(\d+)d(\d+)$/.exec(sc[1].trim()), bm = /^(\d+)d(\d+)(.*)$/.exec(expr);
    if (st && bm && st[2] === bm[2]) expr = (+bm[1] + up * +st[1]) + 'd' + bm[2] + bm[3];
    else if (st) expr += ' + ' + (up * +st[1]) + 'd' + st[2];
  }
  return expr;
}
// A healing spell's dice at a slot level: {@dice} where the text says hit
// points are regained, plus the {@scaledice} step above its level, plus the
// caster's spellcasting modifier when the text adds it.
function csSpellHeal(s, slot, mod){
  if (!s) return '';
  const txt = JSON.stringify(s.entries || []);
  if (!/regain/i.test(txt)) return '';
  const m = /\{@dice ([^}|]+)/.exec(txt); if (!m) return '';
  let expr = m[1].trim();
  const sc = /\{@scaledice [^|]+\|[^|]+\|([^}|]+)/.exec(JSON.stringify(s.higher || []));
  const up = Math.max(0, (slot || s.level) - s.level);
  if (sc && up){
    const st = /^(\d+)d(\d+)$/.exec(sc[1].trim()), bm = /^(\d+)d(\d+)(.*)$/.exec(expr);
    if (st && bm && st[2] === bm[2]) expr = (+bm[1] + up * +st[1]) + 'd' + bm[2] + bm[3];
  }
  if (/spellcasting ability modifier/i.test(txt) && mod) expr += (mod >= 0 ? '+' : '') + mod;
  return expr;
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
  // How many are prepared against how many may be (a builder character).
  if (pc.build && CS.R && typeof sktBuildSpellcasting === 'function'){
    const sc = sktBuildSpellcasting(pc.build, CS.R, sktBuildAbilities(pc.build, CS.R));
    (sc && (sc.classes || [{ primary: true, sc, cls: pc.build.cls }]) || []).forEach(x => {
      const lst = x.primary ? pc.build : (x.entry || {}), want = x.sc.prepared || x.sc.known;
      if (!want) return;
      const have = (lst.spells || []).length;
      h += '<div class="cs-prepcount' + (have < want ? ' short' : '') + '">' + csE(_csTitle(x.cls)) + ': ' + (x.sc.prepared ? 'prepared' : 'known') + ' <b>' + have + ' / ' + want + '</b>'
        + (have < want && !CS.readOnly ? ' — <button class="cs-linkbtn" data-cs="manage">choose ' + (want - have) + ' more</button>' : '') + '</div>';
    });
  }
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
  const arcLv = {}; Object.keys(sh.arcanum || {}).forEach(lv => { arcLv[sh.arcanum[lv]] = lv; from[sh.arcanum[lv]] = 'Mystic Arcanum'; });
  const all = [...new Set(sh.spells || [])];
  // A wizard casts the rituals in the spellbook without preparing them: they
  // are listed with only the ritual to cast.
  const ritualOnly = new Set();
  (sh.spellbook || []).forEach(n => { const s = csSpell(n); if (s && s.ritual && !all.includes(n)){ all.push(n); ritualOnly.add(n); from[n] = 'Spellbook · ritual only'; } });
  if (!all.length) h += '<div class="cb-dim">No spells.</div>';
  // D&D Beyond's level pills and search.
  const lvSet = [...new Set(all.map(n => { const s = csSpell(n); return s ? +s.level || 0 : 0; }))].sort((a, b) => a - b);
  if (all.length > 4) h += '<div class="cs-spfilter"><span class="cb-seg">' + ['all'].concat(lvSet).map(v => '<button class="' + (String(CS.spLv ?? 'all') === String(v) ? 'on' : '') + '" data-cs-splv="' + v + '">' + (v === 'all' ? 'All' : v === 0 ? 'Cantrips' : CS_ORD[v].replace(' level', '')) + '</button>').join('') + '</span>'
    + '<input data-cs-spq placeholder="Search…" value="' + csE(CS.spQ || '') + '"></div>';
  const names = all.filter(n => { const s = csSpell(n), l = s ? +s.level || 0 : 0;
    return (CS.spLv == null || CS.spLv === 'all' || +CS.spLv === l) && (!CS.spQ || n.toLowerCase().includes(CS.spQ.toLowerCase())); });
  const by = {};
  names.forEach(n => { const s = csSpell(n); const l = s ? +s.level || 0 : 0; (by[l] = by[l] || []).push({ n, s }); });
  Object.keys(by).map(Number).sort((a, b) => a - b).forEach(l => {
    h += '<h4>' + CS_ORD[l] + '</h4>' + by[l].sort((a, b) => a.n.localeCompare(b.n)).map(({ n, s }) => {
      const open = CS.open['sp:' + n];
      const tags = (s && s.concentration ? '<i class="cs-tag" title="Concentration">C</i>' : '') + (s && s.ritual ? '<i class="cs-tag" title="Ritual">R</i>' : '');
      const avail = l ? lvls.filter(x => x >= l && (slots[x].total - (slots[x].expended || 0)) > 0) : [];
      const cast = ro ? '' : ritualOnly.has(n) ? '<button class="btn small" data-cs-cast="' + csE(n) + ':ritual" title="As a ritual: 10 minutes longer, no slot">Ritual</button>'
        : l === 0 ? '<button class="btn small" data-cs-cast="' + csE(n) + ':0">Cast</button>'
        : (avail.length ? (avail.length > 1 ? '<select class="cb-sel cs-castlvl" data-cs-castlvl="' + csE(n) + '">' + avail.map(x => '<option value="' + x + '">' + CS_ORD[x] + '</option>').join('') + '</select>' : '')
          + '<button class="btn small" data-cs-cast="' + csE(n) + ':' + avail[0] + '">Cast</button>' : '<span class="cb-dim">no slots</span>')
          + (daily.has(n) ? '<button class="btn small" data-cs-cast="' + csE(n) + ':free" title="Once per long rest without a slot">Free</button>' : '')
          + (arcLv[n] ? '<button class="btn small" data-cs-cast="' + csE(n) + ':arcanum"' + (((pc.resources || []).find(r => r.name === 'Mystic Arcanum (' + arcLv[n] + 'th)') || {}).current > 0 ? '' : ' disabled') + ' title="Mystic Arcanum: once per long rest">Arcanum</button>' : '')
          + (s && s.ritual ? '<button class="btn small" data-cs-cast="' + csE(n) + ':ritual" title="As a ritual: 10 minutes longer, no slot">Ritual</button>' : '');
      const sv = s && (s.savingThrow || [])[0] ? String(s.savingThrow[0]).slice(0, 3).toUpperCase() + ' save DC ' + (sh.spellSaveDc || '?') : '';
      const atk = l && s && (s.spellAttack || []).length ? '<button class="btn small" data-cs-spatk="1">Attack ' + csE(sh.spellAtkBonus || '') + '</button>' : '';
      const dmg = l && csSpellDamage(s, l) ? '<button class="btn small" data-cs-spdmg="' + csE(n) + '" title="At the slot level chosen beside Cast">' + csE(csSpellDamage(s, avail[0] || l)) + '</button>' : '';
      const cantripAtk = !l ? (sh.attacks || []).find(a => a.name === n) : null;
      const scMod = (parseInt(sh.spellAtkBonus, 10) || 0) - (sh.profBonus || 0);
      const heal = l && csSpellHeal(s, avail[0] || l, scMod) ? '<button class="btn small cs-heal" data-cs-spheal="' + csE(n) + '">Heal ' + csE(csSpellHeal(s, avail[0] || l, scMod)) + '</button>' : '';
      const info = [sv ? '<span class="cs-save">' + csE(sv) + '</span>' : '', atk, dmg, heal,
                    cantripAtk ? '<button class="btn small" data-cs-dmg="' + (sh.attacks || []).indexOf(cantripAtk) + '">' + csE(cantripAtk.damage) + '</button>' : ''].join('');
      return '<div class="cs-spell"><button class="cs-spell-n" data-cs-open="sp:' + csE(n) + '"><b>' + csE(n) + '</b>' + tags
        + '<span class="cb-dim">' + csE(csSpellMeta(s)) + '</span>' + (from[n] ? '<span class="cs-from">' + csE(from[n]) + '</span>' : '') + '</button>'
        + '<span class="cs-spell-c">' + info + cast + '</span>'
        + (open ? '<div class="cs-feat-t">' + (s ? csE(typeof sktRulesText === 'function' ? sktRulesText(s.entries) : '').replace(/\n/g, '<br>') : 'Loading the rules…') + '</div>' : '') + '</div>';
    }).join('');
  });
  if (!ro) h += csSlotToolsHtml(pc, lvls, slots);
  if (!ro && pc.build) h += csManageSpellsHtml(pc) + csCustomSpellHtml(pc);
  return h;
}
function csCustomSpellHtml(pc){
  const own = pc.build.customSpells || [];
  return '<details class="cs-addcustom"><summary>+ A homebrew spell</summary>'
    + '<div class="cs-add"><input data-cs-csn placeholder="Name" maxlength="40"><select class="cb-sel" data-cs-csl aria-label="Level">' + CS_ORD.map((l, i) => '<option value="' + i + '">' + l + '</option>').join('') + '</select>'
    + '<input data-cs-csd placeholder="Damage, e.g. 3d8 fire" maxlength="30"><label class="cb-inline"><input type="checkbox" data-cs-csc> Concentration</label><label class="cb-inline"><input type="checkbox" data-cs-csr> Ritual</label></div>'
    + '<textarea data-cs-cst rows="2" maxlength="2000" placeholder="What it does"></textarea><button class="btn" data-cs="addspell">Add spell</button>'
    + (own.length ? '<div class="cb-dim">Yours: ' + own.map((s, i) => csE(s.name) + ' <button class="cs-linkbtn" data-cs-delspell="' + i + '">remove</button>').join(' · ') + '</div>' : '')
    + '</details>';
}
// Features that move spell slots: recovering them on a short rest (a
// wizard's Arcane Recovery, a land druid's Natural Recovery) and a
// sorcerer's Font of Magic.
const CS_FONT_COST = { 1: 2, 2: 3, 3: 5, 4: 6, 5: 7 };
function csClassLevel(pc, key){
  const cl = ((pc.sheet || {}).classLevels || []).find(p => p.cls === key);
  return cl ? cl.level : (String(pc.cls || '').toLowerCase() === key ? (pc.level || 1) : 0);
}
function csRecoveryBudget(pc){
  const r = (pc.resources || []).find(x => /^(Arcane|Natural) Recovery$/.test(x.name) && (x.current || 0) > 0);
  if (!r) return null;
  const lvl = csClassLevel(pc, /Arcane/.test(r.name) ? 'wizard' : 'druid') || pc.level || 1;
  return { res: r, budget: Math.ceil(lvl / 2) };
}
function csSlotToolsHtml(pc, lvls, slots){
  let h = '';
  const rec = csRecoveryBudget(pc);
  const spent = lvls.filter(l => l < 6 && (slots[l].expended || 0) > 0);
  if (rec && spent.length) h += '<div class="cs-slottool"><b>' + csE(rec.res.name) + '</b> <span class="cb-dim">get back slots worth up to ' + rec.budget + ' levels (none 6th or higher), once a day after a short rest</span>'
    + '<button class="btn small" data-cs="recover">Recover slots</button></div>';
  const sp = (pc.resources || []).find(x => x.name === 'Sorcery Points');
  if (sp){
    const toPts = lvls.filter(l => (slots[l].total - (slots[l].expended || 0)) > 0);
    const toSlot = Object.keys(CS_FONT_COST).map(Number).filter(l => slots[l] && (slots[l].expended || 0) > 0 && (sp.current || 0) >= CS_FONT_COST[l]);
    h += '<div class="cs-slottool"><b>Font of Magic</b> <span class="cb-dim">' + (sp.current || 0) + ' sorcery points</span>'
      + (toPts.length ? '<select class="cb-sel" data-cs-fontslot>' + toPts.map(l => '<option value="' + l + '">' + CS_ORD[l] + ' slot → ' + l + ' points</option>').join('') + '</select><button class="btn small" data-cs="font2pts">Convert</button>' : '')
      + (toSlot.length ? '<select class="cb-sel" data-cs-fontpts>' + toSlot.map(l => '<option value="' + l + '">' + CS_FONT_COST[l] + ' points → ' + CS_ORD[l] + ' slot</option>').join('') + '</select><button class="btn small" data-cs="font2slot">Create</button>' : '')
      + '</div>';
  }
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
  if (d.csOpen){ CS.open[d.csOpen] = !CS.open[d.csOpen]; csRender(); return true; }   // spells, items and extras
  if (d.csSplv != null){ CS.spLv = d.csSplv; csRender(); return true; }
  if (d.csActf){ CS.actF = d.csActf; csRender(); return true; }
  if (d.csSpatk){ csRollD20('Spell attack', parseInt((pc.sheet || {}).spellAtkBonus, 10) || 0, e, 'attack:spell'); csRender(); return true; }
  if (d.csSpdmg){
    const s = csSpell(d.csSpdmg); if (!s) return true;
    const sel = document.querySelector('#cs-root [data-cs-castlvl="' + CSS.escape(d.csSpdmg) + '"]');
    const lvl = sel ? +sel.value : s.level;
    csRollDamage(s.name + (lvl > s.level ? ' (level ' + lvl + ')' : ''), csSpellDamage(s, lvl), false);
    csRender(); return true;
  }
  if (d.csSpheal){
    const s = csSpell(d.csSpheal); if (!s) return true;
    const sh = pc.sheet || {}, scMod = (parseInt(sh.spellAtkBonus, 10) || 0) - (sh.profBonus || 0);
    const sel = document.querySelector('#cs-root [data-cs-castlvl="' + CSS.escape(d.csSpheal) + '"]');
    const lvl = sel ? +sel.value : s.level;
    const r = Object.assign({ kind: 'dmg', label: s.name + ' heals' }, sktDamageRoll(csSpellHeal(s, lvl, scMod), false));
    r.type = 'hit points'; csLog(r); csRender(); return true;
  }
  if (CS.readOnly) return false;
  if (d.cs === 'recover'){
    const rec = csRecoveryBudget(pc); if (!rec) return true;
    csEdit(rec.res.name, p => {
      let left = rec.budget;
      // Highest slots first: the most a day's recovery can give back.
      Object.keys(p.sheet.spellSlots).map(Number).filter(l => l < 6).sort((a, b) => b - a).forEach(l => {
        const s = p.sheet.spellSlots[l];
        while ((s.expended || 0) > 0 && left >= l){ s.expended -= 1; left -= l; }
      });
      const r = p.resources.find(x => x.name === rec.res.name); if (r) r.current = Math.max(0, (r.current || 0) - 1);
    });
    return true;
  }
  if (d.cs === 'font2pts' || d.cs === 'font2slot'){
    const to = d.cs === 'font2pts';
    const l = +((document.querySelector('#cs-root [data-cs-' + (to ? 'fontslot' : 'fontpts') + ']') || {}).value || 0); if (!l) return true;
    csEdit(to ? 'Slot into sorcery points' : 'Sorcery points into a slot', p => {
      const sp = p.resources.find(x => x.name === 'Sorcery Points'), s = p.sheet.spellSlots[l]; if (!sp || !s) return;
      if (to){ if (s.total - (s.expended || 0) <= 0) return; s.expended = (s.expended || 0) + 1; sp.current = Math.min(sp.max || 99, (sp.current || 0) + l); }
      else { if ((s.expended || 0) <= 0 || (sp.current || 0) < CS_FONT_COST[l]) return; s.expended -= 1; sp.current -= CS_FONT_COST[l]; }
    });
    return true;
  }
  if (d.cs === 'manage'){ CS.manage = !CS.manage; csRender(); return true; }
  if (d.cs === 'addspell'){
    const v = s => (document.querySelector('#cs-root [data-cs-' + s + ']') || {});
    const name = (v('csn').value || '').trim(); if (!name) return true;
    const sp = { name, level: +v('csl').value || 0, damage: (v('csd').value || '').trim(), concentration: !!v('csc').checked, ritual: !!v('csr').checked, text: (v('cst').value || '').trim() };
    csRebuild('Added ' + name, b => { b.customSpells = (b.customSpells || []).filter(x => x.name !== name).concat([sp]); });
    return true;
  }
  if (d.csDelspell != null){ csRebuild('Removed a spell', b => { b.customSpells = (b.customSpells || []).filter((x, i) => i !== +d.csDelspell); }); return true; }
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
      if (how === 'arcanum'){
        const lv = Object.keys(p.sheet.arcanum || {}).find(k => p.sheet.arcanum[k] === name);
        const r = (p.resources || []).find(x => x.name === 'Mystic Arcanum (' + lv + 'th)');
        if (!r || r.current <= 0) return;
        r.current -= 1;
      }
      if (s && s.concentration){
        if (p.concentration && p.concentration !== name && typeof showToast === 'function') showToast('Concentration on ' + p.concentration + ' ends');
        p.concentration = name;
      }
      const tg = ((p.sheet || {}).states || []).find(x => x.spell === name && !x.conc);
      if (tg) p.active = Object.assign({}, p.active, { [tg.key]: true });
    });
    if (typeof showToast === 'function') showToast('Cast ' + name + (/^\d+$/.test(how) && +how > 0 ? ' (' + CS_ORD[+how] + ' slot)' : how === 'ritual' ? ' as a ritual' : how === 'free' ? ' (free use)' : how === 'arcanum' ? ' (Mystic Arcanum)' : ''));
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
  const pref = (pc.build && pc.build.overrides) || {};
  const lb = items.reduce((n, m) => n + csItemWeight(items, m), 0) + (pref.coinWeight === false ? 0 : CS_COINS.reduce((n, [k]) => n + (+coins[k] || 0), 0) / 50);
  const boxes = items.filter(x => CS_CONTAINER.test(x.name));
  const str = (pc.abilities || {}).str || 10, size = ((pc.sheet || {}).size || 'Medium');
  const cap = str * 15 * (size === 'Tiny' ? 0.5 : size === 'Large' ? 2 : 1);
  const attuned = items.filter(m => m.reqAttune && m.attuned).length, attMax = (pc.sheet || {}).attuneMax || 3;
  let h = '<div class="cs-coins">' + CS_COINS.map(([k]) => '<label class="cs-coin"><span>' + k.toUpperCase() + '</span>'
    + (ro ? '<b>' + (coins[k] || 0) + '</b>' : '<input type="number" min="0" data-cs-coin="' + k + '" value="' + (coins[k] || 0) + '">') + '</label>').join('')
    + '<span class="cb-dim">Worth ' + Math.round(CS_COINS.reduce((n, [k, v]) => n + (+coins[k] || 0) * v, 0) * 100) / 100 + ' gp</span></div>'
    + (ro ? '' : '<div class="cs-add cs-cointx"><input type="number" min="0" data-cs-txn placeholder="Amount" aria-label="Amount"><select class="cb-sel" data-cs-txc aria-label="Coin">'
      + CS_COINS.map(([k]) => '<option value="' + k + '"' + (k === 'gp' ? ' selected' : '') + '>' + k + '</option>').join('') + '</select>'
      + '<button class="btn" data-cs="coinadd">Add</button><button class="btn" data-cs="coinspend">Spend</button></div>');
  h += '<div class="cs-carry' + (csCarryNote(pref.encumbrance, lb, cap) ? ' over' : '') + '">Carrying <b>' + Math.round(lb * 10) / 10 + ' lb</b>'
    + (pref.encumbrance === 'none' ? '' : ' of ' + cap + ' lb') + csCarryNote(pref.encumbrance, lb, cap)
    + (items.some(m => m.reqAttune) ? ' · attuned ' + attuned + ' of ' + attMax : '') + '</div>';
  const gearType = m => { const st = m.stats || (m.base && CS.R && CS.R.items[m.base]); return st && /^(M|R|LA|MA|HA|S)(\||$)/.test(String(st.type)); };
  h += '<div class="cs-inv">' + (items.length ? items.map((m, i) => '<div class="cs-item' + (m.equipped === false ? ' off' : '') + '">'
    + (gearType(m) ? '<label class="cs-eq" title="Equipped"><input type="checkbox" data-cs-equip="' + i + '"' + (m.equipped !== false ? ' checked' : '') + (ro ? ' disabled' : '') + '></label>' : '<span class="cs-eq"></span>')
    + '<button class="cs-itemn" data-cs-open="it:' + i + '"><b>' + csE(m.name) + '</b></button>'
    + (m.reqAttune ? '<label class="cs-att"><input type="checkbox" data-cs-attune="' + i + '"' + (m.attuned ? ' checked' : '') + (ro || (!m.attuned && attuned >= 3) ? ' disabled' : '') + '> attuned</label>' : '')
    + '<span class="cs-qty">' + (ro ? '' : '<button class="btn small" data-cs-qty="' + i + ':-1" aria-label="One fewer">−</button>') + '×' + (m.qty || 1)
    + (ro ? '' : '<button class="btn small" data-cs-qty="' + i + ':1" aria-label="One more">+</button>') + '</span>'
    + (boxes.length && !CS_CONTAINER.test(m.name) && !ro ? '<select class="cb-sel cs-in" data-cs-in="' + i + '" aria-label="Carried in"><option value="">carried</option>'
      + boxes.map(x => '<option' + (m.in === x.name ? ' selected' : '') + '>' + csE(x.name) + '</option>').join('') + '</select>' : (m.in ? '<span class="cb-dim">in ' + csE(m.in) + '</span>' : ''))
    + '<span class="cb-dim cs-wt">' + (m.weight ? (csItemWeight(items, m) ? Math.round(csItemWeight(items, m) * 10) / 10 + ' lb' : 'weightless') : '') + '</span>'
    + (!ro && !m.charges && csCatalogCharges(m) ? '<button class="btn small" data-cs-trackchg="' + i + '" title="Count this item\u2019s charges">Track charges</button>' : '')
    + (ro ? '' : '<button class="btn small" data-cs-del="' + i + '" aria-label="Remove ' + csE(m.name) + '">✕</button>') + '</div>'
    + (CS.open['it:' + i] ? '<div class="cs-feat-t cs-itemt">' + csItemText(m) + '</div>' : '')).join('')
    : '<div class="cb-dim">Nothing carried.</div>') + '</div>';
  if (!ro){
    const e = csGearFind(CS.q);
    const bases = e && e.kind === 'variant' && typeof sktMagicBases === 'function' ? sktMagicBases(CS.R, e) : null;
    h += '<h5>Add an item</h5><div class="cs-add"><input data-cs-q list="cs-gear-dl" placeholder="' + (CS.gear ? 'Search gear and magic items…' : 'Loading the item list…') + '" value="' + csE(CS.q || '') + '">'
      + (bases ? '<select class="cb-sel" data-cs-qbase><option value="">Which one?</option>' + bases.map(k => '<option value="' + csE(k) + '"' + (CS.qBase === k ? ' selected' : '') + '>' + csE(CS.R.items[k].name) + '</option>').join('') + '</select>' : '')
      + '<button class="btn" data-cs="additem"' + (e && (!bases || (CS.qBase && bases.includes(CS.qBase))) ? '' : ' disabled') + '>Add</button>'
      + (csPrice(e) ? '<button class="btn primary" data-cs="buyitem">Buy (' + sktCoinText(csPrice(e)) + ')</button>' : '') + '</div>'
      + '<datalist id="cs-gear-dl">' + csGearEntries().map(x => '<option value="' + csE(x.name) + '">' + csE(x.rarity && x.rarity !== 'none' ? x.rarity : '') + '</option>').join('') + '</datalist>'
      + '<div class="cs-add"><input data-cs-custom placeholder="Or a custom item…" maxlength="60"><input type="number" min="0" step="0.1" data-cs-customwt placeholder="lb" aria-label="Weight">'
      + '<select class="cb-sel" data-cs-customkind aria-label="Kind"><option value="">Gear</option><option value="simple">Simple weapon</option><option value="martial">Martial weapon</option><option value="LA">Light armour</option><option value="MA">Medium armour</option><option value="HA">Heavy armour</option><option value="S">Shield</option></select>'
      + '<input data-cs-customstat placeholder="1d8 slashing / AC 14" maxlength="30" aria-label="Damage or armour class">'
      + '<input type="number" min="0" max="3" data-cs-custombonus placeholder="+0" aria-label="Magic bonus">'
      + '<button class="btn" data-cs="addcustom">Add</button></div>';
  }
  return h;
}
function csGearEntries(){ return [].concat(CS.magic || [], CS.gear || []); }
// An item's description: from the item data where it has one, else what
// the sheet knows (its weapon or armour numbers, its bonuses).
function csItemText(m){
  const n = String(m.name || '').toLowerCase();
  const named = (CS.magic || []).find(x => x.name.toLowerCase() === n && x.text);
  const bi = m.base && CS.R && CS.R.items[m.base];
  const st = m.stats || bi;
  const facts = [];
  if (m.rarity) facts.push(m.rarity + (m.reqAttune ? ', requires attunement' : ''));
  if (st && st.dmg1) facts.push(st.dmg1 + (st.dmgType ? ' ' + ({ A: 'acid', B: 'bludgeoning', C: 'cold', F: 'fire', O: 'force', L: 'lightning', N: 'necrotic', P: 'piercing', I: 'poison', Y: 'psychic', R: 'radiant', S: 'slashing', T: 'thunder' }[st.dmgType] || '') : ''));
  if (st && st.ac) facts.push('AC ' + st.ac);
  ['bonusWeapon', 'bonusAc', 'bonusSavingThrow', 'bonusSpellAttack', 'bonusSpellSaveDc'].forEach(k => { if (m[k]) facts.push({ bonusWeapon: 'weapon', bonusAc: 'AC', bonusSavingThrow: 'saving throws', bonusSpellAttack: 'spell attack', bonusSpellSaveDc: 'spell save DC' }[k] + ' +' + m[k]); });
  if (m.weight) facts.push(m.weight + ' lb each');
  const text = named ? named.text : bi && bi.entries ? (typeof sktRulesText === 'function' ? sktRulesText(bi.entries) : '') : '';
  return '<div class="cb-dim">' + csE(facts.join(' · ')) + '</div>' + (text ? csE(text).replace(/\n/g, '<br>') : (m.custom ? '<i>Your own item.</i>' : ''));
}
// Containers, and the magic ones whose contents weigh nothing.
const CS_CONTAINER = /backpack|\bbag\b|bag of|pouch|sack|chest|haversack|portable hole|quiver|case|basket|barrel/i;
// What the load does to the character under the chosen encumbrance rule.
// cap is 15 x Strength (size-adjusted); the variant's steps are a third and
// two thirds of it.
function csCarryNote(rule, lb, cap){
  if (rule === 'none') return '';
  if (rule === 'variant'){
    if (lb > cap) return ' — over the limit: speed drops to 5 ft';
    if (lb > cap * 2 / 3) return ' — heavily encumbered: speed −20 ft, disadvantage on STR, DEX and CON checks, saves and attacks';
    if (lb > cap / 3) return ' — encumbered: speed −10 ft';
    return '';
  }
  return lb > cap ? ' — over the limit: speed drops to 5 ft' : '';
}
const CS_WEIGHTLESS = /bag of holding|portable hole|handy haversack|heward/i;
function csItemWeight(items, m){
  const box = m.in && items.find(x => x.name === m.in);
  return box && CS_WEIGHTLESS.test(box.name) ? 0 : (+m.weight || 0) * (m.qty || 1);
}
function csPrice(e){
  if (!e) return 0;
  if (e.kind === 'variant'){ const bi = CS.qBase && CS.R.items[CS.qBase]; return bi && e.value ? e.value + (bi.value || 0) : 0; }
  return e.value || 0;
}
// Pay a price in copper from the purse, smallest coins first, with change.
function csPay(p, cp){
  const VAL = [['cp', 1], ['sp', 10], ['ep', 50], ['gp', 100], ['pp', 1000]];
  const purse = csCoins(p);
  const total = VAL.reduce((n, [k, v]) => n + (+purse[k] || 0) * v, 0);
  if (total < cp) return false;
  let owe = cp;
  for (const [k, v] of VAL){
    if (owe <= 0) break;
    const use = Math.min(+purse[k] || 0, Math.ceil(owe / v));
    purse[k] -= use; owe -= use * v;
  }
  // Overpaid with a big coin: the change in gold, silver and copper.
  let change = -owe;
  purse.gp += Math.floor(change / 100); change %= 100;
  purse.sp += Math.floor(change / 10); purse.cp += change % 10;
  p.gold = purse.gp; p.coins = { pp: purse.pp, ep: purse.ep, sp: purse.sp, cp: purse.cp };
  return true;
}
function csGearFind(name){
  const n = String(name || '').trim().toLowerCase();
  return n ? csGearEntries().find(e => e.name.toLowerCase() === n) || null : null;
}
// Change the list: for a built character, materialize the kit first.
// A magic item's charges from the catalogue, for one added before they were
// recorded (a wand from an older save).
function csCatalogCharges(m){
  const e = (CS.magic || []).find(x => x.name === m.name && x.charges);
  return e ? { charges: e.charges, recharge: e.recharge, rechargeAmount: e.rechargeAmount } : null;
}
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
  if (d.csTrackchg != null){
    const i = +d.csTrackchg, it = csItems(pc)[i], c = it && csCatalogCharges(it);
    if (c) csItemsEdit('Charges for ' + it.name, items => { if (items[i]) Object.assign(items[i], c); });
    return true;
  }
  if (d.csQty){ const [i, n] = d.csQty.split(':').map(Number); csItemsEdit('Quantity', l => { if (l[i]) l[i].qty = Math.max(1, (l[i].qty || 1) + n); }); return true; }
  if (d.csDel != null){ csItemsEdit('Removed an item', l => { l.splice(+d.csDel, 1); }); return true; }
  if (d.cs === 'additem' || d.cs === 'buyitem'){
    const g = csGearFind(CS.q); if (!g) return true;
    const price = d.cs === 'buyitem' ? csPrice(g) : 0;
    if (price){
      const purse = csCoins(pc), have = purse.cp + purse.sp * 10 + purse.ep * 50 + purse.gp * 100 + purse.pp * 1000;
      if (have < price){ if (typeof showToast === 'function') showToast('Not enough money for ' + g.name); return true; }
    }
    let it;
    if (g.kind === 'item' || g.kind === 'variant') it = sktMagicMake(CS.R, g, CS.qBase);
    else it = { name: g.name, base: g.base || undefined, weight: g.weight || 0 };
    // A bundle ("Arrows (20)") is twenty of a thing, not one.
    const bundle = !it.base && /^(.*?)\s*\((\d+)\)$/.exec(it.name);
    if (bundle){ it.name = bundle[1]; it.qty = +bundle[2]; it.weight = (+it.weight || 0) / +bundle[2]; }
    if (!it) return true;
    if (it.weight == null){ const bi = it.base && CS.R.items[it.base]; it.weight = (g.weight != null ? g.weight : bi && bi.weight) || 0; }
    it.qty = it.qty || 1;
    CS.q = ''; CS.qBase = '';
    csItemsEdit((price ? 'Bought ' : 'Added ') + it.name, l => { l.push(it); });
    if (price){ const p = csPc(); if (p && csPay(p, price)) csCommit(); }
    return true;
  }
  if (d.cs === 'coinadd' || d.cs === 'coinspend'){
    const n = Math.max(0, parseInt((document.querySelector('#cs-root [data-cs-txn]') || {}).value, 10) || 0);
    const c = (document.querySelector('#cs-root [data-cs-txc]') || {}).value || 'gp';
    if (!n) return true;
    const cp = n * { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 }[c];
    if (d.cs === 'coinspend'){
      const purse = csCoins(pc), have = purse.cp + purse.sp * 10 + purse.ep * 50 + purse.gp * 100 + purse.pp * 1000;
      if (have < cp){ if (typeof showToast === 'function') showToast('Not that much money'); return true; }
      csEdit('Spent ' + n + ' ' + c, p => { csPay(p, cp); });
    } else csEdit('Gained ' + n + ' ' + c, p => { if (c === 'gp') p.gold = (+p.gold || 0) + n; else p.coins = Object.assign({}, p.coins, { [c]: (+(p.coins || {})[c] || 0) + n }); });
    return true;
  }
  if (d.cs === 'addcustom'){
    const nm = (document.querySelector('#cs-root [data-cs-custom]') || {}).value || '';
    const wt = parseFloat((document.querySelector('#cs-root [data-cs-customwt]') || {}).value) || 0;
    if (!nm.trim()) return true;
    const kind = (document.querySelector('#cs-root [data-cs-customkind]') || {}).value || '';
    const stat = ((document.querySelector('#cs-root [data-cs-customstat]') || {}).value || '').trim();
    const bonus = Math.max(0, Math.min(3, parseInt((document.querySelector('#cs-root [data-cs-custombonus]') || {}).value, 10) || 0));
    const it = { name: nm.trim(), qty: 1, weight: wt, custom: true };
    // A homebrew weapon or armour the sheet fights with and wears.
    const DT = { acid: 'A', bludgeoning: 'B', cold: 'C', fire: 'F', force: 'O', lightning: 'L', necrotic: 'N', piercing: 'P', poison: 'I', psychic: 'Y', radiant: 'R', slashing: 'S', thunder: 'T' };
    if (kind === 'simple' || kind === 'martial'){
      const m = /(\d*d\d+)\s*([a-z]+)?/i.exec(stat) || [];
      it.stats = { name: it.name, type: 'M', weaponCategory: kind, dmg1: m[1] || '1d6', dmgType: DT[String(m[2] || 'bludgeoning').toLowerCase()] || 'B', property: [] };
      if (bonus) it.bonusWeapon = bonus;
      it.equipped = true;
    } else if (kind){
      const ac = parseInt((/\d+/.exec(stat) || [])[0], 10) || (kind === 'S' ? 2 : 11);
      it.stats = { name: it.name, type: kind, ac };
      if (bonus) it.bonusAc = bonus;
      it.equipped = true;
    }
    csItemsEdit('Added ' + nm.trim(), l => { l.push(it); });
    return true;
  }
  return false;
}
function csInventoryChange(e, t, d, pc){
  if (d.csIn != null){ const i = +d.csIn, v = t.value; csItemsEdit(v ? 'Put in ' + v : 'Took out', l => { if (l[i]) { if (v) l[i].in = v; else delete l[i].in; } }); return true; }
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
const CS_OV_LISTS = [['languages', 'Languages'], ['tools', 'Tool proficiencies'], ['weapons', 'Weapon proficiencies'], ['armor', 'Armour training'],
                     ['resist', 'Resistances'], ['immune', 'Immunities'], ['vulnerable', 'Vulnerabilities'], ['senses', 'Senses (e.g. Darkvision 60 ft.)']];
const CS_OV = [['ac', 'Armor Class'], ['init', 'Initiative'], ['speed', 'Speed (ft)'], ['hpMax', 'Hit point maximum'], ['saveAll', 'All saving throws'],
               ['spellAttack', 'Spell attack'], ['spellDc', 'Spell save DC'], ['passive', 'Passive Perception']];
function csCustomizeOpen(){ CS.customize = !CS.customize; csRender(); }
function csCustomizeHtml(pc){
  const o = (pc.build && pc.build.overrides) || {};
  const num = (k, v) => '<input type="number" step="1" data-cs-ov="' + k + '" value="' + (v || 0) + '">';
  return '<div class="cs-custom"><h4>Customize <button class="btn small" data-cs="customize">Done</button></h4>'
    + '<div class="cb-dim">Added on top of what the rules work out. Use negative numbers to take away.</div>'
    + '<label class="cs-kv"><span>Sheet colour</span><input type="color" data-cs-theme value="' + csE(pc.theme || '#c8a26b') + '"><button class="btn small" data-cs="notheme">Default</button></label>'
    + '<label class="cs-kv"><span>Encumbrance</span><select class="cb-sel" data-cs-ovpref="encumbrance">'
    +   [['', 'Standard: up to 15 × STR'], ['variant', 'Variant: slowed at 5 × and 10 × STR'], ['none', 'Don’t track it']].map(([v, l]) => '<option value="' + v + '"' + ((o.encumbrance || '') === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>'
    + '<label class="cb-inline"><input type="checkbox" data-cs-ovpref="coinWeight"' + (o.coinWeight === false ? '' : ' checked') + '> Coins have weight (50 to a pound)</label>'
    + '<div class="cs-ovgrid">' + CS_OV.map(([k, l]) => '<label class="cs-kv"><span>' + l + '</span>' + num(k, o[k]) + '</label>').join('')
    + Object.keys(CS_AB).map(k => '<label class="cs-kv"><span>' + CS_AB[k] + ' save</span>' + num('save:' + k, (o.saves || {})[k]) + '</label>').join('')
    + Object.keys(CS_SKILLS).map(k => '<label class="cs-kv"><span>' + CS_SKILLS[k][0] + '</span>' + num('skill:' + k, (o.skills || {})[k]) + '</label>').join('')
    + '</div><h5>Also</h5><div class="cb-dim">Comma-separated: what the rules don’t know about — a language learned in play, a curse’s vulnerability.</div>'
    + '<div class="cs-ovlists">' + CS_OV_LISTS.map(([k, l]) => '<label class="cs-kv"><span>' + l + '</span><input data-cs-ovlist="' + k + '" value="' + csE(o[k] || '') + '" maxlength="200"></label>').join('') + '</div></div>';
}

function csSpellsChange(e, t, d, pc){
  if (d.csOvpref){
    const v = t.type === 'checkbox' ? (t.checked ? undefined : false) : (t.value || undefined);
    csRebuild('Preference', b => { b.overrides = Object.assign({}, b.overrides, { [d.csOvpref]: v }); if (v === undefined) delete b.overrides[d.csOvpref]; });
    return true;
  }
  if (d.csOvlist){
    const v = t.value;
    csRebuild('Custom ' + d.csOvlist, b => { b.overrides = Object.assign({}, b.overrides, { [d.csOvlist]: v }); });
    return true;
  }
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
