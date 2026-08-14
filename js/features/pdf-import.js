// ============================================================
// PDF IMPORT — D&D Beyond character sheet → party tracker
// ============================================================
// Lazy-loads pdf.js from CDN on first use, then parses the text
// content of a D&D Beyond PDF export and extracts core fields.
//
// D&D Beyond's "Print to PDF" sheet renders text positionally (not
// as form fields), so we extract every text item with its (x,y)
// coordinates and use label-proximity matching to find values.

let _pdfJsPromise = null;
const _PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const _PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

function loadPdfJs(){
  if (_pdfJsPromise) return _pdfJsPromise;
  _pdfJsPromise = new Promise((resolve, reject) => {
    if (window.pdfjsLib){ resolve(window.pdfjsLib); return; }
    const s = document.createElement('script');
    s.src = _PDFJS_URL;
    s.onload = () => {
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = _PDFJS_WORKER;
        resolve(window.pdfjsLib);
      } catch(e){ reject(e); }
    };
    s.onerror = () => reject(new Error('Failed to load pdf.js'));
    document.head.appendChild(s);
  });
  return _pdfJsPromise;
}

// Pulls every text item from every page and tags each with the page index.
// Returns a flat array of {str, x, y, w, h, page} sorted top→bottom, left→right.
async function pdfTextItems(file){
  const pdfjs = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({data: new Uint8Array(buf)}).promise;
  const all = [];
  for (let i = 1; i <= doc.numPages; i++){
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    tc.items.forEach(it => {
      const str = (it.str || '').trim();
      if (!str) return;
      // PDF coords are origin-bottom-left; we flip to top-left for easier reading.
      const x = it.transform[4];
      const y = it.transform[5];
      all.push({ str, x, y, w: it.width || 0, h: it.height || 0, page: i });
    });
  }
  return all;
}

// Find the text item whose .str equals (case-insensitive) the given label,
// optionally restricted to a particular page.
function _findLabel(items, label, page){
  const target = label.toLowerCase();
  return items.find(it => (page == null || it.page === page) && it.str.toLowerCase() === target);
}

// Find the value visually associated with a label: the closest non-label text
// item that's either directly below it (within <30pt) or to the right
// (within <120pt and on roughly the same line).
function _valueNear(items, label, opts={}){
  const li = _findLabel(items, label, opts.page);
  if (!li) return null;
  let best = null, bestScore = Infinity;
  for (const it of items){
    if (it === li || it.page !== li.page) continue;
    const dx = it.x - li.x;
    const dy = li.y - it.y; // larger means further BELOW
    let score;
    // Below: prefer small positive dy and small horizontal offset
    if (dy > 0 && dy < (opts.maxBelow || 28) && Math.abs(dx) < (opts.maxDx || 90)){
      score = dy + Math.abs(dx)*0.3;
    }
    // Right on same line
    else if (Math.abs(dy) < 6 && dx > 0 && dx < (opts.maxRight || 200)){
      score = dx;
    } else continue;
    if (score < bestScore){ bestScore = score; best = it; }
  }
  return best ? best.str : null;
}

// Look for a number near a label. Strips any non-digit characters except a
// leading minus. Returns null if no usable value found.
function _numNear(items, label, opts={}){
  // Try same-page-as-label first; if multiple matches across pages, the first
  // typically wins. Pull a few candidates and pick the first that looks numeric.
  const li = _findLabel(items, label, opts.page);
  if (!li) return null;
  const cands = items
    .filter(it => it !== li && it.page === li.page)
    .map(it => {
      const dx = it.x - li.x;
      const dy = li.y - it.y;
      let score;
      if (dy > 0 && dy < (opts.maxBelow || 36) && Math.abs(dx) < (opts.maxDx || 60)){
        score = dy + Math.abs(dx)*0.2;
      } else if (Math.abs(dy) < 6 && dx > 0 && dx < (opts.maxRight || 200)){
        score = dx;
      } else return null;
      return { it, score };
    })
    .filter(Boolean)
    .sort((a,b) => a.score - b.score);
  for (const { it } of cands){
    const m = it.str.match(/-?\d+/);
    if (m) return parseInt(m[0]);
  }
  return null;
}

