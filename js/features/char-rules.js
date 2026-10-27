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
// Classes printed outside the handbook, as D&D Beyond offers them: the
// Artificer (Tasha's for 2014, Eberron: Forge of the Artificer for 2024).
const SKT_BOOK_CLASSES = ['artificer'];
// Books written for the 2024 rules. Everything else in the data is a 2014
// book (Xanathar's, Tasha's, Monsters of the Multiverse, the setting books).
const SKT_2024_ERA = new Set(['XPHB', 'XDMG', 'XMM', 'ABH', 'FRHoF', 'LFL', 'EFA']);
// D&D Beyond's content categories (Manage → Character Settings → Sources),
// all on for a new character there: Core Rules (the 2024 core books), Expanded
// Rules (the other 2024-era books), 2014 Core Rules, 2014 Expanded Rules
// (Xanathar's, Tasha's, Bigby's…), and Legacy — the older version of
// something that has a newer one beside it (the Half-Elf, now the Khoravar;
// Feeblemind, now Befuddlement).
const SKT_CORE_2024 = new Set(['XPHB', 'XDMG', 'XMM']);
const SKT_LEGACY_SRC = new Set(['PHB', 'DMG', 'MM']);
const SKT_SOURCE_CATS = [
  ['core', 'Core Rules', 'The 2024 Player’s Handbook, Dungeon Master’s Guide and Monster Manual'],
  ['expanded', 'Expanded Rules', 'The other 2024-era books — Heroes of Faerûn, Eberron: Forge of the Artificer, Lorwyn…'],
  ['core2014', '2014 Core Rules', 'The 2014 Player’s Handbook, Dungeon Master’s Guide and Monster Manual'],
  ['expanded2014', '2014 Expanded Rules', 'Xanathar’s, Tasha’s, Monsters of the Multiverse, Bigby’s and the other books of that era'],
  ['legacy', 'Legacy', 'The older version of something reprinted under a new name — the Half-Elf beside the Khoravar, Feeblemind beside Befuddlement'],
];
function sktSourceCat(src){ return SKT_CORE_2024.has(src) ? 'core' : SKT_2024_ERA.has(src) ? 'expanded' : SKT_LEGACY_SRC.has(src) ? 'core2014' : 'expanded2014'; }
// The categories a build has on. One saved before them: "other books" was the
// two expanded ones, the Legacy switch the 2014 core and legacy ones.
function sktSources(build){
  if (build && build.sources) return Object.assign({}, build.sources, { core: true });
  const ab = !!(build && build.allBooks), lg = !!(build && build.legacy);
  return { core: true, expanded: ab, expanded2014: ab, core2014: lg, legacy: lg };
}
const SKT_ALL_SOURCES = { core: true, expanded: true, core2014: true, expanded2014: true, legacy: true };
// Whether anything beyond the 2024 handbook is on (then every book's class lists count).
function sktExtraSources(build){
  if (build && build.edition === '2014') return !!build.allBooks;
  const S = sktSources(build); return !!(S.expanded || S.core2014 || S.expanded2014);
}
const SKT_POINT_BUY = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const SKT_STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
// Where each class wants its best scores, highest first: the order the
// standard array goes in when the builder suggests it (D&D Beyond's quick
// build does the same).
const SKT_ABILITY_ORDER = {
  barbarian: ['str', 'con', 'dex', 'wis', 'cha', 'int'], bard: ['cha', 'dex', 'con', 'wis', 'int', 'str'],
  cleric: ['wis', 'con', 'str', 'dex', 'cha', 'int'], druid: ['wis', 'con', 'dex', 'int', 'cha', 'str'],
  fighter: ['str', 'con', 'dex', 'wis', 'cha', 'int'], monk: ['dex', 'wis', 'con', 'str', 'int', 'cha'],
  paladin: ['str', 'cha', 'con', 'wis', 'dex', 'int'], ranger: ['dex', 'wis', 'con', 'str', 'int', 'cha'],
  rogue: ['dex', 'con', 'int', 'wis', 'cha', 'str'], sorcerer: ['cha', 'con', 'dex', 'wis', 'int', 'str'],
  warlock: ['cha', 'con', 'dex', 'wis', 'int', 'str'], wizard: ['int', 'con', 'dex', 'wis', 'cha', 'str'],
  artificer: ['int', 'con', 'dex', 'wis', 'cha', 'str'],
};
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
    // A filter link's text is its first part ({@filter 5th|spells|level=5}).
    // Read as the third, a warlock's pact slots were 1st level at every
    // level, and table headings read "level=0".
    .replace(/\{@filter ([^|}]*)[^}]*\}/g, '$1')
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
const _sktRulesReady = {};   // the same, once loaded
function sktRulesReader(base){
  base = base || 'data/';
  return p => fetch(base + p).then(r => { if (!r.ok) throw new Error(p + ': ' + r.status); return r.json(); });
}

async function sktRulesLoad(edition, read){
  edition = edition === '2014' ? '2014' : '2024';
  if (_sktRulesCache[edition] && !read) return _sktRulesCache[edition];
  read = read || sktRulesReader();
  const job = _sktRulesBuild(edition, read);
  if (read === undefined || !_sktRulesCache[edition]){ _sktRulesCache[edition] = job; job.then(R => { _sktRulesReady[edition] = R; }, () => {}); }
  return job;
}

// Picks one edition's entries from a data list holding every book: books of
// its era (plus, with `legacy`, 2014 books for a 2024 character, which the
// 2024 handbook allows for species and spells), copies resolved, reprints
// dropped, one entry per name.
function _sktEraPicker(edition, src){
  const era = s => edition === '2024' ? SKT_2024_ERA.has(s) : !SKT_2024_ERA.has(s);
  return (list, opts) => {
    opts = opts || {};
    list = list || [];
    const byKey = new Map(list.map(x => [x.name + '|' + x.source, x]));
    const cand = list.filter(x => (era(x.source) || (opts.legacy && !SKT_2024_ERA.has(x.source)))
                               && !(opts.skip || []).includes(x.source))
      .map(x => {
        if (!x._copy) return x;
        const base = byKey.get(x._copy.name + '|' + x._copy.source);
        const out = Object.assign({}, base || {}, x); delete out._copy;
        Object.keys(x).forEach(k => { if (x[k] === null) delete out[k]; });
        return out;
      });
    const have = new Set(cand.map(x => (x.name + '|' + x.source).toLowerCase()));
    const superseded = x => (x.reprintedAs || []).some(r => {
      const [n, s2] = String(typeof r === 'string' ? r : (r && r.uid) || '').split('|');
      return have.has((n + '|' + (s2 || '')).toLowerCase());
    });
    const kept = cand.filter(x => (opts.legacy && !era(x.source)) || !superseded(x))
      .map(x => superseded(x) ? Object.assign({}, x, { _superseded: true }) : x);
    const rank = x => (x.source === src ? 0 : SKT_2024_ERA.has(x.source) === (edition === '2024') ? 1 : 2) * 2 + (x._superseded ? 1 : 0);
    kept.sort((a, b) => rank(a) - rank(b));
    const seen = new Set();
    return kept.filter(x => !seen.has(x.name) && seen.add(x.name));
  };
}

