// ============================================================
// NPC LIBRARY PANEL
// ============================================================
// Two-column layout: searchable group list on the left, full-detail
// editor on the right with header, stats, tags, description, notes,
// and image gallery.

const NPC_DEFAULT_GROUP = 'Unfiled';
const NPC_ATTITUDES = ['Ally','Friendly','Neutral','Hostile','Imprisoned','Unknown'];

const DEFAULT_NPCS_V2 = [
  {id:'n1', name:'Skarn',   role:'Cook',         group:'Rhea',     attitude:'Ally',    hp:13, ac:3, init:6, tags:['Old'],            description:'Age 67\nHums funeral dirges when it rains.', notes:''},
  {id:'n2', name:'Xaerion', role:'Glacier',      group:'Rhea',     attitude:'Ally',    hp:42, ac:14,init:2, tags:['Frost'],          description:'', notes:''},
  {id:'n3', name:'Aravia',  role:'Stoneherd',    group:'Rhea',     attitude:'Ally',    hp:31, ac:13,init:1, tags:[],                 description:'', notes:''},
  {id:'n4', name:'Aerja',   role:'Tutor',        group:'Rhea',     attitude:'Friendly',hp:18, ac:11,init:0, tags:['Scholar'],        description:'', notes:''},
  {id:'n5', name:'Brakka',  role:'Watchman',     group:'Petra',    attitude:'Neutral', hp:24, ac:14,init:1, tags:[],                 description:'', notes:''},
  {id:'n6', name:'Dricen',  role:'Chancellor',   group:'Petra',    attitude:'Neutral', hp:22, ac:12,init:0, tags:['Politician'],     description:'', notes:''},
  {id:'n7', name:'Margrim', role:'Scribe',       group:'Flahgfall',attitude:'Friendly',hp:16, ac:11,init:0, tags:[],                 description:'', notes:''},
];

function _npcInitials(name) {
  // First alphanumeric char of each of the first two words. Skipping leading
  // punctuation keeps initials letter-only — which, besides looking better,
  // makes them safe to drop into the avatar's inline onerror="...'X'..."
  // handler (an apostrophe initial like O'Brien → "'" would break that string).
  return (name||'?').split(/\s+/).slice(0,2)
    .map(w => (w.match(/[\p{L}\p{N}]/u) || [''])[0])
    .join('').toUpperCase().slice(0,2) || '?';
}

function _npcGroups(npcs) {
  const groups = {};
  npcs.forEach(n => {
    const g = n.group || NPC_DEFAULT_GROUP;
    if (!groups[g]) groups[g] = [];
    groups[g].push(n);
  });
  // Stable order: known groups first by insertion, Unfiled last
  const order = [];
  npcs.forEach(n => {
    const g = n.group || NPC_DEFAULT_GROUP;
    if (g !== NPC_DEFAULT_GROUP && !order.includes(g)) order.push(g);
  });
  if (groups[NPC_DEFAULT_GROUP]) order.push(NPC_DEFAULT_GROUP);
  return order.map(name => ({ name, npcs: groups[name] }));
}

