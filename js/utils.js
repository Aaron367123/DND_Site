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
      var minAttr = f.min !== undefined ? ' min="' + f.min + '"' : '';
      var maxAttr = f.max !== undefined ? ' max="' + f.max + '"' : '';
      fieldHtml += '<div class="modal-field">'
        + '<label>' + (f.label||'') + '</label>'
        + '<input id="mf-' + f.id + '" type="' + (f.type||'text') + '"'
        + ' value="' + (f.value !== undefined ? f.value : '') + '"'
        + ' placeholder="' + (f.placeholder||'') + '"'
        + minAttr + maxAttr + ' autocomplete="off">'
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
    setTimeout(function(){ var inp = backdrop.querySelector('input'); if(inp) inp.focus(); }, 30);

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
  var ws = document.getElementById('workspace');
  var w = opts.w || 360, h = opts.h || 460;
  // Cascade successive popouts a bit so they don't perfectly stack
  createFloatingWindow._n = (createFloatingWindow._n || 0) + 1;
  var off = (createFloatingWindow._n - 1) * 24;
  var defaultX = Math.max(20, Math.round(window.innerWidth/2  - w/2)) + (off % 200);
  var defaultY = Math.max(20, Math.round(window.innerHeight/2 - h/2)) + ((off/2) % 120);
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
    +'<div class="window-resize"></div>';

  var body = el.querySelector('.window-body');
  if (typeof opts.html === 'string') body.innerHTML = opts.html;

  ws.appendChild(el);

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
      el.style.left = Math.max(0, ox + ev.clientX - sx) + 'px';
      el.style.top  = Math.max(0, oy + ev.clientY - sy) + 'px';
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    e.preventDefault();
  });

  // Resize (bottom-right corner)
  var resizer = el.querySelector('.window-resize');
  resizer.addEventListener('mousedown', function(e) {
    e.stopPropagation();
    var ow = parseInt(el.style.width), oh = parseInt(el.style.height);
    var sx = e.clientX, sy = e.clientY;
    function move(ev) {
      el.style.width  = Math.max(240, ow + ev.clientX - sx) + 'px';
      el.style.height = Math.max(120, oh + ev.clientY - sy) + 'px';
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    e.preventDefault();
  });

  function close() { el.remove(); }
  el.querySelector('[data-wact="close"]').addEventListener('click', function(e) {
    e.stopPropagation();
    close();
  });

  return { el: el, body: body, close: close };
}
