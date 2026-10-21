// ============================================================
// CHARACTER BUILDER — make a character, or level one up
// ============================================================
// A step-by-step builder in the spirit of D&D Beyond's, for either rules
// edition. Everything it asks is a choice stored on the build; the sheet is
// recomputed from the build on every change (char-rules.js), so the preview
// on the right is always the real character, and "Create" just saves it.
//
// The same overlay serves three jobs:
//   create   — a blank build, from the Party panel, Ctrl+K or a phone
//   edit     — an existing built character, every step open
//   levelup  — an existing build one level higher, opened on the steps
//              that have something new to decide
//
// It works at phone width: one column, steps across the top, the sheet as
// a strip of headline numbers, the big buttons at the bottom.

let CB = null;   // { build, R, step, mode, idx, onDone, rolls }

const CB_STEPS = [
  { id: 'basics',     label: 'Basics' },
  { id: 'class',      label: 'Class' },
  { id: 'species',    label: 'Species' },
  { id: 'background', label: 'Background' },
  { id: 'abilities',  label: 'Abilities' },
  { id: 'skills',     label: 'Skills' },
  { id: 'levels',     label: 'Levels' },
  { id: 'spells',     label: 'Spells' },
  { id: 'equipment',  label: 'Equipment' },
  { id: 'review',     label: 'Review' },
];

function cbEsc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function cbIsPlayer(){ return document.body.classList.contains('player-mode') || document.body.classList.contains('player-app'); }

// ── Opening ──────────────────────────────────────────────────────────────────
// opts: { idx } to edit or level up the party member at idx; { levelup:true };
// { edition } to start a new build in a given edition; onDone(record, idx).
async function openCharBuilder(opts){
  opts = opts || {};
  const prior = (opts.idx != null) ? state.party[opts.idx] : null;
  let build;
  if (prior && prior.build) build = JSON.parse(JSON.stringify(prior.build));
  else build = sktBlankBuild(opts.edition || (state.settings && state.settings.builderEdition) || '2024');
  const mode = prior ? (opts.levelup ? 'levelup' : 'edit') : 'create';
  if (mode === 'levelup') build.level = Math.min(20, (build.level || 1) + 1);
  CB = { build, R: null, step: mode === 'create' ? 'basics' : (mode === 'levelup' ? 'levels' : 'review'),
         mode, idx: opts.idx != null ? opts.idx : null, onDone: opts.onDone || null,
         fromLevel: prior && prior.build ? prior.build.level : null, loading: true };
  cbMount();
  await cbLoad(build.edition);
}

async function cbLoad(edition){
  CB.loading = true; cbRender();
  try { CB.R = await sktRulesLoad(edition); }
  catch(e){ CB.error = 'The rules data did not load (' + e.message + '). Check the connection and try again.'; }
  CB.loading = false;
  cbRender();
}

function cbMount(){
  document.getElementById('cb-root')?.remove();
  const root = document.createElement('div');
  root.id = 'cb-root'; root.className = 'cb';
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Character builder');
  document.body.appendChild(root);
  root.addEventListener('click', cbOnClick);
  root.addEventListener('change', cbOnChange);
  root.addEventListener('input', cbOnInput);
  document.addEventListener('keydown', cbOnKey);
}
function cbClose(){
  document.getElementById('cb-root')?.remove();
  document.removeEventListener('keydown', cbOnKey);
  CB = null;
}
function cbOnKey(e){ if (e.key === 'Escape' && CB && !document.querySelector('.modal-backdrop')) cbAskClose(); }
function cbAskClose(){
  if (!CB) return;
  const dirty = !!(CB.build.cls || CB.build.species || CB.build.name);
  if (!dirty || typeof showConfirm !== 'function'){ cbClose(); return; }
  showConfirm(CB.mode === 'create' ? 'Close the builder? This character has not been created yet.' : 'Close without saving these changes?',
              { title: 'Close builder', confirmLabel: 'Close', danger: true }).then(ok => { if (ok) cbClose(); });
}

// ── Rendering ────────────────────────────────────────────────────────────────
function cbRender(){
  const root = document.getElementById('cb-root'); if (!root || !CB) return;
  if (CB.error){ root.innerHTML = cbShell('<div class="cb-msg">' + cbEsc(CB.error) + '</div>', ''); return; }
  if (CB.loading || !CB.R){ root.innerHTML = cbShell('<div class="cb-msg">Loading the ' + CB.build.edition + ' rules…</div>', ''); return; }
  const rec = sktComputeCharacter(CB.build, CB.R, CB.idx != null ? state.party[CB.idx] : null);
  CB.rec = rec;
  const main = (CB_RENDER[CB.step] || CB_RENDER.basics)();
  root.innerHTML = cbShell(main, cbSide(rec));
  const sc = root.querySelector('.cb-main'); if (sc && CB.scrollTop != null){ sc.scrollTop = CB.scrollTop; CB.scrollTop = null; }
}

function cbShell(main, side){
  const todo = CB && CB.R ? sktBuildTodo(CB.build, CB.R) : [];
  const count = id => todo.filter(t => t.step === id && !t.soft).length;
  const steps = cbVisibleSteps().map(s => {
    const n = count(s.id);
    return '<button class="cb-step' + (CB.step === s.id ? ' on' : '') + '" data-cb-step="' + s.id + '">' + cbEsc(s.label)
      + (n ? '<span class="cb-step-n" title="' + n + ' still to choose">' + n + '</span>' : '') + '</button>';
  }).join('');
  const title = CB.mode === 'levelup' ? 'Level up — ' + cbEsc(CB.build.name || 'character') + ' to level ' + CB.build.level
              : CB.mode === 'edit' ? 'Edit ' + cbEsc(CB.build.name || 'character') : 'New character';
  const vis = cbVisibleSteps(), at = vis.findIndex(s => s.id === CB.step);
  const last = at === vis.length - 1;
  const blocking = todo.filter(t => !t.soft);
  return '<div class="cb-head"><b class="cb-title">' + title + '</b>'
    + '<span class="cb-ed">' + (CB.build.edition === '2014' ? '2014 rules' : '2024 rules') + '</span>'
    + '<button class="cb-x" data-cb="close" aria-label="Close">✕</button></div>'
    + '<nav class="cb-steps">' + steps + '</nav>'
    + '<div class="cb-body"><div class="cb-main">' + main + '</div>'
    + (side ? '<aside class="cb-side">' + side + '</aside>' : '') + '</div>'
    + '<div class="cb-foot">'
    +   '<button class="btn" data-cb="back"' + (at <= 0 ? ' disabled' : '') + '>‹ Back</button>'
    +   '<span class="cb-foot-todo">' + (blocking.length ? blocking.length + ' still to choose' : 'Everything chosen') + '</span>'
    +   (last ? '<button class="btn primary" data-cb="save">' + (CB.mode === 'create' ? 'Create character' : 'Save changes') + '</button>'
             : '<button class="btn primary" data-cb="next">Next ›</button>')
    + '</div>';
}

// Steps that have nothing to ask are skipped: no Spells for a fighter, no
// Levels page for a level 1 character with no choices there.
function cbVisibleSteps(){
  if (!CB || !CB.R) return CB_STEPS;
  const cls = sktRulesClass(CB.R, CB.build.cls);
  const sc = cls ? sktBuildSpellcasting(CB.build, CB.R, sktBuildAbilities(CB.build, CB.R)) : null;
  const hasLevels = (CB.build.level || 1) > 1 || sktOptionalChoices(CB.build, CB.R).length || cbMasteryCount() > 0
    || (cls && sktBuildChoices(CB.build, CB.R).length);
  return CB_STEPS.filter(s => (s.id !== 'spells' || sc) && (s.id !== 'levels' || hasLevels || !cls));
}