async function _sktRulesBuild(edition, read){
  const src = SKT_EDITION_SRC[edition];
  const classFiles = await Promise.all(SKT_CORE_CLASSES.map(c => read('class/class-' + c + '.json'))
    .concat(SKT_BOOK_CLASSES.map(c => read('class/class-' + c + '.json').catch(() => ({})))));
  const [races, backgrounds, feats, optional, base, spellIndex, spellSources, languages, books] = await Promise.all([
    read('races.json'), read('backgrounds.json'), read('feats.json'), read('optionalfeatures.json'),
    read('items-base.json'), read('spells/index.json').catch(() => ({ [src]: 'spells-' + src.toLowerCase() + '.json' })),
    read('spells/sources.json'), read('languages.json').catch(() => ({ language: [] })),
    read('books.json').catch(() => ({ book: [] })),
  ]);
  // Every book's spells: the core book's always, the others for "other books".
  const spellFiles = await Promise.all(Object.keys(spellIndex).map(k =>
    read('spells/' + spellIndex[k]).catch(() => (k === src ? Promise.reject(new Error('spells ' + k)) : { spell: [] }))));

  const R = { edition, src, classes: [], species: [], backgrounds: [], feats: [], optional: [],
              spells: [], items: {}, languages: [], bookNames: {} };
  (books.book || []).forEach(b => { R.bookNames[b.id] = b.name; });

  // Classes, their features by level, and their subclasses.
  classFiles.forEach(file => {
    // The handbook's printing, or for a class it doesn't have, this
    // edition's printing from the class's own book.
    const cls = (file.class || []).find(c => c.source === src)
      || (file.class || []).find(c => (c.edition === 'one') === (edition === '2024'));
    if (!cls) return;
    const csrc = cls.source;
    const feats = (file.classFeature || []).filter(f => f.classSource === csrc && f.source === csrc);
    const featureAt = (name, level) => feats.find(f => f.name === name && f.level === level);
    const features = [];
    (cls.classFeatures || []).forEach(ref => {
      const s = typeof ref === 'string' ? ref : ref.classFeature;
      const [name, , , lvl, fsrc] = String(s).split('|');
      const level = +lvl;
      // The 2014 class lists Tasha's optional features alongside the PHB
      // ones ("Martial Versatility|Fighter||4|TCE"). Kept, marked optional,
      // with the feature each replaces; used only when the build turns them on.
      if (fsrc && fsrc !== csrc){
        if (fsrc !== 'TCE' || edition !== '2014') return;
        const of = (file.classFeature || []).find(x => x.name === name && x.level === level && x.source === 'TCE');
        const first = sktRulesText((of && of.entries || [])[0] || '');
        const rep = /replaces the ([A-Z][\w' ]+?) feature/.exec(first);
        features.push({ name, level, entries: of ? of.entries : [], optional: true, replaces: rep ? rep[1].trim() : null });
        return;
      }
      const f = featureAt(name, level);
      features.push({ name, level, entries: f ? f.entries : [],
                      gainSubclass: !!(ref && ref.gainSubclassFeature) });
    });
    // A 2014 subclass offered for the 2024 class is a copy of its 2014 entry
    // ("_copy"): its spells, spellcasting and tables come from that entry.
    const subKey = s => [s.shortName, s.source, s.className, s.classSource].join('|');
    const subBy = new Map((file.subclass || []).map(s => [subKey(s), s]));
    const resolve = (sc, depth) => {
      if (!sc._copy || depth > 3) return sc;
      const base = subBy.get(subKey(sc._copy));
      const out = Object.assign({}, base ? resolve(base, (depth || 0) + 1) : {}, sc);
      delete out._copy;
      return out;
    };
    // Its features come at the 2024 class's subclass levels, by the copy's
    // own list: a 2014 domain's 1st- and 2nd-level features at 3rd, Divine
    // Strike (8th) dropped for Blessed Strikes — as D&D Beyond has them.
    // Old level → new level; a level not in the map is dropped.
    const legacyLevels = raw => {
      if (!raw._copy || !Array.isArray(raw.subclassFeatures)) return null;
      const map = new Map();
      raw.subclassFeatures.forEach(ref => {
        const [name, , rsrc, , , lvl] = String(typeof ref === 'string' ? ref : ref.subclassFeature).split('|');
        const level = +lvl;
        const own = rsrc === csrc && (file.subclassFeature || []).find(f => f.name === name && f.classSource === csrc
          && f.subclassShortName === raw.shortName && f.subclassSource === raw.source && f.level === level);
        map.set(own && own._copy ? +own._copy.level : level, level);
      });
      return map;
    };
    const subclasses = (file.subclass || []).filter(sc => sc.classSource === csrc).map(raw => Object.assign(resolve(raw), { _levels: legacyLevels(raw) })).map(sc => ({
      name: sc.name, shortName: sc.shortName, source: sc.source,
      core: sc.source === csrc,
      additionalSpells: sc.additionalSpells || null,
      spellcastingAbility: sc.spellcastingAbility || null,
      casterProgression: sc.casterProgression || null,
      cantripProgression: sc.cantripProgression || null,
      spellsKnownProgression: sc.spellsKnownProgression || null,
      preparedSpellsProgression: sc.preparedSpellsProgression || null,
      subclassTableGroups: sc.subclassTableGroups || null,
      optionalfeatureProgression: sc.optionalfeatureProgression || null,
      featProgression: sc.featProgression || null,
      // Matched on the subclass alone, not the class version: a 2014
      // subclass offered for the 2024 class keeps its features filed
      // under the 2014 class. Core-book features only for a core
      // subclass ("Maneuver Options" is Tasha's).
      features: (file.subclassFeature || [])
        .filter(f => f.subclassShortName === sc.shortName && f.subclassSource === sc.source
                  && (sc.source !== csrc || f.source === csrc)
                  // The copy's own entries repeat the 2014 ones, moved.
                  && !(sc._levels && f.classSource === csrc && f._copy))
        .map(f => ({ name: _SKT_FEATURE_NAME[f.name + '|' + f.source] || f.name, level: sc._levels && f.classSource !== csrc ? sc._levels.get(f.level) : f.level, entries: f.entries || [] }))
        .filter(f => f.level),
    })).map(sc => _sktOptionFeatures(sc));
    R.classes.push({
      name: cls.name, key: cls.name.toLowerCase(), source: cls.source, core: csrc === src,
      hd: (cls.hd && cls.hd.faces) || 8,
      saves: cls.proficiency || [],
      armor: (cls.startingProficiencies && cls.startingProficiencies.armor) || [],
      weapons: (cls.startingProficiencies && cls.startingProficiencies.weapons) || [],
      tools: (cls.startingProficiencies && cls.startingProficiencies.tools) || [],
      toolProfs: (cls.startingProficiencies && cls.startingProficiencies.toolProficiencies) || null,
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
      multiclassing: cls.multiclassing || null,
      tableGroups: cls.classTableGroups || [],
      subclassTitle: cls.subclassTitle || 'Subclass',
      subclassLevel: (features.find(f => f.gainSubclass) || {}).level || 3,
      features, subclasses,
    });
  });

  // Content from every book of this edition's era, each entry marked core
  // (the edition's own handbook) or not. The builder offers the core ones
  // unless "other books" is ticked. Reprints are dropped in favour of the
  // newer printing (Volo's Aasimar → Monsters of the Multiverse), and where
  // two books print the same name the core book wins, then the edition's era.
  const sp = _sktEraPicker(edition, src);

  sp(races.race, { skip: ['DMG'], legacy: edition === '2024' }).forEach(r => {
    const subOf = (races.subrace || []).filter(s => s.raceName === r.name && s.raceSource === r.source && s.name
                                                 && SKT_2024_ERA.has(s.source) === SKT_2024_ERA.has(r.source));
    const seenSub = new Set();
    const versions = (r._versions || []).filter(v => v && v.name && !v._abstract).map(v => _sktSpeciesVersion(r, v, src));
    // 2024 Elf, Gnome and Tiefling choose theirs through the lineage's
    // spells; the rest pick a version like a subrace.
    const byLineage = edition === '2024' && Array.isArray(r.additionalSpells) && r.additionalSpells.length > 1;
    if (byLineage) versions.forEach(v => { v.additionalSpells = null; v.overrides = v.overrides.filter(k => k !== 'additionalSpells'); });
    R.species.push({
      name: r.name, source: r.source, core: r.source === src, superseded: !!r._superseded,
      ability: r.ability || null, lineage: !!r.lineage, speed: r.speed, size: r.size || ['M'],
      darkvision: r.darkvision || 0, resist: r.resist || [],
      languages: r.languageProficiencies || [], skills: r.skillProficiencies || [],
      weapons: r.weaponProficiencies || [], tools: r.toolProficiencies || [],
      armor: r.armorProficiencies || [], feats: r.feats || null,
      additionalSpells: r.additionalSpells || null,
      entries: r.entries || [],
      versions: byLineage ? versions : [],
      // Draconic ancestries (2024 Dragonborn, Fizban's chromatic, gem and
      // metallic): each colour's damage type and resistance.
      ancestries: _sktAncestries(r),
      // A plain option exists (the 2014 Human's subrace is only "Variant").
      subraceOptional: (races.subrace || []).some(s => s.raceName === r.name && s.raceSource === r.source && !s.name)
        || (!byLineage && versions.length > 0 && versions.every(v => v.optional)),
      subraces: (byLineage || !versions.length ? [] : versions).concat(subOf.sort((x, y) => (y.source === src) - (x.source === src))
        .filter(s => !seenSub.has(s.name) && seenSub.add(s.name)).map(s => ({
        name: s.name, source: s.source, core: s.source === src && r.source === src,
        ability: s.ability || null, speed: s.speed, darkvision: s.darkvision,
        resist: s.resist || [], skills: s.skillProficiencies || [], weapons: s.weaponProficiencies || [],
        armor: s.armorProficiencies || [], languages: s.languageProficiencies || [],
        tools: s.toolProficiencies || [],
        feats: s.feats || null, additionalSpells: s.additionalSpells || null, entries: s.entries || [],
      }))),
    });
  });

  // 2014 backgrounds in a 2024 build too (with the 2014 books on): they ask for the 2024 parts (sktBgNeedsAdapt).
  sp(backgrounds.background, { legacy: edition === '2024' }).forEach(b => {
    R.backgrounds.push({
      name: b.name, source: b.source, core: b.source === src,
      ability: b.ability || null, feats: b.feats || null,
      skills: b.skillProficiencies || [], tools: b.toolProficiencies || [],
      languages: b.languageProficiencies || [], equipment: b.startingEquipment || [],
      entries: b.entries || [], characteristics: _sktCharacteristics(b.entries),
    });
  });

  sp(feats.feat, { legacy: edition === '2024' }).forEach(f => {
    R.feats.push({ name: f.name, source: f.source, core: f.source === src, superseded: !!f._superseded,
                   category: f.category || (edition === '2024' && !SKT_2024_ERA.has(f.source) ? 'G' : ''), prerequisite: f.prerequisite || null,
                   ability: f.ability || null, skills: f.skillProficiencies || null,
                   saves: f.savingThrowProficiencies || null, resist: f.resist || null,
                   additionalSpells: f.additionalSpells || null,
                   repeatable: !!f.repeatable || /(?:select|take) this feat (?:multiple times|more than once)/i.test(JSON.stringify(f.entries || [])),
                   tools: f.toolProficiencies || null, languages: f.languageProficiencies || null,
                   weapons: f.weaponProficiencies || null, armor: f.armorProficiencies || null,
                   expertise: f.expertise || null, skillsTools: f.skillToolLanguageProficiencies || null,
                   optionalProgression: f.optionalfeatureProgression || null,
                   entries: f.entries || [] });
  });

  // A book class's own options (the Artificer's infusions) come with the
  // class, so they count as core like the handbook's invocations.
  const classOwn = new Set();
  R.classes.filter(c => c.core === false).forEach(c => [c].concat(c.subclasses).forEach(x =>
    (x.optionalfeatureProgression || []).forEach(p => (p.featureType || []).forEach(t => classOwn.add(c.source + '|' + t)))));
  sp(optional.optionalfeature, { legacy: edition === '2024' }).forEach(o => {
    R.optional.push({ name: o.name, source: o.source,
                      core: o.source === src || (o.featureType || []).some(t => classOwn.has(o.source + '|' + t)),
                      featureType: o.featureType || [], prerequisite: o.prerequisite || null,
                      additionalSpells: o.additionalSpells || null, entries: o.entries || [] });
  });

  // The 2024 Artificer's magic item plans. The book prints them as tables in
  // Replicate Magic Item; each row becomes a pick like an infusion, with the
  // table's Artificer level as its prerequisite and the Plans Known column as
  // how many. The book's recommended four come first.
  R.classes.filter(c => c.key === 'artificer' && c.source === 'EFA').forEach(c => {
    const f = c.features.find(x => x.name === 'Replicate Magic Item'); if (!f) return;
    const tables = [], recommended = [];
    const itemName = s => (/\{@item ([^|}]+)/.exec(String(s)) || [])[1] || sktRulesInline(String(s));
    (function walk(e){
      if (Array.isArray(e)) return e.forEach(walk);
      if (typeof e === 'string'){ if (/are recommended/.test(e)) (e.match(/\{@item [^}]+\}/g) || []).forEach(m => recommended.push(itemName(m))); return; }
      if (e && typeof e === 'object'){ if (e.type === 'table' && /Magic Item Plans/.test(e.caption || '')) tables.push(e); Object.values(e).forEach(walk); }
    })(f.entries);
    if (!tables.length) return;
    const plans = [];
    tables.forEach(t => {
      const level = +((/Level (\d+)/.exec(t.caption) || [])[1]) || 2;
      (t.rows || []).forEach(row => {
        const name = itemName(row[0]);
        if (!name || plans.some(p => p.name === name)) return;
        const att = /^yes/i.test(String(row[1] || ''));
        plans.push({ name, source: c.source, core: true, featureType: ['EFA:Plan'], plan: true,
                     prerequisite: level > 2 ? [{ level: { level, class: { name: 'Artificer', source: c.source } } }] : null,
                     entries: ['A magic item plan' + (att ? ' (the item requires attunement)' : '') + '. Replicate Magic Item makes it at the end of a long rest; the Dungeon Master\u2019s Guide describes the item.'] });
      });
    });
    plans.sort((a, b) => (recommended.includes(b.name) - recommended.includes(a.name)));
    R.optional.push(...plans);
    const prog = Array.from({ length: 20 }, (_, i) => +sktClassColumn(c, 'Plans Known', i + 1) || 0);
    c.optionalfeatureProgression = (c.optionalfeatureProgression || []).concat([{ name: 'Magic Item Plans', featureType: ['EFA:Plan'], progression: prog }]);
  });

  // Base weapons and armour, keyed by lower-case name.
  (base.baseitem || []).filter(i => i.source === src || (!R.items[i.name.toLowerCase()] && i.source === 'PHB'))
    .forEach(i => { R.items[i.name.toLowerCase()] = i; });

  // Spells, with the classes that have them on their list. `classes` is the
  // core book's own lists (core spells only); `classesAll` adds the lists
  // other books put them on (Tasha's expanded lists, Xanathar's spells).
  const allSpells = [].concat(...spellFiles.map(f => f.spell || []));
  const listsFor = (s, keys) => {
    const e = (spellSources[s.source] || {})[s.name] || {};
    // The handbook's classes by its own printing; a class the handbook
    // doesn't have (the Artificer) by whichever book prints it, so a feat
    // like Artificer Initiate still has a list to choose from.
    // A legacy spell (the 2014 handbook's) keeps that handbook's class lists.
    const legacyLists = edition === '2024' && SKT_LEGACY_SRC.has(s.source);
    return [...new Set([].concat(...keys.map(k => e[k] || [])).filter(c => c.source === src || (legacyLists && c.source === 'PHB') || !SKT_CORE_CLASSES.includes(String(c.name).toLowerCase())).map(c => c.name))];
  };
  sp(allSpells, { legacy: edition === '2024' }).forEach(s => {
    const core = s.source === src;
    const classesAll = listsFor(s, ['class', 'classVariant']);
    R.spells.push({ name: s.name, level: s.level, school: s.school, source: s.source, core, superseded: !!s._superseded,
                    classes: core ? listsFor(s, ['class']) : [], classesAll,
                    time: s.time, range: s.range, duration: s.duration, components: s.components || null,
                    higher: s.entriesHigherLevel || null,
                    concentration: !!(s.duration || []).some(d => d.concentration),
                    ritual: !!(s.meta && s.meta.ritual),
                    damageInflict: s.damageInflict || null, savingThrow: s.savingThrow || null,
                    spellAttack: s.spellAttack || null, scalingLevelDice: s.scalingLevelDice || null,
                    entries: s.entries || [] });
  });

  // Languages: the handbook's, then the other books' of this era (the Sword
  // Coast's and Faerûn's tongues, Zemnian, Leonin…), offered with "other
  // books" on like the rest of their content.
  R.languages = sp(languages.language || [], { legacy: edition === '2024' })
    .map(l => ({ name: l.name, type: l.type || 'standard', source: l.source, core: l.source === src }));
  if (!R.languages.length){
    R.languages = ['Common', 'Dwarvish', 'Elvish', 'Giant', 'Gnomish', 'Goblin', 'Halfling', 'Orc',
                   'Abyssal', 'Celestial', 'Draconic', 'Deep Speech', 'Infernal', 'Primordial', 'Sylvan', 'Undercommon']
      .map(n => ({ name: n, type: 'standard' }));
  }
  return R;
}

// A 2014 background's "Suggested Characteristics" tables: the d8 of
// personality traits and the d6s of ideals, bonds and flaws.
function _sktCharacteristics(entries){
  const out = {};
  const KEY = { 'personality trait': 'personality', 'ideal': 'ideals', 'bond': 'bonds', 'flaw': 'flaws' };
  const walk = e => {
    if (Array.isArray(e)) return e.forEach(walk);
    if (!e || typeof e !== 'object') return;
    if (e.type === 'table' && Array.isArray(e.colLabels) && e.colLabels.length >= 2){
      const k = KEY[sktRulesInline(String(e.colLabels[1])).toLowerCase()];
      if (k) out[k] = (e.rows || []).map(r => sktRulesText(r[1])).filter(Boolean);
    }
    walk(e.entries); walk(e.items);
  };
  walk(entries || []);
  return Object.keys(out).length ? out : null;
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
  // Then the class's own era: the 2024 cleric's Knowledge Domain is Heroes
  // of Faerûn's, not the 2014 one adapted for it.
  return hits.find(s => s.core) || hits.find(s => SKT_2024_ERA.has(s.source) === SKT_2024_ERA.has(cls.source)) || hits[0] || null;
}
function sktRulesSpecies(R, name){ return R.species.find(s => s.name === name) || null; }
function sktRulesBackground(R, name){ return R.backgrounds.find(b => b.name === name) || null; }
// The character's background: one from the books, or their own (the 2014
// "customizing a background" rule, the 2024 "create your own"): two skills,
// tools or languages, a feature borrowed from a printed one (2014); three
// abilities, an origin feat and a tool (2024). The same shape as a printed
// one, so everything that reads a background reads this too.
const SKT_CUSTOM_BG = '(Custom)';
function sktBuildBackground(R, build){
  if (!build || build.background !== SKT_CUSTOM_BG){
    const bg = sktRulesBackground(R, build && build.background);
    // A 2014 background in a 2024 build: three abilities and an origin feat,
    // chosen as for a custom background (build.bgAdapt).
    if (bg && sktBgNeedsAdapt(R, bg)){
      const a = build.bgAdapt || {};
      return Object.assign({}, bg, { adapted: true,
        ability: (a.abilities || []).length === 3 ? [{ choose: { weighted: { from: a.abilities, weights: [2, 1] } } }] : null,
        // One that already grants a feat (Astral Drifter) keeps it.
        feats: (bg.feats || []).length ? bg.feats : a.feat ? [{ [String(a.feat).toLowerCase()]: true }] : null });
    }
    return bg;
  }
  const c = build.customBg || {};
  const from = c.feature && sktRulesBackground(R, c.feature);
  const kit = c.equipment && sktRulesBackground(R, c.equipment);
  const obj = list => list && list.length ? [Object.fromEntries(list.map(k => [String(k).toLowerCase(), true]))] : [];
  return {
    name: c.name || 'Custom background', source: R.src, core: true, custom: true,
    skills: obj((c.skills || []).map(k => (SKT_SKILL_LABEL[k] || k))),
    tools: obj(c.tools || []), languages: (c.languages || 0) ? [{ anyStandard: +c.languages }] : [],
    ability: R.edition === '2024' && (c.abilities || []).length === 3 ? [{ choose: { weighted: { from: c.abilities, weights: [2, 1] } } }] : null,
    feats: R.edition === '2024' && c.feat ? [{ [String(c.feat).toLowerCase()]: true }] : null,
    equipment: kit ? kit.equipment : [{ _: [{ value: R.edition === '2024' ? 5000 : 1000 }] }],
    entries: from ? (from.entries || []).filter(e => e && typeof e === 'object' && /^Feature:/i.test(e.name || '')) : [],
    characteristics: from ? from.characteristics : null,
  };
}
// A background without the 2024 parts (no ability increases), used in a 2024 build.
function sktBgNeedsAdapt(R, bg){ return R.edition === '2024' && !!bg && !bg.custom && !Array.isArray(bg.ability); }
function sktRulesFeat(R, name){
  const n = String(name || '').toLowerCase().split(';')[0].trim();
  return R.feats.find(f => f.name.toLowerCase() === n) || null;
}
function sktRulesSpell(R, name){
  // A sheet's marks after the name — "Detect Magic [R]", "Bless (C)", "Shield*" — aren't part of it.
  const n = String(name || '').toLowerCase().split('|')[0].replace(/#.*$/, '').replace(/(\s*([\[(](?:r|c|ritual|concentration|r, ?c|c, ?r)[\])]|[*†]))+\s*$/i, '').trim();
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

// ── Tool proficiencies to choose ─────────────────────────────────────────────
// "Any one type of artisan's tools or one musical instrument" (a 2014 monk),
// three instruments (a bard), a gaming set (a soldier), one of three tools (a
// dwarf). None of these were asked for. Each choice: { key, label, options,
// count }; the picks live in build.toolPicks[key].
const SKT_TOOL_SETS = {
  anyArtisansTool: ["Alchemist's Supplies", "Brewer's Supplies", "Calligrapher's Supplies", "Carpenter's Tools", "Cartographer's Tools", "Cobbler's Tools",
    "Cook's Utensils", "Glassblower's Tools", "Jeweler's Tools", "Leatherworker's Tools", "Mason's Tools", "Painter's Supplies", "Potter's Tools",
    "Smith's Tools", "Tinker's Tools", "Weaver's Tools", "Woodcarver's Tools"],
  anyMusicalInstrument: ['Bagpipes', 'Drum', 'Dulcimer', 'Flute', 'Horn', 'Lute', 'Lyre', 'Pan Flute', 'Shawm', 'Viol'],
  anyGamingSet: ['Dice Set', 'Dragonchess Set', 'Playing Card Set', 'Three-Dragon Ante Set'],
};
function _sktToolList(list){
  if (!Array.isArray(list) || !list.length) return { fixed: [], choice: null };
  const fixed = [], opts = new Set();
  let count = 0;
  // Several objects are alternatives; their choices pool into one pick.
  list.forEach((o, i) => Object.keys(o || {}).forEach(k => {
    if (SKT_TOOL_SETS[k]){ SKT_TOOL_SETS[k].forEach(t => opts.add(t)); count = Math.max(count, +o[k] || 1); }
    else if (k === 'any'){ Object.values(SKT_TOOL_SETS).forEach(s => s.forEach(t => opts.add(t))); ["Disguise Kit", "Forgery Kit", "Herbalism Kit", "Navigator's Tools", "Poisoner's Kit", "Thieves' Tools"].forEach(t => opts.add(t)); count = Math.max(count, +o.any || 1); }
    else if (k === 'choose'){ ((o.choose || {}).from || []).forEach(t => opts.add(_sktTitle(String(t).split('|')[0]))); count = Math.max(count, (o.choose || {}).count || 1); }
    else if (o[k] === true && i === 0) fixed.push(_sktTitle(String(k).split('|')[0]));
  }));
  return { fixed, choice: count ? { options: [...opts].sort(), count } : null };
}
function sktToolChoices(build, R){
  const cls = sktRulesClass(R, build.cls), bg = sktBuildBackground(R, build);
  const sp = sktRulesSpecies(R, build.species), sub = sp && sktSpeciesSub(sp, build);
  const out = [];
  const add = (key, label, list) => { const c = _sktToolList(list).choice; if (c) out.push(Object.assign({ key, label }, c)); };
  if (cls) add('class', cls.name, cls.toolProfs);
  if (bg) add('background', bg.name, bg.tools);
  if (sp) add('species', sub ? sub.name + ' ' + sp.name : sp.name, (sub && sub.tools && sub.tools.length) ? sub.tools : sp.tools);
  if (cls) sktSubclassProfFeatures(build, R).forEach(({ feature, g }) => g.choices.filter(c => c.kind === 'tools').forEach(c =>
    add('sub:' + feature, feature, [typeof c.from === 'string' ? { [c.from]: c.count } : { choose: { from: c.from, count: c.count } }])));
  return out;
}
function sktToolFixed(build, R){
  const cls = sktRulesClass(R, build.cls), sp = sktRulesSpecies(R, build.species);
  const sub = sp && sktSpeciesSub(sp, build);
  return [].concat(cls ? _sktToolList(cls.toolProfs).fixed : [], sp ? _sktToolList((sub && sub.tools && sub.tools.length) ? sub.tools : sp.tools).fixed : []);
}

// ── Proficiencies a subclass feature grants ──────────────────────────────────
// The data states these only in prose ("you gain proficiency with medium
// armor, shields, and martial weapons"; "your choice of two of the following
// skills: …"), in a handful of set phrasings, read here. Temporary ones ("for
// 10 minutes", "while…"), ones that depend on another ("If you are already
// proficient…") and the bullets of a choose-one-benefit feature are skipped.
// Returns fixed armor, weapons, tools, skills, saves and languages, and
// choices: { kind: 'skills'|'tools'|'languages'|'weapons', count, from }.
const _SKT_NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 };
const _sktProfMemo = new Map();
function sktProfGrants(text){
  text = String(text || '');
  if (_sktProfMemo.has(text)) return _sktProfMemo.get(text);
  const out = { armor: [], weapons: [], tools: [], skills: [], saves: [], languages: [], choices: [] };
  const list = s => String(s).replace(/\(your choice\)/i, '').split(/,\s*(?:and |or )?|\s+(?:and|or)\s+/).map(x => x.replace(/^(the|either)\s+/i, '').replace(/\s+skills?$/i, '').trim()).filter(Boolean);
  const pickOne = /one of the following (benefits|options)|following benefits of your choice/i.test(text);
  if (/Choose two types of weapons to be your kensei weapons/i.test(text)) out.choices.push({ kind: 'weapons', count: 2, from: '@kensei', more: [6, 11, 17] });
  text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).forEach(s => {
    if (!/proficien|language|training with|speak, read, and write|of the following skills/i.test(s) || (pickOne && /^[•*]/.test(s.trim()))) return;
    if (/for (10 minutes|1 hour|one hour|the duration)|until |while (you|wearing|raging|it)|double your|expertise|you are proficient with it|you add your proficiency|^\W*if you/i.test(s)) return;
    let m;
    if ((m = /(one|two|three|four) (?:of the following skills|skills from the following list|of these skills)(?: of your choice)?:\s*([^.]+)/i.exec(s))
        || (m = /your choice of (one|two|three|four) of the following skills:\s*([^.]+)/i.exec(s))){
      out.choices.push({ kind: 'skills', count: _SKT_NUM[m[1].toLowerCase()], from: list(m[2]).map(sktSkillKey).filter(Boolean) });
    } else if ((m = /(?:in|with) (?:either )?the ([A-Z][\w ]+?(?:, [A-Z][\w ]+?)*,? or (?:the )?[A-Z][\w ]+?) skill/i.exec(s))){
      out.choices.push({ kind: 'skills', count: 1, from: list(m[1]).map(sktSkillKey).filter(Boolean) });
    } else if ((m = /(one|two|three|four) skills? of your choice from the skills available to (\w+)/i.exec(s))){
      out.choices.push({ kind: 'skills', count: _SKT_NUM[m[1].toLowerCase()], fromClass: m[2].replace(/s$/, '') });
    } else if ((m = /(one|two|three|four) skills? of your choice/i.exec(s))){
      out.choices.push({ kind: 'skills', count: _SKT_NUM[m[1].toLowerCase()], from: null });
    } else if ((m = /proficiency in the ([A-Z][\w ]+?)(?: and ([A-Z][\w ]+?))? skills?/.exec(s))){
      [m[1], m[2]].filter(Boolean).forEach(n => { const k = sktSkillKey(n); if (k) out.skills.push(k); });
    }
    if ((m = /proficiency in (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throws/i.exec(s))) out.saves.push(m[1].slice(0, 3).toLowerCase());
    if (/one type of artisan's tools of your choice/i.test(s)) out.choices.push({ kind: 'tools', count: 1, from: 'anyArtisansTool' });
    if (/one gaming set of your choice/i.test(s)) out.choices.push({ kind: 'tools', count: 1, from: 'anyGamingSet' });
    if ((m = /your choice of ([\w' ]+?(?:tools|supplies|kit)) or ([\w' ]+?(?:tools|supplies|kit))/i.exec(s))) out.choices.push({ kind: 'tools', count: 1, from: [m[1], m[2]].map(t => _sktTitle(t.replace(/^the /i, '').toLowerCase())) });
    else if ((m = /gain (?:a|an) ([\w' ]+?(?:kit|tools|supplies)) and (?:a|an) ([\w' ]+?(?:kit|tools|supplies)), and you have proficiency with them/i.exec(s))) out.tools.push(m[1].toLowerCase(), m[2].toLowerCase());
    else (s.match(/(?:proficiency with |and |, )(?:the |a )?((?:[A-Z]?[a-z']+ ){0,2}(?:tools|supplies|kit))/gi) || []).forEach(t => {
      const n = t.replace(/^(proficiency with|and|,)\s*(the |a )?/i, '').trim().toLowerCase();
      if (!/artisan's tools|gaming set/.test(n) && !out.tools.includes(n)) out.tools.push(n);
    });
    if (/proficiency with|training with/i.test(s)){
      ['light', 'medium', 'heavy'].forEach(a => { if (new RegExp(a + ' armor', 'i').test(s)) out.armor.push(a); });
      if (/shields/i.test(s)) out.armor.push('shield');
      if (/martial ranged weapons/i.test(s)) out.weapons.push('@martial ranged');
      else if (/all melee martial weapons/i.test(s)) out.weapons.push('@martial melee light');
      else if (/martial weapons/i.test(s)) out.weapons.push('martial');
      if (/simple weapons/i.test(s)) out.weapons.push('simple');
      if ((m = /(?:and|with) the (scimitar|longsword|rapier|shortsword|whip|hand crossbow)/i.exec(s))) out.weapons.push(m[1].toLowerCase());
      if (/one type of one-handed melee weapon of your choice/i.test(s)) out.choices.push({ kind: 'weapons', count: 1, from: '@one-handed melee' });
    }
    if ((m = /learn (one|two|three) languages? of your choice/i.exec(s)) && !/alternatively/i.test(s)) out.choices.push({ kind: 'languages', count: _SKT_NUM[m[1].toLowerCase()] });
    else if (/learn one language from the language tables/i.test(s)) out.choices.push({ kind: 'languages', count: 1 });
    if ((m = /speak, read, and write ([A-Z]\w+)/.exec(s))) out.languages.push(m[1]);
  });
  out.any = Object.keys(out).some(k => k !== 'any' && out[k].length);
  _sktProfMemo.set(text, out);
  return out;
}
// Weapons a phrase names as a group, from the base items.
function _sktWeaponGroup(R, tag){
  const all = Object.values(R.items || {}).filter(i => i.weaponCategory);
  const props = i => (i.property || []).map(p => String(p).split('|')[0]);
  const ranged = i => /^R(\||$)/.test(String(i.type)), melee = i => /^M(\||$)/.test(String(i.type));
  const pick = tag === '@martial ranged' ? all.filter(i => i.weaponCategory === 'martial' && ranged(i))
    : tag === '@martial melee light' ? all.filter(i => i.weaponCategory === 'martial' && melee(i) && !props(i).includes('2H') && !props(i).includes('H'))
    : tag === '@one-handed melee' ? all.filter(i => melee(i) && !props(i).includes('2H'))
    : tag === '@kensei' ? all.filter(i => (!props(i).includes('H') && !props(i).includes('S')) || /^longbow$/i.test(i.name)) : [];
  return [...new Set(pick.map(i => i.name.toLowerCase()))].sort();
}
// The subclass features with proficiency grants, and the picks they ask for
// that live here (skills and weapons; tools go with the other tool picks,
// languages with the other languages). Picks: build.profPicks[feature].
function sktSubclassProfFeatures(build, R){
  return sktBuildFeatures(build, R).filter(f => f.from === 'subclass').map(f => ({ feature: f.name, cls: f.cls, g: sktProfGrants(f.text) })).filter(x => x.g.any);
}
// A 2014 ranger's favored enemies and terrains: one each at 1st level, more
// at 6th and 14th (enemies) and 6th and 10th (terrains).
const SKT_RANGER_PICKS = {
  'Favored Enemy': { kind: 'enemies', more: [6, 14], options: ['Aberrations', 'Beasts', 'Celestials', 'Constructs', 'Dragons', 'Elementals', 'Fey', 'Fiends', 'Giants', 'Monstrosities', 'Oozes', 'Plants', 'Undead', 'Humanoids (two races)'] },
  'Natural Explorer': { kind: 'terrains', more: [6, 10], options: ['Arctic', 'Coast', 'Desert', 'Forest', 'Grassland', 'Mountain', 'Swamp', 'Underdark'] },
};
function sktProfChoices(build, R){
  const out = [];
  // The Simic Hybrid's animal enhancements: one from the trait's first list
  // at 1st level, a second at 5th from either list.
  { const sp = sktRulesSpecies(R, build.species), tr = sp && (sp.entries || []).find(e => e && e.name === 'Animal Enhancement');
    if (tr){
      const lists = [];
      (function walk(e){ if (Array.isArray(e)) return e.forEach(walk); if (e && typeof e === 'object'){ if (e.type === 'list') lists.push((e.items || []).map(i => i && i.name).filter(Boolean)); else Object.values(e).forEach(walk); } })(tr.entries);
      const L = (build._full || build).level || 1, count = L >= 5 ? 2 : 1;
      const options = L >= 5 ? [].concat(...lists) : (lists[0] || []);
      const picked = (((build.profPicks || {})['Animal Enhancement'] || {}).enhancements || []).filter(x => options.includes(x)).slice(0, count);
      if (options.length) out.push({ feature: 'Animal Enhancement', kind: 'enhancements', count, options, picked });
    }
  }
  if (R.edition === '2014') sktBuildFeatures(build, R).filter(f => f.from === 'class' && SKT_RANGER_PICKS[f.name] && f.cls === 'ranger').forEach(f => {
    const spec = SKT_RANGER_PICKS[f.name], part = sktClassLevels(build, R).find(p => p.key === 'ranger');
    const count = 1 + spec.more.filter(l => part && part.level >= l).length;
    const picked = (((build.profPicks || {})[f.name] || {})[spec.kind] || []).filter(x => spec.options.includes(x)).slice(0, count);
    out.push({ feature: f.name, kind: spec.kind, count, options: spec.options, picked });
  });
  // The 2024 barbarian's Primal Knowledge (3rd level): one more skill from the
  // barbarian's list.
  if (R.edition === '2024') sktBuildFeatures(build, R).filter(f => f.from === 'class' && f.name === 'Primal Knowledge' && f.cls === 'barbarian').slice(0, 1).forEach(f => {
    const bc = sktRulesClass(R, 'barbarian'), options = (bc && bc.skillChoice.from) || [];
    const picked = (((build.profPicks || {})[f.name] || {}).skills || []).filter(x => options.includes(x)).slice(0, 1);
    if (options.length) out.push({ feature: f.name, kind: 'skills', count: 1, options, picked });
  });
  sktSubclassProfFeatures(build, R).forEach(({ feature, cls, g }) => g.choices.forEach(c => {
    if (c.kind !== 'skills' && c.kind !== 'weapons') return;
    const part = sktClassLevels(build, R).find(p => p.key === cls) || sktClassLevels(build, R)[0];
    c = Object.assign({}, c, { count: c.count + (c.more || []).filter(l => part.level >= l).length });
    const fromCls = c.fromClass && sktRulesClass(R, c.fromClass);
    const options = c.kind === 'weapons' ? _sktWeaponGroup(R, c.from)
      : fromCls ? fromCls.skillChoice.from : (c.from || Object.keys(SKT_SKILLS));
    const picked = (((build.profPicks || {})[feature] || {})[c.kind] || []).filter(x => options.includes(x)).slice(0, c.count);
    out.push({ feature, kind: c.kind, count: c.count, options, picked });
  }));
  return out;
}

// ── What a feat asks the player to choose ────────────────────────────────────
// Skilled's three skills or tools, Linguist's languages, Weapon Master's
// weapons, Skill Expert's skill and expertise, Crafter's tools — read from
// the data, so a feat from any book works. Only ability increases and
// Resilient's save were asked for before; the rest granted nothing.
// Returns { fixed: { skills, tools, languages, weapons, armor, expertise },
// choices: [{ kind, count, options, label }] }; picks live in
// build.featChoices[feat][kind] ('skillsTools' fills skills and tools).
function sktFeatChoices(R, build, featName, rec){
  const f = sktRulesFeat(R, featName);
  const out = { fixed: { skills: [], tools: [], languages: [], weapons: [], armor: [], expertise: [] }, choices: [] };
  if (!f) return out;
  const allSkills = Object.keys(SKT_SKILLS);
  (f.skills || []).forEach(o => Object.keys(o).forEach(k => {
    if (k === 'choose') out.choices.push({ kind: 'skills', count: o.choose.count || 1, options: (o.choose.from || []).map(sktSkillKey).filter(Boolean), label: 'skill' });
    else if (k === 'any') out.choices.push({ kind: 'skills', count: +o.any || 1, options: allSkills, label: 'skill' });
    else if (o[k] === true){ const sk = sktSkillKey(k); if (sk) out.fixed.skills.push(sk); }
  }));
  if (f.tools){ const t = _sktToolList(f.tools); out.fixed.tools.push(...t.fixed); if (t.choice) out.choices.push({ kind: 'tools', count: t.choice.count, options: t.choice.options, label: 'tool' }); }
  (f.languages || []).forEach(o => Object.keys(o).forEach(k => {
    if (k === 'any') out.choices.push({ kind: 'languages', count: +o.any || 1, options: sktLanguageOptions(R, build), label: 'language' });
    else if (o[k] === true) out.fixed.languages.push(_sktTitle(k));
  }));
  (f.weapons || []).forEach(o => Object.keys(o).forEach(k => {
    if (k === 'choose'){
      const cat = /martial/i.test(o.choose.fromFilter || '') ? 'martial' : /simple/i.test(o.choose.fromFilter || '') ? 'simple' : null;
      const opts = Object.values(R.items).filter(i => /^(M|R)(\||$)/.test(String(i.type)) && i.weaponCategory && (!cat || i.weaponCategory === cat))
        .map(i => i.name).filter((n, k2, a) => a.indexOf(n) === k2).sort();
      out.choices.push({ kind: 'weapons', count: o.choose.count || 1, options: opts, label: 'weapon' });
    } else if (o[k] === true) out.fixed.weapons.push(k.toLowerCase());
  }));
  (f.armor || []).forEach(o => Object.keys(o).forEach(k => { if (o[k] === true) out.fixed.armor.push(k.split('|')[0].toLowerCase()); }));
  (f.expertise || []).forEach(o => Object.keys(o).forEach(k => {
    if (k === 'anyProficientSkill'){
      const prof = rec && rec.sheet ? Object.keys(rec.sheet.skillProf || {}) : allSkills;
      out.choices.push({ kind: 'expertise', count: +o[k] || 1, options: prof, label: 'skill for expertise' });
    } else if (o[k] === true){ const sk = sktSkillKey(k); if (sk) out.fixed.expertise.push(sk); }
  }));
  (f.skillsTools || []).forEach(o => (Array.isArray(o.choose) ? o.choose : []).forEach(c => {
    const opts = [];
    if ((c.from || []).includes('anySkill')) allSkills.forEach(s => opts.push('s:' + s));
    if ((c.from || []).includes('anyTool')) Object.values(SKT_TOOL_SETS).forEach(set => set.forEach(t => opts.push('t:' + t)));
    out.choices.push({ kind: 'skillsTools', count: c.count || 1, options: opts, label: 'skill or tool' });
  }));
  return out;
}
// How many of a feat's choices are still to make.
function sktFeatChoicesMissing(R, build, featName, rec){
  const ch = (build.featChoices || {})[sktRulesFeat(R, featName) ? sktRulesFeat(R, featName).name : featName] || {};
  return sktFeatChoices(R, build, featName, rec).choices.reduce((n, c) => {
    const have = c.kind === 'skillsTools' ? (ch.skills || []).length + (ch.tools || []).length : (ch[c.kind] || []).length;
    return n + Math.max(0, c.count - have);
  }, 0);
}

// ── Feat prerequisites ───────────────────────────────────────────────────────
// Whether a character meets a feat's prerequisite, and what it is in words.
// The data lists alternatives; within one, every condition counts. A
// condition this can't judge (a campaign, free text) passes, with its words.
function sktFeatPrereq(R, build, feat, rec){
  const ps = (feat && feat.prerequisite) || [];
  if (!ps.length) return { ok: true, text: '' };
  const ab = sktBuildAbilities(build, R);
  const sh = (rec && rec.sheet) || {};
  const armor = ((sh.proficiencies || {}).armor || []).map(a => String(a).toLowerCase());
  const feats = sktBuildFeatNames(build, R).map(n => n.toLowerCase());
  const texts = [], oks = ps.map(p => {
    const parts = [], ok = [];
    if (p.level != null){ const lv = typeof p.level === 'object' ? p.level.level : p.level; parts.push('level ' + lv); ok.push((build.level || 1) >= lv); }
    if (p.ability){ const any = p.ability.map(o => Object.keys(o).map(k => k.toUpperCase() + ' ' + o[k]).join(' and ')); parts.push(any.join(' or ')); ok.push(p.ability.some(o => Object.keys(o).every(k => (ab[k] || 0) >= o[k]))); }
    if (p.spellcasting || p.spellcasting2020 || p.spellcastingFeature){ parts.push('the ability to cast a spell'); ok.push(sh.spellSaveDc != null || (sh.spells || []).length > 0); }
    if (p.proficiency){ p.proficiency.forEach(o => { if (o.armor){ parts.push('proficiency with ' + o.armor + ' armor'); ok.push(armor.includes(String(o.armor).toLowerCase())); } if (o.weaponGroup || o.weapon){ parts.push('proficiency with ' + (o.weaponGroup || o.weapon) + ' weapons'); ok.push(true); } }); }
    if (p.race){ const names = p.race.map(r => _sktTitle(r.name) + (r.subrace ? ' (' + _sktTitle(r.subrace) + ')' : '')); parts.push(names.join(' or ')); ok.push(p.race.some(r => String(build.species || '').toLowerCase().includes(String(r.name).toLowerCase()))); }
    if (p.feat){ const names = p.feat.map(f => _sktTitle(String(f).split('|')[0])); parts.push('the ' + names.join(' or ') + ' feat'); ok.push(p.feat.some(f => feats.includes(String(f).split('|')[0].toLowerCase()))); }
    if (p.background){ parts.push(p.background.map(b => _sktTitle(b.name)).join(' or ') + ' background'); ok.push(p.background.some(b => String(build.background || '').toLowerCase() === String(b.name).toLowerCase())); }
    // A class feature (the 2024 fighting-style feats need Fighting Style), a
    // campaign (Eberron's dragonmarks, Planescape's scions: the DM's call),
    // and one feat of a kind (a single dragonmark).
    if (p.feature){ const have = (sh.featureList || []).map(f => String(f.name).toLowerCase()); parts.push(p.feature.map(f => _sktTitle(String(f))).join(' or ') + ' feature'); ok.push(p.feature.some(f => have.includes(String(f).toLowerCase()))); }
    if (p.campaign){ parts.push(p.campaign.join(' or ') + ' campaign'); ok.push(true); }
    if (p.exclusiveFeatCategory){
      const cats = p.exclusiveFeatCategory.map(String);
      parts.push('no other ' + (cats.includes('D') ? 'dragonmark' : cats.join('/')) + ' feat');
      const others = sktBuildFeatNames(build, R).filter(n => n.toLowerCase() !== String(feat.name).toLowerCase()).map(n => sktRulesFeat(R, n)).filter(Boolean);
      ok.push(!others.some(f => cats.includes(String(f.category).split(':')[0])));
    }
    if (p.other){ parts.push(String(p.other)); ok.push(true); }
    if (p.otherSummary){ parts.push(sktRulesInline(String(p.otherSummary.entry || p.otherSummary.entrySummary || ''))); ok.push(true); }
    texts.push(parts.filter(Boolean).join(', '));
    return ok.every(Boolean);
  });
  return { ok: oks.some(Boolean), text: texts.filter(Boolean).join('; or ') };
}

// ── Starting gold instead of the kit (2014) ──────────────────────────────────
// "5d4 × 10" from the class's goldAlternative: the dice, the multiplier, and
// the average a player can take instead of rolling.
function sktClassGold(cls){
  const g = cls && cls.equipment && cls.equipment.goldAlternative;
  const m = /(\d+)d(\d+)(?:\s*[×x]\s*(\d+))?/.exec(String(g || ''));
  if (!m) return null;
  const n = +m[1], d = +m[2], mult = +(m[3] || 1);
  return { n, d, mult, text: n + 'd' + d + (mult > 1 ? ' × ' + mult : '') + ' gp', avg: Math.floor(n * (d + 1) / 2) * mult };
}

// "15 gp", "5 sp", "1 gp 5 sp" from copper.
function sktCoinText(cp){
  cp = Math.round(+cp || 0);
  const gp = Math.floor(cp / 100), sp = Math.floor((cp % 100) / 10), c = cp % 10;
  return [gp ? gp + ' gp' : '', sp ? sp + ' sp' : '', c ? c + ' cp' : ''].filter(Boolean).join(' ') || '0 gp';
}

// ── Which books a character draws on ─────────────────────────────────────────
// The handbook always; the others when "other books" is on — all of them, or
// just the ones ticked (build.books, a list of source codes).
// The languages a character can pick: the handbook's and, with other books
// on, theirs. Secret languages (Druidic, Thieves' Cant) come from a feature.
function sktLanguageOptions(R, build){
  return (R.languages || []).filter(l => l.type !== 'secret' && !/^(Druidic|Thieves' Cant)$/.test(l.name) && (l.core !== false || sktBookOk(build, l))).map(l => l.name);
}
// D&D Beyond's model: the 2024 rules, and a "Legacy content" switch that
// adds the 2014 core books' options beside them (the Half-Elf, a 2014 feat,
// subclass or spell). Other books, of either era, are the "other books"
// switch as before. A character built on the 2014 rules is all legacy, so
// nothing there is held back by it.
function sktIsLegacy(build, x){
  return !!(x && x.superseded && (!build || build.edition !== '2014'));
}
function sktBookOk(build, x){
  if (!x) return true;
  if (build && build.edition === '2014'){
    if (x.core !== false) return true;
    if (!build.allBooks) return false;
    return !Array.isArray(build.books) || build.books.includes(x.source);
  }
  const S = sktSources(build), cat = x.source ? sktSourceCat(x.source) : 'core';
  // A superseded version is the Legacy switch's alone, whichever book it's from.
  if (x.superseded) return !!S.legacy;
  if (x.core !== false || cat === 'core') return true;
  if (!S[cat]) return false;
  // The book-by-book list narrows the expanded categories.
  return cat === 'core2014' || !Array.isArray(build.books) || build.books.includes(x.source);
}
// The other books this edition's data holds, with how much each brings.
function sktOtherBooks(R){
  const n = {};
  const count = x => { if (x && x.core === false && x.source) n[x.source] = (n[x.source] || 0) + 1; };
  R.species.forEach(count); R.backgrounds.forEach(count); R.feats.forEach(count); R.spells.forEach(count); R.optional.forEach(count);
  R.classes.forEach(c => c.subclasses.forEach(s => { if (!s.core) count({ core: false, source: s.source }); }));
  return Object.keys(n).map(k => ({ source: k, name: (R.bookNames || {})[k] || k, count: n[k] })).sort((a, b) => a.name.localeCompare(b.name));
}

// ── Multiclassing ────────────────────────────────────────────────────────────
// build.cls is the first class and build.multi the others, each with its
// own levels and the choices that belong to it (skills, spells). build.level
// is the character's total; the first class has what the others leave. The
// single-class functions below work on a "view" of one class at its own
// level, and the multiclass versions combine the views.
function sktClassLevels(build, R){
  const full = build;
  const seen = new Set([String(full.cls || '').toLowerCase()]);
  const multi = (full.multi || []).filter(m => {
    const c = sktRulesClass(R, m && m.cls); if (!c || seen.has(c.key)) return false;
    seen.add(c.key); return true;
  });
  const others = multi.reduce((n, m) => n + Math.max(1, +m.level || 1), 0);
  const first = Math.max(1, (full.level || 1) - others);
  const key = n => (sktRulesClass(R, n) || {}).key || '';
  return [{ cls: full.cls, key: key(full.cls), subclass: full.subclass || '', level: first, primary: true, entry: null }]
    .concat(multi.map(m => ({ cls: m.cls, key: key(m.cls), subclass: m.subclass || '', level: Math.max(1, +m.level || 1), primary: false, entry: m })));
}
function _sktA(s){ return (/^[aeiou]/i.test(s) ? 'an ' : 'a ') + s; }
function sktIsMulticlass(build, R){ return sktClassLevels(build, R).length > 1; }
function sktClassView(build, R, part){
  const full = build._full || build;
  if (part.primary) return Object.assign({}, full, { level: part.level, multi: [], _full: full });
  const m = part.entry || {};
  return Object.assign({}, full, { cls: m.cls, subclass: m.subclass || '', subclassPick: m.subclassPick || '', level: part.level, multi: [], _full: full,
    skills: m.skills || [], cantrips: m.cantrips || [], spells: m.spells || [], spellbook: m.spellbook || [] });
}
// The Ability Score Improvements a build has: the first class's keyed by its
// level ("4"), another class's by class and level ("wizard@4").
function sktAsiSlots(build, R){
  const out = [];
  sktClassLevels(build._full || build, R).forEach(p => {
    sktAsiLevels(sktRulesClass(R, p.cls)).filter(l => l <= p.level)
      .forEach(l => out.push({ key: p.primary ? String(l) : p.key + '@' + l, cls: p.cls, level: l, primary: p.primary }));
  });
  return out;
}
// What a class asks of a character to multiclass into or out of it: 13 in
// an ability. 2014 writes it as requirements ({int:13}; {or:[{str:13,
// dex:13}]} for either); 2024 as the primary ability (any one entry, all of
// its abilities).
function _sktMcNeeds(R, clsName){
  const c = sktRulesClass(R, clsName); if (!c) return null;
  const req = c.multiclassing && c.multiclassing.requirements;
  if (req){
    const all = Object.keys(req).filter(k => k !== 'or').map(k => [[k, req[k]]]);
    const any = (req.or || []).map(o => Object.keys(o).map(k => [k, o[k]]));
    return { all, any };
  }
  const pa = (Array.isArray(c.primaryAbility) ? c.primaryAbility : []).map(o => Object.keys(o).filter(k => o[k] === true).map(k => [k, 13])).filter(x => x.length);
  return pa.length ? { all: [], anyAll: pa } : null;
}
function sktMulticlassOk(R, clsName, ab){
  const n = _sktMcNeeds(R, clsName); if (!n) return true;
  const ge = ([k, v]) => (ab[k] || 0) >= v;
  return n.all.every(g => g.every(ge)) && (n.any || []).every(g => g.some(ge)) && (!n.anyAll || n.anyAll.some(g => g.every(ge)));
}
function sktMulticlassNeedText(R, clsName){
  const n = _sktMcNeeds(R, clsName); if (!n) return '';
  const t = ([k, v]) => k.toUpperCase() + ' ' + v;
  return [].concat(n.all.map(g => g.map(t).join(' and ')), (n.any || []).map(g => g.map(t).join(' or ')),
                   n.anyAll ? [n.anyAll.map(g => g.map(t).join(' and ')).join(', or ')] : []).join(' and ');
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
    extraFeats: [],        // feats outside the slots: a DM's gift, a campaign's bonus feat
    featChoices: {},       // feat name → { ability, skills, spells … }
    featureChoices: {},    // feature name → chosen option (Divine Order → 'Protector')
    optional: {},          // 'Eldritch Invocations' → [names], 'Fighting Style' → [name] …
    masteries: [],         // 2024 weapon mastery picks (weapon names)
    speciesChoice: {},     // 2024 lineage / ancestry / legacy
    cantrips: [], spells: [],
    hp: { method: 'average', rolls: {} },
    equipment: { cls: 'A', bg: 'A', picks: {} },
    allBooks: false,       // offer species, feats, spells… from books beyond the handbook
    items: [],             // magic items and gear given since: { name, base|stats, bonuses, reqAttune, attuned }
    multi: [],             // more classes: { cls, subclass, level, skills, cantrips, spells, spellbook }
    spellbook: [],         // a wizard's book; prepared spells come out of it
    size: '',              // 2024 species that may be Small or Medium
    details: {},           // alignment, looks, personality, backstory
    icon: '',
  };
}

// Ability scores, every source in order: base, species or background,
// ability score improvements, feats, then the cap.
function sktBuildAbilities(build, R, trace){
  const base = Object.assign({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
                             (build.abilities && build.abilities.base) || {});
  const out = { ...base };
  // With `trace`, each change is written down: { str: [['Base', 15], ['Species', 1]…] }.
  const note = (label, k, n) => { if (trace && n) (trace[k] = trace[k] || []).push([label, n]); };
  if (trace) SKT_ABS.forEach(k => { trace[k] = [['Base', base[k]]]; });
  const add = (inc, label) => Object.keys(inc || {}).forEach(k => { if (k in out){ out[k] += +inc[k] || 0; note(label || 'Increase', k, +inc[k] || 0); } });
  const species = sktRulesSpecies(R, build.species);
  if (R.edition === '2014'){
    if (species){
      const sub = sktSpeciesSub(species, build) || null;
      // Fixed increases from the species and the subrace; the chosen part of
      // either ("+1 to two others") comes from build.speciesAsi.
      // Tasha's "Customizing Your Origin": none of the fixed increases; the
      // player places them (build.speciesAsi), as for a Multiverse species.
      if (!(build.speciesChoice && build.speciesChoice.customOrigin)) [species.ability, sub && sub.ability].forEach(list => (list || []).forEach(a => {
        Object.keys(a).forEach(k => { if (k !== 'choose' && k in out){ out[k] += a[k]; note('Species', k, a[k]); } });
      }));
      add(build.speciesAsi, 'Species');
    }
  } else {
    add(build.bgAsi, 'Background');
  }
  const slots = new Set(sktAsiSlots(build, R).map(s => s.key));
  // A feat's fixed increase (Actor's +1 Charisma, Durable's +1 Constitution);
  // the part the player chooses is in featChoices.
  const featFixed = name => {
    const f = sktRulesFeat(R, name), a = f && (f.ability || []).length === 1 ? f.ability[0] : null;
    if (!a) return null;
    const o = {}; Object.keys(a).forEach(k => { if (k in out && typeof a[k] === 'number') o[k] = a[k]; });
    return Object.keys(o).length ? o : null;
  };
  Object.keys(build.asi || {}).sort((a, b) => (parseInt(a.split('@').pop(), 10) || 0) - (parseInt(b.split('@').pop(), 10) || 0)).forEach(lvl => {
    if (!slots.has(String(lvl))) return;
    const pick = build.asi[lvl] || {};
    const at = String(lvl).includes('@') ? _sktTitle(String(lvl).split('@')[0]) + ' ' + String(lvl).split('@')[1] : 'Level ' + lvl;
    if (pick.type === 'asi') add(pick.inc, at + ' improvement');
    else if (pick.type === 'feat'){ add(featFixed(pick.feat), pick.feat + ' (' + at + ')'); add((build.featChoices[pick.feat] || {}).inc, pick.feat + ' (' + at + ')'); }
  });
  if (build.originFeat){ add(featFixed(build.originFeat), build.originFeat); add((build.featChoices[build.originFeat] || {}).inc, build.originFeat); }
  // Ability scores top out at 20; an Epic Boon (2024, level 19) raises the
  // cap to 30 for the score it improves.
  const boonCap = {};
  Object.keys(build.asi || {}).forEach(lvl => {
    const pick = build.asi[lvl] || {};
    const f = pick.type === 'feat' && sktRulesFeat(R, pick.feat);
    if (f && f.category === 'EB') Object.keys((build.featChoices[pick.feat] || {}).inc || {}).forEach(k => { boonCap[k] = 30; });
  });
  SKT_ABS.forEach(k => { const c = Math.max(1, Math.min(boonCap[k] || 20, out[k])); if (c < out[k]) note('Capped at ' + (boonCap[k] || 20), k, c - out[k]); out[k] = c; });
  // Magic items: a score set to a number (it never lowers one), or raised.
  _sktActiveItems(build).forEach(m => {
    const a = m.ability; if (!a || typeof a !== 'object') return;
    Object.keys(a.static || {}).forEach(k => { if (k in out && (+a.static[k] || 0) > out[k]){ note(m.name + ' (sets ' + a.static[k] + ')', k, (+a.static[k] || 0) - out[k]); out[k] = +a.static[k]; } });
    SKT_ABS.forEach(k => { if (typeof a[k] === 'number'){ const v = Math.min(20, out[k] + a[k]); note(m.name, k, v - out[k]); out[k] = v; } });
  });
  // The sheet's Customize, as on D&D Beyond: a bonus on top, or the score set
  // outright — last, so every modifier, save, skill and attack follows it.
  const ovr = build.overrides || {};
  SKT_ABS.forEach(k => {
    const b2 = +((ovr.abBonus || {})[k]) || 0; if (b2){ note('Custom bonus', k, b2); out[k] += b2; }
    const set = parseInt((ovr.abScore || {})[k], 10); if (set > 0 && set !== out[k]){ note('Set on the sheet', k, set - out[k]); out[k] = set; }
  });
  return out;
}

// "Base 15 · Species +1 · Level 4 improvement +2" for each score.
function sktAbilityBreakdown(build, R){
  const t = {}; sktBuildAbilities(build, R, t);
  const out = {};
  SKT_ABS.forEach(k => { out[k] = (t[k] || []).map(([l, n], i) => i === 0 ? l + ' ' + n : l + ' ' + (n > 0 ? '+' : '') + n).join(' · '); });
  return out;
}

// The features a build has, in level order: class, subclass, species,
// background, feats and optional features. Each carries where it came from,
// its text, and whether this file applies it mechanically.
// Features the data names differently from the book (and D&D Beyond).
const _SKT_FEATURE_NAME = { 'Giant Power|BGG': 'Giant’s Power' };
function sktBuildFeatures(build, R){
  const parts = sktClassLevels(build, R);
  const tag = (f, p) => (f.from === 'class' || f.from === 'subclass') ? Object.assign(f, { cls: p.key, clsLevel: p.level }) : f;
  if (parts.length === 1) return _sktBuildFeaturesOne(build, R).map(f => tag(f, parts[0]));
  const out = _sktBuildFeaturesOne(sktClassView(build, R, parts[0]), R).map(f => tag(f, parts[0]));
  parts.slice(1).forEach(p => _sktBuildFeaturesOne(sktClassView(build, R, p), R)
    .filter(f => f.from === 'class' || f.from === 'subclass').forEach(f => out.push(tag(f, p))));
  return out;
}
function _sktBuildFeaturesOne(build, R){
  const cls = sktRulesClass(R, build.cls), sub = sktRulesSubclass(cls, build.subclass);
  const L = build.level || 1;
  const out = [];
  const push = (f, from, level, info) => {
    const isInfo = !!info || _sktIsHeader(f.name, from, sub);
    out.push({
      name: f.name, from, level: level || 0, info: isInfo,
      text: sktRulesText(f.entries),
      mech: !isInfo && (!!sktFeatureEffect(f.name, from, R.edition, cls && cls.key) || !!sktFeatureExtra(f.name, from, cls && cls.key)
                        || ((from === 'class' || from === 'subclass') && (/ Spells$|^Spellcasting$/.test(f.name) || !!sktPassiveGrants(sktRulesText(f.entries)).any))
                        || !!sktFeatureChoice(f.name, from, R.edition, cls && cls.key) || !!f.optionSpec
                        || (from === 'subclass' && sktProfGrants(sktRulesText(f.entries)).any)
                        || (/^(class|subclass|species|feat)$/.test(from) && !/^Channel Divinity:/.test(f.name)
                            && !((from === 'species' || from === 'feat') && /\bcast\b/i.test(sktRulesText(f.entries)))
                            && !!sktUsesFromText(sktRulesText(f.entries), { pb: 2, mod: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } }, f.name))),
      optionSpec: f.optionSpec || undefined,
    });
  };
  if (cls){
    const title = sktRulesInline(cls.subclassTitle || '').toLowerCase();
    const opt = !!build.optionalFeatures;
    const replaced = opt ? cls.features.filter(f => f.optional && f.replaces && f.level <= L).map(f => f.replaces.toLowerCase()) : [];
    cls.features.filter(f => f.level <= L && (!f.optional || opt)
      && !replaced.some(r => f.name.toLowerCase() === r || f.name.toLowerCase().startsWith(r + ' '))).forEach(f => {
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
  if (sub) sub.features.filter(f => f.level <= L)
    .filter(f => !f.optionOf || (build.featureChoices || {})[f.optionOf] === (f.optionValue || f.name))
    .forEach(f => push(f, 'subclass', f.level));
  const sp = sktRulesSpecies(R, build.species);
  if (sp){
    const sr = sktSpeciesSub(sp, build);
    _sktTraits(sp.entries).filter(t => !(sr && sr.replaces || []).includes(t.name)).forEach(t => push(t, 'species', 1));
    if (sr) _sktTraits(sr.entries).forEach(t => push(t, 'species', 1));
  }
  const bg = sktBuildBackground(R, build);
  if (bg) _sktTraits(bg.entries).filter(t => /^Feature:/i.test(t.name) || R.edition === '2014')
    // A background's feature is a story benefit the DM rules on: nothing for the sheet to count.
    .filter(t => /^Feature:/i.test(t.name)).forEach(t => push(t, 'background', 1, true));
  sktBuildFeatNames(build, R).forEach(n => { const f = sktRulesFeat(R, n); if (f) push(f, 'feat', 1); });
  Object.keys(build.optional || {}).forEach(group => (build.optional[group] || []).forEach(n => {
    const o = R.optional.find(x => x.name === n) || sktRulesFeat(R, n);
    if (o) push(o, 'optional', 1, (o.featureType || []).includes('EFA:Plan'));
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
  if (from === 'subclass' && /^(Tenets of |Restriction\b)/.test(n)) return true;
  if (from === 'species' && /^(Ability Score Increase|Age|Alignment|Size|Speed|Languages?|Creature Type|Subrace)$/i.test(n)) return true;
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
  const bg = sktBuildBackground(R, build);
  // A background's feat: the 2024 origin feat, and the 2014 backgrounds from
  // later books that grant one (Astral Drifter, the Strixhaven students).
  // Several listed are a choice (Rewarded: Lucky, Magic Initiate or
  // Skilled), kept in build.bgFeat.
  if (bg && Array.isArray(bg.feats) && bg.feats.length){
    const o = bg.feats[Math.min(Math.max(0, +build.bgFeat || 0), bg.feats.length - 1)] || {};
    Object.keys(o).forEach(k => { if (o[k] === true) out.push(_sktTitle(k.split('|')[0])); });
  }
  if (build.originFeat) out.push(build.originFeat);
  const slots = new Set(sktAsiSlots(build, R).map(s => s.key));
  Object.keys(build.asi || {}).forEach(lvl => {
    const p = build.asi[lvl];
    if (slots.has(String(lvl)) && p && p.type === 'feat' && p.feat) out.push(p.feat);
  });
  (build.extraFeats || []).forEach(n => { if (n) out.push(n); });
  return out;
}
// Subclass features that are a pick made when building, as D&D Beyond asks
// it: the Hunter's Prey and the rest of the Hunter's options, the Totem
// Warrior's animals, the Storm Herald's environment. Their options are the
// data's "options" block (separate features: Colossus Slayer, Bear…) or, in
// the 2024 Hunter, named entries in the feature itself. The options not
// chosen are left off the sheet.
const SKT_OPTION_CHOICES = /^(Totem Spirit|Aspect of the Beast|Totemic Attunement|Storm Aura|Storm Soul|Raging Storm|Hunter's Prey|Defensive Tactics|Multiattack|Superior Hunter's Defense|Armor Model)$/;
function _sktOptionFeatures(sc){
  // The first two sentences: the first is often only flavour ("Your tenacity
  // can wear down the most potent foes.").
  const first = e => sktRulesText([].concat(e || [])).split(/(?<=\.)\s/).slice(0, 2).join(' ').slice(0, 260);
  sc.features.forEach(f => {
    if (!SKT_OPTION_CHOICES.test(f.name)) return;
    const refs = [], inline = [];
    (function walk(e){
      if (Array.isArray(e)) return e.forEach(walk);
      if (!e || typeof e !== 'object') return;
      if (e.type === 'options') (e.entries || []).forEach(c => {
        if (c && c.type === 'refSubclassFeature'){ const p = String(c.subclassFeature).split('|'); refs.push({ name: p[0], level: +p[5] || f.level }); }
      });
      else if (e.type === 'entries' && e.name && f.entries.indexOf(e) < 0 && !refs.length) inline.push({ name: sktRulesInline(e.name), entries: e.entries });
      Object.values(e).forEach(walk);
    })(f.entries);
    // The 2024 Armorer lists its models as features straight in the entries.
    if (!refs.length && /choose one of the following/i.test(JSON.stringify(f.entries)))
      f.entries.forEach(e => { if (e && e.type === 'refSubclassFeature'){ const p = String(e.subclassFeature).split('|'); refs.push({ name: p[0], level: +p[5] || f.level }); } });
    const ref = r => { const c = sc.features.find(x => x.name === r.name && x.level === r.level); return c; };
    const opts = refs.length ? refs.map(r => { const c = ref(r); if (c) c.optionOf = f.name; return { value: r.name, label: r.name, desc: c ? first(c.entries) : '' }; })
      : inline.length > 1 && /one of the following/i.test(JSON.stringify(f.entries)) ? inline.map(o => {
        // An option's own features (the 2014 Guardian's Thunder Gauntlets) go with it.
        (JSON.stringify(o.entries).match(/"subclassFeature":"[^"]+"/g) || []).forEach(m => { const p = m.slice(19, -1).split('|'); const c = ref({ name: p[0], level: +p[5] || f.level }); if (c){ c.optionOf = f.name; c.optionValue = o.name; } });
        return { value: o.name, label: o.name, desc: first(o.entries) };
      }) : [];
    if (opts.length > 1) f.optionSpec = { label: f.name, options: opts, inline: !refs.length,
      apply(ctx, v){ if (this.inline && this.options.some(o => o.value === v)) _fxNote(ctx, f.name + ': ' + v + '.'); } };
  });
  return sc;
}
// A species version from the data's _versions: the traits it adds, the
// species traits it replaces or removes, and the numbers it sets (Drow's
// 120-foot darkvision, Wood Elf's 35 feet, a Tiefling legacy's resistance).
// A field set to null takes the species' away (Custom Lineage's skill when
// darkvision is chosen).
function _sktSpeciesVersion(r, v, src){
  const label = String(v.name).split(';').slice(1).join(';').trim() || String(v.name);
  const adds = [], replaces = [];
  [].concat((v._mod || {}).entries || []).forEach(m => {
    if (!m || typeof m !== 'object') return;
    const items = [].concat(m.items || []);
    if (m.mode === 'replaceArr'){ replaces.push(...[].concat(m.replace).map(String)); adds.push(...items); }
    else if (m.mode === 'removeArr') replaces.push(...[].concat(m.names || []).map(String));
    else if (/^(append|prepend|insert)Arr$/.test(m.mode)) adds.push(...items);
  });
  const has = k => Object.prototype.hasOwnProperty.call(v, k);
  const map = { darkvision: 'darkvision', resist: 'resist', skills: 'skillProficiencies', additionalSpells: 'additionalSpells', speed: 'speed' };
  return {
    name: label, source: v.source || r.source, core: (v.source || r.source) === src, version: true,
    optional: /^Variant;/i.test(String(v.name)), replaces,
    overrides: Object.keys(map).filter(k => has(map[k])),
    ability: null, speed: has('speed') ? v.speed : undefined, darkvision: has('darkvision') ? (v.darkvision || 0) : undefined,
    resist: v.resist || [], skills: v.skillProficiencies || [], weapons: [], armor: [], languages: [], tools: [],
    feats: null, additionalSpells: has('additionalSpells') ? v.additionalSpells : null, entries: adds,
  };
}
// A dragonborn's ancestries: the data's colour template (2024, Fizban's), or
// the Draconic Ancestry table in the 2014 handbook's traits (Dragon, Damage
// Type, Breath Weapon).
function _sktAncestries(r){
  const fromTemplate = [].concat(...(r._versions || []).filter(v => v && v._abstract).map(v => (v._implementations || []).map(im => {
    const vars = im._variables || {}, dmg = String(vars.damageType || '').toLowerCase();
    return { name: vars.color || dmg, damage: dmg, resist: im.resist || vars.resist || (dmg ? [dmg] : []) };
  }))).filter(a => a.name);
  if (fromTemplate.length) return fromTemplate;
  const out = [];
  (function walk(e){
    if (Array.isArray(e)) return e.forEach(walk);
    if (!e || typeof e !== 'object') return;
    if (e.type === 'table' && (e.colLabels || []).map(String).some(l => /^Dragon$/i.test(l)) && (e.colLabels || []).map(String).some(l => /Damage Type/i.test(l))){
      const di = e.colLabels.findIndex(l => /Damage Type/i.test(String(l)));
      (e.rows || []).forEach(row => { const dmg = sktRulesInline(String(row[di] || '')).toLowerCase(); if (row[0] && dmg) out.push({ name: sktRulesInline(String(row[0])), damage: dmg, resist: [dmg] }); });
    }
    Object.values(e).forEach(walk);
  })(r.entries || []);
  return out;
}
// What a species asks for its damage resistance: a draconic ancestry (the
// colour sets the resistance and the breath weapon's damage), or a pick
// from the species' list (the 2014 Dragonborn). Null when it has none to
// choose, or its version settles it (a Tiefling's legacy).
function sktSpeciesResistChoice(sp, sub){
  if (!sp) return null;
  if (sub && (sub.overrides || []).includes('resist')) return null;
  if ((sp.ancestries || []).length) return { kind: 'ancestry', options: sp.ancestries };
  const ch = (sp.resist || []).find(r => r && r.choose);
  return ch ? { kind: 'resist', options: (ch.choose.from || []).map(d => ({ name: d, damage: d, resist: [d] })) } : null;
}
function sktSpeciesResist(sp, sub, build){
  const c = sktSpeciesResistChoice(sp, sub), sc = (build && build.speciesChoice) || {};
  if (!c) return null;
  return c.options.find(o => o.name === (c.kind === 'ancestry' ? sc.ancestry : sc.resist)) || null;
}
// The subrace or version a build has: the one named, or for a species that
// picks it through its lineage's spells, the version of that lineage.
function sktSpeciesSub(sp, build){
  if (!sp) return null;
  const named = build && build.subspecies ? sp.subraces.find(x => x.name === build.subspecies) : null;
  if (named) return named;
  const lin = build && build.speciesChoice && build.speciesChoice.lineage;
  return lin && sp.versions ? (sp.versions.find(v => v.name === lin || v.name.startsWith(lin + ' ')) || null) : null;
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
  const parts = sktClassLevels(build, R);
  if (parts.length === 1) return _sktSpellcastingOne(build, R, abilities);
  const each = parts.map(p => { const view = sktClassView(build, R, p); return { p, view, sc: _sktSpellcastingOne(view, R, abilities) }; })
    .filter(x => x.sc);
  if (!each.length) return null;
  // The sheet's DC and attack are the first casting class's; each class
  // keeps its own counts, spells and DC in `classes`.
  const main = each[0];
  const out = Object.assign({}, main.sc, { slots: {}, pact: null,
    classes: each.map(x => ({ cls: x.p.cls, key: x.p.key, primary: x.p.primary, entry: x.p.entry, level: x.p.level, view: x.view, sc: x.sc })) });
  if (!main.p.primary){ out.cantrips = 0; out.prepared = 0; out.known = 0; delete out.spellbook; }
  // Slots: one slot-casting class uses its own table; two or more add up
  // their levels (full, half, a third) on the multiclass table, which is the
  // full caster's. Half casters round down in 2014 and up in 2024.
  const slotted = each.filter(x => !x.sc.pact);
  if (slotted.length === 1) Object.assign(out.slots, slotted[0].sc.slots);
  else if (slotted.length > 1){
    let lvl = 0;
    slotted.forEach(x => {
      const pr = x.sc.progression, L = x.p.level;
      lvl += pr === 'full' ? L : pr === '1/2' ? (R.edition === '2024' ? Math.ceil(L / 2) : Math.floor(L / 2))
           : pr === 'artificer' ? Math.ceil(L / 2) : pr === '1/3' ? Math.floor(L / 3) : 0;
    });
    const full = R.classes.find(c => c.casterProgression === 'full' && (c.tableGroups || []).some(g => g.rowsSpellProgression));
    if (lvl > 0 && full) _sktSpellTable(full, lvl).forEach((n, i) => { if (n) out.slots[i + 1] = n; });
    out.casterLevel = lvl;
  }
  // Pact Magic stays its own, recovered on a short rest.
  const pact = each.find(x => x.sc.pact);
  if (pact && pact.sc.pact.count){
    out.pact = pact.sc.pact;
    out.slots[out.pact.level] = (out.slots[out.pact.level] || 0) + out.pact.count;
  }
  out.maxSpellLevel = Math.max(0, ...Object.keys(out.slots).map(Number));
  out.cantripLists = each.map(x => ({ names: x.p.primary ? (build.cantrips || []) : ((x.p.entry || {}).cantrips || []), attack: x.sc.attack, dc: x.sc.dc }));
  return out;
}
function _sktSpellcastingOne(build, R, abilities){
  const cls = sktRulesClass(R, build.cls), sub = sktRulesSubclass(cls, build.subclass);
  const L = build.level || 1;
  const caster = cls && (cls.casterProgression ? cls : (sub && sub.casterProgression && L >= 3 ? sub : null));
  if (!caster || !caster.spellcastingAbility) return null;
  const ab = caster.spellcastingAbility;
  const pb = sktProfBonus(L);
  const mod = sktMod(abilities[ab]);
  const idx = Math.max(0, Math.min(19, L - 1));
  // Proficiency is the character's, not the class's.
  const out = { ability: ab, dc: 8 + sktProfBonus((build._full || build).level || L) + mod, attack: sktProfBonus((build._full || build).level || L) + mod, slots: {}, pact: null,
                progression: caster.casterProgression,
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
  // A 2014 bard's Magical Secrets are picked on their own (sktMagicalSecrets).
  if (R.edition === '2014' && cls.key === 'bard') out.known = Math.max(0, out.known - [10, 14, 18].filter(l => L >= l).length * 2);
  // A wizard prepares from a spellbook, not the whole wizard list: six
  // spells at 1st level and two more each level after (both editions).
  if (cls && cls.key === 'wizard' && caster === cls) out.spellbook = 6 + 2 * (L - 1);
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
  // Not a caster yet: a 2014 paladin or ranger at 1st level has the class's
  // casting ability but no slots, cantrips or spells until 2nd.
  if (!out.maxSpellLevel && !out.cantrips) return null;
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
  const extra0 = sktExpandedSpells(sub, build);
  // And a species', feat's or option's expanded list (Spells of the Mark).
  const more = new Set([].concat(((sktSpeciesSpellGrant(R, build) || {}).expanded || []), ...sktFeatSpells(build, R).map(g => g.expanded || [])).map(n => n.toLowerCase()));
  const extra = s => extra0(s) || more.has(s.name.toLowerCase());
  const lists = [listName].concat(cls.key === 'bard' && R.edition === '2024' && (build.level || 1) >= 10 ? ['Cleric', 'Druid', 'Wizard'] : []);
  return R.spells.filter(s => s.level === level && (lists.some(l => sktSpellOnList(s, l, build)) || extra(s)))
    .sort((a, b) => a.name.localeCompare(b.name));
}
// A subclass's expanded spell list: a warlock patron's spells ("s1": burning
// hands, command…) or a filter (Chronurgy's "source=EGW", the dunamancy
// spells). They join the class's list for this character only; choosing the
// subclass is choosing its book, so no "other books" tick is needed. A
// numbered key is the class level the spells arrive at.
function sktExpandedSpells(sub, build){
  const names = new Set(), filters = [];
  sktSubclassBlocks(sub, build).forEach(block => {
    const ex = block && block.expanded; if (!ex) return;
    Object.keys(ex).forEach(k => {
      if (/^\d+$/.test(k) && (build.level || 1) < +k) return;
      (Array.isArray(ex[k]) ? ex[k] : []).forEach(x => {
        if (typeof x === 'string') names.add(x.split('|')[0].replace(/#.*$/, '').trim().toLowerCase());
        else if (x && x.all) filters.push(x.all);
      });
    });
  });
  if (!names.size && !filters.length) return () => false;
  const match = (s, filter) => String(filter).split('|').every(p => {
    const i = p.indexOf('='); if (i < 0) return true;
    const k = p.slice(0, i).trim().toLowerCase(), v = p.slice(i + 1).trim().toLowerCase().split(';');
    if (k === 'source') return v.includes(String(s.source).toLowerCase());
    if (k === 'level') return v.includes(String(s.level));
    if (k === 'school') return v.includes(String(s.school).toLowerCase());
    if (k === 'class') return v.some(c => sktSpellOnList(s, _sktTitle(c), build));
    return true;
  });
  return s => names.has(s.name.toLowerCase()) || filters.some(f => match(s, f));
}
// Whether a spell is on a class's list for this character: the handbook's
// lists, or every book's with "other books" on.
function sktSpellOnList(s, listName, build){
  if (sktExtraSources(build)) return sktBookOk(build, s) && s.classesAll.includes(listName);
  // Only the 2024 core, but a legacy spell switched on: its own lists.
  if (!s.core && sktBookOk(build, s)) return s.classesAll.includes(listName);
  return s.core && s.classes.includes(listName);
}

// ── Spells a feat grants ─────────────────────────────────────────────────────
// Magic Initiate, Fey Touched, Ritual Caster and the rest describe what they
// grant in the data's additionalSpells: one block per spell list to choose
// from, each with fixed spells ("misty step") and choices written as filters
// ("level=1|class=Bard", "level=1|school=E;D", "…|components &
// miscellaneous=ritual"). Read generally, so a feat from any book works.
// A feat taken this way used to grant nothing at all.
function sktSpellsMatching(R, filter, build){
  const f = {};
  String(filter || '').split('|').forEach(p => { const i = p.indexOf('='); if (i > 0) f[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim(); });
  const many = v => String(v).split(';').map(x => x.trim().toLowerCase()).filter(Boolean);
  return R.spells.filter(s => {
    if (f.level != null && !many(f.level).includes(String(s.level))) return false;
    if (!sktBookOk(build, s)) return false;
    if (f.class && !many(f.class).some(c => (build && (sktExtraSources(build) || !s.core) ? s.classesAll : s.classes).map(x => x.toLowerCase()).includes(c))) return false;
    if (f.school && !many(f.school).includes(String(s.school).toLowerCase())) return false;
    if (/ritual/i.test(f['components & miscellaneous'] || '') && !s.ritual) return false;
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));
}
function _sktGrantItems(block){
  const out = [];
  const walk = (node, info, depth) => {
    if (Array.isArray(node)){
      node.forEach(x => {
        if (typeof x === 'string') out.push({ fixed: x.split('|')[0].replace(/#.*$/, '').trim(), ...info });
        else if (x && x.choose && typeof x.choose === 'object') out.push({ from: (x.choose.from || []).map(n => String(n).split('|')[0].replace(/#.*$/, '').trim()), choose: '', count: x.choose.count || x.count || 1, ...info });
        else if (x && x.choose) out.push({ choose: String(x.choose), count: x.count || 1, ...info });
      });
      return;
    }
    // The first keys under a kind are the character level it arrives at
    // ("3": …), or "_" for from the start.
    if (node && typeof node === 'object') Object.keys(node).forEach(k => walk(node[k], {
      ...info, daily: info.daily || k === 'daily',
      minLevel: depth === 0 && /^\d+$/.test(k) ? +k : info.minLevel,
    }, depth + 1));
  };
  ['innate', 'known', 'prepared', 'expanded'].forEach(kind => { if (block[kind]) walk(block[kind], { kind, daily: false, minLevel: 0 }, 0); });
  return out;
}
// The list a 2024 background fixes: "magic initiate; cleric|xphb" → 'cleric'.
function _sktFeatHint(build, R, featName){
  const bg = sktBuildBackground(R, build);
  if (R.edition !== '2024' || !bg || !Array.isArray(bg.feats)) return '';
  for (const o of bg.feats) for (const k of Object.keys(o)){
    const [nm, rest] = k.split('|')[0].split(';');
    if (rest && nm.trim().toLowerCase() === String(featName).toLowerCase()) return rest.trim().toLowerCase();
  }
  return '';
}
// Everything about one grant of spells (a feat's, a species'): the lists,
// the one in force, the ability, each choice with its options and picks, and
// what is missing. `ch` holds the player's answers: { spellList,
// spellAbility, spells, inc }.
function _sktSpellGrant(R, build, name, spec, ch, hint){
  const L = build.level || 1;
  const blocks = spec.map(b => ({ name: String(b.name || name).replace(/ Spells$/, ''), raw: b.name || '', ability: b.ability,
                                  items: _sktGrantItems(b).filter(it => (it.minLevel || 0) <= L) }));
  const block = blocks.length === 1 ? blocks[0]
    : blocks.find(b => hint && b.name.toLowerCase() === hint) || blocks.find(b => ch.spellList && (b.name === ch.spellList || b.raw === ch.spellList)) || null;
  let ability = null, abilityChoices = null;
  if (block){
    const a = block.ability;
    if (typeof a === 'string' && a !== 'inherit') ability = a;
    else if (a && a.choose){ abilityChoices = a.choose; ability = abilityChoices.includes(ch.spellAbility) ? ch.spellAbility : null; }
    else if (a === 'inherit') ability = Object.keys(ch.inc || {})[0] || null;
  }
  const picked = Array.isArray(ch.spells) ? ch.spells : [];
  const used = new Set();
  const choices = [], spells = [], daily = [], expanded = [];
  if (block) block.items.forEach(it => {
    if (it.kind === 'expanded'){ if (it.fixed) expanded.push((sktRulesSpell(R, it.fixed) || { name: _sktTitle(it.fixed) }).name); return; }
    if (it.fixed){
      const sp = sktRulesSpell(R, it.fixed);
      const n = sp ? sp.name : _sktTitle(it.fixed);
      spells.push(n); if (it.daily) daily.push(n);
      return;
    }
    const options = it.from ? it.from.map(n => (sktRulesSpell(R, n) || { name: _sktTitle(n) }).name) : sktSpellsMatching(R, it.choose, build).map(s => s.name);
    const mine = picked.filter(n => options.includes(n) && !used.has(n)).slice(0, it.count);
    mine.forEach(n => { used.add(n); spells.push(n); if (it.daily) daily.push(n); });
    choices.push({ filter: it.choose, count: it.count, options, picked: mine, daily: it.daily, minLevel: it.minLevel || 0 });
  });
  const missing = (block ? 0 : 1) + (abilityChoices && !ability ? 1 : 0) + choices.reduce((n, c) => n + Math.max(0, c.count - c.picked.length), 0);
  return { feat: name, blocks, block, listFixed: blocks.length === 1 || !!hint, ability, abilityChoices, choices, spells, daily, expanded, missing };
}
function sktFeatSpellGrant(R, build, featName){
  const f = sktRulesFeat(R, featName);
  if (!f || !Array.isArray(f.additionalSpells) || !f.additionalSpells.length) return null;
  return _sktSpellGrant(R, build, f.name, f.additionalSpells, (build.featChoices || {})[f.name] || {}, _sktFeatHint(build, R, f.name));
}
// A species' spells: a Tiefling's legacy, a High Elf's cantrip, a 2024
// Elf's lineage. They granted nothing before. The 2024 lineage chosen on the
// species step picks the block. Keyed '@species' where a choice is stored.
function sktSpeciesSpellGrant(R, build){
  const sp = sktRulesSpecies(R, build.species);
  if (!sp) return null;
  const sub = sktSpeciesSub(sp, build);
  const spec = (sub && (sub.overrides || []).includes('additionalSpells')) ? (sub.additionalSpells || [])
    : (sub && Array.isArray(sub.additionalSpells) && sub.additionalSpells.length) ? sub.additionalSpells : sp.additionalSpells;
  if (!Array.isArray(spec) || !spec.length) return null;
  const ch = Object.assign({}, build.speciesChoice || {});
  if (ch.lineage) ch.spellList = ch.lineage;
  const g = _sktSpellGrant(R, build, '@species', spec, ch, '');
  g.label = sub ? sub.name + ' ' + sp.name : sp.name;
  // The lineage is chosen with the species, not as a list here.
  g.listFixed = true;
  return g;
}
function sktFeatSpells(build, R){
  return sktBuildFeatNames(build, R).map(n => sktFeatSpellGrant(R, build, n)).filter(Boolean).concat(sktSubclassSpellGrants(build, R), sktOptionalSpellGrants(build, R));
}
// Spells a picked option gives: an invocation's at-will spell (Armor of
// Shadows, Mask of Many Faces), a 2024 Blessed Warrior's cantrips.
function sktOptionalSpellGrants(build, R){
  const names = [...new Set([].concat(...Object.values(build.optional || {})))];
  return names.map(n => R.optional.find(x => x.name === n) || sktRulesFeat(R, n)).filter(o => o && Array.isArray(o.additionalSpells) && o.additionalSpells.length)
    .map(o => _sktSpellGrant(R, build, o.name, o.additionalSpells, (build.featChoices || {})[o.name] || {}, ''));
}
// Spells a subclass lets the character pick: the Arcana Domain's wizard
// cantrips, a Nature cleric's druid cantrip, the Lore bard's Additional
// Magical Secrets. Its fixed spells are always prepared instead. Picks are
// kept in featChoices under the subclass's name.
function sktSubclassSpellGrants(build, R){
  const onlyChoose = v => Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && x.choose)
    : (v && typeof v === 'object') ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, onlyChoose(x)])) : v;
  return sktClassLevels(build, R).map(p => {
    const view = sktClassView(build, R, p), cls = sktRulesClass(R, view.cls), sub = sktRulesSubclass(cls, view.subclass);
    const b = sub && sktSubclassBlocks(sub, view)[0];
    if (!b) return null;
    const only = {}; ['known', 'prepared', 'innate'].forEach(k => { if (b[k]) only[k] = onlyChoose(b[k]); });
    const g = _sktSpellGrant(R, view, sub.name, [only], (build.featChoices || {})[sub.name] || {}, '');
    g.cls = cls.key;
    return g.choices.length ? g : null;
  }).filter(Boolean);
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
// On/off states the sheet switches, D&D Beyond's toggles: Rage, Bladesong,
// Shield, Bless… Each changes numbers while it's on. Where one is on lives
// with the character, not the build: Rage is the party card's own switch, a
// concentration spell is on while it's the one concentrated on, the rest
// are in pc.active.
const SKT_STATES = [];
function sktDefineState(s){ SKT_STATES.push(s); }
function sktStateSig(pc){
  pc = pc || {}; const a = pc.active || {};
  return [pc.rage ? 'R' : '', pc.concentration ? 'C:' + pc.concentration : ''].concat(Object.keys(a).filter(k => a[k]).sort().map(k => 'A:' + k + '=' + a[k])).filter(Boolean).join('|');
}
// The states a character has, and which are on.
function _sktStates(ctx, prior){
  const out = [];
  SKT_STATES.forEach(s => {
    if (s.edition && s.edition !== ctx.edition) return;
    if (s.spell ? !ctx.knows.has(s.spell) : !(s.has && s.has(ctx))) return;
    const sp = s.spell ? sktRulesSpell(ctx.R, s.spell) : null;
    const conc = !!(sp && (sp.duration || []).some(d => d && d.concentration));
    const on = s.key === 'Rage' ? !!prior.rage : conc ? prior.concentration === s.spell : !!(prior.active || {})[s.key];
    const opts = s.options ? s.options(ctx) : [];
    const value = opts.includes((prior.active || {})[s.key + ':opt']) ? prior.active[s.key + ':opt'] : (opts[0] || '');
    out.push({ s, on, conc, value });
  });
  return out;
}
// Extras: a subclass feature's numbers that sit beside the generic handling
// rather than replacing it (Dread Ambusher keeps its counted uses and adds
// WIS to initiative). Keys: 'from:Name' or 'from:class:Name'.
const SKT_FEATURE_EXTRAS = {};
function sktDefineExtra(keys, fn){ (Array.isArray(keys) ? keys : [keys]).forEach(k => { SKT_FEATURE_EXTRAS[k] = fn; }); }
function sktFeatureExtra(name, from, clsKey){ return SKT_FEATURE_EXTRAS[from + ':' + (clsKey || '') + ':' + name] || SKT_FEATURE_EXTRAS[from + ':' + name] || null; }
// An ability used in play, read from its text, as D&D Beyond lists it on the
// Actions tab: how it's used (action, bonus action, reaction, Magic action),
// what it spends (its own uses, or the class's dice and points), the dice it
// rolls, and the sentences that say what it does. Null when the text gives no
// way to use it.
const SKT_RESOURCE_WORDS = [[/superiority di(?:c?e)/i, ['Superiority Dice']], [/psionic energy di(?:c?e)/i, ['Psionic Energy', 'Psionic Energy Dice']], [/focus points?|ki points?/i, ['Focus Points']],
  [/sorcery points?/i, ['Sorcery Points']], [/bardic inspiration/i, ['Bardic Inspiration']], [/wild shape/i, ['Wild Shape']], [/lay on hands/i, ['Lay on Hands']],
  [/channel divinity/i, ['Channel Divinity']], [/\brages?\b/i, ['Rage']], [/luck points?/i, ['Luck Points']], [/healing light|dice from the pool|pool of d6s/i, ['Healing Light']]];
const SKT_NUM_WORDS = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5 };
function sktActivationFromText(text, name, ctx){
  const t = String(text || '').replace(/\s+/g, ' ').trim(); if (!t) return null;
  const sents = t.split(/(?<=[.!?])\s+/);
  const timing = s => /\breaction\b/i.test(s) ? 'Reaction' : /bonus action/i.test(s) ? 'Bonus Action' : /magic action/i.test(s) ? 'Magic'
    : /\b(as an action|use your action|take an action|an action to|use an action)\b/i.test(s) ? 'Action' : null;
  // The sentence that says how it's used: the character's own action, not another creature's.
  let action = null, at = -1;
  for (let i = 0; i < sents.length; i++){
    const s = sents[i];
    if (/\|/.test(s) || !/\byou\b/i.test(s) || /\b(it|the creature|the target|they) (?:can|must) (?:use|take)\b/i.test(s)) continue;
    const k = timing(s); if (k){ action = k; at = i; break; }
  }
  // What it spends: a cost named in the text, else its own counted uses.
  let resource = null, amount = 1;
  // Spending is "expend" or "spend": "use Reckless Attack while your Rage is active" spends nothing.
  const costRe = /\b(?:expend|spend)s?\s+(?:(one|a|an|two|three|four|five|\d+)\s+)?(?:use of (?:your |a |the )?|of your )?([A-Za-z' ]{2,40}?)(?=[ ,.;:]|$)/gi;
  // Its own counted uses first: a die spent to get a use back isn't the cost.
  if (ctx.resources.some(r => r.name === name)) resource = name;
  let m;
  while (!resource && (m = costRe.exec(t))){
    // What follows "expend one use of your" names the resource ("Bardic Inspiration die", "Focus Point to…").
    const near = t.slice(m.index, m.index + 70);
    const hit = SKT_RESOURCE_WORDS.find(([re]) => re.test(near));
    const nm = hit && hit[1].find(n => ctx.resources.some(r => r.name === n));
    if (nm){ resource = nm; amount = m[1] ? (SKT_NUM_WORDS[m[1].toLowerCase()] || parseInt(m[1], 10) || 1) : 1; }
  }
  if (!action && !resource) return null;
  // The dice: a die the resource rolls (a Superiority Die), else the first written.
  const pool = resource && ctx.resources.find(r => r.name === resource);
  const scope = at >= 0 ? sents.slice(at, at + 3).join(' ') : t;
  let dice = null;
  if (pool && pool.die && /\broll (?:the |a |that |one )?(?:die|dice|superiority die|psionic energy die|bardic inspiration die)\b|\bdie\b.*\b(?:roll|add)/i.test(scope)) dice = String(pool.die).replace(/^1?d/, '1d');
  if (!dice){ const d = /\b(\d+d\d+)(?:\s*\+\s*(\d+))?\b/.exec(scope) || /\b(\d+d\d+)\b/.exec(t); if (d) dice = d[1] + (d[2] ? '+' + d[2] : ''); }
  // "You can then…", "In addition, …": the sentence before says what this follows.
  const back = at > 0 && /^(?:you can then|then|in addition|additionally|also|this|it|when you do|if you do)\b/i.test(sents[at]) ? 1 : 0;
  const desc = (at >= 0 ? sents.slice(at - back, at + 2) : sents.filter(s => !/\|/.test(s)).slice(0, 2)).join(' ');
  return { name, action: action || 'Special', resource: resource || undefined, amount: resource ? amount : undefined, dice: dice || undefined,
           desc: desc.length > 300 ? desc.slice(0, 297).replace(/\s\S*$/, '') + '…' : desc };
}
// Passive bonuses read from a feature's text, beside the actions:
//  • extra damage on a hit ("an extra 1d8 damage", "1d6 radiant damage",
//    growing "to 2d8 at 14th level") → the Actions tab's Extra damage list;
//  • a bonus to Initiative equal to a modifier or the proficiency bonus;
//  • advantage on named ability checks: always (applied to the roll), or under
//    a condition (a reminder on the Features tab).
// Each returns whether it applied anything.
const _SKT_SKILL_WORDS = { 'animal handling': 'animal_handling', 'sleight of hand': 'sleight_of_hand' };
function sktPassiveFromText(text, name, ctx){
  const t = String(text || '').replace(/\{@\w+ ([^|}]+)[^}]*\}/g, '$1').replace(/\s+/g, ' ');
  const sents = t.split(/(?<=[.!?])\s+/).filter(s => !/\|/.test(s));
  let did = false;
  // Extra damage.
  if (!ctx.extraDamage.some(x => x.label === name)){
    for (const s of sents){
      const m = /\b(?:an? )?(?:extra|additional) (\d+d\d+)(?: ?\+ ?[^ ]+)?(?: (acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder))? damage/i.exec(s)
        || /\b(?:takes?|deals?|deal) (?:an? )?(?:extra|additional) (\d+d\d+)(?: (acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder))?/i.exec(s);
      if (!m) continue;
      let dice = m[1];
      const L = ctx.level || 1;
      // "to 2d8 at 14th level" (2014) or "to 1d6 when you reach Ranger level 11" (2024).
      (t.match(/(\d+d\d+) (?:at|when you reach) (?:\d+(?:st|nd|rd|th) level|[A-Za-z]+ level \d+)/gi) || []).forEach(x => { const q = /(\d+d\d+) \D*?(\d+)/i.exec(x); if (q && L >= +q[2]) dice = q[1]; });
      const when = s.length > 170 ? s.slice(0, 167).replace(/\s\S*$/, '') + '…' : s;
      ctx.extraDamage.push({ label: name, dice: dice + (m[2] ? ' ' + m[2].toLowerCase() : ''), note: when });
      did = true; break;
    }
  }
  // Natural weapons (Talons, Hooves, Bite, Claws): their own attack row.
  // Not a rage's (Form of the Beast picks its weapon when you rage).
  if (/unarmed strikes?|natural (?:melee )?weapons?/i.test(t) && !/\brag(?:e|ing)\b/i.test(t) && !(ctx.naturalAttacks || []).some(x => x.name === name)){
    const nw = /(\d+d\d+)(?: (?:\+|plus) your (Strength|Constitution|Dexterity) modifier)? (slashing|piercing|bludgeoning)/i.exec(t)
      || /(slashing|piercing|bludgeoning) damage equal to (\d+d\d+)(?: (?:\+|plus) your (Strength|Constitution|Dexterity) modifier)?/i.exec(t);
    if (nw){
      const byType = /^\d/.test(nw[1]);
      // "You add your Constitution modifier, instead of your Strength modifier, to the attack and damage rolls" (a 2014 Dhampir).
      const inst = /add your (Constitution|Dexterity) modifier, instead of your Strength modifier, to the attack and damage/i.exec(t);
      const ab = inst ? inst[1] : byType ? nw[2] : nw[3];
      ctx.naturalAttacks.push({ name, die: byType ? nw[1] : nw[2], ab: ab ? ab.slice(0, 3).toLowerCase() : null, hit: inst ? inst[1].slice(0, 3).toLowerCase() : 'str', type: (byType ? nw[3] : nw[1]).toLowerCase() });
      did = true;
    }
  }
  // Natural armour: "base AC is 13 + Dexterity modifier", "a base AC of 17", "+1 bonus to Armor Class".
  { const a = /(?:AC|Armor Class) (?:is|of|as|equals?) (\d+) \+ (?:your )?(Dexterity|Constitution) modifier/i.exec(t);
    if (a){ ctx.acOptions.push({ label: name, value: +a[1] + ctx.mod[a[2].slice(0, 3).toLowerCase()], noArmor: true, shieldOk: true }); did = true; }
    const f2 = !a && /base AC of (\d+) \(your Dexterity modifier doesn(?:'|’)t affect/i.exec(t);
    if (f2){ ctx.acOptions.push({ label: name, value: +f2[1], noArmor: true, shieldOk: true }); did = true; }
    // A flat bonus only from a species trait, and not one for a while (Shell Defense) or on a table (Wild Surge).
    const bs = ctx.from === 'species' && !a && !f2 && sents.find(s => /\+\d bonus to (?:your )?(?:Armor Class|AC)\b/i.test(s));
    const b = bs && !/\b(while|when|if|until|as an? (?:bonus )?action)\b/i.test(bs) && /\+(\d) bonus to/i.exec(bs);
    if (b){ ctx.acBonus.push({ label: name, value: +b[1] }); did = true; } }
  // "You can add your proficiency bonus to your initiative rolls" (Hare-Trigger).
  if (/add your proficiency bonus to your initiative/i.test(t)){ ctx.initBonus += ctx.pb; did = true; }
  // Initiative: "a bonus to your Initiative equal to your Wisdom modifier".
  for (const s of sents){
    const m = /bonus to (?:your )?Initiative(?: rolls)? equal to (?:your )?(Proficiency Bonus|(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier)/i.exec(s);
    // "When you roll Initiative" is when it applies, not a condition on it.
    if (!m || (/\b(while|when|if|until)\b/i.test(s.slice(0, m.index)) && !/roll (?:for )?initiative/i.test(s.slice(0, m.index)))) continue;
    ctx.initBonus += /proficiency/i.test(m[1]) ? ctx.pb : ctx.mod[m[2].slice(0, 3).toLowerCase()] || 0;
    did = true; break;
  }
  // Advantage on ability checks.
  for (const s of sents){
    const m = /(?<!dis)advantage on ([^.]*?)checks?\b([^.;]*)/i.exec(s); if (!m) continue;
    if (/saving throw|attack roll/i.test(m[1])) continue;
    const words = m[1].toLowerCase();
    const tags = [];
    Object.keys(SKT_SKILL_LABEL || {}).forEach(k => { const lab = String(SKT_SKILL_LABEL[k]).toLowerCase(); if (words.includes(lab)) tags.push('check:' + (_SKT_SKILL_WORDS[lab] || k.replace(/[A-Z]/g, c => '_' + c.toLowerCase()))); });
    if (!tags.length) (words.match(/\b(strength|dexterity|constitution|intelligence|wisdom|charisma)\b/g) || []).forEach(a => { if (!/\(/.test(words)) tags.push('ab:' + a.slice(0, 3)); });
    if (!tags.length) continue;
    const pre = s.slice(0, m.index), post = m[2].trim();
    const always = !/\b(while|when|whenever|if|until|for 1 minute|for the next|the first|target)\b/i.test(pre) && !post;
    if (always) ctx.rollAdv.push({ on: [...new Set(tags)], label: name });
    else _fxNote(ctx, name + ': ' + (s.length > 200 ? s.slice(0, 197).replace(/\s\S*$/, '') + '…' : s));
    did = true; break;
  }
  return did;
}
// Darkvision 60 ft, or 60 ft more if the character has it already (the 2024 way).
function _fxDarkvision60(ctx){ ctx.senses.darkvision = ctx.senses.darkvision ? ctx.senses.darkvision + 60 : 60; }
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
    const spec = sktFeatureChoice(f.name, f.from, R.edition, f.cls || (cls && cls.key)) || f.optionSpec;
    return spec ? { feature: f.name, level: f.level, cls: f.cls || '', spec, value: (build.featureChoices || {})[f.name] || '' } : null;
  }).filter(Boolean);
}

// ── How often a feature can be used ─────────────────────────────────────────
// Read from its text, for the many limited-use features without an entry of
// their own: "a number of times equal to your Wisdom modifier (minimum of
// once)", "your proficiency bonus", "twice", "You have two uses of this
// ability", "Once you use this feature, you can't use it again until you
// finish a short or long rest". D&D Beyond counts these down on the sheet;
// they become trackers named after the feature. Null when the text gives no
// clear count.
const _SKT_TIMES = { once: 1, twice: 2, one: 1, two: 2, three: 3, four: 4, 'two times': 2, 'three times': 3, 'four times': 4, 'five times': 5 };
function _sktEsc(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function sktUsesFromText(text, ctx, name){
  const t = String(text || '').replace(/\s+/g, ' ');
  const sentences = t.split(/(?<=[.!?])\s+/);
  let max = null, m;
  const times = new RegExp('(?:use (?:it|this feature|this ability|this trait|that feature' + (name ? '|' + _sktEsc(name) : '') + ')|do so|this feature can be used) (once|twice|two times|three times|four times|five times)\\b', 'i');
  if ((m = /a number of times equal to (twice |half )?your (proficiency bonus|(strength|dexterity|constitution|intelligence|wisdom|charisma) modifier)/i.exec(t))){
    const base = /proficiency/i.test(m[2]) ? ctx.pb : ctx.mod[m[3].slice(0, 3).toLowerCase()];
    max = Math.max(1, m[1] && /twice/i.test(m[1]) ? base * 2 : m[1] ? Math.floor(base / 2) : base);
  } else if ((m = times.exec(t))){
    max = _SKT_TIMES[m[1].toLowerCase()];
  } else if ((m = /you have (one|two|three|four) uses? of this (?:ability|feature)/i.exec(t))){
    max = _SKT_TIMES[m[1].toLowerCase()];
  } else if (sentences.some(s => (/^once you\b/i.test(s) || /you (?:can't|cannot) use this feature again/i.test(s)) && /(?:can't|cannot) [^.]{0,60}again until you (?:finish|start) (?:a|\d+d\d+)/i.test(s))
          || /you must finish a (?:short or long|long|short) rest before you (?:can )?(?:use (?:it|this feature) |do so )?again/i.test(t)){
    max = 1;
  }
  if (!max) return null;
  const recharge = /regain (?:one|1) expended use[^.]*short rest/i.test(t) ? 'short-one'
    : /(?:finish|start) a short or long rest|finish a short rest/i.test(t) ? 'short' : 'long';
  return { max, recharge };
}

// Lasting benefits a class or subclass feature states plainly: a damage
// resistance or immunity (Soul of the Forge, Radiant Soul), darkvision (Eyes of
// Night), a faster walk (Superior Mobility). Only where nothing in the same
// sentence makes it conditional ("while raging", "until the end of your
// turn", "when you…").
const _SKT_DT = 'acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder';
const _SKT_CT = 'blinded|charmed|deafened|frightened|grappled|paralyzed|petrified|poisoned|prone|restrained|stunned';
// "fire", "lightning and thunder", "bludgeoning, piercing, and slashing".
const _sktList = words => '((?:' + words + ')(?:(?:,? and |,? or |, )(?:' + words + '))*)';
const _sktSplit = s => s.toLowerCase().split(/,? and |,? or |, /);
function sktPassiveGrants(text){
  const out = { resist: [], immune: [], darkvision: 0, speed: 0, conditions: [], moves: {} };
  // Benefits listed under a condition ("While your Bladesong is active, you
  // gain the following benefits") are the condition's, not lasting.
  if (/\bwhile (?:the|your|you're|you are|raging|it is)[^.]*(?:following benefits|benefits:)/i.test(String(text || ''))) return Object.assign(out, { any: false });
  // So are benefits for a while, in a form, or one of a choice ("While in this
  // form, you gain the benefits below", "choose one of the following benefits").
  const lead = /[^.|]*\b(?:following benefits?|benefits below)\b[^.|]*/i.exec(String(text || ''));
  if (lead && /\b(while|when|whenever|until|for \d+ (?:minute|hour)s?|choose|of your choice|transform|this form|is active)\b/i.test(lead[0])) return Object.assign(out, { any: false });
  String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).forEach(s => {
    const lasting = (m) => {
      const before = s.slice(0, m.index), after = s.slice(m.index + m[0].length, m.index + m[0].length + 20);
      return !/\b(while|when|whenever|until|if|during|as long as|for the duration|for 1 (minute|hour)|each time|once|as an? (bonus )?action|as a reaction|to gain|to use)\b/i.test(before)
        && !/^\W*(while|until|when|for|if|during)\b/i.test(after) && !/lasts until|until the end/i.test(s.slice(m.index));
    };
    let m;
    // Not the 2014 "...damage from nonmagical attacks", which magic gets through.
    const res = new RegExp('you (?:also )?(?:gain|have) resistance to ' + _sktList(_SKT_DT) + ' damage(?! from| that| dealt)', 'i');
    if ((m = res.exec(s)) && lasting(m)) out.resist.push(..._sktSplit(m[1]));
    if ((m = new RegExp('(?:you (?:also )?(?:gain|have) )?immunity to ' + _sktList(_SKT_DT) + ' damage', 'i').exec(s)) && lasting(m)) out.immune.push(..._sktSplit(m[1]));
    // Conditions: "Immunity to the Charmed and Frightened conditions", "you can't be blinded, deafened, or poisoned".
    if ((m = new RegExp('immun(?:ity|e) to the ' + _sktList(_SKT_CT) + ' conditions?', 'i').exec(s)) && lasting(m)) out.conditions.push(..._sktSplit(m[1]));
    if ((m = new RegExp('you can(?:\'|’|no)t be ' + _sktList(_SKT_CT), 'i').exec(s)) && lasting(m)
        && !/^ (by|while|until)\b/i.test(s.slice(m.index + m[0].length))) out.conditions.push(..._sktSplit(m[1]));
    if ((m = /you have darkvision out to a range of (\d+) feet/i.exec(s)) && lasting(m)) out.darkvision = Math.max(out.darkvision, +m[1]);
    if ((m = /your (?:walking )?speed increases by (\d+) feet/i.exec(s)) && lasting(m)) out.speed += +m[1];
    // "a swimming speed of 40 feet", "a climbing speed and a swimming speed equal to your walking speed".
    const mv = /you (?:also )?(?:gain|have) an? (swim|fly|climb|burrow)(?:ming|ing)? speed(?: and an? (swim|fly|climb|burrow)(?:ming|ing)? speed)? (?:of (\d+) feet|equal to your (?:walking )?speed)/i;
    if ((m = mv.exec(s)) && lasting(m)) [m[1], m[2]].filter(Boolean).forEach(k => { out.moves[k.toLowerCase()] = m[3] ? +m[3] : 'walk'; });
  });
  out.any = out.resist.length || out.immune.length || out.darkvision || out.speed || out.conditions.length || Object.keys(out.moves).length;
  return out;
}

// Every built character whose on/off states changed since its numbers were
// worked out (Rage ended by the tracker, concentration lost to a hit, a
// toggle on the sheet) is worked out again. Called from save(), which every
// one of those paths ends in.
let _sktStatesBusy = false;
function sktStatesSyncAll(){
  if (_sktStatesBusy || typeof state === 'undefined' || !Array.isArray(state.party)) return;
  _sktStatesBusy = true;
  try {
    state.party.forEach(p => {
      if (!p || !p.build || !p.sheet || (p.sheet.stateSig || '') === sktStateSig(p)) return;
      const ed = (p.build.edition || p.rules) === '2014' ? '2014' : '2024';
      const R = _sktRulesReady[ed];
      if (!R){ if (!_sktRulesCache[ed]) sktRulesLoad(ed).then(() => typeof save === 'function' && save(), () => {}); return; }
      const rec = sktComputeCharacter(JSON.parse(JSON.stringify(p.build)), R, p);
      Object.assign(p, rec, { id: p.id, portrait: p.portrait });
      const ci = typeof _findCombatantForPartyMember === 'function' ? _findCombatantForPartyMember(p) : -1;
      if (ci >= 0 && state.combatants[ci]) state.combatants[ci].ac = p.ac;
    });
  } finally { _sktStatesBusy = false; }
}

// Advantage on saving throws a trait or feat gives, read from its text, the
// way D&D Beyond lists "Saving Throw Modifiers": "against poison" (shown
// beside the saves, for the player to apply), "all Wisdom saving throws"
// (applied to the roll), "to maintain concentration" (applied to a
// concentration save), death saves. Advantage that's temporary or someone
// else's (for 1 minute, while in the aura, the target has…) is left out.
const _SKT_AB_WORD = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };
// Class and subclass features whose advantage is always theirs.
const SKT_SAVE_ADV_FEATURES = /^(Beguiling Twist|Psychic Defenses|Spell Resistance|Among the Dead|Unyielding Spirit|Land's Stride|Born to the Saddle|Survivor)$/;
function sktSaveAdvantages(text){
  const t = String(text || '').replace(/\{@\w+ ([^|}]+)[^}]*\}/g, '$1').replace(/\s+/g, ' ');
  if (/\bwhile (?:the|your|you're|you are|raging|it is)[^.]*(?:following benefits|benefits:)/i.test(t)
      || /following benefits[^.]*(?:for 1 minute|for 10 minutes|until)/i.test(t)) return [];
  const out = [];
  t.split(/(?<=[.!?])\s+/).forEach(s => {
    const m = /(?<!dis)advantage on ([^.]*?)saving throws?\b([^.;]*)/i.exec(s); if (!m) return;
    if (/\b(while|when|whenever|if|until|for 1 minute|for the next|before the start|the first|target|creature)\b/i.test(s.slice(0, m.index))) return;
    const pre = m[1];
    if (/\b(one|an?)\b[^.]*\b(attack|check)/i.test(pre)) return;
    let post = m[2].replace(/,? and you (?:have|are|can|gain).*$/i, '').replace(/,? (?:and )?magic can.t.*$/i, '').trim().replace(/^(?:that )?(?:you make |made )/i, '');
    if (/\b(for 1 (minute|hour)|until|for the duration|while (in|within)|as do your allies)\b/i.test(post)) return;
    const abs = [...new Set((pre.replace(/[a-z]+-based ability checks and /ig, '').match(/strength|dexterity|constitution|intelligence|wisdom|charisma/ig) || []).map(x => _SKT_AB_WORD[x.toLowerCase()]))];
    out.push({ abs, when: post, death: /death/i.test(pre), conc: /concentration/i.test(post), auto: !post || /^unless\b/i.test(post) });
  });
  return out;
}
function _sktSaveAdv(ctx, a, src){
  // Once per feature: one with its own effect isn't reminded twice.
  if (ctx.rollAdv.some(x => x.label === src) || ctx.saveMods.some(x => x.src === src)) return;
  const names = a.abs.map(k => SKT_AB_NAME[k] || k);
  if (a.death) ctx.rollAdv.push({ on: ['death'], label: src });
  else if (a.conc) ctx.rollAdv.push({ on: ['conc'], label: src });
  else if (a.auto) ctx.rollAdv.push({ on: a.abs.length ? a.abs.map(k => 'save:' + k) : ['save'], label: src });
  else ctx.saveMods.push({ abs: a.abs.length ? a.abs : ['all'], text: 'Advantage on ' + (names.length ? names.join(', ').replace(/, ([^,]*)$/, ' and $1') + ' saves' : 'saving throws') + ' ' + a.when, src });
}

// Small helpers the effects share.
function _fxPool(ctx, name, max, recharge, extra){
  if (!(max > 0)) return;
  const at = ctx.resources.findIndex(r => r.name === name);
  const r = Object.assign({ name, type: 'pool', current: max, max, recharge: recharge || 'long' }, extra || {});
  if (at >= 0) ctx.resources[at] = r; else ctx.resources.push(r);
}
function _fxAction(ctx, a){ if (!ctx.actions.some(x => x.name === a.name)) ctx.actions.push(a); }
// Circle Magic (Heroes of Faerûn): you lead the casting, other spellcasters
// help as secondary casters, and one option changes the spell.
function _sktCircleSpells(ctx, sc){
  const mod = ctx.mod[sc.ability] || 0;
  const opt = (name, desc) => _fxAction(ctx, { name: 'Circle Spell: ' + name, action: 'Special', feature: 'Circle Magic', desc });
  _fxAction(ctx, { name: 'Initiate a Circle Spell', action: 'Magic', feature: 'Circle Magic',
    desc: 'Begin casting a spell as a Circle spell, with other spellcasters helping as secondary casters. Choose one Circle option below and meet its requirements; keep Concentration until the casting is done.' });
  opt('Augment', 'A spell with a range of 5 feet or more: +1,000 feet of range for each secondary caster, up to +1 mile.');
  opt('Distribute', 'A Concentration spell: you and every secondary caster share the Concentration; the spell lasts while any of you keeps it.');
  opt('Expand', 'An area spell: one dimension of the area grows 10 feet for each secondary caster. Each secondary caster expends a spell slot (not if the spell fails).');
  opt('Prolong', 'A spell lasting 1 minute or more: +1 hour with 1–3 secondary casters, +8 hours with 4–6, +24 hours with 7 or more. Each expends a spell slot (not if the spell fails).');
  opt('Safeguard', 'An area spell: leave a safe zone of joined 5-foot cubes — ' + (mod > 0 ? mod + ' plus ' : '') + 'one per secondary caster, at least one — that the spell doesn’t affect, moving with the area.');
  opt('Supplant', 'A spell that consumes a Material component with a cost: that cost drops 50 GP per secondary caster. Each expends a slot of the spell’s level or higher (not if the spell fails).');
}
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
// 2014: against what you can see; 2024: always, unless Incapacitated.
sktDefineEffect(['class:barbarian:Danger Sense'], ctx => {
  if (ctx.edition === '2014') ctx.saveMods.push({ abs: ['dex'], text: 'Advantage on Dexterity saves against effects you can see (not while blinded, deafened or incapacitated)', src: 'Danger Sense' });
  else ctx.rollAdv.push({ on: ['save:dex'], label: 'Danger Sense' });
});
sktDefineEffect(['class:barbarian:Feral Instinct'], ctx => ctx.rollAdv.push({ on: ['init'], label: 'Feral Instinct' }));
// An on/off state (char-effects.js): advantage on Strength attacks.
sktDefineEffect(['class:barbarian:Reckless Attack'], () => {});
sktDefineEffect(['class:barbarian:Primal Champion'], ctx => { ctx.abilityBonus.str += 4; ctx.abilityBonus.con += 4; ctx.abilityCapBonus.str = 24; ctx.abilityCapBonus.con = 24; });
sktDefineEffect(['2014:class:barbarian:Brutal Critical'], ctx => {
  const n = ctx.level >= 17 ? 3 : ctx.level >= 13 ? 2 : 1;
  ctx.critExtraDice = Math.max(ctx.critExtraDice || 0, n);
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
  const dc = 8 + ctx.pb + ctx.mod.wis;
  _fxAction(ctx, { name: 'Turn Undead', action: ctx.edition === '2024' ? 'Magic' : 'Action', resource: 'Channel Divinity', amount: 1, feature: 'Channel Divinity',
    desc: 'Undead within 30 feet make a DC ' + dc + ' Wisdom save or are turned for 1 minute.' });
  if (ctx.edition === '2024') _fxAction(ctx, { name: 'Divine Spark', action: 'Magic', resource: 'Channel Divinity', amount: 1, feature: 'Channel Divinity',
    desc: 'A creature within 30 feet regains, or takes (DC ' + dc + ' Constitution save for half), ' + (ctx.level >= 18 ? 4 : ctx.level >= 13 ? 3 : ctx.level >= 7 ? 2 : 1) + 'd8 + ' + ctx.mod.wis + ' radiant or necrotic.' });
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
  if (ctx.edition === '2024') _fxAction(ctx, { name: 'Divine Sense', action: 'Bonus Action', resource: 'Channel Divinity', amount: 1, feature: 'Channel Divinity',
    desc: 'For 10 minutes, sense the location of any Celestial, Fiend or Undead within 60 feet, and any place consecrated or desecrated there.' });
});
// A 2014 paladin's Channel Divinity comes with the oath: once per short rest.
sktDefineEffect(['2014:subclass:paladin:Channel Divinity'], ctx => { _fxPool(ctx, 'Channel Divinity', 1, 'short'); });

// ---- Ranger
sktDefineEffect(['2024:class:ranger:Favored Enemy'], ctx => {
  const n = _fxCol(ctx, 'Favored Enemy') || 2;
  _fxPool(ctx, 'Favored Enemy', typeof n === 'number' ? n : 2, 'long');
  _fxAction(ctx, { name: "Hunter's Mark (Favored Enemy)", action: 'Bonus Action', resource: 'Favored Enemy', amount: 1, feature: 'Favored Enemy',
    desc: "Cast Hunter's Mark without expending a spell slot. You always have it prepared." });
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
  // Points into a slot (5th level at most, from the sorcerer level that slot needs), and a slot into points.
  [[1, 2, 2], [2, 3, 3], [3, 5, 5], [4, 6, 7], [5, 7, 9]].forEach(([lv, cost, min]) => {
    if (ctx.level >= min) _fxAction(ctx, { name: 'Create Spell Slot (level ' + lv + ')', action: 'Bonus Action', resource: 'Sorcery Points', amount: cost, feature: 'Font of Magic',
      desc: 'Spend ' + cost + ' Sorcery Points for a level ' + lv + ' spell slot; it vanishes when you finish a long rest.' });
  });
  _fxAction(ctx, { name: 'Convert Spell Slot', action: ctx.edition === '2024' ? 'Free' : 'Bonus Action', feature: 'Font of Magic',
    desc: 'Expend a spell slot to gain Sorcery Points equal to its level.' });
});
sktDefineEffect(['2024:class:sorcerer:Innate Sorcery'], ctx => {
  _fxPool(ctx, 'Innate Sorcery', 2, 'long');
  _fxAction(ctx, { name: 'Innate Sorcery', action: 'Bonus Action', resource: 'Innate Sorcery', amount: 1, feature: 'Innate Sorcery',
                   desc: 'For 1 minute, +1 to your spell save DC and advantage on sorcerer spell attacks.' });
});

// ---- Warlock — pact magic is handled by sktBuildSpellcasting.

// ---- Wizard
sktDefineEffect(['class:wizard:Arcane Recovery'], ctx => {
  _fxPool(ctx, 'Arcane Recovery', 1, 'long');
  _fxAction(ctx, { name: 'Arcane Recovery', action: 'Short rest', resource: 'Arcane Recovery', amount: 1, feature: 'Arcane Recovery',
    desc: 'When you finish a Short Rest, regain spent spell slots with a combined level of up to half your wizard level (round up), none of 6th level or higher. Once per Long Rest.' });
});

// ---- Subclasses that change the numbers
// The Soulknife's Psychic Blades: a finesse, thrown blade of psychic energy
// (1d6) with the better of STR and DEX, and a second as a bonus action (1d4).
sktDefineEffect(['subclass:Psychic Blades'], ctx => { ctx.psychicBlades = true; });
sktDefineExtra(['subclass:warlock:Healing Light'], ctx => { _fxPool(ctx, 'Healing Light', 1 + (ctx.level || 1), 'long', { die: 'd6' }); });
sktDefineExtra(['subclass:wizard:Greater Portent'], () => {});   // Portent's third die
sktDefineExtra(['subclass:wizard:Portent'], ctx => { _fxPool(ctx, 'Portent', (ctx.level || 1) >= 14 ? 3 : 2, 'long', { die: 'd20' });
  _fxAction(ctx, { name: 'Portent', action: 'Special', resource: 'Portent', amount: 1, dice: '1d20', feature: 'Portent', auto: true,
    desc: 'After a long rest, roll the dice and record them; replace any D20 Test you can see (yours or another creature’s) with one of them, before the roll.' }); });
// The 2014 domains' Potent Spellcasting, and the Evoker's Empowered Evocation.
sktDefineExtra(['subclass:cleric:Potent Spellcasting'], ctx => { if (ctx.edition === '2014') ctx.cantripDamageBonus += ctx.mod.wis; });
sktDefineExtra(['subclass:wizard:Empowered Evocation'], ctx => { ctx.schoolDamage.V = (ctx.schoolDamage.V || 0) + ctx.mod.int; });
// The Rage state adds Divine Fury's damage while raging.
sktDefineExtra(['subclass:barbarian:Divine Fury'], () => {});
// The Battle Master's dice grow in Combat Superiority itself.
sktDefineExtra(['subclass:fighter:Improved Combat Superiority', 'subclass:fighter:Ultimate Combat Superiority'], () => {});
sktDefineExtra(['subclass:ranger:Dread Ambusher'], ctx => { ctx.initBonus += ctx.mod.wis; _fxNote(ctx, 'Dread Ambusher: Initiative + WIS.'); });
sktDefineExtra(['subclass:ranger:Umbral Sight'], ctx => { _fxDarkvision60(ctx); });
sktDefineExtra(['subclass:monk:Darkvision'], ctx => { _fxDarkvision60(ctx); });
sktDefineExtra(['subclass:paladin:Aura of Devotion'], ctx => { ctx.immune.add('charmed'); });
sktDefineExtra(['subclass:rogue:Second-Story Work'], ctx => { ctx.moveExtra.climb = 'walk'; });
sktDefineExtra(['subclass:druid:Aquatic Affinity'], ctx => { ctx.moveExtra.swim = 'walk'; });
// The 2024 Thief attunes to four magic items (and a 2014 Thief ignores class requirements).
sktDefineExtra(['2024:subclass:rogue:Use Magic Device', 'subclass:rogue:Use Magic Device'], ctx => { if (ctx.edition === '2024') ctx.attuneMax = Math.max(ctx.attuneMax || 3, 4); });
// A subclass's own Extra Attack (Valor and Swords bards, the Bladesinger, the
// Battle Smith and Armorer).
sktDefineExtra(['subclass:Extra Attack'], ctx => { ctx.attacksPerAction = Math.max(ctx.attacksPerAction, 2); });
// The College of Dance's Dazzling Footwork, without armour or a shield.
sktDefineExtra(['subclass:bard:Unarmored Defense'], ctx => {
  ctx.acOptions.push({ label: 'Unarmored Defense', value: 10 + ctx.mod.dex + ctx.mod.cha, noArmor: true, shieldOk: false });
});
sktDefineExtra(['subclass:bard:Bardic Damage'], ctx => {
  const L = ctx.level || 1;
  ctx.bardicUnarmed = L >= 15 ? 'd12' : L >= 10 ? 'd10' : L >= 5 ? 'd8' : 'd6';
});
// Choices a subclass asks for.
sktDefineChoice(['subclass:barbarian:Aspect of the Wilds'], {
  label: 'Aspect of the Wilds',
  options: [{ value: 'Owl', label: 'Owl', desc: 'Darkvision 60 ft (or 60 ft more).' },
            { value: 'Panther', label: 'Panther', desc: 'A climb speed equal to your speed.' },
            { value: 'Salmon', label: 'Salmon', desc: 'A swim speed equal to your speed.' }],
  apply(ctx, v){ if (v === 'Owl') _fxDarkvision60(ctx); if (v === 'Panther') ctx.moveExtra.climb = 'walk'; if (v === 'Salmon') ctx.moveExtra.swim = 'walk'; },
});
sktDefineChoice(['subclass:warlock:Fiendish Resilience'], {
  label: 'Fiendish Resilience',
  options: ['acid', 'bludgeoning', 'cold', 'fire', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder']
    .map(t => ({ value: t, label: t[0].toUpperCase() + t.slice(1), desc: 'Resistance to ' + t + ' damage until you choose again after a rest.' })),
  apply(ctx, v){ ctx.resist.add(v); },
});
sktDefineEffect(['subclass:Draconic Resilience'], ctx => {
  ctx.hpPerLevel += 1;
  const v = ctx.edition === '2024' ? 10 + ctx.mod.dex + ctx.mod.cha : 13 + ctx.mod.dex;
  ctx.acOptions.push({ label: 'Draconic Resilience', value: v, noArmor: true, shieldOk: true });
});
sktDefineEffect(['subclass:Remarkable Athlete'], ctx => {
  if (ctx.edition === '2014') ctx.remarkableAthlete = true;
  else {
    ctx.rollAdv.push({ on: ['init', 'skill:athletics'], label: 'Remarkable Athlete' });
    _fxNote(ctx, 'Remarkable Athlete: right after you score a critical hit, you can move up to half your Speed without provoking opportunity attacks.');
  }
});
sktDefineEffect(['subclass:Improved Critical'], ctx => { ctx.critRange = Math.min(ctx.critRange, 19); });
sktDefineEffect(['subclass:Superior Critical'], ctx => { ctx.critRange = Math.min(ctx.critRange, 18); });
sktDefineEffect(['subclass:Combat Superiority'], ctx => {
  const n = ctx.level >= 15 ? 6 : ctx.level >= 7 ? 5 : 4;
  const die = ctx.level >= 18 ? 'd12' : ctx.level >= 10 ? 'd10' : 'd8';
  _fxPool(ctx, 'Superiority Dice', n, 'short', { die });
});
sktDefineEffect(['subclass:Disciple of Life'], ctx => _fxNote(ctx, 'Healing spells of 1st level or higher restore an extra 2 + the spell’s level hit points.'));
sktDefineEffect(['2014:subclass:Bonus Proficiency', '2014:subclass:Bonus Proficiencies'], () => {});   // read from the text: sktProfGrants

// ---- Species traits
sktDefineEffect(['species:Dwarven Toughness'], ctx => { ctx.hpPerLevel += 1; });
sktDefineEffect(['species:Lucky'], ctx => _fxNote(ctx, 'Lucky: reroll a 1 on a d20 test and use the new roll.'));
sktDefineEffect(['species:Keen Senses'], ctx => { if (ctx.edition === '2014') ctx.skillProf.add('perception'); });
sktDefineEffect(['species:Menacing'], ctx => { ctx.skillProf.add('intimidation'); });
sktDefineEffect(['species:Relentless Endurance'], ctx => { _fxPool(ctx, 'Relentless Endurance', 1, 'long'); });
sktDefineEffect(['species:Breath Weapon'], ctx => {
  const n = ctx.edition === '2024' ? ctx.pb : 1;
  _fxPool(ctx, 'Breath Weapon', n, ctx.edition === '2024' ? 'long' : 'short');
  const sp = sktRulesSpecies(ctx.R, ctx.build.species), pick = sktSpeciesResist(sp, sktSpeciesSub(sp, ctx.build), ctx.build);
  if (pick) _fxNote(ctx, 'Breath Weapon: ' + pick.damage + ' damage' + (sp.ancestries.length ? ' (' + pick.name + ' ancestry)' : '') + '.');
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
sktDefineEffect(['feat:Blind Fighting', 'optional:Blind Fighting'], ctx => { ctx.senses.blindsight = Math.max(ctx.senses.blindsight || 0, 10); });
sktDefineEffect(['feat:Interception', 'optional:Interception'], ctx => _fxAction(ctx, { name: 'Interception', action: 'Reaction', feature: 'Interception', dice: '1d10' + sktSigned(ctx.pb),
  desc: 'When a creature you can see hits another creature within 5 ft of you, reduce the damage by 1d10' + sktSigned(ctx.pb) + ' (needs a shield or a simple or martial weapon).' }));
sktDefineEffect(['feat:Protection', 'optional:Protection'], ctx => _fxAction(ctx, { name: 'Protection', action: 'Reaction', feature: 'Protection',
  desc: 'With a shield, when a creature you can see attacks a target within 5 ft of you, impose disadvantage' + (ctx.edition === '2024' ? ' on that attack and on attacks against the target until your next turn.' : ' on the attack.') }));
sktDefineEffect(['feat:Thrown Weapon Fighting', 'optional:Thrown Weapon Fighting'], ctx => _fxNote(ctx, 'Thrown Weapon Fighting: draw a thrown weapon as part of the attack, and +2 damage when you throw it.'));
sktDefineEffect(['feat:Unarmed Fighting', 'optional:Unarmed Fighting'], ctx => { ctx.unarmedFighting = true;
  _fxNote(ctx, 'Unarmed Fighting: unarmed strikes deal 1d6 (1d8 with no weapon or shield in hand); a creature you grapple takes 1d4 bludgeoning at the start of your turn.'); });
sktDefineEffect(['feat:Blessed Warrior', 'optional:Blessed Warrior', 'feat:Druidic Warrior', 'optional:Druidic Warrior'], () => {});   // two cantrips, from the data
sktDefineEffect(['optional:Superior Technique'], ctx => {
  if (!ctx.resources.some(r => r.name === 'Superiority Dice')) _fxPool(ctx, 'Superiority Dice', 1, 'short', { die: 'd6' });
  _fxNote(ctx, 'Superior Technique: one maneuver, fuelled by a d6 superiority die (back on a short rest).');
});
sktDefineEffect(['feat:Great Weapon Fighting', 'optional:Great Weapon Fighting'], ctx => (ctx.gwf = true) && _fxNote(ctx, 'Great Weapon Fighting: with a two-handed or versatile weapon held in two hands, treat 1s and 2s on damage dice as 3s (2024) or reroll them (2014).'));
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
  const sr = sp && sktSpeciesSub(sp, ctx.build);
  ctx.senses.darkvision = Math.max(ctx.senses.darkvision || 0, (sr && sr.darkvision) || (sp && sp.darkvision) || 60);
});
sktDefineEffect(['species:Variable Trait; Darkvision'], ctx => { ctx.senses.darkvision = Math.max(ctx.senses.darkvision || 0, 60); });
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
  const subrace = species && sktSpeciesSub(species, build);
  const bg = sktBuildBackground(R, build);
  const abilities = sktBuildAbilities(build, R);

  const ctx = {
    build, R, edition: R.edition, cls, sub, level: L, pb, abilities,
    mod: {}, acOptions: [], armoredAcBonus: 0, acUnlessHeavy: 0, mediumDexCap: 2,
    hpPerLevel: 0, hpFlat: 0, unarmedMinDie: null, naturalAttacks: [], speedBonus: 0, speedBonusUnlessHeavy: 0, speedBonusUnarmored: 0,
    initBonus: 0, saveBonusAll: _sktItemSum(build, 'bonusSavingThrow'), passiveBonus: { perception: 0, investigation: 0, insight: 0 },
    saveProf: new Set((cls && cls.saves) || []), skillProf: new Set(), expertise: new Set(build.expertise || []),
    armorProf: new Set(), weaponProf: new Set(), weaponPropRules: [], toolProf: new Set(), languages: new Set(),
    resources: [], actions: [], notes: [], attacksPerAction: 1, critRange: 20,
    rangedAttackBonus: 0, duelingBonus: 0, twoWeaponMod: false,
    abilityBonus: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, abilityCapBonus: {},
    jackOfAllTrades: false, remarkableAthlete: false, martialArts: false, martialArtsDie: null,
    sneakAttack: null, rageDamage: 0, agonizingBlast: false, resist: new Set(),
    senses: { darkvision: 0 }, skillBonus: {}, immune: new Set(), cantripDamageBonus: 0,
    // What an on/off state changes (SKT_STATES).
    acBonus: [], acFloor: null, speedMult: 1, spellDcBonus: 0, spellAtkBonus: 0, weaponHit: 0, rageOn: 0, damageBonusAll: 0,
    shillelagh: null, rollAdv: [], rollDice: [], extraDamage: [], concBonus: 0, saveMods: [],
    // Other ways of moving a feature gives: 'walk' (equal to the speed) or feet.
    moveExtra: {}, moveUnlessHeavy: {}, bardicUnarmed: null, applied: new Set(), schoolDamage: {},
  };
  SKT_ABS.forEach(k => { ctx.mod[k] = sktMod(abilities[k]); });
  _sktActiveItems(build).forEach(m => (m.resist || []).forEach(r => { if (typeof r === 'string') ctx.resist.add(r); }));

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
  // Another class brings only its multiclassing proficiencies, and a skill
  // where it gives one.
  const parts = sktClassLevels(build, R);
  parts.slice(1).forEach(p => {
    const c2 = sktRulesClass(R, p.cls);
    const g = (c2 && c2.multiclassing && c2.multiclassing.proficienciesGained) || {};
    (g.armor || []).forEach(a => ctx.armorProf.add(typeof a === 'string' ? sktRulesInline(a).toLowerCase() : 'shield'));
    (g.weapons || []).forEach(w => {
      if (typeof w !== 'string') return;
      const tag = /^\{@item ([^|}]+)/i.exec(w);
      ctx.weaponProf.add(tag ? tag[1].toLowerCase().trim() : sktRulesInline(w).toLowerCase().replace(/ weapons?$/, '').trim());
    });
    (g.tools || []).forEach(t => { if (typeof t === 'string') ctx.toolProf.add(sktRulesInline(t).toLowerCase()); });
    ((p.entry && p.entry.skills) || []).forEach(k => ctx.skillProf.add(k));
  });
  (build.skills || []).forEach(k => ctx.skillProf.add(k));
  (build.speciesSkills || []).forEach(k => ctx.skillProf.add(k));
  (build.bgSkills || []).forEach(k => ctx.skillProf.add(k));
  [species, subrace].forEach(s => {
    if (!s) return;
    const ov = s === species && subrace && subrace.overrides || [];
    (s.skills || []).forEach(o => Object.keys(o).forEach(k => { const sk = sktSkillKey(k); if (sk && o[k] === true) ctx.skillProf.add(sk); }));
    (s.weapons || []).forEach(o => Object.keys(o).forEach(k => { if (o[k] === true) ctx.weaponProf.add(sktRefName(k)); }));
    (s.armor || []).forEach(o => Object.keys(o).forEach(k => { if (o[k] === true) ctx.armorProf.add(k); }));
    (ov.includes('resist') ? [] : s.resist || []).forEach(r => { if (typeof r === 'string') ctx.resist.add(r); });
    if (s === species){ const pick = sktSpeciesResist(species, subrace, build); if (pick) pick.resist.forEach(r => ctx.resist.add(String(r).toLowerCase())); }
    (s.languages || []).forEach(o => Object.keys(o).forEach(k => { if (o[k] === true) ctx.languages.add(_sktTitle(k)); }));
  });
  if (bg){
    (bg.skills || []).forEach(o => Object.keys(o).forEach(k => { const sk = sktSkillKey(k); if (sk && o[k] === true) ctx.skillProf.add(sk); }));
    (bg.tools || []).forEach(o => Object.keys(o).forEach(k => { if (o[k] === true) ctx.toolProf.add(sktRefName(k)); }));
    // Fixed languages (Rune Carver's Giant). Several entries are
    // alternatives (Clan Crafter: Dwarvish, or another language): the first.
    (bg.languages || []).slice(0, 1).forEach(o => Object.keys(o).forEach(k => { if (o[k] === true) ctx.languages.add(_sktTitle(k)); }));
  }
  (build.languages || []).forEach(l => ctx.languages.add(l));
  (build.tools || []).forEach(t => ctx.toolProf.add(t));
  // A subclass's proficiencies (Hexblade's armour, a Lore bard's skills…).
  if (cls) sktSubclassProfFeatures(build, R).forEach(({ g }) => {
    g.armor.forEach(a => ctx.armorProf.add(a));
    g.weapons.forEach(w => w[0] === '@' ? _sktWeaponGroup(R, w).forEach(n => ctx.weaponProf.add(n)) : ctx.weaponProf.add(w));
    g.skills.forEach(k => ctx.skillProf.add(k));
    g.saves.forEach(k => ctx.saveProf.add(k));
    g.tools.forEach(t => ctx.toolProf.add(t));
    g.languages.forEach(l => ctx.languages.add(l));
  });
  if (cls) sktProfChoices(build, R).forEach(c => { if (c.kind === 'skills' || c.kind === 'weapons') c.picked.forEach(x => (c.kind === 'skills' ? ctx.skillProf : ctx.weaponProf).add(x)); });
  sktToolFixed(build, R).forEach(t => ctx.toolProf.add(t.toLowerCase()));
  Object.values(build.toolPicks || {}).forEach(l => (l || []).forEach(t => ctx.toolProf.add(String(t).toLowerCase())));
  if (R.edition === '2024') ctx.languages.add('Common');
  const feats = sktBuildFeatNames(build, R);
  feats.forEach(n => {
    const f = sktRulesFeat(R, n), ch = build.featChoices[n] || {};
    if (!f) return;
    (ch.skills || []).forEach(k => ctx.skillProf.add(k));
    (ch.expertise || []).forEach(k => ctx.expertise.add(k));
    if (ch.save) ctx.saveProf.add(ch.save);
    (ch.tools || []).forEach(t => ctx.toolProf.add(String(t).toLowerCase()));
    (ch.languages || []).forEach(l => ctx.languages.add(l));
    (ch.weapons || []).forEach(w => ctx.weaponProf.add(String(w).toLowerCase()));
    const fx = sktFeatChoices(R, build, n).fixed;
    fx.skills.forEach(k => ctx.skillProf.add(k)); fx.expertise.forEach(k => ctx.expertise.add(k));
    fx.tools.forEach(t => ctx.toolProf.add(t.toLowerCase())); fx.languages.forEach(l => ctx.languages.add(l));
    fx.weapons.forEach(w => ctx.weaponProf.add(w)); fx.armor.forEach(a => ctx.armorProf.add(a));
    (f.resist || []).forEach(r => { if (typeof r === 'string') ctx.resist.add(r); });
  });

  // Feature effects, in level order.
  const features = sktBuildFeatures(build, R);
  // A class's features see that class's level (three rages for a 3rd-level
  // barbarian, whatever else the character is).
  const partOf = {};
  parts.forEach(p => { const c = sktRulesClass(R, p.cls); if (c) partOf[c.key] = { level: p.level, cls: c, sub: sktRulesSubclass(c, p.subclass) }; });
  ctx.classLevel = key => (parts.find(p => p.key === key) || {}).level || 0;
  features.forEach(f => {
    if (f.info) return;
    const p = f.cls && partOf[f.cls];
    const was = [ctx.level, ctx.cls, ctx.sub];
    if (p){ ctx.level = p.level; ctx.cls = p.cls; ctx.sub = p.sub; }
    try {
      const key = p ? p.cls.key : (cls && cls.key);
      const fx = sktFeatureEffect(f.name, f.from, R.edition, key);
      if (fx){ try { fx(ctx); } catch(e){ ctx.notes.push('Could not apply ' + f.name + ': ' + e.message); } }
      const ch = sktFeatureChoice(f.name, f.from, R.edition, key) || f.optionSpec;
      // Species traits and feats too, except a once-a-day spell, which the
      // sheet already casts for free.
      const read = /^(class|subclass|optional|feat|species)$/.test(f.from);
      ctx.from = f.from;
      if (!fx && !ch && !f.info && read){
        const g = sktPassiveGrants(f.text);
        g.resist.forEach(r => ctx.resist.add(r)); g.immune.forEach(r => ctx.immune.add(r));
        if (g.darkvision) ctx.senses.darkvision = Math.max(ctx.senses.darkvision || 0, g.darkvision);
        if (g.speed) ctx.speedBonus += g.speed;
        g.conditions.forEach(c => ctx.immune.add(c));
        Object.keys(g.moves).forEach(k => { ctx.moveExtra[k] = g.moves[k]; });
        if (g.any) ctx.applied.add(f.name);
      }
      if (!fx && !ch && !f.info && /^(class|subclass|species|feat|optional)$/.test(f.from) && !/^Channel Divinity:/.test(f.name)
          && !((f.from === 'species' || f.from === 'feat') && /\bcast\b/i.test(f.text || ''))){
        const u = sktUsesFromText(f.text, ctx, f.name);
        if (u){ _fxPool(ctx, f.name, u.max, u.recharge, { auto: true }); ctx.applied.add(f.name); }
      }
      if (!fx && (f.from === 'class' || f.from === 'subclass') && f.name !== 'Channel Divinity'
          && (/^Channel Divinity:/.test(f.name) || /(?:using|use|expend (?:a|one) use of) (?:your )?Channel Divinity|as a Channel Divinity option/i.test(f.text || ''))){
        const t = String(f.text || '').replace(/\s+/g, ' ');
        const action = /\breaction\b/i.test(t) ? 'Reaction' : /bonus action/i.test(t) ? 'Bonus Action' : /magic action/i.test(t) ? 'Magic' : /\b(as an action|use your action|take an action|an action to)\b/i.test(t) ? 'Action' : 'Free';
        const first = (t.split(/(?<=\.)\s+/).find(s => /action|reaction|channel divinity/i.test(s) && !/^(Starting|At|When you)\b.*level/i.test(s)) || t).slice(0, 220);
        _fxAction(ctx, { name: f.name.replace(/^Channel Divinity:\s*/, ''), action, resource: 'Channel Divinity', amount: 1, feature: f.name, desc: first });
      }
      // Advantage on saves a trait or feat gives (Dwarven Resilience…).
      if ((f.from === 'species' || f.from === 'feat' || f.from === 'class' || f.from === 'subclass')
          && !SKT_STATES.some(s => s.key === f.name)) sktSaveAdvantages(f.text).forEach(a => _sktSaveAdv(ctx, a, f.name));
      const v = ch && (build.featureChoices || {})[f.name];
      if (ch && v && ch.apply){ try { ch.apply(ctx, v); } catch(e){ ctx.notes.push('Could not apply ' + f.name + ': ' + e.message); } }
      const xf = !f.info && sktFeatureExtra(f.name, f.from, key);
      if (xf){ try { xf(ctx); } catch(e){ ctx.notes.push('Could not apply ' + f.name + ': ' + e.message); } }
      // An ability used in play, read from its text (beside whatever else it does).
      if (!fx && !f.info && read && !ctx.actions.some(a => a.name === f.name || a.feature === f.name)){
        const a = sktActivationFromText(f.text, f.name, ctx);
        if (a) _fxAction(ctx, Object.assign(a, { feature: f.name, auto: true }));
      }
      // And what it adds without being used: damage on a hit, initiative, advantage on checks.
      if (!fx && !f.info && read && sktPassiveFromText(f.text, f.name, ctx)) ctx.applied.add(f.name);
    } finally { [ctx.level, ctx.cls, ctx.sub] = was; }
  });
  // Primal Champion and the like raise a score after everything else.
  SKT_ABS.forEach(k => {
    if (!ctx.abilityBonus[k]) return;
    abilities[k] = Math.min(ctx.abilityCapBonus[k] || 20, abilities[k] + ctx.abilityBonus[k]);
    ctx.mod[k] = sktMod(abilities[k]);
  });

  // The spells on the sheet.
  const spellNames = [...(build.cantrips || []), ...(build.spells || [])];
  (build.customSpells || []).forEach(s => { if (s && s.name && !spellNames.includes(s.name)) spellNames.push(s.name); });
  { const ms = sktMagicalSecrets(build, R); if (ms) ms.picked.forEach(n => { if (!spellNames.includes(n)) spellNames.push(n); }); }
  const arcanum = {};
  sktArcanumLevels(build, R).forEach(lv => { const n = (build.arcanum || {})[lv]; if (n){ arcanum[lv] = n; if (!spellNames.includes(n)) spellNames.push(n); } });
  parts.slice(1).forEach(p => [].concat((p.entry || {}).cantrips || [], (p.entry || {}).spells || []).forEach(s => { if (!spellNames.includes(s)) spellNames.push(s); }));
  const always = sktBuildAlwaysPrepared(build, R);
  sktFeatureSpellPicks(build, R).filter(x => x.feature === 'Signature Spells').forEach(x => x.picked.forEach(n => { if (!always.includes(n)) always.push(n); }));
  always.forEach(s => { if (!spellNames.includes(s)) spellNames.push(s); });
  // Spells from feats and the species, with how each is cast.
  const spGrant = sktSpeciesSpellGrant(R, build);
  if (spGrant && spGrant.spells.length){
    spGrant.spells.forEach(s => { if (!spellNames.includes(s)) spellNames.push(s); });
    const ab = spGrant.ability ? ' (' + (SKT_AB_NAME[spGrant.ability] || spGrant.ability) + ')' : '';
    _fxNote(ctx, spGrant.label + ab + ': ' + spGrant.spells.join(', ')
      + (spGrant.daily.length ? ' — ' + spGrant.daily.join(', ') + ' once per long rest without a spell slot' : ''));
  }
  const featSpells = sktFeatSpells(build, R).filter(g => g.spells.length);
  // A wizard subclass's chosen spells (2024 Savant) are written in the spellbook, not prepared.
  const toBook = [];
  featSpells.forEach(g => {
    g.spells.forEach(s => { if (g.cls === 'wizard' && ((sktRulesSpell(R, s) || {}).level || 0) > 0){ toBook.push(s); return; } if (!spellNames.includes(s)) spellNames.push(s); });
    const ab = g.ability ? ' (' + (SKT_AB_NAME[g.ability] || g.ability) + ')' : '';
    _fxNote(ctx, g.feat + ab + ': ' + g.spells.join(', ')
      + (g.daily.length ? ' — ' + g.daily.join(', ') + ' once per long rest without a spell slot' : ''));
  });
  // The states that are on (Rage, Bladesong, Shield, Bless…) change the
  // numbers below.
  ctx.knows = new Set(spellNames);
  ctx.featureNames = new Set(features.filter(f => !f.info).map(f => f.name));
  const states = _sktStates(ctx, prior);
  states.forEach(x => { if (x.on && x.s.apply){ try { x.s.apply(ctx, x.value); } catch(e){ ctx.notes.push('Could not apply ' + x.s.label + ': ' + e.message); } } });

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
  // The first class's dice (the full die at 1st level); each other class's
  // average from its first level on.
  parts.slice(1).forEach(p => {
    const h2 = (sktRulesClass(R, p.cls) || {}).hd || 8;
    for (let i = 0; i < p.level; i++) hpMax += Math.max(1, Math.floor(h2 / 2) + 1 + ctx.mod.con) + ctx.hpPerLevel;
  });
  for (let lv = 1; lv <= parts[0].level; lv++){
    const roll = lv === 1 ? hd
      : (build.hp && build.hp.method === 'rolled' && build.hp.rolls && build.hp.rolls[lv])
        ? Math.max(1, Math.min(hd, +build.hp.rolls[lv])) : Math.floor(hd / 2) + 1;
    hpMax += Math.max(1, roll + ctx.mod.con) + ctx.hpPerLevel;
  }
  // The working, for the sheet: the first level, the rest, extras per level.
  const conS = (ctx.mod.con >= 0 ? '+' : '') + ctx.mod.con;
  const hpBits = ['level 1: ' + hd + ' ' + conS + ' CON'];
  if (parts[0].level > 1) hpBits.push((cls ? cls.name : 'Class') + ' levels 2–' + parts[0].level + ': ' + (build.hp && build.hp.method === 'rolled' ? 'rolled' : (parts[0].level - 1) + ' × ' + (Math.floor(hd / 2) + 1)) + ' ' + conS + ' each');
  parts.slice(1).forEach(p => { const h2 = (sktRulesClass(R, p.cls) || {}).hd || 8; hpBits.push(_sktTitle(p.cls) + ' ' + p.level + ' × ' + (Math.floor(h2 / 2) + 1) + ' ' + conS); });
  if (ctx.hpPerLevel) hpBits.push('+' + ctx.hpPerLevel + ' a level (' + L + ')');
  // A flat bonus (Boon of Fortitude's 40).
  if (ctx.hpFlat){ hpMax += ctx.hpFlat; hpBits.push('+' + ctx.hpFlat); }
  let hpDetail = hpBits.join(' · ') + ' = ' + hpMax;
  // The table's own number (D&D Beyond's "Manual" hit points).
  if (build.hp && build.hp.method === 'manual' && +build.hp.manual > 0){ hpMax = Math.floor(+build.hp.manual); hpDetail = 'Entered by hand: ' + hpMax; }

  // Equipment → armour, shield and weapons.
  const gear = sktBuildEquipment(build, R);
  const armor = gear.armor, shield = gear.shield;
  let acArmor;
  if (armor){
    const t = String(armor.type || '').split('|')[0];
    const dex = t === 'HA' ? 0 : t === 'MA' ? Math.min(ctx.mediumDexCap, ctx.mod.dex) : ctx.mod.dex;
    acArmor = { label: armor._name || armor.name, value: (+armor.ac || 10) + (armor._ac || 0) + dex + ctx.armoredAcBonus };
  }
  const candidates = [];
  if (acArmor) candidates.push({ ...acArmor, shieldOk: true });
  else {
    candidates.push({ label: 'Unarmored', value: 10 + ctx.mod.dex, shieldOk: true });
    ctx.acOptions.forEach(o => { if (!o.noArmor || !armor) candidates.push(o); });
  }
  const notHeavy = !(armor && String(armor.type || '').split('|')[0] === 'HA');
  const best = candidates.map(c => ({ ...c, total: c.value + (shield && c.shieldOk !== false ? (+shield.ac || 2) + (shield._ac || 0) : 0) + (notHeavy ? ctx.acUnlessHeavy : 0) }))
    .sort((a, b) => b.total - a.total)[0];
  // A Ring or Cloak of Protection adds to whatever is worn; Bracers of
  // Defense only without armour or a shield.
  const acItems = _sktActiveItems(build).filter(m => m.bonusAc && !m.stats && !m.base
    && !(m.unarmoredOnly && armor) && !(m.noShield && shield));
  // "Chain Mail 16 + Shield 2 + Cloak of Protection 1 = 19".
  const acParts = [];
  if (best){
    if (acArmor && best.label === acArmor.label){
      const t = String(armor.type || '').split('|')[0];
      acParts.push((armor._name || _sktTitle(armor.name)) + ' ' + ((+armor.ac || 10) + (armor._ac || 0)));
      const dexPart = t === 'HA' ? 0 : t === 'MA' ? Math.min(ctx.mediumDexCap, ctx.mod.dex) : ctx.mod.dex;
      if (dexPart) acParts.push('DEX ' + dexPart);
      if (ctx.armoredAcBonus) acParts.push('Defense ' + ctx.armoredAcBonus);
    } else acParts.push(best.label + ' ' + best.value);
    if (ctx.acUnlessHeavy && notHeavy) acParts.push('Carapace ' + ctx.acUnlessHeavy);
    if (shield && best.shieldOk !== false) acParts.push((shield._name || 'Shield') + ' ' + ((+shield.ac || 2) + (shield._ac || 0)));
    acItems.forEach(m => acParts.push(m.name + ' ' + m.bonusAc));
  }
  if (best) acItems.forEach(m => { best.total += m.bonusAc; best.label += ' + ' + m.name; });
  let ac = best ? best.total : 10;
  if (ctx.acFloor && ac < ctx.acFloor.value){ ac = ctx.acFloor.value; acParts.length = 0; acParts.push(ctx.acFloor.label + ' ' + ctx.acFloor.value); }
  ctx.acBonus.forEach(x => { ac += x.value; acParts.push(x.label + ' ' + x.value); });

  // Speed.
  const baseSpeed = typeof (subrace && subrace.speed) === 'number' ? subrace.speed
    : typeof (species && species.speed) === 'number' ? species.speed
    : (species && species.speed && species.speed.walk) || 30;
  const heavy = armor && String(armor.type).split('|')[0] === 'HA';
  let speed = baseSpeed + ctx.speedBonus + (heavy ? 0 : ctx.speedBonusUnlessHeavy) + (!armor && !shield ? ctx.speedBonusUnarmored : 0);
  const notSlowed = /speed is not reduced by wearing heavy armou?r/i.test(JSON.stringify([species && species.entries, subrace && subrace.entries]));
  if (heavy && armor.strength && abilities.str < +armor.strength && !notSlowed) speed -= 10;
  speed *= ctx.speedMult;

  // Initiative and passive perception.
  let init = ctx.mod.dex + ctx.initBonus;
  if (R.edition === '2014' && ctx.jackOfAllTrades) init += Math.floor(pb / 2);
  if (R.edition === '2014' && ctx.remarkableAthlete) init += Math.ceil(pb / 2);
  let passive = 10 + skills.perception + ctx.passiveBonus.perception;

  // Spellcasting.
  const sc = sktBuildSpellcasting(build, R, abilities);
  if (sc){
    // Items, and the sheet's custom bonuses.
    const ba = _sktItemSum(build, 'bonusSpellAttack') + (+(build.overrides || {}).spellAttack || 0) + ctx.spellAtkBonus;
    const bd = _sktItemSum(build, 'bonusSpellSaveDc') + (+(build.overrides || {}).spellDc || 0) + ctx.spellDcBonus;
    sc.attack += ba; sc.dc += bd;
    (sc.cantripLists || []).forEach(l => { l.attack += ba; l.dc += bd; });
  }
  const spellSlots = {};
  if (sc) Object.keys(sc.slots).forEach(l => {
    const was = prior.sheet && prior.sheet.spellSlots && prior.sheet.spellSlots[l];
    spellSlots[l] = { total: sc.slots[l], expended: was ? Math.min(was.expended || 0, sc.slots[l]) : 0 };
  });
  if (sc && sc.pact && spellSlots[sc.pact.level] && spellSlots[sc.pact.level].total === sc.pact.count) spellSlots[sc.pact.level].pact = true;
  else if (sc && sc.pact) _fxNote(ctx, 'Pact Magic: ' + sc.pact.count + ' of the level ' + sc.pact.level + ' slots come back on a short rest.');
  // Heroes of Faerûn's Circle Magic: any 2024 caster can lead a Circle spell.
  if (sc && R.edition === '2024' && Object.keys(sc.slots || {}).length && sktBookOk(build, { source: 'FRHoF', core: false })) _sktCircleSpells(ctx, sc);
  if (sc && sc.classes) sc.classes.slice(1).forEach(x => _fxNote(ctx, _sktTitle(x.cls) + ' spells: ' + (SKT_AB_NAME[x.sc.ability] || x.sc.ability) + ', save DC ' + x.sc.dc + ', attack ' + sktSigned(x.sc.attack) + '.'));

  // Attacks: weapons carried, an unarmed strike, and attack cantrips.
  const attacks = sktBuildAttacks(ctx, gear, sc);

  // A wizard's spellbook; a book made before there was one starts as the
  // spells already chosen.
  const wizPart = sc && sc.classes ? sc.classes.find(x => x.key === 'wizard') : null;
  const bookOf = o => (o.spellbook && o.spellbook.length) ? o.spellbook.slice() : (o.spells || []).slice();
  const spellbook = wizPart ? bookOf(wizPart.primary ? build : (wizPart.entry || {}))
    : (sc && sc.spellbook) ? bookOf(build) : null;
  if (spellbook) toBook.forEach(s => { if (!spellbook.includes(s)) spellbook.push(s); });

  // Resources keep what has been SPENT across a recompute: levelling up
  // mid-adventure does not hand back a used Rage, and a full pool that grows
  // stays full (Lay on Hands 15/15 becomes 20/20, not 15/20).
  // A charged magic item in use (carried, and attuned if it needs it) counts its charges.
  _sktActiveItems(build).filter(m => +m.charges > 0).forEach(m => { if (!ctx.resources.some(x => x.name === m.name))
    ctx.resources.push({ name: m.name, type: 'pool', current: +m.charges, max: +m.charges, recharge: m.recharge === 'dawn' ? 'dawn' : 'long', item: true,
                         note: m.rechargeAmount ? 'Regains ' + m.rechargeAmount + (m.recharge === 'dawn' ? ' at dawn' : '') : '' }); });
  (build.customResources || []).forEach(r => { if (r && r.name && !ctx.resources.some(x => x.name === r.name))
    ctx.resources.push({ name: r.name, type: 'pool', current: +r.max || 1, max: +r.max || 1, recharge: r.recharge || 'long', custom: true }); });
  (build.customActions || []).forEach(a => { if (a && a.name) _fxAction(ctx, { name: a.name, action: a.action || 'Action', desc: a.desc || '', resource: a.resource || undefined, amount: a.resource ? 1 : undefined, custom: true }); });
  const resources = ctx.resources.map(r => {
    const was = (prior.resources || []).find(x => x.name === r.name);
    if (!was || r.type !== 'pool') return r;
    const spent = Math.max(0, (+was.max || 0) - (+was.current || 0));
    return { ...r, current: Math.max(0, r.max - spent) };
  });

  // Applied also when it became an action on the Actions tab, or a reminder on a
  // save; and wherever the same feature is listed again (Blessed Strikes under
  // each domain).
  const appliedName = new Set(features.filter(f => f.mech).map(f => f.name));
  const pools = [];
  parts.forEach(p => { const c = sktRulesClass(R, p.cls), s = c && sktRulesSubclass(c, p.subclass);
    [c, s].forEach(src => [...(src && src.optionalfeatureProgression || []), ...(src && src.featProgression || [])].forEach(g => {
      const lv = Array.isArray(g.progression) ? g.progression.map((n, i) => n > (g.progression[i - 1] || 0) ? i + 1 : 0).filter(Boolean) : Object.keys(g.progression || {}).map(Number);
      pools.push({ name: g.name, levels: new Set(lv), from: src === s ? 'subclass' : 'class' });
    })); });
  const picked = n => ((build.optional || {})[n] || []).length > 0;
  // A subclass feature that gives spells ("Gloom Stalker Magic", "Animal
  // Speaker") is applied when the spells it names are the character's.
  const words = t => ' ' + String(t || '').toLowerCase().replace(/[^a-z']+/g, ' ') + ' ';
  const grants = sktFeatSpells(build, R), spGr = sktSpeciesSpellGrant(R, build);
  const granted = sktBuildAlwaysPrepared(build, R).concat(...grants.map(g => g.spells), (spGr && spGr.spells) || []).map(n => words(n));
  const grantedBy = new Set(grants.filter(g => g.spells.length && !g.missing).map(g => g.feat));
  // Or one at the level of a spell choice that's been made (Bonus Cantrip).
  const pickedAt = new Set([].concat(...sktSubclassSpellGrants(build, R).map(g => g.choices.filter(c => c.picked.length).map(c => Math.max(c.minLevel || 1, (cls && cls.subclassLevel) || 1)))));
  const givesSpell = f => ((f.from === 'feat' || f.from === 'optional') && grantedBy.has(f.name))
    || (/^(subclass|feat|optional|species)$/.test(f.from) && /\b(learn|know|cast|gain)\b/i.test(f.text || '') && granted.some(n => words(f.text).includes(n)))
    || (f.from === 'subclass' && /\b(cantrips?|spells?)\b/i.test(f.text || '') && pickedAt.has(f.level));
  // Named for the pool's last word ("Arcane Shots" → shot): the feature that
  // opens it (Rune Carver), or one that grows it (Additional Rune Known) —
  // not another feature at that level (Master of Runes).
  const poolFeature = f => pools.some(p => picked(p.name) && (f.name === p.name
    || (p.from === f.from && f.name.toLowerCase().includes(p.name.split(' ').pop().replace(/s$/, '').toLowerCase())
        && (f.level === Math.min(...p.levels) || (p.levels.has(f.level) && /^(Additional|Extra)\b/.test(f.name))))));
  const featPicked = f => {
    if (f.from !== 'feat') return false;
    const ft = sktRulesFeat(R, f.name); if (!ft) return false;
    if ((ft.optionalProgression || []).some(p => picked(p.name))) return true;
    const fc = sktFeatChoices(R, build, f.name);
    const any = fc.choices.length || Object.values(fc.fixed).some(v => v.length);
    return !!any && !sktFeatChoicesMissing(R, build, f.name);
  };
  const spData = species ? [species, subrace].filter(Boolean) : [];
  const spGives = spData.some(x => ['skills', 'tools', 'weapons', 'armor'].some(k => (x[k] || []).length)) || (build.speciesSkills || []).length;
  const speciesDone = f => f.from === 'species' && ((/proficien/i.test(f.text || '') && spGives)
    || (/spell list/i.test(f.text || '') && spGr && spGr.expanded.length)
    || (/\b(cantrip|spell)\b/i.test(f.text || '') && spGr && spGr.spells.length && !spGr.missing)
    || (/\bfeat\b/i.test(f.text || '') && /^(Feat|Versatile|Variant Feature)/.test(f.name) && !!build.originFeat));
  const featureList = features.map(f => ({ name: f.name, from: f.from, level: f.level, text: f.text, info: f.info || undefined,
    mech: f.mech || (!f.info && (appliedName.has(f.name) || poolFeature(f) || featPicked(f) || speciesDone(f) || givesSpell(f) || ctx.applied.has(f.name) || ctx.actions.some(a => a.feature === f.name || a.name === f.name) || (ctx.saveMods || []).some(m => m.src === f.name) || ctx.rollAdv.some(x => x.label === f.name))) }));
  const subName = sub ? sub.shortName : '';
  const speciesLabel = species ? (subrace ? subrace.name + ' ' + species.name : species.name) : '';
  const moveSrc = (subrace && subrace.speed && typeof subrace.speed === 'object') ? subrace.speed : species && species.speed;
  if (moveSrc && typeof moveSrc === 'object'){
    const other = ['fly', 'swim', 'climb', 'burrow'].filter(k => moveSrc[k]).map(k =>
      k[0].toUpperCase() + k.slice(1) + ' ' + (moveSrc[k] === true ? speed : (typeof moveSrc[k] === 'object' ? moveSrc[k].number : moveSrc[k])) + ' ft');
    if (other.length) _fxNote(ctx, 'Speed: ' + other.join(', ') + '.');
  }
  // Size: fixed by most species; a few 2024 species let the player choose.
  const sizes = (species && Array.isArray(species.size) && species.size.length) ? species.size : ['M'];
  const sizeCode = sizes.includes(build.size) ? build.size : (sizes.includes('M') ? 'M' : sizes[0]);
  const SIZE_NAME = { T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large' };
  // Custom bonuses from the sheet's Customize: on top of everything else.
  const ov = build.overrides || {};
  const list = k => String(ov[k] || '').split(',').map(x => x.trim()).filter(Boolean);
  list('languages').forEach(l => ctx.languages.add(_sktTitle(l)));
  list('tools').forEach(t => ctx.toolProf.add(t.toLowerCase()));
  list('weapons').forEach(w => ctx.weaponProf.add(w.toLowerCase().replace(/ weapons?$/, '')));
  list('armor').forEach(a => ctx.armorProf.add(a.toLowerCase().replace(/ armou?r$/, '')));
  list('resist').forEach(r => ctx.resist.add(r.toLowerCase()));
  list('immune').forEach(r => ctx.immune.add(r.toLowerCase()));
  const extraVuln = list('vulnerable').map(v => v.toLowerCase());
  const extraSenses = list('senses');
  const add = (k) => +ov[k] || 0;
  if (add('ac')) { ac += add('ac'); _fxNote(ctx, 'Custom bonus: AC ' + sktSigned(add('ac')) + '.'); }
  init += add('init'); speed += add('speed'); hpMax = Math.max(1, hpMax + add('hpMax'));
  SKT_ABS.forEach(k => { saves[k] += add('saveAll') + (+(ov.saves || {})[k] || 0); });
  Object.keys(ov.skills || {}).forEach(k => { if (k in skills) skills[k] += +ov.skills[k] || 0; });
  passive += add('passive') + (+(ov.skills || {}).perception || 0);
  // A proficiency level chosen on the sheet (none, half, proficient, expertise)
  // in place of the rules', and a save's proficiency the same way.
  const pbPart = l => l >= 2 ? 2 * pb : l >= 1 ? pb : l > 0 ? Math.floor(pb / 2) : 0;
  Object.keys(ov.skillProf || {}).forEach(k => {
    if (!(k in skills) || ov.skillProf[k] === '' || ov.skillProf[k] == null) return;
    const want = +ov.skillProf[k] || 0, had = +skillProfOut[k] || 0, d = pbPart(want) - pbPart(had);
    skills[k] += d; if (k === 'perception') passive += d;
    if (want) skillProfOut[k] = want; else delete skillProfOut[k];
  });
  Object.keys(ov.saveProf || {}).forEach(k => {
    if (!(k in saves) || ov.saveProf[k] === '' || ov.saveProf[k] == null) return;
    const want = !!ov.saveProf[k], had = ctx.saveProf.has(k);
    if (want !== had){ saves[k] += want ? pb : -pb; if (want) ctx.saveProf.add(k); else ctx.saveProf.delete(k); }
  });
  // Numbers set outright: the rules' answer replaced, as D&D Beyond's overrides do.
  const setNum = v => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
  Object.keys(ov.skillSet || {}).forEach(k => { const v = setNum(ov.skillSet[k]); if (v != null && k in skills){ skills[k] = v; if (k === 'perception') passive = 10 + v + add('passive'); } });
  Object.keys(ov.saveSet || {}).forEach(k => { const v = setNum(ov.saveSet[k]); if (v != null && k in saves) saves[k] = v; });
  const acSet = setNum(ov.acSet), initSet = setNum(ov.initSet), hpSet = setNum(ov.hpMaxSet);
  if (acSet != null) ac = acSet;
  if (initSet != null) init = initSet;
  if (hpSet != null && hpSet > 0) hpMax = hpSet;
  // Every way of moving: the species' (a fly or swim speed), then the sheet's.
  const speeds = { walk: speed };
  if (moveSrc && typeof moveSrc === 'object') ['fly', 'swim', 'climb', 'burrow'].forEach(k => { if (moveSrc[k]) speeds[k] = moveSrc[k] === true ? speed : (typeof moveSrc[k] === 'object' ? +moveSrc[k].number || 0 : +moveSrc[k] || 0); });
  Object.keys(ctx.moveExtra || {}).forEach(k => { const v = ctx.moveExtra[k] === 'walk' ? speed : +ctx.moveExtra[k] || 0; if (v) speeds[k] = Math.max(speeds[k] || 0, v); });
  // Roving's climb and swim: not in heavy armour.
  if (!heavy) Object.keys(ctx.moveUnlessHeavy || {}).forEach(k => { const v = ctx.moveUnlessHeavy[k] === 'walk' ? speed : +ctx.moveUnlessHeavy[k] || 0; if (v) speeds[k] = Math.max(speeds[k] || 0, v); });
  ['walk', 'fly', 'swim', 'climb', 'burrow'].forEach(k => { const v = setNum((ov.speedSet || {})[k]); if (v != null){ if (v > 0) speeds[k] = v; else if (k !== 'walk') delete speeds[k]; } });
  speed = speeds.walk;
  const speedShow = speeds[ov.speedShow] ? ov.speedShow : 'walk';
  const hpWas = typeof prior.hp === 'number' && typeof prior.hpMax === 'number' ? prior.hp + (hpMax - prior.hpMax) : hpMax;

  return {
    name: build.name || 'New Character',
    cls: cls ? cls.key : '', subclass: subName, level: L,
    race: speciesLabel, background: build.background || '',
    icon: build.icon || prior.icon || _SKT_CLASS_ICON[cls && cls.key] || '⚔',
    hp: Math.max(0, Math.min(hpMax, hpWas)), hpMax, ac, init, spd: speed, pp: passive, speeds, speedShow,
    // Starting gold from the kit (a class's gold option, a background's
    // pouch). Kept once the character exists — what they have spent since
    // is theirs, not the kit's.
    gold: typeof prior.gold === 'number' ? prior.gold : gear.gold,
    tempHp: prior.tempHp || 0, inspiration: !!prior.inspiration,
    abilities, resources, feats,
    hitDice: { current: prior.hitDice ? Math.min(L, prior.hitDice.current + Math.max(0, L - (prior.hitDice.max || L))) : L,
               max: L, dieType: 'd' + hd },
    resistances: [...ctx.resist],
    immunities: [...ctx.immune],
    // The party card edits vulnerabilities by hand; Customize's are added,
    // and the ones it added last time and has since dropped come off.
    vulnerabilities: (() => {
      const was = String((((prior.build || {}).overrides) || {}).vulnerable || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
      return [...new Set((prior.vulnerabilities || []).filter(v => !was.includes(String(v).toLowerCase())).concat(extraVuln))];
    })(),
    rules: R.edition,
    build: JSON.parse(JSON.stringify(build)),
    sheet: {
      skills, skillProf: skillProfOut, saves, saveProf: [...ctx.saveProf], profBonus: pb, passivePerception: passive,
      classLevels: cls ? parts.filter(p => p.key).map(p => ({ cls: p.key, level: p.level, subclass: p.subclass || '' })) : [],
      hitDiceByClass: parts.length > 1 ? parts.filter(p => p.key).map(p => p.level + 'd' + ((sktRulesClass(R, p.cls) || {}).hd || 8)).join(' + ') : '',
      languages: [...ctx.languages].join(', '),
      proficiencies: { armor: [...ctx.armorProf].filter(Boolean), weapons: [...ctx.weaponProf].filter(Boolean),
                       weaponRules: ctx.weaponPropRules, tools: [...ctx.toolProf].filter(Boolean) },
      attacks, attacksPerAction: ctx.attacksPerAction, critRange: ctx.critRange,
      states: states.map(x => ({ key: x.s.key, label: x.s.label, on: x.on, conc: x.conc, spell: x.s.spell || '', resource: x.s.resource || '',
        desc: typeof x.s.desc === 'function' ? x.s.desc(ctx, x.value) : (x.s.desc || ''), options: x.s.options && x.s.options(ctx).length ? x.s.options(ctx) : null, value: x.value })),
      schoolDamage: Object.keys(ctx.schoolDamage).length ? ctx.schoolDamage : undefined,
      stateSig: sktStateSig(prior), saveMods: ctx.saveMods, rollAdv: ctx.rollAdv, rollDice: ctx.rollDice, extraDamage: ctx.extraDamage, concBonus: ctx.concBonus,
      // A half-orc's Savage Attacks adds a weapon die on a melee crit, as does Brutal Critical.
      critExtraDice: (ctx.critExtraDice || 0) + (features.some(f => f.from === 'species' && f.name === 'Savage Attacks') ? 1 : 0),
      greatWeaponFighting: !!ctx.gwf,
      // Magic items attuned at once: three, more for an artificer.
      attuneMax: ctx.attuneMax || 3,
      spellSlots, spellSaveDc: sc ? sc.dc : null, spellAtkBonus: sc ? sktSigned(sc.attack) : null,
      spellAbility: sc ? sc.ability : null,
      spells: spellNames, alwaysPrepared: always, arcanum,
      spellbook, featSpells: featSpells.map(g => ({ feat: g.feat, ability: g.ability, spells: g.spells, daily: g.daily })),
      speciesSpells: spGrant && spGrant.spells.length ? { ability: spGrant.ability, spells: spGrant.spells, daily: spGrant.daily } : null,
      size: SIZE_NAME[sizeCode] || 'Medium',
      details: Object.assign({}, build.details || {}),
      activations: ctx.actions, notes: ctx.notes, featureList,
      equipment: gear.list.concat((build.items || []).map(m => m.name + ((m.qty || 1) > 1 ? ' ×' + m.qty : '') + (m.reqAttune ? (m.attuned ? ' (attuned)' : ' (not attuned)') : ''))),
      stealthDis: !!(armor && armor.stealth),
      acSource: best ? best.label + (shield ? ' + ' + (shield._name || 'Shield') : '') : '',
      acDetail: acSet != null ? 'Set on the sheet: ' + ac : acParts.join(' + ') + (add('ac') ? ' + custom ' + add('ac') : '') + ' = ' + ac,
      hpDetail: hpSet != null && hpSet > 0 ? 'Set on the sheet: ' + hpMax : hpDetail + (add('hpMax') ? ' ' + (add('hpMax') > 0 ? '+' : '') + add('hpMax') + ' custom' : ''),
      senses: [ctx.senses.darkvision ? 'Darkvision ' + ctx.senses.darkvision + ' ft.' : '',
               ctx.senses.blindsight ? 'Blindsight ' + ctx.senses.blindsight + ' ft.' : '',
               ctx.senses.truesight ? 'Truesight ' + ctx.senses.truesight + ' ft.' : ''].concat(extraSenses).filter(Boolean).join(', '),
      bio: { features: featureList.map(f => '* ' + f.name + '\n' + f.text).join('\n\n') },
    },
  };
}
const _SKT_CLASS_ICON = { barbarian: '🪓', bard: '🎵', cleric: '✨', druid: '🌿', fighter: '⚔', monk: '👊',
                          paladin: '🛡', ranger: '🏹', rogue: '🗡', sorcerer: '🔥', warlock: '👁', wizard: '📘' };

// A subclass whose spells come as alternatives asks which one: Circle of
// the Land's terrain, a Divine Soul's affinity, a Genie's kind, the Giant's
// or Arcane Archer's cantrip. Kept in build.subclassPick.
const SKT_SUB_PICK_LABEL = { land: 'Land type', 'divine soul': 'Divine affinity', genie: 'Kind of genie', giant: 'Cantrip', 'arcane archer': 'Cantrip' };
function sktSubclassSpellPick(sub){
  const a = (sub && sub.additionalSpells) || [];
  if (a.length < 2) return null;
  const label = b => {
    if (b.name) return String(b.name);
    for (const kind of ['known', 'innate', 'prepared']) for (const v of Object.values(b[kind] || {})) {
      const s = (Array.isArray(v) ? v : []).find(x => typeof x === 'string');
      if (s) return _sktTitle(s.split('|')[0].replace(/#c$/, ''));
    }
    return '?';
  };
  return { label: SKT_SUB_PICK_LABEL[String(sub.shortName).toLowerCase()] || 'Option', options: a.map(b => ({ value: label(b), block: b })) };
}
// The subclass's spell blocks that apply: all of a single one, or the one picked.
function sktSubclassBlocks(sub, build){
  const pick = sktSubclassSpellPick(sub);
  if (!pick) return (sub && sub.additionalSpells) || [];
  const o = pick.options.find(x => x.value === (build && build.subclassPick));
  return o ? [o.block] : [];
}

// A bard's Magical Secrets. 2014: two spells from any class at 10th, 14th
// and 18th level (a cantrip or a level the bard can cast), counted in Spells
// Known; kept in build.secrets. 2024: from 10th level the bard prepares from
// the cleric, druid and wizard lists too (see sktSpellOptions).
function sktMagicalSecrets(build, R){
  if (R.edition !== '2014') return null;
  const p = sktClassLevels(build, R).find(x => x.key === 'bard');
  const n = p ? [10, 14, 18].filter(l => p.level >= l).length * 2 : 0;
  if (!n) return null;
  const view = sktClassView(build, R, p);
  const sc = _sktSpellcastingOne(view, R, sktBuildAbilities(build, R));
  const max = (sc && sc.maxSpellLevel) || 0;
  const options = R.spells.filter(s => s.level <= max && (sktExtraSources(build) || !s.core ? sktBookOk(build, s) && s.classesAll.length : s.core && s.classes.length)).map(s => s.name).sort();
  return { count: n, options, picked: (build.secrets || []).filter(x => options.includes(x)).slice(0, n) };
}

// A wizard's capstone spells, chosen from the spellbook: Spell Mastery (18th
// level: a 1st- and a 2nd-level spell, at will) and Signature Spells (20th:
// two 3rd-level spells, always prepared, each free once per short rest).
// Kept in build.featureSpells[feature].
function sktFeatureSpellPicks(build, R){
  const p = sktClassLevels(build, R).find(x => x.key === 'wizard');
  if (!p) return [];
  const view = sktClassView(build, R, p);
  const book = (view.spellbook && view.spellbook.length ? view.spellbook : view.spells) || [];
  const slots = [];
  if (p.level >= 18) slots.push(['Spell Mastery', 1, 1], ['Spell Mastery', 2, 1]);
  if (p.level >= 20) slots.push(['Signature Spells', 3, 2]);
  return slots.map(([feature, level, count]) => {
    const options = book.filter(n => (sktRulesSpell(R, n) || {}).level === level);
    const picked = (((build.featureSpells || {})[feature]) || []).filter(n => options.includes(n)).slice(0, count);
    return { feature, level, count, options, picked };
  });
}

// A warlock's Mystic Arcanum: one spell each of 6th to 9th level, arriving at
// warlock levels 11, 13, 15 and 17, cast once per long rest without a slot.
// Kept in build.arcanum ({ 6: 'Mass Suggestion', … }).
function sktArcanumLevels(build, R){
  const p = sktClassLevels(build, R).find(x => x.key === 'warlock');
  return p ? [[6, 11], [7, 13], [8, 15], [9, 17]].filter(([, at]) => p.level >= at).map(([lv]) => lv) : [];
}
function sktArcanumOptions(build, R, lv){
  const p = sktClassLevels(build, R).find(x => x.key === 'warlock');
  return p ? sktSpellOptions(R, sktClassView(build, R, p), lv).map(s => s.name) : [];
}

// Domain spells, oath spells and the like — always prepared, from the
// subclass (and 2014 species) additionalSpells, up to the current level.
function sktBuildAlwaysPrepared(build, R){
  const parts = sktClassLevels(build, R);
  if (parts.length === 1) return _sktAlwaysPreparedOne(build, R);
  return [...new Set([].concat(...parts.map(p => _sktAlwaysPreparedOne(sktClassView(build, R, p), R))))];
}
function _sktAlwaysPreparedOne(build, R){
  const cls = sktRulesClass(R, build.cls), sub = sktRulesSubclass(cls, build.subclass);
  const out = [];
  const take = (spec) => {
    (spec || []).forEach(block => {
      ['prepared', 'known', 'innate'].forEach(kind => {
        const by = block && block[kind]; if (!by) return;
        Object.keys(by).forEach(lv => {
          if (+String(lv).replace(/\D/g, '') > (build.level || 1)) return;
          // A list, or one split by how it's cast ({ ritual: [...] }, { daily: { 1: [...] } }).
          const flat = v => Array.isArray(v) ? v.flatMap(flat) : v && typeof v === 'object'
            ? Object.keys(v).filter(k => k !== 'choose' && k !== 'all').flatMap(k => flat(v[k])) : typeof v === 'string' ? [v] : [];
          flat(by[lv]).forEach(s => {
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
  if (sub) take(sktSubclassBlocks(sub, build));
  return [...new Set(out)];
}

// ── Equipment ────────────────────────────────────────────────────────────────
// The starting kit for a choice letter ("A", "B"…), from the data's
// defaultData, plus any individual items the player added. Returns the
// armour and shield worn (the best the character is proficient with) and
// the weapons carried.
function sktBuildEquipment(build, R){
  const cls = sktRulesClass(R, build.cls), bg = sktBuildBackground(R, build);
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
  // Once the sheet's inventory has taken over (eq.materialized) the kit is
  // history: what is carried is build.items.
  if (!eq.materialized){
    if (typeof eq.clsGold === 'number') gold += eq.clsGold;
    else if (cls && cls.equipment && Array.isArray(cls.equipment.defaultData)) takeBlocks(cls.equipment.defaultData, 'cls');
    if (bg) takeBlocks(bg.equipment, 'bg');
    (eq.extra || []).forEach(n => names.push(String(n).toLowerCase()));
  }
  const items = names.map(n => R.items[n]).filter(Boolean);
  // Magic weapons and armour fight and are worn like any other, with their
  // bonus (only once attuned, where that is needed).
  (build.items || []).forEach(m => {
    const st = m.stats || (m.base && R.items[m.base]);
    if (!st || m.equipped === false) return;
    const on = !m.reqAttune || _sktActiveItems(build).includes(m);
    // _qty: four handaxes are one inventory line, but four weapons.
    items.push(Object.assign({}, st, { _name: m.name, _qty: Math.max(1, +m.qty || 1),
      _hit: on ? (m.bonusWeapon || 0) + (m.bonusWeaponAttack || 0) : 0,
      _dmg: on ? (m.bonusWeapon || 0) + (m.bonusWeaponDamage || 0) : 0,
      _ac: on ? (m.bonusAc || 0) : 0 }));
  });
  const armors = items.filter(i => /^(LA|MA|HA)/.test(String(i.type)));
  const shield = items.filter(i => /^S(\||$)/.test(String(i.type))).sort((a, b) => (b._ac || 0) - (a._ac || 0))[0] || null;
  const weapons = items.filter(i => /^(M|R)(\||$)/.test(String(i.type)));
  // Wear the armour that gives the best AC; a wizard handed chain mail by a
  // background does not put it on.
  const armor = armors.sort((a, b) => ((+b.ac || 0) + (b._ac || 0)) - ((+a.ac || 0) + (a._ac || 0)))[0] || null;
  // Gear bought in the builder comes out of the starting money.
  if (!eq.materialized && eq.spent) gold = Math.max(0, gold - eq.spent / 100);
  return { armor, shield, weapons, gold: Math.round(gold * 100) / 100, list: names.map(_sktTitle), names };
}
// The starting kit as an inventory: one line per item with its count, its
// weight, and the armour, shield and weapons in use marked equipped. What the
// sheet turns the kit into the first time the inventory is changed.
function sktKitItems(build, R, gear){
  const g = sktBuildEquipment(Object.assign({}, build, { items: [], equipment: Object.assign({}, build.equipment, { materialized: false }) }), R);
  const count = {};
  g.names.forEach(n => { count[n] = (count[n] || 0) + 1; });
  const gw = {};
  (gear || []).forEach(x => { gw[String(x.name).toLowerCase()] = x.weight; });
  return Object.keys(count).map(n => {
    const bi = R.items[n];
    const it = { name: bi ? bi.name : _sktTitle(n), qty: count[n], weight: (bi && bi.weight) || gw[n] || 0, kit: true };
    const bundle = /^(.*?)\s*\((\d+)\)$/.exec(it.name);
    if (bundle){ it.name = bundle[1]; it.weight = (it.weight || 0) / +bundle[2]; it.qty *= +bundle[2]; return it; }
    if (bi){
      it.base = n;
      const t = String(bi.type || '').split('|')[0];
      if (/^(LA|MA|HA)$/.test(t)) it.equipped = !!(g.armor && g.armor.name === bi.name);
      else if (t === 'S') it.equipped = !!(g.shield && g.shield.name === bi.name);
      else if (/^(M|R)$/.test(t)) it.equipped = true;
    }
    return it;
  });
}
// Ordinary gear for the sheet's "add an item": everything in the item data
// that isn't magic, one edition's printing.
const _sktGearCache = {};
async function sktGearLoad(edition, read){
  edition = edition === '2014' ? '2014' : '2024';
  if (_sktGearCache[edition] && !read) return _sktGearCache[edition];
  const job = (async () => {
    read = read || sktRulesReader();
    const [items, base] = await Promise.all([read('items.json'), read('items-base.json')]);
    const pick = _sktEraPicker(edition, SKT_EDITION_SRC[edition]);
    // Mundane gear, and the adventures' unrated curios (rarity "unknown").
    const plain = _sktItemCopies((items.item || []).concat(base.baseitem || []))
      .filter(i => (!i.rarity || i.rarity === 'none' || i.rarity === 'unknown') && !/^\$/.test(String(i.type || '')));
    return pick(plain, { legacy: edition === '2024' }).map(i => ({ kind: 'gear', name: i.name, source: i.source, weight: i.weight || 0, value: i.value || 0,
      base: /^(M|R|LA|MA|HA|S)(\||$)/.test(String(i.type || '')) ? i.name.toLowerCase() : null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  })();
  if (!read) _sktGearCache[edition] = job;
  return job;
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
  // Monk weapons: 2014, simple melee weapons without two-handed or heavy and
  // the shortsword; 2024, simple melee and martial melee with Light. A
  // Kensei's chosen weapons too, ranged ones included.
  const kensei = new Set((((ctx.build._full || ctx.build).profPicks || {})['Path of the Kensei'] || {}).weapons || []);
  const monkWeapon = (w, props, ranged) => kensei.has(String(w._name || w.name).toLowerCase()) || kensei.has(String(w.name).toLowerCase())
    || (!ranged && (ctx.edition === '2024' ? (String(w.weaponCategory) === 'simple' || props.includes('L'))
      : ((String(w.weaponCategory) === 'simple' && !props.includes('2H') && !props.includes('H')) || /^shortsword$/i.test(w.name))));
  const seen = new Set();
  (gear.weapons || []).forEach(w => {
    const key = w._name || w.name;
    if (seen.has(key)) return; seen.add(key);
    const props = (w.property || []).map(p => String(p).split('|')[0]);
    const ranged = String(w.type).split('|')[0] === 'R';
    const finesse = props.includes('F');
    let ab = ranged ? m.dex : (finesse ? Math.max(m.str, m.dex) : m.str);
    // A monk's weapons use Dexterity if it is better (martial arts weapons).
    if (ctx.martialArts && monkWeapon(w, props, ranged)) ab = Math.max(m.str, m.dex);
    // Shillelagh: a club or quarterstaff hits with the spellcasting ability
    // and a bigger die.
    const shil = ctx.shillelagh && sc && /^(club|quarterstaff)$/i.test(w.name);
    if (shil) ab = Math.max(ab, m[sc.ability] || 0);
    const hit = ab + (prof(w) ? pb : 0) + (ranged ? ctx.rangedAttackBonus : 0) + (w._hit || 0) + ctx.weaponHit;
    // Rage adds its damage to a melee attack made with Strength.
    const flat = (w._dmg || 0) + (!ranged && ab === m.str ? ctx.rageOn : 0) + ctx.damageBonusAll;
    let dmgBonus = ab + (!ranged && !props.includes('2H') && ctx.duelingBonus ? ctx.duelingBonus : 0) + flat;
    let die = shil ? ctx.shillelagh.die : (w.dmg1 || '1');
    if (ctx.martialArts && ctx.martialArtsDie && !ranged && monkWeapon(w, props, ranged) && _sktDieAvg(ctx.martialArtsDie) > _sktDieAvg(die)) die = ctx.martialArtsDie;
    const type = SKT_DMG[String(w.dmgType || '').charAt(0)] || '';
    const mastery = (w.mastery || [])[0] ? String(w.mastery[0]).split('|')[0] : '';
    out.push({
      name: w._name || _sktTitle(w.name), atkBonus: sktSigned(hit),
      damage: die + (dmgBonus ? (dmgBonus > 0 ? '+' : '') + dmgBonus : '') + (type ? ' ' + type : ''),
      versatile: w.dmg2 ? w.dmg2 + (dmgBonus ? sktSigned(dmgBonus) : '') : null,
      range: w.range || null,
      mastery: (ctx.build.masteries || []).map(s => s.toLowerCase()).includes(w.name.toLowerCase()) ? mastery : '',
      props, str: !ranged && ab === m.str, _ab: ab, _flat: flat,
    });
  });
  // Two light melee weapons: a bonus-action attack with the other one, its
  // damage without the ability modifier (unless it is negative, or the
  // character has the Two-Weapon Fighting style).
  const lightMelee = out.filter(a => a.props && a.props.includes('L') && !a.spell && !/^(Unarmed|.*\(off-hand\))/.test(a.name)
    && (gear.weapons || []).some(w => (w._name || _sktTitle(w.name)) === a.name && String(w.type).split('|')[0] === 'M'));
  // Counted by quantity: once the kit became an inventory, "Handaxe ×4" was
  // one line, and the off-hand attack vanished the first time a bolt was shot.
  const weaponsCarried = (gear.weapons || []).filter(w => (w.property || []).map(p => String(p).split('|')[0]).includes('L') && String(w.type).split('|')[0] === 'M')
    .reduce((n, w) => n + (w._qty || 1), 0);
  if (lightMelee.length && weaponsCarried >= 2){
    const main = lightMelee[0], off = lightMelee[1] || lightMelee[0];
    const m2 = /^(\d*d\d+)([+-]\d+)?(.*)$/.exec(off.damage || '');
    if (m2){
      // The ability modifier comes off (unless it's negative, or the style
      // keeps it); a magic weapon's bonus and Rage's stay.
      const mod = off._ab != null ? off._ab : parseInt(m2[2] || '0', 10);
      const keep = (ctx.twoWeaponMod ? mod : Math.min(0, mod)) + (off._flat || 0);
      out.push(Object.assign({}, off, { name: off.name + ' (off-hand)', damage: m2[1] + (keep ? (keep > 0 ? '+' : '') + keep : '') + m2[3], offhand: true, versatile: null }));
    }
  }
  // Unarmed strike: 1 + Strength, or a martial arts die with the better of
  // Strength and Dexterity.
  const dance = ctx.bardicUnarmed && !(gear && (gear.armor || gear.shield));
  const uab = ctx.martialArts || dance ? Math.max(m.str, m.dex) : m.str;
  const uflat = (uab === m.str ? ctx.rageOn : 0) + ctx.damageBonusAll;
  let uDie = ctx.martialArts && dance ? (_sktDieAvg(ctx.bardicUnarmed) > _sktDieAvg(ctx.martialArtsDie) ? ctx.bardicUnarmed : ctx.martialArtsDie) : ctx.martialArts ? ctx.martialArtsDie : dance ? '1' + ctx.bardicUnarmed : null;
  // A bigger unarmed die from a feat (Tavern Brawler's d4).
  if (ctx.unarmedMinDie && (!uDie || _sktDieAvg(ctx.unarmedMinDie) > _sktDieAvg(uDie))) uDie = ctx.unarmedMinDie;
  // Unarmed Fighting: a d6, or a d8 with no weapon or shield in hand.
  if (ctx.unarmedFighting){
    const ud = gear && (gear.shield || (gear.weapons || []).length) ? '1d6' : '1d8';
    if (!uDie || _sktDieAvg(ud) > _sktDieAvg(uDie)) uDie = ud;
  }
  out.push({ name: 'Unarmed Strike', atkBonus: sktSigned(uab + pb), str: uab === m.str,
             damage: (uDie ? uDie + sktSigned(uab + uflat) : String(Math.max(1, 1 + m.str + uflat))) + ' bludgeoning' });
  // A species' natural weapons, each an unarmed strike of its own.
  (ctx.naturalAttacks || []).forEach(n => { const k = n.ab || 'str';
    out.push({ name: n.name, atkBonus: sktSigned(m[n.hit || 'str'] + pb), str: (n.hit || 'str') === 'str',
      damage: n.die + (n.ab ? sktSigned(m[k] + (k === 'str' ? (ctx.rageOn || 0) : 0) + ctx.damageBonusAll) : '') + ' ' + n.type }); });
  if (ctx.psychicBlades){
    const pab = Math.max(m.str, m.dex), pflat = (pab === m.str ? ctx.rageOn : 0) + ctx.damageBonusAll;
    const row = (die, extra) => Object.assign({ name: 'Psychic Blades', atkBonus: sktSigned(pab + pb), str: pab === m.str && pab !== m.dex,
      damage: die + sktSigned(pab + pflat) + ' psychic', props: ['F', 'T'], range: '60', mastery: ctx.edition === '2024' ? 'Vex' : '' }, extra || {});
    out.push(row('1d6'), row('1d4', { name: 'Psychic Blades (bonus action)' }));
  }
  // Attack cantrips the character knows.
  if (sc) (sc.cantripLists || [{ names: ctx.build.cantrips || [], attack: sc.attack, dc: sc.dc }]).forEach(list => list.names.forEach(n => {
    const s = sktRulesSpell(ctx.R, n); if (!s) return;
    const dice = _sktCantripDice(s, ctx.level); if (!dice) return;
    const type = (s.damageInflict || [])[0] || '';
    const isAttack = !!(s.spellAttack && s.spellAttack.length);
    if (!isAttack && !(s.savingThrow || []).length) return;
    let bonus = 0, beams = 0;
    // Eldritch Blast does not roll bigger dice as you level — it fires more
    // beams, each its own attack for 1d10.
    if (ctx.cantripDamageBonus) bonus += ctx.cantripDamageBonus;
    bonus += ctx.damageBonusAll;
    if (/eldritch blast/i.test(s.name)){
      beams = ctx.level >= 17 ? 4 : ctx.level >= 11 ? 3 : ctx.level >= 5 ? 2 : 1;
      if (ctx.agonizingBlast) bonus += m.cha;
    }
    out.push({
      name: s.name,
      atkBonus: isAttack ? sktSigned(list.attack) : 'DC ' + list.dc + ' ' + String((s.savingThrow || [''])[0]).slice(0, 3).toUpperCase(),
      damage: (beams ? '1d10' : dice) + (bonus ? sktSigned(bonus) : '') + (type ? ' ' + type : '') + (beams > 1 ? ' ×' + beams + ' beams' : ''),
      spell: true,
    });
  }));
  out.forEach(a => { delete a._ab; delete a._flat; });
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
// Picks a class no longer allows: more cantrips or spells than it gives now
// (a lower level, a lower casting score), or spells above the highest level
// it can cast. Phrased for the to-do list.
function sktSpellExcess(lst, s, R){
  const out = [], n = k => (lst[k] || []).length, pl = (c, w) => c + ' ' + w + (c === 1 ? '' : 's');
  const want = s.prepared || s.known;
  if (n('cantrips') > s.cantrips) out.push('remove ' + pl(n('cantrips') - s.cantrips, 'cantrip') + ' (' + s.cantrips + ' allowed)');
  if (s.spellbook && n('spellbook') > s.spellbook) out.push('remove ' + pl(n('spellbook') - s.spellbook, 'spell') + ' from the spellbook (' + s.spellbook + ' allowed)');
  if (want && n('spells') > want) out.push('remove ' + pl(n('spells') - want, 'spell') + ' (' + want + ' allowed)');
  const high = [].concat(lst.spells || [], lst.spellbook || []).filter((x, i, a) => a.indexOf(x) === i && ((sktRulesSpell(R, x) || {}).level || 0) > (s.maxSpellLevel || 0));
  if (high.length) out.push('remove ' + pl(high.length, 'spell') + ' above level ' + (s.maxSpellLevel || 0) + ' (' + high.join(', ') + ')');
  return out;
}
function sktBuildTodo(build, R){
  const todo = [];
  const cls = sktRulesClass(R, build.cls);
  const L = build.level || 1;
  if (!build.name) todo.push({ step: 'basics', what: 'a name' });
  { const bg0 = sktRulesBackground(R, build.background), a = build.bgAdapt || {};
    const needFeat = !(bg0 && (bg0.feats || []).length);
    if (sktBgNeedsAdapt(R, bg0) && ((a.abilities || []).length < 3 || (needFeat && !a.feat))) todo.push({ step: 'background', what: 'three abilities' + (needFeat ? ' and an origin feat' : '') + ' for ' + bg0.name + ' (a 2014 background)' }); }
  if (!build.species) todo.push({ step: 'species', what: 'a species' });
  if (!cls) { todo.push({ step: 'class', what: 'a class' }); return todo; }
  if (!build.background) todo.push({ step: 'background', what: 'a background' });
  if (sktClassLevels(build, R)[0].level >= cls.subclassLevel && !build.subclass) todo.push({ step: 'class', what: _sktA(sktRulesInline(cls.subclassTitle).toLowerCase()) });
  { const sub = sktRulesSubclass(cls, build.subclass), pk = sktSubclassSpellPick(sub);
    if (pk && !pk.options.some(o => o.value === build.subclassPick)) todo.push({ step: 'class', what: _sktA(pk.label.toLowerCase()) + ' for ' + sub.shortName }); }
  if ((build.skills || []).length < cls.skillChoice.count) todo.push({ step: 'skills', what: (cls.skillChoice.count - (build.skills || []).length) + ' class skill' + (cls.skillChoice.count - (build.skills || []).length === 1 ? '' : 's') });
  const parts = sktClassLevels(build, R), multi = parts.length > 1;
  parts.slice(1).forEach(p => {
    const c2 = sktRulesClass(R, p.cls);
    if (p.level >= c2.subclassLevel && !p.subclass) todo.push({ step: 'class', what: _sktA(sktRulesInline(c2.subclassTitle).toLowerCase()) + ' for ' + c2.name });
    { const s2 = sktRulesSubclass(c2, p.subclass), pk = sktSubclassSpellPick(s2);
      if (pk && !pk.options.some(o => o.value === (p.entry || {}).subclassPick)) todo.push({ step: 'class', what: _sktA(pk.label.toLowerCase()) + ' for ' + s2.shortName }); }
    const sk = _sktSkillChoice(((c2.multiclassing || {}).proficienciesGained || {}).skills);
    const have = ((p.entry || {}).skills || []).length;
    if (have < sk.count) todo.push({ step: 'class', what: (sk.count - have) + ' ' + c2.name + ' skill' + (sk.count - have === 1 ? '' : 's') });
  });
  sktAsiSlots(build, R).forEach(s => { if (!build.asi[s.key]) todo.push({ step: 'levels', what: (multi ? _sktTitle(s.cls) + ' ' : 'level ') + s.level + ' ability score improvement or feat' }); });
  const sc = sktBuildSpellcasting(build, R, sktBuildAbilities(build, R));
  if (sc){
    (sc.classes || [{ primary: true, sc, cls: build.cls }]).forEach(x => {
      const s = x.sc, lst = x.primary ? build : (x.entry || {}), pre = multi ? _sktTitle(x.cls) + ': ' : '';
      if ((lst.cantrips || []).length < s.cantrips) todo.push({ step: 'spells', what: pre + (s.cantrips - (lst.cantrips || []).length) + ' cantrip(s)' });
      const want = s.prepared || s.known;
      if (s.spellbook && (lst.spellbook || []).length < s.spellbook)
        todo.push({ step: 'spells', what: pre + (s.spellbook - (lst.spellbook || []).length) + ' spell(s) for the spellbook' });
      if (want && (lst.spells || []).length < want) todo.push({ step: 'spells', what: pre + (want - (lst.spells || []).length) + ' spell(s)', soft: true });
      sktSpellExcess(lst, s, R).forEach(x => todo.push({ step: 'spells', what: pre + x }));
    });
  }
  sktFeatSpells(build, R).forEach(g => { if (g.missing) todo.push({ step: 'spells', what: 'the spells from ' + g.feat }); });
  const bgFeat = R.edition === '2024' ? sktBuildFeatNames(Object.assign({}, build, { originFeat: '', asi: {} }), R)[0] : null;
  sktBuildFeatNames(build, R).forEach(n => {
    if (sktFeatChoicesMissing(R, build, n)) todo.push({ step: n === build.originFeat ? 'species' : n === bgFeat ? 'background' : 'levels', what: 'choices for ' + n });
  });
  sktToolChoices(build, R).forEach(c => {
    const have = ((build.toolPicks || {})[c.key] || []).length;
    if (have < c.count) todo.push({ step: 'skills', what: (c.count - have) + ' tool proficienc' + (c.count - have === 1 ? 'y' : 'ies') + ' (' + c.label + ')' });
  });
  { const sp = sktRulesSpecies(R, build.species), rc = sktSpeciesResistChoice(sp, sktSpeciesSub(sp, build));
    if (rc && !sktSpeciesResist(sp, sktSpeciesSub(sp, build), build)) todo.push({ step: 'species', what: rc.kind === 'ancestry' ? 'a draconic ancestry' : 'a damage resistance' });
    if (sp && sp.subraces.length && !sp.subraceOptional && !sktSpeciesSub(sp, build))
      todo.push({ step: 'species', what: sp.subraces.every(s => s.version) ? 'a ' + sp.name + ' option' : 'a subrace' }); }
  const spg = sktSpeciesSpellGrant(R, build);
  if (spg && spg.missing) todo.push({ step: 'species', what: spg.block ? 'the species’ spells' : 'a lineage' });
  if (R.edition === '2014'){
    const sp = sktRulesSpecies(R, build.species), sub = sp && sktSpeciesSub(sp, build);
    const ac = sktSpeciesAsiChoice(sp, sub, build), got = build.speciesAsi || {};
    if (ac && (ac.flex ? Object.values(got).reduce((n, v) => n + (+v || 0), 0) < 3 : Object.keys(got).length < ac.count))
      todo.push({ step: 'species', what: 'the species’ ability increases' });
  }
  sktBuildChoices(build, R).forEach(c => { if (!c.value) todo.push({ step: 'levels', what: c.feature + ' choice' }); });
  sktArcanumLevels(build, R).forEach(lv => { if (!(build.arcanum || {})[lv]) todo.push({ step: 'spells', what: 'a ' + lv + 'th-level Mystic Arcanum spell' }); });
  sktFeatureSpellPicks(build, R).forEach(x => { const n = x.count - x.picked.length; if (n > 0) todo.push({ step: 'spells', what: n + ' ' + x.level + (x.level === 1 ? 'st' : x.level === 2 ? 'nd' : 'rd') + '-level spell' + (n === 1 ? '' : 's') + ' for ' + x.feature }); });
  { const ms = sktMagicalSecrets(build, R); if (ms && ms.picked.length < ms.count) todo.push({ step: 'spells', what: (ms.count - ms.picked.length) + ' Magical Secrets spell' + (ms.count - ms.picked.length === 1 ? '' : 's') }); }
  const kindName = { skills: ['skill', 'skills'], weapons: ['weapon', 'weapons'], enemies: ['favored enemy', 'favored enemies'], terrains: ['favored terrain', 'favored terrains'], enhancements: ['animal enhancement', 'animal enhancements'] };
  sktProfChoices(build, R).forEach(c => { const n = c.count - c.picked.length; if (n > 0) todo.push({ step: 'skills', what: n + ' ' + kindName[c.kind][n === 1 ? 0 : 1] + ' from ' + c.feature }); });
  sktOptionalChoices(build, R).forEach(o => {
    const have = ((build.optional || {})[o.name] || []).length;
    if (have < o.count) todo.push({ step: 'levels', what: (o.count - have) + ' × ' + o.name });
  });
  return todo;
}

// ── Magic items ──────────────────────────────────────────────────────────────
// A character's items live on the build as copies of what the sheet needs
// (bonuses, the base weapon or armour, attunement), so working out the sheet
// never needs the item data, the biggest file there is. The builder loads
// that only to list what can be added.
function _sktActiveItems(build){
  let attuned = 0;
  // An artificer attunes to 4 items at 10th level, 5 at 14th, 6 at 18th.
  const full = build._full || build;
  const others = (full.multi || []).reduce((n, m) => n + Math.max(1, +m.level || 1), 0);
  const artLv = /^artificer$/i.test(full.cls || '') ? (full.level || 1) - others : ((full.multi || []).find(m => /^artificer$/i.test(m.cls || '')) || {}).level || 0;
  const max = artLv >= 18 ? 6 : artLv >= 14 ? 5 : artLv >= 10 ? 4 : 3;
  return (build.items || []).filter(m => {
    if (!m.reqAttune) return true;
    if (!m.attuned || attuned >= max) return false;
    attuned++; return true;
  });
}
function _sktItemSum(build, key){
  return _sktActiveItems(build).reduce((n, m) => n + (+m[key] || 0), 0);
}
const _sktMagicCache = {};
async function sktMagicLoad(edition, read){
  edition = edition === '2014' ? '2014' : '2024';
  if (_sktMagicCache[edition] && !read) return _sktMagicCache[edition];
  const job = (async () => {
    read = read || sktRulesReader();
    const [items, mv] = await Promise.all([read('items.json'), read('magicvariants.json')]);
    const pick = _sktEraPicker(edition, edition === '2024' ? 'XDMG' : 'DMG');
    // Every rated magic item, the adventures' unrated ones ("unknown
    // (magic)": the Silver Sword, Ivana's Whisper) and items printed as a
    // copy of another (the Wildemount vestiges' awakened and exalted states).
    const magic = _sktItemCopies(items.item || []).filter(i => i.rarity && i.rarity !== 'none' && i.rarity !== 'unknown' && !/^\$/.test(String(i.type || '')));
    // Picked as one list: the 2024 book reprints some items as variants
    // (Dwarven Plate, Moonblade), and the reprint should replace the item.
    const flat = (mv.magicvariant || []).map(v => Object.assign({}, v.inherits || {}, { name: String(v.name).replace(/\s*\(\*\)$/, ''), requires: v.requires || [], excludes: v.excludes || null, _variant: true }));
    return pick(magic.concat(flat), { legacy: edition === '2024' }).map(i => _sktMagicEntry(i, i._variant ? 'variant' : 'item'))
      .sort((a, b) => a.name.localeCompare(b.name));
  })();
  if (!read) _sktMagicCache[edition] = job;
  return job;
}
// Items written as a copy of another ("_copy"): the base's fields under the
// copy's own.
function _sktItemCopies(list){
  const by = new Map(list.map(i => [i.name + '|' + i.source, i]));
  const resolve = (i, depth) => {
    if (!i._copy || depth > 3) return i;
    const base = by.get(i._copy.name + '|' + i._copy.source);
    const out = Object.assign({}, base ? resolve(base, depth + 1) : {}, i);
    delete out._copy; delete out._mod;
    // A reprint of the base isn't a reprint of this item.
    if (!i.reprintedAs) delete out.reprintedAs;
    return out;
  };
  return list.map(i => resolve(i, 0));
}
function _sktBonus(v){ const n = parseInt(String(v == null ? '' : v).replace(/\s/g, ''), 10); return isNaN(n) ? 0 : n; }
function _sktMagicEntry(i, kind){
  const t = String(i.type || '').split('|')[0];
  const isGear = /^(M|R|LA|MA|HA|S)$/.test(t);
  const text = sktRulesText(i.entries || []);
  return {
    kind, name: i.name, source: i.source, rarity: i.rarity || '', reqAttune: !!i.reqAttune, weight: i.weight || null, value: i.value || null,
    requires: i.requires || null, excludes: i.excludes || null,
    namePrefix: i.namePrefix || '', nameSuffix: i.nameSuffix || '',
    base: i.baseItem ? String(i.baseItem).split('|')[0].toLowerCase() : null,
    stats: isGear && !i.baseItem ? { name: i.name, type: i.type, ac: i.ac, dmg1: i.dmg1, dmg2: i.dmg2, dmgType: i.dmgType,
                                    property: i.property, weaponCategory: i.weaponCategory, range: i.range, strength: i.strength } : null,
    bonusWeapon: _sktBonus(i.bonusWeapon), bonusWeaponAttack: _sktBonus(i.bonusWeaponAttack), bonusWeaponDamage: _sktBonus(i.bonusWeaponDamage),
    bonusAc: _sktBonus(i.bonusAc), bonusSavingThrow: _sktBonus(i.bonusSavingThrow),
    bonusSpellAttack: _sktBonus(i.bonusSpellAttack), bonusSpellSaveDc: _sktBonus(i.bonusSpellSaveDc),
    ability: i.ability || null, resist: (i.resist || []).filter(r => typeof r === 'string'),
    unarmoredOnly: /wearing no armou?r/i.test(text), noShield: /no armou?r and (are )?(not )?(using|wielding) (a|no) shield|no shield/i.test(text),
    charges: +i.charges > 0 ? +i.charges : null, recharge: i.recharge || null, rechargeAmount: i.rechargeAmount ? sktRulesInline(String(i.rechargeAmount)) : null,
    text,
  };
}
// The weapons or armour a variant ("+1 Weapon", "Flame Tongue", "Armor of
// Resistance") can be made from, as keys into R.items.
function sktMagicBases(R, v){
  const lower = x => String(x).toLowerCase();
  const typ = x => String(x || '').split('|')[0];
  const match = (it, cond) => Object.keys(cond).every(k => {
    if (k === 'source') return true;
    if (k === 'type') return typ(it.type) === typ(cond.type);
    if (k === 'name') return lower(it.name) === lower(cond.name);
    return it[k] === cond[k];
  });
  const excluded = (it, ex) => !!ex && Object.keys(ex).some(k => {
    const want = [].concat(ex[k]).map(x => lower(typ(x)));
    const have = [].concat(it[k] == null ? [] : it[k]).map(x => lower(typ(x)));
    return ex[k] === true ? it[k] === true : want.some(w => have.includes(w));
  });
  return Object.keys(R.items).filter(k => {
    const it = R.items[k];
    return (v.requires || []).some(c => match(it, c)) && !excluded(it, v.excludes);
  }).sort();
}
// The copy a build keeps: no text, no lists — what the sheet reads.
function sktMagicMake(R, e, baseKey){
  const base = e.kind === 'variant' ? baseKey : e.base;
  const bi = base && R.items[base];
  if (e.kind === 'variant' && !bi) return null;
  const name = e.kind === 'variant' ? (e.namePrefix + (bi ? bi.name : '') + e.nameSuffix).trim() || e.name : e.name;
  const out = { name, source: e.source, rarity: e.rarity, reqAttune: e.reqAttune, attuned: false,
                weight: e.weight != null ? e.weight : (bi && bi.weight) || 0 };
  if (base && bi) out.base = base;
  if (e.stats) out.stats = e.stats;
  ['bonusWeapon', 'bonusWeaponAttack', 'bonusWeaponDamage', 'bonusAc', 'bonusSavingThrow', 'bonusSpellAttack', 'bonusSpellSaveDc']
    .forEach(k => { if (e[k]) out[k] = e[k]; });
  if (e.ability) out.ability = e.ability;
  if (e.resist && e.resist.length) out.resist = e.resist;
  if (e.unarmoredOnly) out.unarmoredOnly = true;
  if (e.noShield) out.noShield = true;
  if (e.charges){ out.charges = e.charges; out.recharge = e.recharge; if (e.rechargeAmount) out.rechargeAmount = e.rechargeAmount; }
  return out;
}

// The part of a 2014 species' ability increases the player chooses:
// { from, count, amount } (Half-Elf: two +1s), or { flex: true } for the
// Multiverse-style species that leave all of it to you (+2 and +1, or three
// +1s). Null when it is all fixed.
function sktSpeciesAsiChoice(sp, sub, build){
  if (!sp) return null;
  if (build && build.speciesChoice && build.speciesChoice.customOrigin) return { flex: true };
  for (const list of [sub && sub.ability, sp.ability]){
    for (const a of (list || [])){
      if (a.choose) return { from: a.choose.from, count: a.choose.count || 1, amount: a.choose.amount || 1 };
    }
  }
  if (sp.lineage && !(sp.ability || []).length && !(sub && (sub.ability || []).length)) return { flex: true };
  return null;
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
  const parts = sktClassLevels(build, R);
  const by = {};
  const add = o => { if (by[o.name]) by[o.name].count += o.count; else by[o.name] = Object.assign({}, o); };
  if (parts.length === 1) _sktOptionalOne(build, R).forEach(add);
  else parts.forEach(p => _sktOptionalOne(sktClassView(build, R, p), R).forEach(add));
  // Fighting Initiate, Martial Adept, Eldritch Adept, Metamagic Adept.
  sktBuildFeatNames(build, R).forEach(n => {
    const f = sktRulesFeat(R, n);
    (f && f.optionalProgression || []).forEach(p => add({ name: p.name, count: +((p.progression || {})['*']) || 1, types: p.featureType || [], kind: 'optional' }));
  });
  return Object.values(by);
}
function _sktOptionalOne(build, R){
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
  [cls, sub].forEach(src => (src && src.featProgression || []).forEach(p => {
    if (!(p.category || []).some(c => /^FS/.test(c))) return;
    const n = read(p.progression);
    if (n > 0) out.push({ name: p.name, count: n, types: p.category, kind: 'feat' });
  }));
  return out;
}

if (typeof module !== 'undefined' && module.exports){
  module.exports = { sktSigned, sktDefineEffect, sktDefineChoice, sktBuildChoices, _fxPool, _fxAction, _fxNote, _fxCol, SKT_FEATURE_CHOICES,
                     sktRulesLoad, sktComputeCharacter, sktBuildEquipment, sktEquipmentOptions, sktBlankBuild, sktBuildTodo, sktBuildFeatures,
                     sktFeatureCoverage, sktRulesClass, sktRulesSubclass, sktSpellOptions, sktOptionalChoices,
                     sktSpellsMatching, sktExpandedSpells, sktPassiveGrants, sktSpellExcess,
                     sktDefineState, sktStateSig, sktStatesSyncAll, SKT_STATES, sktSaveAdvantages, sktFeatureSpellPicks, sktMagicalSecrets, sktUsesFromText, sktArcanumLevels, sktArcanumOptions, sktProfGrants, sktProfChoices, sktSubclassSpellPick, sktSubclassBlocks, sktSpeciesResistChoice, sktSpeciesResist, sktLanguageOptions, sktFeatSpellGrant, sktFeatSpells, sktSpeciesSpellGrant, sktSpeciesAsiChoice, sktSpellOnList,
                     sktRulesSpecies, sktRulesBackground, sktRulesFeat, sktRulesSpell,
                     sktMagicLoad, sktMagicBases, sktMagicMake, sktKitItems, sktGearLoad,
                     sktToolChoices, sktFeatPrereq, sktClassGold, sktFeatChoices, sktBookOk, sktOtherBooks, sktCoinText,
                     sktBuildBackground, sktBgNeedsAdapt, SKT_CUSTOM_BG, SKT_ABILITY_ORDER, sktAbilityBreakdown,
                     sktClassLevels, sktClassView, sktAsiSlots, sktIsMulticlass, sktMulticlassOk, sktMulticlassNeedText,
                     sktAsiLevels, sktBuildSpellcasting, sktBuildAbilities, sktClassColumn, sktRulesText,
                     SKT_SKILLS, SKT_ABS, SKT_FEATURE_EFFECTS };
}
