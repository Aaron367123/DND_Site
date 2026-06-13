// ============================================================
// DATA LOADER — 5etools JSON → internal search format
// ============================================================
// Dynamically discovers bestiary and spell files via index.json.
// Also loads magic items (items.json) and feats (feats.json).
// Missing files (404) are silently skipped.

const _CONDITION_FILES = [
  'data/conditionsdiseases.json',
];

// 5etools single-letter / short item-type code → human label. Used to build
// the search-meta line for mundane items AND consumed by the shop generator
// to label categories. Hoisted to module scope so other panels can read it.
const _ITEM_TYPE_LABEL = {
  '$':'Treasure', 'A':'Ammunition', 'AF':'Ammunition (Futuristic)',
  'AIR':'Vehicle (Air)', 'AT':"Artisan's Tools", 'EM':'Eldritch Machine',
  'EXP':'Explosive', 'FD':'Food & Drink', 'G':'Adventuring Gear',
  'GS':'Gaming Set', 'HA':'Heavy Armor', 'IDG':'Illegal Drug',
  'INS':'Instrument', 'LA':'Light Armor', 'M':'Melee Weapon',
  'MA':'Medium Armor', 'MNT':'Mount', 'OTH':'Other', 'P':'Potion',
  'R':'Ranged Weapon', 'RD':'Rod', 'RG':'Ring', 'S':'Shield',
  'SC':'Scroll', 'SCF':'Spellcasting Focus', 'SHP':'Vehicle (Water)',
  'T':'Tool', 'TAH':'Tack & Harness', 'TG':'Trade Good',
  'VEH':'Vehicle (Land)', 'WD':'Wand',
};

// ─── Tag stripper ──────────────────────────────────────────────────────────────
// Converts 5etools inline tags like {@damage 8d6} → plain text
function _stripTags(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    // Combat / dice / save semantics — replaced with human-readable text.
    .replace(/\{@(?:atk|atkr) ([^}]+)\}/g, (_, t) => {
      const parts = t.split(',').map(p=>p.trim());
      const melee = parts.some(p=>p==='mw'||p==='ms');
      const ranged = parts.some(p=>p==='rw'||p==='rs');
      const spell = parts.some(p=>p==='ms'||p==='rs');
      const weapon = !spell;
      if (melee && ranged) return (weapon ? 'Melee or Ranged Weapon' : 'Melee or Ranged Spell') + ' Attack:';
      if (melee) return (spell ? 'Melee Spell' : 'Melee Weapon') + ' Attack:';
      if (ranged) return (spell ? 'Ranged Spell' : 'Ranged Weapon') + ' Attack:';
      return 'Attack:';
    })
    .replace(/\{@hom\}/g,          'Hit or Miss: ')
    .replace(/\{@h\}/g,            'Hit: ')
    .replace(/\{@hit ([+-]?\d+)\}/g, (_, n) => (parseInt(n) >= 0 ? '+' : '') + n)
    .replace(/\{@dc (\d+)\}/g,    'DC $1')
    .replace(/\{@recharge ([^}]+)\}/g, '(Recharge $1–6)')
    .replace(/\{@recharge\}/g,         '(Recharge 6)')
    .replace(/\{@chance (\d+)[^}]*\}/g, '$1%')
    // 5e 2024 "actSave" family — prints the save ability and pulls display
    // text out of the trailing pipe segments when present.
    .replace(/\{@(?:actSave|actSaveFail|actSaveSuccess|actSaveSuccessOrFail|actTrigger|actResponse)\s+([^}]+)\}/g, (_, body) => {
      const parts = body.split('|');
      const display = (parts[parts.length - 1] || '').trim();
      // The trailing display, if multiple pipes, is the formatted text.
      return display && parts.length > 1 ? display : (parts[0] || '').trim();
    })
    .replace(/\{@hitYourSpellAttack\}/g, 'your spell attack modifier')
    .replace(/\{@hitYourSpellAttack\s+([^}]+)\}/g, (_, body) => {
      const parts = body.split('|');
      return (parts[parts.length-1] || 'your spell attack modifier').trim();
    })
    // Dice / damage tags — keep just the dice expression.
    .replace(/\{@(?:damage|dice|scaledice|scaledamage)\s+([^|}]+)[^}]*\}/g, '$1')
    // Inline color: {@color text|hex} → text.
    .replace(/\{@color\s+([^|}]+)[^}]*\}/g, '$1')
    // Link-style "reference" tags. Format: {@tag NAME|SOURCE|DISPLAY|...}.
    // We honor an explicit display text (3rd segment) when given, otherwise
    // we capitalize the first segment as the rendered text.
    .replace(/\{@(?:condition|spell|creature|item|sense|skill|action|ability|race|class|feat|background|disease|status|object|vehicle|reward|hazard|encounter|table|area|filter|deity|deck|card|variantrule|itemProperty|itemMastery|classFeature|subclassFeature|optfeature|recipe|adventure|book|charoption|psionic|trap|cult|boon|language|hazard|legroup)\s+([^}]+)\}/gi, (_, body) => {
      const parts = body.split('|');
      const display = (parts[2] || '').trim();
      if (display) return display;
      const name = (parts[0] || '').trim();
      return name ? name.charAt(0).toUpperCase()+name.slice(1) : '';
    })
    // Inline formatting markers — turned into control chars that
    // _renderInline later converts to <strong>/<i>/etc.
    .replace(/\{@(?:b|bold)\s+([^}]+)\}/g,   '\x06$1\x06')
    .replace(/\{@(?:i|italic)\s+([^}]+)\}/g, '\x05$1\x05')
    .replace(/\{@(?:s|strike|u|sup|sub|kbd|code|comicH1|comicH2|comicH3|comicH4|comicNote)\s+([^}]+)\}/g, '$1')
    .replace(/\{@note\s+([^}]+)\}/g,  '($1)')
    .replace(/\{@quickref\s+([^|}]+)[^}]*\}/g, '$1')
    .replace(/\{@5etools\s+([^|}]+)[^}]*\}/g, '$1')
    .replace(/\{@5etoolsImg\s+([^|}]+)[^}]*\}/g, '$1')
    .replace(/\{@link\s+([^|}]+)[^}]*\}/g, '$1')
    // Generic fallback: any remaining {@tag content} — prefer a 3rd-segment
    // display text if present, otherwise the first segment. This makes
    // unknown / future tag types degrade gracefully to readable text
    // instead of disappearing or showing a raw name.
    .replace(/\{@\w+\s+([^}]+)\}/g, (_, body) => {
      const parts = body.split('|');
      const display = (parts[2] || '').trim();
      if (display) return display;
      return (parts[0] || '').trim();
    })
    // Catch-all: tags with no content (e.g. {@foo}) — drop them entirely
    // since there's nothing to render.
    .replace(/\{@[^}]*\}/g, '');
}

