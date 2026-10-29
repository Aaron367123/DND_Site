// ============================================================
// HOMEBREW — the DM's own monsters, items and spells, everywhere
// ============================================================
// A goblin chief with a pet worg, a sword the party found in the barrow, a
// spell a hedge wizard taught them. Written here once, each is in the same
// catalogue as the books' own: search, the bestiary, the encounter builder
// and the combat tracker (monsters, and Wild Shape for beasts), the loot
// tracker and the shop (items), and the character builder's spell lists
// (spells, for the classes they're given to). Each is marked "Homebrew".
//
// Stored as 5etools-shaped records (the books' own format) in one synced key
// and run through the same converters the books go through (data-loader.js),
// so nothing downstream has to know an entry is homebrew. The DM writes
// them; every device gets them (players see homebrew in search and on their
// sheets). "Start from" copies any existing monster, item or spell to
// reskin.

const SKT_HB_KEY = 'skt-homebrew-v1';
const SKT_HB_SOURCE = 'Homebrew';
const SKT_HB_KINDS = [['monster', 'Monsters'], ['item', 'Items'], ['spell', 'Spells']];

function sktHomebrew(){
  let d = null; try { d = JSON.parse(localStorage.getItem(SKT_HB_KEY) || 'null'); } catch(e){}
  d = d && typeof d === 'object' ? d : {};
  return { monster: Array.isArray(d.monster) ? d.monster : [], item: Array.isArray(d.item) ? d.item : [], spell: Array.isArray(d.spell) ? d.spell : [] };
}
function _sktHbSave(d){
  try { localStorage.setItem(SKT_HB_KEY, JSON.stringify(d)); } catch(e){ if (typeof warnStorageFailure === 'function') warnStorageFailure('homebrew', e); }
  sktHomebrewApply();
}
function _sktHbId(){ return 'hb' + (typeof uid === 'function' ? uid() : Date.now().toString(36) + Math.random().toString(36).slice(2, 6)); }
function sktHomebrewSave(kind, model){
  const d = sktHomebrew(), list = d[kind];
  const m = Object.assign({}, model, { id: model.id || _sktHbId(), at: Date.now() });
  const i = list.findIndex(x => x.id === m.id);
  if (i >= 0) list[i] = m; else list.push(m);
  _sktHbSave(d);
  return m;
}
function sktHomebrewRemove(kind, id){ const d = sktHomebrew(); d[kind] = d[kind].filter(x => x.id !== id); _sktHbSave(d); }

// ── The editor's fields → the books' format ─────────────────────────────────
const _HB_SIZE = { Tiny: 'T', Small: 'S', Medium: 'M', Large: 'L', Huge: 'H', Gargantuan: 'G' };
const _HB_LIST = s => String(s || '').split(/\s*[,;]\s*/).map(x => x.trim()).filter(Boolean);
const _HB_PARAS = s => String(s || '').split(/\n+/).map(x => x.trim()).filter(Boolean);
// "Dex +5, Wis +3" → { dex: '+5', wis: '+3' }; "Perception +4" → { perception: '+4' }.
function _hbBonuses(s, abbrev){
  const out = {};
  _HB_LIST(s).forEach(p => {
    const m = /^(.+?)\s*([+-]\s*\d+)$/.exec(p); if (!m) return;
    let k = m[1].trim().toLowerCase();
    if (abbrev) k = k.slice(0, 3);
    out[k] = m[2].replace(/\s/g, '');
  });
  return out;
}
const _hbBlocks = rows => (rows || []).filter(r => r && (r.name || r.text)).map(r => ({ name: r.name || '', entries: _HB_PARAS(r.text) }));
function _hbMonsterRecord(m){
  const speed = {}; ['walk', 'fly', 'swim', 'climb', 'burrow'].forEach(k => { const v = +((m.speed || {})[k]); if (v) speed[k] = v; });
  if (!speed.walk && !Object.keys(speed).length) speed.walk = 30;
  const ab = m.ab || {};
  const rec = {
    name: m.name || 'Unnamed', source: SKT_HB_SOURCE, size: [_HB_SIZE[m.size] || 'M'], type: m.type || 'humanoid',
    alignment: m.alignment ? [m.alignment] : undefined,
    ac: [m.acFrom ? { ac: +m.ac || 10, from: [m.acFrom] } : (+m.ac || 10)],
    hp: { average: +m.hp || 1, formula: m.hitDice || '' }, speed,
    str: +ab.str || 10, dex: +ab.dex || 10, con: +ab.con || 10, int: +ab.int || 10, wis: +ab.wis || 10, cha: +ab.cha || 10,
    save: _hbBonuses(m.saves, true), skill: _hbBonuses(m.skills, false),
    resist: _HB_LIST(m.resist), immune: _HB_LIST(m.immune), vulnerable: _HB_LIST(m.vulnerable), conditionImmune: _HB_LIST(m.condImmune),
    senses: _HB_LIST(m.senses), passive: m.passive !== '' && m.passive != null ? +m.passive : 10 + Math.floor(((+ab.wis || 10) - 10) / 2),
    languages: m.languages ? [m.languages] : [], cr: String(m.cr || '0'),
    trait: _hbBlocks(m.traits), action: _hbBlocks(m.actions), bonus: _hbBlocks(m.bonus), reaction: _hbBlocks(m.reactions), legendary: _hbBlocks(m.legendary),
  };
  return rec;
}
const _HB_ITEM_TYPES = [['wondrous', 'Wondrous item'], ['M', 'Weapon (melee)'], ['R', 'Weapon (ranged)'], ['LA', 'Light armor'], ['MA', 'Medium armor'], ['HA', 'Heavy armor'],
  ['S', 'Shield'], ['P', 'Potion'], ['RG', 'Ring'], ['RD', 'Rod'], ['SC', 'Scroll'], ['ST', 'Staff'], ['WD', 'Wand'], ['G', 'Adventuring gear']];
