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
  console.log('[PDF Import] AcroForm fields:', Object.keys(f));
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
  const classLevel = get('ClassLevel', 'CLASS & LEVEL', 'Class & Level', 'Class and Level');
  let cls = null, level = null;
  if (classLevel){
    const m = String(classLevel).match(/^([A-Za-z ]+?)\s+(\d{1,2})/);
    if (m){ cls = m[1].trim(); level = parseInt(m[2]); }
    else { cls = String(classLevel).trim(); }
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
  const hdTotalRaw = get('HDTotal', 'HD Total', 'Hit Dice', 'HitDice');
  const hd = _deriveHitDice(cls, level, hdTotalRaw);
  return {
    name: String(name||''),
    cls, level,
    race: String(race||''),
    background: String(background||''),
    alignment: String(alignment||''),
    hp, hpMax, ac, init, speed,
    abilities,
    hitDice: hd,
    _rawFields: f,
  };
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