// Read every AcroForm widget on every page and return a {fieldName: value} map.
// Empty values and non-Widget annotations are skipped.
async function pdfFormFields(file){
  const pdfjs = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({data: new Uint8Array(buf)}).promise;
  const fields = {};
  for (let i = 1; i <= doc.numPages; i++){
    const page = await doc.getPage(i);
    const annots = await page.getAnnotations();
    annots.forEach(a => {
      if (a.subtype !== 'Widget') return;
      if (!a.fieldName) return;
      const v = a.fieldValue;
      if (v == null || v === '') return;
      // Some fields hold arrays (multi-select) or booleans (checkboxes); skip
      // those for now — we want simple text/number values.
      if (typeof v === 'object') return;
      fields[a.fieldName] = v;
    });
  }
  return fields;
}

// Pull values out of a {fieldName: value} map using a known list of D&D Beyond
// Form-Fillable Character Sheet field names.
function _fromFields(f){
  // Stash the full field list on window so user can inspect any field by name
  // even if the console truncates the array printout.
  window._pdfFields = f;
  const _allKeys = Object.keys(f);
  console.log('[PDF Import] AcroForm fields ('+_allKeys.length+') — try `_pdfFields` in console to inspect any field. All keys:', _allKeys.join(' | '));
  // Look up a field by any of several aliases. Tolerates whitespace and case
  // variants — different sheet templates use "Class & Level" vs "ClassLevel".
  const norm = s => String(s).replace(/\s+/g,'').toLowerCase();
  const keyNorm = {};
  Object.keys(f).forEach(k => { keyNorm[norm(k)] = k; });
  const get = (...names) => {
    for (const n of names){
      const real = keyNorm[norm(n)];
      if (real != null) return f[real];
    }
    return null;
  };
  const num = (...names) => {
    const v = get(...names); if (v == null) return null;
    const m = String(v).match(/-?\d+/); return m ? parseInt(m[0]) : null;
  };

  const name = get('CharacterName', 'Character Name');
  let classLevel = get('ClassLevel', 'CLASS & LEVEL', 'Class & Level', 'Class and Level');
  let cls = null, level = null, classLevels = null, subclassHint = null;
  if (classLevel){
    // "Rogue (Thief) 6" — the parenthetical is the subclass. Taken out before
    // the pair matcher runs, which otherwise stops at the bracket and hands
    // back the whole string as a class name.
    const paren = String(classLevel).match(/\(([^)]+)\)/);
    if (paren) subclassHint = paren[1].trim();
    classLevel = String(classLevel).replace(/\([^)]*\)/g, ' ');
  }
  if (classLevel){
    // Multiclass sheets write "Wizard 5 / Fighter 3". The old pattern was
    // anchored at the start and stopped after the first pair, so a level-8
    // character imported as a level-5 wizard with 5 hit dice and the fighter
    // half thrown away. Collect every class/level pair instead.
    const parts = String(classLevel).match(/[A-Za-z][A-Za-z ]*?\s+\d{1,2}\b/g) || [];
    const split = parts.map(p => {
      const m = p.match(/^([A-Za-z][A-Za-z ]*?)\s+(\d{1,2})$/);
      return { cls: m[1].trim(), level: parseInt(m[2]) };
    });
    if (split.length){
      // `cls` stays a BARE class name. The party panel matches it against the
      // 5etools dataset with `d.name.toLowerCase() === clsName`, so storing
      // the joined "Wizard 5 / Fighter 3" here would silently drop the whole
      // class- and subclass-features tab. The split rides along on the sheet
      // instead, which is what keeps feature gating honest (see _tabFeatures).
      cls = split.reduce((a, b) => (b.level > a.level ? b : a)).cls;
      level = split.reduce((s, p) => s + p.level, 0);
      if (split.length > 1) classLevels = split;
    } else {
      cls = String(classLevel).trim();
    }
  }
  const race       = get('Race');
  const background = get('Background');
  const alignment  = get('Alignment');
  const ac         = num('AC', 'Armor Class', 'ArmorClass');
  let init         = num('Initiative', 'Init', 'InitiativeBonus', 'Init Bonus',
                         'InitiativeMod', 'InitMod');
  const speed      = num('Speed');
  let hpMax = num('HPMax', 'HitPointMaximum', 'Hit Point Maximum',
                  'HP Max', 'MaxHP', 'MaximumHitPoints', 'HitPoints');
  let hp    = num('HPCurrent', 'HP', 'CurrentHitPoints', 'Current Hit Points',
                  'HP Current', 'CurrentHP', 'HitPointCurrent');
  if (hp == null && hpMax != null) hp = hpMax;
  const abilities = {
    str: num('STR'), dex: num('DEX'), con: num('CON'),
    int: num('INT'), wis: num('WIS'), cha: num('CHA'),
  };
  // DEX-mod fallback for initiative (RAW for any non-Alert character).
  if (init == null && abilities.dex != null){
    init = Math.floor((abilities.dex - 10) / 2);
  }
  // Hit dice — D&D Beyond uses "HDTotal" or "Hit Dice" for current pool,
  // and the die size is determined by class. Fall back to deriving from
  // class + level if the field isn't directly present.
  //
  // Multiclass note: the pool size is now the full character level, which is
  // right, but the die type is the primary class's. A Wizard 5 / Fighter 3
  // really has 5d6 + 3d10 and the model holds a single die, so it imports as
  // 8d6 — understated, and better than the 5d6 it used to get. Do NOT alias
  // this template's "Total" field ("5d6 + 3d10") in here: _deriveHitDice reads
  // it as the *current* pool, so it would report 5 of 8 dice remaining.
  const hdTotalRaw = get('HDTotal', 'HD Total', 'Hit Dice', 'HitDice');
  const hd = _deriveHitDice(cls, level, hdTotalRaw);

  // Skills — standard 5e Form-Fillable field names. Each is the total bonus.
  const skillDefs = [
    ['acrobatics','Acrobatics'],
    ['animalHandling','Animal','AnimalHandling','Animal Handling'],
    ['arcana','Arcana'],
    ['athletics','Athletics'],
    ['deception','Deception'],
    ['history','History'],
    ['insight','Insight'],
    ['intimidation','Intimidation'],
    ['investigation','Investigation'],
    ['medicine','Medicine'],
    ['nature','Nature'],
    ['perception','Perception'],
    ['performance','Performance'],
    ['persuasion','Persuasion'],
    ['religion','Religion'],
    ['sleightOfHand','SleightofHand','Sleight of Hand'],
    ['stealth','Stealth'],
    ['survival','Survival'],
  ];
  const skills = {};
  skillDefs.forEach(([key, ...aliases]) => {
    const v = num(...aliases);
    if (v != null) skills[key] = v;
  });

  // Saving throws
  const saveDefs = [
    ['str','ST Strength','STStrength','StrengthSave','Strength-save'],
    ['dex','ST Dexterity','STDexterity','DexteritySave','Dexterity-save'],
    ['con','ST Constitution','STConstitution','ConstitutionSave','Constitution-save'],
    ['int','ST Intelligence','STIntelligence','IntelligenceSave','Intelligence-save'],
    ['wis','ST Wisdom','STWisdom','WisdomSave','Wisdom-save'],
    ['cha','ST Charisma','STCharisma','CharismaSave','Charisma-save'],
  ];
  const saves = {};
  saveDefs.forEach(([key, ...aliases]) => {
    const v = num(...aliases);
    if (v != null) saves[key] = v;
  });

  const profBonus = num('ProfBonus', 'Proficiency Bonus', 'ProficiencyBonus');
  // "Passive1" is this template's passive Perception (Passive2 = Insight,
  // Passive3 = Investigation). Confirmed on two real sheets: both equal
  // 10 + the matching skill bonus exactly, so it agrees with the value the
  // party panel derives — it just also covers sheets whose skill rows are blank.
  const passivePerception = num('Passive', 'PassiveWisdom', 'Passive Wisdom (Perception)', 'PassivePerception', 'Passive1');

  // Free-text panels.
  const sStr = (...aliases) => String(get(...aliases) || '').trim();
  const languages = sStr('ProficienciesLang','Languages','Other Proficiencies & Languages','OtherProfs');
  const bio = {
    backstory: sStr('Backstory'),
    traits:    sStr('PersonalityTraits','Personality Traits'),
    ideals:    sStr('Ideals'),
    bonds:     sStr('Bonds'),
    flaws:     sStr('Flaws'),
    allies:    sStr('Allies','AlliesOrgs','Allies & Organizations'),
    features:  sStr('Feat+Traits','FeaturesandTraits','Features and Traits','Features+Traits'),
  };

  // Attacks — standard 5e form has 3 weapon slots ("Wpn Name", "Wpn Name 2", "Wpn Name 3").
  const attacks = [];
  for (let n = 1; n <= 3; n++){
    const nameKey = n === 1 ? 'Wpn Name' : `Wpn Name ${n}`;
    const aname = sStr(nameKey, `WpnName${n}`, `Weapon ${n} Name`);
    if (!aname) continue;
    attacks.push({
      name: aname,
      atkBonus: sStr(`Wpn${n} AtkBonus`, `Wpn${n}AtkBonus`, `Weapon ${n} Atk`),
      damage:   sStr(`Wpn${n} Damage`, `Wpn${n}Damage`, `Weapon ${n} Damage`),
    });
  }

  // Spell slots — DDB form uses "SlotsTotal 19" / "SlotsRemaining 19" pattern
  // where suffix 19 = level 1, 20 = level 2, etc. Some templates use suffixes
  // 28..35 for the L1..L9 expended row (or vice versa). Fall back to scanning
  // every "SlotsTotal N" key and assigning them in order.
  const spellSlots = {};
  for (let lvl = 1; lvl <= 9; lvl++){
    const t = num(`SlotsTotal ${18+lvl}`, `SpellSlots${lvl}Total`, `SpellSlotsTotal${lvl}`, `SpellSlots${lvl}`,
                  `Slots Total ${lvl}`, `L${lvl}SlotsTotal`, `${lvl}stLvlSlotsTotal`);
    const r = num(`SlotsRemaining ${18+lvl}`, `SpellSlots${lvl}Remaining`, `SpellSlotsRemaining${lvl}`,
                  `Slots Remaining ${lvl}`, `L${lvl}SlotsExpended`, `${lvl}stLvlSlotsRemaining`);
    if (t != null && t > 0){
      spellSlots[lvl] = { total: t, expended: r != null ? Math.max(0, t - r) : 0 };
    }
  }
  const spellSaveDc = num('SpellSaveDC','Spell save DC','SpellSaveDc','Spell Save DC');
  const spellAtkBonus = num('SpellAtkBonus','Spell Attack Bonus','SpellAtk','Spell Atk Bonus');

  // Spell list — try the indexed DDB format first ("spellName0", "spellName1"…),
  // grouped by section markers in "spellHeader0/1/2…" ("=== CANTRIPS ===",
  // "=== 1st LEVEL ===", etc.). Order in the PDF is: header, slot info, then
  // a run of named spells until the next header.
  let spells = [];
  // Indexed DDB template: collect all spellNameN, plus walk spellHeaderN/spellSlotHeaderN to determine levels.
  const indexedNames = [];
  Object.keys(f).forEach(k => {
    const m = k.match(/^spellName(\d+)$/);
    if (!m) return;
    const idx = parseInt(m[1]);
    const v = String(f[k] || '').trim();
    if (v) indexedNames.push({ idx, name: v });
  });
  if (indexedNames.length){
    indexedNames.sort((a,b)=>a.idx-b.idx);
    spells = indexedNames.map(x => x.name);
  } else {
    // Fall back to standard 5e form ("Spells 1014" etc.) — sweep any field whose
    // name starts with "spell" (case-insensitive) and isn't a metadata field.
    const SPELL_META_KEYS = /^(spell\s*)?(slots?|save|atk|attack|casting|ability|class|mod|dc|bonus|level|name|header|prepared|source|range|components|duration|page|notes|time|hit)\b/i;
    Object.keys(f).forEach(k => {
      const kt = k.replace(/\s+/g,' ').trim();
      if (!/^spell/i.test(kt)) return;
      if (SPELL_META_KEYS.test(kt)) return;
      const v = String(f[k] || '').trim();
      if (!v || /^\d+$/.test(v)) return;
      if (v.length < 2 || v.length > 80) return;
      spells.push(v);
    });
  }
  const spellsUniq = [...new Set(spells)];

  // Spell slots — DDB indexed template stores per-section pip strings like
  // "4 Slots OOOO" in spellSlotHeader0, spellSlotHeader1, etc. Section index
  // doesn't directly equal spell level (section 0 is usually cantrips, no slots),
  // so walk both spellHeader and spellSlotHeader together.
  const slotHeaders = [];
  Object.keys(f).forEach(k => {
    const m = k.match(/^spellSlotHeader(\d+)$/);
    if (!m) return;
    const idx = parseInt(m[1]);
    slotHeaders.push({ idx, raw: String(f[k]||'').trim(), header: String(f['spellHeader'+idx] || '').trim() });
  });
  if (slotHeaders.length && Object.keys(spellSlots).length === 0){
    slotHeaders.sort((a,b)=>a.idx-b.idx);
    slotHeaders.forEach(s => {
      // Skip cantrip sections (no slots). Detect by header or empty slot string.
      if (/cantrip/i.test(s.header)) return;
      if (!s.raw) return;
      // Pull total slots from leading number, expended from filled circles.
      // Warlocks don't say "Slots" at all — a level-6 warlock's section 3 reads
      // "2 Pact OO". Without the pact alternative the match failed and every
      // warlock imported with zero spell slots (verified against a real sheet).
      const m = s.raw.match(/(\d+)\s*(?:pact\s*)?slots?\b/i) || s.raw.match(/^\s*(\d+)\s*pact\b/i);
      if (!m) return;
      const total = parseInt(m[1]);
      // Determine level from header text: "=== 1st LEVEL ===" → 1, "2nd" → 2, etc.
      const lvlMatch = s.header.match(/(\d+)\s*(?:st|nd|rd|th)/i);
      const lvl = lvlMatch ? parseInt(lvlMatch[1]) : null;
      if (!lvl || lvl < 1 || lvl > 9) return;
      // Filled vs empty pip count from the slot string. DDB uses "●" or "X" for
      // expended and "O" / "○" for available; treat anything matching common
      // "expended" glyphs as spent.
      const expended = (s.raw.match(/[●Xx✓✔■▲]/g) || []).length;
      spellSlots[lvl] = { total, expended: Math.min(expended, total) };
    });
  }

  // Spellcasting metadata — DDB indexed template uses spellSaveDC0, spellAtkBonus0
  let _spellSaveDc = spellSaveDc;
  let _spellAtkBonus = spellAtkBonus;
  if (_spellSaveDc == null) _spellSaveDc = num('spellSaveDC0','spellSaveDc0');
  if (_spellAtkBonus == null) _spellAtkBonus = num('spellAtkBonus0','spellAtkBonus 0');

  // Diagnostic.
  const spellLikeKeys = Object.keys(f).filter(k => /spell|slot/i.test(k));
  console.log('[PDF Import] spell-related fields ('+spellLikeKeys.length+'), extracted spells ('+spellsUniq.length+'), slots:', spellSlots);

  // Best-effort, and honest about it: an explicit field if the template has
  // one, then the parenthetical from Class & Level, then the Features & Traits
  // prose. Null when the sheet simply doesn't say.
  const subclass = _matchSubclass(cls, [
    get('Subclass', 'SubClass', 'Archetype', 'ClassArchetype', 'Sub Class', 'ClassSubclass'),
    subclassHint,
    bio.features,
  ]);
  const feats = _matchFeats(bio.features);
  const resources = _deriveResources(
    classLevels || (cls && level ? [{ cls, level }] : []), abilities);

  const sheet = {
    skills, saves, profBonus, passivePerception, classLevels,
    languages, attacks, spellSlots,
    spellSaveDc: _spellSaveDc, spellAtkBonus: _spellAtkBonus,
    spells: spellsUniq, bio,
  };

  const def = _parseDefenses(get('Defenses', 'Defences', 'Resistances',
                                 'DamageResistances', 'Damage Resistances'));

  return {
    name: String(name||''),
    cls, level, subclass, feats, resources,
    race: String(race||''),
    background: String(background||''),
    alignment: String(alignment||''),
    hp, hpMax, ac, init, speed,
    abilities,
    hitDice: hd,
    resistances: def.resistances,
    immunities: def.immunities,
    vulnerabilities: def.vulnerabilities,
    sheet,
    _rawFields: f,
  };
}

