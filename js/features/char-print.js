// ============================================================
// CHARACTER SHEET — on paper, and as text
// ============================================================
// csPrintSheet(pc): the sheet laid out for paper (or a PDF from the print
// dialog), the way a printed D&D sheet is: page one has everything a turn
// needs, with boxes to keep hit points, hit dice, death saves, spell slots
// and limited uses in pencil; then every feature's text, the spells with
// theirs, and the equipment and background. Nothing on it is a button.
// csCharacterText(pc): the same character as plain text, to paste into a
// chat or a note.

const CP_AB = [['str', 'Strength'], ['dex', 'Dexterity'], ['con', 'Constitution'], ['int', 'Intelligence'], ['wis', 'Wisdom'], ['cha', 'Charisma']];
const CP_FROM = [['class', 'Class features'], ['subclass', 'Subclass features'], ['species', 'Species traits'], ['background', 'Background'], ['feat', 'Feats'], ['optional', 'Options']];
const CP_ORD = ['Cantrips', '1st level', '2nd level', '3rd level', '4th level', '5th level', '6th level', '7th level', '8th level', '9th level'];

// Empty squares to tick in pencil; past twenty, a line to write on.
function cpBoxes(n){
  n = Math.max(0, +n || 0);
  if (n > 20) return '<span class="cp-line"></span> / ' + n;
  return '<span class="cp-boxes">' + '<i class="cp-box"></i>'.repeat(n) + '</span>';
}
function cpText(s){ return csE(String(s || '')).replace(/\n/g, '<br>'); }
// "Barbarian 6 · Totem Warrior", "Fighter 3 / Wizard 2".
function cpClassLevel(pc){
  const sh = pc.sheet || {}, cl = Array.isArray(sh.classLevels) && sh.classLevels.length ? sh.classLevels : [{ cls: pc.cls || sh.class || '', level: pc.level, subclass: pc.subclass }];
  const subs = cl.map(p => p.subclass).filter(Boolean);
  return cl.map(p => _csTitle(p.cls) + ' ' + (p.level || '')).join(' / ') + (subs.length ? ' · ' + subs.join(', ') : '');
}
function cpRecharge(r){
  return { short: 'short rest', long: 'long rest', 'short-one': 'one back on a short rest', dawn: 'dawn', turn: 'each turn' }[r.recharge] || '';
}
function cpSaveOf(pc, k){
  const sh = pc.sheet || {}, pb = sh.profBonus || 2;
  return sh.saves && sh.saves[k] != null ? sh.saves[k] : csMod((pc.abilities || {})[k]) + ((sh.saveProf || []).includes(k) ? pb : 0);
}
function cpSkillOf(pc, k){
  const sh = pc.sheet || {};
  return sh.skills && sh.skills[k] != null ? sh.skills[k] : csMod((pc.abilities || {})[CS_SKILLS[k][1]]);
}
// What gives advantage, in words, for the side column ("Initiative: Feral
// Instinct").
function cpAdvLines(pc){
  const WHAT = { init: 'Initiative', 'attack:str': 'Strength attacks', 'attack:spell': 'spell attacks', conc: 'concentration saves', death: 'death saves' };
  return ((pc.sheet || {}).rollAdv || []).map(x => 'Advantage on ' + (x.on || []).map(t => WHAT[t] || (/^save:/.test(t) ? CS_AB[t.slice(5)] + ' saves' : /^skill:/.test(t) ? (CS_SKILLS[t.slice(6)] || [t])[0] : t)).join(', ') + ' (' + x.label + ')');
}

