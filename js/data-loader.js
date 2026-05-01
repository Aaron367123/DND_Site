// ============================================================
// DATA LOADER — 5etools JSON → internal search format
// ============================================================
// Dynamically discovers bestiary and spell files via index.json.
// Also loads magic items (items.json) and feats (feats.json).
// Missing files (404) are silently skipped.

const _CONDITION_FILES = [
  'data/conditionsdiseases.json',
];

// ─── Tag stripper ──────────────────────────────────────────────────────────────
// Converts 5etools inline tags like {@damage 8d6} → plain text
function _stripTags(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/\{@atk mw,rw\}/g,   'Melee or Ranged Weapon Attack:')
    .replace(/\{@atk mw\}/g,       'Melee Weapon Attack:')
    .replace(/\{@atk rw\}/g,       'Ranged Weapon Attack:')
    .replace(/\{@atk ms\}/g,       'Melee Spell Attack:')
    .replace(/\{@atk rs\}/g,       'Ranged Spell Attack:')
    .replace(/\{@h\}/g,            'Hit: ')
    .replace(/\{@hit (\d+)\}/g,   '+$1')
    .replace(/\{@dc (\d+)\}/g,    'DC $1')
    .replace(/\{@recharge ([^}]+)\}/g, '(Recharge $1–6)')
    .replace(/\{@recharge\}/g,         '(Recharge 6)')
    .replace(/\{@chance (\d+)[^}]*\}/g, '$1%')
    .replace(/\{@(?:damage|dice|scaledice|scaledamage)\s+([^|}]+)[^}]*\}/g, '$1')
    .replace(/\{@(?:condition|spell|creature|item|sense|skill|action|ability|race|class|feat|background|disease|status|object|vehicle|reward|hazard|encounter|table|area|filter)\s+([^|}]+)[^}]*\}/gi, (_, p) => p.charAt(0).toUpperCase()+p.slice(1))
    .replace(/\{@(?:b|bold)\s+([^}]+)\}/g,   '$1')
    .replace(/\{@(?:i|italic)\s+([^}]+)\}/g, '$1')
    .replace(/\{@(?:s|strike|u|sup|sub|kbd|code)\s+([^}]+)\}/g, '$1')
    .replace(/\{@note\s+([^}]+)\}/g,  '($1)')
    .replace(/\{@quickref\s+([^|}]+)[^}]*\}/g, '$1')
    .replace(/\{@5etools\s+([^|}]+)[^}]*\}/g, '$1')
    .replace(/\{@link\s+([^|}]+)[^}]*\}/g, '$1')
    .replace(/\{@\w+\s+([^|}]+)[^}]*\}/g, '$1') // generic: grab text before first |
    .replace(/\{@[^}]*\}/g, '');                 // catch-all: remove anything remaining
}

// ─── Entries parser ────────────────────────────────────────────────────────────
function _parseEntries(entries) {
  if (!entries) return '';
  if (typeof entries === 'string') return _stripTags(entries);
  if (!Array.isArray(entries)) return '';
  return entries.map(e => {
    if (typeof e === 'string') return _stripTags(e);
    if (!e || typeof e !== 'object') return '';
    switch (e.type) {
      case 'entries':
      case 'section':
        return (e.name ? e.name + '.\n' : '') + _parseEntries(e.entries);
      case 'list':
        return (e.items||[]).map(i => '• ' + (typeof i==='string' ? _stripTags(i) : _parseEntries(i.entries||[i]))).join('\n');
      case 'table':
        return ''; // skip tables
      case 'item':
        return (e.name ? e.name + ': ' : '') + _parseEntries(e.entries || (e.entry ? [e.entry] : []));
      case 'inset':
      case 'insetReadaloud':
      case 'quote':
        return _parseEntries(e.entries || []);
      case 'abilityDc':
        return `Spell save DC = 8 + proficiency bonus + ${e.attributes?.[0]||'ability'} modifier`;
      case 'abilityAttackMod':
        return `Spell attack modifier = proficiency bonus + ${e.attributes?.[0]||'ability'} modifier`;
      default:
        return _parseEntries(e.entries || []);
    }
  }).filter(Boolean).join('\n');
}