// ── Subclass, feats, class resources ────────────────────────────────────────
// None of the three were imported, and all three matter more than they used to:
// subclass gates both the Features tab and the Turn View's reaction derivation
// (79 of 101 reactions come from a subclass), feats are 17 more, and the
// resource pools are what those reactions spend. An imported character behaved
// differently from a hand-entered one, which is the whole thing this is meant
// to avoid.
//
// Subclass and feats are matched against the LOADED 5e data rather than a list
// written here, because a list written here goes stale the moment a book is
// added. Both are best-effort: the sheet may simply not say.

function _wordIn(hay, needle){
  const n = String(needle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^a-z0-9])' + n + '($|[^a-z0-9])', 'i').test(hay);
}

// Candidate strings in priority order; the first that resolves wins. Returns
// the 5etools SHORT name ("Moon", "Thief"), which is what the reaction table
// keys on and what the party panel's fuzzy lookup also accepts.
function _matchSubclass(cls, candidates){
  if (typeof _5eData === 'undefined' || typeof _5eLoaded === 'undefined' || !_5eLoaded) return null;
  if (!cls) return null;
  const c = String(cls).toLowerCase();
  const subs = [];
  _5eData.forEach(d => {
    if (d.cat !== 'class' || !d._raw || !d._raw.subclassFeatures) return;
    if (String(d._raw.className || '').toLowerCase() !== c) return;
    const short = String(d._raw.shortName || '').trim();
    const full  = String(d._raw.name || d.name.replace(/\s*\([^)]*\)\s*$/, '')).trim();
    if (short || full) subs.push({ short: short || full, full: full || short });
  });
  if (!subs.length) return null;
  // Longest form first: "Circle of the Moon" has to win over "Moon", or a
  // features box mentioning Moonbeam decides a druid's subclass.
  const forms = [];
  subs.forEach(s => {
    forms.push({ text: s.full, short: s.short });
    if (s.short && s.short.length >= 4 && s.short !== s.full) forms.push({ text: s.short, short: s.short });
  });
  forms.sort((a, b) => b.text.length - a.text.length);
  // A bare string iterates as characters and silently matches nothing, which
  // is a failure mode with no symptom. Accept either shape.
  for (const cand of (Array.isArray(candidates) ? candidates : [candidates])){
    const hay = String(cand || '');
    if (!hay.trim()) continue;
    for (const f of forms) if (_wordIn(hay, f.text)) return f.short;
  }
  return null;
}