function csPrintSheet(pc){
  const sh = pc.sheet || {}, ab = pc.abilities || {}, pb = sh.profBonus || 2;
  const d = sh.details || (pc.build && pc.build.details) || {};
  const field = (label, value) => '<div class="cp-field"><b>' + csE(value || '') + '</b><small>' + label + '</small></div>';

  // ── Page one ──
  let h = '<section class="cp-page cp-p1"><header class="cp-head">'
    + '<div class="cp-name">' + field('Character name', pc.name) + '</div>'
    + '<div class="cp-meta">' + field('Class & level', cpClassLevel(pc))
    + field('Species', pc.race || sh.race || '') + field('Background', pc.background || (pc.build && pc.build.background) || '')
    + field('Alignment', d.alignment || '') + (pc.build && pc.build.advancement === 'xp' ? field('Experience', (+pc.xp || 0).toLocaleString()) : field('Size', sh.size || ''))
    + '</div></header><div class="cp-cols">';

  // Column one: abilities, saves, skills.
  h += '<div class="cp-col cp-c1"><div class="cp-abs">' + CP_AB.map(([k, l]) => '<div class="cp-ab"><small>' + l + '</small><b>' + csSigned(csMod(ab[k])) + '</b><span>' + (ab[k] ?? '—') + '</span></div>').join('') + '</div>'
    + '<div class="cp-mini"><div><b>' + csSigned(pb) + '</b><small>Proficiency bonus</small></div><div><i class="cp-box"></i><small>Heroic inspiration</small></div></div>'
    + '<div class="cp-block"><h3>Saving throws</h3>' + CP_AB.map(([k, l]) => '<div class="cp-row"><i class="cp-dot' + ((sh.saveProf || []).includes(k) ? ' on' : '') + '"></i><span>' + l + '</span><b>' + csSigned(cpSaveOf(pc, k)) + '</b></div>').join('') + '</div>'
    + '<div class="cp-block"><h3>Skills</h3>' + Object.keys(CS_SKILLS).map(k => {
      const p = (sh.skillProf || {})[k] || 0;
      return '<div class="cp-row"><i class="cp-dot' + (p >= 2 ? ' exp' : p ? ' on' : '') + '"></i><span>' + CS_SKILLS[k][0] + ' <small>' + CS_SKILLS[k][1].toUpperCase() + '</small></span><b>' + csSigned(cpSkillOf(pc, k)) + '</b></div>';
    }).join('') + '<div class="cp-key"><i class="cp-dot on"></i> proficient <i class="cp-dot exp"></i> expertise</div></div></div>';

  // Column two: the fight.
  const stats = [['Armor class', pc.ac ?? '—'], ['Initiative', csSigned(pc.init ?? csMod(ab.dex))], ['Speed', (pc.spd ?? 30) + ' ft']];
  h += '<div class="cp-col cp-c2"><div class="cp-stats">' + stats.map(([l, v]) => '<div class="cp-stat"><small>' + l + '</small><b>' + csE(v) + '</b></div>').join('') + '</div>'
    + '<div class="cp-hp"><div class="cp-hpmax">Hit point maximum <b>' + (pc.hpMax || 0) + '</b></div>'
    + '<div class="cp-hpbox"><small>Current hit points</small></div><div class="cp-hprow"><div class="cp-hpbox sm"><small>Temporary</small></div>'
    + '<div class="cp-hpbox sm"><small>Hit dice — ' + csE(sh.hitDiceByClass || ((pc.hitDice || {}).max || pc.level || 1) + ((pc.hitDice || {}).dieType || '')) + '</small><div class="cp-spent">spent ' + cpBoxes((pc.hitDice || {}).max || pc.level || 1) + '</div></div>'
    + '<div class="cp-hpbox sm"><small>Death saves</small><div class="cp-ds">success <i class="cp-ring"></i><i class="cp-ring"></i><i class="cp-ring"></i></div><div class="cp-ds">failure <i class="cp-ring"></i><i class="cp-ring"></i><i class="cp-ring"></i></div></div></div></div>';
  const atks = (sh.attacks || []).filter(a => a && a.name);
  h += '<div class="cp-block"><h3>Attacks &amp; Actions' + (sh.attacksPerAction > 1 ? ' <small>' + sh.attacksPerAction + ' attacks per Attack action</small>' : '') + '</h3>'
    + (atks.length ? '<table class="cp-tbl"><tr><th>Name</th><th>Hit / DC</th><th>Damage</th><th>Notes</th></tr>'
      + atks.map(a => '<tr><td><b>' + csE(a.name) + '</b></td><td>' + csE(a.atkBonus || '') + '</td><td>' + csE(a.damage || '') + (a.versatile ? '<br><small>two hands ' + csE(a.versatile) + '</small>' : '') + '</td><td>'
        + csE([a.mastery ? 'Mastery: ' + a.mastery : '', a.range ? a.range + ' ft' : ''].filter(Boolean).join(' · ')) + '</td></tr>').join('') + '</table>' : '<div class="cp-dim">None.</div>');
  const acts = sh.activations || [];
  if (acts.length) h += acts.map(a => '<div class="cp-act"><b>' + csE(a.name) + '</b> <small>' + csE([a.action, a.resource ? (a.amount || 1) + ' ' + a.resource : ''].filter(Boolean).join(' · ')) + '</small>'
    + (a.desc ? '<div>' + csE(a.desc) + '</div>' : '') + '</div>').join('');
  h += '</div>';
  const res = (pc.resources || []).filter(r => r && r.name && r.type !== 'toggle' && (+r.max || 0) > 0);
  if (res.length) h += '<div class="cp-block"><h3>Limited use</h3>' + res.map(r => '<div class="cp-res"><span>' + csE(r.name) + (r.die ? ' <small>' + csE(r.die) + '</small>' : '') + '</span>' + cpBoxes(r.max)
    + '<small>' + csE(cpRecharge(r)) + '</small></div>').join('') + '</div>';
  h += '</div>';

  // Column three: senses, defences, proficiencies, who they are.
  const pas = k => 10 + cpSkillOf(pc, k);
  const pr = sh.proficiencies || {};
  const line = (l, v) => v && v.length ? '<div class="cp-kv"><b>' + l + '</b> ' + csE(Array.isArray(v) ? v.map(_csTitle).join(', ') : v) + '</div>' : '';
  h += '<div class="cp-col cp-c3"><div class="cp-block"><h3>Senses</h3>'
    + '<div class="cp-row"><span>Passive Perception</span><b>' + (sh.passivePerception || pas('perception')) + '</b></div>'
    + '<div class="cp-row"><span>Passive Investigation</span><b>' + pas('investigation') + '</b></div>'
    + '<div class="cp-row"><span>Passive Insight</span><b>' + pas('insight') + '</b></div>'
    + (sh.senses ? '<div class="cp-kv">' + csE(sh.senses) + '</div>' : '') + '</div>';
  const def = [['Resistant', pc.resistances], ['Immune', pc.immunities], ['Vulnerable', pc.vulnerabilities]].filter(([, v]) => v && v.length);
  const adv = cpAdvLines(pc), mods = sh.saveMods || [];
  if (def.length || adv.length || mods.length) h += '<div class="cp-block"><h3>Defenses &amp; advantages</h3>' + def.map(([l, v]) => line(l, v)).join('')
    + adv.map(t => '<div class="cp-kv">' + csE(t) + '</div>').join('') + mods.map(m => '<div class="cp-kv">' + csE(m.text) + ' (' + csE(m.src) + ')</div>').join('') + '</div>';
  h += '<div class="cp-block"><h3>Proficiencies &amp; languages</h3>' + line('Armor', pr.armor) + line('Weapons', pr.weapons) + line('Tools', pr.tools) + line('Languages', sh.languages) + '</div>';
  [['personality', 'Personality traits'], ['ideals', 'Ideals'], ['bonds', 'Bonds'], ['flaws', 'Flaws']].forEach(([k, l]) => {
    h += '<div class="cp-block cp-write"><h3>' + l + '</h3>' + (d[k] ? '<div>' + cpText(d[k]) + '</div>' : '<div class="cp-lines"></div>') + '</div>';
  });
  h += '<div class="cp-block cp-write"><h3>Conditions &amp; notes</h3><div class="cp-lines"></div></div></div></div></section>';

  // ── Features, every one with its text ──
  const list = (sh.featureList || []).filter(f => !f.info);
  if (list.length || (sh.notes || []).length){
    h += '<section class="cp-page"><h2>Features &amp; Traits</h2><div class="cp-flow">'
      + ((sh.notes || []).length ? '<div class="cp-feat"><h4>Always in effect</h4>' + sh.notes.map(n => '<div>' + csE(n) + '</div>').join('') + '</div>' : '');
    CP_FROM.forEach(([k, l]) => {
      const fs = list.filter(f => f.from === k); if (!fs.length) return;
      h += '<h3 class="cp-group">' + l + '</h3>' + fs.map(f => {
        const r = (pc.resources || []).find(x => x.name === f.name && x.type !== 'toggle');
        return '<div class="cp-feat"><h4>' + csE(f.name) + (f.level ? ' <small>' + (k === 'class' || k === 'subclass' ? 'level ' + f.level : '') + '</small>' : '')
          + (r ? ' ' + cpBoxes(r.max) : '') + '</h4>' + (f.text ? '<div>' + cpText(f.text) + '</div>' : '') + '</div>';
      }).join('');
    });
    h += '</div></section>';
  }

  // ── Spells ──
  const names = sh.spells || [];
  if (names.length || sh.spellSaveDc){
    const always = new Set(sh.alwaysPrepared || []);
    const slots = sh.spellSlots || {};
    h += '<section class="cp-page"><h2>Spellcasting</h2><div class="cp-stats cp-spellhead">'
      + [['Ability', (sh.spellAbility || '').toUpperCase() || '—'], ['Save DC', sh.spellSaveDc ?? '—'], ['Spell attack', sh.spellAtkBonus ?? '—']].map(([l, v]) => '<div class="cp-stat"><small>' + l + '</small><b>' + csE(v) + '</b></div>').join('')
      + '<div class="cp-slots">' + (Object.keys(slots).length ? Object.keys(slots).map(l => '<div class="cp-res"><span>' + CP_ORD[+l] + (slots[l].pact ? ' <small>pact</small>' : '') + '</span>' + cpBoxes(slots[l].total) + '</div>').join('') : '<div class="cp-dim">No spell slots.</div>') + '</div></div>';
    const byLv = {};
    names.forEach(n => { const s = csSpell(n); const lv = s ? +s.level || 0 : 0; (byLv[lv] = byLv[lv] || []).push({ n, s }); });
    h += '<div class="cp-flow">' + Object.keys(byLv).map(Number).sort((a, b) => a - b).map(lv => '<h3 class="cp-group">' + CP_ORD[lv] + '</h3>'
      + byLv[lv].sort((a, b) => a.n.localeCompare(b.n)).map(({ n, s }) => {
        const tags = [s && s.concentration ? 'concentration' : '', s && s.ritual ? 'ritual' : '', always.has(n) ? 'always prepared' : ''].filter(Boolean).join(', ');
        const text = s ? (s.custom ? (s.entries || []).join('\n') : typeof sktRulesText === 'function' ? sktRulesText([].concat(s.entries || [], s.higher || s.entriesHigherLevel || [])) : '') : '';
        return '<div class="cp-feat cp-spell"><h4>' + csE(n) + (tags ? ' <small>' + csE(tags) + '</small>' : '') + '</h4>'
          + (s ? '<div class="cp-meta-line">' + csE(csSpellMeta(s)) + '</div>' : '') + (text ? '<div>' + cpText(text) + '</div>' : '') + '</div>';
      }).join('')).join('') + '</div>';
    const book = (sh.spellbook || []).filter(n => !names.includes(n));
    if (book.length) h += '<div class="cp-block"><h3>Also in the spellbook</h3><div>' + csE(book.join(', ')) + '</div></div>';
    h += '</section>';
  }

  // ── Equipment, background, notes, companions ──
  const items = csItems(pc), coins = csCoins(pc);
  const lb = items.reduce((n, m) => n + csItemWeight(items, m), 0);
  // Only a weapon, armour or a shield is "equipped" (not a set of tools).
  const wearable = m => { const st = m.stats || (m.base && CS.R && CS.R.items[m.base]); return !!st && /^(M|R|LA|MA|HA|S)(\||$)/.test(String(st.type)); };
  h += '<section class="cp-page cp-last"><h2>Equipment</h2><div class="cp-coins">' + CS_COINS.map(([k]) => '<div class="cp-stat"><small>' + k.toUpperCase() + '</small><b>' + (coins[k] || 0) + '</b></div>').join('') + '</div>'
    + (items.length ? '<table class="cp-tbl"><tr><th>Qty</th><th>Item</th><th>Weight</th><th>Notes</th></tr>' + items.map(m => '<tr><td>' + (m.qty || 1) + '</td><td><b>' + csE(m.name) + '</b></td><td>'
      + (csItemWeight(items, m) ? Math.round(csItemWeight(items, m) * 10) / 10 + ' lb' : '') + '</td><td>'
      + csE([m.equipped !== false && wearable(m) ? 'equipped' : '', m.reqAttune ? (m.attuned ? 'attuned' : 'not attuned') : '', m.in ? 'in ' + m.in : ''].filter(Boolean).join(' · '))
      + (+m.charges > 0 ? ' charges ' + cpBoxes(m.charges) : '') + '</td></tr>').join('') + '</table>' : '<div class="cp-dim">Nothing carried.</div>')
    + '<div class="cp-kv">Carrying <b>' + Math.round(lb * 10) / 10 + ' lb</b> of ' + ((ab.str || 10) * 15) + ' lb</div>';
  const facts = [['Size', sh.size], ['Gender', d.gender], ['Age', d.age], ['Height', d.height], ['Weight', d.weight], ['Eyes', d.eyes], ['Hair', d.hair], ['Skin', d.skin], ['Faith', d.faith], ['Lifestyle', d.lifestyle]].filter(([, v]) => v);
  h += '<h2>Background' + (pc.background ? ' — ' + csE(pc.background) : '') + '</h2>'
    + (facts.length ? '<div class="cp-facts">' + facts.map(([l, v]) => '<div class="cp-kv"><b>' + l + '</b> ' + csE(v) + '</div>').join('') + '</div>' : '');
  [['appearance', 'Appearance'], ['allies', 'Allies & organizations'], ['enemies', 'Enemies'], ['backstory', 'Backstory']].forEach(([k, l]) => {
    if (d[k]) h += '<div class="cp-block"><h3>' + l + '</h3><div>' + cpText(d[k]) + '</div></div>';
  });
  if (pc.playerNotes) h += '<div class="cp-block"><h3>Notes</h3><div>' + cpText(pc.playerNotes) + '</div></div>';
  const ex = pc.extras || [];
  if (ex.length) h += '<div class="cp-block"><h3>Companions</h3><table class="cp-tbl"><tr><th>Name</th><th>AC</th><th>HP max</th><th>Current HP</th></tr>'
    + ex.map(x => '<tr><td><b>' + csE(x.name) + '</b></td><td>' + csE(x.ac ?? '') + '</td><td>' + csE(x.hpMax ?? '') + '</td><td><span class="cp-line"></span></td></tr>').join('') + '</table></div>';
  return h + '</section>';
}