// ─── Conversion helpers ────────────────────────────────────────────────────────
const _SCHOOL = {A:'Abjuration',C:'Conjuration',D:'Divination',E:'Enchantment',V:'Evocation',I:'Illusion',N:'Necromancy',T:'Transmutation',P:'Psionic'};
const _SIZE   = {F:'Fine',D:'Diminutive',T:'Tiny',S:'Small',M:'Medium',L:'Large',H:'Huge',G:'Gargantuan',C:'Colossal'};
const _CR_XP  = {'0':10,'1/8':25,'1/4':50,'1/2':100,'1':200,'2':450,'3':700,'4':1100,'5':1800,'6':2300,'7':2900,'8':3900,'9':5000,'10':5900,'11':7200,'12':8400,'13':10000,'14':11500,'15':13000,'16':15000,'17':18000,'18':20000,'19':22000,'20':25000,'21':33000,'22':41000,'23':50000,'24':62000,'25':75000,'26':90000,'27':105000,'28':120000,'29':135000,'30':155000};

function _toIndex(name) { return (name||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
function _parseCR(cr)   { return cr==null?'?':(typeof cr==='object'?String(cr.cr??'?'):String(cr)); }
function _crToXP(cr)    { const k=typeof cr==='object'?cr.cr:String(cr||0); return _CR_XP[k]||0; }
function _parseType(t)  { if(!t)return''; if(typeof t==='string')return t; return (t.swarmSize?`swarm of ${_SIZE[t.swarmSize]||t.swarmSize} ${t.type}s`:t.type||'')+(t.tags?.length?` (${t.tags.join(', ')})`:'')||''; }

function _parseSpeed(speed) {
  if (!speed) return {};
  return Object.fromEntries(
    Object.entries(speed)
      .filter(([k]) => k!=='canHover' && k!=='choose')
      .map(([k,v]) => [k, (typeof v==='number'?v:(v?.number??0))+' ft.'])
  );
}

function _parseAC(ac) {
  if (!ac?.length) return [{value:10, type:''}];
  const a = ac[0];
  return typeof a==='number' ? [{value:a,type:''}] : [{value:a.ac||10, type:(a.from||[]).join(', ')}];
}

function _parseSenses(senses, passive) {
  const r = {};
  (senses||[]).forEach(s => {
    const m = s.match(/^([\w ]+?)\s+(\d+)\s*ft/i);
    if (m) r[m[1].trim().toLowerCase().replace(/\s+/g,'_')] = m[2]+' ft.';
  });
  if (passive != null) r.passive_perception = passive;
  return r;
}

function _parseProficiencies(d) {
  const p=[], saves={str:'STR',dex:'DEX',con:'CON',int:'INT',wis:'WIS',cha:'CHA'};
  Object.entries(d.save||{}).forEach(([k,v])=>{ const n=parseInt(v); if(!isNaN(n))p.push({value:n,proficiency:{name:`Saving Throw: ${saves[k]||k.toUpperCase()}`}}); });
  Object.entries(d.skill||{}).forEach(([k,v])=>{ const n=parseInt(v); if(!isNaN(n))p.push({value:n,proficiency:{name:'Skill: '+k.charAt(0).toUpperCase()+k.slice(1)}}); });
  return p;
}

function _damageArr(arr) {
  return (arr||[]).map(v => typeof v==='string' ? v : (Array.isArray(v) ? v.join(', ') : (v.resist||v.immune||v.vulnerable||v.special||''))).filter(Boolean);
}

// ─── _copy resolution ──────────────────────────────────────────────────────────
// Many 5etools entries inherit from a base creature via {_copy:{name,source,_mod}}.
// We support the common _mod operations seen in the bundled bestiaries:
// replaceTxt, appendArr, prependArr, replaceArr, replaceOrAppendArr, removeArr.
// Unsupported modes (addSpells, scalar*, etc.) are silently skipped — the inheriting
// creature still gets the base creature's stats, just without the niche tweaks.
function _walkReplaceStrings(node, re, withStr) {
  if (node == null || typeof node === 'string') return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (typeof node[i] === 'string') node[i] = node[i].replace(re, withStr);
      else _walkReplaceStrings(node[i], re, withStr);
    }
    return;
  }
  if (typeof node === 'object') {
    Object.keys(node).forEach(k => {
      const v = node[k];
      if (typeof v === 'string') node[k] = v.replace(re, withStr);
      else if (v && typeof v === 'object') _walkReplaceStrings(v, re, withStr);
    });
  }
}

