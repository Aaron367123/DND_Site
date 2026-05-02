// ============================================================
// SESSION NOTES PANEL
// ============================================================
// Two-pane file-tree + editor. Items are folders or files with a `parent`
// reference; the tree is built each render. Files contain markdown plus
// per-line author IDs (for collaborative coloring).

function _notesHydrate(){
  // v2 shape: { items:[{id,type,name,parent,expanded?,content?,lineAuthors?}], authors, selectedId }
  try {
    const raw = localStorage.getItem('skt-notes-v2');
    if (raw) {
      const d = JSON.parse(raw);
      if (Array.isArray(d.items)) return {
        items: d.items,
        authors: d.authors || {},
        selectedId: d.selectedId || (d.items.find(i => i.type==='file')?.id || null),
      };
    }
  } catch(e){}
  // Migrate from v1 (pages array)
  try {
    const v1 = localStorage.getItem('skt-notes-v1');
    if (v1) {
      const old = JSON.parse(v1);
      const pages = Array.isArray(old) ? old : (old.pages || []);
      const authors = (Array.isArray(old) ? {} : (old.authors || {}));
      const folderId = 'f_'+uid();
      const items = [{id:folderId, type:'folder', name:'Sessions', parent:null, expanded:true}];
      pages.forEach((p,i) => {
        items.push({
          id: p.id || ('n_'+uid()),
          type:'file',
          name: (p.title || 'Page '+(i+1)),
          parent: folderId,
          content: p.content || '',
          lineAuthors: p.lineAuthors || [],
        });
      });
      return { items, authors, selectedId: items.find(i => i.type==='file')?.id || null };
    }
  } catch(e){}
  // Brand-new install: one folder + one starter file
  const folderId = 'f_'+uid();
  const fileId = 'n_'+uid();
  return {
    items: [
      {id:folderId, type:'folder', name:'Sessions', parent:null, expanded:true},
      {id:fileId, type:'file', name:'Session 1', parent:folderId,
       content:'# Session 1\n\nWrite your notes here. Markdown is rendered live.\n\n---\n\n## What happened\n\n- \n\n## NPCs met\n\n- \n\n## Loot found\n\n- ',
       lineAuthors:[]},
    ],
    authors: {},
    selectedId: fileId,
  };
}

function _notesUpdateLineAuthors(oldContent, oldAuthors, newContent, myId){
  const oldLines=(oldContent||'').split('\n');
  const newLines=(newContent||'').split('\n');
  const priorByText=new Map();
  oldLines.forEach((line,i)=>{ if(!priorByText.has(line)) priorByText.set(line, oldAuthors && oldAuthors[i]); });
  return newLines.map(line => {
    const prior = priorByText.get(line);
    return prior!=null ? prior : myId;
  });
}