const _HB_RARITY = ['none', 'common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact'];
const _HB_DMG = [['', '—'], ['B', 'bludgeoning'], ['P', 'piercing'], ['S', 'slashing'], ['A', 'acid'], ['C', 'cold'], ['F', 'fire'], ['O', 'force'], ['L', 'lightning'], ['N', 'necrotic'], ['I', 'poison'], ['Y', 'psychic'], ['R', 'radiant'], ['T', 'thunder']];
function _hbItemRecord(m){
  const rec = { name: m.name || 'Unnamed', source: SKT_HB_SOURCE, rarity: m.rarity || 'none', entries: _HB_PARAS(m.text) };
  if (m.kind === 'wondrous' || !m.kind) rec.wondrous = true; else rec.type = m.kind;
  if (m.attune) rec.reqAttune = m.attuneBy ? 'by ' + String(m.attuneBy).replace(/^by\s+/i, '') : true;
  if (+m.value) rec.value = Math.round(+m.value * 100);
  if (+m.weight) rec.weight = +m.weight;
  if (/^[MR]$/.test(m.kind || '') && m.dmg1){ rec.dmg1 = m.dmg1; if (m.dmgType) rec.dmgType = m.dmgType; rec.weaponCategory = 'martial'; rec.weapon = true; }
  if (m.properties) rec.property = _HB_LIST(m.properties);
  if (/^(LA|MA|HA|S)$/.test(m.kind || '') && +m.ac){ rec.ac = +m.ac; rec.armor = m.kind !== 'S'; }
  if (+m.charges) rec.charges = +m.charges;
  if (m.bonusWeapon) rec.bonusWeapon = '+' + String(m.bonusWeapon).replace(/^\+/, '');
  if (m.bonusAc) rec.bonusAc = '+' + String(m.bonusAc).replace(/^\+/, '');
  return rec;
}
const _HB_SCHOOLS = [['A', 'Abjuration'], ['C', 'Conjuration'], ['D', 'Divination'], ['E', 'Enchantment'], ['V', 'Evocation'], ['I', 'Illusion'], ['N', 'Necromancy'], ['T', 'Transmutation']];
const _HB_CLASSES = ['Artificer', 'Bard', 'Cleric', 'Druid', 'Paladin', 'Ranger', 'Sorcerer', 'Warlock', 'Wizard'];
function _hbSpellRecord(m){
  const unit = m.timeUnit || 'action';
  const amt = +m.rangeAmt || 0, area = m.area && m.area !== 'none' ? m.area : '';
  let range;
  if (m.rangeKind === 'self') range = area ? { type: area, distance: { type: 'feet', amount: +m.areaSize || 0 } } : { type: 'point', distance: { type: 'self' } };
  else if (m.rangeKind === 'feet' || m.rangeKind === 'miles') range = { type: 'point', distance: { type: m.rangeKind, amount: amt } };
  else range = { type: m.rangeKind === 'special' ? 'special' : 'point', distance: { type: m.rangeKind || 'touch' } };
  const dk = m.durKind || 'instant';
  const duration = dk === 'instant' ? [{ type: 'instant' }] : dk === 'permanent' ? [{ type: 'permanent', ends: ['dispel'] }] : dk === 'special' ? [{ type: 'special' }]
    : [{ type: 'timed', duration: { type: dk, amount: +m.durAmt || 1 }, concentration: !!m.conc || undefined }];
  const rec = {
    name: m.name || 'Unnamed', source: SKT_HB_SOURCE, level: +m.level || 0, school: m.school || 'V',
    time: [Object.assign({ number: +m.timeN || 1, unit }, unit === 'reaction' && m.timeCond ? { condition: m.timeCond } : {})],
    range, components: Object.assign({}, m.v ? { v: true } : {}, m.s ? { s: true } : {}, m.m ? { m: m.material || true } : {}),
    duration, meta: m.ritual ? { ritual: true } : undefined, entries: _HB_PARAS(m.text),
    entriesHigherLevel: m.higher ? [{ type: 'entries', name: +m.level ? 'Using a Higher-Level Spell Slot' : 'Cantrip Upgrade', entries: _HB_PARAS(m.higher) }] : undefined,
    classes: { fromClassList: (m.classes || []).map(c => ({ name: c, source: 'XPHB' })) },
  };
  return rec;
}
function sktHomebrewRecord(kind, m){ return kind === 'monster' ? _hbMonsterRecord(m) : kind === 'item' ? _hbItemRecord(m) : _hbSpellRecord(m); }