// The live sheet beside every step.
function cbSide(rec){
  const b = CB.build, R = CB.R;
  const cls = sktRulesClass(R, b.cls);
  const ab = rec.abilities;
  const abil = SKT_ABS.map(k => '<div class="cb-ab"><span>' + k.toUpperCase() + '</span><b>' + ab[k] + '</b><i>' + sktSigned(sktMod(ab[k])) + '</i></div>').join('');
  const todo = sktBuildTodo(b, R);
  return '<div class="cb-sheet">'
    + '<div class="cb-sheet-name">' + cbEsc(rec.icon) + ' ' + cbEsc(b.name || 'Unnamed') + '</div>'
    + '<div class="cb-sheet-sub">' + cbEsc([rec.race, cls ? cls.name + ' ' + rec.level : '', rec.subclass].filter(Boolean).join(' · ') || 'Choose a species and a class') + '</div>'
    + '<div class="cb-big"><div><span>AC</span><b>' + rec.ac + '</b></div><div><span>HP</span><b>' + rec.hpMax + '</b></div>'
    + '<div><span>Init</span><b>' + sktSigned(rec.init) + '</b></div><div><span>Speed</span><b>' + rec.spd + '</b></div>'
    + '<div><span>Prof</span><b>+' + rec.sheet.profBonus + '</b></div></div>'
    + '<div class="cb-abs">' + abil + '</div>'
    + (rec.sheet.acSource ? '<div class="cb-dim">AC from ' + cbEsc(rec.sheet.acSource) + '</div>' : '')
    + (todo.length ? '<div class="cb-todo"><b>Still to choose</b>' + todo.map(t => '<div class="cb-todo-i' + (t.soft ? ' soft' : '') + '" data-cb-step="' + t.step + '">' + cbEsc(t.what) + '</div>').join('') + '</div>' : '<div class="cb-done">✓ Ready</div>')
    + '</div>';
}

// ── Small UI pieces ──────────────────────────────────────────────────────────
function cbCards(items, selected, attr, extra){
  return '<div class="cb-cards">' + items.map(it => {
    const on = selected === it.value;
    return '<button class="cb-card' + (on ? ' on' : '') + '" data-' + attr + '="' + cbEsc(it.value) + '">'
      + '<b>' + cbEsc(it.label) + '</b>' + (it.sub ? '<span>' + cbEsc(it.sub) + '</span>' : '') + '</button>';
  }).join('') + '</div>' + (extra || '');
}
// A checklist with a limit. `locked` are shown ticked and cannot be changed
// (granted by something else); `max` counts only the free picks.
function cbChecks(options, chosen, max, attr, locked){
  locked = locked || {};
  const free = chosen.filter(v => !locked[v]);
  const full = max != null && free.length >= max;
  return '<div class="cb-checks">' + options.map(o => {
    const v = typeof o === 'string' ? o : o.value, label = typeof o === 'string' ? o : o.label;
    const lock = locked[v];
    const on = !!lock || chosen.includes(v);
    const dis = lock || (!on && full);
    return '<label class="cb-check' + (on ? ' on' : '') + (dis && !on ? ' dim' : '') + '">'
      + '<input type="checkbox" data-' + attr + '="' + cbEsc(v) + '"' + (on ? ' checked' : '') + (dis ? ' disabled' : '') + '>'
      + '<span>' + cbEsc(label) + (lock ? ' <i>' + cbEsc(lock) + '</i>' : '') + '</span></label>';
  }).join('') + '</div>';
}
function cbCounter(have, want, what){
  const ok = have >= want;
  return '<div class="cb-counter' + (ok ? ' ok' : '') + '">' + have + ' / ' + want + ' ' + cbEsc(what) + '</div>';
}
function cbFeatureText(text, open){
  const t = String(text || '').trim(); if (!t) return '';
  return '<details class="cb-ft"' + (open ? ' open' : '') + '><summary>What it does</summary><div>' + cbEsc(t).replace(/\n/g, '<br>') + '</div></details>';
}
function cbAbLabel(k){ return SKT_AB_NAME[k] || k; }

// ── Steps ────────────────────────────────────────────────────────────────────
const CB_RENDER = {};

CB_RENDER.basics = () => {
  const b = CB.build;
  const icons = ['⚔', '🗡', '🏹', '🪓', '🛡', '🔥', '✨', '🌿', '🎵', '👊', '📘', '👁', '🐉', '🌙'];
  return '<h3>Basics</h3>'
    + '<div class="cb-row"><label class="cb-f cb-grow">Name<input data-cb-in="name" value="' + cbEsc(b.name) + '" placeholder="Character name" maxlength="60"></label>'
    + '<label class="cb-f">Level<input type="number" min="1" max="20" data-cb-in="level" value="' + (b.level || 1) + '"' + (CB.mode === 'levelup' ? ' disabled' : '') + '></label></div>'
    + '<div class="cb-f">Rules'
    +   '<div class="cb-seg"><button class="' + (b.edition === '2024' ? 'on' : '') + '" data-cb-ed="2024">2024 Player’s Handbook</button>'
    +   '<button class="' + (b.edition === '2014' ? 'on' : '') + '" data-cb-ed="2014">2014 Player’s Handbook</button></div>'
    +   '<div class="cb-dim">Switching edition keeps the name and level and clears choices that don’t exist in the other book.</div></div>'
    + '<div class="cb-f">Token icon<div class="cb-icons">' + icons.map(i => '<button class="' + (b.icon === i ? 'on' : '') + '" data-cb-icon="' + i + '">' + i + '</button>').join('') + '</div></div>';
};

CB_RENDER.class = () => {
  const b = CB.build, R = CB.R;
  const cls = sktRulesClass(R, b.cls);
  const cards = R.classes.map(c => ({ value: c.name, label: c.name,
    sub: 'd' + c.hd + ' · saves ' + c.saves.map(s => s.toUpperCase()).join('/') }));
  let html = '<h3>Class</h3>' + cbCards(cards, cls && cls.name, 'cb-cls');
  if (cls){
    const lvl1 = cls.features.filter(f => f.level === 1 && !/Proficiencies/.test(f.name)).map(f => f.name).join(', ');
    html += '<div class="cb-note"><b>' + cbEsc(cls.name) + '</b> — at level 1: ' + cbEsc(lvl1) + '.</div>';
    const title = sktRulesInline(cls.subclassTitle);
    if ((b.level || 1) >= cls.subclassLevel){
      const showAll = !!CB.allBooks;
      const subs = cls.subclasses.filter(s => s.core || showAll)
        .filter((s, i, a) => a.findIndex(x => x.shortName === s.shortName) === i)
        .map(s => ({ value: s.shortName, label: s.shortName, sub: s.core ? '' : s.source }));
      html += '<h4>' + cbEsc(title) + '</h4>' + cbCards(subs, b.subclass, 'cb-sub')
        + '<label class="cb-inline"><input type="checkbox" data-cb-allbooks' + (showAll ? ' checked' : '') + '> Include subclasses from other books</label>';
      const sub = sktRulesSubclass(cls, b.subclass);
      if (sub) html += sub.features.filter(f => f.level <= b.level).map(f => '<div class="cb-feat"><b>' + cbEsc(f.name) + '</b> <span class="cb-dim">level ' + f.level + '</span>' + cbFeatureText(sktRulesText(f.entries)) + '</div>').join('');
    } else {
      html += '<div class="cb-dim">' + cbEsc(title) + ' is chosen at level ' + cls.subclassLevel + '.</div>';
    }
  }
  return html;
};