function _notesMdLine(line){
  let h = line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  let block=null;
  if(/^### (.+)$/.test(h))      { block='h3'; h=h.replace(/^### /,''); }
  else if(/^## (.+)$/.test(h))  { block='h2'; h=h.replace(/^## /,''); }
  else if(/^# (.+)$/.test(h))   { block='h1'; h=h.replace(/^# /,''); }
  else if(/^> (.+)$/.test(h))   { block='blockquote'; h=h.replace(/^> /,''); }
  else if(/^---+$/.test(h))     return '<hr>';
  else if(/^[-*] (.+)$/.test(h)){ block='li'; h=h.replace(/^[-*] /,''); }
  h = h.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g,'<em>$1</em>');
  h = h.replace(/_(.+?)_/g,'<em>$1</em>');
  h = h.replace(/`(.+?)`/g,'<code>$1</code>');
  if (block === 'li') return '<ul><li>'+h+'</li></ul>';
  if (block) return '<'+block+'>'+h+'</'+block+'>';
  return h;
}

registerPanel('notes', {
  title:'Session Notes', icon:'📝',
  _data:null, _editing:false, _editingOriginal:null,

  mount(body){
    this._body = body;
    if (!this._data) this._data = _notesHydrate();
    // Wire vault sync — provides "is editing?" hint so polls don't clobber an in-flight edit.
    if (window.notesSync) {
      window.notesSync.init(() => this._editing);
      window.notesSync.onStatus(() => { if (this._body) this._renderVaultPill(); });
      window.notesSync._onPullCallback = () => {
        // Disk → app brought in changes; refresh the tree + preview.
        if (!this._editing && this._body) this._render();
      };
      window.notesSync.startPolling(() => this._data);
    }
    this._render();
  },
  unmount(){
    this._commitEditing();
    if (window.notesSync) { window.notesSync.stopPolling(); window.notesSync._onPullCallback = null; }
    this._body = null;
  },

  _save(){
    const me = _getMe();
    if (!this._data.authors) this._data.authors = {};
    this._data.authors[me.id] = {name:me.name, color:me.color};
    try { localStorage.setItem('skt-notes-v2', JSON.stringify(this._data)); } catch(e){}
  },

  _touchSelf(){
    if (!this._data) return;
    this._save();
    if (this._body && !this._editing) this._refreshPreview();
  },

  _selected(){
    return this._data.items.find(i => i.id === this._data.selectedId && i.type === 'file');
  },

  // Build a sorted tree from the flat items list.
  _buildTree(){
    const byParent = new Map();
    this._data.items.forEach(it => {
      const k = it.parent || '__root__';
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k).push(it);
    });
    byParent.forEach(arr => arr.sort((a,b) => {
      // folders first, then files; within group alphabetical
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    }));
    return byParent;
  },

  _render(){
    const b = this._body; if (!b) return;
    b.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden';
    const sel = this._selected();
    const tree = this._buildTree();
    b.innerHTML = `
      <div class="notes-shell">
        <div class="notes-tree">
          <div class="notes-tree-head">
            <span class="notes-tree-title">📁 Notes</span>
            <button class="btn icon-btn" data-act="add-folder" title="New folder">📁+</button>
            <button class="btn icon-btn" data-act="add-file" title="New file">📄+</button>
            <span class="notes-vault-pill" id="notes-vault-pill"></span>
          </div>
          <div class="notes-tree-body">${this._renderTree(tree, null, 0)}</div>
        </div>
        <div class="notes-divider" id="notes-divider" title="Drag to resize"></div>
        <div class="notes-editor">
          ${sel ? this._renderEditor(sel) : '<div class="empty-state" style="padding:40px;text-align:center">Select a file, or click 📄+ to create one.</div>'}
        </div>
      </div>`;
    this._editing = false;
    this._wire();
  },

  _renderTree(tree, parentId, depth){
    const kids = tree.get(parentId || '__root__') || [];
    return kids.map(it => {
      if (it.type === 'folder') {
        const expanded = it.expanded !== false;
        return `<div class="notes-tree-row notes-folder" data-id="${it.id}" data-act="toggle-folder" style="padding-left:${8+depth*14}px">
            <span class="caret">${expanded?'▾':'▸'}</span>
            <span class="notes-tree-name">${esc(it.name)}</span>
            <span class="notes-tree-actions">
              <button class="icon-btn" data-act="add-file-in" data-id="${it.id}" title="New file in folder">＋</button>
              <button class="icon-btn" data-act="rename" data-id="${it.id}" title="Rename">✎</button>
              <button class="icon-btn danger" data-act="delete" data-id="${it.id}" title="Delete">×</button>
            </span>
          </div>
          ${expanded ? this._renderTree(tree, it.id, depth+1) : ''}`;
      } else {
        const sel = it.id === this._data.selectedId ? ' selected' : '';
        return `<div class="notes-tree-row notes-file${sel}" data-id="${it.id}" data-act="select-file" style="padding-left:${8+depth*14+12}px">
          <span class="notes-tree-name">${esc(it.name)}.md</span>
          <span class="notes-tree-actions">
            <button class="icon-btn" data-act="rename" data-id="${it.id}" title="Rename">✎</button>
            <button class="icon-btn danger" data-act="delete" data-id="${it.id}" title="Delete">×</button>
          </span>
        </div>`;
      }
    }).join('');
  },

  _renderEditor(file){
    return `<div class="notes-editor-head">
        <input class="notes-file-title" type="text" value="${esc(file.name)}" data-act="rename-inline">
        <span class="notes-file-tag">MARKDOWN</span>
        <span style="flex:1"></span>
        <button class="btn small" id="note-download" title="Save to desktop">💾</button>
      </div>
      <div class="notes-toolbar-2">
        <button class="btn" data-nact="bold" title="Bold (Ctrl+B)"><b>B</b></button>
        <button class="btn" data-nact="italic" title="Italic (Ctrl+I)"><i>I</i></button>
        <button class="btn" data-nact="quote" title="Quote">&ldquo;</button>
        <span class="notes-tb-sep"></span>
        <button class="btn" data-nact="h1" title="H1">H1</button>
        <button class="btn" data-nact="h2" title="H2">H2</button>
        <button class="btn" data-nact="h3" title="H3">H3</button>
        <span class="notes-tb-sep"></span>
        <button class="btn" data-nact="bullet" title="Bullet list">•</button>
        <button class="btn" data-nact="hr" title="Divider">—</button>
      </div>
      <div class="notes-edit-area" id="note-edit-area">${this._renderColored(file)}</div>`;
  },

  _renderColored(file){
    const lines = (file.content || '').split('\n');
    const authorsMap = this._data.authors || {};
    return lines.map((line, i) => {
      const aId = file.lineAuthors && file.lineAuthors[i];
      const author = aId && authorsMap[aId];
      const color = author && author.color ? author.color : '';
      const tip = author && author.name ? ' title="'+esc(author.name)+'"' : '';
      const html = _notesMdLine(line) || '&nbsp;';
      const styleAttr = color ? ' style="color:'+esc(color)+'"' : '';
      return '<div class="nl" data-line="'+i+'"'+styleAttr+tip+'>'+html+'</div>';
    }).join('');
  },

  _refreshPreview(){
    if (this._editing) return;
    const area = this._body && this._body.querySelector('#note-edit-area');
    if (!area) return;
    const sel = this._selected(); if (!sel) return;
    area.innerHTML = this._renderColored(sel);
  },

  _enterEdit(lineIdx){
    if (this._editing) return;
    const area = this._body && this._body.querySelector('#note-edit-area');
    if (!area) return;
    const file = this._selected();
    if (!file) return;
    this._editing = true;
    this._editingOriginal = file.content || '';
    area.innerHTML = '<textarea class="notes-textarea-2" id="note-textarea" spellcheck="true">'+esc(file.content||'')+'</textarea>';
    const ta = area.querySelector('#note-textarea');
    ta.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); ta.blur(); return; }
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = ta.selectionStart;
        ta.value = ta.value.slice(0,s) + '  ' + ta.value.slice(s);
        ta.selectionStart = ta.selectionEnd = s + 2;
      }
      if ((e.ctrlKey||e.metaKey) && !e.shiftKey) {
        if (e.key === 'b') { e.preventDefault(); this._insert(ta,'bold'); }
        if (e.key === 'i') { e.preventDefault(); this._insert(ta,'italic'); }
        if (e.key === 's') { e.preventDefault(); this._download(); }
      }
    });
    ta.addEventListener('blur', () => this._exitEdit());
    ta.focus();
    const lines = (file.content||'').split('\n');
    const idx = Math.max(0, Math.min(lineIdx, Math.max(0, lines.length-1)));
    let pos = 0; for (let i=0;i<idx;i++) pos += lines[i].length+1;
    try { ta.setSelectionRange(pos, pos); } catch(e){}
  },

  _exitEdit(){
    if (!this._editing) return;
    this._commitEditing();
    this._editing = false;
    this._editingOriginal = null;
    this._refreshPreview();
  },

  _commitEditing(){
    const ta = this._body && this._body.querySelector('#note-textarea');
    if (!ta) return;
    const file = this._selected();
    if (!file) return;
    const oldContent = this._editingOriginal != null ? this._editingOriginal : (file.content||'');
    const newContent = ta.value;
    if (newContent !== oldContent) {
      const me = _getMe();
      file.lineAuthors = _notesUpdateLineAuthors(oldContent, file.lineAuthors, newContent, me.id);
      file.content = newContent;
      // Push to vault (debounced inside notesSync)
      if (window.notesSync && window.notesSync.isConnected()) {
        window.notesSync.pushFile(file, this._data.items);
      }
    }
    this._save();
  },

  _insert(ta, act){
    const s = ta.selectionStart, end = ta.selectionEnd;
    const selected = ta.value.slice(s, end);
    const wrap = {bold:'**', italic:'_'}[act];
    const prefix = {h1:'# ', h2:'## ', h3:'### ', hr:'---', bullet:'- ', quote:'> '}[act];
    let newCursor = s;
    if (wrap) {
      const insert = wrap + (selected||'') + wrap;
      ta.value = ta.value.slice(0,s) + insert + ta.value.slice(end);
      newCursor = selected ? s + insert.length : s + wrap.length;
    } else if (prefix) {
      const lineStart = ta.value.lastIndexOf('\n', s-1) + 1;
      ta.value = ta.value.slice(0, lineStart) + prefix + ta.value.slice(lineStart);
      newCursor = s + prefix.length;
    }
    ta.focus();
    ta.setSelectionRange(newCursor, newCursor);
  },

  _wire(){
    const b = this._body; if (!b) return;

    // Tree row clicks (event delegation; ignore action-button clicks)
    b.querySelectorAll('.notes-tree-row').forEach(row => {
      row.addEventListener('click', e => {
        // If they clicked one of the row-action buttons, let those handlers take it
        if (e.target.closest('[data-act]') && e.target.closest('[data-act]') !== row) return;
        const act = row.dataset.act;
        const id  = row.dataset.id;
        if (act === 'toggle-folder') {
          const it = this._data.items.find(x => x.id === id);
          if (it) { it.expanded = !(it.expanded !== false); this._save(); this._render(); }
        } else if (act === 'select-file') {
          this._commitEditing();
          this._data.selectedId = id;
          this._save();
          this._render();
        }
      });
    });

    // Row-action buttons
    b.querySelectorAll('.notes-tree-row [data-act]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const act = btn.dataset.act;
        const id  = btn.dataset.id;
        if (act === 'rename') this._renamePrompt(id);
        else if (act === 'delete') this._deletePrompt(id);
        else if (act === 'add-file-in') this._addFile(id);
      });
    });

    // Top-level add buttons
    b.querySelector('[data-act="add-folder"]')?.addEventListener('click', e => { e.stopPropagation(); this._addFolder(null); });
    b.querySelector('[data-act="add-file"]')  ?.addEventListener('click', e => { e.stopPropagation(); this._addFile(null); });

    // Editor area
    const area = b.querySelector('#note-edit-area');
    if (area) area.addEventListener('click', e => {
      if (this._editing) return;
      const lineDiv = e.target.closest('.nl');
      const file = this._selected();
      const total = ((file && file.content) || '').split('\n').length;
      const lineIdx = lineDiv ? +lineDiv.dataset.line : Math.max(0, total - 1);
      this._enterEdit(lineIdx);
    });

    // File-name inline rename
    const titleInp = b.querySelector('.notes-file-title');
    if (titleInp) titleInp.addEventListener('change', e => {
      const file = this._selected(); if (!file) return;
      file.name = e.target.value.trim() || file.name;
      this._save(); this._render();
    });

    // Toolbar
    b.querySelectorAll('[data-nact]').forEach(btn => {
      btn.addEventListener('mousedown', e => e.preventDefault());
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const act = btn.dataset.nact;
        if (!this._editing) {
          const file = this._selected();
          const total = ((file && file.content) || '').split('\n').length;
          this._enterEdit(Math.max(0, total - 1));
        }
        const ta = b.querySelector('#note-textarea');
        if (ta) this._insert(ta, act);
      });
    });

    // Download
    b.querySelector('#note-download')?.addEventListener('click', () => this._download());

    // Divider
    this._wireDivider();

    // Vault pill
    this._renderVaultPill();
  },

  _renderVaultPill(){
    const pill = this._body && this._body.querySelector('#notes-vault-pill');
    if (!pill) return;
    if (!window.notesSync) { pill.style.display='none'; return; }
    const s = window.notesSync.getStatus();
    pill.style.display = '';
    if (!s.supported) {
      pill.className = 'notes-vault-pill unsupported';
      pill.textContent = '⚠ Chromium only';
      pill.title = 'Vault sync requires Chrome / Edge / Opera';
      pill.onclick = null;
      return;
    }
    if (!s.connected) {
      pill.className = 'notes-vault-pill disconnected';
      pill.textContent = '🔌 Connect vault…';
      pill.title = 'Connect an Obsidian vault folder';
      pill.onclick = async () => {
        const ok = await window.notesSync.connect();
        if (ok) {
          await window.notesSync.fullSync(this._data, { force: true });
          this._render();
        }
      };
      return;
    }
    if (s.busy) {
      pill.className = 'notes-vault-pill syncing';
      pill.textContent = '⟳ Syncing…';
      pill.title = '';
      pill.onclick = null;
      return;
    }
    pill.className = 'notes-vault-pill connected';
    pill.textContent = '📂 ' + (s.vaultName || 'vault');
    const ago = s.lastSync ? Math.round((Date.now() - s.lastSync)/1000) : null;
    pill.title = ago != null ? ('Last synced '+ago+'s ago — click for options') : 'Click for options';
    pill.onclick = (e) => this._showVaultMenu(e.clientX, e.clientY);
  },

  _showVaultMenu(x, y){
    const items = [
      { label: '🔄 Sync now', onClick: async () => {
          await window.notesSync.fullSync(this._data, { force: true });
          this._render();
          showToast('Sync complete');
        }},
      { label: '🔌 Disconnect', onClick: async () => {
          await window.notesSync.disconnect();
          this._renderVaultPill();
        }},
    ];
    showContextMenu(x, y, items);
  },

  _wireDivider(){
    const b = this._body;
    const divider = b.querySelector('#notes-divider');
    const tree = b.querySelector('.notes-tree');
    if (!divider || !tree) return;
    let drag = null;
    divider.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      drag = { sx: e.clientX, ow: tree.getBoundingClientRect().width };
      document.body.style.cursor = 'ew-resize';
    });
    document.addEventListener('mousemove', e => {
      if (!drag) return;
      const z = (typeof getZoom==='function') ? getZoom() : 1;
      const root = b.querySelector('.notes-shell');
      const rootW = root.getBoundingClientRect().width / z;
      const min = 160, max = Math.max(min + 100, rootW - 320);
      let w = drag.ow + (e.clientX - drag.sx) / z;
      w = Math.max(min, Math.min(max, w));
      tree.style.flex = `0 0 ${w}px`;
      tree.style.width = w + 'px';
      try { localStorage.setItem('skt-notes-treew', String(w)); } catch(e){}
    });
    document.addEventListener('mouseup', () => {
      if (drag) { drag = null; document.body.style.cursor = ''; }
    });
    // Restore persisted width
    try {
      const v = parseFloat(localStorage.getItem('skt-notes-treew'));
      if (!isNaN(v)) { tree.style.flex = `0 0 ${v}px`; tree.style.width = v + 'px'; }
    } catch(e){}
  },

  // ─── Tree mutations ───────────────────────────────────────────────────────

  _syncAfter(){
    if (window.notesSync && window.notesSync.isConnected()) {
      window.notesSync.fullSync(this._data, { force: true });
    }
  },

  _addFolder(parentId){
    showModal('New folder', [{id:'name', label:'Folder name', type:'text', value:'New Folder'}], 'Create').then(r => {
      if (!r || !r.name) return;
      const id = 'f_'+uid();
      this._data.items.push({id, type:'folder', name:r.name.trim(), parent:parentId, expanded:true});
      this._save(); this._render(); this._syncAfter();
    });
  },

  _addFile(parentId){
    showModal('New file', [{id:'name', label:'File name (without .md)', type:'text', value:'Session '+(1 + this._data.items.filter(i=>i.type==='file').length)}], 'Create').then(r => {
      if (!r || !r.name) return;
      const id = 'n_'+uid();
      this._data.items.push({id, type:'file', name:r.name.trim(), parent:parentId, content:'', lineAuthors:[]});
      this._data.selectedId = id;
      this._save(); this._render(); this._syncAfter();
    });
  },

  _renamePrompt(id){
    const it = this._data.items.find(x => x.id === id); if (!it) return;
    showModal('Rename '+it.type, [{id:'name', label:'Name', type:'text', value:it.name}], 'Save').then(r => {
      if (!r || !r.name) return;
      it.name = r.name.trim();
      this._save(); this._render(); this._syncAfter();
    });
  },

  _deletePrompt(id){
    const it = this._data.items.find(x => x.id === id); if (!it) return;
    const isFolder = it.type === 'folder';
    const desc = isFolder ? 'Folder and ALL its contents' : 'File';
    showModal('Delete '+desc+'?', [], 'Delete '+it.name).then(r => {
      if (!r) return;
      const toDelete = new Set([id]);
      if (isFolder) {
        // BFS through children
        let added = true;
        while (added) {
          added = false;
          this._data.items.forEach(x => {
            if (x.parent && toDelete.has(x.parent) && !toDelete.has(x.id)) {
              toDelete.add(x.id); added = true;
            }
          });
        }
      }
      this._data.items = this._data.items.filter(x => !toDelete.has(x.id));
      if (toDelete.has(this._data.selectedId)) {
        this._data.selectedId = this._data.items.find(x => x.type==='file')?.id || null;
      }
      this._save(); this._render(); this._syncAfter();
    });
  },

  _download(){
    const file = this._selected(); if (!file) return;
    const blob = new Blob([file.content || ''], {type:'text/plain'});
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {href:url, download:(file.name||'notes')+'.md'});
    a.click(); URL.revokeObjectURL(url);
    showToast('Saved: '+(file.name||'notes')+'.md');
  },
});