// ── Into the catalogue ───────────────────────────────────────────────────────
// Rows shaped like data-loader's own. Replaced wholesale on every change,
// and any left in a cached index from before are dropped first.
function _hbRow(kind, m){
  const rec = sktHomebrewRecord(kind, m), slug = 'hb-' + m.id;
  if (kind === 'monster'){
    const r = _convertMonster(rec); r.index = slug;
    return { cat: 'monster', name: rec.name, _slug: slug, _homebrew: m.id, meta: (r.size + ' ' + r.type + ' · CR ' + r.challenge_rating).trim(), _source: SKT_HB_SOURCE,
      hp: r.hit_points, ac: (r.armor_class && r.armor_class[0] && r.armor_class[0].value) || 10,
      speed: Object.entries(r.speed || {}).map(([k, v]) => k + ' ' + v).join(', ') || '—',
      str: r.strength, dex: r.dexterity, con: r.constitution, int: r.intelligence, wis: r.wisdom, cha: r.charisma, _img: null, _raw: r };
  }
  if (kind === 'spell'){
    const r = _convertSpell(rec); r.index = slug; r._src = rec;
    return { cat: 'spell', name: rec.name, _slug: slug, _homebrew: m.id, meta: ((r.level === 0 ? 'Cantrip' : 'Level ' + r.level) + ' ' + r.school.name).trim(), _source: SKT_HB_SOURCE,
      cast: r.casting_time, range: r.range, components: r.components.join(', ') + (r.material ? ' (' + r.material + ')' : ''), duration: r.duration, desc: r.desc.join('\n\n'), _raw: r };
  }
  const r = _convertItem(rec); r.index = slug;
  const magic = r.rarity && r.rarity !== 'none' && r.rarity !== 'unknown';
  const label = (_HB_ITEM_TYPES.find(t => t[0] === (m.kind || 'wondrous')) || [, 'Item'])[1];
  return { cat: 'item', name: rec.name, _slug: slug, _homebrew: m.id, meta: magic ? r.rarity.charAt(0).toUpperCase() + r.rarity.slice(1) + (r.requires_attunement ? ' · Attunement' : '') : label, _source: SKT_HB_SOURCE, _raw: r };
}
function sktHomebrewApply(){
  const d = sktHomebrew();
  // The search catalogue.
  if (typeof _5eData !== 'undefined' && Array.isArray(_5eData) && _5eData.length && typeof _convertMonster === 'function'){
    for (let i = _5eData.length - 1; i >= 0; i--) if (_5eData[i] && (_5eData[i]._homebrew || _5eData[i]._source === SKT_HB_SOURCE)) _5eData.splice(i, 1);
    SKT_HB_KINDS.forEach(([k]) => d[k].forEach(m => { try { _5eData.push(_hbRow(k, m)); } catch(e){ console.warn('[homebrew]', k, m && m.name, e); } }));
    // Search keeps its own copy of the catalogue (search.js); start it again.
    if (typeof _poolCache !== 'undefined') _poolCache = null;
  }
  // The rules the builder and sheets use: spells on their classes' lists,
  // magic items in the sheet's item list.
  if (typeof _sktRulesReady !== 'undefined') Object.values(_sktRulesReady).forEach(R => sktHomebrewIntoRules(R));
  if (typeof _sktMagicCache !== 'undefined') Object.keys(_sktMagicCache).forEach(ed => Promise.resolve(_sktMagicCache[ed]).then(list => sktHomebrewIntoMagic(list), () => {}));
  try { const P = panelDefs.homebrew; if (P && P._body) P._render(); } catch(e){}
}
function sktHomebrewIntoRules(R){
  if (!R || !Array.isArray(R.spells)) return R;
  for (let i = R.spells.length - 1; i >= 0; i--) if (R.spells[i].homebrew) R.spells.splice(i, 1);
  sktHomebrew().spell.forEach(m => {
    const s = _hbSpellRecord(m), cls = (m.classes || []).slice();
    R.spells.push({ name: s.name, level: s.level, school: s.school, source: SKT_HB_SOURCE, core: true, superseded: false, homebrew: true,
      classes: cls, classesAll: cls, time: s.time, range: s.range, duration: s.duration, components: s.components || null,
      higher: s.entriesHigherLevel || null, concentration: !!m.conc && !/instant|permanent|special/.test(m.durKind || 'instant'), ritual: !!m.ritual,
      damageInflict: null, savingThrow: null, spellAttack: null, scalingLevelDice: null, entries: s.entries });
  });
  return R;
}
function sktHomebrewIntoMagic(list){
  if (!Array.isArray(list) || typeof _sktMagicEntry !== 'function') return list;
  for (let i = list.length - 1; i >= 0; i--) if (list[i] && list[i].homebrew) list.splice(i, 1);
  sktHomebrew().item.filter(m => m.rarity && m.rarity !== 'none').forEach(m => {
    try { const e = _sktMagicEntry(_hbItemRecord(m), 'item'); e.homebrew = true; list.push(e); } catch(err){}
  });
  list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return list;
}
if (typeof on5eLoaded === 'function') on5eLoaded(() => { try { sktHomebrewApply(); } catch(e){ console.warn('[homebrew] apply', e); } });

