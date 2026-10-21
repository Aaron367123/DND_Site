// ============================================================
// CHARACTER RULES — the 5e rules a character is built from
// ============================================================
// The character builder stores the CHOICES a player makes — species, class,
// level, ability scores, skills, spells, feats — in `pc.build`, and this file
// turns those choices into the sheet the rest of the app already runs on:
// abilities, saves, skills, HP, AC, attacks, spell slots, resources and the
// actions the phones can spend. The sheet is a pure function of the build.
// That is what makes levelling up, changing an earlier choice and switching
// rules edition safe: nothing is accumulated, everything is recomputed.
//
// Two editions, from the same data files the rest of the app reads:
//   '2014' — Player's Handbook (2014), source PHB
//   '2024' — Player's Handbook (2024), source XPHB
//
// What is MECHANICAL here and what is text. The data describes most of the
// structure — hit dice, saving throws, skill choices, spell slots, cantrips,
// prepared spells, class table columns (Rages, Focus Points, Sneak Attack
// dice…), optional-feature counts, species speed and resistances, background
// skills and ability increases. Everything that is a number on the sheet is
// derived from that. What the data only describes in prose — Unarmored
// Defense's AC formula, Alert's initiative, Tough's hit points, a Fighting
// Style's +1 — is applied by an entry in SKT_FEATURE_EFFECTS below. A
// feature with no entry is still on the sheet with its full text; it simply
// asks the player to apply it. sktFeatureCoverage() reports which is which.
//
// Written to run outside the browser too (no DOM at load time), so the rules
// can be checked against real characters straight from the data files.

const SKT_ABS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SKT_AB_NAME = { str: 'Strength', dex: 'Dexterity', con: 'Constitution',
                      int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const SKT_SKILLS = {
  acrobatics: 'dex', animalHandling: 'wis', arcana: 'int', athletics: 'str',
  deception: 'cha', history: 'int', insight: 'wis', intimidation: 'cha',
  investigation: 'int', medicine: 'wis', nature: 'int', perception: 'wis',
  performance: 'cha', persuasion: 'cha', religion: 'int', sleightOfHand: 'dex',
  stealth: 'dex', survival: 'wis',
};
const SKT_SKILL_LABEL = {
  acrobatics: 'Acrobatics', animalHandling: 'Animal Handling', arcana: 'Arcana',
  athletics: 'Athletics', deception: 'Deception', history: 'History', insight: 'Insight',
  intimidation: 'Intimidation', investigation: 'Investigation', medicine: 'Medicine',
  nature: 'Nature', perception: 'Perception', performance: 'Performance',
  persuasion: 'Persuasion', religion: 'Religion', sleightOfHand: 'Sleight of Hand',
  stealth: 'Stealth', survival: 'Survival',
};
const SKT_CORE_CLASSES = ['barbarian', 'bard', 'cleric', 'druid', 'fighter', 'monk',
                          'paladin', 'ranger', 'rogue', 'sorcerer', 'warlock', 'wizard'];
const SKT_EDITION_SRC = { '2014': 'PHB', '2024': 'XPHB' };
const SKT_POINT_BUY = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const SKT_STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const SKT_DMG = { A: 'acid', B: 'bludgeoning', C: 'cold', F: 'fire', O: 'force', L: 'lightning',
                  N: 'necrotic', P: 'piercing', I: 'poison', Y: 'psychic', R: 'radiant',
                  S: 'slashing', T: 'thunder' };

function sktMod(score){ return Math.floor(((+score || 10) - 10) / 2); }
function sktSigned(n){ return (n >= 0 ? '+' : '') + n; }
function sktProfBonus(level){ return 2 + Math.floor((Math.max(1, level) - 1) / 4); }
function sktSkillKey(name){
  const s = String(name || '').toLowerCase().trim();
  const k = s.replace(/\s+(\w)/g, (_, c) => c.toUpperCase());
  return SKT_SKILLS[k] ? k : null;
}
// "Chain Mail|XPHB" → "chain mail"; "{@item longsword|phb}" handled by sktRulesText.
function sktRefName(ref){ return String(ref || '').split('|')[0].toLowerCase().trim(); }

// ── Text ─────────────────────────────────────────────────────────────────────
// A self-contained reading of 5etools markup, so this file has no load-order
// dependency and works in a test run. "{@item Chain Mail|XPHB}" → "Chain Mail",
// "{@damage 1d10}" → "1d10", "{@filter Cantrips|spells|…}" → "Cantrips".
function sktRulesInline(s){
  return String(s == null ? '' : s)
    .replace(/\{@(?:h|hom)\}/g, '')
    .replace(/\{@dc (\d+)\}/g, 'DC $1')
    .replace(/\{@hit ([+-]?\d+)\}/g, (_, n) => sktSigned(+n))
    .replace(/\{@\w+ ([^}]*)\}/g, (_, body) => {
      const parts = body.split('|');
      // The display text, when a tag gives one, is its last segment for
      // most tags and its third for item/spell-style references.
      return (parts.length >= 3 && parts[2]) ? parts[2] : parts[0];
    })
    .replace(/\{@\w+\}/g, '');
}
function sktRulesText(entries, depth){
  depth = depth || 0;
  if (entries == null) return '';
  if (typeof entries === 'string') return sktRulesInline(entries);
  if (Array.isArray(entries)) return entries.map(e => sktRulesText(e, depth)).filter(Boolean).join('\n\n');
  if (typeof entries === 'object'){
    if (entries.type === 'list') return (entries.items || []).map(i => '• ' + sktRulesText(i, depth + 1)).join('\n');
    if (entries.type === 'table'){
      const head = (entries.colLabels || []).map(sktRulesInline).join(' | ');
      const rows = (entries.rows || []).map(r => r.map(c => sktRulesText(c, depth + 1)).join(' | '));
      return [entries.caption ? sktRulesInline(entries.caption) : '', head].concat(rows).filter(Boolean).join('\n');
    }
    if (entries.type === 'item' && entries.name) return sktRulesInline(entries.name) + ' ' + sktRulesText(entries.entry || entries.entries, depth + 1);
    const body = sktRulesText(entries.entries || entries.items || entries.entry, depth + 1);
    return entries.name ? sktRulesInline(entries.name) + '. ' + body : body;
  }
  return String(entries);
}

// ── Data ─────────────────────────────────────────────────────────────────────
// One promise per edition. `read(path)` returns parsed JSON: fetch in the
// browser, a file read in a test run.
const _sktRulesCache = {};
function sktRulesReader(base){
  base = base || 'data/';
  return p => fetch(base + p).then(r => { if (!r.ok) throw new Error(p + ': ' + r.status); return r.json(); });
}

async function sktRulesLoad(edition, read){
  edition = edition === '2014' ? '2014' : '2024';
  if (_sktRulesCache[edition] && !read) return _sktRulesCache[edition];
  read = read || sktRulesReader();
  const job = _sktRulesBuild(edition, read);
  if (read === undefined || !_sktRulesCache[edition]) _sktRulesCache[edition] = job;
  return job;
}