// Feat names found in the sheet's free-text Features & Traits box. Nothing
// else in a character sheet lists them in a structured way.
const _FEAT_SKIP = /^(ability score improvement)$/i;
function _matchFeats(text){
  if (typeof _5eData === 'undefined' || typeof _5eLoaded === 'undefined' || !_5eLoaded) return [];
  const hay = String(text || '');
  if (!hay.trim()) return [];
  const names = new Set();
  _5eData.forEach(d => { if (d.cat === 'feat' && d.name && !_FEAT_SKIP.test(d.name)) names.add(d.name); });
  const out = [];
  [...names].sort((a, b) => b.length - a.length).forEach(n => {
    if (_wordIn(hay, n) && !out.some(o => _wordIn(o, n))) out.push(n);
  });
  return out.sort();
}

// Class resources by class and level, PHB 2014. Derived the same way hit dice
// already are — the sheet doesn't carry these as fields, but they follow from
// two numbers it does carry. Names match the ones the party tracker and the
// Turn View's reaction costs already use ("Rage", "Bardic Inspiration"), so a
// derived pool is spendable the moment it appears.
function _deriveResources(pairs, abilities){
  const mod = k => (abilities && typeof abilities[k] === 'number') ? Math.floor((abilities[k] - 10) / 2) : 0;
  const out = [];
  const pool   = (name, n) => { if (n > 0) out.push({ name, type:'pool',   current:n, max:n }); };
  const toggle = (name)    => out.push({ name, type:'toggle', current:1, max:1 });
  const band = (lvl, steps) => { let v = 0; steps.forEach(([at, n]) => { if (lvl >= at) v = n; }); return v; };

  pairs.forEach(({ cls, level }) => {
    const c = String(cls || '').toLowerCase(), L = level || 0;
    if (!c || !L) return;
    if (c === 'barbarian'){
      pool('Rage', band(L, [[1,2],[3,3],[6,4],[12,5],[17,6]]));
      if (L >= 2) toggle('Reckless Attack');
    } else if (c === 'bard'){
      pool('Bardic Inspiration', Math.max(1, mod('cha')));
    } else if (c === 'cleric'){
      pool('Channel Divinity', band(L, [[2,1],[6,2],[18,3]]));
    } else if (c === 'druid'){
      if (L >= 2) pool('Wild Shape', 2);
    } else if (c === 'fighter'){
      pool('Second Wind', 1);
      if (L >= 2) pool('Action Surge', L >= 17 ? 2 : 1);
      if (L >= 9) pool('Indomitable', band(L, [[9,1],[13,2],[17,3]]));
    } else if (c === 'monk'){
      if (L >= 2) pool('Ki Points', L);
    } else if (c === 'paladin'){
      pool('Lay on Hands', L * 5);
      if (L >= 3) pool('Channel Divinity', 1);
    } else if (c === 'rogue'){
      toggle('Sneak Attack');
    } else if (c === 'sorcerer'){
      if (L >= 2) pool('Sorcery Points', L);
    } else if (c === 'wizard'){
      pool('Arcane Recovery', 1);
    } else if (c === 'artificer'){
      if (L >= 7) pool('Flash of Genius', Math.max(1, mod('int')));
    }
  });
  // A multiclass paladin/cleric has one Channel Divinity pool, not two.
  const seen = new Map();
  out.forEach(r => { const p = seen.get(r.name); if (!p || r.max > p.max) seen.set(r.name, r); });
  return [...seen.values()];
}