// ─── Entries parser ────────────────────────────────────────────────────────────
// Emits a flat string with control-char markers that the renderer post-processes:
//   \x01header\n\n  → section header (h3)
//   \x02...\x02     → inset box (callout)
//   \x03...\x03     → quote block
//   \x04label\x04   → bold inline label (item name)
//   \x05text\x05    → italic
//   \x06text\x06    → bold
//   \x07table-json\x07 → embedded table
function _parseEntries(entries, sep) {
  if (sep == null) sep = '\n\n';
  if (!entries) return '';
  if (typeof entries === 'string') return _stripTags(entries);
  if (!Array.isArray(entries)) return '';
  return entries.map(e => {
    if (typeof e === 'string') return _stripTags(e);
    if (!e || typeof e !== 'object') return '';
    switch (e.type) {
      case 'entries':
      case 'section':
        return (e.name ? '\x01' + e.name + '\n\n' : '') + _parseEntries(e.entries);
      case 'list':
        return (e.items||[])
          .map(i => '• ' + (typeof i==='string' ? _stripTags(i) : _parseEntries([i], '\n')))
          .join('\n');
      case 'table':
        try {
          const t = {
            caption: e.caption ? _stripTags(e.caption) : '',
            cols: (e.colLabels||[]).map(_stripTags),
            rows: (e.rows||[]).map(r => (Array.isArray(r)?r:[r]).map(c => {
              if (typeof c === 'string') return _stripTags(c);
              if (c && c.roll && c.roll.exact != null) return String(c.roll.exact);
              if (c && c.roll && c.roll.min != null) return c.roll.min + '–' + c.roll.max;
              if (c && c.type) return _parseEntries([c], '\n');
              return '';
            })),
          };
          return '\x07' + JSON.stringify(t) + '\x07';
        } catch (_) { return ''; }
      case 'item':
        return '\x04' + (e.name||'') + '\x04 ' + _parseEntries(e.entries || (e.entry ? [e.entry] : []), '\n');
      case 'inset':
      case 'insetReadaloud':
        return '\x02' + (e.name ? '\x06' + e.name + '\x06\n' : '') + _parseEntries(e.entries || [], '\n') + '\x02';
      case 'quote':
        return '\x03' + _parseEntries(e.entries || [], '\n') + '\x03';
      case 'abilityDc':
        return `Spell save DC = 8 + proficiency bonus + ${e.attributes?.[0]||'ability'} modifier`;
      case 'abilityAttackMod':
        return `Spell attack modifier = proficiency bonus + ${e.attributes?.[0]||'ability'} modifier`;
      default:
        return _parseEntries(e.entries || []);
    }
  }).filter(Boolean).join(sep);
}

// ─── Conversion helpers ────────────────────────────────────────────────────────
const _SCHOOL = {A:'Abjuration',C:'Conjuration',D:'Divination',E:'Enchantment',V:'Evocation',I:'Illusion',N:'Necromancy',T:'Transmutation',P:'Psionic'};
const _SIZE   = {F:'Fine',D:'Diminutive',T:'Tiny',S:'Small',M:'Medium',L:'Large',H:'Huge',G:'Gargantuan',C:'Colossal'};
const _CR_XP  = {'0':10,'1/8':25,'1/4':50,'1/2':100,'1':200,'2':450,'3':700,'4':1100,'5':1800,'6':2300,'7':2900,'8':3900,'9':5000,'10':5900,'11':7200,'12':8400,'13':10000,'14':11500,'15':13000,'16':15000,'17':18000,'18':20000,'19':22000,'20':25000,'21':33000,'22':41000,'23':50000,'24':62000,'25':75000,'26':90000,'27':105000,'28':120000,'29':135000,'30':155000};