// ── An existing entry → the editor's fields ("Start from") ──────────────────
function _hbNum(s){ const n = parseInt(String(s || ''), 10); return isNaN(n) ? '' : n; }
function sktHomebrewFromCatalog(kind, row){
  const r = (row && row._raw) || {}, name = (row && row.name || '') + ' (homebrew)';
  if (kind === 'monster'){
    const sp = {}; Object.entries(r.speed || {}).forEach(([k, v]) => { sp[k] = _hbNum(v); });
    const prof = (r.proficiencies || []);
    const pick = re => prof.filter(p => re.test(p.proficiency && p.proficiency.name || '')).map(p => p.proficiency.name.replace(re, '') + ' ' + (p.value >= 0 ? '+' : '') + p.value).join(', ');
    const senses = Object.entries(r.senses || {}).filter(([k]) => k !== 'passive_perception').map(([k, v]) => k.replace(/_/g, ' ') + ' ' + v).join(', ');
    const rows = a => (a || []).map(x => ({ name: x.name || '', text: x.desc || '' }));
    return { name, size: r.size || 'Medium', type: r.type || '', alignment: '', ac: (r.armor_class && r.armor_class[0] && r.armor_class[0].value) || 10,
      acFrom: (r.armor_class && r.armor_class[0] && r.armor_class[0].type) || '', hp: r.hit_points || 1, hitDice: r.hit_dice || '', speed: sp,
      ab: { str: r.strength, dex: r.dexterity, con: r.constitution, int: r.intelligence, wis: r.wisdom, cha: r.charisma },
      saves: pick(/^Saving Throw:\s*/), skills: pick(/^Skill:\s*/),
      resist: (r.damage_resistances || []).join(', '), immune: (r.damage_immunities || []).join(', '), vulnerable: (r.damage_vulnerabilities || []).join(', '),
      condImmune: (r.condition_immunities || []).map(c => c.name || c).join(', '), senses, passive: (r.senses || {}).passive_perception ?? '',
      languages: r.languages || '', cr: r.challenge_rating || '0',
      traits: rows(r.special_abilities), actions: rows(r.actions), bonus: rows(r.bonus_actions), reactions: rows(r.reactions), legendary: rows(r.legendary_actions) };
  }
  if (kind === 'item'){
    const t = String(r.type || '').split('|')[0];
    return { name, kind: _HB_ITEM_TYPES.some(x => x[0] === t) ? t : 'wondrous', rarity: _HB_RARITY.includes(r.rarity) ? r.rarity : 'none',
      attune: !!r.reqAttune, attuneBy: typeof r.reqAttune === 'string' ? r.reqAttune.replace(/^by\s+/i, '') : '', value: r.value_cp ? r.value_cp / 100 : '',
      weight: r.weight || '', dmg1: r.dmg1 || '', dmgType: r.dmgType || '', properties: (r.property || []).map(p => String(p).split('|')[0]).join(', '),
      ac: r.ac || '', charges: '', text: (r.desc || []).join('\n') };
  }
  // A spell: the rules' own record when there is one (structured), else the
  // catalogue's text.
  const R = typeof _sktRulesReady !== 'undefined' && (_sktRulesReady['2024'] || _sktRulesReady['2014']);
  const s = R && typeof sktRulesSpell === 'function' ? sktRulesSpell(R, row.name) : null;
  const m = { name, level: r.level || 0, school: s ? s.school : (_HB_SCHOOLS.find(x => x[1] === (r.school && r.school.name)) || ['V'])[0], timeN: 1, timeUnit: 'action', timeCond: '',
    rangeKind: 'feet', rangeAmt: '', area: 'none', areaSize: '', v: (r.components || []).includes('V'), s: (r.components || []).includes('S'), m: (r.components || []).includes('M'),
    material: r.material || '', durKind: 'instant', durAmt: '', conc: !!r.concentration, ritual: !!r.ritual,
    classes: (r.classes || []).map(c => typeof c === 'string' ? c : c.name).filter(c => _HB_CLASSES.includes(c)),
    text: (r.desc || []).join('\n'), higher: (r.higher_level || []).join('\n') };
  if (s){
    const t = [].concat(s.time || [])[0] || {}; m.timeN = t.number || 1; m.timeUnit = t.unit === 'bonus' ? 'bonus' : t.unit || 'action'; m.timeCond = t.condition || '';
    const rg = s.range || {}, dist = rg.distance || {};
    if (rg.type === 'point'){ m.rangeKind = dist.type === 'feet' || dist.type === 'miles' ? dist.type : dist.type || 'touch'; m.rangeAmt = dist.amount || ''; }
    else if (rg.type){ m.rangeKind = 'self'; m.area = rg.type; m.areaSize = dist.amount || ''; }
    const du = [].concat(s.duration || [])[0] || {};
    m.durKind = du.type === 'timed' ? (du.duration && du.duration.type) || 'minute' : du.type === 'permanent' ? 'permanent' : du.type === 'special' ? 'special' : 'instant';
    m.durAmt = du.duration ? du.duration.amount : ''; m.conc = !!du.concentration;
    if (typeof sktRulesText === 'function'){ m.text = sktRulesText(s.entries || []); m.higher = s.higher ? sktRulesText(s.higher) : m.higher; }
    if (!m.classes.length) m.classes = (s.classesAll || []).filter(c => _HB_CLASSES.includes(c));
  }
  return m;
}

