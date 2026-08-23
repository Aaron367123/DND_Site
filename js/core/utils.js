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
// <strong> and the like.
function emptyState(opts){
  const o = opts || {};
  return '<div class="empty-state">'
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

// Render an "icon" value (used by party / combatant portraits). Accepts:
//   - data:image/...      → <img>
//   - paths starting with img/ or http(s)/ → <img>
//   - raw <svg…           → inlined SVG
//   - everything else     → plain text (emoji, single char)
function renderIcon(icon, alt) {
  if (!icon) return '⚔';
  const s = String(icon);
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
// Stacking toast system — up to 3 simultaneous toasts so fast repeat calls
// don't overwrite each other (the previous single-element implementation
// would clobber an "X saved" notification when the next one fired 100ms
// later, leaving users uncertain what actually happened).
//
// `opts.action` is { label, run } — when set, the toast gains a clickable
// action chip (e.g. an Undo button) and stays open longer so the user has
// time to react.
function showToast(msg, opts){
  let host = document.getElementById('toast-host');
  if (!host){
    host = document.createElement('div');
    host.id = 'toast-host';
    document.body.appendChild(host);
  }
  // Cap to 3 — pop the oldest if needed before adding the new one.
  while (host.children.length >= 3) host.firstElementChild.remove();
  const t = document.createElement('div');
  t.className = 'toast-item';
  const safeMsg = typeof msg === 'string' ? msg : String(msg ?? '');
  let timeoutMs = 1800;
  if (opts && opts.action && typeof opts.action.run === 'function'){
    timeoutMs = 5000;
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
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 200);
  }, timeoutMs);
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
      ['/',                'Open / focus search'],
      ['↑ ↓',              'Browse results'],
      ['Enter',            'Open selected result'],
      ['Escape',           'Close detail / search'],
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
    var close = function(result){ document.removeEventListener('keydown', onKey); backdrop.remove(); resolve(result); };
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
  items.forEach(function(it) {
    var btn = document.createElement('button');
    btn.className = 'ctx-menu-item' + (it.checked ? ' checked' : '');
    btn.textContent = (it.checked ? '✓ ' : '   ') + it.label;
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
    out.push({
      avg: parseInt(m[1]),
      dice: String(m[2]).replace(/\s+/g, ''),   // "2d10 + 8" → "2d10+8"
      type: m[3].toLowerCase(),
      at: m.index,
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
  const rechM = rawName.match(/\(Recharge\s*([^)]+)\)/i) || rawName.match(/\{@recharge\s*([^}]*)\}/i);
  let recharge = null;
  if (rechM){
    const v = (rechM[1] || '').trim();
    recharge = v ? (/–|-/.test(v) ? v : v + '–6') : '6';
  }
  const name = rawName
    .replace(/\s*\(Recharge[^)]*\)/gi, '')
    .replace(/\s*\{@recharge[^}]*\}/gi, '')
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
  if (saveDc != null){
    const seg = _sktFirstDamageSentence(desc, saveAt);
    const parts = _sktDamageClauses(seg);
    if (parts.length){
      return {
        name, recharge, toHit: null,
        save: { dc: saveDc, ability: saveAbility,
                // "half as much damage" (2014), "Half damage." (2024), and
        // "takes only half the damage" (the Bulette, among others). Missing a
        // phrasing here silently drops the Saved ½ button, so the DM applies
        // the full amount to a creature that made its save.
        half: /half as much|half damage|half the damage/i.test(desc) },
        parts: parts.map(p => ({avg:p.avg, dice:p.dice, type:p.type})),
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
  if (areaM){
    const parts = _sktDamageClauses(_sktDamageSegment(desc, areaM.index));
    if (parts.length){
      return {
        name, recharge, toHit: null, save: null,
        parts: parts.map(p => ({avg:p.avg, dice:p.dice, type:p.type})),
        alt: null, altLabel: '',
      };
    }
  }

  // Attack: "…: +14 to hit, … Hit: 19 (2d10 + 8) piercing damage plus 7 (2d6)
  // fire damage."
  const hitIdx = desc.search(/\bHit:/i);
  if (hitIdx === -1) return null;
  const seg = _sktDamageSegment(desc, hitIdx);
  const clauses = _sktDamageClauses(seg);
  if (!clauses.length) return null;

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
              || desc.match(/Attack Roll:\s*([+-]\s*\d+)/i);
  return {
    name, recharge,
    toHit: toHitM ? toHitM[1].replace(/\s+/g, '') : null,
    save: null,
    parts: parts.map(p => ({avg:p.avg, dice:p.dice, type:p.type})),
    alt: alt.length ? alt.map(p => ({avg:p.avg, dice:p.dice, type:p.type})) : null,
    altLabel: altLabel || (alt.length ? 'alternate' : ''),
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
  const counts = {};
  // "makes two Slam attacks", "makes up to three Bite attacks"
  const reNamed = /makes\s+(?:up\s+to\s+)?(\w+)\s+([A-Za-z][\w'’\- ]*?)\s+attacks?\b/gi;
  // "three attacks: one with its mandibles and two with its claws"
  const reWith  = /(\w+)\s+with\s+(?:its|his|her|their|the)?\s*([A-Za-z][\w'’\- ]*?)(?=\s*(?:,|\.|and\b|or\b|$))/gi;
  let m;
  while ((m = reNamed.exec(text))){ const n = _sktCount(m[1]); if (n) counts[m[2].trim().toLowerCase()] = n; }
  while ((m = reWith.exec(text))){  const n = _sktCount(m[1]); if (n) counts[m[2].trim().toLowerCase()] = n; }
  return { text, counts };
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
  const n = String(name).trim().toLowerCase();
  if (counts[n]) return counts[n];
  if (counts[n + 's']) return counts[n + 's'];
  const dep = n.replace(/s$/, '');
  if (dep !== n && counts[dep]) return counts[dep];
  return 0;
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