// The character as plain text: the numbers a table asks for, then the
// lists. For a chat, a note or an email.
function csCharacterText(pc){
  const sh = pc.sheet || {}, ab = pc.abilities || {};
  const out = [pc.name + ' — ' + csClassLine(pc)];
  out.push(['AC ' + (pc.ac ?? '—'), 'HP ' + (pc.hpMax || 0), 'Speed ' + (pc.spd ?? 30) + ' ft', 'Initiative ' + csSigned(pc.init ?? csMod(ab.dex)), 'Proficiency ' + csSigned(sh.profBonus || 2)].join(' · '));
  out.push(CP_AB.map(([k]) => k.toUpperCase() + ' ' + (ab[k] ?? '—') + ' (' + csSigned(csMod(ab[k])) + ')').join('  '));
  out.push('Saving throws: ' + CP_AB.map(([k, l]) => l.slice(0, 3) + ' ' + csSigned(cpSaveOf(pc, k)) + ((sh.saveProf || []).includes(k) ? '*' : '')).join(', ') + '  (* proficient)');
  const sk = Object.keys(CS_SKILLS).filter(k => (sh.skillProf || {})[k]);
  if (sk.length) out.push('Skills: ' + sk.map(k => CS_SKILLS[k][0] + ' ' + csSigned(cpSkillOf(pc, k)) + ((sh.skillProf || {})[k] >= 2 ? ' (expertise)' : '')).join(', '));
  out.push('Passive Perception ' + (sh.passivePerception || 10 + cpSkillOf(pc, 'perception')) + (sh.senses ? ' · ' + sh.senses : ''));
  const def = [['Resistant', pc.resistances], ['Immune', pc.immunities], ['Vulnerable', pc.vulnerabilities]].filter(([, v]) => v && v.length);
  if (def.length) out.push(def.map(([l, v]) => l + ': ' + v.join(', ')).join(' · '));
  if (sh.languages) out.push('Languages: ' + sh.languages);
  const atks = (sh.attacks || []).filter(a => a && a.name);
  if (atks.length){ out.push(''); out.push('Attacks'); atks.forEach(a => out.push('- ' + a.name + ': ' + (a.atkBonus || '') + (a.damage ? ', ' + a.damage : ''))); }
  const names = sh.spells || [];
  if (names.length){
    out.push(''); out.push('Spells' + (sh.spellSaveDc ? ' (save DC ' + sh.spellSaveDc + ', attack ' + sh.spellAtkBonus + ')' : ''));
    const byLv = {};
    names.forEach(n => { const s = csSpell(n); const lv = s ? +s.level || 0 : 0; (byLv[lv] = byLv[lv] || []).push(n); });
    Object.keys(byLv).map(Number).sort((a, b) => a - b).forEach(lv => {
      const sl = (sh.spellSlots || {})[lv];
      out.push('- ' + CP_ORD[lv] + (sl ? ' (' + sl.total + ' slots)' : '') + ': ' + byLv[lv].sort().join(', '));
    });
  }
  const feats = (sh.featureList || []).filter(f => !f.info).map(f => f.name);
  if (feats.length){ out.push(''); out.push('Features: ' + feats.join(', ')); }
  const items = csItems(pc);
  if (items.length){ out.push(''); out.push('Equipment: ' + items.map(m => m.name + ((m.qty || 1) > 1 ? ' ×' + m.qty : '')).join(', ')); }
  const coins = csCoins(pc);
  const purse = CS_COINS.map(([k]) => (coins[k] || 0) + ' ' + k).filter(s => !/^0 /.test(s)).join(', ');
  out.push('Coins: ' + (purse || 'none'));
  return out.join('\n');
}