async function _sktRulesBuild(edition, read){
  const src = SKT_EDITION_SRC[edition];
  const classFiles = await Promise.all(SKT_CORE_CLASSES.map(c => read('class/class-' + c + '.json')));
  const [races, backgrounds, feats, optional, base, spellFile, spellSources, languages] = await Promise.all([
    read('races.json'), read('backgrounds.json'), read('feats.json'), read('optionalfeatures.json'),
    read('items-base.json'), read('spells/spells-' + src.toLowerCase() + '.json'),
    read('spells/sources.json'), read('languages.json').catch(() => ({ language: [] })),
  ]);

  const R = { edition, src, classes: [], species: [], backgrounds: [], feats: [], optional: [],
              spells: [], items: {}, languages: [] };

  // Classes, their features by level, and their subclasses.
  classFiles.forEach(file => {
    const cls = (file.class || []).find(c => c.source === src);
    if (!cls) return;
    const feats = (file.classFeature || []).filter(f => f.classSource === src && f.source === src);
    const featureAt = (name, level) => feats.find(f => f.name === name && f.level === level);
    const features = [];
    (cls.classFeatures || []).forEach(ref => {
      const s = typeof ref === 'string' ? ref : ref.classFeature;
      const [name, , , lvl, fsrc] = String(s).split('|');
      // The 2014 class lists Tasha's optional features alongside the PHB
      // ones ("Martial Versatility|Fighter||4|TCE"). Core only.
      if (fsrc && fsrc !== src) return;
      const level = +lvl;
      const f = featureAt(name, level);
      features.push({ name, level, entries: f ? f.entries : [],
                      gainSubclass: !!(ref && ref.gainSubclassFeature) });
    });
    const subclasses = (file.subclass || []).filter(sc => sc.classSource === src).map(sc => ({
      name: sc.name, shortName: sc.shortName, source: sc.source,
      core: sc.source === src,
      additionalSpells: sc.additionalSpells || null,
      spellcastingAbility: sc.spellcastingAbility || null,
      casterProgression: sc.casterProgression || null,
      cantripProgression: sc.cantripProgression || null,
      spellsKnownProgression: sc.spellsKnownProgression || null,
      subclassTableGroups: sc.subclassTableGroups || null,
      optionalfeatureProgression: sc.optionalfeatureProgression || null,
      // Matched on the subclass alone, not the class version: a 2014
      // subclass offered for the 2024 class keeps its features filed
      // under the 2014 class. Core-book features only for a core
      // subclass ("Maneuver Options" is Tasha's).
      features: (file.subclassFeature || [])
        .filter(f => f.subclassShortName === sc.shortName && f.subclassSource === sc.source
                  && (sc.source !== src || f.source === src))
        .map(f => ({ name: f.name, level: f.level, entries: f.entries || [] })),
    }));
    R.classes.push({
      name: cls.name, key: cls.name.toLowerCase(), source: cls.source,
      hd: (cls.hd && cls.hd.faces) || 8,
      saves: cls.proficiency || [],
      armor: (cls.startingProficiencies && cls.startingProficiencies.armor) || [],
      weapons: (cls.startingProficiencies && cls.startingProficiencies.weapons) || [],
      tools: (cls.startingProficiencies && cls.startingProficiencies.tools) || [],
      skillChoice: _sktSkillChoice(cls.startingProficiencies && cls.startingProficiencies.skills),
      equipment: cls.startingEquipment || {},
      primaryAbility: cls.primaryAbility || null,
      spellcastingAbility: cls.spellcastingAbility || null,
      casterProgression: cls.casterProgression || null,
      preparedSpells: cls.preparedSpells || null,
      preparedSpellsProgression: cls.preparedSpellsProgression || null,
      spellsKnownProgression: cls.spellsKnownProgression || null,
      cantripProgression: cls.cantripProgression || null,
      optionalfeatureProgression: cls.optionalfeatureProgression || null,
      featProgression: cls.featProgression || null,
      tableGroups: cls.classTableGroups || [],
      subclassTitle: cls.subclassTitle || 'Subclass',
      subclassLevel: (features.find(f => f.gainSubclass) || {}).level || 3,
      features, subclasses,
    });
  });

  // Species. 2014 races carry subraces — PHB ones only, the file holds many
  // books' worth (Duergar, Marks of the Dragonmarked…).
  const subOf = (name) => (races.subrace || []).filter(s => s.raceName === name && s.raceSource === src
                                                       && s.source === src && s.name);
  (races.race || []).filter(r => r.source === src).forEach(r => {
    R.species.push({
      name: r.name, source: r.source,
      ability: r.ability || null, speed: r.speed, size: r.size || ['M'],
      darkvision: r.darkvision || 0, resist: r.resist || [],
      languages: r.languageProficiencies || [], skills: r.skillProficiencies || [],
      weapons: r.weaponProficiencies || [], tools: r.toolProficiencies || [],
      armor: r.armorProficiencies || [], feats: r.feats || null,
      additionalSpells: r.additionalSpells || null,
      entries: r.entries || [],
      subraces: subOf(r.name).map(s => ({
        name: s.name, ability: s.ability || null, speed: s.speed, darkvision: s.darkvision,
        resist: s.resist || [], skills: s.skillProficiencies || [], weapons: s.weaponProficiencies || [],
        armor: s.armorProficiencies || [], languages: s.languageProficiencies || [],
        tools: s.toolProficiencies || [],
        feats: s.feats || null, additionalSpells: s.additionalSpells || null, entries: s.entries || [],
      })),
    });
  });

  (backgrounds.background || []).filter(b => b.source === src).forEach(b => {
    R.backgrounds.push({
      name: b.name, ability: b.ability || null, feats: b.feats || null,
      skills: b.skillProficiencies || [], tools: b.toolProficiencies || [],
      languages: b.languageProficiencies || [], equipment: b.startingEquipment || [],
      entries: b.entries || [],
    });
  });

  (feats.feat || []).filter(f => f.source === src).forEach(f => {
    R.feats.push({ name: f.name, category: f.category || '', prerequisite: f.prerequisite || null,
                   ability: f.ability || null, skills: f.skillProficiencies || null,
                   saves: f.savingThrowProficiencies || null, resist: f.resist || null,
                   additionalSpells: f.additionalSpells || null, repeatable: !!f.repeatable,
                   entries: f.entries || [] });
  });

  (optional.optionalfeature || []).filter(o => o.source === src).forEach(o => {
    R.optional.push({ name: o.name, featureType: o.featureType || [], prerequisite: o.prerequisite || null,
                      entries: o.entries || [] });
  });

  // Base weapons and armour, keyed by lower-case name.
  (base.baseitem || []).filter(i => i.source === src || (!R.items[i.name.toLowerCase()] && i.source === 'PHB'))
    .forEach(i => { R.items[i.name.toLowerCase()] = i; });

  // Spells, with the classes that have them on their list.
  const lists = (spellSources && spellSources[src]) || {};
  (spellFile.spell || []).forEach(s => {
    const cl = ((lists[s.name] || {}).class || []).filter(c => c.source === src).map(c => c.name);
    R.spells.push({ name: s.name, level: s.level, school: s.school, classes: cl,
                    time: s.time, range: s.range, duration: s.duration,
                    concentration: !!(s.duration || []).some(d => d.concentration),
                    ritual: !!(s.meta && s.meta.ritual),
                    damageInflict: s.damageInflict || null, savingThrow: s.savingThrow || null,
                    spellAttack: s.spellAttack || null, scalingLevelDice: s.scalingLevelDice || null,
                    entries: s.entries || [] });
  });

  R.languages = (languages.language || []).filter(l => l.source === src || (l.source === 'PHB' && edition === '2014'))
    .map(l => ({ name: l.name, type: l.type || 'standard' }));
  if (!R.languages.length){
    R.languages = ['Common', 'Dwarvish', 'Elvish', 'Giant', 'Gnomish', 'Goblin', 'Halfling', 'Orc',
                   'Abyssal', 'Celestial', 'Draconic', 'Deep Speech', 'Infernal', 'Primordial', 'Sylvan', 'Undercommon']
      .map(n => ({ name: n, type: 'standard' }));
  }
  return R;
}

function _sktSkillChoice(skills){
  const s = (skills || [])[0] || {};
  if (s.choose) return { from: (s.choose.from || []).map(sktSkillKey).filter(Boolean), count: s.choose.count || 1 };
  if (s.any) return { from: Object.keys(SKT_SKILLS), count: s.any };
  return { from: [], count: 0 };
}

// ── Lookups into one edition's data ──────────────────────────────────────────
function sktRulesClass(R, name){ return R.classes.find(c => c.key === String(name || '').toLowerCase()) || null; }
function sktRulesSubclass(cls, name){
  if (!cls || !name) return null;
  const n = String(name).toLowerCase();
  // The edition's own printing first: the 2024 fighter lists both its own
  // Battle Master and the 2014 one adapted for it.
  const hits = cls.subclasses.filter(s => s.shortName.toLowerCase() === n || s.name.toLowerCase() === n);
  return hits.find(s => s.core) || hits[0] || null;
}
function sktRulesSpecies(R, name){ return R.species.find(s => s.name === name) || null; }
function sktRulesBackground(R, name){ return R.backgrounds.find(b => b.name === name) || null; }
function sktRulesFeat(R, name){
  const n = String(name || '').toLowerCase().split(';')[0].trim();
  return R.feats.find(f => f.name.toLowerCase() === n) || null;
}
function sktRulesSpell(R, name){
  const n = String(name || '').toLowerCase().split('|')[0].replace(/#c$/, '').trim();
  return R.spells.find(s => s.name.toLowerCase() === n) || null;
}

// A column of the class table, by its label, at a level. Cells can be plain
// numbers, strings ("2", "Unlimited"), or typed objects ({type:'dice'},
// {type:'bonus'}, {type:'bonusSpeed'}). Returns a number where there is one,
// and the raw cell otherwise.
function sktClassColumn(cls, label, level, sub){
  const groups = (cls && cls.tableGroups || []).concat((sub && sub.subclassTableGroups) || []);
  const want = String(label).toLowerCase();
  for (const g of groups){
    const labels = (g.colLabels || []).map(l => sktRulesInline(l).toLowerCase());
    const i = labels.findIndex(l => l === want);
    if (i < 0) continue;
    const rows = g.rows || g.rowsSpellProgression || [];
    const cell = (rows[Math.max(0, Math.min(rows.length, level) - 1)] || [])[i];
    return _sktCell(cell);
  }
  return null;
}
function _sktCell(cell){
  if (cell == null) return null;
  if (typeof cell === 'number') return cell;
  if (typeof cell === 'string'){
    const n = parseInt(sktRulesInline(cell), 10);
    return isNaN(n) ? sktRulesInline(cell) : n;
  }
  if (cell.type === 'bonus' || cell.type === 'bonusSpeed') return cell.value;
  if (cell.type === 'dice'){
    const d = (cell.toRoll || [])[0] || {};
    return (d.number || 1) + 'd' + (d.faces || 4);
  }
  return null;
}

// ── The build ────────────────────────────────────────────────────────────────
// Every field is a choice. Missing fields mean "not chosen yet", and the
// sheet is still computed from whatever is there, so the builder can show a
// live preview from the first click.
function sktBlankBuild(edition){
  return {
    v: 1, edition: edition === '2014' ? '2014' : '2024', name: '',
    species: '', subspecies: '', cls: '', subclass: '', level: 1, background: '',
    abilities: { method: 'array', base: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
                 assign: { str: 0, dex: 1, con: 2, int: 3, wis: 4, cha: 5 } },
    speciesAsi: {},        // 2014: chosen racial increases, ability → amount
    bgAsi: {},             // 2024: background increases, ability → amount
    skills: [],            // class skill picks
    speciesSkills: [],     // species picks (Half-Elf, Variant Human, 2024 Human, 2024 Elf…)
    bgSkills: [],          // only where a background offers a choice
    expertise: [],
    languages: [], tools: [],
    asi: {},               // level → { type:'asi', inc:{ab:n} } | { type:'feat', feat, choice }
    originFeat: '',        // 2024 Human's extra origin feat; 2014 Variant Human's feat
    featChoices: {},       // feat name → { ability, skills, spells … }
    featureChoices: {},    // feature name → chosen option (Divine Order → 'Protector')
    optional: {},          // 'Eldritch Invocations' → [names], 'Fighting Style' → [name] …
    masteries: [],         // 2024 weapon mastery picks (weapon names)
    speciesChoice: {},     // 2024 lineage / ancestry / legacy
    cantrips: [], spells: [],
    hp: { method: 'average', rolls: {} },
    equipment: { cls: 'A', bg: 'A', picks: {} },
    icon: '',
  };
}

// Ability scores, every source in order: base, species or background,
// ability score improvements, feats, then the cap.
function sktBuildAbilities(build, R){
  const base = Object.assign({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
                             (build.abilities && build.abilities.base) || {});
  const out = { ...base };
  const add = (inc) => Object.keys(inc || {}).forEach(k => { if (k in out) out[k] += +inc[k] || 0; });
  const species = sktRulesSpecies(R, build.species);
  if (R.edition === '2014'){
    if (species){
      const sub = species.subraces.find(s => s.name === build.subspecies) || null;
      // Fixed increases from the species and the subrace; the chosen part of
      // either ("+1 to two others") comes from build.speciesAsi.
      [species.ability, sub && sub.ability].forEach(list => (list || []).forEach(a => {
        Object.keys(a).forEach(k => { if (k !== 'choose' && k in out) out[k] += a[k]; });
      }));
      add(build.speciesAsi);
    }
  } else {
    add(build.bgAsi);
  }
  Object.keys(build.asi || {}).sort((a, b) => a - b).forEach(lvl => {
    if (+lvl > (build.level || 1)) return;
    const pick = build.asi[lvl] || {};
    if (pick.type === 'asi') add(pick.inc);
    else if (pick.type === 'feat') add((build.featChoices[pick.feat] || {}).inc);
  });
  if (build.originFeat) add((build.featChoices[build.originFeat] || {}).inc);
  // Ability scores top out at 20; an Epic Boon (2024, level 19) raises the
  // cap to 30 for the score it improves.
  const boonCap = {};
  Object.keys(build.asi || {}).forEach(lvl => {
    const pick = build.asi[lvl] || {};
    const f = pick.type === 'feat' && sktRulesFeat(R, pick.feat);
    if (f && f.category === 'EB') Object.keys((build.featChoices[pick.feat] || {}).inc || {}).forEach(k => { boonCap[k] = 30; });
  });
  SKT_ABS.forEach(k => { out[k] = Math.max(1, Math.min(boonCap[k] || 20, out[k])); });
  return out;
}

// The features a build has, in level order: class, subclass, species,
// background, feats and optional features. Each carries where it came from,
// its text, and whether this file applies it mechanically.
function sktBuildFeatures(build, R){
  const cls = sktRulesClass(R, build.cls), sub = sktRulesSubclass(cls, build.subclass);
  const L = build.level || 1;
  const out = [];
  const push = (f, from, level, info) => {
    const isInfo = !!info || _sktIsHeader(f.name, from, sub);
    out.push({
      name: f.name, from, level: level || 0, info: isInfo,
      text: sktRulesText(f.entries),
      mech: !isInfo && (!!sktFeatureEffect(f.name, from, R.edition, cls && cls.key)
                        || !!sktFeatureChoice(f.name, from, R.edition, cls && cls.key)),
    });
  };
  if (cls){
    const title = sktRulesInline(cls.subclassTitle || '').toLowerCase();
    cls.features.filter(f => f.level <= L).forEach(f => {
      if (/^Ability Score Improvement$/i.test(f.name)) return;     // shown as the choice it became
      // The subclass slot ("Primal Path", "Path Feature", "Bard College
      // feature") is a header: the subclass's own features are listed below.
      const slot = f.gainSubclass || f.name.toLowerCase() === title
        || new RegExp('^' + title.replace(/[^a-z ]/g, '') + ' features?$').test(f.name.toLowerCase())
        || /(path|domain|college|circle|archetype|tradition|oath|origin|patron) features?$/i.test(f.name);
      // An upgrade of an earlier feature ("Bardic Inspiration (d8)",
      // "Extra Attack (2)", "Destroy Undead (CR 1)", "… improvement") is
      // the same feature at a higher level. It inherits the base's status
      // and is not counted again.
      const up = _sktUpgradeOf(f.name, cls, f.level);
      if (up){
        out.push({ name: f.name, from: 'class', level: f.level, info: true, upgradeOf: up,
                   text: sktRulesText(f.entries), mech: !!sktFeatureEffect(up, 'class', R.edition, cls.key) });
        return;
      }
      push(f, 'class', f.level, slot);
    });
  }
  if (sub) sub.features.filter(f => f.level <= L).forEach(f => push(f, 'subclass', f.level));
  const sp = sktRulesSpecies(R, build.species);
  if (sp){
    _sktTraits(sp.entries).forEach(t => push(t, 'species', 1));
    const sr = sp.subraces.find(s => s.name === build.subspecies);
    if (sr) _sktTraits(sr.entries).forEach(t => push(t, 'species', 1));
  }
  const bg = sktRulesBackground(R, build.background);
  if (bg) _sktTraits(bg.entries).filter(t => /^Feature:/i.test(t.name) || R.edition === '2014')
    .filter(t => /^Feature:/i.test(t.name)).forEach(t => push(t, 'background', 1));
  sktBuildFeatNames(build, R).forEach(n => { const f = sktRulesFeat(R, n); if (f) push(f, 'feat', 1); });
  Object.keys(build.optional || {}).forEach(group => (build.optional[group] || []).forEach(n => {
    const o = R.optional.find(x => x.name === n) || sktRulesFeat(R, n);
    if (o) push(o, 'optional', 1);
  }));
  return out;
}
// "Bardic Inspiration (d8)" → "Bardic Inspiration"; "Action Surge (two
// uses)" → "Action Surge"; "Unarmored Movement improvement" → "Unarmored
// Movement". Only when the base is itself one of the class's features.
// Also an upgrade when there is no bare base at all but an earlier entry
// shares the stem: "Brutal Critical (2 dice)" after "Brutal Critical (1
// die)", "Song of Rest (d8)" after "(d6)". The first of those is the base.
function _sktUpgradeOf(name, cls, level){
  const base = String(name).replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+improvements?$/i, '').trim();
  if (base === name) return null;
  if (cls.features.some(f => f.name === base)) return base;
  const stem = f => String(f.name).replace(/\s*\([^)]*\)\s*$/, '').trim();
  return cls.features.some(f => f.level < level && stem(f) === base) ? base : null;
}