function _applyMod(target, prop, mod) {
  if (!mod || !mod.mode) return;
  switch (mod.mode) {
    case 'replaceTxt': {
      let flags = mod.flags || '';
      if (!flags.includes('g')) flags += 'g';
      let re;
      try { re = new RegExp(mod.replace, flags); } catch (e) { return; }
      const root = (prop === '*' || prop === '_') ? target : target[prop];
      _walkReplaceStrings(root, re, mod.with || '');
      break;
    }
    case 'appendArr': {
      const items = Array.isArray(mod.items) ? mod.items : [mod.items];
      if (!Array.isArray(target[prop])) target[prop] = [];
      target[prop] = target[prop].concat(items);
      break;
    }
    case 'prependArr': {
      const items = Array.isArray(mod.items) ? mod.items : [mod.items];
      if (!Array.isArray(target[prop])) target[prop] = [];
      target[prop] = items.concat(target[prop]);
      break;
    }
    case 'replaceArr':
    case 'replaceOrAppendArr': {
      const items = Array.isArray(mod.items) ? mod.items : [mod.items];
      if (!Array.isArray(target[prop])) {
        if (mod.mode === 'replaceOrAppendArr') target[prop] = items.slice();
        return;
      }
      const replaceName = typeof mod.replace === 'string' ? mod.replace : (mod.replace && mod.replace.name);
      const idx = replaceName ? target[prop].findIndex(it => it && it.name === replaceName) : -1;
      if (idx >= 0) target[prop].splice(idx, 1, ...items);
      else if (mod.mode === 'replaceOrAppendArr') target[prop] = target[prop].concat(items);
      break;
    }
    case 'removeArr': {
      if (!Array.isArray(target[prop])) return;
      if (mod.names) {
        const names = Array.isArray(mod.names) ? mod.names : [mod.names];
        target[prop] = target[prop].filter(it => !it || !names.includes(it.name));
      } else if (mod.items) {
        const items = Array.isArray(mod.items) ? mod.items : [mod.items];
        target[prop] = target[prop].filter(it => !items.includes(it));
      }
      break;
    }
    default:
      // addSpells, scalarAddProp, scalarMultProp, etc. — skip silently.
      break;
  }
}

function _resolveCopy(monster, byKey, depth) {
  if (!monster || !monster._copy) return monster;
  if (depth > 5) return monster; // guard against pathological cycles
  const ref = monster._copy;
  const srcKey = ((ref.name || '') + '|' + (ref.source || '')).toLowerCase();
  const src = byKey[srcKey];
  if (!src) {
    console.warn('[SKT] _copy unresolved:', monster.name, '→', ref.name, '('+ref.source+')');
    return monster;
  }
  // Resolve the source first if it itself uses _copy (chained inheritance)
  const baseSrc = src._copy ? _resolveCopy(src, byKey, (depth || 0) + 1) : src;
  // Start from a deep clone of the inheriting entity (its values win)
  const cpy = JSON.parse(JSON.stringify(monster));
  // Pull in any field from the base that the copy doesn't define (or explicitly nulls out)
  Object.keys(baseSrc).forEach(k => {
    if (k === '_copy' || k === '_mod') return;
    if (cpy[k] === null) { delete cpy[k]; return; }
    if (cpy[k] === undefined) cpy[k] = JSON.parse(JSON.stringify(baseSrc[k]));
  });
  // Apply any mods declared on the _copy spec
  if (ref._mod) {
    Object.entries(ref._mod).forEach(([prop, modSpecs]) => {
      const mods = Array.isArray(modSpecs) ? modSpecs : [modSpecs];
      mods.forEach(m => _applyMod(cpy, prop, m));
    });
  }
  delete cpy._copy;
  return cpy;
}