CB_RENDER.species = () => {
  const b = CB.build, R = CB.R;
  const sp = sktRulesSpecies(R, b.species);
  let html = '<h3>Species</h3>' + cbCards(R.species.map(s => ({ value: s.name, label: s.name,
    sub: (typeof s.speed === 'number' ? s.speed : (s.speed && s.speed.walk) || 30) + ' ft' + (s.darkvision ? ' · darkvision' : '') })), b.species, 'cb-species');
  if (!sp) return html;
  if (sp.subraces.length){
    html += '<h4>' + (R.edition === '2014' ? 'Subrace' : 'Lineage') + '</h4>' + cbCards(sp.subraces.map(s => ({ value: s.name, label: s.name })), b.subspecies, 'cb-subspecies');
  }
  // 2024 lineages that live in additionalSpells (Elf, Gnome, Tiefling).
  const lineages = (R.edition === '2024' && Array.isArray(sp.additionalSpells) && sp.additionalSpells.length > 1)
    ? sp.additionalSpells.map(x => x.name).filter(Boolean) : [];
  if (lineages.length){
    html += '<h4>Lineage</h4>' + cbCards(lineages.map(n => ({ value: n, label: n })), b.speciesChoice.lineage, 'cb-lineage');
  }
  // Choosable ability increases (2014: Half-Elf, Variant Human…).
  const sub = sp.subraces.find(s => s.name === b.subspecies);
  const ch = R.edition === '2014' ? cbSpeciesAsiChoice(sp, sub) : null;
  if (ch){
    const picked = Object.keys(b.speciesAsi || {});
    html += '<h4>Ability increases</h4><div class="cb-dim">Choose ' + ch.count + ' to increase by ' + ch.amount + '.</div>'
      + cbChecks(ch.from.map(k => ({ value: k, label: cbAbLabel(k) })), picked, ch.count, 'cb-spasi');
  }
  // Species skill picks.
  const skillPick = cbSpeciesSkillChoice(sp, sub);
  if (skillPick){
    html += '<h4>Skills</h4><div class="cb-dim">Choose ' + skillPick.count + '.</div>'
      + cbChecks(skillPick.from.map(k => ({ value: k, label: SKT_SKILL_LABEL[k] })), b.speciesSkills || [], skillPick.count, 'cb-spskill');
  }
  // A bonus feat: 2014 Variant Human; 2024 Human (Versatile, an origin feat).
  if ((R.edition === '2014' && sub && /variant/i.test(sub.name)) || (R.edition === '2024' && sp.name === 'Human')){
    const pool = R.feats.filter(f => R.edition === '2014' ? true : f.category === 'O');
    html += '<h4>' + (R.edition === '2024' ? 'Versatile — an origin feat' : 'Feat') + '</h4>'
      + '<select class="cb-sel" data-cb-originfeat><option value="">Choose a feat…</option>'
      + pool.map(f => '<option' + (b.originFeat === f.name ? ' selected' : '') + '>' + cbEsc(f.name) + '</option>').join('') + '</select>'
      + (b.originFeat ? cbFeatureText(sktRulesText((sktRulesFeat(R, b.originFeat) || {}).entries)) : '');
  }
  html += '<h4>Traits</h4>' + [sp].concat(sub ? [sub] : []).map(s => (s.entries || []).filter(e => e && e.name && e.entries)
    .map(e => '<div class="cb-feat"><b>' + cbEsc(sktRulesInline(e.name)) + '</b>' + cbFeatureText(sktRulesText(e.entries)) + '</div>').join('')).join('');
  return html;
};
function cbSpeciesAsiChoice(sp, sub){
  for (const list of [sub && sub.ability, sp.ability]){
    for (const a of (list || [])){
      if (a.choose) return { from: a.choose.from, count: a.choose.count || 1, amount: a.choose.amount || 1 };
    }
  }
  return null;
}
function cbSpeciesSkillChoice(sp, sub){
  for (const list of [sub && sub.skills, sp.skills]){
    for (const s of (list || [])){
      if (s.any) return { from: Object.keys(SKT_SKILLS), count: s.any };
      if (s.choose) return { from: (s.choose.from || []).map(sktSkillKey).filter(Boolean), count: s.choose.count || 1 };
    }
  }
  // 2024 Human: Skillful (one skill); 2024 Elf: Keen Senses (one of three).
  if (CB.R.edition === '2024' && sp.name === 'Human') return { from: Object.keys(SKT_SKILLS), count: 1 };
  if (CB.R.edition === '2024' && sp.name === 'Elf') return { from: ['insight', 'perception', 'survival'], count: 1 };
  return null;
}

CB_RENDER.background = () => {
  const b = CB.build, R = CB.R;
  const bg = sktRulesBackground(R, b.background);
  const skillsOf = x => (x.skills || []).flatMap(o => Object.keys(o).filter(k => o[k] === true).map(k => SKT_SKILL_LABEL[sktSkillKey(k)] || k));
  let html = '<h3>Background</h3>' + cbCards(R.backgrounds.map(x => ({ value: x.name, label: x.name, sub: skillsOf(x).join(', ') })), b.background, 'cb-bg');
  if (!bg) return html;
  if (R.edition === '2024' && Array.isArray(bg.ability)){
    const from = ((bg.ability[0] || {}).choose || {}).weighted ? bg.ability[0].choose.weighted.from : SKT_ABS;
    const mode = b.bgAsiMode || '21';
    html += '<h4>Ability increases</h4><div class="cb-dim">Increase one of these by 2 and another by 1, or all three by 1.</div>'
      + '<div class="cb-seg"><button class="' + (mode === '21' ? 'on' : '') + '" data-cb-bgmode="21">+2 / +1</button><button class="' + (mode === '111' ? 'on' : '') + '" data-cb-bgmode="111">+1 / +1 / +1</button></div>';
    if (mode === '21'){
      const plus2 = Object.keys(b.bgAsi).find(k => b.bgAsi[k] === 2) || '';
      const plus1 = Object.keys(b.bgAsi).find(k => b.bgAsi[k] === 1) || '';
      const opt = (sel, not) => from.map(k => '<option value="' + k + '"' + (sel === k ? ' selected' : '') + (k === not ? ' disabled' : '') + '>' + cbAbLabel(k) + '</option>').join('');
      html += '<div class="cb-row"><label class="cb-f">+2<select class="cb-sel" data-cb-bg2><option value="">—</option>' + opt(plus2, plus1) + '</select></label>'
            + '<label class="cb-f">+1<select class="cb-sel" data-cb-bg1><option value="">—</option>' + opt(plus1, plus2) + '</select></label></div>';
    } else {
      html += '<div class="cb-dim">' + from.map(cbAbLabel).join(', ') + ' each +1.</div>';
    }
    const feat = sktBuildFeatNames({ ...b, originFeat: '', asi: {} }, R)[0];
    if (feat) html += '<h4>Origin feat — ' + cbEsc(feat) + '</h4>' + cbFeatureText(sktRulesText((sktRulesFeat(R, feat) || {}).entries), false);
  }
  html += '<div class="cb-note">Skills: ' + cbEsc(skillsOf(bg).join(', ') || '—') + '</div>';
  html += _sktTraitsHtml(bg.entries);
  return html;
};
function _sktTraitsHtml(entries){
  return (entries || []).filter(e => e && typeof e === 'object' && e.name && e.entries && !/^(Skill|Tool|Language|Equipment|Ability|Feat)/i.test(e.name))
    .map(e => '<div class="cb-feat"><b>' + cbEsc(sktRulesInline(e.name)) + '</b>' + cbFeatureText(sktRulesText(e.entries)) + '</div>').join('');
}

