// ============================================================
// UTILITIES
// ============================================================
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function uid(){return Math.random().toString(36).slice(2,9)}

// Local-only per-browser identity used by the Notes panel for per-line author
// coloring. Stored under skt-me-v1, intentionally NOT in SKT_SYNC_KEYS — same
// pattern as skt-layout-v1 (each browser stays its own user).
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
// Render an "icon" value (used by party / combatant portraits). Accepts:
//   - data:image/...      → <img>
//   - paths starting with img/ or http(s)/ → <img>
//   - raw <svg…           → inlined SVG
//   - everything else     → plain text (emoji, single char)
function renderIcon(icon, alt) {
  if (!icon) return '⚔';
  const s = String(icon);
  if (s.startsWith('data:image/') || s.startsWith('img/') || /^https?:\/\//.test(s)) {
    return `<img class="icon-img" src="${esc(s)}" alt="${esc(alt||'')}" onerror="this.style.display='none'">`;
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

  function cleanup() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    overlay.remove();
  }

  overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => { cleanup(); resolve(null); });
  overlay.addEventListener('click', e => { if (e.target === overlay) { cleanup(); resolve(null); } });
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') { document.removeEventListener('keydown', escHandler); cleanup(); resolve(null); }
  });

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

function d20(){return Math.floor(Math.random()*20)+1}
function mod(s){return Math.floor((s-10)/2)}
function showToast(msg){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),1800)}

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
      : '<p style="color:var(--text-muted);font-size:12px;margin:0 0 20px;line-height:1.5">'
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

    var close = function(result) { backdrop.remove(); resolve(result); };

    backdrop.querySelector('#modal-cancel').addEventListener('click', function(){ close(null); });
    backdrop.querySelector('#modal-confirm').addEventListener('click', function() {
      var result = {};
      fields.forEach(function(f) {
        var el = backdrop.querySelector('#mf-' + f.id);
        if(!el) return;
        result[f.id] = (f.type === 'number') ? (parseInt(el.value) || f.value || 0) : el.value.trim();
      });
      close(result);
    });
    backdrop.addEventListener('keydown', function(e) {
      if(e.key === 'Enter')  { e.preventDefault(); backdrop.querySelector('#modal-confirm').click(); }
      if(e.key === 'Escape') { close(null); }
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
      + '<p style="color:var(--text-muted);font-size:13px;margin:0 0 20px;line-height:1.5">' + esc(message) + '</p>'
      + '<div class="modal-actions">'
      + '<button class="btn" id="conf-cancel">Cancel</button>'
      + '<button class="btn ' + (danger ? 'danger' : 'primary') + '" id="conf-ok">' + esc(confirmLabel) + '</button>'
      + '</div>'
      + '</div>';
    document.body.appendChild(backdrop);
    var ok = backdrop.querySelector('#conf-ok');
    setTimeout(function(){ if(ok) ok.focus(); }, 30);
    var close = function(result){ backdrop.remove(); resolve(result); };
    backdrop.querySelector('#conf-cancel').addEventListener('click', function(){ close(false); });
    ok.addEventListener('click', function(){ close(true); });
    backdrop.addEventListener('keydown', function(e){
      if (e.key === 'Enter')  { e.preventDefault(); close(true); }
      if (e.key === 'Escape') { close(false); }
    });
    backdrop.addEventListener('mousedown', function(e){ if (e.target === backdrop) close(false); });
  });
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
  var w = opts.w || 360, h = opts.h || 460;
  // Cascade successive popouts a bit so they don't perfectly stack
  createFloatingWindow._n = (createFloatingWindow._n || 0) + 1;
  var off = (createFloatingWindow._n - 1) * 24;
  // Default position: viewport center, but converted into canvas-space so it
  // lands where the user is currently looking even if they've zoomed/scrolled.
  var defaultX, defaultY;
  if (typeof clientToCanvas === 'function') {
    var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    var p = clientToCanvas(cx, cy);
    var z = (typeof getZoom === 'function') ? getZoom() : 1;
    defaultX = Math.max(20, Math.round(p.x - (w/2)/z)) + (off % 200);
    defaultY = Math.max(20, Math.round(p.y - (h/2)/z)) + ((off/2) % 120);
  } else {
    defaultX = Math.max(20, Math.round(window.innerWidth/2  - w/2)) + (off % 200);
    defaultY = Math.max(20, Math.round(window.innerHeight/2 - h/2)) + ((off/2) % 120);
  }
  var x = opts.x != null ? opts.x : defaultX;
  var y = opts.y != null ? opts.y : defaultY;

  var z = _nextZ();
  var el = document.createElement('div');
  el.className = 'window focused';
  el.dataset.ephemeral = '1';
  Object.assign(el.style, {position:'absolute', left:x+'px', top:y+'px', width:w+'px', height:h+'px', zIndex:z});
  el.innerHTML =
    '<div class="window-head">'
      +'<div class="window-title">'
        +'<span class="window-title-icon">'+(opts.icon||'◇')+'</span>'
        +'<span>'+esc(opts.title||'')+'</span>'
      +'</div>'
      +'<div class="window-actions"><button class="btn" data-wact="close">✕</button></div>'
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