// ── The DM's window ──────────────────────────────────────────────────────────
// Each kind's form: [key, type, label, extra]. Types: text, num, area (a
// textarea), sel (options), chk, speed, ab (the six abilities), rows (named
// blocks: traits, actions…), classes.
const _HB_FORMS = {
  monster: [
    ['name', 'text', 'Name', 'Goblin Chief'], ['size', 'sel', 'Size', Object.keys(_HB_SIZE).map(s => [s, s])], ['type', 'text', 'Type', 'humanoid (goblinoid)'],
    ['alignment', 'text', 'Alignment', 'neutral evil'], ['ac', 'num', 'Armor Class'], ['acFrom', 'text', 'Armor', 'chain shirt, shield'],
    ['hp', 'num', 'Hit points'], ['hitDice', 'text', 'Hit dice', '6d6 + 6'], ['cr', 'text', 'Challenge', '1'], ['speed', 'speed', 'Speed (feet)'], ['ab', 'ab', 'Abilities'],
    ['saves', 'text', 'Saving throws', 'Dex +4, Wis +2'], ['skills', 'text', 'Skills', 'Intimidation +4, Stealth +6'],
    ['resist', 'text', 'Damage resistances', 'cold'], ['immune', 'text', 'Damage immunities', 'poison'], ['vulnerable', 'text', 'Damage vulnerabilities', ''],
    ['condImmune', 'text', 'Condition immunities', 'poisoned'], ['senses', 'text', 'Senses', 'darkvision 60 ft.'], ['passive', 'num', 'Passive Perception'],
    ['languages', 'text', 'Languages', 'Common, Goblin'],
    ['traits', 'rows', 'Traits'], ['actions', 'rows', 'Actions'], ['bonus', 'rows', 'Bonus actions'], ['reactions', 'rows', 'Reactions'], ['legendary', 'rows', 'Legendary actions'],
  ],
  item: [
    ['name', 'text', 'Name', 'Barrow-Blade'], ['kind', 'sel', 'Type', _HB_ITEM_TYPES], ['rarity', 'sel', 'Rarity', _HB_RARITY.map(r => [r, r === 'none' ? 'not magic' : r])],
    ['attune', 'chk', 'Requires attunement'], ['attuneBy', 'text', 'Attunement by', 'a paladin'], ['value', 'num', 'Value (gp)'], ['weight', 'num', 'Weight (lb)'],
    ['dmg1', 'text', 'Damage', '1d8'], ['dmgType', 'sel', 'Damage type', _HB_DMG], ['properties', 'text', 'Properties', 'versatile (1d10)'],
    ['bonusWeapon', 'num', 'Attack and damage bonus'], ['ac', 'num', 'AC'], ['bonusAc', 'num', 'AC bonus'], ['charges', 'num', 'Charges'],
    ['text', 'area', 'What it does', 'While holding it, you…'],
  ],
  spell: [
    ['name', 'text', 'Name', 'Hedge Warding'], ['level', 'sel', 'Level', [[0, 'Cantrip']].concat([1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => [n, 'Level ' + n]))], ['school', 'sel', 'School', _HB_SCHOOLS],
    ['timeN', 'num', 'Casting time'], ['timeUnit', 'sel', 'Unit', [['action', 'action'], ['bonus', 'bonus action'], ['reaction', 'reaction'], ['minute', 'minute'], ['hour', 'hour']]],
    ['timeCond', 'text', 'Reaction trigger', 'which you take when…'],
    ['rangeKind', 'sel', 'Range', [['feet', 'feet'], ['miles', 'miles'], ['self', 'self'], ['touch', 'touch'], ['sight', 'sight'], ['unlimited', 'unlimited'], ['special', 'special']]], ['rangeAmt', 'num', 'Distance'],
    ['area', 'sel', 'Area (self)', [['none', '—'], ['cone', 'cone'], ['line', 'line'], ['sphere', 'sphere'], ['cube', 'cube'], ['emanation', 'emanation'], ['radius', 'radius']]], ['areaSize', 'num', 'Area size (ft)'],
    ['v', 'chk', 'Verbal'], ['s', 'chk', 'Somatic'], ['m', 'chk', 'Material'], ['material', 'text', 'Material component', 'a sprig of mistletoe'],
    ['durKind', 'sel', 'Duration', [['instant', 'instantaneous'], ['round', 'rounds'], ['minute', 'minutes'], ['hour', 'hours'], ['day', 'days'], ['permanent', 'until dispelled'], ['special', 'special']]], ['durAmt', 'num', 'How many'],
    ['conc', 'chk', 'Concentration'], ['ritual', 'chk', 'Ritual'], ['classes', 'classes', 'On the spell lists of'],
    ['text', 'area', 'What it does', 'You touch a willing creature…'], ['higher', 'area', 'At higher levels', 'The duration doubles for each slot level above 1.'],
  ],
};
const _HB_BLANK = {
  monster: () => ({ size: 'Medium', type: 'humanoid', ac: 12, hp: 11, hitDice: '2d8 + 2', cr: '1/4', speed: { walk: 30 }, ab: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, actions: [{ name: 'Club', text: 'Melee Attack Roll: +2, reach 5 ft. Hit: 2 (1d4) Bludgeoning damage.' }] }),
  item: () => ({ kind: 'wondrous', rarity: 'uncommon' }),
  spell: () => ({ level: 1, school: 'A', timeN: 1, timeUnit: 'action', rangeKind: 'feet', rangeAmt: 30, v: true, s: true, durKind: 'instant', classes: ['Wizard'] }),
};