CB_RENDER.abilities = () => {
  const b = CB.build, R = CB.R;
  const m = b.abilities.method || 'array';
  const base = b.abilities.base;
  const final = sktBuildAbilities(b, R);
  const seg = [['array', 'Standard array'], ['pointbuy', 'Point buy'], ['roll', 'Roll'], ['manual', 'Enter scores']]
    .map(([k, l]) => '<button class="' + (m === k ? 'on' : '') + '" data-cb-method="' + k + '">' + l + '</button>').join('');
  let pool = null, note = '';
  if (m === 'array') pool = SKT_STANDARD_ARRAY;
  if (m === 'roll') pool = b.abilities.rolled || null;
  if (m === 'pointbuy'){
    const spent = SKT_ABS.reduce((s, k) => s + (SKT_POINT_BUY[base[k]] ?? 99), 0);
    note = '<div class="cb-counter' + (spent <= 27 ? ' ok' : '') + '">' + (27 - spent) + ' of 27 points left</div>';
  }
  if (m === 'roll') note = '<button class="btn" data-cb="roll">🎲 Roll 4d6, drop the lowest — six times</button>'
    + (pool ? '<div class="cb-dim">Rolled: ' + pool.join(', ') + '. Assign each to an ability.</div>' : '');
  const rows = SKT_ABS.map(k => {
    let ctrl;
    if (m === 'manual') ctrl = '<input type="number" min="3" max="20" data-cb-score="' + k + '" value="' + base[k] + '">';
    else if (m === 'pointbuy') ctrl = '<button class="btn small" data-cb-pb="' + k + ':-1"' + (base[k] <= 8 ? ' disabled' : '') + '>−</button><b class="cb-pbv">' + base[k] + '</b><button class="btn small" data-cb-pb="' + k + ':1"' + (base[k] >= 15 ? ' disabled' : '') + '>+</button>';
    else ctrl = pool ? '<select class="cb-sel" data-cb-assign="' + k + '">' + pool.map((v, i) => '<option value="' + i + '"' + ((b.abilities.assign || {})[k] === i ? ' selected' : '') + '>' + v + '</option>').join('') + '</select>' : '<span class="cb-dim">roll first</span>';
    const bonus = final[k] - base[k];
    return '<div class="cb-abrow"><span class="cb-abn">' + cbAbLabel(k) + '</span><span class="cb-abc">' + ctrl + '</span>'
      + '<span class="cb-abb">' + (bonus ? sktSigned(bonus) : '') + '</span><b class="cb-abf">' + final[k] + '</b><i class="cb-abm">' + sktSigned(sktMod(final[k])) + '</i></div>';
  }).join('');
  const where = R.edition === '2024' ? 'Background and feat increases are included.' : 'Species and feat increases are included.';
  return '<h3>Ability scores</h3><div class="cb-seg">' + seg + '</div>' + note
    + '<div class="cb-abtable"><div class="cb-abrow cb-abhead"><span></span><span>Base</span><span>Bonus</span><span>Score</span><span>Mod</span></div>' + rows + '</div>'
    + '<div class="cb-dim">' + where + '</div>';
};

CB_RENDER.skills = () => {
  const b = CB.build, R = CB.R;
  const cls = sktRulesClass(R, b.cls);
  if (!cls) return '<h3>Skills</h3><div class="cb-dim">Choose a class first.</div>';
  const rec = CB.rec;
  // What other choices already grant, shown ticked and fixed.
  const granted = {};
  const sp = sktRulesSpecies(R, b.species), bg = sktRulesBackground(R, b.background);
  const grant = (list, label) => (list || []).forEach(o => Object.keys(o).forEach(k => { const sk = sktSkillKey(k); if (sk && o[k] === true) granted[sk] = label; }));
  grant(bg && bg.skills, 'background'); grant(sp && sp.skills, 'species');
  (b.speciesSkills || []).forEach(k => { granted[k] = 'species'; });
  if (R.edition === '2014' && sp && sp.entries && sp.entries.some(e => e && e.name === 'Keen Senses')) granted.perception = 'species';
  if (sp && sp.entries && sp.entries.some(e => e && e.name === 'Menacing')) granted.intimidation = 'species';
  let html = '<h3>Skills</h3><h4>' + cbEsc(cls.name) + ' skills</h4>' + cbCounter((b.skills || []).length, cls.skillChoice.count, 'chosen')
    + cbChecks(cls.skillChoice.from.map(k => ({ value: k, label: SKT_SKILL_LABEL[k] })), b.skills || [], cls.skillChoice.count, 'cb-skill', granted);
  const ex = cbExpertiseCount();
  if (ex){
    const profd = Object.keys(rec.sheet.skillProf || {});
    html += '<h4>Expertise</h4><div class="cb-dim">Double your proficiency bonus in ' + ex + ' skill' + (ex === 1 ? '' : 's') + ' you are proficient in.</div>'
      + cbCounter((b.expertise || []).length, ex, 'chosen')
      + cbChecks(profd.map(k => ({ value: k, label: SKT_SKILL_LABEL[k] })), b.expertise || [], ex, 'cb-expert');
  }
  const langCount = cbLanguageCount();
  if (langCount){
    const known = (rec.sheet.languages || '').split(', ').filter(Boolean).filter(l => !(b.languages || []).includes(l));
    html += '<h4>Languages</h4><div class="cb-dim">Already known: ' + cbEsc(known.join(', ') || '—') + '. Choose ' + langCount + ' more.</div>'
      + cbChecks(R.languages.map(l => l.name).filter(n => !known.includes(n)), b.languages || [], langCount, 'cb-lang');
  }
  html += '<h4>All skills</h4><div class="cb-skilltable">' + Object.keys(SKT_SKILLS).map(k =>
    '<div class="cb-sk' + (rec.sheet.skillProf[k] ? ' prof' + rec.sheet.skillProf[k] : '') + '"><span>' + SKT_SKILL_LABEL[k] + ' <i>' + SKT_SKILLS[k].toUpperCase() + '</i></span><b>' + sktSigned(rec.sheet.skills[k]) + '</b></div>').join('') + '</div>';
  return html;
};
function cbExpertiseCount(){
  const cls = sktRulesClass(CB.R, CB.build.cls); if (!cls) return 0;
  const L = CB.build.level || 1;
  let n = cls.features.filter(f => f.level <= L && /^Expertise$/i.test(f.name)).length * 2;
  if (CB.R.edition === '2024' && cls.key === 'ranger' && L >= 2) n += 1;         // Deft Explorer
  if (CB.R.edition === '2024' && cls.key === 'wizard' && L >= 2) n += 1;         // Scholar
  return n;
}
function cbLanguageCount(){
  const R = CB.R, b = CB.build;
  if (R.edition === '2024') return 2;
  let n = 0;
  const sp = sktRulesSpecies(R, b.species), sub = sp && sp.subraces.find(s => s.name === b.subspecies);
  const bg = sktRulesBackground(R, b.background);
  [sp && sp.languages, sub && sub.languages, bg && bg.languages].forEach(list => (list || []).forEach(o => {
    n += (+o.anyStandard || 0) + (+o.any || 0) + (o.choose ? (o.choose.count || 1) : 0);
  }));
  return n;
}
function cbMasteryCount(){
  if (!CB || !CB.R || CB.R.edition !== '2024') return 0;
  const cls = sktRulesClass(CB.R, CB.build.cls);
  if (!cls) return 0;
  const L = CB.build.level || 1;
  // Fighters and barbarians have a column for it; paladins, rangers and
  // rogues only say "two kinds" in the feature's text.
  const n = sktClassColumn(cls, 'Weapon Mastery', L);
  if (typeof n === 'number') return n;
  return cls.features.some(f => f.name === 'Weapon Mastery' && f.level <= L) ? 2 : 0;
}