// ─── Monster converter ──────────────────────────────────────────────────────────
function _convertMonster(d) {
  return {
    name: d.name, index: _toIndex(d.name), _source: d.source,
    size:  _SIZE[d.size?.[0]] || d.size?.[0] || 'Medium',
    type:  _parseType(d.type),
    armor_class: _parseAC(d.ac),
    hit_points:  d.hp?.average || 0,
    hit_dice:    d.hp?.formula || '',
    speed:       _parseSpeed(d.speed),
    strength:d.str||10, dexterity:d.dex||10, constitution:d.con||10,
    intelligence:d.int||10, wisdom:d.wis||10, charisma:d.cha||10,
    proficiencies:       _parseProficiencies(d),
    damage_vulnerabilities: _damageArr(d.vulnerable),
    damage_resistances:     _damageArr(d.resist),
    damage_immunities:      _damageArr(d.immune),
    condition_immunities:   (d.conditionImmune||[]).map(c=>({name:typeof c==='string'?c:(c.condition||'')})),
    senses:    _parseSenses(d.senses, d.passive),
    languages: typeof d.languages==='string' ? d.languages : (d.languages||[]).join(', '),
    challenge_rating: _parseCR(d.cr),
    xp:               _crToXP(d.cr),
    special_abilities: (d.trait    ||[]).map(a=>({name:a.name||'', desc:_parseEntries(a.entries)})),
    actions:           (d.action   ||[]).map(a=>({name:a.name||'', desc:_parseEntries(a.entries)})),
    legendary_actions: (d.legendary||[]).map(a=>({name:a.name||'', desc:_parseEntries(a.entries)})),
    reactions:         (d.reaction ||[]).map(a=>({name:a.name||'', desc:_parseEntries(a.entries)})),
  };
}

// ─── Spell converter ────────────────────────────────────────────────────────────
function _parseRange(range) {
  if (!range) return '—';
  const d = range.distance;
  if (range.type === 'special') return 'Special';
  if (!d) return '—';
  if (d.type === 'self') {
    if (range.type !== 'point') return `Self (${d.amount||''}-${d.type}-${range.type})`;
    return 'Self';
  }
  if (d.type === 'touch')     return 'Touch';
  if (d.type === 'unlimited') return 'Unlimited';
  if (d.type === 'sight')     return 'Sight';
  if (d.type === 'feet')      return `${d.amount} feet`;
  if (d.type === 'miles')     return `${d.amount} mile${d.amount!==1?'s':''}`;
  return `${d.amount||''} ${d.type||''}`.trim() || '—';
}

function _parseDuration(dur) {
  if (!dur?.length) return '—';
  const d = dur[0];
  if (d.type==='instant')   return 'Instantaneous';
  if (d.type==='permanent') return 'Until dispelled';
  if (d.type==='special')   return 'Special';
  if (d.type==='timed') {
    const c = d.concentration ? 'Concentration, up to ' : '';
    const a = d.duration?.amount||1, u = d.duration?.type||'round';
    return `${c}${a} ${u}${a!==1?'s':''}`;
  }
  return '—';
}

function _parseClasses(classes) {
  if (!classes) return [];
  const names = new Set([...(classes.fromClassList||[]),...(classes.fromSubclassList||[])].map(c=>c.name));
  return [...names].map(n=>({name:n}));
}