registerPanel('npclib', {
  title:'NPC Library', icon:'👤',
  _npcs:null, _selectedId:null, _searchQ:'', _collapsed:null,
  // Whether the SECRET field is revealed. Defaults to hidden; user must
  // click 👁 Reveal to see it. Reset to hidden whenever a different NPC
  // is selected so a fresh click doesn't expose the previous reveal.
  _secretRevealed:false,

  mount(body){
    this._body = body;
    if (!this._npcs) {
      try {
        const r = localStorage.getItem('skt-npcs-v2');
        if (r) this._npcs = JSON.parse(r);
        else {
          // Migrate from v1 if present
          const v1 = localStorage.getItem('skt-npcs-v1');
          if (v1) {
            this._npcs = JSON.parse(v1).map(n => ({
              id: n.id||uid(), name: n.name||'New NPC', role: n.role||'',
              group: n.group || NPC_DEFAULT_GROUP,
              attitude: n.attitude || 'Neutral',
              hp: n.hp||0, ac: n.ac||10, init: n.init||0,
              tags: n.tags||[], description: n.description||n.quirks||'',
              notes: n.notes||'',
            }));
          } else {
            this._npcs = JSON.parse(JSON.stringify(DEFAULT_NPCS_V2));
          }
        }
      } catch(e) { this._npcs = JSON.parse(JSON.stringify(DEFAULT_NPCS_V2)); }
    }
    if (!this._collapsed){
      // Persist collapse state per-browser. Group-name keys aren't synced;
      // the user's preference for which sections are folded is purely UI.
      try { this._collapsed = JSON.parse(localStorage.getItem('skt-npcs-collapsed') || '{}') || {}; }
      catch(e){ this._collapsed = {}; }
    }
    if (!this._selectedId && this._npcs.length) this._selectedId = this._npcs[0].id;
    // One-time cleanup: gallery feature was removed; drop the field so it
    // stops round-tripping through Firebase on every save.
    let cleaned = false;
    this._npcs.forEach(n => { if (n.images){ delete n.images; cleaned = true; } });
    if (cleaned) this._save();
    // Divider drag listeners live on `document` and are attached ONCE here,
    // not inside _wireDivider() — that runs from _render(), so every re-render
    // (which a sync pull can trigger repeatedly) used to add another
    // closure-retaining pair that was never removed. Same bug, same fix as
    // notes._wireDivider. Handlers are built once and reused so the
    // add/remove pair below always references the same function.
    if (!this._onDividerMove){
      this._onDividerMove = (e) => {
        const drag = this._dividerDrag; if (!drag) return;
        const b = this._body; if (!b) return;
        const left = b.querySelector('.npclib-left');
        const root = b.querySelector('.npclib-root');
        if (!left || !root) return;
        const z = (typeof getZoom==='function') ? getZoom() : 1;
        const rootW = root.getBoundingClientRect().width / z;
        const min = 200, max = Math.max(min + 100, rootW - 280);
        let w = drag.ow + (e.clientX - drag.sx) / z;
        w = Math.max(min, Math.min(max, w));
        left.style.flex = `0 0 ${w}px`;
        left.style.width = w + 'px';
        this._leftWidth = w;
      };
      this._onDividerUp = () => {
        if (!this._dividerDrag) return;
        this._dividerDrag = null;
        document.body.style.cursor = '';
        try { localStorage.setItem('skt-npclib-leftw', String(this._leftWidth)); } catch(e){}
      };
    }
    document.addEventListener('mousemove', this._onDividerMove);
    document.addEventListener('mouseup', this._onDividerUp);
    this._render();
  },
  unmount(){
    // Symmetric with mount(). Re-adding the same function reference on a
    // later mount is a no-op if it's somehow still attached, so this stays
    // correct across any mount/unmount ordering.
    document.removeEventListener('mousemove', this._onDividerMove);
    document.removeEventListener('mouseup', this._onDividerUp);
    this._dividerDrag = null;
    this._body = null;
  },

  _save(){ saveJson('skt-npcs-v2', this._npcs, 'NPC library'); },

  // Longest edge for an image stored inside an NPC note. ~1000px keeps a
  // pasted screenshot readable while landing around 100–200 KB of base64
  // instead of multiple megabytes.
  _NOTE_IMG_MAX_SIDE: 1000,
  // Anything whose data: URI is longer than this gets re-encoded on paste.
  _NOTE_IMG_MAX_CHARS: 300000,   // ~300 KB of base64

  // Re-encode oversized inline images in a notes field. Used after a rich-text
  // paste, which can carry data: URIs the image-file branch never sees.
  // Async and best-effort: an image that won't decode is left alone rather
  // than destroyed.
  _shrinkNoteImages(notesEl, n){
    if (!notesEl) return;
    const big = Array.prototype.filter.call(
      notesEl.querySelectorAll('img'),
      im => (im.getAttribute('src') || '').startsWith('data:image/')
            && im.getAttribute('src').length > this._NOTE_IMG_MAX_CHARS);
    if (!big.length) return;
    let done = 0;
    big.forEach(im => {
      fetch(im.getAttribute('src'))
        .then(r => r.blob())
        .then(blob => imageToBoundedDataUrl(blob, this._NOTE_IMG_MAX_SIDE, 0.8))
        .then(url => { im.setAttribute('src', url); im.style.maxWidth = '100%'; })
        .catch(err => console.warn('[npclib] could not shrink pasted image', err))
        .then(() => {
          if (++done !== big.length) return;
          n.notes = notesEl.innerHTML;
          this._save();
          if (typeof showToast === 'function'){
            showToast('Resized ' + big.length + ' pasted image' + (big.length===1?'':'s') + ' to keep storage in check');
          }
        });
    });
  },

  _selected(){ return this._npcs.find(n => n.id === this._selectedId); },

  // Bulk-select state. _bulkMode flips per-card checkboxes on and shows the
  // bulk action bar; _bulkSelected is the Set of ids currently checked.
  // Kept in memory (not persisted) — a fresh session starts clean.
  _bulkMode: false,
  _bulkSelected: null,
  _bulkSet(){ if (!this._bulkSelected) this._bulkSelected = new Set(); return this._bulkSelected; },

  // Render the bulk action bar pinned to the bottom of the left column.
  // Shows nothing when bulk mode is off OR when nothing is checked yet.
  _renderBulkBar(){
    if (!this._bulkMode) return '';
    const set = this._bulkSet();
    const n = set.size;
    // Collect known groups + tags from the library so the user can pick
    // existing ones instead of typing.
    const groups = [...new Set((this._npcs || []).map(x => x.group || NPC_DEFAULT_GROUP))].sort();
    const allTags = [...new Set((this._npcs || []).flatMap(x => x.tags || []))].sort();
    const groupOpts = groups.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
    const tagOpts = allTags.length
      ? '<datalist id="npclib-bulk-taglist">' + allTags.map(t => `<option value="${esc(t)}"></option>`).join('') + '</datalist>'
      : '';
    if (!n){
      return `<div class="npclib-bulk-bar">
        <span class="npclib-bulk-count">0 selected</span>
        <button class="btn small" id="npclib-bulk-all" title="Select every NPC currently visible">Select all visible</button>
        <span style="flex:1"></span>
        <button class="btn small" id="npclib-bulk-exit" title="Exit bulk-select mode">Done</button>
      </div>`;
    }
    return `<div class="npclib-bulk-bar active">
      <span class="npclib-bulk-count"><strong>${n}</strong> selected</span>
      <select id="npclib-bulk-move" title="Move every selected NPC to this group">
        <option value="">Move to group…</option>
        ${groupOpts}
        <option value="__new__">+ New group…</option>
      </select>
      <input type="text" id="npclib-bulk-add-tag" list="npclib-bulk-taglist" placeholder="+ Add tag…" title="Add this tag to every selected NPC (Enter to apply)">
      ${tagOpts}
      <button class="btn small danger" id="npclib-bulk-delete" title="Delete every selected NPC">Delete ${n}</button>
      <span style="flex:1"></span>
      <button class="btn small" id="npclib-bulk-clear">Deselect</button>
      <button class="btn small" id="npclib-bulk-exit">Done</button>
    </div>`;
  },

  // Export the current NPC as a PNG card image suitable for Discord etc.
  // Hand-rolls a canvas draw rather than html-to-image so it has no extra
  // dependency. Layout: 480×620, themed dark bg, circular avatar at top,
  // name + role, stats row, tags, wrapped description. Avatar loads
  // asynchronously (data URL or http) before drawing.
  async _exportNpcImage(n){
    if (!n) return;
    const W = 480, H = 620, DPR = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    const ctx = canvas.getContext('2d');
    ctx.scale(DPR, DPR);

    // Read theme colors from the live CSS so the export matches whatever
    // palette the user is running. Falls back to hardcoded defaults.
    const css = getComputedStyle(document.documentElement);
    const v = (name, fallback) => (css.getPropertyValue(name).trim() || fallback);
    const bg     = v('--bg', '#1a1a1a');
    const panel  = v('--panel', '#232323');
    const panel2 = v('--panel-2', '#2a2a2a');
    const panel3 = v('--panel-3', '#333');
    const border = v('--border', '#3a3a3a');
    const text   = v('--text', '#e8e8e8');
    const muted  = v('--text-muted', '#999');
    const dim    = v('--text-dim', '#666');
    const accent = v('--accent', '#d4a574');

    // Background card
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = panel;
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    const card = { x: 14, y: 14, w: W - 28, h: H - 28, r: 10 };
    const rr = (x,y,w,h,r) => {
      ctx.beginPath();
      ctx.moveTo(x+r, y);
      ctx.arcTo(x+w, y, x+w, y+h, r);
      ctx.arcTo(x+w, y+h, x, y+h, r);
      ctx.arcTo(x, y+h, x, y, r);
      ctx.arcTo(x, y, x+w, y, r);
      ctx.closePath();
    };
    rr(card.x, card.y, card.w, card.h, card.r);
    ctx.fill(); ctx.stroke();

    // Accent stripe along the top of the card
    ctx.fillStyle = accent;
    rr(card.x, card.y, card.w, 6, card.r);
    ctx.fill();

    // Load avatar (returns null on failure — we'll fall back to initials)
    const loadImage = (src) => new Promise(resolve => {
      if (!src){ resolve(null); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    const avatarImg = await loadImage(n.avatar);

    // Avatar — circular, centered horizontally, 96px diameter
    const ax = W / 2, ay = card.y + 40 + 48;
    ctx.save();
    ctx.beginPath();
    ctx.arc(ax, ay, 50, 0, Math.PI * 2);
    ctx.fillStyle = panel3;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = accent;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ax, ay, 48, 0, Math.PI * 2);
    ctx.clip();
    if (avatarImg){
      ctx.drawImage(avatarImg, ax-48, ay-48, 96, 96);
    } else {
      ctx.fillStyle = text;
      ctx.font = 'bold 36px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(_npcInitials(n.name), ax, ay);
    }
    ctx.restore();

    // Name
    ctx.fillStyle = text;
    ctx.font = 'bold 22px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(n.name || 'Unnamed', ax, ay + 60);

    // Role
    if (n.role){
      ctx.fillStyle = muted;
      ctx.font = '13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
      ctx.fillText(n.role, ax, ay + 90);
    }

    // Group + attitude pills (centered row)
    const drawPill = (txt, x, y, fg, bgc, brd) => {
      ctx.font = 'bold 10px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
      const tw = ctx.measureText(txt).width;
      const padX = 8, padY = 4;
      const pw = tw + padX*2, ph = 18;
      ctx.fillStyle = bgc;
      ctx.strokeStyle = brd;
      rr(x - pw/2, y, pw, ph, 9);
      ctx.fill();
      if (brd) ctx.stroke();
      ctx.fillStyle = fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(txt, x, y + ph/2 + 1);
      return pw;
    };
    const grpTxt = (n.group || NPC_DEFAULT_GROUP).toUpperCase();
    const attTxt = (n.attitude || 'Neutral').toUpperCase();
    const pillY = ay + 115;
    ctx.font = 'bold 10px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
    const gw = ctx.measureText(grpTxt).width + 16;
    const aw = ctx.measureText(attTxt).width + 16;
    const gap = 8;
    const total = gw + aw + gap;
    drawPill(grpTxt, ax - total/2 + gw/2, pillY, accent, 'rgba(212,165,116,0.12)', accent);
    drawPill(attTxt, ax + total/2 - aw/2, pillY, text, panel3, border);

    // Stats row — HP / AC / Init
    const statY = pillY + 36;
    const statW = 110, statH = 50, statGap = 12;
    const totalStatW = statW * 3 + statGap * 2;
    const statStartX = (W - totalStatW) / 2;
    const stats = [
      { label: 'HP',  glyph: '♥', val: n.hp ?? 0 },
      { label: 'AC',  glyph: '⛨', val: n.ac ?? 0 },
      { label: 'INIT',glyph: '⚡', val: (n.init >= 0 ? '+' : '') + (n.init ?? 0) },
    ];
    stats.forEach((s, i) => {
      const sx = statStartX + i * (statW + statGap);
      ctx.fillStyle = panel2;
      ctx.strokeStyle = border;
      rr(sx, statY, statW, statH, 6);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = muted;
      ctx.font = 'bold 9px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(s.glyph + ' ' + s.label, sx + statW/2, statY + 6);
      ctx.fillStyle = text;
      ctx.font = 'bold 22px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(s.val), sx + statW/2, statY + statH/2 + 8);
    });

    // Tags row
    const tagY = statY + statH + 16;
    const tags = (n.tags || []).slice(0, 8); // cap so it doesn't overflow
    if (tags.length){
      ctx.font = 'bold 9px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
      ctx.fillStyle = dim;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('TAGS', card.x + 16, tagY);
      let tx = card.x + 16, ty = tagY + 14;
      ctx.font = '11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
      tags.forEach(t => {
        const tw = ctx.measureText(t).width + 14;
        if (tx + tw > card.x + card.w - 16){ tx = card.x + 16; ty += 22; }
        ctx.fillStyle = panel3;
        ctx.strokeStyle = border;
        rr(tx, ty, tw, 18, 9);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = text;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t, tx + tw/2, ty + 10);
        tx += tw + 6;
      });
    }
    const afterTagsY = tags.length ? (tagY + 32) : tagY;

    // Description — wrapped paragraph
    if (n.description){
      ctx.fillStyle = dim;
      ctx.font = 'bold 9px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('DESCRIPTION', card.x + 16, afterTagsY + 8);

      ctx.fillStyle = text;
      ctx.font = '13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
      const maxW = card.w - 32;
      const words = String(n.description).split(/\s+/);
      let line = '', y = afterTagsY + 26;
      const lineH = 18;
      const maxY = card.y + card.h - 16;
      for (const word of words){
        const trial = line ? line + ' ' + word : word;
        if (ctx.measureText(trial).width > maxW){
          if (y + lineH > maxY){ ctx.fillText(line + '…', card.x + 16, y); line = ''; break; }
          ctx.fillText(line, card.x + 16, y);
          y += lineH;
          line = word;
        } else {
          line = trial;
        }
      }
      if (line && y + lineH <= maxY) ctx.fillText(line, card.x + 16, y);
    }

    // Trigger download
    canvas.toBlob(blob => {
      if (!blob) { if (typeof showToast === 'function') showToast('Image export failed'); return; }
      const url = URL.createObjectURL(blob);
      const safe = (n.name || 'npc').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
      const a = Object.assign(document.createElement('a'), { href: url, download: 'npc-' + safe + '.png' });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 100);
      if (typeof showToast === 'function') showToast('Exported ' + (n.name || 'NPC') + ' as PNG');
    }, 'image/png');
  },

  _newNpc(){
    const n = {
      id: uid(), name:'New NPC', role:'', group: NPC_DEFAULT_GROUP,
      attitude:'Neutral', hp:10, ac:10, init:0, tags:[], description:'', notes:'',
    };
    this._npcs.unshift(n);
    this._selectedId = n.id;
    this._save();
    this._render();
  },

  _render(){
    const b = this._body; if (!b) return;
    const groups = _npcGroups(this._npcs);
    const sel = this._selected();
    const q = this._searchQ.toLowerCase();
    if (this._leftWidth == null) {
      try { const v = parseFloat(localStorage.getItem('skt-npclib-leftw')); if (!isNaN(v)) this._leftWidth = v; } catch(e){}
    }
    const leftStyle = this._leftWidth != null ? `style="width:${this._leftWidth}px;flex:0 0 ${this._leftWidth}px"` : '';
    // Capture any user-drag-resized desc/secret textarea heights BEFORE we blow
    // away the DOM. Keyed to the NPC currently in the DOM (_lastRenderedId), so
    // switching NPCs doesn't carry one NPC's height onto another's fields.
    {
      const da0 = b.querySelector('.npclib-desc'), sa0 = b.querySelector('.npclib-secret');
      if (da0 || sa0) this._fieldH = { id: this._lastRenderedId, desc: da0 && da0.style.height, secret: sa0 && sa0.style.height };
    }
    b.innerHTML = `<div class="npclib-root">
      <div class="npclib-left" ${leftStyle}>
        <div class="npclib-toolbar">
          <input type="search" id="npclib-search" placeholder="🔎 Search NPCs..." value="${esc(this._searchQ)}">
          <button class="icon-btn npclib-tool-btn ${this._bulkMode?'active':''}" id="npclib-bulk-toggle" title="${this._bulkMode?'Exit bulk-select mode':'Bulk-select mode (checkboxes + bulk actions)'}">${this._bulkMode?'✓':'☐'}</button>
          <button class="icon-btn npclib-tool-btn" id="npclib-add" title="New NPC">+</button>
        </div>
        <div class="npclib-groups" id="npclib-groups">
          ${groups.map(g => this._renderGroup(g, q)).join('')}
        </div>
        ${this._renderBulkBar()}
      </div>
      <div class="npclib-divider" id="npclib-divider" title="Drag to resize"></div>
      <div class="npclib-right">
        ${sel ? this._renderDetail(sel) : '<div class="empty-state" style="padding:30px">Select an NPC, or click + to add one.</div>'}
      </div>
    </div>`;
    this._wire();
    this._wireDivider();
    // Restore the resized heights only if the SAME NPC is still showing.
    if (this._fieldH && this._fieldH.id === this._selectedId){
      const da = b.querySelector('.npclib-desc'), sa = b.querySelector('.npclib-secret');
      if (da && this._fieldH.desc)   da.style.height = this._fieldH.desc;
      if (sa && this._fieldH.secret) sa.style.height = this._fieldH.secret;
    }
    this._lastRenderedId = this._selectedId;
  },

  // Drag the column divider. Width is stored in pixels and persisted to
  // localStorage so the user's preferred ratio survives reloads.
  _wireDivider(){
    const b = this._body; if (!b) return;
    const divider = b.querySelector('#npclib-divider');
    const left    = b.querySelector('.npclib-left');
    const root    = b.querySelector('.npclib-root');
    if (!divider || !left || !root) return;
    // Only the divider's OWN mousedown is wired here. It's element-scoped, so
    // it dies with the DOM node on the next _render() — no leak. The
    // document-level mousemove/mouseup pair lives in mount()/unmount();
    // drag state is shared through this._dividerDrag.
    divider.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      this._dividerDrag = { sx: e.clientX, ow: left.getBoundingClientRect().width };
      document.body.style.cursor = 'ew-resize';
    });
  },

  _renderGroup(g, q) {
    const collapsed = this._collapsed[g.name] === true;
    const filtered = g.npcs.filter(n =>
      !q || (n.name+' '+(n.role||'')+' '+(n.tags||[]).join(' ')).toLowerCase().includes(q)
    );
    if (q && !filtered.length) return ''; // hide empty groups during search
    return `<div class="npclib-group">
      <div class="npclib-group-head" data-group="${esc(g.name)}">
        <span class="caret">${collapsed?'▸':'▾'}</span>
        <span class="group-name">${esc(g.name)}</span>
        <span class="group-count">${filtered.length}</span>
      </div>
      ${collapsed ? '' : `<div class="npclib-group-body">${filtered.map(n => this._renderCard(n)).join('')}</div>`}
    </div>`;
  },

  _renderCard(n){
    const sel = n.id === this._selectedId;
    const inBulk = this._bulkMode;
    const checked = inBulk && this._bulkSet().has(n.id);
    return `<div class="npclib-card${sel?' selected':''}${checked?' bulk-checked':''}" data-id="${n.id}">
      ${inBulk ? `<input type="checkbox" class="npclib-bulk-check" data-bulk-id="${esc(n.id)}" ${checked?'checked':''} title="Select for bulk action">` : ''}
      <div class="npclib-avatar">${n.avatar
        ? `<img src="${esc(n.avatar)}" alt="" onerror="this.parentNode.textContent='${esc(_npcInitials(n.name))}'">`
        : esc(_npcInitials(n.name))}</div>
      <div class="npclib-card-meta">
        <div class="npclib-card-name">${esc(n.name)}</div>
        <div class="npclib-card-role">${esc(n.role||'')}</div>
      </div>
    </div>`;
  },

  _renderDetail(n){
    const tags = (n.tags||[]).map(t => `<span class="npc-tag-chip" data-tag="${esc(t)}">${esc(t)} <button class="tag-rm" data-rmtag="${esc(t)}">×</button></span>`).join('');
    return `<div class="npclib-detail">
      <div class="npclib-detail-head">
        <div class="npclib-detail-avatar" data-act="upload-avatar">${n.avatar
          ? `<img src="${esc(n.avatar)}" alt="">`
          : esc(_npcInitials(n.name))}</div>
        <div class="npclib-detail-id">
          <input class="npclib-name-input" type="text" value="${esc(n.name)}" data-field="name" placeholder="Name">
          <input class="npclib-role-input" type="text" value="${esc(n.role||'')}" data-field="role" placeholder="Role / subtitle">
        </div>
        <div class="npclib-detail-badges">
          <button class="npc-badge group-badge" data-act="edit-group" title="Change group">${esc((n.group||NPC_DEFAULT_GROUP).toUpperCase())}</button>
          <button class="npc-badge attitude-badge attitude-${esc((n.attitude||'Neutral').toLowerCase())}" data-act="edit-attitude" title="Change attitude">${esc((n.attitude||'NEUTRAL').toUpperCase())}</button>
          <button class="btn icon-btn" data-act="export-image" title="Export as PNG image (for Discord / share)">📷</button>
          <button class="btn icon-btn danger" data-act="delete" title="Delete NPC">×</button>
        </div>
      </div>

      <div class="npclib-stats">
        <div class="npclib-stat"><div class="lab">♥</div><input type="number" value="${n.hp||0}" data-field="hp"></div>
        <div class="npclib-stat"><div class="lab">⛨</div><input type="number" value="${n.ac||0}" data-field="ac"></div>
        <div class="npclib-stat"><div class="lab">⚡</div><input type="number" value="${n.init||0}" data-field="init"></div>
      </div>

      <div class="npclib-section-label">TAGS</div>
      <div class="npclib-tags">
        ${tags}
        <button class="npc-tag-chip new-tag" data-act="new-tag">+ New Tag</button>
      </div>

      <div class="npclib-section-label">DESCRIPTION</div>
      <textarea class="npclib-desc" data-field="description" placeholder="Quick description...">${esc(n.description||'')}</textarea>

      <div class="npclib-section-label">NOTES</div>
      <div class="npclib-notes-toolbar">
        <button data-fmt="bold" title="Bold (Ctrl+B)"><b>B</b></button>
        <button data-fmt="italic" title="Italic (Ctrl+I)"><i>I</i></button>
        <button data-fmt="strikeThrough" title="Strikethrough"><s>S</s></button>
        <button data-fmt="quote" title="Quote">&ldquo;</button>
        <button data-fmt="code" title="Inline code">&lt;/&gt;</button>
        <button data-fmt="insertUnorderedList" title="Bullet list">• List</button>
      </div>
      <div class="npclib-notes" contenteditable="true" data-field="notes" data-placeholder="Click here to start typing.">${sanitizeHtml(n.notes||'')}</div>

      <div class="npclib-section-label npclib-secret-label">🔒 SECRET
        <button class="btn small npclib-secret-toggle" data-act="toggle-secret" title="${this._secretRevealed?'Hide the secret again':'Reveal — keep your screen private!'}">${this._secretRevealed?'🙈 Hide':'👁 Reveal'}</button>
      </div>
      <textarea class="npclib-secret${this._secretRevealed?'':' redacted'}" data-field="secret" placeholder="DM-only — what this NPC is hiding.">${esc(n.secret||'')}</textarea>

      <div class="npclib-detail-actions">
        <button class="btn small primary" data-act="to-combat">+ Add to combat</button>
      </div>
    </div>`;
  },

  _wire(){
    const b = this._body; if (!b) return;

    // Search
    const search = b.querySelector('#npclib-search');
    search.addEventListener('input', e => {
      this._searchQ = e.target.value;
      // Only re-render the groups column to keep search-input focus
      const groupsHost = b.querySelector('#npclib-groups');
      const groups = _npcGroups(this._npcs);
      const q = this._searchQ.toLowerCase();
      groupsHost.innerHTML = groups.map(g => this._renderGroup(g, q)).join('');
      this._wireLeft();
    });

    // Add NPC
    b.querySelector('#npclib-add').addEventListener('click', () => this._newNpc());

    // Bulk-mode toggle — flips per-card checkboxes on/off and reveals the
    // bulk action bar. Exiting clears any current selection.
    b.querySelector('#npclib-bulk-toggle')?.addEventListener('click', () => {
      this._bulkMode = !this._bulkMode;
      if (!this._bulkMode) this._bulkSelected = new Set();
      this._render();
    });
    this._wireBulkBar();

    this._wireLeft();
    this._wireRight();
  },

  _wireBulkBar(){
    const b = this._body; if (!b) return;
    if (!this._bulkMode) return;
    b.querySelector('#npclib-bulk-exit')?.addEventListener('click', () => {
      this._bulkMode = false;
      this._bulkSelected = new Set();
      this._render();
    });
    b.querySelector('#npclib-bulk-clear')?.addEventListener('click', () => {
      this._bulkSelected = new Set();
      this._render();
    });
    b.querySelector('#npclib-bulk-all')?.addEventListener('click', () => {
      // Select every NPC matching the current search filter.
      const q = (this._searchQ || '').toLowerCase();
      const set = this._bulkSet();
      (this._npcs || []).forEach(n => {
        if (!q || (n.name + ' ' + (n.role||'') + ' ' + (n.tags||[]).join(' ')).toLowerCase().includes(q)){
          set.add(n.id);
        }
      });
      this._render();
    });
    b.querySelector('#npclib-bulk-move')?.addEventListener('change', e => {
      const val = e.target.value;
      if (!val) return;
      const apply = (groupName) => {
        const set = this._bulkSet();
        (this._npcs || []).forEach(n => { if (set.has(n.id)) n.group = groupName; });
        this._save();
        if (typeof showToast === 'function') showToast('Moved ' + set.size + ' NPC' + (set.size===1?'':'s') + ' → ' + groupName);
        this._bulkSelected = new Set();
        this._render();
      };
      if (val === '__new__'){
        if (typeof showModal === 'function'){
          showModal('Move to new group', [
            {id:'name', label:'New group name', type:'text', value:''}
          ], 'Move').then(r => {
            if (!r) { e.target.value = ''; return; }
            const name = (r.name || '').trim();
            if (!name){ e.target.value = ''; return; }
            apply(name);
          });
        } else {
          const name = window.prompt('New group name');
          if (name) apply(name.trim());
          else e.target.value = '';
        }
      } else {
        apply(val);
      }
    });
    const addTagInp = b.querySelector('#npclib-bulk-add-tag');
    addTagInp?.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const tag = (e.target.value || '').trim();
      if (!tag) return;
      const set = this._bulkSet();
      let added = 0;
      (this._npcs || []).forEach(n => {
        if (!set.has(n.id)) return;
        if (!Array.isArray(n.tags)) n.tags = [];
        if (!n.tags.includes(tag)){ n.tags.push(tag); added++; }
      });
      this._save();
      if (typeof showToast === 'function') showToast('Added "' + tag + '" to ' + added + ' NPC' + (added===1?'':'s'));
      e.target.value = '';
      this._render();
    });
    b.querySelector('#npclib-bulk-delete')?.addEventListener('click', () => {
      const set = this._bulkSet();
      if (!set.size) return;
      const proceed = (ok) => {
        if (!ok) return;
        const ids = new Set(set);
        this._npcs = (this._npcs || []).filter(n => !ids.has(n.id));
        if (this._selectedId && ids.has(this._selectedId)){
          this._selectedId = this._npcs[0]?.id || null;
        }
        this._save();
        if (typeof showToast === 'function') showToast('Deleted ' + ids.size + ' NPC' + (ids.size===1?'':'s'));
        this._bulkSelected = new Set();
        this._render();
      };
      const msg = 'Delete ' + set.size + ' selected NPC' + (set.size===1?'':'s') + '? This can\'t be undone.';
      if (typeof showConfirm === 'function'){
        showConfirm(msg, {title:'Delete NPCs', confirmLabel:'Delete', danger:true}).then(proceed);
      } else {
        proceed(window.confirm(msg));
      }
    });
  },

  _wireLeft(){
    const b = this._body;
    // Group collapse — persisted per-browser (key 'skt-npcs-collapsed').
    b.querySelectorAll('.npclib-group-head').forEach(h => h.addEventListener('click', () => {
      const g = h.dataset.group;
      this._collapsed[g] = !this._collapsed[g];
      try { localStorage.setItem('skt-npcs-collapsed', JSON.stringify(this._collapsed)); } catch(e){}
      this._render();
    }));
    // Bulk checkbox per card — independent of the card click handler so
    // toggling the checkbox doesn't also open the detail view.
    b.querySelectorAll('.npclib-bulk-check').forEach(cb => {
      cb.addEventListener('click', e => e.stopPropagation());
      cb.addEventListener('change', () => {
        const id = cb.dataset.bulkId;
        const set = this._bulkSet();
        if (cb.checked) set.add(id); else set.delete(id);
        // Just toggle the card-level class + bar count without a full
        // re-render — keeps scroll / focus / search input intact.
        const card = cb.closest('.npclib-card');
        if (card) card.classList.toggle('bulk-checked', cb.checked);
        // Bar count needs to refresh because 0→1 toggles which buttons are
        // shown. Cheaper than full _render(); just rebuild the bar.
        const bar = b.querySelector('.npclib-bulk-bar');
        if (bar){
          const wrap = document.createElement('div');
          wrap.innerHTML = this._renderBulkBar();
          bar.replaceWith(wrap.firstElementChild);
          this._wireBulkBar();
        }
      });
    });

    // Card select — opens detail UNLESS we're in bulk mode (then toggles
    // the checkbox instead so clicking the row body is symmetric with
    // clicking the checkbox).
    b.querySelectorAll('.npclib-card').forEach(c => c.addEventListener('click', e => {
      if (this._bulkMode){
        if (e.target.closest('.npclib-bulk-check')) return; // checkbox handled its own click
        const cb = c.querySelector('.npclib-bulk-check');
        if (cb){ cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
        return;
      }
      // New selection — re-hide the secret so it doesn't carry the previous
      // NPC's reveal state to this one (player might be looking at the screen).
      if (this._selectedId !== c.dataset.id) this._secretRevealed = false;
      this._selectedId = c.dataset.id;
      this._render();
    }));
  },

  _wireRight(){
    const b = this._body;
    const n = this._selected(); if (!n) return;

    // Field bindings (text inputs, number inputs, textarea)
    b.querySelectorAll('.npclib-detail [data-field]').forEach(el => {
      el.addEventListener('change', e => {
        const f = el.dataset.field;
        let v = e.target.value;
        if (f === 'hp' || f === 'ac' || f === 'init') v = parseInt(v) || 0;
        n[f] = v;
        this._save();
        // Light-touch refresh of left column when name/role change so card updates
        if (f === 'name' || f === 'role') this._render();
      });
    });

    // contenteditable notes — formatting via Selection API where possible
    // (document.execCommand is deprecated and may stop working in future
    // Chrome versions). Inline wraps use a manual Range.surroundContents path
    // and fall through to execCommand only for block-level commands that are
    // harder to implement by hand.
    const wrapInline = (tag) => {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return false;
      const range = sel.getRangeAt(0);
      const el = document.createElement(tag);
      if (range.collapsed){
        el.appendChild(document.createTextNode('​'));
        range.insertNode(el);
        const r = document.createRange();
        r.setStart(el.firstChild, 1);
        r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r);
      } else {
        try {
          el.appendChild(range.extractContents());
          range.insertNode(el);
          const r = document.createRange();
          r.selectNodeContents(el);
          sel.removeAllRanges(); sel.addRange(r);
        } catch(err){ return false; }
      }
      return true;
    };
    const applyFormat = (cmd) => {
      const inlineMap = { bold:'b', italic:'i', strikeThrough:'s', code:'code' };
      if (inlineMap[cmd]){
        if (wrapInline(inlineMap[cmd])) return;
      }
      // Block-level + list — fall back to execCommand. Wrapped in try so a
      // future browser removal of execCommand just no-ops instead of
      // crashing the click handler.
      try {
        if (cmd === 'quote')      document.execCommand('formatBlock', false, 'blockquote');
        else                       document.execCommand(cmd, false, null);
      } catch(e){
        console.warn('[npc-library] formatting unsupported in this browser:', cmd);
      }
    };
    const notesEl = b.querySelector('.npclib-notes');
    if (notesEl) {
      // Pasting a screenshot in here used to store the raw clipboard image as
      // base64 — a 4K PNG is ~8 MB against a ~5 MB localStorage quota, AND
      // this key syncs, so it also went to Firebase. Bound it on the way in.
      notesEl.addEventListener('paste', e => {
        const items = (e.clipboardData && e.clipboardData.items) || [];
        const imgItem = Array.prototype.find.call(items,
          it => it.kind === 'file' && /^image\//.test(it.type || ''));
        if (imgItem){
          e.preventDefault();
          const file = imgItem.getAsFile();
          if (!file) return;
          imageToBoundedDataUrl(file, this._NOTE_IMG_MAX_SIDE, 0.8).then(url => {
            document.execCommand('insertHTML', false,
              '<img src="' + url + '" style="max-width:100%">');
            n.notes = notesEl.innerHTML; this._save();
          }).catch(err => {
            console.warn('[npclib] image paste failed', err);
            if (typeof showToast === 'function') showToast('Could not paste that image');
          });
          return;
        }
        // Rich-text paste (e.g. copied from a web page) can smuggle in
        // oversized data: URIs too. Let the default paste happen, then shrink
        // anything over budget before it can be saved at full size.
        setTimeout(() => this._shrinkNoteImages(notesEl, n), 0);
      });
      notesEl.addEventListener('input', () => { n.notes = notesEl.innerHTML; this._save(); });
      notesEl.addEventListener('keydown', e => {
        if ((e.ctrlKey||e.metaKey) && (e.key==='b'||e.key==='i')) {
          e.preventDefault();
          applyFormat(e.key==='b' ? 'bold' : 'italic');
          n.notes = notesEl.innerHTML; this._save();
        }
      });
    }
    b.querySelectorAll('.npclib-notes-toolbar button').forEach(btn => btn.addEventListener('click', e => {
      e.preventDefault();
      notesEl.focus();
      applyFormat(btn.dataset.fmt);
      n.notes = notesEl.innerHTML; this._save();
    }));

    // Secret field — separate from notes so it can be hidden behind a
    // 👁 Reveal / 🙈 Hide toggle (panel-local, not persisted between
    // selections — defaults to hidden every time you pick a different NPC).
    const secretEl = b.querySelector('.npclib-secret');
    if (secretEl){
      secretEl.addEventListener('input', () => { n.secret = secretEl.value; this._save(); });
    }
    b.querySelector('[data-act="toggle-secret"]')?.addEventListener('click', () => {
      this._secretRevealed = !this._secretRevealed;
      this._render();
    });

    // Tag add / remove
    b.querySelectorAll('.tag-rm').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      const t = btn.dataset.rmtag;
      n.tags = (n.tags||[]).filter(x => x !== t);
      this._save(); this._render();
    }));
    b.querySelector('[data-act="new-tag"]')?.addEventListener('click', () => {
      showModal('Add Tag', [{id:'tag', label:'Tag', type:'text', value:'', placeholder:'e.g. Merchant'}], 'Add').then(r => {
        if (!r || !r.tag) return;
        n.tags = [...(n.tags||[]), r.tag.trim()];
        this._save(); this._render();
      });
    });

    // Group / Attitude editors
    b.querySelector('[data-act="edit-group"]')?.addEventListener('click', () => {
      const existing = [...new Set(this._npcs.map(x => x.group||NPC_DEFAULT_GROUP))];
      showModal('Change Group', [{id:'group', label:'Group ('+existing.join(', ')+')', type:'text', value:n.group||NPC_DEFAULT_GROUP}], 'Save').then(r => {
        if (!r) return;
        n.group = (r.group||NPC_DEFAULT_GROUP).trim() || NPC_DEFAULT_GROUP;
        this._save(); this._render();
      });
    });
    b.querySelector('[data-act="edit-attitude"]')?.addEventListener('click', e => {
      e.stopPropagation();
      const items = NPC_ATTITUDES.map(a => ({label:a, checked: n.attitude===a, onClick: () => {
        n.attitude = a; this._save(); this._render();
      }}));
      showContextMenu(e.clientX, e.clientY, items);
    });

    // Avatar upload (click big avatar in header)
    b.querySelector('[data-act="upload-avatar"]')?.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type='file'; inp.accept='image/*';
      inp.addEventListener('change', async ev => {
        const f = ev.target.files[0]; if (!f) return;
        try {
          const dataUrl = await showCropModal(f, {size:128, shape:'circle', title:'Crop NPC avatar'});
          if (!dataUrl) return;
          n.avatar = dataUrl; this._save(); this._render();
        } catch(err){ showToast('Upload failed: '+err.message); }
      });
      inp.click();
    });

    // Export as PNG image — hand-rolled canvas drawing of the NPC card so
    // the output is self-contained (no html-to-image dependency).
    b.querySelector('[data-act="export-image"]')?.addEventListener('click', () => this._exportNpcImage(n));

    // Delete NPC
    b.querySelector('[data-act="delete"]')?.addEventListener('click', () => {
      showModal('Delete '+n.name+'?', [], 'Delete').then(r => {
        if (!r) return;
        this._npcs = this._npcs.filter(x => x.id !== n.id);
        this._selectedId = this._npcs[0]?.id || null;
        // Auto-selecting the next NPC must NOT inherit the deleted one's reveal
        // state — re-hide so the new NPC's secret stays redacted until the DM
        // explicitly clicks Reveal (a player could be looking at the screen).
        this._secretRevealed = false;
        this._save(); this._render();
      });
    });

    // Push to combat
    b.querySelector('[data-act="to-combat"]')?.addEventListener('click', () => {
      panelDefs.combat.addMonster({ name:n.name, hp:n.hp||10, hpMax:n.hp||10, ac:n.ac||10, dex:10, _img: n.avatar });
      showToast(n.name+' added to combat');
    });
  },
});