CB_RENDER.levels = () => {
  const b = CB.build, R = CB.R;
  const cls = sktRulesClass(R, b.cls);
  if (!cls) return '<h3>Levels</h3><div class="cb-dim">Choose a class first.</div>';
  const L = b.level || 1;
  let html = '<h3>Levels</h3>';
  if (CB.mode === 'levelup' && CB.fromLevel){
    const fresh = sktBuildFeatures(b, R).filter(f => f.level > CB.fromLevel && f.level <= L && !f.info);
    html += '<div class="cb-new"><b>New at level ' + L + '</b>' + (fresh.length ? fresh.map(f => '<div class="cb-feat"><b>' + cbEsc(f.name) + '</b> ' + (f.mech ? '<span class="cb-badge">applied</span>' : '') + cbFeatureText(f.text, true) + '</div>').join('') : '<div class="cb-dim">No new features — just hit points and anything below.</div>') + '</div>';
  }
  // Hit points.
  if (L > 1){
    const avg = Math.floor(cls.hd / 2) + 1;
    const hm = (b.hp && b.hp.method) || 'average';
    html += '<h4>Hit points</h4><div class="cb-seg"><button class="' + (hm === 'average' ? 'on' : '') + '" data-cb-hp="average">Take the average (' + avg + ')</button>'
      + '<button class="' + (hm === 'rolled' ? 'on' : '') + '" data-cb-hp="rolled">Roll</button></div>';
    if (hm === 'rolled'){
      let rows = '';
      for (let lv = 2; lv <= L; lv++){
        const v = (b.hp.rolls || {})[lv] || '';
        rows += '<label class="cb-hproll">Level ' + lv + ' <input type="number" min="1" max="' + cls.hd + '" data-cb-hproll="' + lv + '" value="' + v + '"><button class="btn small" data-cb-hpdice="' + lv + '">🎲 d' + cls.hd + '</button></label>';
      }
      html += '<div class="cb-hprolls">' + rows + '</div>';
    }
    html += '<div class="cb-dim">Level 1 is always the full d' + cls.hd + '. Your Constitution modifier is added every level.</div>';
  }
  // Features that are a choice: Divine Order, Primal Order, Blessed Strikes…
  sktBuildChoices(b, R).forEach(c => {
    html += '<h4>' + cbEsc(c.spec.label || c.feature) + ' <span class="cb-dim">level ' + c.level + '</span></h4>'
      + '<div class="cb-cards">' + c.spec.options.map(o => '<button class="cb-card' + (c.value === o.value ? ' on' : '') + '" data-cb-fchoice="'
        + cbEsc(c.feature + '||' + o.value) + '"><b>' + cbEsc(o.label) + '</b><span>' + cbEsc(o.desc || '') + '</span></button>').join('') + '</div>';
  });
  // Subclass.
  if (L >= cls.subclassLevel && !b.subclass) html += '<div class="cb-warn">Choose your ' + cbEsc(sktRulesInline(cls.subclassTitle)) + ' on the Class step.</div>';
  // ASI or feat.
  sktAsiLevels(cls).filter(l => l <= L).forEach(l => {
    const p = b.asi[l] || {};
    const isFeat = p.type === 'feat';
    html += '<div class="cb-asi"><h4>Level ' + l + '</h4><div class="cb-seg">'
      + '<button class="' + (p.type === 'asi' ? 'on' : '') + '" data-cb-asitype="' + l + ':asi">Ability Score Improvement</button>'
      + '<button class="' + (isFeat ? 'on' : '') + '" data-cb-asitype="' + l + ':feat">A feat</button></div>';
    if (p.type === 'asi'){
      const inc = p.inc || {};
      const sel = (slot) => {
        const keys = Object.keys(inc); const cur = slot === 0 ? keys[0] || '' : (keys[1] || (inc[keys[0]] === 2 ? keys[0] : ''));
        return '<select class="cb-sel" data-cb-asiab="' + l + ':' + slot + '"><option value="">—</option>' + SKT_ABS.map(k => '<option value="' + k + '"' + (cur === k ? ' selected' : '') + '>' + cbAbLabel(k) + '</option>').join('') + '</select>';
      };
      html += '<div class="cb-row"><label class="cb-f">+1' + sel(0) + '</label><label class="cb-f">+1' + sel(1) + '</label></div><div class="cb-dim">Pick the same ability twice for +2.</div>';
    } else if (isFeat){
      const pool = R.feats.filter(f => R.edition === '2014' || f.category === 'G' || (l >= 19 && f.category === 'EB'));
      html += '<select class="cb-sel" data-cb-asifeat="' + l + '"><option value="">Choose a feat…</option>'
        + pool.map(f => '<option' + (p.feat === f.name ? ' selected' : '') + '>' + cbEsc(f.name) + '</option>').join('') + '</select>';
      const f = p.feat && sktRulesFeat(R, p.feat);
      if (f){
        const ch = cbFeatAbilityChoice(f);
        if (ch){
          const cur = Object.keys((b.featChoices[f.name] || {}).inc || {})[0] || '';
          html += '<label class="cb-f">' + (ch.amount === 1 ? 'Increase by 1' : 'Increase') + '<select class="cb-sel" data-cb-featab="' + cbEsc(f.name) + ':' + ch.amount + '"><option value="">—</option>'
            + ch.from.map(k => '<option value="' + k + '"' + (cur === k ? ' selected' : '') + '>' + cbAbLabel(k) + '</option>').join('') + '</select></label>';
        }
        if (/^Resilient$/i.test(f.name)){
          const cur = (b.featChoices[f.name] || {}).save || '';
          html += '<label class="cb-f">Saving throw proficiency<select class="cb-sel" data-cb-featsave="' + cbEsc(f.name) + '"><option value="">—</option>'
            + SKT_ABS.map(k => '<option value="' + k + '"' + (cur === k ? ' selected' : '') + '>' + cbAbLabel(k) + '</option>').join('') + '</select></label>';
        }
        html += cbFeatureText(sktRulesText(f.entries));
      }
    }
    html += '</div>';
  });
  // Optional features: invocations, metamagic, fighting styles, pact boons.
  sktOptionalChoices(b, R).forEach(o => {
    const have = (b.optional[o.name] || []);
    const pool = o.kind === 'feat'
      ? R.feats.filter(f => o.types.some(t => String(f.category).split(':')[0] === t.split(':')[0]) && (String(f.category) === 'FS' || o.types.includes(f.category)))
      : R.optional.filter(x => (x.featureType || []).some(t => o.types.includes(t)));
    html += '<h4>' + cbEsc(o.name) + '</h4>' + cbCounter(have.length, o.count, 'chosen')
      + cbChecks(pool.map(x => ({ value: x.name, label: x.name + cbPrereqNote(x) })), have, o.count, 'cb-opt-' + cbSlug(o.name));
    have.forEach(n => { const x = pool.find(p => p.name === n); if (x) html += '<div class="cb-feat"><b>' + cbEsc(n) + '</b>' + cbFeatureText(sktRulesText(x.entries)) + '</div>'; });
  });
  // 2024 weapon masteries.
  const mc = cbMasteryCount();
  if (mc){
    const P = CB.rec.sheet.proficiencies;
    const prof = P.weapons, rules = P.weaponRules || [];
    const can = i => prof.includes(i.weaponCategory) || prof.includes(i.name.toLowerCase())
      || rules.some(r => r.cat === i.weaponCategory && r.props.some(p => (i.property || []).map(x => String(x).split('|')[0]).includes(p)));
    const weapons = Object.values(R.items).filter(i => i.mastery && i.weaponCategory && can(i))
      .map(i => i.name).filter((n, k, a) => a.indexOf(n) === k).sort();
    html += '<h4>Weapon Mastery</h4><div class="cb-dim">Use the mastery property of ' + mc + ' kinds of weapon.</div>'
      + cbCounter((b.masteries || []).length, mc, 'chosen')
      + cbChecks(weapons.map(n => ({ value: n.toLowerCase(), label: n + ' — ' + String((R.items[n.toLowerCase()].mastery || [''])[0]).split('|')[0] })), b.masteries || [], mc, 'cb-mastery');
  }
  return html;
};
function cbSlug(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
function cbPrereqNote(x){
  const p = (x.prerequisite || [])[0]; if (!p) return '';
  if (p.level) return ' (level ' + (p.level.level || p.level) + '+)';
  if (p.pact) return ' (' + p.pact + ')';
  if (p.spell) return ' (needs ' + String(p.spell[0]).split('|')[0].replace(/#c$/, '') + ')';
  return '';
}
function cbFeatAbilityChoice(f){
  for (const a of (f.ability || [])){
    if (a.choose) return { from: a.choose.from || SKT_ABS, amount: a.choose.amount || 1 };
  }
  return null;
}

CB_RENDER.spells = () => {
  const b = CB.build, R = CB.R;
  const sc = sktBuildSpellcasting(b, R, sktBuildAbilities(b, R));
  if (!sc) return '<h3>Spells</h3><div class="cb-dim">This character does not cast spells yet.</div>';
  const want = sc.prepared || sc.known;
  const always = sktBuildAlwaysPrepared(b, R);
  let html = '<h3>Spells</h3><div class="cb-note">' + cbAbLabel(sc.ability) + ' · save DC ' + sc.dc + ' · attack ' + sktSigned(sc.attack)
    + ' · slots ' + (Object.keys(sc.slots).map(l => sc.slots[l] + '×' + l + (l === '1' ? 'st' : l === '2' ? 'nd' : l === '3' ? 'rd' : 'th')).join(', ') || '—') + '</div>';
  if (sc.cantrips){
    html += '<h4>Cantrips</h4>' + cbCounter((b.cantrips || []).length, sc.cantrips, 'chosen')
      + cbChecks(sktSpellOptions(R, b, 0).map(s => s.name), b.cantrips || [], sc.cantrips, 'cb-cantrip');
  }
  if (want){
    html += '<h4>' + (sc.prepared ? 'Prepared spells' : 'Spells known') + '</h4>' + cbCounter((b.spells || []).length, want, 'chosen');
    for (let lv = 1; lv <= sc.maxSpellLevel; lv++){
      const opts = sktSpellOptions(R, b, lv).map(s => s.name).filter(n => !always.includes(n));
      if (!opts.length) continue;
      html += '<div class="cb-spl"><span class="cb-spl-l">Level ' + lv + '</span>' + cbChecks(opts, b.spells || [], want, 'cb-spell') + '</div>';
    }
  }
  if (always.length) html += '<h4>Always prepared</h4><div class="cb-dim">' + cbEsc(always.join(', ')) + '</div>';
  return html;
};

CB_RENDER.equipment = () => {
  const b = CB.build, R = CB.R;
  const cls = sktRulesClass(R, b.cls), bg = sktRulesBackground(R, b.background);
  let html = '<h3>Equipment</h3>';
  const itemText = (it) => typeof it === 'string' ? _sktTitleCase(sktRefName(it))
    : it.value ? (it.value / 100) + ' gp'
    : it.item ? (it.quantity > 1 ? it.quantity + ' × ' : '') + (it.displayName || _sktTitleCase(sktRefName(it.item)))
    : it.special ? it.special : it.equipmentType ? _SKT_EQ_LABEL[it.equipmentType] || 'an item of your choice' : '';
  const blockHtml = (blocks, kind) => (blocks || []).map((block, i) => {
    const letters = Object.keys(block).filter(k => k !== '_');
    const fixed = (block._ || []).map(itemText).filter(Boolean).join(', ');
    const cur = kind === 'cls' ? (R.edition === '2024' ? b.equipment.cls : (b.equipment.clsBlocks || [])[i]) : (R.edition === '2024' ? b.equipment.bg : (b.equipment.bgBlocks || [])[i]);
    const chosen = letters.includes(cur) ? cur : letters[0];
    let out = '';
    if (letters.length){
      out += '<div class="cb-eqblock">' + letters.map(l => {
        const items = block[l];
        const picks = items.map((it, j) => it && it.equipmentType && l === chosen
          ? '<select class="cb-sel" data-cb-eqpick="' + kind + ':' + i + ':' + ((block._ || []).length + j) + '">' + sktEquipmentOptions(R, it.equipmentType).map(n => '<option' + ((b.equipment.picks || {})[kind + ':' + i + ':' + ((block._ || []).length + j)] === n.toLowerCase() || (!(b.equipment.picks || {})[kind + ':' + i + ':' + ((block._ || []).length + j)] && _SKT_EQ_DEFAULT[it.equipmentType] === n.toLowerCase()) ? ' selected' : '') + ' value="' + cbEsc(n.toLowerCase()) + '">' + cbEsc(n) + '</option>').join('') + '</select>' : '').join('');
        return '<label class="cb-eqopt' + (l === chosen ? ' on' : '') + '"><input type="radio" name="eq-' + kind + '-' + i + '" data-cb-eq="' + kind + ':' + i + ':' + l + '"' + (l === chosen ? ' checked' : '') + '>'
          + '<b>(' + l.toUpperCase() + ')</b> ' + cbEsc(items.map(itemText).filter(Boolean).join(', ')) + picks + '</label>';
      }).join('') + '</div>';
    }
    if (fixed) out += '<div class="cb-dim">Also: ' + cbEsc(fixed) + '</div>';
    return out;
  }).join('');
  if (cls && cls.equipment && Array.isArray(cls.equipment.defaultData)) html += '<h4>' + cbEsc(cls.name) + '</h4>' + blockHtml(cls.equipment.defaultData, 'cls');
  else if (!cls) html += '<div class="cb-dim">Choose a class first.</div>';
  if (bg && (bg.equipment || []).length) html += '<h4>' + cbEsc(bg.name) + '</h4>' + blockHtml(bg.equipment, 'bg');
  const rec = CB.rec;
  html += '<h4>Result</h4><div class="cb-note">AC ' + rec.ac + (rec.sheet.acSource ? ' (' + cbEsc(rec.sheet.acSource) + ')' : '') + '</div>'
    + '<div class="cb-attacks">' + rec.sheet.attacks.map(a => '<div class="cb-atk"><b>' + cbEsc(a.name) + '</b><span>' + cbEsc(a.atkBonus) + '</span><span>' + cbEsc(a.damage) + '</span>' + (a.mastery ? '<i>' + cbEsc(a.mastery) + '</i>' : '') + '</div>').join('') + '</div>';
  return html;
};
function _sktTitleCase(s){ return _sktTitle(s); }
const _SKT_EQ_LABEL = { weaponMartial: 'a martial weapon', weaponMartialMelee: 'a martial melee weapon', weaponSimple: 'a simple weapon',
  weaponSimpleMelee: 'a simple melee weapon', weaponSimpleRanged: 'a simple ranged weapon', focusSpellcastingArcane: 'an arcane focus',
  focusSpellcastingDruidic: 'a druidic focus', focusSpellcastingHoly: 'a holy symbol', instrumentMusical: 'a musical instrument',
  toolArtisan: 'artisan’s tools', setGaming: 'a gaming set' };

CB_RENDER.review = () => {
  const rec = CB.rec, b = CB.build;
  const sh = rec.sheet;
  const feats = (sh.featureList || []).filter(f => !f.info);
  const mech = feats.filter(f => f.mech).length;
  const saves = SKT_ABS.map(k => '<div class="cb-sk' + (sh.saveProf.includes(k) ? ' prof1' : '') + '"><span>' + cbAbLabel(k) + '</span><b>' + sktSigned(sh.saves[k]) + '</b></div>').join('');
  const res = (rec.resources || []).filter(r => r.type === 'pool').map(r => cbEsc(r.name) + ' ' + r.max + (r.recharge === 'short' ? ' (short rest)' : r.recharge === 'short-one' ? ' (1 back on a short rest)' : '')).join(' · ');
  const todo = sktBuildTodo(b, CB.R).filter(t => !t.soft);
  return '<h3>Review</h3>'
    + (todo.length ? '<div class="cb-warn">Still to choose: ' + cbEsc(todo.map(t => t.what).join(', ')) + '</div>' : '')
    + '<div class="cb-review">'
    + '<div><h4>Saving throws</h4><div class="cb-skilltable">' + saves + '</div></div>'
    + '<div><h4>Attacks</h4><div class="cb-attacks">' + sh.attacks.map(a => '<div class="cb-atk"><b>' + cbEsc(a.name) + '</b><span>' + cbEsc(a.atkBonus) + '</span><span>' + cbEsc(a.damage) + '</span></div>').join('') + '</div>'
    + (sh.attacksPerAction > 1 ? '<div class="cb-dim">' + sh.attacksPerAction + ' attacks per Attack action</div>' : '') + '</div>'
    + '</div>'
    + (res ? '<h4>Resources</h4><div class="cb-note">' + res + '</div>' : '')
    + (sh.spellSaveDc ? '<h4>Spellcasting</h4><div class="cb-note">DC ' + sh.spellSaveDc + ' · attack ' + cbEsc(sh.spellAtkBonus) + ' · ' + cbEsc((sh.spells || []).join(', ') || 'no spells chosen') + '</div>' : '')
    + (sh.senses || (rec.resistances || []).length ? '<div class="cb-note">' + cbEsc([sh.senses, (rec.resistances || []).length ? 'Resistant to ' + rec.resistances.join(', ') : ''].filter(Boolean).join(' · ')) + '</div>' : '')
    + (sh.notes || []).map(n => '<div class="cb-dim">• ' + cbEsc(n) + '</div>').join('')
    + '<h4>Features <span class="cb-dim">' + mech + ' of ' + feats.length + ' applied to the sheet automatically</span></h4>'
    + feats.map(f => '<div class="cb-feat"><b>' + cbEsc(f.name) + '</b> <span class="cb-dim">' + cbEsc(f.from) + (f.level ? ' ' + f.level : '') + '</span> '
      + (f.mech ? '<span class="cb-badge" title="The sheet applies this one">applied</span>' : '<span class="cb-badge text" title="Shown as text; apply it at the table">text</span>')
      + cbFeatureText(f.text) + '</div>').join('');
};

// ── Events ───────────────────────────────────────────────────────────────────
function cbSet(fn){ fn(CB.build); CB.scrollTop = (document.querySelector('#cb-root .cb-main') || {}).scrollTop; cbRender(); }
function cbToggle(list, v, max){
  const i = list.indexOf(v);
  if (i >= 0){ list.splice(i, 1); return; }
  if (max == null || list.length < max) list.push(v);
}

function cbOnClick(e){
  if (!CB) return;
  const t = e.target.closest('button, [data-cb-step]'); if (!t) return;
  const d = t.dataset;
  if (d.cb === 'close') return cbAskClose();
  if (d.cbStep){ CB.step = d.cbStep; CB.scrollTop = 0; cbRender(); return; }
  const vis = cbVisibleSteps(), at = vis.findIndex(s => s.id === CB.step);
  if (d.cb === 'next'){ CB.step = vis[Math.min(vis.length - 1, at + 1)].id; CB.scrollTop = 0; cbRender(); return; }
  if (d.cb === 'back'){ CB.step = vis[Math.max(0, at - 1)].id; CB.scrollTop = 0; cbRender(); return; }
  if (d.cb === 'save') return cbSave();
  if (d.cb === 'roll') return cbSet(b => {
    const r = () => { const d4 = [sktD(6), sktD(6), sktD(6), sktD(6)].sort((x, y) => y - x); return d4[0] + d4[1] + d4[2]; };
    b.abilities.rolled = [r(), r(), r(), r(), r(), r()].sort((x, y) => y - x);
    b.abilities.assign = {}; SKT_ABS.forEach((k, i) => { b.abilities.assign[k] = i; b.abilities.base[k] = b.abilities.rolled[i]; });
  });
  if (d.cbEd && d.cbEd !== CB.build.edition) return cbSwitchEdition(d.cbEd);
  if (d.cbIcon) return cbSet(b => { b.icon = d.cbIcon; });
  if (d.cbCls) return cbSet(b => {
    if (b.cls === d.cbCls) return;
    b.cls = d.cbCls; b.subclass = ''; b.skills = []; b.expertise = []; b.cantrips = []; b.spells = [];
    b.optional = {}; b.masteries = []; b.equipment = { cls: 'A', bg: b.equipment.bg || 'A', picks: {} };
  });
  if (d.cbSub) return cbSet(b => { b.subclass = d.cbSub; });
  if (d.cbSpecies) return cbSet(b => {
    if (b.species === d.cbSpecies) return;
    b.species = d.cbSpecies; b.subspecies = ''; b.speciesAsi = {}; b.speciesSkills = []; b.speciesChoice = {};
    b.originFeat = '';
  });
  if (d.cbSubspecies) return cbSet(b => { b.subspecies = d.cbSubspecies; b.speciesAsi = {}; b.speciesSkills = []; b.originFeat = ''; });
  if (d.cbLineage) return cbSet(b => { b.speciesChoice.lineage = d.cbLineage; });
  if (d.cbBg) return cbSet(b => { if (b.background !== d.cbBg){ b.background = d.cbBg; b.bgAsi = {}; b.bgSkills = []; } });
  if (d.cbBgmode) return cbSet(b => {
    b.bgAsiMode = d.cbBgmode; b.bgAsi = {};
    if (d.cbBgmode === '111'){
      const bg = sktRulesBackground(CB.R, b.background);
      const from = bg && bg.ability && bg.ability[0] && bg.ability[0].choose && bg.ability[0].choose.weighted ? bg.ability[0].choose.weighted.from : [];
      from.forEach(k => { b.bgAsi[k] = 1; });
    }
  });
  if (d.cbMethod) return cbSet(b => {
    b.abilities.method = d.cbMethod;
    if (d.cbMethod === 'array'){ b.abilities.assign = {}; SKT_ABS.forEach((k, i) => { b.abilities.assign[k] = i; b.abilities.base[k] = SKT_STANDARD_ARRAY[i]; }); }
    if (d.cbMethod === 'pointbuy') SKT_ABS.forEach(k => { b.abilities.base[k] = 8; });
  });
  if (d.cbPb) return cbSet(b => {
    const [k, n] = d.cbPb.split(':'); const v = Math.max(8, Math.min(15, b.abilities.base[k] + +n));
    const spent = SKT_ABS.reduce((s, x) => s + SKT_POINT_BUY[x === k ? v : b.abilities.base[x]], 0);
    if (spent <= 27) b.abilities.base[k] = v;
  });
  if (d.cbHp) return cbSet(b => { b.hp = b.hp || { rolls: {} }; b.hp.method = d.cbHp; b.hp.rolls = b.hp.rolls || {}; });
  if (d.cbHpdice) return cbSet(b => {
    const cls = sktRulesClass(CB.R, b.cls); b.hp.rolls[d.cbHpdice] = sktD(cls.hd);
  });
  if (d.cbFchoice) return cbSet(b => {
    const [feat, val] = d.cbFchoice.split('||');
    b.featureChoices = b.featureChoices || {};
    b.featureChoices[feat] = val;
  });
  if (d.cbAsitype) return cbSet(b => {
    const [l, type] = d.cbAsitype.split(':');
    b.asi[l] = type === 'asi' ? { type: 'asi', inc: {} } : { type: 'feat', feat: '' };
  });
}

function cbOnChange(e){
  if (!CB) return;
  const t = e.target, d = t.dataset;
  const v = t.value;
  const list = (key, max) => cbSet(b => { b[key] = b[key] || []; cbToggle(b[key], Object.values(d)[0], max); });
  if ('cbAllbooks' in d){ CB.allBooks = t.checked; cbRender(); return; }
  if (d.cbSkill){ const cls = sktRulesClass(CB.R, CB.build.cls); return cbSet(b => cbToggle(b.skills, d.cbSkill, cls.skillChoice.count)); }
  if (d.cbExpert) return cbSet(b => cbToggle(b.expertise, d.cbExpert, cbExpertiseCount()));
  if (d.cbLang) return cbSet(b => cbToggle(b.languages, d.cbLang, cbLanguageCount()));
  if (d.cbSpskill){
    const sp = sktRulesSpecies(CB.R, CB.build.species), sub = sp && sp.subraces.find(s => s.name === CB.build.subspecies);
    const ch = cbSpeciesSkillChoice(sp, sub);
    return cbSet(b => cbToggle(b.speciesSkills, d.cbSpskill, ch ? ch.count : 1));
  }
  if (d.cbSpasi){
    const sp = sktRulesSpecies(CB.R, CB.build.species), sub = sp && sp.subraces.find(s => s.name === CB.build.subspecies);
    const ch = cbSpeciesAsiChoice(sp, sub);
    return cbSet(b => {
      if (b.speciesAsi[d.cbSpasi]) delete b.speciesAsi[d.cbSpasi];
      else if (Object.keys(b.speciesAsi).length < ch.count) b.speciesAsi[d.cbSpasi] = ch.amount;
    });
  }
  if (d.cbCantrip){ const sc = sktBuildSpellcasting(CB.build, CB.R, sktBuildAbilities(CB.build, CB.R)); return cbSet(b => cbToggle(b.cantrips, d.cbCantrip, sc.cantrips)); }
  if (d.cbSpell){
    const sc = sktBuildSpellcasting(CB.build, CB.R, sktBuildAbilities(CB.build, CB.R));
    return cbSet(b => cbToggle(b.spells, d.cbSpell, sc.prepared || sc.known));
  }
  if (d.cbMastery) return cbSet(b => cbToggle(b.masteries, d.cbMastery, cbMasteryCount()));
  const optKey = Object.keys(d).find(k => /^cbOpt/.test(k));
  if (optKey){
    const o = sktOptionalChoices(CB.build, CB.R).find(x => 'cbOpt' + cbSlug(x.name).replace(/-(\w)/g, (_, c) => c.toUpperCase()).replace(/^\w/, c => c.toUpperCase()) === optKey);
    if (o) return cbSet(b => { b.optional[o.name] = b.optional[o.name] || []; cbToggle(b.optional[o.name], d[optKey], o.count); });
  }
  if ('cbOriginfeat' in d) return cbSet(b => { b.originFeat = v; });
  if (d.cbBg2 !== undefined || d.cbBg1 !== undefined){
    return cbSet(b => {
      const keep = {};
      const two = d.cbBg2 !== undefined ? v : Object.keys(b.bgAsi).find(k => b.bgAsi[k] === 2);
      const one = d.cbBg1 !== undefined ? v : Object.keys(b.bgAsi).find(k => b.bgAsi[k] === 1);
      if (two) keep[two] = 2; if (one && one !== two) keep[one] = 1;
      b.bgAsi = keep;
    });
  }
  if (d.cbAssign){
    return cbSet(b => {
      const pool = b.abilities.method === 'array' ? SKT_STANDARD_ARRAY : (b.abilities.rolled || []);
      const a = b.abilities.assign = b.abilities.assign || {};
      const want = +v, k = d.cbAssign;
      // Each value is used once: swap with whoever had it.
      const other = SKT_ABS.find(x => x !== k && a[x] === want);
      if (other != null) a[other] = a[k];
      a[k] = want;
      SKT_ABS.forEach(x => { if (a[x] != null) b.abilities.base[x] = pool[a[x]]; });
    });
  }
  if (d.cbScore) return cbSet(b => { b.abilities.base[d.cbScore] = Math.max(3, Math.min(20, parseInt(v, 10) || 10)); });
  if (d.cbHproll) return cbSet(b => { b.hp.rolls[d.cbHproll] = parseInt(v, 10) || ''; });
  if (d.cbAsiab){
    return cbSet(b => {
      const [l, slot] = d.cbAsiab.split(':');
      const p = b.asi[l] = b.asi[l] && b.asi[l].type === 'asi' ? b.asi[l] : { type: 'asi', inc: {} };
      const picks = [];
      Object.keys(p.inc).forEach(k => { for (let n = 0; n < p.inc[k]; n++) picks.push(k); });
      picks[+slot] = v || undefined;
      p.inc = {};
      picks.filter(Boolean).forEach(k => { p.inc[k] = (p.inc[k] || 0) + 1; });
    });
  }
  if (d.cbAsifeat) return cbSet(b => { b.asi[d.cbAsifeat] = { type: 'feat', feat: v }; });
  if (d.cbFeatab){
    const [name, amount] = d.cbFeatab.split(':');
    return cbSet(b => { b.featChoices[name] = Object.assign({}, b.featChoices[name], { inc: v ? { [v]: +amount || 1 } : {} }); });
  }
  if (d.cbFeatsave) return cbSet(b => { b.featChoices[d.cbFeatsave] = Object.assign({}, b.featChoices[d.cbFeatsave], { save: v }); });
  if (d.cbEq){
    const [kind, i, letter] = d.cbEq.split(':');
    return cbSet(b => {
      if (CB.R.edition === '2024') b.equipment[kind] = letter;
      else { const k = kind + 'Blocks'; b.equipment[k] = b.equipment[k] || []; b.equipment[k][+i] = letter; }
    });
  }
  if (d.cbEqpick) return cbSet(b => { b.equipment.picks = b.equipment.picks || {}; b.equipment.picks[d.cbEqpick] = v; });
}

// Typing in the name or level box: update without a full re-render, so the
// field keeps focus and the caret stays where it is.
function cbOnInput(e){
  if (!CB) return;
  const t = e.target, d = t.dataset;
  if (d.cbIn === 'name'){ CB.build.name = t.value; cbRefreshSide(); return; }
  if (d.cbIn === 'level'){
    const n = Math.max(1, Math.min(20, parseInt(t.value, 10) || 1));
    CB.build.level = n; cbRefreshSide(); cbRefreshSteps();
  }
}
function cbRefreshSide(){
  const side = document.querySelector('#cb-root .cb-side'); if (!side || !CB || !CB.R) return;
  CB.rec = sktComputeCharacter(CB.build, CB.R, CB.idx != null ? state.party[CB.idx] : null);
  side.innerHTML = cbSide(CB.rec);
}
function cbRefreshSteps(){
  const nav = document.querySelector('#cb-root .cb-steps'); if (!nav) return;
  const tmp = document.createElement('div'); tmp.innerHTML = cbShell('', '');
  const fresh = tmp.querySelector('.cb-steps'); if (fresh) nav.innerHTML = fresh.innerHTML;
}

async function cbSwitchEdition(ed){
  const keep = { name: CB.build.name, level: CB.build.level, icon: CB.build.icon };
  CB.build = Object.assign(sktBlankBuild(ed), keep);
  if (state.settings){ state.settings.builderEdition = ed; save(); }
  await cbLoad(ed);
}

// ── Saving ───────────────────────────────────────────────────────────────────
function cbSave(){
  if (!CB || !CB.R) return;
  const todo = sktBuildTodo(CB.build, CB.R).filter(t => !t.soft);
  const go = () => {
    const prior = CB.idx != null ? state.party[CB.idx] : null;
    const rec = sktComputeCharacter(CB.build, CB.R, prior);
    const label = CB.mode === 'create' ? 'Created ' + rec.name : CB.mode === 'levelup' ? rec.name + ' is now level ' + rec.level : 'Saved ' + rec.name;
    let idx = CB.idx;
    const apply = () => {
      if (prior){
        // Keep everything the builder does not own: conditions, notes,
        // death saves, a portrait, which combatant it is.
        state.party[idx] = Object.assign({}, prior, rec, { id: prior.id, portrait: prior.portrait });
      } else {
        rec.id = (typeof uid === 'function') ? uid() : 'pc_' + Date.now().toString(36);
        state.party.push(rec); idx = state.party.length - 1;
      }
      save();
    };
    if (typeof sktUndoable === 'function') sktUndoable(label, apply); else apply();
    if (typeof syncPartyToCombat === 'function') { try { syncPartyToCombat(idx); } catch(e){} }
    try { panelDefs.party && panelDefs.party._render && panelDefs.party._render(); } catch(e){}
    const done = CB.onDone; const saved = state.party[idx];
    cbClose();
    if (typeof done === 'function') done(saved, idx);
  };
  if (todo.length && typeof showConfirm === 'function'){
    showConfirm('Still to choose: ' + todo.map(t => t.what).join(', ') + '. Save anyway? You can finish it later from the party card.',
                { title: 'Not finished', confirmLabel: 'Save anyway' }).then(ok => { if (ok) go(); });
  } else go();
}