// Section headers in the data rather than features: "Fighter Subclass",
// "Subclass Feature" (a slot the subclass fills), the subclass's own
// introduction, a list of options, and species boilerplate that the
// numbers already carry (size, speed, age, languages).
function _sktIsHeader(name, from, sub){
  const n = String(name || '');
  if (from === 'class' && (/Subclass$/.test(n) || /^Subclass Feature$/i.test(n) || /^Proficiencies$/i.test(n)
                           || / Options$/.test(n) || /improvements?$/i.test(n))) return true;
  if (from === 'subclass' && sub && (n === sub.shortName || n === sub.name || /Options$/.test(n))) return true;
  if (from === 'species' && /^(Ability Score Increase|Age|Alignment|Size|Speed|Languages|Creature Type|Subrace)$/i.test(n)) return true;
  return false;
}

function _sktTraits(entries){
  return (entries || []).filter(e => e && typeof e === 'object' && e.name && e.entries)
    .map(e => ({ name: sktRulesInline(e.name), entries: e.entries }));
}

// Every feat the build holds: 2024 background origin feat, a 2024 Human's or
// 2014 Variant Human's bonus feat, feats taken in place of an ASI, 2024
// fighting styles (which are feats there) and epic boons.
function sktBuildFeatNames(build, R){
  const out = [];
  const bg = sktRulesBackground(R, build.background);
  if (R.edition === '2024' && bg && Array.isArray(bg.feats)){
    bg.feats.forEach(o => Object.keys(o).forEach(k => out.push(_sktTitle(k.split('|')[0]))));
  }
  if (build.originFeat) out.push(build.originFeat);
  Object.keys(build.asi || {}).forEach(lvl => {
    const p = build.asi[lvl];
    if (+lvl <= (build.level || 1) && p && p.type === 'feat' && p.feat) out.push(p.feat);
  });
  return out;
}
// Title case that leaves an apostrophe alone: "Diplomat's Pack", not
// "Diplomat'S Pack".
function _sktTitle(s){
  return String(s).split(';')[0].replace(/(^|[\s(\-\/])([a-z])/g, (m, p, c) => p + c.toUpperCase()).trim();
}

// ── Spellcasting ─────────────────────────────────────────────────────────────
// Slots, cantrips and how many spells the character prepares or knows, from
// the class table. Pact magic (warlock) is its own pool, as the app's rests
// already expect: sheet.spellSlots gets the pact slots at the pact level.
function sktBuildSpellcasting(build, R, abilities){
  const cls = sktRulesClass(R, build.cls), sub = sktRulesSubclass(cls, build.subclass);
  const L = build.level || 1;
  const caster = cls && (cls.casterProgression ? cls : (sub && sub.casterProgression && L >= 3 ? sub : null));
  if (!caster || !caster.spellcastingAbility) return null;
  const ab = caster.spellcastingAbility;
  const pb = sktProfBonus(L);
  const mod = sktMod(abilities[ab]);
  const idx = Math.max(0, Math.min(19, L - 1));
  const out = { ability: ab, dc: 8 + pb + mod, attack: pb + mod, slots: {}, pact: null,
                cantrips: (caster.cantripProgression || [])[idx] || 0, prepared: 0, known: 0 };
  // A feature choice can add a cantrip (2024 Thaumaturge, Magician).
  sktBuildChoices(build, R).forEach(c => {
    const opt = (c.spec.options || []).find(o => o.value === c.value);
    if (opt && opt.cantrips) out.cantrips += opt.cantrips;
  });
  if (caster.preparedSpellsProgression) out.prepared = caster.preparedSpellsProgression[idx] || 0;
  else if (caster.preparedSpells){
    // "<$level$> + <$wis_mod$>", "<$level$> / 2 + <$cha_mod$>"
    const f = String(caster.preparedSpells);
    const half = /\/\s*2/.test(f);
    const lv = half ? Math.floor(L / 2) : L;
    out.prepared = Math.max(1, lv + mod);
  }
  if (caster.spellsKnownProgression) out.known = caster.spellsKnownProgression[idx] || 0;
  if (caster.casterProgression === 'pact'){
    const n = sktClassColumn(cls, 'Spell Slots', L) || sktClassColumn(cls, 'Pact Slots', L) || 0;
    const lvl = sktClassColumn(cls, 'Slot Level', L);
    const slotLevel = typeof lvl === 'number' ? lvl : parseInt(String(lvl || '1'), 10) || 1;
    out.pact = { count: +n || 0, level: slotLevel };
    if (out.pact.count) out.slots[slotLevel] = out.pact.count;
  } else {
    const prog = _sktSpellTable(caster, L);
    prog.forEach((n, i) => { if (n) out.slots[i + 1] = n; });
  }
  out.maxSpellLevel = Math.max(0, ...Object.keys(out.slots).map(Number));
  return out;
}
function _sktSpellTable(caster, L){
  const groups = caster.tableGroups || caster.subclassTableGroups || [];
  const g = groups.find(x => x.rowsSpellProgression);
  if (g) return g.rowsSpellProgression[Math.max(0, Math.min(19, L - 1))] || [];
  // Fallback for a third-caster subclass table that only exists in the rules.
  return [];
}
// The spells a class can pick at a level: on its list, of a level it has a
// slot for (or a cantrip). 2014 has no spell lists in the class file itself;
// both editions use spells/sources.json.
function sktSpellOptions(R, build, level){
  const cls = sktRulesClass(R, build.cls), sub = sktRulesSubclass(cls, build.subclass);
  if (!cls) return [];
  let listName = cls.name;
  // Eldritch Knight and Arcane Trickster cast from the wizard list.
  if (!cls.casterProgression && sub && sub.casterProgression) listName = 'Wizard';
  return R.spells.filter(s => s.classes.includes(listName) && s.level === level)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Feature effects ──────────────────────────────────────────────────────────
// The part of each feature the data only states in prose. Keyed by
// "<from>:<name>" with an optional edition or class qualifier tried first:
//   '2024:class:fighter:Fighting Style' → '2024:class:Fighting Style'
//   → 'class:Fighting Style'
// Each effect is (ctx) => void, and changes ctx in place. ctx holds the
// numbers being built — ac candidates, hp per level, speed, saves, skill
// sets, resources, actions, notes — plus the build and the data.
const SKT_FEATURE_EFFECTS = {};
function sktFeatureEffect(name, from, edition, clsKey){
  const stem = String(name).replace(/\s*\([^)]*\)\s*$/, '').trim();
  for (const n of stem !== name ? [name, stem] : [name]){
    const tries = [edition + ':' + from + ':' + (clsKey || '') + ':' + n,
                   edition + ':' + from + ':' + n,
                   from + ':' + (clsKey || '') + ':' + n,
                   from + ':' + n];
    for (const k of tries) if (SKT_FEATURE_EFFECTS[k]) return SKT_FEATURE_EFFECTS[k];
  }
  return null;
}
function sktDefineEffect(keys, fn){ (Array.isArray(keys) ? keys : [keys]).forEach(k => { SKT_FEATURE_EFFECTS[k] = fn; }); }

// Features that are a CHOICE — a 2024 cleric's Divine Order, a druid's
// Primal Order, Blessed Strikes. Same key scheme as the effects. The builder
// asks the question; the chosen option's apply(ctx) runs with the effects.
//   { label, options: [{ value, label, desc, cantrips? }], apply(ctx, value) }
const SKT_FEATURE_CHOICES = {};
function sktDefineChoice(keys, spec){ (Array.isArray(keys) ? keys : [keys]).forEach(k => { SKT_FEATURE_CHOICES[k] = spec; }); }
function sktFeatureChoice(name, from, edition, clsKey){
  const tries = [edition + ':' + from + ':' + (clsKey || '') + ':' + name, edition + ':' + from + ':' + name,
                 from + ':' + (clsKey || '') + ':' + name, from + ':' + name];
  for (const k of tries) if (SKT_FEATURE_CHOICES[k]) return SKT_FEATURE_CHOICES[k];
  return null;
}
// The choices this build has to make, and what it has picked.
function sktBuildChoices(build, R){
  const cls = sktRulesClass(R, build.cls);
  return sktBuildFeatures(build, R).filter(f => !f.info).map(f => {
    const spec = sktFeatureChoice(f.name, f.from, R.edition, cls && cls.key);
    return spec ? { feature: f.name, level: f.level, spec, value: (build.featureChoices || {})[f.name] || '' } : null;
  }).filter(Boolean);
}

// Small helpers the effects share.
function _fxPool(ctx, name, max, recharge, extra){
  if (!(max > 0)) return;
  const at = ctx.resources.findIndex(r => r.name === name);
  const r = Object.assign({ name, type: 'pool', current: max, max, recharge: recharge || 'long' }, extra || {});
  if (at >= 0) ctx.resources[at] = r; else ctx.resources.push(r);
}
function _fxAction(ctx, a){ if (!ctx.actions.some(x => x.name === a.name)) ctx.actions.push(a); }
function _fxNote(ctx, text){ if (!ctx.notes.includes(text)) ctx.notes.push(text); }
function _fxCol(ctx, label){ return sktClassColumn(ctx.cls, label, ctx.level, ctx.sub); }

// ---- Barbarian
sktDefineEffect(['class:barbarian:Rage'], ctx => {
  const n = _fxCol(ctx, 'Rages');
  _fxPool(ctx, 'Rage', typeof n === 'number' ? n : 2, 'long');
  const dmg = _fxCol(ctx, 'Rage Damage') || 2;
  _fxAction(ctx, { name: 'Rage', action: 'Bonus Action', resource: 'Rage', amount: 1, feature: 'Rage',
                   desc: 'Advantage on Strength checks and saves, +' + dmg + ' damage on Strength attacks, resistance to bludgeoning, piercing and slashing damage.' });
  ctx.rageDamage = dmg;
});
sktDefineEffect(['class:barbarian:Unarmored Defense'], ctx => {
  ctx.acOptions.push({ label: 'Unarmored Defense', value: 10 + ctx.mod.dex + ctx.mod.con, noArmor: true, shieldOk: true });
});
sktDefineEffect(['class:barbarian:Fast Movement'], ctx => { ctx.speedBonusUnlessHeavy += 10; });
sktDefineEffect(['class:barbarian:Danger Sense'], ctx => _fxNote(ctx, 'Advantage on Dexterity saving throws (Danger Sense).'));
sktDefineEffect(['class:barbarian:Feral Instinct'], ctx => _fxNote(ctx, 'Advantage on initiative rolls (Feral Instinct).'));
sktDefineEffect(['class:barbarian:Reckless Attack'], ctx => {
  ctx.resources.push({ name: 'Reckless Attack', type: 'toggle', current: 1, max: 1, recharge: 'turn' });
});
sktDefineEffect(['class:barbarian:Primal Champion'], ctx => { ctx.abilityBonus.str += 4; ctx.abilityBonus.con += 4; ctx.abilityCapBonus.str = 24; ctx.abilityCapBonus.con = 24; });
sktDefineEffect(['2014:class:barbarian:Brutal Critical'], ctx => {
  const n = ctx.level >= 17 ? 3 : ctx.level >= 13 ? 2 : 1;
  _fxNote(ctx, 'Critical hits with melee weapons roll ' + n + ' extra weapon damage ' + (n === 1 ? 'die' : 'dice') + ' (Brutal Critical).');
});

// ---- Bard
sktDefineEffect(['class:bard:Bardic Inspiration'], ctx => {
  const die = _fxCol(ctx, 'Bardic Die') || (ctx.level >= 15 ? '1d12' : ctx.level >= 10 ? '1d10' : ctx.level >= 5 ? '1d8' : '1d6');
  // Recharges on a short rest from Font of Inspiration (level 5) on.
  _fxPool(ctx, 'Bardic Inspiration', Math.max(1, ctx.mod.cha), ctx.level >= 5 ? 'short' : 'long', { die });
  _fxAction(ctx, { name: 'Bardic Inspiration', action: 'Bonus Action', resource: 'Bardic Inspiration', amount: 1,
                   feature: 'Bardic Inspiration', desc: 'A creature within 60 feet gains a ' + die + ' to add to one roll.' });
});
sktDefineEffect(['class:bard:Jack of All Trades'], ctx => { ctx.jackOfAllTrades = true; });

// ---- Cleric
sktDefineEffect(['class:cleric:Channel Divinity', '2014:class:cleric:Channel Divinity'], ctx => {
  const n = _fxCol(ctx, 'Channel Divinity') || (ctx.level >= 18 ? 3 : ctx.level >= 6 ? 2 : 1);
  _fxPool(ctx, 'Channel Divinity', n, ctx.edition === '2024' ? 'short-one' : 'short');
});

// ---- Druid
sktDefineEffect(['class:druid:Wild Shape'], ctx => {
  const n = _fxCol(ctx, 'Wild Shape') || 2;
  _fxPool(ctx, 'Wild Shape', typeof n === 'number' ? n : 2, ctx.edition === '2024' ? 'short-one' : 'short');
  _fxAction(ctx, { name: 'Wild Shape', action: ctx.edition === '2024' ? 'Bonus Action' : 'Action', resource: 'Wild Shape',
                   amount: 1, feature: 'Wild Shape', desc: 'Transform into a beast you have seen.' });
});

// ---- Fighter
sktDefineEffect(['class:fighter:Second Wind'], ctx => {
  const n = _fxCol(ctx, 'Second Wind') || 1;
  _fxPool(ctx, 'Second Wind', n, ctx.edition === '2024' ? 'short-one' : 'short');
  _fxAction(ctx, { name: 'Second Wind', action: 'Bonus Action', resource: 'Second Wind', amount: 1, feature: 'Second Wind',
                   desc: 'Regain 1d10 + ' + ctx.level + ' hit points.' });
});
sktDefineEffect(['class:fighter:Action Surge'], ctx => {
  _fxPool(ctx, 'Action Surge', ctx.level >= 17 ? 2 : 1, 'short');
  _fxAction(ctx, { name: 'Action Surge', action: 'Free', resource: 'Action Surge', amount: 1, feature: 'Action Surge',
                   desc: 'Take one additional action on your turn.' });
});
sktDefineEffect(['class:fighter:Indomitable'], ctx => {
  _fxPool(ctx, 'Indomitable', ctx.level >= 17 ? 3 : ctx.level >= 13 ? 2 : 1, 'long');
});
sktDefineEffect(['class:fighter:Extra Attack', 'class:barbarian:Extra Attack', 'class:monk:Extra Attack',
                 'class:paladin:Extra Attack', 'class:ranger:Extra Attack'], ctx => {
  ctx.attacksPerAction = Math.max(ctx.attacksPerAction, 2);
});
sktDefineEffect(['class:fighter:Two Extra Attacks'], ctx => { ctx.attacksPerAction = Math.max(ctx.attacksPerAction, 3); });
sktDefineEffect(['class:fighter:Three Extra Attacks'], ctx => { ctx.attacksPerAction = Math.max(ctx.attacksPerAction, 4); });
// 2014 writes all three as "Extra Attack (2)" etc. under one name with level text.
sktDefineEffect(['2014:class:fighter:Extra Attack'], ctx => {
  ctx.attacksPerAction = Math.max(ctx.attacksPerAction, ctx.level >= 20 ? 4 : ctx.level >= 11 ? 3 : 2);
});

// ---- Monk
sktDefineEffect(['class:monk:Martial Arts'], ctx => {
  ctx.martialArtsDie = _fxCol(ctx, 'Martial Arts') || '1d4';
  ctx.martialArts = true;
});
sktDefineEffect(['class:monk:Unarmored Defense'], ctx => {
  ctx.acOptions.push({ label: 'Unarmored Defense', value: 10 + ctx.mod.dex + ctx.mod.wis, noArmor: true, shieldOk: false });
});
sktDefineEffect(['class:monk:Unarmored Movement'], ctx => {
  const v = _fxCol(ctx, 'Unarmored Movement');
  ctx.speedBonusUnarmored += typeof v === 'number' ? v : 10;
});
sktDefineEffect(['2024:class:monk:Monk\'s Focus', '2014:class:monk:Ki'], ctx => {
  const n = _fxCol(ctx, ctx.edition === '2024' ? 'Focus Points' : 'Ki Points') || ctx.level;
  _fxPool(ctx, 'Focus Points', n, 'short');
});
sktDefineEffect(['class:monk:Diamond Soul'], ctx => { SKT_ABS.forEach(k => ctx.saveProf.add(k)); });
sktDefineEffect(['class:monk:Disciplined Survivor'], ctx => { SKT_ABS.forEach(k => ctx.saveProf.add(k)); });
sktDefineEffect(['class:monk:Evasion', 'class:rogue:Evasion'], ctx => _fxNote(ctx, 'Evasion: no damage on a successful Dexterity save against area effects, half on a failure.'));

// ---- Paladin
sktDefineEffect(['class:paladin:Lay On Hands', 'class:paladin:Lay on Hands'], ctx => {
  _fxPool(ctx, 'Lay on Hands', ctx.level * 5, 'long');
  _fxAction(ctx, { name: 'Lay on Hands', action: ctx.edition === '2024' ? 'Bonus Action' : 'Action', resource: 'Lay on Hands',
                   amount: 5, feature: 'Lay on Hands', desc: 'Restore hit points from a pool of ' + (ctx.level * 5) + '.' });
});
sktDefineEffect(['class:paladin:Aura of Protection'], ctx => {
  ctx.saveBonusAll += Math.max(1, ctx.mod.cha);
  _fxNote(ctx, 'Aura of Protection: you and allies within ' + (ctx.level >= 18 ? 30 : 10) + ' feet add +' + Math.max(1, ctx.mod.cha) + ' to saving throws.');
});
sktDefineEffect(['class:paladin:Channel Divinity'], ctx => {
  _fxPool(ctx, 'Channel Divinity', _fxCol(ctx, 'Channel Divinity') || (ctx.level >= 11 ? 3 : 2), ctx.edition === '2024' ? 'short-one' : 'short');
});

// ---- Ranger
sktDefineEffect(['2024:class:ranger:Favored Enemy'], ctx => {
  const n = _fxCol(ctx, 'Favored Enemy') || 2;
  _fxPool(ctx, 'Favored Enemy', typeof n === 'number' ? n : 2, 'long');
});

// ---- Rogue
sktDefineEffect(['class:rogue:Sneak Attack'], ctx => {
  const d = _fxCol(ctx, 'Sneak Attack');
  ctx.sneakAttack = typeof d === 'string' ? d : Math.ceil(ctx.level / 2) + 'd6';
  ctx.resources.push({ name: 'Sneak Attack', type: 'toggle', current: 1, max: 1, recharge: 'turn', die: ctx.sneakAttack });
});
sktDefineEffect(['class:rogue:Reliable Talent'], ctx => _fxNote(ctx, 'Reliable Talent: treat a d20 roll of 9 or lower as a 10 on any ability check you are proficient in.'));
sktDefineEffect(['2014:class:rogue:Slippery Mind'], ctx => { ctx.saveProf.add('wis'); });
sktDefineEffect(['2024:class:rogue:Slippery Mind'], ctx => { ctx.saveProf.add('wis'); ctx.saveProf.add('cha'); });

// ---- Sorcerer
sktDefineEffect(['2014:class:sorcerer:Font of Magic', '2024:class:sorcerer:Font of Magic'], ctx => {
  const n = _fxCol(ctx, 'Sorcery Points') || ctx.level;
  _fxPool(ctx, 'Sorcery Points', typeof n === 'number' ? n : ctx.level, 'long');
});
sktDefineEffect(['2024:class:sorcerer:Innate Sorcery'], ctx => {
  _fxPool(ctx, 'Innate Sorcery', 2, 'long');
  _fxAction(ctx, { name: 'Innate Sorcery', action: 'Bonus Action', resource: 'Innate Sorcery', amount: 1, feature: 'Innate Sorcery',
                   desc: 'For 1 minute, +1 to your spell save DC and advantage on sorcerer spell attacks.' });
});

// ---- Warlock — pact magic is handled by sktBuildSpellcasting.

// ---- Wizard
sktDefineEffect(['class:wizard:Arcane Recovery'], ctx => { _fxPool(ctx, 'Arcane Recovery', 1, 'long'); });

// ---- Subclasses that change the numbers
sktDefineEffect(['subclass:Draconic Resilience'], ctx => {
  ctx.hpPerLevel += 1;
  const v = ctx.edition === '2024' ? 10 + ctx.mod.dex + ctx.mod.cha : 13 + ctx.mod.dex;
  ctx.acOptions.push({ label: 'Draconic Resilience', value: v, noArmor: true, shieldOk: true });
});
sktDefineEffect(['subclass:Remarkable Athlete'], ctx => {
  if (ctx.edition === '2014') ctx.remarkableAthlete = true;
  else _fxNote(ctx, 'Advantage on initiative rolls and Strength (Athletics) checks (Remarkable Athlete).');
});
sktDefineEffect(['subclass:Improved Critical'], ctx => { ctx.critRange = Math.min(ctx.critRange, 19); });
sktDefineEffect(['subclass:Superior Critical'], ctx => { ctx.critRange = Math.min(ctx.critRange, 18); });
sktDefineEffect(['subclass:Combat Superiority'], ctx => {
  const n = ctx.level >= 15 ? 6 : ctx.level >= 7 ? 5 : 4;
  const die = ctx.level >= 18 ? 'd12' : ctx.level >= 10 ? 'd10' : 'd8';
  _fxPool(ctx, 'Superiority Dice', n, 'short', { die });
});
sktDefineEffect(['subclass:Disciple of Life'], ctx => _fxNote(ctx, 'Healing spells of 1st level or higher restore an extra 2 + the spell’s level hit points.'));
sktDefineEffect(['2014:subclass:Bonus Proficiency', '2014:subclass:Bonus Proficiencies'], ctx => {
  if (ctx.sub && /life|nature|tempest|war/i.test(ctx.sub.shortName)) ctx.armorProf.add('heavy');
});

// ---- Species traits
sktDefineEffect(['species:Dwarven Toughness'], ctx => { ctx.hpPerLevel += 1; });
sktDefineEffect(['species:Lucky'], ctx => _fxNote(ctx, 'Lucky: reroll a 1 on a d20 test and use the new roll.'));
sktDefineEffect(['species:Keen Senses'], ctx => { if (ctx.edition === '2014') ctx.skillProf.add('perception'); });
sktDefineEffect(['species:Menacing'], ctx => { ctx.skillProf.add('intimidation'); });
sktDefineEffect(['species:Relentless Endurance'], ctx => { _fxPool(ctx, 'Relentless Endurance', 1, 'long'); });
sktDefineEffect(['species:Breath Weapon'], ctx => {
  const n = ctx.edition === '2024' ? ctx.pb : 1;
  _fxPool(ctx, 'Breath Weapon', n, ctx.edition === '2024' ? 'long' : 'short');
});
sktDefineEffect(['species:Stone\'s Endurance'], ctx => { _fxPool(ctx, 'Stone’s Endurance', ctx.pb, 'long'); });
sktDefineEffect(['species:Healing Hands'], ctx => { _fxPool(ctx, 'Healing Hands', 1, 'long'); });
sktDefineEffect(['species:Adrenaline Rush'], ctx => { _fxPool(ctx, 'Adrenaline Rush', ctx.pb, 'short'); });
sktDefineEffect(['species:Stonecunning'], ctx => { if (ctx.edition === '2024') _fxPool(ctx, 'Stonecunning', ctx.pb, 'long'); });
sktDefineEffect(['2024:species:Celestial Revelation'], ctx => { if (ctx.level >= 3) _fxPool(ctx, 'Celestial Revelation', 1, 'long'); });
sktDefineEffect(['2024:species:Large Form'], ctx => { if (ctx.level >= 5) _fxPool(ctx, 'Large Form', 1, 'long'); });
sktDefineEffect(['2024:species:Skillful'], ctx => { /* applied as a species skill pick */ });

// ---- Feats
sktDefineEffect(['feat:Alert'], ctx => { ctx.initBonus += ctx.edition === '2024' ? ctx.pb : 5; });
sktDefineEffect(['feat:Tough'], ctx => { ctx.hpPerLevel += 2; });
sktDefineEffect(['feat:Mobile'], ctx => { ctx.speedBonus += 10; });
sktDefineEffect(['2024:feat:Speedy'], ctx => { ctx.speedBonus += 10; });
sktDefineEffect(['2014:feat:Observant'], ctx => { ctx.passiveBonus.perception += 5; ctx.passiveBonus.investigation += 5; });
sktDefineEffect(['feat:Lucky'], ctx => {
  _fxPool(ctx, 'Luck Points', ctx.edition === '2024' ? ctx.pb : 3, 'long');
});
sktDefineEffect(['feat:Medium Armor Master'], ctx => { ctx.mediumDexCap = 3; });
sktDefineEffect(['feat:Durable'], ctx => _fxNote(ctx, 'Durable: when you roll a Hit Die to regain hit points, the minimum is twice your Constitution modifier.'));
sktDefineEffect(['2014:feat:Dual Wielder'], ctx => { ctx.dualWielder = true; });
sktDefineEffect(['feat:Heavily Armored', 'feat:Moderately Armored', 'feat:Lightly Armored'], ctx => { /* proficiencies applied by name below */ });
// 2024 Fighting Style feats, and 2014 Fighting Style optional features.
sktDefineEffect(['feat:Defense', 'optional:Defense'], ctx => { ctx.armoredAcBonus += 1; });
sktDefineEffect(['feat:Archery', 'optional:Archery'], ctx => { ctx.rangedAttackBonus += 2; });
sktDefineEffect(['feat:Dueling', 'optional:Dueling'], ctx => { ctx.duelingBonus = 2; });
sktDefineEffect(['feat:Two-Weapon Fighting', 'optional:Two-Weapon Fighting'], ctx => { ctx.twoWeaponMod = true; });
sktDefineEffect(['feat:Great Weapon Fighting', 'optional:Great Weapon Fighting'], ctx => _fxNote(ctx, 'Great Weapon Fighting: with a two-handed or versatile weapon held in two hands, treat 1s and 2s on damage dice as 3s (2024) or reroll them (2014).'));
// Eldritch Invocations that change numbers.
sktDefineEffect(['optional:Agonizing Blast'], ctx => { ctx.agonizingBlast = true; });
sktDefineEffect(['optional:Armor of Shadows'], ctx => _fxNote(ctx, 'Armor of Shadows: cast Mage Armor on yourself at will (AC 13 + Dexterity).'));
sktDefineEffect(['optional:Devil\'s Sight'], ctx => { ctx.notes.push('Devil’s Sight: see normally in darkness, magical or not, to 120 feet.'); });

// Features whose mechanics come from the data or from a choice the builder
// asks for, rather than from prose. Listed so the coverage count is honest:
// the work is done, just not here.
sktDefineEffect(['class:Spellcasting', 'class:Pact Magic'], () => {});          // sktBuildSpellcasting
sktDefineEffect(['class:Fighting Style'], () => {});                            // the chosen style's own effect
sktDefineEffect(['class:Weapon Mastery'], () => {});                            // build.masteries → attacks
sktDefineEffect(['class:Expertise'], () => {});                                 // build.expertise
sktDefineEffect(['class:Eldritch Invocations', 'class:Metamagic'], () => {});   // optional-feature choices
sktDefineEffect(['class:Epic Boon'], () => {});                                 // a feat chosen at 19
sktDefineEffect(['species:Darkvision', 'species:Superior Darkvision'], ctx => {
  const sp = sktRulesSpecies(ctx.R, ctx.build.species);
  const sr = sp && sp.subraces.find(s => s.name === ctx.build.subspecies);
  ctx.senses.darkvision = Math.max(ctx.senses.darkvision || 0, (sr && sr.darkvision) || (sp && sp.darkvision) || 60);
});
sktDefineEffect(['species:Dwarven Resilience'], ctx => { ctx.resist.add('poison'); _fxNote(ctx, 'Advantage on saving throws to avoid or end the Poisoned condition.'); });
sktDefineEffect(['species:Fey Ancestry'], ctx => _fxNote(ctx, 'Advantage on saving throws against being Charmed; magic can’t put you to sleep (2014).'));
sktDefineEffect(['species:Brave'], ctx => _fxNote(ctx, 'Advantage on saving throws against being Frightened.'));
sktDefineEffect(['species:Gnome Cunning', 'species:Gnomish Cunning'], ctx => _fxNote(ctx, 'Advantage on Intelligence, Wisdom and Charisma saving throws against magic.'));
sktDefineEffect(['species:Hellish Resistance'], ctx => { ctx.resist.add('fire'); });
sktDefineEffect(['species:Damage Resistance'], ctx => { /* ancestry-based; from build.speciesChoice */ });
sktDefineEffect(['species:Dwarven Combat Training', 'species:Elf Weapon Training', 'species:Tool Proficiency'], () => {});  // data proficiencies
sktDefineEffect(['species:Trance'], ctx => _fxNote(ctx, 'Trance: a long rest takes 4 hours.'));
sktDefineEffect(['feat:Savage Attacker'], ctx => _fxNote(ctx, 'Savage Attacker: once per turn, roll a weapon’s damage dice twice and use either roll.'));
sktDefineEffect(['feat:Ability Score Improvement'], () => {});                  // build.asi / featChoices
sktDefineEffect(['feat:Skilled'], () => {});                                    // featChoices.skills
sktDefineEffect(['feat:Resilient'], () => {});                                  // featChoices.save + inc

// Which features of a build the engine applies, and which are text only.
function sktFeatureCoverage(build, R){
  const list = sktBuildFeatures(build, R).filter(f => !f.info);
  return { total: list.length, mechanical: list.filter(f => f.mech).length,
           textOnly: list.filter(f => !f.mech).map(f => f.from + ': ' + f.name) };
}

// ── The sheet ────────────────────────────────────────────────────────────────
// build + data → a party record. Matches the shape the PDF import produces
// and every panel reads: abilities, saves and skills as modifiers, hit dice,
// spell slots as { total, expended }, resources as pools, attacks as
// { name, atkBonus, damage } — plus `build`, `rules`, and structured
// `sheet.activations` and `sheet.featureList` the PDF route never had.
function sktComputeCharacter(build, R, prior){
  prior = prior || {};
  const cls = sktRulesClass(R, build.cls), sub = sktRulesSubclass(cls, build.subclass);
  const L = Math.max(1, Math.min(20, +build.level || 1));
  const pb = sktProfBonus(L);
  const species = sktRulesSpecies(R, build.species);
  const subrace = species && species.subraces.find(s => s.name === build.subspecies);
  const bg = sktRulesBackground(R, build.background);
  const abilities = sktBuildAbilities(build, R);

  const ctx = {
    build, R, edition: R.edition, cls, sub, level: L, pb, abilities,
    mod: {}, acOptions: [], armoredAcBonus: 0, mediumDexCap: 2,
    hpPerLevel: 0, speedBonus: 0, speedBonusUnlessHeavy: 0, speedBonusUnarmored: 0,
    initBonus: 0, saveBonusAll: 0, passiveBonus: { perception: 0, investigation: 0, insight: 0 },
    saveProf: new Set((cls && cls.saves) || []), skillProf: new Set(), expertise: new Set(build.expertise || []),
    armorProf: new Set(), weaponProf: new Set(), weaponPropRules: [], toolProf: new Set(), languages: new Set(),
    resources: [], actions: [], notes: [], attacksPerAction: 1, critRange: 20,
    rangedAttackBonus: 0, duelingBonus: 0, twoWeaponMod: false,
    abilityBonus: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, abilityCapBonus: {},
    jackOfAllTrades: false, remarkableAthlete: false, martialArts: false, martialArtsDie: null,
    sneakAttack: null, rageDamage: 0, agonizingBlast: false, resist: new Set(),
    senses: { darkvision: 0 }, skillBonus: {}, immune: new Set(), cantripDamageBonus: 0,
  };
  SKT_ABS.forEach(k => { ctx.mod[k] = sktMod(abilities[k]); });

  // Proficiencies from the class, species, background and feats.
  ((cls && cls.armor) || []).forEach(a => ctx.armorProf.add(typeof a === 'string' ? sktRulesInline(a).toLowerCase() : 'shield'));
  // Weapon proficiencies come three ways: a category ("simple"), a named
  // weapon written as an item tag whose display text is a plural
  // ("{@item rapier|phb|rapiers}" — the name is the first part, not the
  // display), and in 2024 a property-limited category ("Martial weapons
  // that have the Finesse or Light property").
  ((cls && cls.weapons) || []).forEach(w => {
    if (typeof w !== 'string') return;
    const tag = /^\{@item ([^|}]+)/i.exec(w);
    if (tag){ ctx.weaponProf.add(tag[1].toLowerCase().trim()); return; }
    const filt = /^(Simple|Martial) weapons that have the .*property=([a-z;]+)/i.exec(w);
    if (filt){
      const props = filt[2].split(';').map(p => ({ finesse: 'F', light: 'L', thrown: 'T', versatile: 'V', reach: 'R', heavy: 'H' }[p] || p));
      ctx.weaponPropRules.push({ cat: filt[1].toLowerCase(), props });
      return;
    }
    ctx.weaponProf.add(sktRulesInline(w).toLowerCase().replace(/ weapons?$/, '').trim());
  });
  (build.skills || []).forEach(k => ctx.skillProf.add(k));
  (build.speciesSkills || []).forEach(k => ctx.skillProf.add(k));
  (build.bgSkills || []).forEach(k => ctx.skillProf.add(k));
  [species, subrace].forEach(s => {
    if (!s) return;
    (s.skills || []).forEach(o => Object.keys(o).forEach(k => { const sk = sktSkillKey(k); if (sk && o[k] === true) ctx.skillProf.add(sk); }));
    (s.weapons || []).forEach(o => Object.keys(o).forEach(k => { if (o[k] === true) ctx.weaponProf.add(sktRefName(k)); }));
    (s.armor || []).forEach(o => Object.keys(o).forEach(k => { if (o[k] === true) ctx.armorProf.add(k); }));
    (s.resist || []).forEach(r => { if (typeof r === 'string') ctx.resist.add(r); });
    (s.languages || []).forEach(o => Object.keys(o).forEach(k => { if (o[k] === true) ctx.languages.add(_sktTitle(k)); }));
  });
  if (bg){
    (bg.skills || []).forEach(o => Object.keys(o).forEach(k => { const sk = sktSkillKey(k); if (sk && o[k] === true) ctx.skillProf.add(sk); }));
    (bg.tools || []).forEach(o => Object.keys(o).forEach(k => { if (o[k] === true) ctx.toolProf.add(sktRefName(k)); }));
  }
  (build.languages || []).forEach(l => ctx.languages.add(l));
  (build.tools || []).forEach(t => ctx.toolProf.add(t));
  if (R.edition === '2024') ctx.languages.add('Common');
  const feats = sktBuildFeatNames(build, R);
  feats.forEach(n => {
    const f = sktRulesFeat(R, n), ch = build.featChoices[n] || {};
    if (!f) return;
    (ch.skills || []).forEach(k => ctx.skillProf.add(k));
    (ch.expertise || []).forEach(k => ctx.expertise.add(k));
    if (ch.save) ctx.saveProf.add(ch.save);
    if (/heavily armored/i.test(n)) ctx.armorProf.add('heavy');
    if (/moderately armored/i.test(n)) { ctx.armorProf.add('medium'); ctx.armorProf.add('shield'); }
    if (/lightly armored/i.test(n)) ctx.armorProf.add('light');
    (f.resist || []).forEach(r => { if (typeof r === 'string') ctx.resist.add(r); });
  });

  // Feature effects, in level order.
  const features = sktBuildFeatures(build, R);
  features.forEach(f => {
    if (f.info) return;
    const fx = sktFeatureEffect(f.name, f.from, R.edition, cls && cls.key);
    if (fx){ try { fx(ctx); } catch(e){ ctx.notes.push('Could not apply ' + f.name + ': ' + e.message); } }
    const ch = sktFeatureChoice(f.name, f.from, R.edition, cls && cls.key);
    const v = ch && (build.featureChoices || {})[f.name];
    if (ch && v && ch.apply){ try { ch.apply(ctx, v); } catch(e){ ctx.notes.push('Could not apply ' + f.name + ': ' + e.message); } }
  });
  // Primal Champion and the like raise a score after everything else.
  SKT_ABS.forEach(k => {
    if (!ctx.abilityBonus[k]) return;
    abilities[k] = Math.min(ctx.abilityCapBonus[k] || 20, abilities[k] + ctx.abilityBonus[k]);
    ctx.mod[k] = sktMod(abilities[k]);
  });

  // Saving throws and skills, as the modifiers the sheet stores.
  const saves = {};
  SKT_ABS.forEach(k => { saves[k] = ctx.mod[k] + (ctx.saveProf.has(k) ? pb : 0) + ctx.saveBonusAll; });
  const skills = {}, skillProfOut = {};
  Object.keys(SKT_SKILLS).forEach(sk => {
    const ab = SKT_SKILLS[sk];
    let bonus = 0, prof = 0;
    if (ctx.expertise.has(sk) && ctx.skillProf.has(sk)){ bonus = pb * 2; prof = 2; }
    else if (ctx.skillProf.has(sk)){ bonus = pb; prof = 1; }
    else if (ctx.jackOfAllTrades) bonus = Math.floor(pb / 2);
    else if (ctx.remarkableAthlete && ['str', 'dex', 'con'].includes(ab)) bonus = Math.ceil(pb / 2);
    skills[sk] = ctx.mod[ab] + bonus + (ctx.skillBonus[sk] || 0);
    if (prof) skillProfOut[sk] = prof;
  });

  // Hit points: the full hit die at level 1, then the average or the rolls.
  const hd = (cls && cls.hd) || 8;
  let hpMax = 0;
  for (let lv = 1; lv <= L; lv++){
    const roll = lv === 1 ? hd
      : (build.hp && build.hp.method === 'rolled' && build.hp.rolls && build.hp.rolls[lv])
        ? Math.max(1, Math.min(hd, +build.hp.rolls[lv])) : Math.floor(hd / 2) + 1;
    hpMax += Math.max(1, roll + ctx.mod.con) + ctx.hpPerLevel;
  }

  // Equipment → armour, shield and weapons.
  const gear = sktBuildEquipment(build, R);
  const armor = gear.armor, shield = gear.shield;
  let acArmor;
  if (armor){
    const t = String(armor.type || '').split('|')[0];
    const dex = t === 'HA' ? 0 : t === 'MA' ? Math.min(ctx.mediumDexCap, ctx.mod.dex) : ctx.mod.dex;
    acArmor = { label: armor.name, value: (+armor.ac || 10) + dex + ctx.armoredAcBonus };
  }
  const candidates = [];
  if (acArmor) candidates.push({ ...acArmor, shieldOk: true });
  else {
    candidates.push({ label: 'Unarmored', value: 10 + ctx.mod.dex, shieldOk: true });
    ctx.acOptions.forEach(o => { if (!o.noArmor || !armor) candidates.push(o); });
  }
  const best = candidates.map(c => ({ ...c, total: c.value + (shield && c.shieldOk !== false ? (+shield.ac || 2) : 0) }))
    .sort((a, b) => b.total - a.total)[0];
  const ac = best ? best.total : 10;

  // Speed.
  const baseSpeed = typeof (subrace && subrace.speed) === 'number' ? subrace.speed
    : typeof (species && species.speed) === 'number' ? species.speed
    : (species && species.speed && species.speed.walk) || 30;
  const heavy = armor && String(armor.type).split('|')[0] === 'HA';
  let speed = baseSpeed + ctx.speedBonus + (heavy ? 0 : ctx.speedBonusUnlessHeavy) + (!armor && !shield ? ctx.speedBonusUnarmored : 0);
  if (heavy && armor.strength && abilities.str < +armor.strength) speed -= 10;

  // Initiative and passive perception.
  let init = ctx.mod.dex + ctx.initBonus;
  if (R.edition === '2014' && ctx.jackOfAllTrades) init += Math.floor(pb / 2);
  if (R.edition === '2014' && ctx.remarkableAthlete) init += Math.ceil(pb / 2);
  const passive = 10 + skills.perception + ctx.passiveBonus.perception;

  // Spellcasting.
  const sc = sktBuildSpellcasting(build, R, abilities);
  const spellSlots = {};
  if (sc) Object.keys(sc.slots).forEach(l => {
    const was = prior.sheet && prior.sheet.spellSlots && prior.sheet.spellSlots[l];
    spellSlots[l] = { total: sc.slots[l], expended: was ? Math.min(was.expended || 0, sc.slots[l]) : 0 };
  });
  if (sc && sc.pact) spellSlots[sc.pact.level].pact = true;

  // Attacks: weapons carried, an unarmed strike, and attack cantrips.
  const attacks = sktBuildAttacks(ctx, gear, sc);

  // Hit dice, and the spells on the sheet.
  const spellNames = [...(build.cantrips || []), ...(build.spells || [])];
  const always = sktBuildAlwaysPrepared(build, R);
  always.forEach(s => { if (!spellNames.includes(s)) spellNames.push(s); });

  // Resources keep what has been SPENT across a recompute: levelling up
  // mid-adventure does not hand back a used Rage, and a full pool that grows
  // stays full (Lay on Hands 15/15 becomes 20/20, not 15/20).
  const resources = ctx.resources.map(r => {
    const was = (prior.resources || []).find(x => x.name === r.name);
    if (!was || r.type !== 'pool') return r;
    const spent = Math.max(0, (+was.max || 0) - (+was.current || 0));
    return { ...r, current: Math.max(0, r.max - spent) };
  });

  const featureList = features.map(f => ({ name: f.name, from: f.from, level: f.level, mech: f.mech, text: f.text }));
  const subName = sub ? sub.shortName : '';
  const speciesLabel = species ? (subrace ? subrace.name + ' ' + species.name : species.name) : '';
  const hpWas = typeof prior.hp === 'number' && typeof prior.hpMax === 'number' ? prior.hp + (hpMax - prior.hpMax) : hpMax;

  return {
    name: build.name || 'New Character',
    cls: cls ? cls.key : '', subclass: subName, level: L,
    race: speciesLabel, background: build.background || '',
    icon: build.icon || prior.icon || _SKT_CLASS_ICON[cls && cls.key] || '⚔',
    hp: Math.max(0, Math.min(hpMax, hpWas)), hpMax, ac, init, spd: speed, pp: passive,
    tempHp: prior.tempHp || 0, inspiration: !!prior.inspiration,
    abilities, resources, feats,
    hitDice: { current: prior.hitDice ? Math.min(L, prior.hitDice.current + Math.max(0, L - (prior.hitDice.max || L))) : L,
               max: L, dieType: 'd' + hd },
    resistances: [...ctx.resist],
    immunities: [...ctx.immune],
    rules: R.edition,
    build: JSON.parse(JSON.stringify(build)),
    sheet: {
      skills, skillProf: skillProfOut, saves, saveProf: [...ctx.saveProf], profBonus: pb, passivePerception: passive,
      classLevels: cls ? [{ cls: cls.key, level: L }] : [],
      languages: [...ctx.languages].join(', '),
      proficiencies: { armor: [...ctx.armorProf].filter(Boolean), weapons: [...ctx.weaponProf].filter(Boolean),
                       weaponRules: ctx.weaponPropRules, tools: [...ctx.toolProf].filter(Boolean) },
      attacks, attacksPerAction: ctx.attacksPerAction, critRange: ctx.critRange,
      spellSlots, spellSaveDc: sc ? sc.dc : null, spellAtkBonus: sc ? sktSigned(sc.attack) : null,
      spellAbility: sc ? sc.ability : null,
      spells: spellNames, alwaysPrepared: always,
      activations: ctx.actions, notes: ctx.notes, featureList,
      equipment: gear.list, acSource: best ? best.label + (shield ? ' + Shield' : '') : '',
      senses: [ctx.senses.darkvision ? 'Darkvision ' + ctx.senses.darkvision + ' ft.' : '',
               ctx.senses.blindsight ? 'Blindsight ' + ctx.senses.blindsight + ' ft.' : ''].filter(Boolean).join(', '),
      bio: { features: featureList.map(f => '* ' + f.name + '\n' + f.text).join('\n\n') },
    },
  };
}
const _SKT_CLASS_ICON = { barbarian: '🪓', bard: '🎵', cleric: '✨', druid: '🌿', fighter: '⚔', monk: '👊',
                          paladin: '🛡', ranger: '🏹', rogue: '🗡', sorcerer: '🔥', warlock: '👁', wizard: '📘' };

// Domain spells, oath spells and the like — always prepared, from the
// subclass (and 2014 species) additionalSpells, up to the current level.
function sktBuildAlwaysPrepared(build, R){
  const cls = sktRulesClass(R, build.cls), sub = sktRulesSubclass(cls, build.subclass);
  const out = [];
  const take = (spec) => {
    (spec || []).forEach(block => {
      ['prepared', 'known'].forEach(kind => {
        const by = block && block[kind]; if (!by) return;
        Object.keys(by).forEach(lv => {
          if (+String(lv).replace(/\D/g, '') > (build.level || 1)) return;
          (Array.isArray(by[lv]) ? by[lv] : []).forEach(s => {
            if (typeof s !== 'string') return;
            // The spell's own name, not a title-cased guess at it: "Shield
            // of Faith", which the spell picker can then recognise and not
            // charge a pick for.
            const sp = sktRulesSpell(R, s);
            out.push(sp ? sp.name : _sktTitle(s.split('|')[0].replace(/#c$/, '')));
          });
        });
      });
    });
  };
  if (sub) take(sub.additionalSpells && sub.additionalSpells.length === 1 ? sub.additionalSpells : null);
  return [...new Set(out)];
}

// ── Equipment ────────────────────────────────────────────────────────────────
// The starting kit for a choice letter ("A", "B"…), from the data's
// defaultData, plus any individual items the player added. Returns the
// armour and shield worn (the best the character is proficient with) and
// the weapons carried.
function sktBuildEquipment(build, R){
  const cls = sktRulesClass(R, build.cls), bg = sktRulesBackground(R, build.background);
  const eq = build.equipment || {};
  const names = [];
  let gold = 0;
  // A kit is a list of blocks. Each block has fixed items under "_" and, if
  // there is a choice, its options under letters ("A"/"B"/"C" in 2024, a
  // single block; "a"/"b"/"c" in 2014, one block per choice line).
  const takeBlocks = (blocks, kind) => {
    (blocks || []).forEach((block, i) => {
      const letters = Object.keys(block).filter(k => k !== '_');
      const want = kind === 'cls'
        ? (R.edition === '2024' ? eq.cls : (eq.clsBlocks || [])[i])
        : (R.edition === '2024' ? eq.bg : (eq.bgBlocks || [])[i]);
      const letter = letters.length ? (letters.includes(want) ? want : letters[0]) : null;
      [].concat(block._ || [], letter ? (block[letter] || []) : []).forEach((it, j) => {
        if (typeof it === 'string'){ names.push(sktRefName(it)); return; }
        if (it.value){ gold += it.value / 100; return; }
        if (it.containsValue){ gold += it.containsValue / 100; }
        if (it.item){
          const q = /arrow|bolt|needle|bullet/.test(it.item) ? 1 : (it.quantity || 1);
          for (let n = 0; n < q; n++) names.push(sktRefName(it.item));
          return;
        }
        if (it.equipmentType){
          const k = kind + ':' + i + ':' + j;
          const pick = (eq.picks || {})[k] || _SKT_EQ_DEFAULT[it.equipmentType];
          if (pick) for (let n = 0; n < (it.quantity || 1); n++) names.push(String(pick).toLowerCase());
        }
      });
    });
  };
  if (cls && cls.equipment && Array.isArray(cls.equipment.defaultData)) takeBlocks(cls.equipment.defaultData, 'cls');
  if (bg) takeBlocks(bg.equipment, 'bg');
  (eq.extra || []).forEach(n => names.push(String(n).toLowerCase()));
  const items = names.map(n => R.items[n]).filter(Boolean);
  const armors = items.filter(i => /^(LA|MA|HA)/.test(String(i.type)));
  const shield = items.find(i => /^S(\||$)/.test(String(i.type))) || null;
  const weapons = items.filter(i => /^(M|R)(\||$)/.test(String(i.type)));
  // Wear the armour that gives the best AC; a wizard handed chain mail by a
  // background does not put it on.
  const armor = armors.sort((a, b) => (+b.ac || 0) - (+a.ac || 0))[0] || null;
  return { armor, shield, weapons, gold: Math.round(gold * 100) / 100, list: names.map(_sktTitle) };
}
// What "any martial weapon" becomes until the player picks one.
const _SKT_EQ_DEFAULT = {
  weaponMartial: 'longsword', weaponMartialMelee: 'longsword', weaponMartialRanged: 'longbow',
  weaponSimple: 'spear', weaponSimpleMelee: 'handaxe', weaponSimpleRanged: 'light crossbow',
};
// The weapons that can fill a placeholder, for the builder's dropdown.
function sktEquipmentOptions(R, type){
  const all = Object.values(R.items).filter(i => /^(M|R)(\||$)/.test(String(i.type)) && i.weaponCategory);
  const cat = /Martial/.test(type) ? 'martial' : /Simple/.test(type) ? 'simple' : null;
  const rng = /Ranged/.test(type) ? 'R' : /Melee/.test(type) ? 'M' : null;
  if (!cat) return [];
  return all.filter(i => i.weaponCategory === cat && (!rng || String(i.type).split('|')[0] === rng))
    .map(i => i.name).filter((n, k, a) => a.indexOf(n) === k).sort();
}

// ── Attacks ──────────────────────────────────────────────────────────────────
function sktBuildAttacks(ctx, gear, sc){
  const out = [];
  const pb = ctx.pb, m = ctx.mod;
  const prof = w => {
    const cat = String(w.weaponCategory || '').toLowerCase();
    const props = (w.property || []).map(p => String(p).split('|')[0]);
    return ctx.weaponProf.has(cat) || ctx.weaponProf.has(w.name.toLowerCase())
      || ctx.weaponPropRules.some(r => r.cat === cat && r.props.some(p => props.includes(p)))
      || (ctx.martialArts && cat === 'simple');
  };
  const seen = new Set();
  (gear.weapons || []).forEach(w => {
    if (seen.has(w.name)) return; seen.add(w.name);
    const props = (w.property || []).map(p => String(p).split('|')[0]);
    const ranged = String(w.type).split('|')[0] === 'R';
    const finesse = props.includes('F');
    let ab = ranged ? m.dex : (finesse ? Math.max(m.str, m.dex) : m.str);
    // A monk's weapons use Dexterity if it is better (martial arts weapons).
    if (ctx.martialArts && !ranged && (String(w.weaponCategory) === 'simple' || props.includes('L'))) ab = Math.max(m.str, m.dex);
    const hit = ab + (prof(w) ? pb : 0) + (ranged ? ctx.rangedAttackBonus : 0);
    let dmgBonus = ab + (!ranged && !props.includes('2H') && ctx.duelingBonus ? ctx.duelingBonus : 0);
    let die = w.dmg1 || '1';
    if (ctx.martialArts && ctx.martialArtsDie && !ranged && _sktDieAvg(ctx.martialArtsDie) > _sktDieAvg(die)) die = ctx.martialArtsDie;
    const type = SKT_DMG[String(w.dmgType || '').charAt(0)] || '';
    const mastery = (w.mastery || [])[0] ? String(w.mastery[0]).split('|')[0] : '';
    out.push({
      name: _sktTitle(w.name), atkBonus: sktSigned(hit),
      damage: die + (dmgBonus ? (dmgBonus > 0 ? '+' : '') + dmgBonus : '') + (type ? ' ' + type : ''),
      versatile: w.dmg2 ? w.dmg2 + (dmgBonus ? sktSigned(dmgBonus) : '') : null,
      range: w.range || null,
      mastery: (ctx.build.masteries || []).map(s => s.toLowerCase()).includes(w.name.toLowerCase()) ? mastery : '',
      props,
    });
  });
  // Unarmed strike: 1 + Strength, or a martial arts die with the better of
  // Strength and Dexterity.
  const uab = ctx.martialArts ? Math.max(m.str, m.dex) : m.str;
  out.push({ name: 'Unarmed Strike', atkBonus: sktSigned(uab + pb),
             damage: (ctx.martialArts ? ctx.martialArtsDie + sktSigned(uab) : String(Math.max(1, 1 + m.str))) + ' bludgeoning' });
  // Attack cantrips the character knows.
  if (sc) (ctx.build.cantrips || []).forEach(n => {
    const s = sktRulesSpell(ctx.R, n); if (!s) return;
    const dice = _sktCantripDice(s, ctx.level); if (!dice) return;
    const type = (s.damageInflict || [])[0] || '';
    const isAttack = !!(s.spellAttack && s.spellAttack.length);
    let bonus = 0, beams = 0;
    // Eldritch Blast does not roll bigger dice as you level — it fires more
    // beams, each its own attack for 1d10.
    if (ctx.cantripDamageBonus) bonus += ctx.cantripDamageBonus;
    if (/eldritch blast/i.test(s.name)){
      beams = ctx.level >= 17 ? 4 : ctx.level >= 11 ? 3 : ctx.level >= 5 ? 2 : 1;
      if (ctx.agonizingBlast) bonus += m.cha;
    }
    out.push({
      name: s.name,
      atkBonus: isAttack ? sktSigned(sc.attack) : 'DC ' + sc.dc + ' ' + String((s.savingThrow || [''])[0]).slice(0, 3).toUpperCase(),
      damage: (beams ? '1d10' : dice) + (bonus ? sktSigned(bonus) : '') + (type ? ' ' + type : '') + (beams > 1 ? ' ×' + beams + ' beams' : ''),
      spell: true,
    });
  });
  return out;
}
function _sktDieAvg(d){ const m = /^(\d+)d(\d+)/.exec(String(d)); return m ? +m[1] * (+m[2] + 1) / 2 : +d || 0; }
function _sktCantripDice(s, level){
  const sl = s.scalingLevelDice;
  const block = Array.isArray(sl) ? sl[0] : sl;
  if (block && block.scaling){
    let dice = null;
    Object.keys(block.scaling).map(Number).sort((a, b) => a - b).forEach(at => { if (level >= at) dice = block.scaling[at]; });
    if (dice) return dice;
  }
  const m = /\{@damage (\d+d\d+)\}/.exec(JSON.stringify(s.entries || ''));
  return m ? m[1] : null;
}

// ── What still needs choosing ────────────────────────────────────────────────
// The builder asks these questions; the sheet is computed regardless. Each
// entry names a step and what is missing, so the builder can show a count
// on each step and refuse "Create" until the required ones are done.
function sktBuildTodo(build, R){
  const todo = [];
  const cls = sktRulesClass(R, build.cls);
  const L = build.level || 1;
  if (!build.name) todo.push({ step: 'basics', what: 'a name' });
  if (!build.species) todo.push({ step: 'species', what: 'a species' });
  if (!cls) { todo.push({ step: 'class', what: 'a class' }); return todo; }
  if (!build.background) todo.push({ step: 'background', what: 'a background' });
  if (L >= cls.subclassLevel && !build.subclass) todo.push({ step: 'class', what: 'a ' + sktRulesInline(cls.subclassTitle).toLowerCase() });
  if ((build.skills || []).length < cls.skillChoice.count) todo.push({ step: 'skills', what: (cls.skillChoice.count - (build.skills || []).length) + ' class skill' + (cls.skillChoice.count - (build.skills || []).length === 1 ? '' : 's') });
  const asiLevels = sktAsiLevels(cls, R).filter(l => l <= L);
  asiLevels.forEach(l => { if (!build.asi[l]) todo.push({ step: 'levels', what: 'level ' + l + ' ability score improvement or feat' }); });
  const sc = sktBuildSpellcasting(build, R, sktBuildAbilities(build, R));
  if (sc){
    if ((build.cantrips || []).length < sc.cantrips) todo.push({ step: 'spells', what: (sc.cantrips - build.cantrips.length) + ' cantrip(s)' });
    const want = sc.prepared || sc.known;
    if (want && (build.spells || []).length < want) todo.push({ step: 'spells', what: (want - build.spells.length) + ' spell(s)', soft: true });
  }
  sktBuildChoices(build, R).forEach(c => { if (!c.value) todo.push({ step: 'levels', what: c.feature + ' choice' }); });
  sktOptionalChoices(build, R).forEach(o => {
    const have = ((build.optional || {})[o.name] || []).length;
    if (have < o.count) todo.push({ step: 'levels', what: (o.count - have) + ' × ' + o.name });
  });
  return todo;
}

// The levels a class gets an Ability Score Improvement (or a feat instead).
function sktAsiLevels(cls){
  if (!cls) return [];
  return cls.features.filter(f => /^Ability Score Improvement$/i.test(f.name)).map(f => f.level);
}

// Optional features chosen by count at a level: invocations, metamagic,
// 2014 fighting styles and pact boons (optionalfeatureProgression), and 2024
// fighting styles (featProgression, category FS). Returns
// [{ name, count, types:[featureType…], kind:'optional'|'feat' }].
function sktOptionalChoices(build, R){
  const cls = sktRulesClass(R, build.cls), sub = sktRulesSubclass(cls, build.subclass);
  const L = build.level || 1, out = [];
  const read = (prog) => {
    if (Array.isArray(prog)) return prog[Math.max(0, Math.min(19, L - 1))] || 0;
    let n = 0; Object.keys(prog || {}).forEach(lv => { if (L >= +lv) n = Math.max(n, prog[lv]); }); return n;
  };
  [cls, sub].forEach(src => (src && src.optionalfeatureProgression || []).forEach(p => {
    const n = read(p.progression);
    if (n > 0) out.push({ name: p.name, count: n, types: p.featureType || [], kind: 'optional' });
  }));
  (cls && cls.featProgression || []).forEach(p => {
    if (!(p.category || []).some(c => /^FS/.test(c))) return;
    const n = read(p.progression);
    if (n > 0) out.push({ name: p.name, count: n, types: p.category, kind: 'feat' });
  });
  return out;
}

if (typeof module !== 'undefined' && module.exports){
  module.exports = { sktSigned, sktDefineEffect, sktDefineChoice, sktBuildChoices, _fxPool, _fxAction, _fxNote, _fxCol, SKT_FEATURE_CHOICES,
                     sktRulesLoad, sktComputeCharacter, sktBuildEquipment, sktEquipmentOptions, sktBlankBuild, sktBuildTodo, sktBuildFeatures,
                     sktFeatureCoverage, sktRulesClass, sktRulesSubclass, sktSpellOptions, sktOptionalChoices,
                     sktAsiLevels, sktBuildSpellcasting, sktBuildAbilities, sktClassColumn, sktRulesText,
                     SKT_SKILLS, SKT_ABS, SKT_FEATURE_EFFECTS };
}
