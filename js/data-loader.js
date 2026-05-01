// ============================================================
// DATA LOADER — 5etools JSON → internal search format
// ============================================================
// Tries every known bestiary/spell/condition file under data/.
// Missing files (404) are silently skipped — copy as many or
// as few source files as you like.

const _BESTIARY_FILES = [
  'data/bestiary/bestiary-mm.json',
  'data/bestiary/bestiary-xmm.json',
  'data/bestiary/bestiary-vgm.json',
  'data/bestiary/bestiary-mtf.json',
  'data/bestiary/bestiary-mpmm.json',
  'data/bestiary/bestiary-ftd.json',
  'data/bestiary/bestiary-bgg.json',
  'data/bestiary/bestiary-tce.json',
  'data/bestiary/bestiary-idrotf.json',
  'data/bestiary/bestiary-wbtw.json',
  'data/bestiary/bestiary-scc.json',
  'data/bestiary/bestiary-ggr.json',
  'data/bestiary/bestiary-bgdia.json',
  'data/bestiary/bestiary-cos.json',
  'data/bestiary/bestiary-dmg.json',
  'data/bestiary/bestiary-egw.json',
  'data/bestiary/bestiary-erlw.json',
  'data/bestiary/bestiary-gos.json',
  'data/bestiary/bestiary-hotdq.json',
  'data/bestiary/bestiary-lmop.json',
  'data/bestiary/bestiary-oota.json',
  'data/bestiary/bestiary-phb.json',
  'data/bestiary/bestiary-pota.json',
  'data/bestiary/bestiary-rot.json',
  'data/bestiary/bestiary-toa.json',
  'data/bestiary/bestiary-tftyp.json',
  'data/bestiary/bestiary-ai.json',
  'data/bestiary/bestiary-llk.json',
  'data/bestiary/bestiary-rmbre.json',
  'data/bestiary/bestiary-sads.json',
  'data/bestiary/bestiary-sdw.json',
  'data/bestiary/bestiary-slw.json',
  'data/bestiary/bestiary-dc.json',
  'data/bestiary/bestiary-dip.json',
  'data/bestiary/bestiary-dod.json',
  'data/bestiary/bestiary-dodk.json',
  'data/bestiary/bestiary-dsotdq.json',
  'data/bestiary/bestiary-hat-tg.json',
  'data/bestiary/bestiary-hol.json',
  'data/bestiary/bestiary-kftgv.json',
  'data/bestiary/bestiary-mabjov.json',
  'data/bestiary/bestiary-mff.json',
  'data/bestiary/bestiary-pabtso.json',
  'data/bestiary/bestiary-psi.json',
  'data/bestiary/bestiary-qftis.json',
  'data/bestiary/bestiary-skt.json',
  'data/bestiary/bestiary-veor.json',
  'data/bestiary/bestiary-xdmg.json',
  'data/bestiary/bestiary-xphb.json',
];

const _SPELL_FILES = [
  'data/spells/spells-phb.json',
  'data/spells/spells-xphb.json',
  'data/spells/spells-xge.json',
  'data/spells/spells-tce.json',
  'data/spells/spells-ai.json',
  'data/spells/spells-egw.json',
  'data/spells/spells-ftd.json',
  'data/spells/spells-llk.json',
  'data/spells/spells-scc.json',
  'data/spells/spells-idrotf.json',
  'data/spells/spells-xdmg.json',
];

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
      meta:'Condition', desc:r.desc.join('\n'), _raw:r,
    });
  }

  const fetchFile = async (path) => {
    try {
      const r = await fetch(path);
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  };

  // Load all files in parallel
  const [bestiaries, spellbooks, conditionFiles] = await Promise.all([
    Promise.all(_BESTIARY_FILES.map(fetchFile)),
    Promise.all(_SPELL_FILES.map(fetchFile)),
    Promise.all(_CONDITION_FILES.map(fetchFile)),
  ]);

  bestiaries.forEach(json  => json && (json.monster||[]).forEach(addMonster));
  spellbooks.forEach(json  => json && (json.spell||[]).forEach(addSpell));
  conditionFiles.forEach(json => {
    if (!json) return;
    (json.condition||[]).forEach(addCondition);
    // conditionsdiseases.json also contains diseases — skip those
  });

  _5eData    = results;
  _5eLoaded  = true;
  _5eLoading = false;
  console.info(`[SKT] Loaded ${results.length} entries from local 5etools data.`);
  _5eCallbacks.forEach(cb => cb(_5eData));
  _5eCallbacks = [];
}