const _PDF_DMG_TYPES = ['acid','bludgeoning','cold','fire','force','lightning','necrotic',
                        'piercing','poison','psychic','radiant','slashing','thunder'];

// Parse a free-text defenses line into the three lists the party card already
// understands (c.resistances / c.immunities / c.vulnerabilities, lowercase
// damage types — see party.js `_renderResistances`). Real sheets write things
// like "Resistances - Radiant, Necrotic", and may combine buckets in one field:
// "Resistances - Fire; Immunity - Poison".
//
// Headings are located by index and each run of text between them is assigned
// to the bucket its heading opened; text before any heading falls into
// resistances, which is what an unlabelled "Resistances" field means.
// Anything that isn't one of the 13 damage types is ignored, so prose such as
// "from nonmagical attacks" contributes nothing rather than guessing.
function _parseDefenses(raw){
  const out = { resistances: [], immunities: [], vulnerabilities: [] };
  const s = String(raw || '').toLowerCase();
  if (!s.trim()) return out;

  const heads = [];
  const re = /(resist\w*|immun\w*|vulner\w*)/g;
  let m;
  while ((m = re.exec(s))) {
    heads.push({
      at: m.index,
      end: re.lastIndex,
      key: m[1][0] === 'r' ? 'resistances' : m[1][0] === 'i' ? 'immunities' : 'vulnerabilities',
    });
  }

  const add = (key, from, to) => {
    const seg = s.slice(from, to);
    _PDF_DMG_TYPES.forEach(t => {
      if (seg.includes(t) && !out[key].includes(t)) out[key].push(t);
    });
  };

  if (!heads.length) { add('resistances', 0, s.length); return out; }
  if (heads[0].at > 0) add('resistances', 0, heads[0].at);
  heads.forEach((h, i) => add(h.key, h.end, i + 1 < heads.length ? heads[i + 1].at : s.length));
  return out;
}

