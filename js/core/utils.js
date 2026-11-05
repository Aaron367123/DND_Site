// ============================================================
// UTILITIES
// ============================================================
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function uid(){return Math.random().toString(36).slice(2,9)}

// Report a localStorage write failure ONCE per minute per subsystem.
// Nearly every setItem in this app sits inside a bare try/catch, so a full
// quota (easy to hit — notes with pasted images, portraits, big fog maps)
// silently discarded the write and the user kept playing, believing their
// campaign was saved. Throttled because these fire from save loops.
var _sktStoreWarnAt = {};
function warnStorageFailure(what, err){
  var isQuota = err && (err.name === 'QuotaExceededError'
    || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22);
  console.warn('[SKT] localStorage write failed for ' + what + ':', err);
  var now = Date.now();
  if (_sktStoreWarnAt[what] && now - _sktStoreWarnAt[what] < 60000) return;
  _sktStoreWarnAt[what] = now;
  if (typeof showToast === 'function'){
    showToast(isQuota
      ? 'Browser storage is full — "' + what + '" did NOT save. Free space (clear old notes/images) to avoid losing work.'
      : 'Couldn’t save "' + what + '" locally — changes may be lost on reload.');
  }
}

// Persist a value, and SAY SO when it fails. The bare
// `try { localStorage.setItem(...) } catch(e){}` idiom this replaces appeared
// at 64 of the app's 68 write sites: when the browser's ~5 MB quota is
// reached the write silently evaporates and the user finds out next session,
// when their work isn't there. Returns true on success so callers can react.
function saveJson(key, value, label){
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    return true;
  } catch(e){
    warnStorageFailure(label || key, e);
    return false;
  }
}