function _toIndex(name) { return (name||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
function _parseCR(cr){
  if (cr == null) return 'None';
  if (typeof cr === 'object') return String(cr.cr ?? 'None');
  return String(cr);
}
function _crToXP(cr){
  if (cr == null) return 0;
  const k = typeof cr === 'object' ? cr.cr : String(cr);
  if (k == null || k === '' || k === '—') return 0;
  return _CR_XP[k] || 0;
}
// Render a 5etools type field. Tags can be plain strings ("human") or
// objects ({tag:"human", prefix:"Chondathan"}); previous code blindly
// joined an array of objects which produced "[object Object]". Now we
// stringify each tag explicitly.
function _parseType(t){
  if (!t) return '';
  if (typeof t === 'string') return t;
  const base = t.swarmSize
    ? `swarm of ${_SIZE[t.swarmSize]||t.swarmSize} ${t.type}s`
    : (t.type||'');
  const tags = (t.tags||[]).map(tag => {
    if (typeof tag === 'string') return tag;
    if (tag && typeof tag === 'object'){
      const name = tag.tag || '';
      const cap  = name.charAt(0).toUpperCase() + name.slice(1);
      const pre  = tag.prefix ? tag.prefix + ' ' : '';
      return pre + cap;
    }
    return String(tag);
  }).filter(Boolean);
  return base + (tags.length ? ` (${tags.join(', ')})` : '');
}

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
  if (typeof a === 'number') return [{value:a, type:''}];
  // 5etools puts armor source refs in `from` as inline tags like
  // "{@item studded leather armor|phb|studded leather}" — strip those for display.
  const from = (a.from||[]).map(_stripTags).filter(Boolean).join(', ');
  return [{value:a.ac||10, type:from + (a.condition?(from?' ':'')+_stripTags(a.condition):'')}];
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
  return (arr||[]).map(v => {
    if (typeof v === 'string') return _stripTags(v);
    if (Array.isArray(v)) return v.map(x => typeof x==='string'?_stripTags(x):'').filter(Boolean).join(', ');
    const inner = v.resist||v.immune||v.vulnerable||v.special||'';
    if (Array.isArray(inner)) return inner.map(x => typeof x==='string'?_stripTags(x):'').filter(Boolean).join(', ');
    return _stripTags(inner);
  }).filter(Boolean);
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

// Fast deep clone. structuredClone is markedly quicker than a JSON round-trip
// for the large monster objects _resolveCopy churns through on cold load, and
// for this pure-JSON data the two are semantically equivalent. Falls back to
// the JSON path on the rare engine that lacks structuredClone.
const _deepClone = (typeof structuredClone === 'function')
  ? structuredClone
  : (x => JSON.parse(JSON.stringify(x)));
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
  const cpy = _deepClone(monster);
  // Pull in any field from the base that the copy doesn't define (or explicitly nulls out)
  Object.keys(baseSrc).forEach(k => {
    if (k === '_copy' || k === '_mod') return;
    if (cpy[k] === null) { delete cpy[k]; return; }
    if (cpy[k] === undefined) cpy[k] = _deepClone(baseSrc[k]);
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
    reprintedAs: d.reprintedAs,
    page: d.page,
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
    languages: _stripTags(typeof d.languages==='string' ? d.languages : (d.languages||[]).join(', ')),
    challenge_rating: _parseCR(d.cr),
    xp:               _crToXP(d.cr),
    special_abilities: (d.trait    ||[]).map(a=>({name:a.name||'', desc:_parseEntries(a.entries)})),
    actions:           (d.action   ||[]).map(a=>({name:a.name||'', desc:_parseEntries(a.entries)})),
    bonus_actions:     (d.bonus    ||[]).map(a=>({name:a.name||'', desc:_parseEntries(a.entries)})),
    legendary_actions: (d.legendary||[]).map(a=>({name:a.name||'', desc:_parseEntries(a.entries)})),
    reactions:         (d.reaction ||[]).map(a=>({name:a.name||'', desc:_parseEntries(a.entries)})),
    mythic_actions:    (d.mythic   ||[]).map(a=>({name:a.name||'', desc:_parseEntries(a.entries)})),
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
    reprintedAs: d.reprintedAs,
    page: d.page,
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
    // Preserve EVERY higher-level block, not just [0]. A handful of spells
    // carry multiple (e.g. a "Cantrip Upgrade" block plus an upcast block);
    // the old [0]-only slice silently dropped the rest. Each block becomes one
    // string (renderer joins with blank lines). A non-generic block name is
    // prefixed so multi-block spells read correctly.
    higher_level: (Array.isArray(d.entriesHigherLevel) && d.entriesHigherLevel.length)
      ? d.entriesHigherLevel.map(b => {
          const body = _parseEntries((b && Array.isArray(b.entries)) ? b.entries : [b]);
          if (!body) return '';
          const nm = (b && typeof b.name === 'string') ? b.name.trim() : '';
          return (nm && !/^at higher levels$/i.test(nm)) ? `${nm}. ${body}` : body;
        }).filter(Boolean)
      : [],
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
  return {name:d.name, index:_toIndex(d.name), _source:d.source, reprintedAs:d.reprintedAs, page:d.page, desc:descs};
}

// ─── Item-entry templates ──────────────────────────────────────────────────────
// 5etools items often contain "{#itemEntry Name|Source}" references that
// expand to a shared description template (defined in items-base.json's
// itemEntry array). Each template has an `entriesTemplate` with `{{item.X}}`
// placeholders that get filled from the referencing item's properties (e.g.
// {{item.detail1}} → "green", {{item.resist}} → "acid"). We index every
// known template by "name|source" lowercase and expand refs before parsing
// the entries — otherwise the user sees the literal "{#itemEntry ...}" text
// in the rendered description.
let _ITEM_ENTRY_BY_KEY = {};
let _ITEM_ENTRY_BY_NAME = {}; // name-only fallback (first template wins)
function _findItemEntry(name, source){
  const n = (name||'').toLowerCase();
  const key = n + '|' + (source||'').toLowerCase();
  // Exact name|source first. If the reference omits the source — or names a
  // source that differs from where the template actually lives — fall back to
  // a name-only match so the {#itemEntry …} ref still resolves instead of
  // leaking the literal token into the rendered description.
  return _ITEM_ENTRY_BY_KEY[key] || _ITEM_ENTRY_BY_NAME[n] || null;
}
function _substituteItemPlaceholders(node, item){
  if (typeof node === 'string'){
    return node.replace(/\{\{item\.(\w+)\}\}/g, (_, prop) => {
      const v = item[prop];
      if (v == null) return '';
      if (Array.isArray(v)) return v.join(', ');
      return String(v);
    });
  }
  if (Array.isArray(node)) return node.map(n => _substituteItemPlaceholders(n, item));
  if (node && typeof node === 'object'){
    const out = {};
    for (const k in node) out[k] = _substituteItemPlaceholders(node[k], item);
    return out;
  }
  return node;
}
function _expandItemRefs(entries, item){
  if (!Array.isArray(entries)) return entries;
  const out = [];
  entries.forEach(e => {
    if (typeof e !== 'string'){ out.push(e); return; }
    // Whole-entry case: "{#itemEntry Name|Source}" replaces this entry with
    // every entry of the template (after substitution).
    const m = e.match(/^\{#itemEntry\s+([^|}]+)(?:\|([^}]+))?\}$/);
    if (m){
      const tpl = _findItemEntry(m[1].trim(), (m[2]||'').trim());
      if (tpl && Array.isArray(tpl.entriesTemplate)){
        tpl.entriesTemplate.forEach(t => out.push(_substituteItemPlaceholders(t, item)));
        return;
      }
    }
    // Inline case: replace any {#itemEntry ...} found mid-string with its
    // template's flattened text.
    const replaced = e.replace(/\{#itemEntry\s+([^|}]+)(?:\|([^}]+))?\}/g, (full, n, s) => {
      const tpl = _findItemEntry(n.trim(), (s||'').trim());
      if (tpl && Array.isArray(tpl.entriesTemplate)){
        return tpl.entriesTemplate
          .filter(t => typeof t === 'string')
          .map(t => _substituteItemPlaceholders(t, item))
          .join(' ');
      }
      return full;
    });
    out.push(replaced);
  });
  return out;
}

// ─── Item converter ─────────────────────────────────────────────────────────────
function _convertItem(d) {
  // Expand any {#itemEntry Name|Source} references the item carries before
  // running the entries through _parseEntries so the resolved text feeds
  // the {{item.X}} substitutions and gets tag-stripped normally.
  const expanded = _expandItemRefs(d.entries || d.entriesTemplate || [], d);
  const desc = _parseEntries(expanded);
  const rarity = d.rarity || 'unknown';
  const attune = d.reqAttune
    ? (typeof d.reqAttune === 'string' ? d.reqAttune : 'attunement required')
    : null;
  // 5etools stores value in copper pieces; render in the largest unit that
  // doesn't lose precision (gp / sp / cp) for the stat block. We also retain
  // the raw cp value so the shop generator can apply price-band multipliers.
  let valueStr = null;
  let valueCp  = null;
  if (typeof d.value === 'number'){
    valueCp = d.value;
    if (d.value >= 100 && d.value % 100 === 0) valueStr = (d.value/100) + ' gp';
    else if (d.value >= 10 && d.value % 10 === 0) valueStr = (d.value/10) + ' sp';
    else valueStr = d.value + ' cp';
  }
  return {
    name: d.name, index: _toIndex(d.name), _source: d.source,
    reprintedAs: d.reprintedAs,
    page: d.page,
    rarity,
    requires_attunement: attune,
    // Pass-through the original `reqAttune` value too so consumers can do
    // truthy/falsy checks without needing to know about the converter's
    // rename. Same for the other shop-filter signals (`curse`, `sentient`,
    // `age`) which the converter previously dropped — the shop generator's
    // detection helpers rely on these fields being present on `_raw`.
    reqAttune: d.reqAttune || null,
    curse:     d.curse     || null,
    sentient:  d.sentient  || null,
    age:       d.age       || null,
    value: valueStr,
    value_cp: valueCp,
    weight: d.weight != null ? d.weight : null,
    type: d.type || null,
    // Type-specific stats — surfaced in the stat block when present.
    // Weapons: damage dice, damage type, property codes, weapon class.
    dmg1: d.dmg1 || null,
    dmg2: d.dmg2 || null,
    dmgType: d.dmgType || null,
    property: Array.isArray(d.property) ? d.property : null,
    weaponCategory: d.weaponCategory || null,
    range: d.range || null,
    // Armor: AC, stealth disadvantage, minimum strength requirement.
    ac: d.ac != null ? d.ac : null,
    armor: d.armor || null,
    stealth: d.stealth || null,
    strength: d.strength || null,
    // Mounts / vehicles / containers.
    speed: d.speed != null ? d.speed : null,
    carryingCapacity: d.carryingCapacity != null ? d.carryingCapacity : null,
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
    reprintedAs: d.reprintedAs,
    page: d.page,
    prerequisite: prereq,
    desc: desc ? [desc] : [],
  };
}

// ─── State ─────────────────────────────────────────────────────────────────────
let _5eData       = [];
let _5eLoaded     = false;
let _5eLoading    = false;
let _5eCallbacks  = [];
let _5eReprintTo  = new Set(); // lowercased "name|source" of every entry that is a reprint of an older one

// True if this entry is the OLDER version that has been reprinted in a newer book (e.g. MM Goblin → XMM Goblin Warrior).
function _isLegacyEntry(r) {
  const rs = r && r._raw && r._raw.reprintedAs;
  return Array.isArray(rs) && rs.length > 0;
}
// True if this entry IS the newer reprint of something older.
function _isReprintEntry(r) {
  if (!r) return false;
  // Trim both halves — the reprint-target keys are built from trimmed name +
  // source, so an entry with stray whitespace would silently miss otherwise.
  const key = ((r.name || '').trim() + '|' + (r._source || '').trim()).toLowerCase();
  return _5eReprintTo.has(key);
}

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
    // Dedup by name|source (not name alone) so 2014 and 2024 versions of the
    // same creature both make it into the search pool. The reprintPolicy filter
    // in search.js handles which set the user actually sees.
    const key = 'monster:'+d.name.toLowerCase()+'|'+(d.source||'').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const r = _convertMonster(d);
    const imgKey = ((d.name||'') + '|' + (d.source||'')).toLowerCase();
    results.push({
      cat:'monster', name:d.name, _slug:r.index, _fromLocal:true,
      meta:`${r.size} ${r.type} · CR ${r.challenge_rating}`.trim(),
      _source:d.source,
      hp:r.hit_points, ac:r.armor_class?.[0]?.value||10,
      speed:Object.entries(r.speed||{}).map(([k,v])=>k+' '+v).join(', ')||'—',
      str:r.strength, dex:r.dexterity, con:r.constitution,
      int:r.intelligence, wis:r.wisdom, cha:r.charisma,
      _img: _monsterImg[imgKey] || null, // path under /img if 5etools image pack is installed
      _raw:r,
    });
  }

  function addSpell(d) {
    const key = 'spell:'+d.name.toLowerCase()+'|'+(d.source||'').toLowerCase();
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

  // Lookup populated after fluff files load (see _FLUFF_SPECS below). Keyed by
  // cat → 'name|source'.toLowerCase() → {desc, img}. Used by addCondition /
  // addItem / addFeat / addRef to fill in the description text and hero image
  // for entries whose primary data file is just stat-block info.
  const _fluffByCatKey = {};
  function _applyFluff(cat, name, source, target) {
    const bucket = _fluffByCatKey[cat];
    if (!bucket) return;
    const f = bucket[((name||'') + '|' + (source||'')).toLowerCase()];
    if (!f) return;
    if (f.desc && (!target.desc || !target.desc.trim())) target.desc = f.desc;
    if (f.img && !target._img) target._img = f.img;
  }

  function addCondition(d) {
    const key = 'condition:'+d.name.toLowerCase()+'|'+(d.source||'').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const r = _convertCondition(d);
    const row = {
      cat:'condition', name:d.name, _slug:r.index, _fromLocal:true,
      meta:'Condition', _source:d.source, desc:r.desc.join('\n'), _raw:r,
    };
    _applyFluff('condition', d.name, d.source, row);
    results.push(row);
  }

  // Human-readable label for the 5etools single-letter item type code.
  function _itemMeta(d, r){
    // Magic items: show rarity (capitalized) + attunement marker.
    if (r.rarity && r.rarity !== 'none' && r.rarity !== 'unknown'){
      return r.rarity.charAt(0).toUpperCase()+r.rarity.slice(1)
        + (r.requires_attunement?' · Attunement':'');
    }
    // Mundane items: show item type. Strip any "|SOURCE" suffix on type codes.
    const typeCode = (d.type || '').split('|')[0];
    return _ITEM_TYPE_LABEL[typeCode] || 'Item';
  }
  function addItem(d, variants) {
    const key = 'item:'+d.name.toLowerCase()+'|'+(d.source||'').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const r = _convertItem(d);
    const row = {
      cat:'item', name:d.name, _slug:r.index, _fromLocal:true,
      meta: _itemMeta(d, r),
      _source:d.source,
      _raw:r,
    };
    // Bonus-enchantment variants (+1 / +2 / +3) live alongside the base under
    // the same search entry. Each `_variants` element stores a label, full
    // raw data, and meta so the detail view can render tabs and swap the
    // stat block in place.
    if (variants && variants.length){
      row._variants = variants.map(v => {
        const cr = _convertItem(v.merged);
        return {
          label: v.label,
          name: v.merged.name,
          _source: v.merged.source,
          _raw: cr,
          meta: _itemMeta(v.merged, cr),
        };
      });
    }
    _applyFluff('item', d.name, d.source, row);
    results.push(row);
  }

  // ─── Magic variant generator ─────────────────────────────────────────────
  // 5etools generates magic items dynamically by combining base items from
  // items-base.json with templates from magicvariants.json (e.g. "+1
  // Longsword" = base "Longsword" + variant "+1 Weapon (Melee)"). We mirror
  // a simplified version of that pipeline so the search picks up the
  // thousands of pre-named magic-weapon/magic-armor variants players actually
  // expect to see.
  function _variantMatchesBase(req, base){
    // req is one entry from variant.requires[]. Each key must match base.
    // Keys we care about: type ("M"/"R"/"HA"/etc.), weapon, weaponCategory,
    // armor, etc. Type can include a "|SOURCE" filter.
    for (const k in req){
      const want = req[k];
      let have = base[k];
      if (k === 'type'){
        // type may be "HA" or "HA|XPHB". Plain code matches any source.
        const [wType, wSrc] = String(want).split('|');
        const [bType] = String(have||'').split('|');
        if (wType !== bType) return false;
        if (wSrc && (base.source||'').toUpperCase() !== wSrc.toUpperCase()) return false;
      } else if (typeof want === 'boolean'){
        if (!!have !== want) return false;
      } else if (Array.isArray(want)){
        if (!want.includes(have)) return false;
      } else {
        if (have !== want) return false;
      }
    }
    return true;
  }
  function _applyVariant(base, variant){
    // Merge variant.inherits into a clone of base; apply name prefix/suffix.
    const inh = variant.inherits || {};
    const merged = { ...base, ...inh };
    delete merged.namePrefix; delete merged.nameSuffix;
    const namePrefix = inh.namePrefix || '';
    const nameSuffix = inh.nameSuffix || '';
    merged.name = namePrefix + base.name + nameSuffix;
    // Variant's source wins; keep base's type/properties otherwise.
    merged.source = inh.source || base.source;
    // 5etools entry templates use {=propName} to splice merged properties
    // into descriptions (e.g. "{=bonusWeapon}" → "+1"). Resolve them here so
    // the rendered description reads cleanly.
    const sub = (s) => String(s).replace(/\{=(\w+)(?:\/[^}]*)?\}/g,
      (_, p) => (merged[p] != null ? String(merged[p]) : ''));
    const walk = (e) => {
      if (typeof e === 'string') return sub(e);
      if (Array.isArray(e)) return e.map(walk);
      if (e && typeof e === 'object'){
        const out = {};
        for (const k in e) out[k] = walk(e[k]);
        return out;
      }
      return e;
    };
    if (merged.entries) merged.entries = walk(merged.entries);
    return merged;
  }
  function expandMagicVariants(baseItems, variants){
    const out = [];
    // Pre-bucket base items by their `type` code (the dominant discriminator in
    // variant `requires`). The old code scanned ALL base items for EVERY
    // variant (variants × baseItems ≈ 100k predicate calls per cold load).
    // Since every base item has exactly one type, a variant whose requires all
    // specify a type only needs the union of those type-buckets — and that
    // union still contains every item that could match (an item matching a
    // req's type IS in that type's bucket; an item of another type fails that
    // req's type check anyway). So the result set is identical, just reached
    // without the full sweep.
    const byType = new Map();
    baseItems.forEach(b => {
      const tc = String(b.type || '').split('|')[0];
      let arr = byType.get(tc);
      if (!arr){ arr = []; byType.set(tc, arr); }
      arr.push(b);
    });
    (variants || []).forEach(v => {
      const reqs = Array.isArray(v.requires) ? v.requires : [];
      if (!reqs.length || !v.inherits) return;
      // 5etools `excludes` is sometimes a single object, sometimes an array
      // of objects. Each entry, ANY key match → exclude. Keys here use
      // arrays-as-OR rather than the AND semantics of `requires`.
      const excludesList = Array.isArray(v.excludes) ? v.excludes
                         : (v.excludes ? [v.excludes] : []);
      const isExcluded = (b) => excludesList.some(ex => {
        for (const k in ex){
          const want = ex[k];
          const have = b[k];
          if (Array.isArray(want)){ if (want.includes(have)) return true; }
          else if (have === want) return true;
        }
        return false;
      });
      // Narrow to candidate base items via the type buckets. If ANY req omits
      // `type`, it could match any item → fall back to the full list.
      let candidates;
      const typeCodes = new Set();
      let needsAll = false;
      for (const r of reqs){
        if (r.type == null){ needsAll = true; break; }
        typeCodes.add(String(r.type).split('|')[0]);
      }
      if (needsAll){
        candidates = baseItems;
      } else {
        candidates = [];
        typeCodes.forEach(tc => { const arr = byType.get(tc); if (arr) candidates = candidates.concat(arr); });
      }
      candidates.forEach(b => {
        if (isExcluded(b)) return;
        if (reqs.some(r => _variantMatchesBase(r, b))){
          out.push(_applyVariant(b, v));
        }
      });
    });
    return out;
  }

  function addFeat(d) {
    const key = 'feat:'+d.name.toLowerCase()+'|'+(d.source||'').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const r = _convertFeat(d);
    const row = {
      cat:'feat', name:d.name, _slug:r.index, _fromLocal:true,
      meta: r.prerequisite ? 'Prerequisite: '+r.prerequisite : 'Feat',
      _source:d.source,
      _raw:r,
    };
    _applyFluff('feat', d.name, d.source, row);
    results.push(row);
  }

  // Generic loader used for the long tail of reference categories. Most 5etools
  // entries follow the same shape: {name, source, entries:[…]}. We extract the
  // description text and keep _raw for the detail view.
  function addRef(cat, d, meta, opts) {
    if (!d || !d.name) return;
    opts = opts || {};
    const dedupeName = opts.dedupeKey || d.name;
    // Same dedup-by-source rule as addMonster/addSpell so reprints coexist.
    // Callers that synthesize a dedupeKey to disambiguate (e.g. subclasses)
    // already include enough uniqueness, so adding source is harmless there.
    const key = cat + ':' + dedupeName.toLowerCase() + '|' + ((d.source||'').toLowerCase());
    if (seen.has(key)) return;
    seen.add(key);
    const row = {
      cat: cat, name: opts.displayName || d.name, _slug: _toIndex(opts.displayName || d.name),
      _fromLocal: true,
      meta: meta || cat,
      _source: d.source,
      desc: _parseEntries(d.entries || []),
      _raw: d,
    };
    _applyFluff(cat, d.name, d.source, row);
    // Subclasses have no entries on the class object and no fluff text — fall
    // back to the resolved feature descriptions so the card isn't empty.
    if ((!row.desc || !row.desc.trim()) && d._featureDesc) row.desc = d._featureDesc;
    results.push(row);
  }

  const fetchFile = async (path) => {
    try {
      const r = await fetch(path);
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  };

  // Step 1: fetch index files to discover all available source files dynamically.
  // adventures.json is the master list of published adventures; we use the `id`
  // of each entry to construct the per-adventure content file path.
  const [bestiaryIdx, spellIdx, classIdx, bestiaryFluffIdx, advIndex] = await Promise.all([
    fetchFile('data/bestiary/index.json'),
    fetchFile('data/spells/index.json'),
    fetchFile('data/class/index.json'),
    fetchFile('data/bestiary/fluff-index.json'),
    fetchFile('data/adventures.json'),
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
  // Class fluff files mirror class data files: data/class/fluff-class-*.json.
  // They carry the prose description + multiclassing notes.
  const classFluffFiles = classIdx
    ? Object.values(classIdx).filter(f => !_skipKeys.has(f)).map(f => `data/class/fluff-${f}`)
    : [];
  // Fluff files contain the image references (path under img/) that 5etools' image
  // pack ships at. Loading these lets us point each monster card at its real portrait.
  const bestiaryFluffFiles = bestiaryFluffIdx
    ? Object.values(bestiaryFluffIdx).map(f => `data/bestiary/${f}`)
    : [];
  // Each published adventure has its full chapter content in a separate file
  // named adventure-{id-lowercase}.json under data/adventure/.
  const adventureFiles = advIndex && Array.isArray(advIndex.adventure)
    ? advIndex.adventure.map(a => 'data/adventure/adventure-' + (a.id||'').toLowerCase() + '.json')
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
    {path:'data/bastions.json',            arr:'facility',     cat:'facility'},
    {path:'data/languages.json',           arr:'language',     cat:'language'},
    {path:'data/cultsboons.json',          arr:'cult',         cat:'cult'},
    {path:'data/cultsboons.json',          arr:'boon',         cat:'boon'},
    {path:'data/actions.json',             arr:'action',       cat:'action'},
    {path:'data/skills.json',              arr:'skill',        cat:'skill'},
    {path:'data/senses.json',              arr:'sense',        cat:'sense'},
    {path:'data/charcreationoptions.json', arr:'charoption',   cat:'charoption'},
    {path:'data/decks.json',               arr:'deck',         cat:'deck'},
    {path:'data/recipes.json',             arr:'recipe',       cat:'recipe'},
    {path:'data/encounters.json',          arr:'encounter',    cat:'encounter'},
  ];
  const _refUniquePaths = [...new Set(_refSpecs.map(s => s.path))];

  // Long-tail fluff files: each one mirrors a category's primary data file but
  // contains the prose description + image references that 5etools splits out.
  // The data-loader merges these into the main entries via _fluffByCatKey, so
  // detail cards for vehicles, objects, items, etc. show pictures and text.
  const _FLUFF_SPECS = [
    {path:'data/fluff-vehicles.json',           arr:'vehicleFluff',          cat:'vehicle'},
    {path:'data/fluff-objects.json',            arr:'objectFluff',           cat:'object'},
    {path:'data/fluff-items.json',              arr:'itemFluff',             cat:'item'},
    {path:'data/fluff-bastions.json',           arr:'facilityFluff',         cat:'facility'},
    {path:'data/fluff-trapshazards.json',       arr:'trapFluff',             cat:'trap'},
    {path:'data/fluff-trapshazards.json',       arr:'hazardFluff',           cat:'hazard'},
    {path:'data/fluff-backgrounds.json',        arr:'backgroundFluff',       cat:'background'},
    {path:'data/fluff-races.json',              arr:'raceFluff',             cat:'race'},
    {path:'data/fluff-feats.json',              arr:'featFluff',             cat:'feat'},
    {path:'data/fluff-optionalfeatures.json',   arr:'optionalfeatureFluff',  cat:'optionalfeature'},
    {path:'data/fluff-rewards.json',            arr:'rewardFluff',           cat:'reward'},
    {path:'data/fluff-conditionsdiseases.json', arr:'conditionFluff',        cat:'condition'},
    {path:'data/fluff-languages.json',          arr:'languageFluff',         cat:'language'},
    {path:'data/fluff-charcreationoptions.json',arr:'charoptionFluff',       cat:'charoption'},
  ];
  const _fluffUniquePaths = [...new Set(_FLUFF_SPECS.map(s => s.path))];

  // Step 2: fetch all data files in parallel
  const [bestiaries, spellbooks, classBooks, classFluffBooks, conditionFiles, itemFile, baseItemFile, magicVariantFile, featFile, refFiles, bestiaryFluffs, adventureBooks, fluffFiles] = await Promise.all([
    Promise.all(bestiaryFiles.map(fetchFile)),
    Promise.all(spellFiles.map(fetchFile)),
    Promise.all(classFiles.map(fetchFile)),
    Promise.all(classFluffFiles.map(fetchFile)),
    Promise.all(_CONDITION_FILES.map(fetchFile)),
    fetchFile('data/items.json'),
    fetchFile('data/items-base.json'),
    fetchFile('data/magicvariants.json'),
    fetchFile('data/feats.json'),
    Promise.all(_refUniquePaths.map(fetchFile)),
    Promise.all(bestiaryFluffFiles.map(fetchFile)),
    Promise.all(adventureFiles.map(fetchFile)),
    Promise.all(_fluffUniquePaths.map(fetchFile)),
  ]);
  const _refByPath = {};
  _refUniquePaths.forEach((p, i) => { _refByPath[p] = refFiles[i]; });
  const _fluffByPath = {};
  _fluffUniquePaths.forEach((p, i) => { _fluffByPath[p] = fluffFiles[i]; });

  // Build the {cat → name|source → {desc, img}} lookup used by _applyFluff.
  // Skip any image whose imageType is 'map' or 'mapPlayer' so the hero portrait
  // wins over deck plans / regional maps when present.
  // Many fluff entries inherit from a base via {_copy:{name,source,_mod}} where
  // _mod adds the images via prependArr/appendArr. We index every fluff entry
  // across all files so copies can resolve into their parents.
  const _fluffRawByCatKey = {};
  _FLUFF_SPECS.forEach(spec => {
    const json = _fluffByPath[spec.path];
    if (!json) return;
    const arr = json[spec.arr] || [];
    const bucket = _fluffRawByCatKey[spec.cat] = _fluffRawByCatKey[spec.cat] || {};
    arr.forEach(f => {
      if (!f || !f.name) return;
      const k = ((f.name||'') + '|' + (f.source||'')).toLowerCase();
      bucket[k] = f;
    });
  });
  _FLUFF_SPECS.forEach(spec => {
    const json = _fluffByPath[spec.path];
    if (!json) return;
    const arr = json[spec.arr] || [];
    const bucket = _fluffByCatKey[spec.cat] = _fluffByCatKey[spec.cat] || {};
    arr.forEach(f => {
      if (!f || !f.name) return;
      const k = ((f.name||'') + '|' + (f.source||'')).toLowerCase();
      const resolved = f._copy ? _resolveCopy(f, _fluffRawByCatKey[spec.cat] || {}, 0) : f;
      const desc = _parseEntries(resolved.entries || []);
      let img = null;
      if (Array.isArray(resolved.images)) {
        const hero = resolved.images.find(im => im && im.href && im.href.path && im.imageType !== 'map' && im.imageType !== 'mapPlayer');
        if (hero) img = 'img/' + hero.href.path;
      }
      if (!desc && !img) return;
      bucket[k] = {desc, img};
    });
  });

  // Class fluff: each class has its own fluff file (fluff-class-*.json) with
  // the prose description. Merge into _fluffByCatKey['class'] so addRef('class')
  // picks up the desc.
  const classBucket = _fluffByCatKey['class'] = _fluffByCatKey['class'] || {};
  classFluffBooks.forEach(json => {
    if (!json) return;
    (json.classFluff || []).forEach(f => {
      if (!f || !f.name) return;
      const k = ((f.name||'') + '|' + (f.source||'')).toLowerCase();
      const desc = _parseEntries(f.entries || []);
      let img = null;
      if (Array.isArray(f.images)) {
        const hero = f.images.find(im => im && im.href && im.href.path && im.imageType !== 'map' && im.imageType !== 'mapPlayer');
        if (hero) img = 'img/' + hero.href.path;
      }
      if (desc || img) classBucket[k] = { desc, img };
    });
    // Subclass fluff lives in the same file under "subclassFluff".
    (json.subclassFluff || []).forEach(f => {
      if (!f || !f.name) return;
      const desc = _parseEntries(f.entries || []);
      if (!desc) return;
      const val = { desc, img: null };
      // _applyFluff looks up subclasses via addRef → _applyFluff('class',
      // d.name, d.source) where d.name is the BARE subclass name ("Alchemist"),
      // NOT the "Alchemist (Artificer)" display string. Keying only by the
      // display name (the old bug) meant the lookup never hit and every
      // subclass card fell through to raw feature text. Key by the bare
      // name|source so the lookup matches; also store the display-name variant
      // for any consumer that keys by the disambiguated name.
      classBucket[(f.name + '|' + (f.source||'')).toLowerCase()] = val;
      if (f.className) classBucket[(f.name + ` (${f.className})` + '|' + (f.source||'')).toLowerCase()] = val;
    });
  });

  // Monster fluff: same _copy resolution. Index everything first, then resolve
  // each entry so MM Frost Giant (which inherits images from "Giants" via
  // _copy._mod.images.prependArr) picks up its portrait.
  const _monsterImg = {};
  const _monsterFluffByKey = {};
  bestiaryFluffs.forEach(json => {
    if (!json) return;
    (json.monsterFluff || []).forEach(m => {
      if (!m || !m.name) return;
      const k = ((m.name||'') + '|' + (m.source||'')).toLowerCase();
      _monsterFluffByKey[k] = m;
    });
  });
  Object.entries(_monsterFluffByKey).forEach(([k, m]) => {
    const resolved = m._copy ? _resolveCopy(m, _monsterFluffByKey, 0) : m;
    if (!resolved.images || !resolved.images.length) return;
    const first = resolved.images.find(im => im && im.href && im.href.path && im.imageType !== 'map' && im.imageType !== 'mapPlayer');
    if (first) _monsterImg[k] = first.href.path;
  });

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
  // Index every itemEntry template (e.g. "Absorbing Tattoo|TCE") so items
  // that reference one via {#itemEntry …} can have it resolved during
  // _convertItem. Must run before the items.json + baseitem passes.
  _ITEM_ENTRY_BY_KEY = {};
  _ITEM_ENTRY_BY_NAME = {};
  ((baseItemFile?.itemEntry) || []).forEach(t => {
    if (!t || !t.name) return;
    _ITEM_ENTRY_BY_KEY[(t.name + '|' + (t.source||'')).toLowerCase()] = t;
    const nk = t.name.toLowerCase();
    if (!_ITEM_ENTRY_BY_NAME[nk]) _ITEM_ENTRY_BY_NAME[nk] = t; // first wins
  });

  if (itemFile) (itemFile.item||[]).forEach(d => addItem(d));
  // Base items: mundane gear / weapons / armor / tools.
  const baseItems = (baseItemFile?.baseitem) || [];

  if (magicVariantFile){
    const allVariants = magicVariantFile.magicvariant || [];
    // Split bonus enchantments ("+1 …", "+2 …", "+3 …") from named variants
    // (Adamantine, Mariner's, etc.). Bonus variants get attached as tabs to
    // their base item; named variants become standalone search entries.
    const bonusRe = /^\+\d+\s/;
    const bonusVariants = allVariants.filter(v => bonusRe.test(v.name||''));
    const namedVariants = allVariants.filter(v => !bonusRe.test(v.name||''));

    // Add each base item with its matching bonus variants attached as tabs.
    baseItems.forEach(b => {
      // Dedupe by tab label — both DMG and XDMG carry "+1 Weapon", but the
      // user only wants one "+1" tab. The first match wins.
      const byLabel = new Map();
      bonusVariants.forEach(v => {
        const reqs = Array.isArray(v.requires) ? v.requires : [];
        if (!reqs.length || !v.inherits) return;
        const excludesList = Array.isArray(v.excludes) ? v.excludes
                           : (v.excludes ? [v.excludes] : []);
        const excluded = excludesList.some(ex => {
          for (const k in ex){
            const want = ex[k]; const have = b[k];
            if (Array.isArray(want)){ if (want.includes(have)) return true; }
            else if (have === want) return true;
          }
          return false;
        });
        if (excluded) return;
        if (!reqs.some(r => _variantMatchesBase(r, b))) return;
        // Pull the "+N" label out of the variant name (e.g. "+1 Weapon" → "+1").
        const m = (v.name||'').match(/^(\+\d+)/);
        const label = m ? m[1] : v.name;
        if (byLabel.has(label)) return;
        byLabel.set(label, { label, merged: _applyVariant(b, v) });
      });
      // Sort tabs ascending: +1, +2, +3, etc.
      const matched = [...byLabel.values()].sort(
        (a,b) => parseInt(a.label) - parseInt(b.label)
      );
      addItem(b, matched);
    });

    // Standalone named variants (Adamantine Weapon, Mariner's Armor, etc.).
    expandMagicVariants(baseItems, namedVariants).forEach(d => addItem(d));
  } else {
    baseItems.forEach(d => addItem(d));
  }
  if (featFile) (featFile.feat||[]).forEach(addFeat);

  // Classes, subclasses, and class/subclass features.
  // For each class file we build feature lookup tables, then attach the
  // resolved feature list to each class/subclass row's _raw so the renderer
  // can show the per-level progression without doing async lookups.
  classBooks.forEach(json => {
    if (!json) return;
    // Build feature lookup tables for this file. Class features are keyed by
    // "name|className|source|level"; subclass features add subclassShortName + subclassSource.
    const classFeatByKey = {};
    (json.classFeature||[]).forEach(f => {
      const k = [f.name, f.className, f.source, f.level].map(s => String(s||'').toLowerCase()).join('|');
      classFeatByKey[k] = f;
    });
    const subFeatByKey = {};
    (json.subclassFeature||[]).forEach(f => {
      const k = [f.name, f.className, f.classSource, f.subclassShortName, f.subclassSource, f.level]
        .map(s => String(s||'').toLowerCase()).join('|');
      subFeatByKey[k] = f;
    });

    // 5etools reference strings often elide trailing pipe segments and leave
    // classSource/subclassSource empty (e.g. "Aberrant Mind|Sorcerer||Aberrant Mind|TCE|1"),
    // implying the default source ("PHB"). Try the exact lookup first, then
    // a small list of fallbacks.
    const _findClassFeat = (name, className, source, lvl) => {
      const tryKey = (n, c, s, l) => classFeatByKey[[n, c, s, l].map(x => String(x||'').toLowerCase()).join('|')];
      return tryKey(name, className, source, lvl)
        || (!source && tryKey(name, className, 'phb', lvl))
        || (!source && tryKey(name, className, 'xphb', lvl))
        || null;
    };
    const _findSubFeat = (name, className, classSource, scShort, scSource, lvl) => {
      const tryKey = (n, cn, cs, sn, ss, l) => subFeatByKey[[n, cn, cs, sn, ss, l].map(x => String(x||'').toLowerCase()).join('|')];
      return tryKey(name, className, classSource, scShort, scSource, lvl)
        || (!classSource && tryKey(name, className, 'phb', scShort, scSource, lvl))
        || (!classSource && tryKey(name, className, 'xphb', scShort, scSource, lvl))
        || (!scSource && tryKey(name, className, classSource, scShort, 'phb', lvl))
        || (!scSource && tryKey(name, className, classSource, scShort, 'xphb', lvl))
        || null;
    };

    (json.class||[]).forEach(d => {
      const hd = d.hd?.faces ? `Hit Die d${d.hd.faces}` : '';
      // Resolve classFeatures references → array of {name, level, entries}.
      const resolved = [];
      (d.classFeatures||[]).forEach(ref => {
        // Reference is either a string "Name|Class|Source|Level" or
        // {classFeature:"Name|Class|Source|Level", gainSubclassFeature?:bool}
        const refStr = typeof ref === 'string' ? ref : (ref.classFeature || '');
        if (!refStr) return;
        const [name, className, source, lvl] = refStr.split('|');
        const f = _findClassFeat(name, className, source, lvl);
        if (!f) return;
        resolved.push({
          name: f.name,
          level: parseInt(f.level) || 0,
          source: f.source,
          entries: f.entries || [],
        });
      });
      resolved.sort((a,b)=>a.level - b.level);
      d._resolvedFeatures = resolved;
      addRef('class', d, ['Class', hd].filter(Boolean).join(' · '));
    });

    (json.subclass||[]).forEach(d => {
      const display = d.name + (d.className?` (${d.className})`:'');
      const resolved = [];
      (d.subclassFeatures||[]).forEach(refStr => {
        if (typeof refStr !== 'string') return;
        const [name, className, classSource, scShort, scSource, lvl] = refStr.split('|');
        const f = _findSubFeat(name, className, classSource, scShort, scSource, lvl);
        if (!f) return;
        resolved.push({
          name: f.name,
          level: parseInt(f.level) || 0,
          source: f.source,
          entries: f.entries || [],
        });
      });
      resolved.sort((a,b)=>a.level - b.level);
      d._resolvedFeatures = resolved;
      // Build a description from concatenated feature entries so subclass cards
      // show prose immediately under the header (subclass fluff has none).
      const flatEntries = resolved.flatMap(f => f.entries);
      d._featureDesc = _parseEntries(flatEntries);
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

  // Adventures: master metadata entries + their top-level chapters as separate
  // searchable entries. Sub-sections within chapters are intentionally not
  // indexed — that would add tens of thousands of entries.
  if (advIndex && Array.isArray(advIndex.adventure)) {
    advIndex.adventure.forEach((adv, i) => {
      if (!adv || !adv.name) return;
      const file = adventureBooks[i];
      const chapters = file && Array.isArray(file.data)
        ? file.data.filter(ch => ch && ch.name).map(ch => ch.name)
        : [];
      const lvl = adv.level && adv.level.start
        ? `L${adv.level.start}${adv.level.end!=null?'–'+adv.level.end:''}`
        : '';
      const meta = ['Adventure', lvl, adv.storyline, adv.published].filter(Boolean).join(' · ');

      const advKey = 'adventure:' + adv.name.toLowerCase() + '|' + (adv.source||'').toLowerCase();
      if (!seen.has(advKey)) {
        seen.add(advKey);
        results.push({
          cat:'adventure', name:adv.name, _slug:_toIndex(adv.name), _fromLocal:true,
          meta, _source:adv.source,
          desc:'',
          _raw:{...adv, _chapters:chapters},
        });
      }

      // Top-level chapter entries (Chapter 1: …, Appendix A: …, etc.)
      if (file && Array.isArray(file.data)) {
        file.data.forEach(ch => {
          if (!ch || !ch.name) return;
          const display = `${ch.name} (${adv.id||adv.source||''})`;
          addRef('chapter', ch, `Chapter · ${adv.name}`, {displayName:display, dedupeKey:display});
        });
      }
    });
  }

  // Build the reprint-target index: for each entry that has a reprintedAs list,
  // record the new (name|source) it points to. Used by the "Hide 2024 reprints"
  // search-filter setting.
  _5eReprintTo = new Set();
  results.forEach(r => {
    const rs = r._raw && r._raw.reprintedAs;
    if (!Array.isArray(rs)) return;
    rs.forEach(ref => {
      if (typeof ref !== 'string') return;
      // Format is usually "Name|SOURCE" (sometimes just "Name")
      const parts = ref.split('|');
      const name = (parts[0] || '').trim();
      const src  = (parts[1] || '').trim();
      _5eReprintTo.add((name + '|' + src).toLowerCase());
    });
  });

  _5eData    = results;
  _5eLoaded  = true;
  _5eLoading = false;
  console.info(`[SKT] Loaded ${results.length} entries from local 5etools data.`);
  _5eCallbacks.forEach(cb => cb(_5eData));
  _5eCallbacks = [];
}