// 5e hit-die size by class (default d8 for unknowns/multiclass).
const _HD_BY_CLASS = {
  barbarian:'d12', fighter:'d10', paladin:'d10', ranger:'d10',
  bard:'d8', cleric:'d8', druid:'d8', monk:'d8', rogue:'d8', warlock:'d8', artificer:'d8',
  sorcerer:'d6', wizard:'d6',
};
function _deriveHitDice(cls, level, hdRaw){
  const dieType = cls ? (_HD_BY_CLASS[cls.toLowerCase()] || 'd8') : 'd8';
  const max = level || 1;
  // hdRaw might be "5d8" or "5" or null. Try to parse a leading number.
  let current = max;
  if (hdRaw){
    const m = String(hdRaw).match(/(\d+)/);
    if (m) current = Math.min(max, parseInt(m[1]));
  }
  return { current, max, dieType };
}

// Positional fallback for non-fillable PDFs that nonetheless render the
// 5e default sheet layout. Less reliable than form-field extraction, but
// handles PDFs where someone "printed to PDF" and lost the form fields.
async function _fromPositionalText(file){
  const items = await pdfTextItems(file);
  const fullText = items.map(it => it.str).join(' ');

  let name = _valueNear(items, 'CHARACTER NAME', {page:1, maxBelow:40, maxDx:140});
  if (!name){
    const top = items
      .filter(it => it.page === 1)
      .sort((a,b) => b.y - a.y)
      .find(it => it.str.length >= 3 && !/^[A-Z\s]+$/.test(it.str));
    if (top) name = top.str;
  }

  let classLevel = _valueNear(items, 'CLASS & LEVEL', {page:1});
  if (!classLevel){
    const m = fullText.match(/\b(Barbarian|Bard|Cleric|Druid|Fighter|Monk|Paladin|Ranger|Rogue|Sorcerer|Warlock|Wizard|Artificer|Blood Hunter)\s+(\d{1,2})\b/);
    if (m) classLevel = m[0];
  }
  let cls = null, level = null;
  if (classLevel){
    const m = classLevel.match(/^([A-Za-z ]+?)\s+(\d{1,2})/);
    if (m){ cls = m[1].trim(); level = parseInt(m[2]); }
  }

  const race       = _valueNear(items, 'RACE', {page:1});
  const background = _valueNear(items, 'BACKGROUND', {page:1});
  const alignment  = _valueNear(items, 'ALIGNMENT', {page:1});
  const ac    = _numNear(items, 'ARMOR CLASS', {page:1});
  const init  = _numNear(items, 'INITIATIVE', {page:1});
  const speed = _numNear(items, 'SPEED', {page:1, maxBelow:30});
  let hpMax = _numNear(items, 'HIT POINT MAXIMUM', {page:1});
  if (hpMax == null) hpMax = _numNear(items, 'HIT POINTS', {page:1});
  let hp = _numNear(items, 'CURRENT HIT POINTS', {page:1});
  if (hp == null) hp = hpMax;

  const abilities = {};
  ['STR','DEX','CON','INT','WIS','CHA'].forEach(ab => {
    const v = _numNear(items, ab, {page:1, maxBelow:50, maxDx:30});
    if (v != null) abilities[ab.toLowerCase()] = v;
  });

  return {
    name: name || '', cls, level,
    race: race || '', background: background || '', alignment: alignment || '',
    hp, hpMax, ac, init, speed,
    abilities,
    _rawText: fullText,
  };
}

// Main entry point. Tries AcroForm field extraction first (the canonical
// D&D Beyond export format), falls back to positional text matching.
async function parseDDBeyondPdf(file){
  try {
    const fields = await pdfFormFields(file);
    if (Object.keys(fields).length > 0){
      const result = _fromFields(fields);
      // Per-field positional rescue: if AcroForm gave us most of the sheet
      // but missed HP or initiative specifically, fall back to scanning the
      // rendered text for just those fields rather than discarding the whole
      // form-field result.
      if (result.cls != null && (result.hp == null || result.init == null)){
        try {
          const items = await pdfTextItems(file);
          if (result.hp == null){
            if (result.hpMax == null) result.hpMax = _numNear(items, 'HIT POINT MAXIMUM', {page:1});
            result.hp = _numNear(items, 'CURRENT HIT POINTS', {page:1});
            if (result.hp == null) result.hp = result.hpMax;
          }
          if (result.init == null){
            const v = _numNear(items, 'INITIATIVE', {page:1});
            if (v != null) result.init = v;
          }
        } catch(e){ /* ignore rescue failure */ }
      }
      return result;
    }
  } catch(e){ /* fall through */ }
  return _fromPositionalText(file);
}
