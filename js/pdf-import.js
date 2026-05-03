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

// Parse a D&D Beyond PDF into a structured character object. Field extraction
// is best-effort — D&D Beyond's layout is consistent for the default template
// but the user can correct anything in the preview modal before applying.
async function parseDDBeyondPdf(file){
  const items = await pdfTextItems(file);
  const fullText = items.map(it => it.str).join(' ');

  // ── Identity ────────────────────────────────────────────────────────────
  // The character name is the largest text near the top of page 1, usually
  // appearing right after a small "Character Name" label or as a stylized
  // header. We use a label proximity match first, then fall back.
  let name = _valueNear(items, 'CHARACTER NAME', {page:1, maxBelow:40, maxDx:140});
  if (!name){
    // Heuristic fallback: take the top-most text on page 1 that's not a label
    // and isn't all-caps.
    const top = items
      .filter(it => it.page === 1)
      .sort((a,b) => b.y - a.y) // highest y first
      .find(it => it.str.length >= 3 && !/^[A-Z\s]+$/.test(it.str));
    if (top) name = top.str;
  }

  // Class & Level usually appears as "Rogue 5" or "Wizard 3 / Fighter 2".
  let classLevel = _valueNear(items, 'CLASS & LEVEL', {page:1});
  if (!classLevel){
    // Look for the pattern "Class N" near the top
    const m = fullText.match(/\b(Barbarian|Bard|Cleric|Druid|Fighter|Monk|Paladin|Ranger|Rogue|Sorcerer|Warlock|Wizard|Artificer|Blood Hunter)\s+(\d{1,2})\b/);
    if (m) classLevel = m[0];
  }
  let cls = null, level = null;
  if (classLevel){
    const m = classLevel.match(/^([A-Za-z ]+?)\s+(\d{1,2})/);
    if (m){ cls = m[1].trim(); level = parseInt(m[2]); }
  }

  const race = _valueNear(items, 'RACE', {page:1});
  const background = _valueNear(items, 'BACKGROUND', {page:1});
  const alignment = _valueNear(items, 'ALIGNMENT', {page:1});

  // ── Combat stats ────────────────────────────────────────────────────────
  const ac    = _numNear(items, 'ARMOR CLASS', {page:1});
  const init  = _numNear(items, 'INITIATIVE', {page:1});
  const speed = _numNear(items, 'SPEED', {page:1, maxBelow:30});

  // HP — D&D Beyond labels this "Hit Point Maximum" and current HP separately.
  let hpMax = _numNear(items, 'HIT POINT MAXIMUM', {page:1});
  if (hpMax == null) hpMax = _numNear(items, 'HIT POINTS', {page:1});
  let hp = _numNear(items, 'CURRENT HIT POINTS', {page:1});
  if (hp == null) hp = hpMax;

  // ── Ability scores ──────────────────────────────────────────────────────
  // Each ability appears as a column with the abbreviation header (STR/DEX/…)
  // and the score directly below it.
  const abilities = {};
  ['STR','DEX','CON','INT','WIS','CHA'].forEach(ab => {
    const v = _numNear(items, ab, {page:1, maxBelow:50, maxDx:30});
    if (v != null) abilities[ab.toLowerCase()] = v;
  });

  return {
    name: name || '',
    cls,
    level,
    race: race || '',
    background: background || '',
    alignment: alignment || '',
    hp, hpMax, ac, init, speed,
    abilities,
    _rawText: fullText,
  };
}