// Downsize an image blob to fit inside maxSide, preserving aspect ratio, and
// return a data URL. Unlike fileToIconDataUrl this does NOT crop to a square —
// it's for images pasted into notes, where the whole picture matters.
//
// Exists because a pasted screenshot is otherwise stored verbatim: a 4K PNG
// becomes ~8 MB of base64 in localStorage (quota is ~5 MB) AND is pushed to
// Firebase, since the NPC library is a sync key. One paste could take out both.
function imageToBoundedDataUrl(blob, maxSide, quality){
  maxSide = maxSide || 1000;
  quality = quality == null ? 0.8 : quality;
  return new Promise((resolve, reject) => {
    if (!blob || !blob.type || !/^image\//.test(blob.type)) return reject(new Error('Not an image'));
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image decode failed'));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        // JPEG rather than PNG: a photo or screenshot as PNG stays enormous,
        // and these are illustrations in a notes field, not archival masters.
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(blob);
  });
}

// Sanitize rich-text HTML before it goes into innerHTML. For fields that
// legitimately store markup (contenteditable notes) but whose content arrives
// through shared sync (Dropbox/Firebase) — so another connected browser could
// have written anything into it. Strips script/style/embed-type elements,
// on* event-handler attributes, and javascript: URLs; keeps formatting tags.
function sanitizeHtml(html) {
  if (!html) return '';
  var tpl = document.createElement('template');
  tpl.innerHTML = String(html);
  var bad = tpl.content.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form');
  bad.forEach(function(el){ el.remove(); });
  var walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_ELEMENT);
  var el;
  while ((el = walker.nextNode())) {
    for (var i = el.attributes.length - 1; i >= 0; i--) {
      var a = el.attributes[i];
      var n = a.name.toLowerCase();
      if (n.indexOf('on') === 0) { el.removeAttribute(a.name); continue; }
      // Navigational attributes: no script-ish or data: URLs at all.
      if ((n === 'href' || n === 'formaction')
          && /^\s*(javascript|data|vbscript):/i.test(a.value)) { el.removeAttribute(a.name); continue; }
      // Embed attributes: data:image/* is legitimate (pasted screenshots /
      // portraits live as base64 <img> in contenteditable) — allow it, block
      // every other data: flavor plus script URLs.
      if (n === 'src' || n === 'xlink:href'){
        if (/^\s*(javascript|vbscript):/i.test(a.value)) { el.removeAttribute(a.name); continue; }
        if (/^\s*data:/i.test(a.value) && !/^\s*data:image\//i.test(a.value)) el.removeAttribute(a.name);
      }
    }
  }
  return tpl.innerHTML;
}

// Rich text pasted from somewhere else, made to look like it belongs here.
// A paste from a web page or a document carries that page's look in inline
// styles — its text colour, a white background, its font and size — so a
// bit of D&D Beyond pasted into an NPC's notes sat there as a white block of
// dark serif text. Keep what the text IS (bold, italics, links, lists,
// tables, pictures); drop how the other page dressed it.
function sktCleanPastedHtml(html){
  var tpl = document.createElement('template');
  tpl.innerHTML = sanitizeHtml(html || '');
  Array.prototype.forEach.call(tpl.content.querySelectorAll('*'), function(el){ if (/^(meta|title|xml|o:p)$/i.test(el.tagName)) el.remove(); });
  var all = tpl.content.querySelectorAll('*');
  for (var i = 0; i < all.length; i++){
    var el = all[i];
    // Bold and italics written as styling (as web pages usually do) are
    // kept as bold and italics.
    var fw = el.style && el.style.fontWeight, fs = el.style && el.style.fontStyle;
    var wrap = function(tag){ var w = document.createElement(tag); while (el.firstChild) w.appendChild(el.firstChild); el.appendChild(w); };
    if (!/^(B|STRONG|H[1-6]|TH)$/.test(el.tagName) && (fw === 'bold' || fw === 'bolder' || +fw >= 600)) wrap('b');
    if (!/^(I|EM)$/.test(el.tagName) && fs === 'italic') wrap('i');
    ['style', 'class', 'id', 'color', 'face', 'size', 'bgcolor', 'background', 'align', 'dir', 'lang'].forEach(function(a){ el.removeAttribute(a); });
    if (el.tagName === 'IMG'){ el.removeAttribute('width'); el.removeAttribute('height'); el.setAttribute('style', 'max-width:100%'); }
  }
  // <font> and bare <span>s are only ever there to carry the styling just
  // removed: keep their text, lose the wrapper.
  tpl.content.querySelectorAll('font, span').forEach(function(el){
    if (el.attributes.length) return;
    while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
    el.remove();
  });
  return tpl.innerHTML;
}

// Local-only per-browser identity used by the Notes panel for per-line author
// coloring. Stored under skt-me-v1, intentionally NOT in SKT_SYNC_KEYS — same
// pattern as skt-layout-v1 (each browser stays its own user).
// One sprite icon, as markup. The ONLY place JS builds one, so the viewBox and
// the class can't drift between call sites — and the viewBox has to be here
// because it is an SVG attribute, not something CSS can set. Sprite lives at
// the top of skt-workspace.html; `id` is a symbol name without the leading #.
function ICO(id, cls){
  return '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">'
       + '<use href="#' + id + '"/></svg>';
}

// Shared empty state. Panels each grew their own — a big colour emoji, a
// sentence, and whatever inline padding looked right at the time — so no two
// matched. One shape, built here:
//
//   emptyState({ icon:'i-combat', title:'No combatants yet',
//                hint:'Drag a party member here, or use + above.' })
//
// `icon` is a sprite id, not an emoji, so it follows the theme. `hint` is
// optional and renders dimmer and narrower; `action` takes raw HTML for a
// button when there is one obvious next step. Everything is escaped by the
// caller as usual — title and hint are inserted as HTML so they can carry
// <strong> and the like. `roomy` is for a whole window that is empty: it
// sits lower, nearer the middle, rather than as a line under the toolbar.
function emptyState(opts){
  const o = opts || {};
  return '<div class="empty-state' + (o.roomy ? ' empty-state-roomy' : '') + '">'
    + (o.icon  ? '<div class="empty-state-icon">' + ICO(o.icon) + '</div>' : '')
    + (o.title ? '<div class="empty-state-title">' + o.title + '</div>' : '')
    + (o.hint  ? '<div class="empty-state-hint">' + o.hint + '</div>' : '')
    + (o.action ? '<div class="empty-state-action">' + o.action + '</div>' : '')
    + '</div>';
}

function _getMe() {
  try {
    const raw = localStorage.getItem('skt-me-v1');
    if (raw) {
      const m = JSON.parse(raw);
      if (m && m.id) return m;
    }
  } catch(e) {}
  const fresh = { id: 'u_' + uid(), name: 'Player', color: '#d4a574' };
  try { localStorage.setItem('skt-me-v1', JSON.stringify(fresh)); } catch(e) {}
  return fresh;
}
// ─── Image asset URLs ────────────────────────────────────────────────────────
// Single place that turns a 5etools-relative image path into a loadable URL.
// Every image in the app goes through here so the art can be served from
// local files or from object storage by flipping ASSET_CONFIG.imgBase — see
// js/core/asset-config.js.
//
// Input tolerance matters, because callers disagree about the prefix:
//   • data-loader stores monster art PREFIX-LESS ('bestiary/MM/Goblin.webp')
//     but non-monster art WITH the prefix ('img/covers/LMoP.webp') — both
//     end up in the same `_img` field.
//   • Persisted state (_bgMapPath, starred maps in skt-battlemap-v1, synced
//     to Firebase) stores prefix-less paths and must keep working untouched.
// So: accept either form, normalize, and never rewrite what gets SAVED.
// An adventure or book file's contents. 5etools 2.29+ wraps them —
// {"adventureData":[{id, source, data}]} / {"bookData":[…]} — where older
// files had {"data": […]} at the top; either way the chapters come back as .data.
function sktDocData(j) {
  if (j && !Array.isArray(j.data)) {
    const w = (j.adventureData || j.bookData || [])[0];
    if (w && Array.isArray(w.data)) return Object.assign({}, j, { data: w.data });
  }
  return j;
}

function assetUrl(path) {
  if (!path) return '';
  const s = String(path);
  // Already a complete URL or inline payload — hand back unchanged.
  if (/^(data:|blob:|https?:\/\/|\/\/)/i.test(s) || s.startsWith('<svg')) return s;
  const rel  = s.replace(/^\/+/, '').replace(/^img\//i, '');
  const base = (window.ASSET_CONFIG && window.ASSET_CONFIG.imgBase) || '';
  return (base ? base.replace(/\/+$/, '') + '/' : 'img/') + _encPath(rel);
}

// Percent-encode each path SEGMENT (never the slashes). 5,870 of the art
// filenames contain spaces, 256 parentheses and 106 apostrophes. Browsers
// silently encode those for RELATIVE urls, which is why the local build works
// without this — but a hand-built ABSOLUTE cdn url must encode them itself or
// thousands of images 404 with no obvious pattern. The tree contains no
// #/?/%/&/+ or non-ASCII characters, so this is a lossless round trip.
function _encPath(rel) {
  return String(rel).split('/').map(seg => {
    // Don't double-encode a segment that already looks encoded.
    try { if (decodeURIComponent(seg) !== seg) return seg; } catch(e){}
    return encodeURIComponent(seg);
  }).join('/');
}

// Small pre-generated preview of the same image (see tools/make-thumbs.py).
// Used by grid/browse UIs so picking a map doesn't decode a 16 MB poster.
// Callers should keep an onerror fallback to assetUrl() — thumbnails are
// generated for a subset of images, and a missing one must degrade, not break.
function assetThumbUrl(path) {
  if (!path) return '';
  const s = String(path);
  if (/^(data:|blob:|https?:\/\/|\/\/)/i.test(s) || s.startsWith('<svg')) return s;
  const rel  = s.replace(/^\/+/, '').replace(/^img\//i, '');
  const base = (window.ASSET_CONFIG && window.ASSET_CONFIG.imgBase) || '';
  return (base ? base.replace(/\/+$/, '') + '/' : '') + 'thumbs/' + _encPath(rel);
}

// ─── Bestiary portraits: token crop vs full art ──────────────────────────────
// 5etools ships a cropped head-shot for most monsters at
// bestiary/tokens/<SRC>/<name>.webp, alongside the full art at
// bestiary/<SRC>/<name>.webp. The token path is DERIVED, not declared — and
// for 327 art paths (10% of the set) no token was ever produced, so deriving
// it blind means a guaranteed 404 before the fallback kicks in.
//
// The bestiary data's own `hasToken` flag can't be used to tell them apart:
// it is true on all 4,454 monster entries, including every one that has no
// token file. tools/make-token-index.js precomputes the real exceptions into
// js/generated/token-index.js instead.
//
// Accepts either form — a full-art path OR an already-tokenized path from
// saved state — and returns the prefix-less path that actually exists. Safe
// if token-index.js hasn't loaded: it degrades to the old derive-and-fallback
// behavior rather than throwing.
function bestiaryPortraitPath(p) {
  if (!p) return p;
  const rel = String(p).replace(/^\/+/, '').replace(/^img\//i, '');
  const m = /^bestiary\/(?:tokens\/)?(.+)$/.exec(rel);
  if (!m) return p;                       // not bestiary art — hand back as-is
  const key = m[1];                       // "<SOURCE>/<file>"
  const misses = window.TOKEN_MISSES;
  const cropped = !(misses && misses.has(key));
  return 'bestiary/' + (cropped ? 'tokens/' : '') + key;
}

// A monster's own token, by its name and book: bestiary/tokens/<SRC>/<Name>.webp,
// or null when it has none (TOKEN_NAME_MISSES) or the index hasn't loaded.
// Preferred over the token derived from its art, which is often a group's
// picture shared by several monsters (tools/make-token-index.js).
function bestiaryOwnToken(name, source) {
  const misses = window.TOKEN_NAME_MISSES;
  if (!misses || !name || !source) return null;
  const key = source + '/' + name + '.webp';
  return misses.has(key) ? null : 'bestiary/tokens/' + key;
}

// Render an "icon" value (used by party / combatant portraits). Accepts:
//   - data:image/...      → <img>
//   - paths starting with img/ or http(s)/ → <img>
//   - raw <svg…           → inlined SVG
//   - everything else     → plain text (emoji, single char)
// A character's face: their own picture; else their species' portrait (the
// art pack's, js/generated/species-portraits.js) in place of a class's
// default emoji; else the icon they have (one they picked keeps).
const SKT_DEFAULT_ICONS = new Set(['', '⚔', '🪓', '🎵', '✨', '🌿', '👊', '🛡', '🏹', '🗡', '🔥', '👁', '📘']);
// (Each entry is [path, x%, y%] — where the face is, tools/make-species-portraits.py.)
function sktSpeciesPortrait(race) {
  const m = window.SKT_SPECIES_PORTRAITS || {}, r = String(race || '').trim();
  const path = e => Array.isArray(e) ? e[0] : (e || '');
  if (!r) return '';
  if (m[r]) return path(m[r]);
  const bare = r.replace(/\s*\(.*\)\s*$/, '').replace(/^(variant|custom)\s+/i, '');
  if (m[bare]) return path(m[bare]);
  // "Hill Dwarf", "Wood Elf", "Elf; Drow": the species' own name in it.
  const key = Object.keys(m).filter(k => !/[()]/.test(k) && new RegExp('(^|[\\s;])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[\\s;])', 'i').test(bare)).sort((a, b) => b.length - a.length)[0];
  return key ? path(m[key]) : '';
}
// Where a species portrait's face is: { x, y } in percent, or null.
function sktPortraitFocus(imgPath) {
  const p = String(imgPath || '').replace(/^img\//, '');
  if (!window._sktFocus) { window._sktFocus = {}; Object.values(window.SKT_SPECIES_PORTRAITS || {}).forEach(e => { if (Array.isArray(e)) window._sktFocus[e[0]] = { x: e[1], y: e[2] }; }); }
  return window._sktFocus[p] || null;
}
function sktPcIcon(pc) {
  const ic = pc && pc.icon ? String(pc.icon) : '';
  if (/^(data:image\/|img\/|https?:\/\/)/.test(ic) || (ic && !SKT_DEFAULT_ICONS.has(ic))) return ic;
  const face = sktSpeciesPortrait((pc && pc.build && pc.build.species) || (pc && pc.race));
  return face ? 'img/' + face : (ic || '⚔');
}

function renderIcon(icon, alt) {
  if (!icon) return '⚔';
  const s = String(icon);
  // A species portrait: the thumbnail, the full picture if there's none, the face framed.
  if (/^img\/races\//.test(s)) {
    const full = assetUrl(s), small = assetThumbUrl(s), f = sktPortraitFocus(s);
    const pos = f ? ` style="object-position:${f.x}% ${f.y}%;transform-origin:${f.x}% ${f.y}%"` : '';
    // Loaded at once, not lazily: panels redraw on every synced change, and a
    // lazy picture blanks for a frame each time it's rebuilt — a flicker.
    return `<img class="icon-img icon-face" src="${esc(small)}" data-fb="${esc(full)}"${pos} alt="${esc(alt||'')}" onerror=""if(this.dataset.fb){this.src=this.dataset.fb;this.removeAttribute('data-fb');}else{this.style.display='none';}">`;
  }
  if (s.startsWith('data:image/') || s.startsWith('img/') || /^https?:\/\//.test(s)) {
    // Repair the path on the way out. combat.js and battlemap.js PERSIST the
    // portrait on the combatant/token and sync it, so state saved before the
    // token index existed still holds 'bestiary/tokens/…' paths that 404.
    // Rewriting here fixes those renders without migrating stored data.
    // assetUrl passes data:/http(s) through untouched and re-bases img/ paths.
    const src = assetUrl(bestiaryPortraitPath(s));
    // Belt and braces: the index only covers paths it was generated from, so
    // art added later — or an absolute URL saved by an older build, which
    // bestiaryPortraitPath deliberately leaves alone — can still miss. Retry
    // the un-cropped art once before giving up, or the portrait ring renders
    // empty.
    const fb = src.indexOf('/bestiary/tokens/') !== -1
      ? src.replace('/bestiary/tokens/', '/bestiary/') : '';
    const onerr = fb
      ? "if(this.dataset.fb){this.src=this.dataset.fb;this.removeAttribute('data-fb');}else{this.style.display='none';}"
      : "this.style.display='none'";
    return `<img class="icon-img" crossorigin="anonymous" src="${esc(src)}"${fb ? ` data-fb="${esc(fb)}"` : ''} alt="${esc(alt||'')}" onerror="${onerr}">`;
  }
  if (s.startsWith('<svg')) return s;          // already an SVG (CLASS_ICONS)
  return esc(s);                                // emoji / character
}

// Resize an image File to a square thumbnail and return a base64 data URL.
// We compress to keep localStorage usage reasonable (~10-30KB per icon).
function fileToIconDataUrl(file, size) {
  size = size || 96;
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith('image/')) return reject(new Error('Not an image'));
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image decode failed'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        // cover-fit: crop the longer dimension so the icon stays square
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (size - w)/2, (size - h)/2, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Interactive crop modal. Loads the file, lets the user pan + zoom inside a
// square viewport, then exports a `size`-pixel JPEG of the visible area.
// opts: { size: 96, shape: 'circle'|'square', title: '...' }
// Resolves with the data URL on Save, or null on Cancel.
function showCropModal(file, opts) {
  opts = opts || {};
  const size = opts.size || 96;
  const shape = opts.shape || 'circle';
  const title = opts.title || 'Crop image';
  return new Promise((resolve) => {
    if (!file || !file.type || !file.type.startsWith('image/')) { resolve(null); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => _runCrop(img, size, shape, title, resolve);
      img.onerror = () => resolve(null);
      img.src = reader.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function _runCrop(img, outSize, shape, title, resolve) {
  // Viewport is a fixed on-screen square; the image is positioned inside via
  // CSS transform. We track translate (tx, ty) in viewport pixels and a uniform
  // scale (s) where s=1 means "cover-fit". The user can zoom up to 5×.
  const VP = 320; // viewport size in screen pixels

  // Cover-fit: scale the image so the smaller dimension fills the viewport
  const coverScale = Math.max(VP / img.naturalWidth, VP / img.naturalHeight);

  let s = 1;             // 1 = cover-fit, ranges [1, 5]
  let tx = 0, ty = 0;    // translation, 0 = centered

  const overlay = document.createElement('div');
  overlay.className = 'crop-overlay';
  overlay.innerHTML = `
    <div class="crop-modal">
      <div class="crop-title">${esc(title)}</div>
      <div class="crop-viewport ${shape==='circle'?'shape-circle':'shape-square'}">
        <img class="crop-img" alt="">
        <div class="crop-mask"></div>
      </div>
      <div class="crop-zoom">
        <span class="crop-z-icon">−</span>
        <input type="range" class="crop-z-slider" min="1" max="5" step="0.01" value="1">
        <span class="crop-z-icon">+</span>
      </div>
      <div class="crop-actions">
        <button class="btn" data-act="cancel">Cancel</button>
        <button class="btn primary" data-act="save">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const imgEl = overlay.querySelector('.crop-img');
  imgEl.src = img.src;
  imgEl.style.width  = (img.naturalWidth  * coverScale) + 'px';
  imgEl.style.height = (img.naturalHeight * coverScale) + 'px';

  function applyTransform() {
    imgEl.style.transform = `translate(-50%,-50%) translate(${tx}px,${ty}px) scale(${s})`;
  }
  applyTransform();

  // Pan
  let drag = null;
  imgEl.addEventListener('mousedown', e => {
    e.preventDefault();
    drag = { sx: e.clientX, sy: e.clientY, ox: tx, oy: ty };
  });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  function onMove(e) {
    if (!drag) return;
    tx = drag.ox + (e.clientX - drag.sx);
    ty = drag.oy + (e.clientY - drag.sy);
    applyTransform();
  }
  function onUp() { drag = null; }

  // Zoom — wheel + slider
  const slider = overlay.querySelector('.crop-z-slider');
  function setZoom(newS, pivotClientX, pivotClientY) {
    newS = Math.max(1, Math.min(5, newS));
    if (Math.abs(newS - s) < 0.001) return;
    // Keep the point under the pivot stationary while zooming
    if (pivotClientX != null) {
      const r = imgEl.parentElement.getBoundingClientRect();
      const cx = pivotClientX - (r.left + r.width / 2);
      const cy = pivotClientY - (r.top  + r.height / 2);
      tx = cx - (cx - tx) * (newS / s);
      ty = cy - (cy - ty) * (newS / s);
    }
    s = newS;
    slider.value = String(s);
    applyTransform();
  }
  slider.addEventListener('input', e => setZoom(parseFloat(e.target.value)));
  overlay.querySelector('.crop-viewport').addEventListener('wheel', e => {
    e.preventDefault();
    setZoom(s + (e.deltaY < 0 ? 0.1 : -0.1), e.clientX, e.clientY);
  }, { passive: false });

  function escHandler(e) {
    if (e.key === 'Escape') { cleanup(); resolve(null); }
  }
  function cleanup() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    // Always release the document keydown listener here — the old code only
    // removed it on the Escape path, so closing via Save/Cancel/backdrop left
    // a dangling handler (one leaked per crop, each pinning the overlay
    // closure in memory).
    document.removeEventListener('keydown', escHandler);
    overlay.remove();
  }

  overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => { cleanup(); resolve(null); });
  overlay.addEventListener('click', e => { if (e.target === overlay) { cleanup(); resolve(null); } });
  document.addEventListener('keydown', escHandler);

  overlay.querySelector('[data-act="save"]').addEventListener('click', () => {
    // The viewport shows the rectangle of the displayed image around its center,
    // shifted by (tx, ty) and scaled by s relative to the cover-fit baseline.
    // Convert back to source-image pixel coordinates:
    const totalScale = coverScale * s;          // src px → screen px
    const halfVP = VP / 2;
    // viewport center in source coords:
    const cxSrc = (img.naturalWidth  / 2) - (tx / totalScale);
    const cySrc = (img.naturalHeight / 2) - (ty / totalScale);
    const srcW = VP / totalScale;
    const srcH = VP / totalScale;
    const srcX = cxSrc - srcW / 2;
    const srcY = cySrc - srcH / 2;

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = outSize;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outSize, outSize);
    const url = canvas.toDataURL('image/jpeg', 0.85);
    cleanup();
    resolve(url);
  });
}

function d20(){ return sktD(20); }
function mod(s){return Math.floor((s-10)/2)}

// ─── Qualified damage resistance ─────────────────────────────────────────────
// A resist/immune/vulnerable entry is a plain string, and may carry a
// qualifier: "bludgeoning, piercing, slashing from nonmagical attacks that
// aren't silvered". Matching those by substring alone made every such entry
// unconditional, so a Werewolf was immune to ALL slashing — a silvered or
// magical weapon did nothing. Every classic "needs a magic weapon" monster was
// invulnerable to weapons.
//
// SKT_ATTACK_PROPS is the set of properties an attack can have that a qualifier
// can refer to. A qualifier naming a property means the entry applies ONLY when
// the attack lacks it: "from nonmagical attacks that aren't silvered" applies
// unless the attack is magical OR silvered.
//
// Qualifiers with no attack property in them — "while in dim light or darkness"
// — can't be judged from the damage alone and stay unconditional, which is the
// long-standing behaviour.
const SKT_ATTACK_PROPS = ['magical', 'silvered', 'adamantine'];

function sktResistQualifiers(entry){
  const s = String(entry || '').toLowerCase();
  const need = [];
  // "(from stoneskin)" is written on 27 stat blocks and means exactly the
  // spell's own wording: resistance to NONMAGICAL bludgeoning, piercing and
  // slashing. Unrecognised, it read as unconditional and halved magic weapons
  // too.
  if (/non-?magical|stoneskin/.test(s)) need.push('magical');
  if (/silver/.test(s))                 need.push('silvered');
  if (/adamantine/.test(s))             need.push('adamantine');
  return need;
}

// Conditions this matcher cannot evaluate — lighting, the attacker's alignment,
// a specific weapon. An entry carrying one is applied in full, because that is
// what it said before anything understood qualifiers at all and quietly
// dropping a monster's defence would be worse. But the DM is told, so a call
// that is actually theirs to make does not pass as arithmetic.
//
// Only fires when conditional language is present AND no qualifier was
// recognised, so the ordinary "from nonmagical attacks" entries stay silent.
const SKT_RESIST_COND_RE = /\b(?:from|while|wielded|except|unless|made with|that aren't|that are)\b/;
function sktResistCaveat(entry){
  const s = String(entry || '').toLowerCase().trim();
  if (!s || !SKT_RESIST_COND_RE.test(s)) return '';
  if (sktResistQualifiers(s).length) return '';
  return s;
}

// Does `entry` apply to `dmgType` delivered by an attack with `attack`
// ({magical, silvered, adamantine})? `attack` may be omitted for an unqualified
// check — in which case a qualified entry is treated as NOT applying, because
// the caller has told us nothing that would satisfy it.
function sktResistApplies(entry, dmgType, attack){
  const s = String(entry || '').toLowerCase();
  const t = String(dmgType || '').toLowerCase();
  if (!t || !s.includes(t)) return false;
  const need = sktResistQualifiers(s);
  if (!need.length) return true;                       // unconditional
  return !need.some(p => attack && attack[p]);          // any named property blocks it
}

// Convenience: does any entry in the list apply?
// The entry that actually matched, so a caller can explain itself. Same walk
// as sktAnyResistApplies; that one is kept because most callers only want the
// boolean.
function sktFirstResistApplying(arr, dmgType, attack){
  if (!Array.isArray(arr)) return null;
  for (const x of arr){
    const e = (typeof x === 'string' ? x : (x && (x.resist || x.immune || x.vulnerable || x.name)) || '');
    if (sktResistApplies(e, dmgType, attack)) return e;
  }
  return null;
}

function sktAnyResistApplies(arr, dmgType, attack){
  return Array.isArray(arr) && arr.some(x => sktResistApplies(
    (typeof x === 'string' ? x : (x && (x.resist || x.immune || x.vulnerable || x.name)) || ''),
    dmgType, attack));
}
// Toasts. Four kinds, and only the ones that matter get the full frame:
//
//   note    — the default. "Saved", "Link copied", "Cast Bless". A small, flat
//             line in the corner (above the tab bar on a phone), gone in a
//             second or two. A new note REPLACES the one on screen instead of
//             stacking: when anything at all raised one, three of them piled
//             up at the bottom of the screen during an ordinary turn.
//   action  — opts.action = { label, run }: a note with a button (Undo). Lasts
//             long enough to reach for it; replaces an earlier one too.
//   alert   — opts.alert, or a message that reads like a failure: something
//             went wrong, or a moment at the table (a death, a concentration
//             save, the lair acting) that nothing else on screen shows. These
//             keep the framed plaque and stack, up to three.
//   sticky  — opts.sticky: stays until its button is tapped (a new version).
//
// The same message twice in a row restarts the one showing instead of
// adding a copy.
const SKT_TOAST_ALERT = /fail|could ?n.t|can.t |cannot|not found|too large|denied|blocked|rejected|error|went wrong|unavailable|not enough|no .+ left|requires/i;
function showToast(msg, opts){
  opts = opts || {};
  let host = document.getElementById('toast-host');
  if (!host){
    host = document.createElement('div');
    host.id = 'toast-host';
    document.body.appendChild(host);
  }
  // A toast never stands between a finger and what's under it. The CSS lets
  // the tap through (only an action button catches one), and a tap where a
  // toast is also clears it out of the way — it sat over the phone's map
  // tools and the bottom of the screen until it timed out.
  if (!showToast._tapThrough){
    showToast._tapThrough = true;
    document.addEventListener('pointerdown', e => {
      if (e.target && e.target.closest && e.target.closest('.toast-action')) return;
      const h = document.getElementById('toast-host'); if (!h) return;
      [...h.children].forEach(c => {
        if (c.classList.contains('sticky')) return;     // waiting for an answer
        const r = c.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom){
          c.classList.remove('show'); setTimeout(() => c.remove(), 200);
        }
      });
    }, true);
  }
  // Words only: a leading emoji (💀 🌀 💤 🎲 📜) came out a different size and
  // colour on every system, as the menus' did. The alert's frame says it matters.
  const safeMsg = (typeof msg === 'string' ? msg : String(msg ?? '')).replace(/^[^\p{L}\p{N}"'“(\[+−-]+\s+/u, '');
  const hasAction = !!(opts.action && typeof opts.action.run === 'function');
  const kind = opts.sticky ? 'sticky' : (opts.alert || SKT_TOAST_ALERT.test(safeMsg)) ? 'alert' : hasAction ? 'action' : 'note';
  const leave = (t, ms) => { clearTimeout(t._exit); t._exit = setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 200); }, ms); };
  const timeoutMs = kind === 'note' ? 1500 + Math.min(1500, Math.max(0, safeMsg.length - 40) * 30)
                  : kind === 'action' ? 4000 : 4500;
  // Already showing: keep that one up a little longer rather than add a twin.
  if (kind !== 'sticky' && !hasAction){
    const twin = [...host.children].find(c => !c.classList.contains('sticky') && c._msg === safeMsg && c.classList.contains('show'));
    if (twin){ leave(twin, timeoutMs); return; }
  }
  // One routine line at a time: a note takes the place of the last note, an
  // action of the last note or action.
  if (kind === 'note' || kind === 'action'){
    [...host.children].forEach(c => {
      if (c.dataset.kind === 'note' || (kind === 'action' && c.dataset.kind === 'action')) c.remove();
    });
  }
  // Cap to 3 — pop the oldest if needed before adding the new one. A sticky
  // toast is never the one popped: it is waiting for a tap, and three
  // "Combat ended" toasts in a row must not quietly bump it off the screen.
  while (host.children.length >= 3){
    const victim = [...host.children].find(c => !c.classList.contains('sticky'));
    if (!victim) break;
    victim.remove();
  }
  const t = document.createElement('div');
  t.className = 'toast-item ' + kind + (hasAction ? ' has-action' : '');
  t.dataset.kind = kind;
  t._msg = safeMsg;
  t.setAttribute('role', kind === 'alert' || kind === 'sticky' ? 'alert' : 'status');
  if (hasAction){
    const span = document.createElement('span');
    span.textContent = safeMsg;
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = opts.action.label || 'Action';
    btn.addEventListener('click', () => {
      try { opts.action.run(); } catch(e){ console.warn('[toast action]', e); }
      t.classList.remove('show');
      setTimeout(() => t.remove(), 200);
    });
    t.appendChild(span);
    t.appendChild(btn);
  } else {
    t.textContent = safeMsg;
  }
  host.appendChild(t);
  // Force reflow so the .show transition fires for the newly inserted node.
  void t.offsetWidth;
  t.classList.add('show');
  // opts.sticky: stays until its action is tapped (which removes it above).
  if (kind === 'sticky') return;
  leave(t, timeoutMs);
}

// Keyboard-shortcut cheatsheet overlay. Triggered by pressing `?` (no
// modifier). Renders a single modal listing every documented shortcut so the
// user doesn't have to dig through the tutorial. Idempotent — calling twice
// just closes the existing one.
function showHelpOverlay(){
  const existing = document.getElementById('help-overlay');
  if (existing){ existing.remove(); return; }
  const SHORTCUTS = [
    { group: 'Search', items: [
      ['Ctrl + K  or  /',  'Search — panels, commands, rules ("See all" for the full search)'],
      ['↑ ↓',              'Browse results'],
      ['Enter',            'Open selected result'],
      ['Escape',           'Close detail / search'],
    ]},
    { group: 'Undo', items: [
      ['Ctrl + Z',         'Undo the last change to the tracker or the party'],
      ['Ctrl + Shift + Z', 'Redo it'],
      ['Ctrl + Z on the map', 'Undo the last thing drawn or moved there — the same history'],
    ]},
    { group: 'Workspace zoom', items: [
      ['Ctrl + Wheel',     'Zoom centered on cursor'],
      ['Ctrl + + / − / 0', 'Zoom in / out / reset'],
      ['Space + drag',     'Pan workspace'],
      ['Middle-mouse drag','Pan workspace'],
      ['Right-click drag', 'Pan workspace'],
    ]},
    { group: 'Workspaces', items: [
      ['1 … 9',            'Switch to that workspace (by dock position)'],
      ['Click the active one', 'Rename, relabel or delete it'],
    ]},
    { group: 'Windows', items: [
      ['Ctrl + Shift + A', 'Smart arrange — auto-tile all open panels'],
      ['Right-click empty workspace', 'Toggle panels / restore focuses'],
    ]},
    { group: 'Player view (DM)', items: [
      ['Shift-click player-view button', 'Copy player link without opening tab'],
      ['Right-click player-view button', 'Copy player link'],
      ['👁 in window menu',  'Share / unshare panel with players'],
    ]},
    { group: 'Help', items: [
      ['?',                'Show this overlay'],
      ['Esc',              'Close this overlay'],
    ]},
  ];
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.id = 'help-overlay';
  const groupHtml = SHORTCUTS.map(g => `
    <div class="help-group">
      <div class="help-group-title">${esc(g.group)}</div>
      ${g.items.map(([k, desc]) => `
        <div class="help-row">
          <span class="help-keys">${k.split(/\s+\+\s+|\s+\/\s+/).map(x => '<kbd>'+esc(x)+'</kbd>').join(k.includes('+') ? ' + ' : k.includes('/') ? ' / ' : ' ')}</span>
          <span class="help-desc">${esc(desc)}</span>
        </div>`).join('')}
    </div>`).join('');
  back.innerHTML = `<div class="modal help-modal" role="dialog" aria-modal="true">
    <h3 style="margin:0 0 4px">Keyboard shortcuts</h3>
    <p style="margin:0 0 14px;font-size:var(--fs-sm);color:var(--text-muted)">Press <kbd>?</kbd> any time to toggle this overlay.</p>
    <div class="help-grid">${groupHtml}</div>
    <div class="modal-actions" style="margin-top:14px"><button class="btn primary" id="help-close">Close (Esc)</button></div>
  </div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.querySelector('#help-close').addEventListener('click', close);
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  const onKey = (e) => {
    if (e.key === 'Escape' || e.key === '?'){
      e.preventDefault();
      close();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
}
window.showHelpOverlay = showHelpOverlay;

// Themed modal — replaces browser prompt/confirm
// fields: [{id, label, type='text', value='', placeholder='', min, max}]
// returns Promise<object|null> — null if cancelled
function showModal(title, fields, confirmLabel) {
  if(!confirmLabel) confirmLabel = 'OK';
  title = String(title == null ? '' : title).replace(/^[^\p{L}\p{N}"'“(\[]+\s+/u, '');
  return new Promise(function(resolve) {
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    var fieldHtml = '';
    fields.forEach(function(f) {
      var control;
      if (f.type === 'select') {
        // f.options can be ['pool','toggle'] or [{value:'pool',label:'Pool'}, ...]
        var optsHtml = (f.options || []).map(function(o) {
          var v = (typeof o === 'string') ? o : o.value;
          var l = (typeof o === 'string') ? o : (o.label || o.value);
          var sel = (f.value !== undefined && String(f.value) === String(v)) ? ' selected' : '';
          return '<option value="' + esc(v) + '"' + sel + '>' + esc(l) + '</option>';
        }).join('');
        control = '<select id="mf-' + f.id + '">' + optsHtml + '</select>';
      } else {
        var minAttr = f.min !== undefined ? ' min="' + f.min + '"' : '';
        var maxAttr = f.max !== undefined ? ' max="' + f.max + '"' : '';
        control = '<input id="mf-' + f.id + '" type="' + (f.type||'text') + '"'
          + ' value="' + (f.value !== undefined ? f.value : '') + '"'
          + ' placeholder="' + (f.placeholder||'') + '"'
          + minAttr + maxAttr + ' autocomplete="off">';
      }
      fieldHtml += '<div class="modal-field">'
        + '<label>' + (f.label||'') + '</label>'
        + control
        + '</div>';
    });

    var bodyHtml = fields.length
      ? '<div class="modal-fields">' + fieldHtml + '</div>'
      : '<p style="color:var(--text-muted);font-size:var(--fs-md);margin:0 0 20px;line-height:1.5">'
        + 'Click confirm to proceed, or Cancel to go back.</p>';

    backdrop.innerHTML = '<div class="modal" role="dialog" aria-modal="true">'
      + '<h3>' + title + '</h3>'
      + bodyHtml
      + '<div class="modal-actions">'
      + '<button class="btn" id="modal-cancel">Cancel</button>'
      + '<button class="btn primary" id="modal-confirm">' + confirmLabel + '</button>'
      + '</div>'
      + '</div>';

    document.body.appendChild(backdrop);
    setTimeout(function(){ var inp = backdrop.querySelector('input,select'); if(inp) inp.focus(); }, 30);

    // Keys on document, not the backdrop: the backdrop div isn't focusable,
    // so its keydown only fired while focus happened to sit inside the modal
    // (e.g. after the auto-focus). Document-level always works; close()
    // removes it so stacked/repeated modals don't accumulate handlers.
    var onKey = function(e) {
      if(e.key === 'Enter')  { e.preventDefault(); backdrop.querySelector('#modal-confirm').click(); }
      if(e.key === 'Escape') { close(null); }
    };
    var close = function(result) { document.removeEventListener('keydown', onKey); backdrop.remove(); resolve(result); };
    document.addEventListener('keydown', onKey);

    backdrop.querySelector('#modal-cancel').addEventListener('click', function(){ close(null); });
    backdrop.querySelector('#modal-confirm').addEventListener('click', function() {
      var result = {};
      fields.forEach(function(f) {
        var el = backdrop.querySelector('#mf-' + f.id);
        if(!el) return;
        if (f.type === 'number') {
          // Parse, but keep a genuine 0 — `parseInt(v) || f.value` dropped any
          // "0" the user typed (0 is falsy) and silently restored the original
          // value, so e.g. setting an AC/HP/count to 0 was impossible. Only
          // fall back to the default when the field is blank / non-numeric.
          var n = parseInt(el.value, 10);
          result[f.id] = isNaN(n) ? (f.value != null ? f.value : 0) : n;
        } else {
          result[f.id] = el.value.trim();
        }
      });
      close(result);
    });
    backdrop.addEventListener('mousedown', function(e) { if(e.target === backdrop) close(null); });
  });
}

// Themed replacement for the browser's native confirm() dialog. Resolves
// to true (OK / Enter) or false (Cancel / Esc / backdrop click).
//   showConfirm('Remove all tokens?')           — basic
//   showConfirm('Delete X?', {danger:true})     — red confirm button
//   showConfirm('…', {title:'Heads up', confirmLabel:'Delete'})
//   showConfirm('…', {input:{label:'The d8 rolled', min:1, max:8}}) — with a
//     number box for a die rolled at the table: resolves to that number, or
//     true when it's left empty (roll it here), false on Cancel.
function showConfirm(message, opts){
  opts = opts || {};
  var title = opts.title || 'Confirm';
  var confirmLabel = opts.confirmLabel || 'OK';
  var danger = !!opts.danger;
  return new Promise(function(resolve){
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = '<div class="modal" role="dialog" aria-modal="true">'
      + '<h3>' + esc(title) + '</h3>'
      + '<p style="color:var(--text-muted);font-size:var(--fs-lg);margin:0 0 20px;line-height:1.5">' + esc(message) + '</p>'
      + (opts.input ? '<label class="conf-input" style="display:flex;align-items:center;gap:10px;margin:-8px 0 20px;color:var(--text-muted)">' + esc(opts.input.label || 'Rolled at the table')
        + ' <input type="number" inputmode="numeric" id="conf-val"' + (opts.input.min != null ? ' min="' + opts.input.min + '"' : '') + (opts.input.max != null ? ' max="' + opts.input.max + '"' : '') + ' style="width:80px" placeholder="—"></label>' : '')
      + '<div class="modal-actions">'
      + '<button class="btn" id="conf-cancel">Cancel</button>'
      + '<button class="btn ' + (danger ? 'danger' : 'primary') + '" id="conf-ok">' + esc(confirmLabel) + '</button>'
      + '</div>'
      + '</div>';
    document.body.appendChild(backdrop);
    var ok = backdrop.querySelector('#conf-ok');
    setTimeout(function(){ if(ok) ok.focus(); }, 30);
    // Document-level keys for the same reason as showModal above.
    var onKey = function(e){
      if (e.key === 'Enter')  { e.preventDefault(); close(true); }
      if (e.key === 'Escape') { close(false); }
    };
    var close = function(result){
      document.removeEventListener('keydown', onKey);
      var v = opts.input && result ? parseInt((backdrop.querySelector('#conf-val') || {}).value, 10) : NaN;
      backdrop.remove(); resolve(result && !isNaN(v) ? v : result);
    };
    document.addEventListener('keydown', onKey);
    backdrop.querySelector('#conf-cancel').addEventListener('click', function(){ close(false); });
    ok.addEventListener('click', function(){ close(true); });
    backdrop.addEventListener('mousedown', function(e){ if (e.target === backdrop) close(false); });
  });
}

// Wire `el` so a long-press (touch held still for `holdMs` ms) fires
// `handler(x, y)` where x/y are the touch's clientX/Y. Movement >6px cancels.
// Mobile substitute for right-click. Returns a cleanup function.
function addLongPress(el, handler, holdMs) {
  if (!el) return function(){};
  holdMs = holdMs || 500;
  var timer = null, sx = 0, sy = 0;
  function clear(){ if (timer){ clearTimeout(timer); timer = null; } }
  function onStart(e){
    if (!e.touches || e.touches.length !== 1) return;
    var t = e.touches[0]; sx = t.clientX; sy = t.clientY;
    clear();
    timer = setTimeout(function(){ timer = null; handler(sx, sy, e); }, holdMs);
  }
  function onMove(e){
    if (!timer || !e.touches || !e.touches[0]) return;
    var t = e.touches[0];
    if (Math.abs(t.clientX - sx) + Math.abs(t.clientY - sy) > 6) clear();
  }
  function onEnd(){ clear(); }
  el.addEventListener('touchstart', onStart, { passive: true });
  el.addEventListener('touchmove',  onMove,  { passive: true });
  el.addEventListener('touchend',   onEnd);
  el.addEventListener('touchcancel',onEnd);
  return function cleanup(){
    el.removeEventListener('touchstart', onStart);
    el.removeEventListener('touchmove',  onMove);
    el.removeEventListener('touchend',   onEnd);
    el.removeEventListener('touchcancel',onEnd);
    clear();
  };
}

// Lightweight context menu — shown at (x, y) with a list of {label, onClick, checked?} items.
// Closes on item click, outside mousedown, Esc, or scroll. Auto-clamps to viewport.
function showContextMenu(x, y, items) {
  document.querySelectorAll('.ctx-menu').forEach(function(el){ el.remove(); });

  var menu = document.createElement('div');
  menu.className = 'ctx-menu';
  var anyChecked = items.some(function(it){ return it.checked; });
  items.forEach(function(it) {
    var lab = String(it.label == null ? '' : it.label);
    // The emoji and odd glyphs that led most labels (🎲 ⚡ 💀 ✎ ⇪ 🗑 ＋) came
    // out a different size and colour on every system; the words alone read
    // as one menu. A label of dashes is a rule, and "Heading ─────" a small
    // heading over the rows after it — they were buttons that did nothing.
    var text = lab.replace(/^[^\p{L}\p{N}"'“(\[]+\s+/u, '');
    if (/^[─—-]{3,}$/.test(lab.trim())){
      var sep = document.createElement('div'); sep.className = 'ctx-menu-sep'; sep.setAttribute('role', 'separator');
      menu.appendChild(sep); return;
    }
    var head = /^(.*?)\s*─{3,}$/.exec(text);
    if (head && it.disabled){
      var h = document.createElement('div'); h.className = 'ctx-menu-head'; h.textContent = head[1];
      menu.appendChild(h); return;
    }
    var btn = document.createElement('button');
    btn.className = 'ctx-menu-item' + (it.checked ? ' checked' : '') + (it.danger || /^🗑/u.test(lab) ? ' danger' : '');
    // The tick column only where the menu has ticks.
    btn.textContent = (it.checked ? '✓ ' : anyChecked ? '   ' : '') + text;
    if (it.disabled) btn.disabled = true;
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      close();
      if (it.onClick) it.onClick();
    });
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  var r = menu.getBoundingClientRect();
  var vw = window.innerWidth, vh = window.innerHeight;
  menu.style.left = Math.max(2, Math.min(x, vw - r.width  - 4)) + 'px';
  menu.style.top  = Math.max(2, Math.min(y, vh - r.height - 4)) + 'px';

  function close() {
    menu.remove();
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown',   onKey,  true);
    window.removeEventListener('scroll',      close,  true);
    window.removeEventListener('resize',      close);
  }
  function onDown(e) { if (!menu.contains(e.target)) close(); }
  function onKey(e)  { if (e.key === 'Escape') close(); }

  // Defer listener install so the originating contextmenu event doesn't immediately close us.
  setTimeout(function() {
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown',   onKey,  true);
    window.addEventListener('scroll',      close,  true);
    window.addEventListener('resize',      close);
  }, 0);
}

// Transient draggable/resizable floating window. Not registered with the panel
// system, so position is not persisted and it disappears on refresh.
// opts: { title, icon, html, w, h, x, y }  → returns { el, body, close }
function createFloatingWindow(opts) {
  opts = opts || {};
  // Append into the same canvas as the registered windows so they share one
  // stacking context. Otherwise the canvas's `transform: scale()` (used for
  // zoom) creates a separate stacking layer and the popout can never sink
  // behind a docked panel no matter what z-index a click sets.
  var canvas = document.getElementById('workspace-canvas') || document.getElementById('workspace');
  // The player view has no workspace canvas — it is a tab strip, not a
  // desktop — so this was null and appendChild threw. Every popout raised from
  // a panel mounted there died the same way: the Loot tab's item-detail button
  // was just the first one anybody clicked.
  var onCanvas = !!canvas;
  if (!canvas) canvas = document.body;
  var w = opts.w || 360, h = opts.h || 460;
  // On the body there is no canvas to scroll, so the window has to fit the
  // screen — and body.player-mode carries zoom:2 on a phone, which halves the
  // CSS viewport a fixed element lives in. Divide it out rather than assume a
  // factor, so this stays right if the zoom changes.
  var availW = window.innerWidth, availH = window.innerHeight;
  if (!onCanvas){
    var bz = parseFloat(getComputedStyle(document.body).zoom) || 1;
    availW = Math.round(availW / bz); availH = Math.round(availH / bz);
    w = Math.min(w, Math.max(180, availW - 12));
    h = Math.min(h, Math.max(200, availH - 76));   // clear of the tab bar
  }
  // Cascade successive popouts a bit so they don't perfectly stack
  createFloatingWindow._n = (createFloatingWindow._n || 0) + 1;
  var off = (createFloatingWindow._n - 1) * 24;
  // Default position: viewport center, but converted into canvas-space so it
  // lands where the user is currently looking even if they've zoomed/scrolled.
  var defaultX, defaultY;
  // Only convert into canvas space when there IS a canvas. clientToCanvas
  // describes a transform that does not exist in the player view, so using it
  // there would place the window by coordinates from another geometry.
  if (onCanvas && typeof clientToCanvas === 'function') {
    var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    var p = clientToCanvas(cx, cy);
    var z = (typeof getZoom === 'function') ? getZoom() : 1;
    defaultX = Math.max(20, Math.round(p.x - (w/2)/z)) + (off % 200);
    defaultY = Math.max(20, Math.round(p.y - (h/2)/z)) + ((off/2) % 120);
  } else {
    // availW/availH, not innerWidth/innerHeight: under zoom they differ, and
    // centring by the device viewport puts the window off the bottom.
    defaultX = Math.max(6, Math.round(availW/2 - w/2)) + (onCanvas ? (off % 200) : 0);
    defaultY = Math.max(6, Math.round(availH/2 - h/2)) + (onCanvas ? ((off/2) % 120) : 0);
  }
  var x = opts.x != null ? opts.x : defaultX;
  var y = opts.y != null ? opts.y : defaultY;

  var z = _nextZ();
  var el = document.createElement('div');
  el.className = 'window focused';
  el.dataset.ephemeral = '1';
  // Absolute inside the canvas, which scrolls and scales with it. Fixed on the
  // body, so a popout in the player view stays put instead of scrolling away
  // with the panel underneath it.
  Object.assign(el.style, {position: onCanvas ? 'absolute' : 'fixed',
    left:x+'px', top:y+'px', width:w+'px', height:h+'px', zIndex:z});
  el.innerHTML =
    '<div class="window-head">'
      +'<div class="window-title">'
        +'<span class="window-title-icon">'+(opts.icon||'◇')+'</span>'
        +'<span>'+esc(opts.title||'')+'</span>'
      +'</div>'
      +'<div class="window-actions"><button class="btn" data-wact="close">'+ICO('i-close')+'</button></div>'
    +'</div>'
    +'<div class="window-body"></div>'
    +'<div class="rh rh-n"  data-rh="n"></div>'
    +'<div class="rh rh-s"  data-rh="s"></div>'
    +'<div class="rh rh-e"  data-rh="e"></div>'
    +'<div class="rh rh-w"  data-rh="w"></div>'
    +'<div class="rh rh-ne" data-rh="ne"></div>'
    +'<div class="rh rh-nw" data-rh="nw"></div>'
    +'<div class="rh rh-se" data-rh="se"></div>'
    +'<div class="rh rh-sw" data-rh="sw"></div>';

  var body = el.querySelector('.window-body');
  if (typeof opts.html === 'string') body.innerHTML = opts.html;

  canvas.appendChild(el);

  // Bring to front on any mousedown inside the window
  el.addEventListener('mousedown', function() {
    el.style.zIndex = _nextZ();
    document.querySelectorAll('.window').forEach(function(w){ w.classList.remove('focused'); });
    el.classList.add('focused');
  });

  // Drag (header) — listeners are attached only during the drag and removed on mouseup
  var head = el.querySelector('.window-head');
  head.addEventListener('mousedown', function(e) {
    if (e.target.closest('button')) return;
    var ox = parseInt(el.style.left), oy = parseInt(el.style.top);
    var sx = e.clientX, sy = e.clientY;
    function move(ev) {
      var z = (typeof getZoom === 'function') ? getZoom() : 1;
      el.style.left = Math.max(0, ox + (ev.clientX - sx) / z) + 'px';
      el.style.top  = Math.max(0, oy + (ev.clientY - sy) / z) + 'px';
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    e.preventDefault();
  });

  // Resize from any edge or corner
  el.querySelectorAll('.rh').forEach(function(handle) {
    handle.addEventListener('mousedown', function(e) {
      e.stopPropagation();
      var dir = handle.dataset.rh;
      var ox = parseInt(el.style.left), oy = parseInt(el.style.top);
      var ow = parseInt(el.style.width), oh = parseInt(el.style.height);
      var sx = e.clientX, sy = e.clientY;
      function move(ev) {
        var z = (typeof getZoom === 'function') ? getZoom() : 1;
        var dx = (ev.clientX - sx) / z, dy = (ev.clientY - sy) / z;
        var nx = ox, ny = oy, nw = ow, nh = oh;
        if (dir.indexOf('e') >= 0) nw = Math.max(240, ow + dx);
        if (dir.indexOf('s') >= 0) nh = Math.max(120, oh + dy);
        if (dir.indexOf('w') >= 0) {
          var w2 = Math.max(240, ow - dx);
          nx = ox + (ow - w2);
          nw = w2;
        }
        if (dir.indexOf('n') >= 0) {
          var h2 = Math.max(120, oh - dy);
          ny = oy + (oh - h2);
          nh = h2;
        }
        el.style.left = nx + 'px'; el.style.top = ny + 'px';
        el.style.width = nw + 'px'; el.style.height = nh + 'px';
      }
      function up() {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      e.preventDefault();
    });
  });

  function close() { el.remove(); }
  el.querySelector('[data-wact="close"]').addEventListener('click', function(e) {
    e.stopPropagation();
    close();
  });

  return { el: el, body: body, close: close };
}

// Resolve a monster row out of the 5etools index by slug.
//
// Slugs are NOT unique. 685 of the 4454 monster rows share one with another
// source, and 273 of those pairs have genuinely different stat blocks — Space
// Hamster is BAM 10 HP/15 AC and WDMM 1 HP/10 AC; tressym appears in both
// BGDIA and SKT. A bare `find` by slug returns whichever book happens to sort
// first, so half of every colliding pair was unreachable.
//
// Callers that stored a source alongside the slug (the bestiary saves one on
// every monster) get an exact match. `source` is optional so older saved rows,
// which predate that field, still resolve to something sensible instead of
// nothing.
function sktFindMonster(slug, source){
  if (typeof _5eData === 'undefined' || !Array.isArray(_5eData) || !slug) return null;
  const s = String(slug);
  let first = null;
  for (const d of _5eData){
    if (d.cat !== 'monster' || d._slug !== s) continue;
    if (source && d._source === source) return d;
    if (!first) first = d;
  }
  return first;
}

// ─── Monster attack parsing ─────────────────────────────────────────────────
// 5etools monster actions are free text, not structured damage. Everything the
// DM needs is in there — to-hit, average, dice, damage type — it just has to be
// read out of an English sentence. This turns one action into:
//
//   { name, toHit, save:{dc,ability,half}|null, parts:[{avg,dice,type}], alt:[…], altLabel }
//
// `parts` are ADDITIVE (a red dragon's bite is piercing *plus* fire, and the two
// must be applied separately or a fire-resistant target halves the wrong half).
// `alt` is an ALTERNATIVE — versatile weapons read "5 (1d8+1) slashing damage,
// or 6 (1d10+1) slashing damage if used with two hands", and taking both would
// double the hit. That exact mistake was made once already in the PDF importer.
//
// Returns [] for anything with no damage in it (Multiattack, Frightful
// Presence, and so on) so callers can just concat.

// The thirteen 5e damage types, in the alphabetical order every stat block
// and every resistance list uses. This was the same list written out four
// times — here as a regex, in party.js twice and in pdf-import.js — so the
// array is the source and the regex is built from it. A type that parses out
// of a stat block but is missing from a picker is exactly the drift that
// makes resistances silently not apply.
const SKT_DAMAGE_TYPES = ['acid','bludgeoning','cold','fire','force','lightning',
  'necrotic','piercing','poison','psychic','radiant','slashing','thunder'];

const SKT_DMG_TYPE_RE = new RegExp(SKT_DAMAGE_TYPES.join('|'));

// "19 (2d10 + 8) piercing damage" → {avg:19, dice:'2d10+8', type:'piercing'}
//
// Assembled from regex-literal .source rather than a quoted string: in a string
// every backslash has to be doubled, and a single missed pair turns \d into a
// literal "d" that still compiles and silently matches nothing.
//
// Built fresh per call, not hoisted — a shared /g/ regex carries lastIndex
// between calls, so one parse would resume midway through the next.
function _sktDamageRe(){
  return new RegExp(
    /(\d+)\s*\(([^)]*?)\)\s*/.source + '(' + SKT_DMG_TYPE_RE.source + ')' + /\s+damage/.source,
    'gi');
}

function _sktDamageClauses(segment){
  const out = [];
  const re = _sktDamageRe();
  let m;
  while ((m = re.exec(segment))){
    // A 2024 goblin's extra 1d4 "if the attack roll had Advantage", a Scout
    // Captain's 3d6: only on such a roll.
    const after = segment.slice(m.index + m[0].length, m.index + m[0].length + 60);
    out.push({
      avg: parseInt(m[1]),
      // "2d10 + 8" → "2d10+8"; "1d12 + 4 plus 1d8" (an Orc War Chief) → "1d12+4+1d8".
      dice: String(m[2]).replace(/\s*plus\s*/gi, '+').replace(/\s+/g, ''),
      type: m[3].toLowerCase(),
      at: m.index,
      ifAdv: /^\s*if the attack (?:roll )?(?:had|was made with) advantage/i.test(after) || undefined,
    });
  }
  return out;
}

// Cut a description down to just the clause that carries the damage. Riders
// live in later sentences — the Fire Elemental's touch sets the target alight
// for "5 (1d10) fire damage" a sentence later, and a global scan would add that
// to the hit. Stop at the first sentence break.
function _sktDamageSegment(text, fromIdx){
  const rest = text.slice(fromIdx);
  const stop = rest.search(/\.\s|\.$/);
  return stop === -1 ? rest : rest.slice(0, stop);
}

// Walk sentences forward from `fromIdx` and return the first one that actually
// carries damage. Save wording varies far more than attack wording — the
// damage may sit in the same sentence ("saving throw, taking 63 (18d6) fire
// damage") or the next one ("saving throw. On a failed save, it takes 22
// (4d10) psychic damage") — and requiring one phrasing missed 678 actions.
// Bounded to a few sentences so a long paragraph can't donate unrelated
// damage numbers to an attack.
function _sktFirstDamageSentence(text, fromIdx){
  const rest = text.slice(fromIdx);
  const sentences = rest.split(/(?<=\.)\s+/);
  for (let i = 0; i < Math.min(sentences.length, 3); i++){
    if (_sktDamageClauses(sentences[i]).length) return sentences[i];
  }
  return '';
}

function sktParseMonsterAttack(action){
  // Recharge lives in the action NAME. The data loader renders it to
  // "(Recharge 5–6)" now; older cached indexes may still hold the raw
  // "{@recharge 5}". Pull it off the name either way and hand it back as its
  // own field so the runner can show it as a chip instead of a long title.
  const rawName = String((action && action.name) || '');
  // Only a d6 recharge: "(Recharges after a Short or Long Rest)" read as
  // one too, and came back on a 6 every round.
  const rechM = rawName.match(/\(Recharge\s+(\d[^)]*)\)/i) || rawName.match(/\{@recharge\s*([^}]*)\}/i);
  let recharge = null;
  if (rechM){
    const v = (rechM[1] || '').trim();
    recharge = v ? (/–|-/.test(v) ? v : v + '–6') : '6';
  }
  // Uses that don't come back in a fight: "(3/Day)", "(1/Day, or 2/Day in
  // Lair)", "(Recharges after a Short or Long Rest)" — once.
  const dayM = rawName.match(/\((\d+)\/Day\b[^)]*\)/i);
  const uses = dayM ? +dayM[1] : /\(Recharges\b[^)]*\)/i.test(rawName) ? 1 : 0;
  const name = rawName
    .replace(/\s*\(Recharges?\b[^)]*\)/gi, '')
    .replace(/\s*\{@recharge[^}]*\}/gi, '')
    .replace(/\s*\(\d+\/Day\b[^)]*\)/gi, '')
    .trim();
  const desc = String((action && action.desc) || '');
  if (!desc) return null;

  // Save-based, in either of the two house styles the dataset mixes:
  //   2014 — "…must make a DC 21 Dexterity saving throw, taking 63 (18d6)
  //          fire damage on a failed save, or half as much on a success."
  //   2024 — "dex DC 11, each creature in a 5-foot Emanation.  7 (2d6) Fire
  //          damage.  Half damage." (abbreviated ability, no "saving throw")
  // Anchoring on the save and then taking the first sentence that carries
  // damage covers both; requiring the literal word "taking" covered neither
  // reliably and missed 880 actions between them.
  const ABIL = {str:'Strength', dex:'Dexterity', con:'Constitution',
                int:'Intelligence', wis:'Wisdom', cha:'Charisma'};
  let saveDc = null, saveAbility = null, saveAt = -1;
  // "…or Dexterity" covers "a DC 16 Strength or Dexterity saving throw
  // (target's choice)" — the Bulette's Deadly Leap, which failed to parse at
  // all because the ability was followed by another ability instead of by
  // "saving throw".
  const save2014 = desc.match(/DC\s*(\d+)\s+(\w+)(?:\s+or\s+\w+)?\s+saving throw/i);
  const save2024 = desc.match(/(?:^|[\s(])(str|dex|con|int|wis|cha)\s+DC\s*(\d+)/i);
  if (save2014){
    saveDc = parseInt(save2014[1]); saveAbility = save2014[2]; saveAt = save2014.index;
  } else if (save2024){
    saveDc = parseInt(save2024[2]);
    saveAbility = ABIL[save2024[1].toLowerCase()] || save2024[1];
    saveAt = save2024.index;
  }
  // An attack whose hit then calls for a save — the Assassin's shortsword,
  // a giant spider's bite: "+6 to hit … Hit: 6 (1d6 + 3) piercing damage, and
  // the target must make a DC 15 Constitution saving throw, taking 24 (7d6)
  // poison damage". It read as the save alone: no attack roll, no piercing.
  // It's an attack, and the save is a rider on it.
  const hitAt = desc.search(/\bHit:/i);
  const attackFirst = hitAt >= 0 && (saveAt < 0 || hitAt < saveAt)
    && /([+-]\s*\d+)\s+to hit|\bAttack(?: Roll)?:\s*[+-]\s*\d+/i.test(desc.slice(0, hitAt));
  if (saveDc != null && !attackFirst){
    const seg = _sktFirstDamageSentence(desc, saveAt);
    const parts = _sktDamageClauses(seg);
    if (parts.length){
      return {
        name, recharge, uses, toHit: null,
        save: { dc: saveDc, ability: saveAbility,
                // "half as much damage" (2014), "Half damage." (2024), and
        // "takes only half the damage" (the Bulette, among others). Missing a
        // phrasing here silently drops the Saved ½ button, so the DM applies
        // the full amount to a creature that made its save.
        half: /half as much|half damage|half the damage/i.test(desc) },
        parts: parts.map(p => ({avg:p.avg, dice:p.dice, type:p.type, ifAdv:p.ifAdv})),
        alt: null, altLabel: '',
      };
    }
  }

  // Area damage with no save and no attack roll — "Maegera exhales a
  // billowing cloud… Each creature in the area takes 11 (2d10) fire damage."
  // Nothing to anchor on, so this needs a trigger phrase rather than "any
  // damage in the text": that looser rule would also scoop up per-turn
  // ongoing damage (a Rug of Smothering's "at the start of each of the
  // target's turns, the target takes 10 (2d6+3)") and bill it as a hit.
  // Requiring "each creature in/within … takes" separates the two — the
  // ongoing cases say "the target takes" or "it takes".
  const areaM = desc.match(/each creature (?:in|within)[^.]{0,80}?\btakes\b/i);
  if (areaM && !attackFirst){
    const parts = _sktDamageClauses(_sktDamageSegment(desc, areaM.index));
    if (parts.length){
      return {
        name, recharge, uses, toHit: null, save: null,
        parts: parts.map(p => ({avg:p.avg, dice:p.dice, type:p.type, ifAdv:p.ifAdv})),
        alt: null, altLabel: '',
      };
    }
  }

  // Attack: "…: +14 to hit, … Hit: 19 (2d10 + 8) piercing damage plus 7 (2d6)
  // fire damage."
  const hitIdx = desc.search(/\bHit:/i);
  if (hitIdx === -1) return null;
  // The hit's damage stops where a save begins; what the save deals is the rider.
  const riderAt = saveDc != null && saveAt > hitIdx ? saveAt : -1;
  const seg = _sktDamageSegment(desc, hitIdx).slice(0, riderAt > 0 ? riderAt - hitIdx : undefined);
  const clauses = _sktDamageClauses(seg);
  // A hit that deals nothing itself ("Hit: the target must make a DC 13
  // Constitution saving throw, taking 9 (2d8) poison damage"): the save is it.
  if (!clauses.length) return riderAt > 0 ? sktParseMonsterAttack(Object.assign({}, action, { desc: desc.slice(riderAt) })) : null;
  const riderParts = riderAt > 0 ? _sktDamageClauses(_sktDamageSegment(desc, riderAt)) : [];
  const rider = riderParts.length ? { dc: saveDc, ability: saveAbility,
    half: /half as much|half damage|half the damage/i.test(desc.slice(riderAt)),
    parts: riderParts.map(p => ({ avg: p.avg, dice: p.dice, type: p.type })) } : null;

  // Split additive from alternative by the connector in front of each clause.
  // Anything introduced by "or" is a different way to make the SAME attack.
  const parts = [], alt = [];
  let altLabel = '';
  clauses.forEach((c, i) => {
    if (i === 0){ parts.push(c); return; }
    const between = seg.slice(clauses[i-1].at, c.at);
    if (/\bor\b/i.test(between)){
      alt.push(c);
      const tail = seg.slice(c.at).match(/damage\s+(if [^,.]*)/i);
      if (tail && !altLabel) altLabel = tail[1].trim();
    } else {
      parts.push(c);   // "plus", "and"
    }
  });

  // "+14 to hit" (2014) or "Melee Attack Roll: +7," (2024).
  const toHitM = desc.match(/([+-]\s*\d+)\s+to hit/i)
              || desc.match(/\bAttack(?: Roll)?:\s*([+-]\s*\d+)/i);
  return {
    name, recharge, uses,
    toHit: toHitM ? toHitM[1].replace(/\s+/g, '') : null,
    save: null,
    parts: parts.map(p => ({avg:p.avg, dice:p.dice, type:p.type, ifAdv:p.ifAdv})),
    alt: alt.length ? alt.map(p => ({avg:p.avg, dice:p.dice, type:p.type, ifAdv:p.ifAdv})) : null,
    altLabel: altLabel || (alt.length ? 'alternate' : ''),
    rider,
  };
}

// Every damaging action on a monster, across the action groups worth having in
// a fight. Legendary actions are included because they are exactly the thing a
// DM is juggling when a stat block gets busy.
function sktParseMonsterAttacks(raw){
  if (!raw) return [];
  const groups = [
    ['actions',           ''],
    ['bonus_actions',     'bonus'],
    ['legendary_actions', 'legendary'],
    ['reactions',         'reaction'],
  ];
  const out = [];
  groups.forEach(([key, tag]) => {
    (raw[key] || []).forEach(a => {
      const parsed = sktParseMonsterAttack(a);
      if (parsed){ parsed.group = tag; out.push(parsed); }
    });
  });
  return out;
}

// Monsters whose stat block says their strikes count as magical — "Its weapon
// attacks are magical". Matters because a target resistant to nonmagical
// bludgeoning/piercing/slashing should NOT halve these, and sktResistApplies
// already knows how to honour that once it's told.
// Proficiency bonus from a challenge rating. CR arrives as a STRING and can be
// fractional ("1/8", "1/2") or "None"/"—" for unrated creatures, so parse
// rather than coerce. PB tops out at +9 (CR 30) and floors at +2.
function sktPbForCR(cr){
  if (cr == null) return 2;
  const s = String(cr).trim();
  let n;
  if (s.includes('/')){ const [a,b] = s.split('/'); n = parseFloat(a) / parseFloat(b); }
  else n = parseFloat(s);
  if (!isFinite(n)) return 2;                       // "None", "—", "Unknown"
  return Math.max(2, Math.min(9, Math.ceil(n / 4) + 1));
}

// A monster's initiative, from a converted _raw entry.
// Returns {bonus, passive, mode} or null when there's nothing to go on.
//
// Most creatures simply use their DEX modifier. 2024-era stat blocks add an
// explicit `initiative` field in one of three shapes — {proficiency:N} meaning
// N x PB ON TOP of the DEX mod, {advantageMode:'adv'|'dis'}, or a flat number.
// `passive` is 10 + bonus, which is what the 2024 books print in parentheses
// and what a DM uses when they don't want to roll for a creature.
function sktMonsterInitiative(raw){
  if (!raw) return null;
  const dexMod = Math.floor(((raw.dexterity != null ? raw.dexterity : 10) - 10) / 2);
  const init = raw.initiative;
  let bonus = dexMod, mode = '';
  if (typeof init === 'number'){
    bonus = init;
  } else if (init && typeof init === 'object'){
    if (init.advantageMode === 'adv' || init.advantageMode === 'dis') mode = init.advantageMode;
    if (typeof init.proficiency === 'number'){
      bonus = dexMod + init.proficiency * sktPbForCR(raw.challenge_rating);
    }
  }
  return { bonus, passive: 10 + bonus, mode };
}

// Multiattack, from a converted _raw entry. Returns {text, counts} or null.
//
// `text` is the stat block's own wording and is ALWAYS the authority — it gets
// shown verbatim. `counts` maps a lowercased attack name to how many times the
// creature makes it, and is a best-effort convenience only: measured across
// the 2,138 multiattacks in the bestiary, every parsed name resolves to a real
// action 61% of the time and at least one does 68%. The rest are generic
// wording ("makes two melee attacks", "uses Spellcasting") that names nothing
// to link to. So callers must treat counts as "annotate if present", never as
// a substitute for reading the text — which is why both come back together.
const _SKT_NUMWORD = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10 };
function _sktCount(w){
  const s = String(w||'').toLowerCase();
  if (_SKT_NUMWORD[s] != null) return _SKT_NUMWORD[s];
  const n = parseInt(s, 10);
  return (isFinite(n) && n > 0 && n <= 20) ? n : null;
}
function sktParseMultiattack(raw){
  if (!raw) return null;
  const act = (raw.actions || []).find(a => /^multiattack/i.test(String(a && a.name || '').trim()));
  if (!act) return null;
  const text = _stripTagsIfAvailable(act.desc || '');
  if (!text) return null;
  const counts = {}, soft = new Set();
  const TIMES_W = { once: 'one', twice: 'two', thrice: 'three' };
  // A name as the prose gives it, as an action would be called: no "its",
  // no "melee"/"weapon" ("two Trident melee attacks"); an unarmed strike.
  const clean = (s, strike) => {
    let t = String(s || '').trim().toLowerCase().replace(/^(?:either\s+)?(?:its|his|her|their|the)\s+/, '').replace(/^either\s+/, '').replace(/^[+-]\d+\s+/, '').replace(/\s+(?:melee|ranged|weapon|only)$/, '').trim();
    if (strike && !/strike$/.test(t)) t = t + ' strike';
    return t;
  };
  // Junk a lazy match can swallow: "attacks with his shortsword and two".
  const junk = t => !t || /\b(?:attacks?|with|and|or|using|uses?|times?)\b/.test(t) || /^(?:a|an|one|other|melee|ranged|weapon|natural weapon|melee weapon|ranged weapon|different weapon)$/.test(t) || /^(?:a|an)\s/.test(t);
  // "a Lightning Antlers attack and a Thunder Hooves attack": one each.
  const num = w => /^an?$/i.test(String(w || '')) ? 1 : _sktCount(w);
  const add = (w, s, strike) => { const n = num(w), t = clean(s, strike); if (!n || junk(t)) return false; counts[t] = Math.max(counts[t] || 0, n); return true; };
  let m;
  // "Makes two handaxe attacks OR uses his Hurl Flame twice", "attacks three
  // times with his scimitar, OR twice with his darts": alternatives, not a
  // sum. Count the first, unless it names nothing.
  // ("…or she makes three attacks with her longbow", "…, or it makes two Eldritch Bolt attacks")
  // ("…two Talon attacks or a Talon attack and a Beak attack", "…. Alternatively, it makes two…")
  const alts = text.split(/,?\s+or\s+(?=(?:(?:it|he|she|they)\s+(?:can\s+)?)?(?:makes?|uses?|attacks?|throws?|casts?|twice|once|thrice|one|two|three|four|five)\b|an?\s+[\w'’\- ]+?\s+attack\b)|\.\s+(?:Alternatively,?|Or)\s+/i);
  const countIn = text => {
  // "makes two Slam attacks", "makes up to three Bite attacks", "makes one
  // bite attack and two unarmed strikes", "uses his staff to make three Arcane Blast attacks"
  // (and the middle of a list: "one Claw attack, one Tentacles attack, and one Trident attack")
  const reNamed = /(?:\bmakes?|,\s+and|\band|,)\s+(?:up\s+to\s+)?(\w+)\s+([A-Za-z][\w'’\- ]*?)\s+(attacks?|strikes?)\b/gi;
  // A rejected match (", the werebear makes two claw attacks" read from the
  // comma) is searched again from just past where it began, or it hides the
  // real "makes two claw attacks" inside it.
  while ((m = reNamed.exec(text))){ if (!add(m[1], m[2], /^strike/i.test(m[3]))) reNamed.lastIndex = m.index + 1; }
  // "three attacks: one with its mandibles and two with its claws", "two
  // attacks with his shortsword and two attacks with his rapier", "one
  // attack with its spear", "two melee attacks with its staff"
  // (an em dash ends a name too: "three attacks—one with its slam and two with its eldritch turrets—")
  const reWith = /(\w+)\s+(?:(?:melee|ranged|weapon)\s+)?(?:attacks?\s+)?with\s+(?:its|his|her|their|the)?\s*([A-Za-z][\w'’\- ]*?)(?=\s*(?:,|\.|;|—|\band\b|\bor\b|$))/gi;
  while ((m = reWith.exec(text))) add(m[1], m[2]);
  // "attacks twice with her flail and once with Matalotok", "three times with its daggers"
  const reTimes = /\b(once|twice|thrice|\w+\s+times)\s+with\s+(?:its|his|her|their|the)?\s*([A-Za-z][\w'’\- ]*?)(?=\s*(?:,|\.|;|\band\b|\bor\b|$))/gi;
  const TIMES = { once: 'one', twice: 'two', thrice: 'three' };
  while ((m = reTimes.exec(text))) add(TIMES[m[1].toLowerCase()] || m[1].split(/\s+/)[0], m[2]);
  // "uses Polar Ray twice", "uses its Mind Thrust twice"
  const reUses = /\buses?\s+(?:its|his|her|their)?\s*([A-Z][\w'’\- ]*?)\s+(once|twice|thrice|\w+\s+times)\b/g;
  // A used ability may be no attack at all (Fear Gaze): `soft`, so a plan
  // isn't refused for leaving it out.
  while ((m = reUses.exec(text))){ if (add(TIMES[m[2].toLowerCase()] || m[2].split(/\s+/)[0], m[1])) soft.add(clean(m[1])); }
  };
  // "makes two melee attacks", "three melee weapon attacks": any of its attacks.
  const ANY_RE = /makes\s+(\w+)\s+(?:(?:melee|ranged|weapon)\s+){0,2}attacks?\b(?!\s*:\s*\S)/i;
  // "…three melee attacks, but can use Constrict only once": a limit, not a count.
  const onlyOnce = /,?\s*but\s+(?:it\s+|he\s+|she\s+)?can\s+(?:use|make)\s+(?:its\s+|his\s+|her\s+)?([A-Za-z][\w'’\- ]*?)\s+(?:attacks?\s+)?only\s+once(?:\s+each)?/i.exec(alts[0]);
  if (onlyOnce) alts[0] = alts[0].slice(0, onlyOnce.index) + alts[0].slice(onlyOnce.index + onlyOnce[0].length);
  countIn(alts[0]);
  // The first alternative naming nothing ("three melee weapon attacks.
  // Alternatively, two ranged attacks with its javelins") is still the default.
  if (!Object.keys(counts).length && alts.length > 1 && !ANY_RE.test(alts[0])) countIn(text);
  // A choice of attacks, each swing any of them: "makes three attacks, using
  // Greataxe or Javelin in any combination" (2024), "two Greatsword or Heavy
  // Crossbow attacks", "two attacks with its greataxe or its spear". The
  // first-named is the default; the others are offered at each swing.
  let combo = null;
  const names = s => s.split(/\s*,\s*(?:or\s+|and\s+)?|\s+or\s+|\s+and\s+/i).map(x => clean(x.replace(/^(?:either|a|an)\s+/i, ''))).filter(Boolean);
  const cm = /makes\s+(\w+)\s+attacks?,?\s+using\s+(.+?)\s+in any combination/i.exec(text)
    // "makes any combination of two Bite, Claw, or Magic Longsword attacks"
    || /makes\s+any\s+combination\s+of\s+(\w+)\s+(.+?)\s+attacks?\b/i.exec(text)
    // "makes either two Hooves attacks, two Moon Bolt attacks, or one of each"
    || (() => { const x = /makes\s+either\s+(\w+)\s+(.+?)\s+attacks?,?\s+(?:or\s+)?\1\s+(.+?)\s+attacks?/i.exec(text); return x ? [x[0], x[1], x[2] + ' or ' + x[3]] : null; })()
    // "two Greatsword or Heavy Crossbow attacks", "two Longsword, Musket, or Pistol attacks", "two Dagger or +1 Longsword attacks"
    || /makes\s+(\w+)\s+([A-Za-z+][\w'’,+\- ]*?\s+or\s+[A-Za-z+][\w'’+\- ]*?)\s+attacks?\b/i.exec(text)
    || /makes\s+(\w+)\s+attacks?\s+with\s+((?:(?:its|his|her|their)\s+)?[\w'’+\- ]+?(?:(?:\s*,\s*|\s+or\s+)(?:its|his|her|their)?\s*[\w'’+\- ]+?)?)(?=\s*[.,;]|$)/i.exec(text)
    // "attacks twice, either with his longsword or dagger"
    || (() => { const x = /attacks\s+(once|twice|thrice|\w+\s+times),?\s+(?:either\s+)?with\s+(?:its|his|her|their)\s+([\w'’+\- ]+?\s+or\s+(?:(?:its|his|her|their)\s+)?[\w'’+\- ]+?)(?=\s*[.,;]|$)/i.exec(text); return x ? [x[0], TIMES_W[x[1].toLowerCase()] || x[1].split(/\s+/)[0], x[2]] : null; })();
  // A choice whose "names" are junk ("melee attacks or two ranged") is no choice.
  if (cm && _sktCount(cm[1]) && names(cm[2]).length && !names(cm[2]).some(junk)) combo = { n: _sktCount(cm[1]), names: names(cm[2]) };
  // "one Bite attack and three other attacks, using Claw or Tail in any
  // combination" (the Tarrasque): the bite, then three swings of a choice.
  const other = !combo && /(\w+)\s+other\s+attacks?,?\s+using\s+(.+?)\s+in any combination/i.exec(text);
  if (other && _sktCount(other[1]) && names(other[2]).length && !names(other[2]).some(junk)) combo = { n: _sktCount(other[1]), names: names(other[2]), plus: true };
  // "attacks twice with a weapon", "three times with a melee weapon": any of them.
  // (and a bare "attacks twice." that names nothing)
  const anyW = !combo && !Object.keys(counts).length && (/attacks\s+(once|twice|thrice|\w+\s+times)\s+with\s+(?:a|any)\s+(?:melee\s+|ranged\s+)?weapon/i.exec(text) || /\battacks\s+(twice|thrice|\w+\s+times)\s*(?:[.;]|$)/i.exec(text));
  if (anyW) combo = { n: _sktCount(TIMES_W[anyW[1].toLowerCase()] || anyW[1].split(/\s+/)[0]), names: [], any: true };
  // A werebear's "In bear form, two claw attacks. In humanoid form, two
  // greataxe attacks": one form's or the other's, not all four.
  if (!combo && (text.match(/\bIn\s+[\w-]+\s+form\b/gi) || []).length >= 2 && Object.keys(counts).length > 1)
    combo = { n: Math.max(...Object.values(counts)), names: Object.keys(counts), forms: true };
  // Or none named at all — "makes two attacks", "two melee attacks": any of its attacks.
  // A bare "makes three attacks:" whose list the data lost counts as that too.
  const any = !combo && !Object.keys(counts).length && ANY_RE.exec(alts[0]);
  if (any && _sktCount(any[1]) && !/\bwith\b/i.test(text.slice(any.index, any.index + any[0].length + 6))) combo = { n: _sktCount(any[1]), names: [], any: true, melee: /melee/i.test(any[0]) };
  // "It can replace one attack with a Bite attack": one more choice.
  const rep = /replace\s+(?:one|any)\s+(?:of\s+(?:the|those)\s+)?attacks?\s+with\s+(?:a|an|one)\s+([A-Za-z][\w'’\- ]*?)\s+attack/i.exec(text);
  if (combo && rep) combo.extra = [rep[1].trim().toLowerCase()];
  // "…two attacks, only one of which can be a bite attack": not the default.
  const only = /only one of which can be (?:a|an|its)\s+([A-Za-z][\w'’\- ]*?)\s+attack/i.exec(text);
  if (combo && only) combo.notDefault = only[1].trim().toLowerCase();
  else if (combo && onlyOnce) combo.notDefault = clean(onlyOnce[1]);
  return { text, counts, combo, soft: [...soft] };
}
// _stripTags lives in data-loader.js, which is not guaranteed to have parsed
// yet in every context that loads utils.js. Descriptions are already stripped
// by the converter, so this is belt-and-braces for hand-fed data.
function _stripTagsIfAvailable(s){
  if (typeof _stripTags === 'function'){ try { return _stripTags(s); } catch(e){} }
  return String(s || '');
}

// Look up how many times `name` appears in a multiattack's counts, tolerating
// the plural the prose uses against the singular the action is named with
// ("two with its claws" → the action is "Claw"). Returns 0 when there is no
// confident match — the caller then shows nothing rather than a wrong number.
function sktMultiattackCountFor(counts, name){
  if (!counts || !name) return 0;
  // "Grave Strike (Vampire Form Only)" is the Grave Strike the prose counts.
  const n = String(name).replace(/\s*\([^)]*\)/g, '').replace(/^[+-]\d+\s+/, '').trim().toLowerCase();
  if (counts[n]) return counts[n];
  if (counts[n + 's']) return counts[n + 's'];
  const dep = n.replace(/s$/, '');
  if (dep !== n && counts[dep]) return counts[dep];
  // Spacing and a trailing bonus aside: "Short bow" is the Shortbow, "Rapier +1" the +1 rapier.
  const sq = s => s.replace(/\s+[+-]\d+$/, '').replace(/\s+/g, '');
  for (const k of Object.keys(counts)){ const a = sq(k), b = sq(n); if (a === b || a === b + 's' || a.replace(/s$/, '') === b) return counts[k]; }
  // The prose's word inside a longer action name: "harpoon" for "Ruidium
  // Harpoon", "flail" for "Silvered Skull Flail", "scimitar" for
  // "Foremother (+1 Scimitar)". Whole words only.
  const full = String(name).toLowerCase();
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const k of Object.keys(counts)){
    const kk = k.replace(/s$/, '');
    if (kk.length >= 3 && new RegExp('\\b' + esc(kk) + 's?\\b').test(full)) return counts[k];
  }
  // …and the other way: "two adamantine greatclub attacks" for a "Greatclub".
  const bare = n.replace(/s$/, '');
  if (bare.length >= 4) for (const k of Object.keys(counts)){
    if (k.length > n.length && new RegExp('\\b' + esc(bare) + 's?$').test(k)) return counts[k];
  }
  return 0;
}

// The 5e entry parser emits private control characters: \x04 wraps a bold
// label, \x05 italic, \x06 bold, \x01 starts a section header, \x02 and \x03
// fence an inset or a quote, \x07 fences an embedded table. search.js renders
// them to HTML. Every OTHER surface — the Turn View stat block, the party
// sheet's monster summary — prints the string as plain text, where the markers
// are invisible junk that also eats the punctuation they stood in for.
//
// 90 monsters already leaked this way via `type:'item'` nodes; restoring
// itemSub text and monster spellcasting would have taken it past a thousand.
function sktPlainEntries(s){
  if (s == null) return '';
  return String(s)
    // An embedded table has no sensible one-line form — drop it rather than
    // spill its JSON into a trait line.
    .replace(/\x07[\s\S]*?\x07/g, '')
    // A bold label carries its own full stop in the HTML renderer, so put one
    // back here — unless the label already ends in punctuation ("Mage:").
    .replace(/\x04([^\x04]+)\x04/g, (_, t) => /[.:!?]$/.test(t.trim()) ? t : t + '.')
    .replace(/\x01([^\n]*)\n*/g, '$1 ')
    .replace(/[\x02\x03\x05\x06]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function sktMonsterAttacksAreMagical(raw){
  const blocks = [].concat(raw && raw.special_abilities || [], raw && raw.actions || []);
  return blocks.some(b => /attacks?\s+(?:are|count as)\s+magical/i.test(String(b && b.desc || '')));
}

// ─── Combatant ⇄ token name matching ─────────────────────────────────────────
// Tokens are matched to combatants BY NAME — there is no shared id — so this
// is the single place that decides whether "Hill Giant 1 1" on the map is the
// same creature as "hill giant 1 1" in the tracker. It lived in three copies
// before; the strict `===` one silently matched two of eight creatures and the
// Turn View drew a map with most of the fight missing.
// Resource pools that are the SAME pool under two names, so they merge instead
// of stacking up. The monk's Ki Points became Focus Points in the 2024 rules;
// the PDF importer derived one name while this app's own class template used
// the other, and nothing compared them — so importing a monk sheet onto a monk
// who already had the pool produced two of it, side by side, each spendable.
//
// Canonical side is the app's existing template name, so nothing that already
// works has to be renamed.
const SKT_RESOURCE_ALIASES = {
  'ki points': 'Focus Points',
  'ki':        'Focus Points',
  'focus':     'Focus Points',
};
// What a long rest gives back in hit dice, in words: every die (the 2024
// rules: "all spent Hit Point Dice") or half of them (2014). For a party,
// both when its characters use different handbooks.
function sktHdRestWords(chars){
  const eds = new Set((chars || []).filter(Boolean).map(c => ((c.build && c.build.edition) || c.rules || '2024') === '2014' ? '2014' : '2024'));
  return eds.size > 1 ? 'hit dice back (all of them in 2024, half in 2014)' : eds.has('2014') ? 'half the hit dice back' : 'every hit die back';
}
// What a pool is called for this character. The pool is Focus Points
// everywhere inside (the merge above keeps it so), but a 2014 monk's handbook,
// and D&D Beyond's 2014 monk, call it Ki Points.
// A character's speed as it stands: exhaustion (5 ft a level in 2024; halved
// at 2 and gone at 5 in 2014), and the conditions that hold it at 0 —
// grappled, restrained, paralyzed, petrified, unconscious, and a 2014 stun
// ("can't move"; the 2024 Stunned doesn't stop movement). { ft, base, why }.
// The sheet showed a grappled character's full 30 ft, and the map measured
// moves against it.
const SKT_SPEED_ZERO = ['grappled', 'restrained', 'paralyzed', 'petrified', 'unconscious'];
function sktSpeedNow(pc, mode){
  if (!pc) return { ft: 0, base: 0, why: '' };
  const base = mode && mode !== 'walk' && pc.speeds && pc.speeds[mode] != null ? +pc.speeds[mode] : (pc.spd ?? 30);
  const ed = (pc.build && pc.build.edition) || pc.rules || '2024', exh = +pc.exhaustion || 0;
  const co = (typeof state !== 'undefined' && state.combatants || []).find(x => x && x.id === pc.id);
  const conds = [...new Set([...(pc.conditions || []), ...((co && co.conditions) || [])])].map(c => String(c).toLowerCase());
  const held = SKT_SPEED_ZERO.concat(ed === '2014' ? ['stunned'] : []).find(c => conds.some(x => x === c || x.startsWith(c + ' ')));
  if (held) return { ft: 0, base, why: held[0].toUpperCase() + held.slice(1) };
  if (!exh) return { ft: base, base, why: '' };
  const ft = ed === '2024' ? Math.max(0, base - 5 * exh) : exh >= 5 ? 0 : exh >= 2 ? Math.floor(base / 2) : base;
  return { ft, base, why: ft !== base ? 'Exhaustion' : '' };
}
function sktResLabel(pc, name){
  const n = String(name == null ? '' : name);
  const e = pc && ((pc.build && pc.build.edition) || pc.rules);
  return n === 'Focus Points' && e === '2014' ? 'Ki Points' : n;
}
// Canonical display name for a resource, or the name unchanged. Comparison is
// case- and space-insensitive on its own, which also folds "Ki points" and
// "Focus  Points" into their canonical spelling.
function sktCanonResource(name){
  const k = sktNormName(name);
  return SKT_RESOURCE_ALIASES[k] || String(name == null ? '' : name).trim();
}
// Fold a resource list so no two entries name the same pool. Keeps the larger
// maximum and the SMALLER current — a fresh import must not hand back points
// the character has already spent.
function sktMergeResources(list){
  if (!Array.isArray(list)) return list;
  const out = [], byKey = new Map();
  list.forEach(r => {
    if (!r || typeof r !== 'object'){ return; }
    const name = sktCanonResource(r.name);
    const key = sktNormName(name);
    const ex = byKey.get(key);
    if (!ex){ const c = { ...r, name }; byKey.set(key, c); out.push(c); return; }
    const max = Math.max(+ex.max || 0, +r.max || 0);
    const cur = Math.min(
      ex.current != null ? +ex.current : max,
      r.current  != null ? +r.current  : max);
    ex.max = max;
    ex.current = Math.max(0, Math.min(max, cur));
  });
  return out;
}


// How many uses of a limited feature the sheet says this character has, as
// {name: max}. Two forms, both of which appear on one sheet:
//
//    | Focus Points: 6 / Short Rest • Special     <- named outright
//    | 3 / Long Rest • 1 Action                   <- named by the bullet above
//
// This exists because a derived table is a guess about a character and the
// sheet is a fact about them. _deriveResources gave a level 6 druid 2 uses of
// Wild Shape; the 2024 rules and the sheet both say 3. Rather than carry a
// table that has to be right for every class in two rule sets, the number the
// sheet states wins wherever it states one.
function sktDeclaredPools(featuresText){
  const text = String(featuresText || '');
  const out = {};
  if (!text.trim()) return out;
  let bullet = '';
  text.split('\n').forEach(raw => {
    const line = raw.trim();
    if (/^\*/.test(line)){ bullet = line.replace(/^\*\s*/, '').split('•')[0].trim(); return; }
    if (!/^\|/.test(line)) return;
    const seg = line.replace(/^\|\s*/, '').replace(/[\s•]+$/, '')
                    .split(/[•:]/).map(s => s.trim()).filter(Boolean);
    // The uses segment is not always last — "6 / Short Rest • Special" puts
    // the activation cost after it.
    const i = seg.findIndex(x => SKT_ACT_USES.test(x));
    if (i < 0) return;
    const n = parseInt(SKT_ACT_USES.exec(seg[i])[1], 10);
    const name = seg.slice(0, i).join(': ') || bullet;
    // Highest wins: a feature can be listed more than once and the larger
    // figure is the one that includes the level bumps.
    if (name && n > 0 && !(out[name] > n)) out[name] = n;
  });
  return out;
}

// "Bonus Action" does not fit a party card, and the Turn View had already
// grown its own copy of this mapping. One function, so the two rows cannot
// drift into abbreviating the same thing differently.
// ── Weapon masteries (2024) ─────────────────────────────────────────────────
// A built character keeps its picks on each attack row (a.mastery). An
// imported one has them only in the PDF's feature text, in two forms:
// "| Greatsword (Graze) •" under Weapon Mastery, and "| Slow (Javelin): 1
// Action" in the actions list. Either gives weapon → mastery.
const SKT_MASTERY_TEXT = {
  Cleave: 'On a hit, one more attack against a creature within 5 ft of the first, once per turn; no ability modifier on its damage unless negative.',
  Graze:  'On a miss, the target still takes damage equal to the ability modifier you attacked with.',
  Nick:   'The Light weapon\u2019s extra attack is part of the Attack action instead of a Bonus Action, once per turn.',
  Push:   'On a hit, push a Large or smaller creature up to 10 ft straight away from you.',
  Sap:    'On a hit, the target has Disadvantage on its next attack roll before your next turn.',
  Slow:   'On a hit that deals damage, the target\u2019s Speed drops by 10 ft until your next turn.',
  Topple: 'On a hit, the target makes a CON save (DC 8 + the attack\u2019s ability modifier + proficiency) or falls Prone.',
  Vex:    'On a hit that deals damage, Advantage on your next attack against it before the end of your next turn.',
};
// A mastery with this character's numbers in it, as D&D Beyond shows them:
// Graze's damage on a miss, Topple's save DC. The ability is the one the
// attack uses (Strength, or Dexterity for a ranged or finesse weapon that
// isn't marked as using Strength).
function sktMasteryText(pc, a, ms){
  const base = SKT_MASTERY_TEXT[ms] || '';
  if (!pc || !a) return base;
  const ab = pc.abilities || {}, m = k => Math.floor(((+ab[k] || 10) - 10) / 2);
  const mod = a.str ? m('str') : (a.range && !(a.props || []).includes('T')) || (a.props || []).includes('F') ? Math.max(m('dex'), (a.props || []).includes('F') ? m('str') : -99) : m('str');
  const pb = +((pc.sheet || {}).profBonus) || (2 + Math.floor(((+pc.level || 1) - 1) / 4));
  if (ms === 'Graze') return 'On a miss, the target still takes ' + Math.max(0, mod) + ' damage (your ' + (a.str ? 'Strength' : 'ability') + ' modifier), of the weapon’s type.';
  if (ms === 'Topple') return 'On a hit, the target makes a DC ' + (8 + mod + pb) + ' Constitution save or falls Prone.';
  if (ms === 'Cleave') return 'On a hit, attack a second creature within 5 ft of the first, once per turn: the weapon’s damage dice' + (mod > 0 ? ', without your +' + mod : '') + '.';
  return base;
}
const _sktMasteryCache = new Map();
function sktImportedMasteries(pc){
  const t = String((pc && pc.sheet && pc.sheet.bio && pc.sheet.bio.features) || '');
  if (_sktMasteryCache.has(t)) return _sktMasteryCache.get(t);
  const P = Object.keys(SKT_MASTERY_TEXT).join('|'), out = {};
  for (const m of t.matchAll(new RegExp('\\|\\s*([^|\\n(\u2022]+?)\\s*\\((' + P + ')\\)\\s*\u2022', 'g'))) out[m[1].trim().toLowerCase()] = m[2];
  for (const m of t.matchAll(new RegExp('\\|\\s*(' + P + ')\\s*\\(([^)\\n]+)\\)\\s*:', 'g'))){ const w = m[2].trim().toLowerCase(); if (!out[w]) out[w] = m[1]; }
  _sktMasteryCache.set(t, out);
  return out;
}
// The mastery an attack row uses ("Graze"), or ''.
function sktMasteryOf(pc, a){
  if (!a) return '';
  if (a.mastery) return a.mastery;
  if (!pc || pc.build) return '';
  const m = sktImportedMasteries(pc);
  const n = String(a.name || '').toLowerCase().replace(/^\+\d\s+/, '').replace(/\s*\+\d$/, '').replace(/\s*\(.*\)$/, '').trim();
  return m[n] || (a.base && m[String(a.base).toLowerCase()]) || '';
}

function sktActionShort(action){
  const s = String(action || '').toLowerCase();
  return s === 'bonus action' ? 'BONUS' : s === 'reaction'      ? 'REACT'
       : s === 'action'       ? 'ACT'   : s === 'magic action'  ? 'MAGIC'
       : s === 'special'      ? 'SPEC'  : s === 'free action'   ? 'FREE'
       : s === 'legendary action' ? 'LEG' : String(action || '—').toUpperCase();
}
// ── Which side a combatant fights for ───────────────────────────────────────
//
// This used to be read straight off isPC, which conflated two unrelated
// facts: "has a character sheet in the party roster" and "is on the party’s
// side". A rival adventuring party, a boss built on class levels, an evil
// duplicate of a player — all of them want the first without the second,
// and there was no way to say so.
//
// isPC keeps its old meaning: this combatant is backed by a record in
// state.party. The record itself now says whose side it is on.
function sktPartyRecord(c){
  if (!c || !c.isPC || typeof state === 'undefined') return null;
  return (state.party || []).find(p => p.id === c.id) || null;
}
function sktIsFoeRecord(p){ return !!(p && p.foe); }
// 'party' or 'foe'. Monsters are always foes; a sheet-backed character is
// whichever its record says.
function sktSideOf(c){
  if (!c) return 'foe';
  if (!c.isPC) return 'foe';
  return sktIsFoeRecord(sktPartyRecord(c)) ? 'foe' : 'party';
}
// The characters that belong to the players. Everything player-facing reads
// this rather than state.party directly, or a rival’s hit points end up on
// every phone at the table.
function sktPlayerParty(){
  if (typeof state === 'undefined') return [];
  return (state.party || []).filter(p => !sktIsFoeRecord(p));
}
// ── Activatable features, read off an imported sheet ────────────────────────
//
// A D&D Beyond sheet already says everything needed to offer a character's
// options in combat, in two places that are consistently formatted:
//
//   * Monk's Focus • PHB-2024 101
//     ... Flurry of Blows. You can expend 1 Focus Point to make two Unarmed
//     Strikes as a Bonus Action. ...
//        | Flurry of Blows: 1 Bonus Action
//
// The pipe line carries the name and the action-economy cost; the prose
// carries the resource cost. Both are needed: "1 Bonus Action" alone doesn't
// tell you Flurry spends a Focus Point, and "expend 1 Focus Point" alone
// doesn't tell you it's a Bonus Action.
//
// Derived on read rather than stored at import, so it needs no new field, no
// migration, and it updates when the DM edits the features text by hand.
// Results are cached on the text itself, which is the only input.

const SKT_ACT_COST = /^(?:1\s+)?(Action|Bonus Action|Reaction|Magic Action|Free Action|Special|Legendary Action)$/i;
const SKT_ACT_USES = /^(\d+)\s*\/\s*(Short Rest|Long Rest|Rest|Day|Turn|Round|Encounter)$/i;

const _sktActCache = new Map();

// What a party member can activate. A character from the builder carries
// its actions worked out, with the pool each one spends; an imported one
// has them read back out of its sheet's features text. Every screen that
// lists or spends actions asks here, so the two kinds behave the same in the
// party sheet, the Turn View and on the phone.
// ── Bardic Inspiration, end to end ──────────────────────────────────────────
// There were two that never met: the bard's pool of uses, and a "Bardic"
// toggle on every party card. Granting from a card didn't spend a use, and
// spending a use gave nobody a die. Now a grant is one thing — a use comes
// off the bard's pool and the recipient holds that bard's die — from the
// party card, the bard's own phone, or the Turn View.
function sktBardicPool(pc){
  return (pc && Array.isArray(pc.resources)) ? pc.resources.find(r => r.name === 'Bardic Inspiration') || null : null;
}
function sktBards(){ return (state.party || []).filter(p => p && sktBardicPool(p)); }
function sktBardicDie(bard){
  const p = sktBardicPool(bard);
  if (p && p.die) return String(p.die).replace(/^1d/, 'd');
  const lvl = parseInt((bard && bard.level) || 0, 10);
  return lvl >= 15 ? 'd12' : lvl >= 10 ? 'd10' : lvl >= 5 ? 'd8' : 'd6';
}
// Spend one of the bard's uses on the target. '' on success, else why not.
function sktGrantBardic(bardId, targetId){
  const bi = state.party.findIndex(p => p.id === bardId), ti = state.party.findIndex(p => p.id === targetId);
  if (bi < 0 || ti < 0) return 'Character not found';
  if (bi === ti) return 'A bard can\u2019t inspire themself';
  const bard = state.party[bi], tgt = state.party[ti], pool = sktBardicPool(bard);
  if (!pool || pool.current <= 0) return bard.name + ' has no Bardic Inspiration left';
  if (tgt.bardicInspiration) return tgt.name + ' already has a Bardic Inspiration die';
  const die = sktBardicDie(bard);
  const go = () => {
    state.party[bi] = { ...bard, resources: bard.resources.map(r => r === pool ? { ...r, current: r.current - 1 } : r) };
    state.party[ti] = { ...state.party[ti], bardicInspiration: die, bardicFrom: bard.name };
    save();
  };
  if (typeof sktUndoable === 'function') sktUndoable(bard.name + ' inspires ' + tgt.name + ' (' + die + ')', go, { quiet: true }); else go();
  return '';
}
// Ask who should get it, then grant. `from` is the bard; `to` is optional
// (a party card already knows the recipient, and then it asks which bard).
function sktAskBardic(opts){
  opts = opts || {};
  const say = m => { if (typeof showToast === 'function') showToast(m); };
  const done = (bardId, targetId) => {
    const why = sktGrantBardic(bardId, targetId);
    if (why) say(why);
    else {
      const b = state.party.find(p => p.id === bardId), t = state.party.find(p => p.id === targetId);
      if (typeof showToast === 'function') showToast('🎵 ' + b.name + ' inspires ' + t.name + ' — ' + t.bardicInspiration,
        typeof sktUndo === 'function' ? { action: { label: 'Undo', run: sktUndo } } : undefined);
    }
    try { panelDefs.party && panelDefs.party._render && panelDefs.party._render(); } catch(e){}
    if (typeof opts.after === 'function') opts.after();
  };
  if (opts.from){
    const others = (state.party || []).filter(p => p.id !== opts.from && !p.foe && !p.bardicInspiration);
    if (!others.length){ say('Everyone already has a Bardic Inspiration die'); return; }
    if (typeof showModal !== 'function') return done(opts.from, others[0].id);
    showModal('🎵 Bardic Inspiration', [{ id: 'to', label: 'Who gets it?', type: 'select',
      options: others.map(p => ({ value: p.id, label: p.name })) }], 'Inspire').then(r => { if (r && r.to) done(opts.from, r.to); });
    return;
  }
  if (opts.to){
    const bards = sktBards().filter(b => b.id !== opts.to);
    const ready = bards.filter(b => (sktBardicPool(b).current || 0) > 0);
    if (!bards.length){ say('No one in the party has Bardic Inspiration to give'); return; }
    if (!ready.length){ say(bards.map(b => b.name).join(' and ') + ' ' + (bards.length === 1 ? 'has' : 'have') + ' no Bardic Inspiration left'); return; }
    if (ready.length === 1 || typeof showModal !== 'function') return done(ready[0].id, opts.to);
    showModal('🎵 Bardic Inspiration', [{ id: 'from', label: 'From which bard?', type: 'select',
      options: ready.map(b => ({ value: b.id, label: b.name + ' (' + sktBardicPool(b).current + ' left)' })) }], 'Inspire')
      .then(r => { if (r && r.from) done(r.from, opts.to); });
  }
}

// Heroes of Faerûn's Circle Magic is a table rule: spellcasters casting one
// spell together. The rules work it out for every 2024 caster when that book
// is on, but it shows only when the DM has switched it on for the campaign
// (party ⋯ menu), so a table that doesn't use it isn't handed seven actions
// per caster. Filtered where shown, so switching it is instant both ways.
// Whether a ranged attack takes a piece of ammunition from the inventory: one
// setting for the whole table (the Party menu), on unless the DM turns it off.
function sktAmmoOn(){ return !(typeof state !== 'undefined' && state.settings && state.settings.useAmmunition === false); }
function sktCircleMagicOn(){ return !!(typeof state !== 'undefined' && state.settings && state.settings.circleMagic); }
function sktShownActivations(list){
  const a = Array.isArray(list) ? list : [];
  // The same list back when there's nothing to hide (the Turn View and the
  // phone share it).
  if (sktCircleMagicOn() || !a.some(x => x && x.feature === 'Circle Magic')) return a;
  return a.filter(x => !x || x.feature !== 'Circle Magic');
}
function sktActivationsOf(pc){
  if (!pc) return [];
  if (pc.build && pc.sheet && Array.isArray(pc.sheet.activations)) return sktShownActivations(pc.sheet.activations);
  return sktDeriveActivations((pc.sheet && pc.sheet.bio && pc.sheet.bio.features) || '');
}

function sktDeriveActivations(featuresText){
  const text = String(featuresText || '');
  if (!text.trim()) return [];
  if (_sktActCache.has(text)) return _sktActCache.get(text);

  const lines = text.split('\n');
  const out = [];
  let bullet = '';

  lines.forEach(raw => {
    const line = raw.trim();
    if (/^\*/.test(line)){
      // "* Hand of Harm • PHB-2024 104" — the source reference is not a name.
      bullet = line.replace(/^\*\s*/, '').split('•')[0].trim();
      return;
    }
    if (!/^\|/.test(line)) return;

    // Peel the cost off the end. Both • and : act as separators, and which one
    // appears varies within a single sheet.
    const body = line.replace(/^\|\s*/, '').replace(/[\s•]+$/, '');
    const seg = body.split(/[•:]/).map(s => s.trim()).filter(Boolean);
    if (!seg.length) return;

    let action = '', uses = '';
    if (SKT_ACT_COST.test(seg[seg.length - 1])) action = seg.pop();
    if (seg.length && SKT_ACT_USES.test(seg[seg.length - 1])) uses = seg.pop();

    // No activation cost at all means this is not something you do — it is a
    // choice the sheet is recording ("| Warrior of Mercy", "| Bronze Dragon").
    if (!action) return;

    const name = seg.join(': ') || bullet;
    if (!name) return;

    out.push({ name, action: action.replace(/^1\s+/, ''), uses, feature: bullet });
  });

  // A pool is not an action. "| Focus Points: 6 / Short Rest • Special" is the
  // sheet declaring the resource that the entries below it spend.
  const pools = new Set(out.filter(a => a.uses && /^special$/i.test(a.action))
                           .map(a => sktCanonResource(a.name).toLowerCase()));
  const acts = out.filter(a => !pools.has(sktCanonResource(a.name).toLowerCase()));

  // Now the resource cost, from the prose. Search forward from where the
  // option is named, stopping at the next bullet or the next sub-option's
  // heading — otherwise Flurry of Blows reads Patient Defense's sentence and
  // every monk option costs the same thing by accident.
  //
  // A sub-option heading is "<Name>. ", with the period. Stopping at a bare
  // mention instead was too eager: Stunning Strike's own text says "when you
  // hit with a Monk weapon or Unarmed Strike, you can expend 1 Focus Point",
  // and cutting at "Unarmed Strike" put the cost outside the window.
  const names = acts.map(a => a.name.split(': ').pop());
  // The slice of prose that belongs to one option, used for both its resource
  // cost and its description. Same window for both, because they are the same
  // question: which sentences are about this feature and not the next one.
  const windowAt = (from, stopAt) => {
    if (from < 0) return null;
    let end = text.length;
    const nb = text.indexOf('\n*', from);
    if (nb > from) end = nb;
    stopAt.forEach(other => {
      if (!other) return;
      const x = text.indexOf(other + '. ', from + 1);
      if (x > from && x < end) end = x;
    });
    return text.slice(from, end);
  };
  const costOf = slice => {
    const m = /expend(?:ing)?\s+(\d+)\s+([A-Z][A-Za-z'’]*(?:\s+[A-Z][A-Za-z'’]*)*)/.exec(slice || '');
    if (!m) return null;
    // "expend 1 Focus Point" — the pool is tracked in the plural, and this is
    // the same alias table the party tracker uses, so a 2014 sheet's Ki Points
    // and a 2024 sheet's Focus Points land on one pool.
    return { amount: parseInt(m[1], 10) || 1,
             resource: sktCanonResource(/s$/i.test(m[2]) ? m[2] : m[2] + 's') };
  };
  // Readable prose out of a raw slice: drop the pipe lines (they are the
  // activation data, already parsed and shown as the chip's own label), drop
  // the "• PHB-2024 101" source reference, and drop the option's own name
  // where it opens the sentence — the panel puts it in the heading.
  const proseOf = (slice, key) => {
    let t = String(slice || '')
      .split('\n')
      .filter(l => !/^\s*\|/.test(l))
      .join(' ')
      .replace(/^\s*\*\s*/, '')
      // Source references only — "• PHB-2024 101", "• WGtE 52" — which is
      // why the page number is required. Without it this also matched the
      // bullets D&D Beyond uses inside prose and ate the word after them,
      // turning "• You can make an Unarmed Strike" into "can make an
      // Unarmed Strike".
      .replace(/•\s*[A-Z][A-Za-z]*(?:-\d{4})?\s+\d{1,4}\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (key && t.toLowerCase().indexOf(key.toLowerCase()) === 0){
      t = t.slice(key.length).replace(/^[\s.:—-]+/, '');
    }
    return t;
  };
  // Where the sheet DECLARES an option, as opposed to merely mentioning it.
  // Two forms, and nothing else counts:
  //
  //    * Hand of Harm • PHB-2024 104      a feature bullet
  //    Flurry of Blows. You can expend…   a sub-option heading
  //
  // Taking the first mention anywhere instead started Unarmed Strike's
  // description halfway through Martial Arts' sentence ("as a Bonus Action.
  // can roll 1d8…"), and gave Redirect Attack a description of "1 Reaction"
  // because the only place that string appears is its own pipe line.
  const declPos = n => {
    if (!n) return -1;
    const esc = String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let m = new RegExp('^[^\\S\\n]*\\*[^\\S\\n]*' + esc + '\\b', 'm').exec(text);
    if (m) return m.index;
    m = new RegExp('(^|[.\\n])[^\\S\\n]*' + esc + '\\.\\s', 'm').exec(text);
    return m ? m.index + m[1].length : -1;
  };
  acts.forEach((a, i) => {
    const key = names[i];
    const others = names.filter((o, j) => j !== i && o && o !== key);
    // An option with no declaration of its own belongs to its bullet — that
    // is where both its cost and its description live.
    let from = declPos(key), label = key;
    if (from < 0){ from = declPos(a.feature); label = a.feature; }
    const slice = windowAt(from, others);
    const hit = costOf(slice);
    if (hit){ a.amount = hit.amount; a.resource = hit.resource; }
    a.desc = proseOf(slice, label);
  });

  _sktActCache.set(text, acts);
  return acts;
}

// How a creature rolls initiative: its own advantage or disadvantage ('adv',
// 'dis' or ''), and in the 2024 rules advantage while Invisible and
// disadvantage while Incapacitated (or a condition that includes it).
// Both cancel to a straight roll.
function sktInitCondMode(own, conditions, edition){
  let up = own === 'adv', down = own === 'dis';
  if (edition !== '2014'){
    const cs = (conditions || []).map(x => String(x).toLowerCase());
    if (cs.some(x => /^invisible\b/.test(x))) up = true;
    if (cs.some(x => /^(incapacitated|paralyzed|petrified|stunned|unconscious)\b/.test(x))) down = true;
  }
  return up && !down ? 'adv' : down && !up ? 'dis' : '';
}

// A concentration save's DC after damage: 10 or half the damage, whichever
// is higher — and in the 2024 rules no more than 30. `who` is the party
// member (its rules), or nothing for a monster (the campaign's rules).
function sktConcDc(dmg, who){
  const dc = Math.max(10, Math.floor((+dmg || 0) / 2));
  const ed = (who && (who.rules || (who.build && who.build.edition))) || (typeof state !== 'undefined' && state.settings && state.settings.builderEdition) || '2024';
  return ed === '2024' ? Math.min(30, dc) : dc;
}

function sktNormName(s){
  return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
}

// Find the token for a combatant: the explicit link first, then exact label,
// then case/space-insensitive, then via the group base name a numbered
// duplicate carries on either side.
//
// `cid` is the strong match and only auto-placed tokens carry it. Without it,
// renaming a combatant orphaned its token: the reconciler culled the old one
// and placed a new one at the view centre, so a rename mid-fight silently
// teleported the creature across the map.
function sktTokenForCombatant(tokens, c){
  if (!c || !Array.isArray(tokens)) return null;
  if (c.id != null){
    const linked = tokens.find(t => t.cid != null && t.cid === c.id);
    if (linked) return linked;
  }
  const exact = tokens.find(t => t.label === c.name);
  if (exact) return exact;
  const n = sktNormName(c.name);
  return tokens.find(t => sktNormName(t.label) === n)
      || (c.baseName ? tokens.find(t => sktNormName(t.label) === sktNormName(c.baseName)) : null)
      || tokens.find(t => t.baseName && sktNormName(t.baseName) === n)
      || null;
}

// ─── Dice ────────────────────────────────────────────────────────────────────
// One home for rolling. There were two byte-identical copies of the
// expression parser (turnview._roll and attacks._roll) and thirty hand-written
// `1 + Math.floor(Math.random() * n)` across nine files. Duplicated RULES code
// is the class that has already produced real bugs here twice — the token name
// matcher existed in three copies and one matched two of eight creatures, and
// the damage-type list existed in four.
//
// sktRandom is a seam, not a feature: it defaults to Math.random and exists so
// a test can make a run deterministic. Nothing in the app sets it.
let sktRandom = Math.random;
function sktSetRandom(fn){ sktRandom = (typeof fn === 'function') ? fn : Math.random; }

// One die. 1..sides, or 0 for a nonsense number of sides rather than NaN.
function sktD(sides){
  const s = Math.floor(+sides);
  if (!(s > 0)) return 0;
  return 1 + Math.floor(sktRandom() * s);
}

// "2d6+3" → {total, detail:"4+5+3"}. Unparseable input gives {total:0,
// detail:'—'} rather than throwing, because callers render the detail straight
// into the log. Total is floored at 0: a modifier must not heal the target.
function sktRollDice(expr){
  const m = String(expr || '').replace(/\s+/g, '').match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) return { total: 0, detail: '—' };
  const n = parseInt(m[1] || '1'), sides = parseInt(m[2]), mod = parseInt(m[3] || '0');
  const rolls = [];
  for (let i = 0; i < n; i++) rolls.push(sktD(sides));
  const sum = rolls.reduce((a, b) => a + b, 0);
  return {
    total: Math.max(0, sum + mod),
    detail: rolls.join('+') + (mod ? (mod > 0 ? '+' + mod : String(mod)) : ''),
  };
}

// ─── Reduced maximum HP ──────────────────────────────────────────────────────
// Some effects lower a creature's hit point MAXIMUM until it finishes a long
// rest — a wraith's Life Drain, Harm, a mummy's rot. `hpMax` holds the
// maximum IN FORCE, so every existing heal cap, HP bar, mirror and sync merge
// already respects it without being touched. `hpMaxNormal` remembers the
// real one while it is lowered (absent = not reduced), and `hpMaxNote` the
// cause, if the DM gave one. A long rest puts it back.
function sktMaxHpLoss(r){
  return (r && typeof r.hpMaxNormal === 'number') ? Math.max(0, r.hpMaxNormal - (r.hpMax || 0)) : 0;
}
// Returns a NEW record (the panels replace records rather than mutate them).
function sktReduceMaxHp(r, n, note){
  n = Math.max(0, Math.floor(+n || 0));
  if (!r || !n) return r;
  const normal = typeof r.hpMaxNormal === 'number' ? r.hpMaxNormal : (r.hpMax || 0);
  const max = Math.max(0, (r.hpMax || 0) - n);
  // Current HP only comes down if it is above the new maximum: the drain's
  // damage is its own thing, applied separately.
  const out = { ...r, hpMax: max, hpMaxNormal: normal, hp: Math.min(r.hp || 0, max) };
  if (note) out.hpMaxNote = String(note).slice(0, 60);
  return out;
}
function sktRestoreMaxHp(r){
  if (!r || typeof r.hpMaxNormal !== 'number') return r;
  const out = { ...r, hpMax: r.hpMaxNormal };
  delete out.hpMaxNormal; delete out.hpMaxNote;
  return out;
}
// Bars are measured against the NORMAL maximum while it is lowered, so the
// part the reduction took away shows as its own striped segment at the end.
function sktHpBarParts(r){
  const loss = sktMaxHpLoss(r);
  const full = ((r && r.hpMax) || 0) + loss || 1;
  return { pct: Math.max(0, Math.min(100, ((r && r.hp) || 0) / full * 100)),
           lostPct: loss ? Math.min(100, loss / full * 100) : 0, loss };
}
function sktMaxHpTitle(r){
  const loss = sktMaxHpLoss(r);
  if (!loss) return '';
  return 'Max HP reduced by ' + loss + ' (normally ' + r.hpMaxNormal + ')'
    + (r.hpMaxNote ? ' — ' + r.hpMaxNote : '') + '. Restored on a long rest.';
}