// ── Spell and item cards ─────────────────────────────────────────────────────
// Playing-card size (2.5 × 3.5 in), nine to a page with cut lines, for the
// table: a spell's casting time, range, components and duration across the
// top, its text below, the character's save DC and attack bonus at the foot;
// a magic item's rarity, attunement and charges to tick. Each card's text is
// set as large as fits (measured, cpLayCards); text too long even at the
// smallest size carries on to a second card, marked "continued".
const CP_SCHOOL = { A: 'abjuration', C: 'conjuration', D: 'divination', E: 'enchantment', V: 'evocation', I: 'illusion', N: 'necromancy', T: 'transmutation' };
const CP_SIZES = [10, 9.5, 9, 8.5, 8, 7.5, 7, 6.5, 6];   // px, largest first
function cpLevelLine(s){
  const school = (CP_SCHOOL[s.school] || String(s.school || '')).toLowerCase();
  const lv = +s.level || 0;
  const tags = [s.concentration ? 'concentration' : '', s.ritual ? 'ritual' : ''].filter(Boolean);
  return (lv ? CP_ORD[lv] + (school ? ' ' + school : '') : (school ? _csTitle(school) + ' cantrip' : 'Cantrip')) + (tags.length ? ' · ' + tags.join(', ') : '');
}
// A spell's four boxes and its material component, in words.
function cpSpellFacts(s){
  const t = [].concat(s.time || [])[0], r = s.range || {}, du = [].concat(s.duration || [])[0] || {}, c = s.components || {};
  const time = t ? t.number + ' ' + String(t.unit).replace('bonus', 'bonus action') + (t.number > 1 ? 's' : '') : '—';
  const range = r.type === 'point' && r.distance ? (r.distance.amount ? r.distance.amount + ' ' + r.distance.type : _csTitle(r.distance.type))
    : r.type && r.distance ? (r.distance.amount || '') + '-' + String(r.distance.type).replace(/s$/, '') + ' ' + r.type : r.type ? _csTitle(r.type) : '—';
  const dur = du.type === 'timed' && du.duration ? (du.concentration ? 'Up to ' : '') + du.duration.amount + ' ' + du.duration.type + (du.duration.amount > 1 ? 's' : '')
    : du.type === 'instant' ? 'Instantaneous' : du.type === 'permanent' ? 'Until dispelled' : _csTitle(du.type || '—');
  const comp = [c.v ? 'V' : '', c.s ? 'S' : '', c.m ? 'M' : ''].filter(Boolean).join(', ') || '—';
  const mat = c.m ? (typeof c.m === 'string' ? c.m : c.m.text || '') : '';
  return { time, range, comp, dur, mat };
}
// Where to cut text in two for a second card: a paragraph or sentence end
// near the middle.
function cpHalve(text){
  const t = String(text || ''), mid = Math.floor(t.length / 2);
  const near = (i, j) => (i < 0 ? j : j < 0 ? i : Math.abs(i - mid) <= Math.abs(j - mid) ? i : j);
  let cut = near(t.lastIndexOf('\n', mid), t.indexOf('\n', mid));
  if (cut < t.length * 0.3 || cut > t.length * 0.7) cut = near(t.lastIndexOf('. ', mid) + 1, t.indexOf('. ', mid) + 1);
  if (cut <= 0 || cut >= t.length) cut = t.lastIndexOf(' ', mid) > 0 ? t.lastIndexOf(' ', mid) : mid;
  return [t.slice(0, cut).trim(), t.slice(cut).trim()];
}
function cpCardHtml(c){
  return '<div class="cpc cpc-' + c.kind + '"><div class="cpc-h"><b>' + csE(c.title) + (c.cont ? ' <small>(continued)</small>' : '') + '</b>' + (c.sub ? '<small>' + csE(c.sub) + '</small>' : '') + '</div>'
    + (c.facts || '') + '<div class="cpc-body"' + (c.size ? ' style="font-size:' + c.size + 'px"' : '') + '>' + cpText(c.body) + '</div><div class="cpc-foot">' + csE(c.foot) + '</div></div>';
}
// Measure each card at the print size, off screen: the largest text size
// whose text fits; failing even the smallest, split it and try both halves.
function cpLayCards(cards){
  const host = document.createElement('div');
  host.className = 'cpc-measure'; document.body.appendChild(host);
  const out = [];
  try {
    const queue = cards.slice();
    while (queue.length){
      const c = queue.shift();
      host.innerHTML = cpCardHtml(c);
      const body = host.querySelector('.cpc-body');
      let fit = 0;
      for (const px of CP_SIZES){ body.style.fontSize = px + 'px'; if (body.scrollHeight <= body.clientHeight + 1){ fit = px; break; } }
      if (fit || String(c.body).length < 80){ out.push(Object.assign({}, c, { size: fit || CP_SIZES[CP_SIZES.length - 1] })); continue; }
      const [one, two] = cpHalve(c.body);
      queue.unshift(Object.assign({}, c, { body: one }), Object.assign({}, c, { body: two, cont: true, sub: '', facts: '' }));
    }
  } finally { host.remove(); }
  return out;
}
function cpSpellCards(pc, name){
  const s = csSpell(name); if (!s) return [];
  const f = cpSpellFacts(s), sh = pc.sheet || {};
  const text = s.custom ? (s.entries || []).join('\n') : typeof sktRulesText === 'function' ? sktRulesText([].concat(s.entries || [])) : '';
  const higher = s.custom ? '' : typeof sktRulesText === 'function' ? sktRulesText([].concat(s.higher || s.entriesHigherLevel || [])) : '';
  const full = (f.mat ? '(' + f.mat + ')\n' : '') + text + (higher ? '\n' + higher : '');
  const facts = '<div class="cpc-facts">' + [['Casting time', f.time], ['Range', f.range], ['Components', f.comp], ['Duration', f.dur]].map(([l, v]) => '<div><small>' + l + '</small>' + csE(v) + '</div>').join('') + '</div>';
  const atk = sh.spellAtkBonus;
  const foot = pc.name + (sh.spellSaveDc ? ' · save DC ' + sh.spellSaveDc + (atk != null && atk !== '' ? ' · ' + (/^[+-]/.test(String(atk)) ? atk : csSigned(atk)) + ' to hit' : '') : '');
  return [{ kind: 'spell', title: s.name, sub: cpLevelLine(s), facts, body: full, foot }];
}
// The text of a carried item, plain: the magic item list, the rules' item,
// or the search data.
function cpItemInfo(m){
  const n = String(m.name || '').toLowerCase();
  const named = (CS.magic || []).find(x => String(x.name).toLowerCase() === n);
  const bi = m.base && CS.R && CS.R.items ? CS.R.items[m.base] : null;
  const d = typeof _5eData !== 'undefined' && Array.isArray(_5eData) ? _5eData.find(x => x.cat === 'item' && String(x.name).toLowerCase() === n) : null;
  const raw = (d && d._raw) || {};
  const rarity = m.rarity || (named && named.rarity) || raw.rarity || '';
  const attune = m.reqAttune || (named && named.reqAttune) || raw.reqAttune;
  const text = (named && named.text) || (m.custom && m.text) || (bi && bi.entries && typeof sktRulesText === 'function' ? sktRulesText(bi.entries) : '')
    || (raw.entries && typeof sktRulesText === 'function' ? sktRulesText(raw.entries) : '');
  return { rarity: /^(none|unknown)/i.test(rarity) ? '' : rarity, attune: !!attune, text };
}
// Which items get a card: the magic ones, and anything with charges or text
// of your own (a plain sword is on the sheet already).
function cpCardItems(pc){
  return csItems(pc).filter(m => { const i = cpItemInfo(m); return !!(i.rarity || i.attune || +m.charges > 0 || m.bonusWeapon || m.bonusAc || (m.custom && i.text)); });
}
function cpItemCards(pc, m){
  const i = cpItemInfo(m);
  const sub = [i.rarity ? _csTitle(i.rarity) : 'Item', i.attune ? 'requires attunement' : ''].filter(Boolean).join(' · ');
  const facts = +m.charges > 0 ? '<div class="cpc-charges"><small>Charges</small> ' + cpBoxes(m.charges) + '</div>' : '';
  const body = i.text || (m.custom ? 'Your own item.' : '');
  return [{ kind: 'item', title: m.name, sub, facts, body, foot: pc.name + (m.attuned ? ' · attuned' : '') }];
}
function csPrintCards(pc, picks){
  const cards = [];
  (picks.spells || []).forEach(n => cards.push(...cpSpellCards(pc, n)));
  const items = cpCardItems(pc);
  (picks.items || []).forEach(n => { const m = items.find(x => x.name === n); if (m) cards.push(...cpItemCards(pc, m)); });
  const laid = cpLayCards(cards).map(cpCardHtml), pages = [];
  for (let k = 0; k < laid.length; k += 9) pages.push('<section class="cpc-page">' + laid.slice(k, k + 9).join('') + '</section>');
  return pages.join('');
}
// Choose the cards, then print. Everything is ticked to start.
async function csCardsPick(pc){
  const ed = (pc.build && pc.build.edition) || pc.rules || '2024';
  if (!CS.magic && typeof sktMagicLoad === 'function'){ try { CS.magic = await sktMagicLoad(ed); } catch(e){} }
  const spells = ((pc.sheet || {}).spells || []).filter(n => csSpell(n)).map(n => ({ n, lv: +csSpell(n).level || 0 })).sort((a, b) => a.lv - b.lv || a.n.localeCompare(b.n));
  const items = cpCardItems(pc);
  const any = spells.length || items.length;
  const back = document.createElement('div');
  back.className = 'modal-backdrop'; back.id = 'cpc-pick';
  const row = (kind, n, sub) => '<label class="cpc-row"><input type="checkbox" checked data-cpc-' + kind + '="' + csE(n) + '"> <span>' + csE(n) + '</span>' + (sub ? ' <small>' + csE(sub) + '</small>' : '') + '</label>';
  const list = (kind, title, rows) => '<div><div class="cpc-lh"><b>' + title + '</b><button class="btn small" data-cpc-all="' + kind + '">All</button><button class="btn small" data-cpc-none="' + kind + '">None</button></div>' + rows + '</div>';
  back.innerHTML = '<div class="modal cpc-modal" role="dialog" aria-modal="true" aria-label="Spell and item cards"><h3>Spell and item cards</h3>'
    + '<p class="cpc-note">Playing-card size, nine to a page. Print them, or choose “Save as PDF”.</p>'
    + (any ? '<div class="cpc-lists">'
      + (spells.length ? list('spell', 'Spells', spells.map(x => row('spell', x.n, x.lv ? CP_ORD[x.lv] : 'cantrip')).join('')) : '')
      + (items.length ? list('item', 'Items', items.map(m => row('item', m.name, _csTitle(cpItemInfo(m).rarity))).join('')) : '')
      + '</div>' : '<p class="cpc-note">No spells or magic items to make cards of yet.</p>')
    + '<div class="modal-actions"><button class="btn" data-cpc-close>Cancel</button><button class="btn primary" data-cpc-print>Print</button></div></div>';
  document.body.appendChild(back);
  const btn = back.querySelector('[data-cpc-print]');
  const count = () => { const n = back.querySelectorAll('input:checked').length; btn.textContent = n ? 'Print ' + n + ' card' + (n === 1 ? '' : 's') : 'Print'; btn.disabled = !n; };
  count();
  const close = () => back.remove();
  back.addEventListener('change', count);
  back.addEventListener('click', e => {
    const t = e.target;
    if (t === back || t.closest('[data-cpc-close]')) return close();
    const k = t.dataset && (t.dataset.cpcAll || t.dataset.cpcNone);
    if (k){ back.querySelectorAll('[data-cpc-' + k + ']').forEach(x => { x.checked = !!t.dataset.cpcAll; }); return count(); }
    if (t.closest('[data-cpc-print]')){
      const picks = { spells: [...back.querySelectorAll('[data-cpc-spell]:checked')].map(x => x.dataset.cpcSpell),
                      items: [...back.querySelectorAll('[data-cpc-item]:checked')].map(x => x.dataset.cpcItem) };
      close();
      csPrintHtml(csPrintCards(pc, picks), 'cs-print-cards');
    }
  });
  back.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  return back;
}