function _convertSpell(d) {
  const comps=[];
  if(d.components?.v) comps.push('V');
  if(d.components?.s) comps.push('S');
  if(d.components?.m) comps.push('M');
  if(d.components?.r) comps.push('R');
  const mat = typeof d.components?.m==='string' ? d.components.m : (d.components?.m?.text||'');
  const t = d.time?.[0]||{};
  const castTime = t.number ? `${t.number} ${t.unit}${(t.condition?`, ${_stripTags(t.condition)}`:'')}` : '—';
  return {
    name: d.name, index: _toIndex(d.name), _source: d.source,
    level: d.level||0,
    school: {name: _SCHOOL[d.school]||d.school||''},
    casting_time: castTime,
    range:        _parseRange(d.range),
    components:   comps,
    material:     mat,
    duration:     _parseDuration(d.duration),
    concentration: d.duration?.[0]?.concentration||false,
    ritual:       d.meta?.ritual||false,
    desc:         [_parseEntries(d.entries)].filter(Boolean),
    higher_level: d.entriesHigherLevel?.length ? [_parseEntries(d.entriesHigherLevel[0]?.entries||d.entriesHigherLevel)] : [],
    classes:      _parseClasses(d.classes),
  };
}

// ─── Condition converter ────────────────────────────────────────────────────────
function _convertCondition(d) {
  const descs = [];
  (d.entries||[]).forEach(e => {
    if (typeof e==='string') descs.push(_stripTags(e));
    else if (e.type==='list') (e.items||[]).forEach(i=>descs.push('• '+_parseEntries([i])));
    else descs.push(_parseEntries([e]));
  });
  return {name:d.name, index:_toIndex(d.name), _source:d.source, desc:descs};
}

// ─── Item converter ─────────────────────────────────────────────────────────────
function _convertItem(d) {
  const desc = _parseEntries(d.entries || d.entriesTemplate || []);
  const rarity = d.rarity || 'unknown';
  const attune = d.reqAttune
    ? (typeof d.reqAttune === 'string' ? d.reqAttune : 'attunement required')
    : null;
  return {
    name: d.name, index: _toIndex(d.name), _source: d.source,
    rarity,
    requires_attunement: attune,
    desc: desc ? [desc] : [],
  };
}

// ─── Feat converter ─────────────────────────────────────────────────────────────
function _convertFeat(d) {
  const prereq = (d.prerequisite || []).map(p => {
    if (p.level)   return `Level ${p.level.level}`;
    if (p.ability) return Object.entries(p.ability[0]).map(([k,v]) => `${k.toUpperCase()} ${v}+`).join(', ');
    if (p.race)    return p.race.map(r => r.name).join(' or ');
    if (p.other)   return p.other;
    if (p.spellcasting) return 'Spellcasting ability';
    return '';
  }).filter(Boolean).join('; ');
  const desc = _parseEntries(d.entries || []);
  return {
    name: d.name, index: _toIndex(d.name), _source: d.source,
    prerequisite: prereq,
    desc: desc ? [desc] : [],
  };
}

// ─── State ─────────────────────────────────────────────────────────────────────
let _5eData      = [];
let _5eLoaded    = false;
let _5eLoading   = false;
let _5eCallbacks = [];

function on5eLoaded(cb) {
  if (_5eLoaded) cb(_5eData);
  else _5eCallbacks.push(cb);
}

