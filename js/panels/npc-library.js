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
  return (name||'?').split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase().slice(0,2);
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
    this._render();
  },
  unmount(){ this._body = null; },

  _save(){ try { localStorage.setItem('skt-npcs-v2', JSON.stringify(this._npcs)); } catch(e){} },

  _selected(){ return this._npcs.find(n => n.id === this._selectedId); },

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
    b.innerHTML = `<div class="npclib-root">
      <div class="npclib-left" ${leftStyle}>
        <div class="npclib-toolbar">
          <input type="search" id="npclib-search" placeholder="🔎 Search NPCs..." value="${esc(this._searchQ)}">
          <button class="icon-btn npclib-tool-btn" id="npclib-add" title="New NPC">+</button>
        </div>
        <div class="npclib-groups" id="npclib-groups">
          ${groups.map(g => this._renderGroup(g, q)).join('')}
        </div>
      </div>
      <div class="npclib-divider" id="npclib-divider" title="Drag to resize"></div>
      <div class="npclib-right">
        ${sel ? this._renderDetail(sel) : '<div class="empty-state" style="padding:30px">Select an NPC, or click + to add one.</div>'}
      </div>
    </div>`;
    this._wire();
    this._wireDivider();
  },

  // Drag the column divider. Width is stored in pixels and persisted to
  // localStorage so the user's preferred ratio survives reloads.
  _wireDivider(){
    const b = this._body; if (!b) return;
    const divider = b.querySelector('#npclib-divider');
    const left    = b.querySelector('.npclib-left');
    const root    = b.querySelector('.npclib-root');
    if (!divider || !left || !root) return;
    let drag = null;
    divider.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      drag = { sx: e.clientX, ow: left.getBoundingClientRect().width };
      document.body.style.cursor = 'ew-resize';
    });
    document.addEventListener('mousemove', e => {
      if (!drag) return;
      const z = (typeof getZoom==='function') ? getZoom() : 1;
      const rootW = root.getBoundingClientRect().width / z;
      const min = 200, max = Math.max(min + 100, rootW - 280);
      let w = drag.ow + (e.clientX - drag.sx) / z;
      w = Math.max(min, Math.min(max, w));
      left.style.flex = `0 0 ${w}px`;
      left.style.width = w + 'px';
      this._leftWidth = w;
    });
    document.addEventListener('mouseup', () => {
      if (!drag) return;
      drag = null;
      document.body.style.cursor = '';
      try { localStorage.setItem('skt-npclib-leftw', String(this._leftWidth)); } catch(e){}
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
    return `<div class="npclib-card${sel?' selected':''}" data-id="${n.id}">
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
      <div class="npclib-notes" contenteditable="true" data-field="notes" data-placeholder="Click here to start typing.">${n.notes||''}</div>

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

    this._wireLeft();
    this._wireRight();
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
    // Card select
    b.querySelectorAll('.npclib-card').forEach(c => c.addEventListener('click', () => {
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

    // Delete NPC
    b.querySelector('[data-act="delete"]')?.addEventListener('click', () => {
      showModal('Delete '+n.name+'?', [], 'Delete').then(r => {
        if (!r) return;
        this._npcs = this._npcs.filter(x => x.id !== n.id);
        this._selectedId = this._npcs[0]?.id || null;
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