registerPanel('homebrew', {
  title: 'Homebrew', icon: '⚗',
  _kind: 'monster', _edit: null, _q: '',
  mount(body){ this._body = body; this._render(); },
  unmount(){ this._body = null; },
  _render(){
    const b = this._body; if (!b) return;
    const d = sktHomebrew(), list = d[this._kind].slice().sort((x, y) => String(x.name).localeCompare(String(y.name)));
    const tabs = '<div class="lib-tabs hb-tabs" role="tablist">' + SKT_HB_KINDS.map(([k, l]) => '<button class="lib-tab' + (k === this._kind ? ' on' : '') + '" role="tab" data-hb-kind="' + k + '">' + l + ' <small>' + d[k].length + '</small></button>').join('') + '</div>';
    if (this._edit){ b.innerHTML = '<div class="hb">' + tabs + this._formHtml() + '</div>'; this._wire(b); return; }
    const one = { monster: 'monster', item: 'item', spell: 'spell' }[this._kind];
    b.innerHTML = '<div class="hb">' + tabs + '<div class="qst-bar"><button class="btn primary small" data-hb-new>+ New ' + one + '</button>'
      + '<span class="hb-from"><input class="input" data-hb-q placeholder="Start from an existing ' + one + '…" value="' + esc(this._q) + '" autocomplete="off"></span></div>'
      + '<div class="hb-results"></div>'
      + '<div class="hb-list">' + (list.length ? list.map(m => '<button class="hb-row" data-hb-open="' + esc(m.id) + '"><b>' + esc(m.name || 'Unnamed') + '</b><small>' + esc(this._sub(m)) + '</small></button>').join('')
        : emptyState({ icon: 'i-flask', title: 'No homebrew ' + one + 's yet', hint: 'Make one from scratch, or start from an existing ' + one + ' and change it.', roomy: true })) + '</div></div>';
    this._wire(b);
    if (this._q) this._search(b);
  },
  _sub(m){
    if (this._kind === 'monster') return [m.size, m.type, 'CR ' + (m.cr || '0')].filter(Boolean).join(' · ');
    if (this._kind === 'item') return [(_HB_ITEM_TYPES.find(t => t[0] === (m.kind || 'wondrous')) || [, ''])[1], m.rarity && m.rarity !== 'none' ? m.rarity : '', m.attune ? 'attunement' : ''].filter(Boolean).join(' · ');
    return (+m.level ? 'Level ' + m.level : 'Cantrip') + ' ' + ((_HB_SCHOOLS.find(s => s[0] === m.school) || [, ''])[1]).toLowerCase() + ((m.classes || []).length ? ' · ' + m.classes.join(', ') : '');
  },
  _fieldHtml([k, type, label, extra]){
    const m = this._edit, v = m[k];
    const id = 'hbf-' + k;
    if (type === 'speed') return '<div class="hb-f hb-wide"><span>' + label + '</span><div class="hb-grid5">' + ['walk', 'fly', 'swim', 'climb', 'burrow'].map(s => '<label><small>' + s + '</small><input class="input" type="number" min="0" step="5" data-hb-speed="' + s + '" value="' + esc((v || {})[s] ?? '') + '"></label>').join('') + '</div></div>';
    if (type === 'ab') return '<div class="hb-f hb-wide"><span>' + label + '</span><div class="hb-grid6">' + ['str', 'dex', 'con', 'int', 'wis', 'cha'].map(s => '<label><small>' + s.toUpperCase() + '</small><input class="input" type="number" min="1" max="30" data-hb-ab="' + s + '" value="' + esc((v || {})[s] ?? 10) + '"></label>').join('') + '</div></div>';
    if (type === 'rows') return '<div class="hb-f hb-wide"><span>' + label + '</span>' + (v || []).map((r, i) => '<div class="hb-block"><input class="input" data-hb-row="' + k + ':' + i + ':name" value="' + esc(r.name || '') + '" placeholder="Name">'
        + '<textarea class="input" rows="2" data-hb-row="' + k + ':' + i + ':text" placeholder="What it does">' + esc(r.text || '') + '</textarea><button class="btn small" data-hb-rowdel="' + k + ':' + i + '" aria-label="Remove">✕</button></div>').join('')
      + '<button class="btn small" data-hb-rowadd="' + k + '">+ Add</button></div>';
    if (type === 'classes') return '<div class="hb-f hb-wide"><span>' + label + '</span><div class="hb-checks">' + _HB_CLASSES.map(c => '<label class="cb-inline"><input type="checkbox" data-hb-class="' + c + '"' + ((v || []).includes(c) ? ' checked' : '') + '> ' + c + '</label>').join('') + '</div></div>';
    if (type === 'chk') return '<label class="hb-f hb-chk"><input type="checkbox" data-hb-f="' + k + '"' + (v ? ' checked' : '') + '> ' + label + '</label>';
    if (type === 'sel') return '<label class="hb-f"><span>' + label + '</span><select class="cb-sel" data-hb-f="' + k + '">' + extra.map(([ov, ol]) => '<option value="' + esc(ov) + '"' + (String(v ?? '') === String(ov) ? ' selected' : '') + '>' + esc(ol) + '</option>').join('') + '</select></label>';
    if (type === 'area') return '<label class="hb-f hb-wide"><span>' + label + '</span><textarea class="input" rows="4" data-hb-f="' + k + '" placeholder="' + esc(extra || '') + '">' + esc(v || '') + '</textarea></label>';
    return '<label class="hb-f' + (k === 'name' ? ' hb-wide' : '') + '"><span>' + label + '</span><input class="input" id="' + id + '"' + (type === 'num' ? ' type="number"' : '') + ' data-hb-f="' + k + '" value="' + esc(v ?? '') + '" placeholder="' + esc(extra || '') + '"></label>';
  },
  _formHtml(){
    const m = this._edit, isNew = !sktHomebrew()[this._kind].some(x => x.id === m.id);
    return '<div class="hb-form">' + _HB_FORMS[this._kind].map(f => this._fieldHtml(f)).join('') + '</div>'
      + '<div class="hb-foot"><button class="btn" data-hb-cancel>' + (isNew ? 'Cancel' : 'Back') + '</button>'
      + (isNew ? '' : '<button class="btn danger" data-hb-del>Delete</button>')
      + '<span class="hb-note">' + (isNew ? '' : 'Saved as you type. ') + 'Everywhere as “' + esc(m.name || 'Unnamed') + '” · Homebrew</span>'
      + (isNew ? '<button class="btn primary" data-hb-save>Save</button>' : '') + '</div>';
  },
  // A change on an existing entry saves at once (and spreads to the
  // catalogue); a new one waits for Save.
  _changed(){
    if (sktHomebrew()[this._kind].some(x => x.id === this._edit.id)) sktHomebrewSave(this._kind, this._edit);
    const n = this._body && this._body.querySelector('.hb-note'); if (n && this._edit) n.textContent = n.textContent.replace(/“.*”/, '“' + (this._edit.name || 'Unnamed') + '”');
  },
  _search(b){
    const box = b.querySelector('.hb-results'), q = this._q.trim().toLowerCase();
    if (!box) return;
    if (!q){ box.innerHTML = ''; return; }
    if (typeof _5eData === 'undefined' || !_5eLoaded){ box.innerHTML = '<div class="msg-empty">The books are still loading…</div>'; return; }
    const hits = _5eData.filter(r => r.cat === this._kind && !r._homebrew && String(r.name).toLowerCase().includes(q))
      .sort((x, y) => (String(x.name).toLowerCase().startsWith(q) ? 0 : 1) - (String(y.name).toLowerCase().startsWith(q) ? 0 : 1) || String(x.name).localeCompare(String(y.name))).slice(0, 12);
    box.innerHTML = hits.length ? hits.map(r => '<button class="hb-row" data-hb-from="' + esc(r._slug) + '"><b>' + esc(r.name) + '</b><small>' + esc((r.meta || '') + ' · ' + (typeof _formatSource === 'function' ? _formatSource(r._source || '') : r._source || '')) + '</small></button>').join('')
      : '<div class="msg-empty">Nothing matches.</div>';
    box.querySelectorAll('[data-hb-from]').forEach(x => x.addEventListener('click', () => {
      const row = _5eData.find(r => r._slug === x.dataset.hbFrom && r.cat === this._kind);
      if (!row) return;
      this._edit = sktHomebrewFromCatalog(this._kind, row); this._q = ''; this._render();
    }));
  },
  _wire(b){
    b.querySelectorAll('[data-hb-kind]').forEach(x => x.addEventListener('click', () => { this._kind = x.dataset.hbKind; this._edit = null; this._q = ''; this._render(); }));
    if (!this._edit){
      b.querySelector('[data-hb-new]').addEventListener('click', () => { this._edit = _HB_BLANK[this._kind](); this._render(); const n = b.querySelector('[data-hb-f="name"]'); if (n) n.focus(); });
      const q = b.querySelector('[data-hb-q]');
      q.addEventListener('input', () => { this._q = q.value; this._search(b); });
      b.querySelectorAll('[data-hb-open]').forEach(x => x.addEventListener('click', () => { const m = sktHomebrew()[this._kind].find(y => y.id === x.dataset.hbOpen); if (m){ this._edit = JSON.parse(JSON.stringify(m)); this._render(); } }));
      return;
    }
    const m = this._edit;
    b.querySelectorAll('[data-hb-f]').forEach(x => x.addEventListener(x.type === 'checkbox' || x.tagName === 'SELECT' ? 'change' : 'input', () => {
      m[x.dataset.hbF] = x.type === 'checkbox' ? x.checked : x.value; this._changed();
    }));
    b.querySelectorAll('[data-hb-speed]').forEach(x => x.addEventListener('input', () => { m.speed = Object.assign({}, m.speed, { [x.dataset.hbSpeed]: x.value }); this._changed(); }));
    b.querySelectorAll('[data-hb-ab]').forEach(x => x.addEventListener('input', () => { m.ab = Object.assign({}, m.ab, { [x.dataset.hbAb]: x.value }); this._changed(); }));
    b.querySelectorAll('[data-hb-class]').forEach(x => x.addEventListener('change', () => {
      const set = new Set(m.classes || []); if (x.checked) set.add(x.dataset.hbClass); else set.delete(x.dataset.hbClass);
      m.classes = _HB_CLASSES.filter(c => set.has(c)); this._changed();
    }));
    b.querySelectorAll('[data-hb-row]').forEach(x => x.addEventListener('input', () => {
      const [k, i, f] = x.dataset.hbRow.split(':'); m[k] = (m[k] || []).slice(); m[k][+i] = Object.assign({}, m[k][+i], { [f]: x.value }); this._changed();
    }));
    b.querySelectorAll('[data-hb-rowadd]').forEach(x => x.addEventListener('click', () => { const k = x.dataset.hbRowadd; m[k] = (m[k] || []).concat([{ name: '', text: '' }]); this._changed(); this._render(); }));
    b.querySelectorAll('[data-hb-rowdel]').forEach(x => x.addEventListener('click', () => { const [k, i] = x.dataset.hbRowdel.split(':'); m[k] = (m[k] || []).filter((_, j) => j !== +i); this._changed(); this._render(); }));
    b.querySelector('[data-hb-cancel]').addEventListener('click', () => { this._edit = null; this._render(); });
    b.querySelector('[data-hb-save]')?.addEventListener('click', () => {
      if (!String(m.name || '').trim()){ if (typeof showToast === 'function') showToast('Give it a name first'); b.querySelector('[data-hb-f="name"]')?.focus(); return; }
      const saved = sktHomebrewSave(this._kind, m); this._edit = null; this._render();
      if (typeof showToast === 'function') showToast(saved.name + ' is in search' + (this._kind === 'monster' ? ', the bestiary and the encounter builder' : this._kind === 'item' ? ', loot and the shop' : ' and on its classes’ spell lists'));
    });
    b.querySelector('[data-hb-del]')?.addEventListener('click', () => {
      const go = () => { sktHomebrewRemove(this._kind, m.id); this._edit = null; this._render(); };
      if (typeof showConfirm === 'function') showConfirm('Delete “' + (m.name || 'this') + '”? Anything already using it keeps its copy.', { title: 'Delete homebrew', confirmLabel: 'Delete', danger: true }).then(ok => { if (ok) go(); });
      else go();
    });
  },
});