// ─── Main loader ────────────────────────────────────────────────────────────────
async function load5eData() {
  if (_5eLoading || _5eLoaded) return;
  _5eLoading = true;

  const seen = new Set(); // deduplicate by name+cat
  const results = [];

  function addMonster(d) {
    const key = 'monster:'+d.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const r = _convertMonster(d);
    results.push({
      cat:'monster', name:d.name, _slug:r.index, _fromLocal:true,
      meta:`${r.size} ${r.type} · CR ${r.challenge_rating}`.trim(),
      _source:d.source,
      hp:r.hit_points, ac:r.armor_class?.[0]?.value||10,
      speed:Object.entries(r.speed||{}).map(([k,v])=>k+' '+v).join(', ')||'—',
      str:r.strength, dex:r.dexterity, con:r.constitution,
      int:r.intelligence, wis:r.wisdom, cha:r.charisma,
      _raw:r,
    });
  }

  function addSpell(d) {
    const key = 'spell:'+d.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const r = _convertSpell(d);
    const lvl = r.level===0?'Cantrip':'Level '+r.level;
    results.push({
      cat:'spell', name:d.name, _slug:r.index, _fromLocal:true,
      meta:`${lvl} ${r.school.name}`.trim(),
      _source:d.source,
      cast:r.casting_time, range:r.range,
      components:r.components.join(', ')+(r.material?' ('+r.material+')':''),
      duration:r.duration, desc:r.desc.join('\n\n'),
      _raw:r,
    });
  }

  function addCondition(d) {
    const key = 'condition:'+d.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const r = _convertCondition(d);
    results.push({
      cat:'condition', name:d.name, _slug:r.index, _fromLocal:true,
      meta:'Condition', _source:d.source, desc:r.desc.join('\n'), _raw:r,
    });
  }

  function addItem(d) {
    if (!d.rarity || d.rarity === 'none') return; // skip mundane items
    const key = 'item:'+d.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const r = _convertItem(d);
    results.push({
      cat:'item', name:d.name, _slug:r.index, _fromLocal:true,
      meta: r.rarity.charAt(0).toUpperCase()+r.rarity.slice(1)+(r.requires_attunement?' · Attunement':''),
      _source:d.source,
      _raw:r,
    });
  }

  function addFeat(d) {
    const key = 'feat:'+d.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const r = _convertFeat(d);
    results.push({
      cat:'feat', name:d.name, _slug:r.index, _fromLocal:true,
      meta: r.prerequisite ? 'Prerequisite: '+r.prerequisite : 'Feat',
      _source:d.source,
      _raw:r,
    });
  }

  // Generic loader used for the long tail of reference categories. Most 5etools
  // entries follow the same shape: {name, source, entries:[…]}. We extract the
  // description text and keep _raw for the detail view.
  function addRef(cat, d, meta, opts) {
    if (!d || !d.name) return;
    opts = opts || {};
    const dedupeName = opts.dedupeKey || d.name;
    const key = cat + ':' + dedupeName.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    results.push({
      cat: cat, name: opts.displayName || d.name, _slug: _toIndex(opts.displayName || d.name),
      _fromLocal: true,
      meta: meta || cat,
      _source: d.source,
      desc: _parseEntries(d.entries || []),
      _raw: d,
    });
  }

  const fetchFile = async (path) => {
    try {
      const r = await fetch(path);
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  };

  // Step 1: fetch index files to discover all available source files dynamically
  const [bestiaryIdx, spellIdx, classIdx] = await Promise.all([
    fetchFile('data/bestiary/index.json'),
    fetchFile('data/spells/index.json'),
    fetchFile('data/class/index.json'),
  ]);

  const _skipKeys = new Set(['fluff-index.json', 'index.json', 'sources.json', 'foundry.json']);
  const bestiaryFiles = bestiaryIdx
    ? Object.values(bestiaryIdx).filter(f => !f.startsWith('fluff-') && !_skipKeys.has(f)).map(f => `data/bestiary/${f}`)
    : [];
  const spellFiles = spellIdx
    ? Object.values(spellIdx).filter(f => !f.startsWith('fluff-') && !_skipKeys.has(f)).map(f => `data/spells/${f}`)
    : [];
  const classFiles = classIdx
    ? Object.values(classIdx).filter(f => !_skipKeys.has(f)).map(f => `data/class/${f}`)
    : [];

  // Long tail of single-file reference categories
  const _refSpecs = [
    {path:'data/backgrounds.json',         arr:'background',   cat:'background'},
    {path:'data/races.json',               arr:'race',         cat:'race'},
    {path:'data/races.json',               arr:'subrace',      cat:'race', subrace:true},
    {path:'data/optionalfeatures.json',    arr:'optionalfeature', cat:'optionalfeature'},
    {path:'data/deities.json',             arr:'deity',        cat:'deity'},
    {path:'data/objects.json',             arr:'object',       cat:'object'},
    {path:'data/vehicles.json',            arr:'vehicle',      cat:'vehicle'},
    {path:'data/rewards.json',             arr:'reward',       cat:'reward'},
    {path:'data/psionics.json',            arr:'psionic',      cat:'psionic'},
    {path:'data/trapshazards.json',        arr:'trap',         cat:'trap'},
    {path:'data/trapshazards.json',        arr:'hazard',       cat:'hazard'},
    {path:'data/variantrules.json',        arr:'variantrule',  cat:'variantrule'},
    {path:'data/tables.json',              arr:'table',        cat:'table'},
    {path:'data/recipes.json',             arr:'recipe',       cat:'recipe'},
    {path:'data/decks.json',               arr:'deck',         cat:'deck'},
    {path:'data/bastions.json',            arr:'facility',     cat:'facility'},
    {path:'data/languages.json',           arr:'language',     cat:'language'},
    {path:'data/cultsboons.json',          arr:'cult',         cat:'cult'},
    {path:'data/cultsboons.json',          arr:'boon',         cat:'boon'},
    {path:'data/actions.json',             arr:'action',       cat:'action'},
    {path:'data/skills.json',              arr:'skill',        cat:'skill'},
    {path:'data/senses.json',              arr:'sense',        cat:'sense'},
    {path:'data/charcreationoptions.json', arr:'charoption',   cat:'charoption'},
  ];
  const _refUniquePaths = [...new Set(_refSpecs.map(s => s.path))];

  // Step 2: fetch all data files in parallel
  const [bestiaries, spellbooks, classBooks, conditionFiles, itemFile, featFile, refFiles] = await Promise.all([
    Promise.all(bestiaryFiles.map(fetchFile)),
    Promise.all(spellFiles.map(fetchFile)),
    Promise.all(classFiles.map(fetchFile)),
    Promise.all(_CONDITION_FILES.map(fetchFile)),
    fetchFile('data/items.json'),
    fetchFile('data/feats.json'),
    Promise.all(_refUniquePaths.map(fetchFile)),
  ]);
  const _refByPath = {};
  _refUniquePaths.forEach((p, i) => { _refByPath[p] = refFiles[i]; });

  // Two passes for monsters: first index every raw entry by name|source so _copy
  // references can be resolved across bestiary files (e.g. SKT's Xolkin → MM's
  // Bandit Captain), then resolve + convert each entry.
  const _monsterByKey = {};
  const _allRawMonsters = [];
  bestiaries.forEach(json => {
    if (!json) return;
    (json.monster || []).forEach(d => {
      _allRawMonsters.push(d);
      const k = ((d.name || '') + '|' + (d.source || '')).toLowerCase();
      if (!_monsterByKey[k]) _monsterByKey[k] = d;
    });
  });
  _allRawMonsters.forEach(d => addMonster(d._copy ? _resolveCopy(d, _monsterByKey, 0) : d));
  spellbooks.forEach(json     => json && (json.spell      ||[]).forEach(addSpell));
  conditionFiles.forEach(json => { if (!json) return; (json.condition||[]).forEach(addCondition); });
  if (itemFile) (itemFile.item||[]).forEach(addItem);
  if (featFile) (featFile.feat||[]).forEach(addFeat);

  // Classes, subclasses, and class/subclass features
  classBooks.forEach(json => {
    if (!json) return;
    (json.class||[]).forEach(d => {
      const hd = d.hd?.faces ? `Hit Die d${d.hd.faces}` : '';
      addRef('class', d, ['Class', hd].filter(Boolean).join(' · '));
    });
    (json.subclass||[]).forEach(d => {
      const display = d.name + (d.className?` (${d.className})`:'');
      addRef('class', d, 'Subclass · '+(d.className||''), {displayName: display, dedupeKey: display});
    });
    (json.classFeature||[]).forEach(d => {
      const meta = `${d.className||''} feature${d.level?(' · L'+d.level):''}`;
      const dedupe = `${d.className||''}-${d.name}`;
      addRef('classFeature', d, meta, {dedupeKey: dedupe});
    });
    (json.subclassFeature||[]).forEach(d => {
      const sc = d.subclassShortName ? ` (${d.subclassShortName})` : '';
      const meta = `${d.className||''}${sc} feature${d.level?(' · L'+d.level):''}`;
      const dedupe = `${d.className||''}-${d.subclassShortName||''}-${d.name}-${d.level||''}`;
      addRef('classFeature', d, meta, {dedupeKey: dedupe});
    });
  });

  // Long-tail reference categories
  _refSpecs.forEach(spec => {
    const json = _refByPath[spec.path];
    if (!json) return;
    (json[spec.arr]||[]).forEach(d => {
      let meta = '', display, dedupe;
      switch (spec.cat) {
        case 'background': meta = 'Background'; break;
        case 'race': {
          if (spec.subrace) {
            const parent = d.raceName || '';
            display = d.name + (parent?` (${parent})`:'');
            dedupe  = display;
            meta = 'Subrace · ' + parent;
          } else {
            const sz = (Array.isArray(d.size)?d.size[0]:d.size) || '';
            const sizeName = _SIZE[sz] || sz || '';
            const speed = typeof d.speed==='number' ? d.speed+' ft' : (d.speed?.walk?d.speed.walk+' ft':'');
            meta = ['Race', sizeName, speed?('Speed '+speed):''].filter(Boolean).join(' · ');
          }
          break;
        }
        case 'optionalfeature': {
          const types = (d.featureType||[]).join(', ');
          meta = 'Optional feature' + (types?' · '+types:'');
          break;
        }
        case 'deity': {
          const align = Array.isArray(d.alignment) ? d.alignment.join('') : '';
          meta = ['Deity', d.pantheon, align].filter(Boolean).join(' · ');
          break;
        }
        case 'object': {
          const sz = (Array.isArray(d.size)?d.size[0]:d.size) || '';
          meta = ['Object', _SIZE[sz]||sz, d.objectType].filter(Boolean).join(' · ');
          break;
        }
        case 'vehicle':     meta = ['Vehicle', d.vehicleType].filter(Boolean).join(' · '); break;
        case 'reward':      meta = 'Reward'  + (d.type?' · '+d.type:''); break;
        case 'psionic':     meta = 'Psionic' + (d.type?' · '+d.type:''); break;
        case 'trap':        meta = 'Trap'    + (d.trapHazType?' · '+d.trapHazType:''); break;
        case 'hazard':      meta = 'Hazard'  + (d.trapHazType?' · '+d.trapHazType:''); break;
        case 'variantrule': meta = 'Variant rule' + (d.ruleType?' · '+d.ruleType:''); break;
        case 'table':       meta = 'Table'   + (d.caption?' · '+d.caption.slice(0,40):''); break;
        case 'recipe':      meta = 'Recipe'  + (d.type?' · '+d.type:''); break;
        case 'deck':        meta = 'Deck'; break;
        case 'facility':    meta = ['Bastion facility', d.facilityType, d.level?('L'+d.level):''].filter(Boolean).join(' · '); break;
        case 'language':    meta = 'Language'+ (d.type?' · '+d.type:''); break;
        case 'cult':        meta = 'Cult'    + (d.type?' · '+d.type:''); break;
        case 'boon':        meta = 'Boon'    + (d.type?' · '+d.type:''); break;
        case 'action':      meta = 'Action'; break;
        case 'skill':       meta = 'Skill'   + (d.ability?(' · '+d.ability.toUpperCase()):''); break;
        case 'sense':       meta = 'Sense'; break;
        case 'charoption':  meta = 'Char option' + (d.optionType?' · '+d.optionType:''); break;
      }
      addRef(spec.cat, d, meta, {displayName: display, dedupeKey: dedupe});
    });
  });

  _5eData    = results;
  _5eLoaded  = true;
  _5eLoading = false;
  console.info(`[SKT] Loaded ${results.length} entries from local 5etools data.`);
  _5eCallbacks.forEach(cb => cb(_5eData));
  _5eCallbacks = [];
}
