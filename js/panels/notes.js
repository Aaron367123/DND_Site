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
  else if(/^[-*] (.+)$/.test(h))     { block='li';  h=h.replace(/^[-*] /,''); }
  else if(/^\d+\.\s(.+)$/.test(h))   { block='oli'; h=h.replace(/^\d+\.\s/,''); }
  else if(/^(\s{2,})[-*] (.+)$/.test(h)){
    const m = h.match(/^(\s+)[-*] (.+)$/);
    const depth = Math.min(4, Math.floor(m[1].length/2));
    block = 'li-indent-'+depth; h = m[2];
  }
  h = h.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  h = h.replace(/~~(.+?)~~/g,'<del>$1</del>');
  h = h.replace(/\*(.+?)\*/g,'<em>$1</em>');
  h = h.replace(/_(.+?)_/g,'<em>$1</em>');
  h = h.replace(/`(.+?)`/g,'<code>$1</code>');
  if (block === 'li')  return '<ul><li>'+h+'</li></ul>';
  if (block === 'oli') return '<ol><li>'+h+'</li></ol>';
  if (block && block.indexOf('li-indent-') === 0){
    const d = +block.slice('li-indent-'.length);
    return '<ul class="md-li-indent-'+d+'"><li>'+h+'</li></ul>';
  }
  if (block) return '<'+block+'>'+h+'</'+block+'>';
  return h;
}

registerPanel('notes', {
  title:'Session Notes', icon:'📝',
  _data:null, _editing:false, _editingOriginal:null,
  // 'picker' = source-selector screen, 'local' = current tree+editor pinned
  // to a connected vault. Future: 'onenote'.
  _view: 'picker',
  // Per-file content-history stacks for undo/redo. Keyed by file id.
  _undoStacks: {},
  _redoStacks: {},

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
      // If a vault is already connected from a prior session, skip the
      // picker and land directly in the local-folder view.
      if (window.notesSync.isConnected && window.notesSync.isConnected()){
        this._view = 'local';
      }
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
    if (this._view === 'local') this._renderLocalView();
    else                         this._renderPickerView();
    this._editing = false;
    this._applyViewSettings();
    this._wire();
  },

  // Read-write the per-tab display preferences (text size %, content width %).
  // Persisted in localStorage so each user's reading preference is theirs and
  // doesn't sync to other party members.
  _getViewSettings(){
    try {
      const raw = localStorage.getItem('skt-notes-view-v1');
      if (raw){
        const o = JSON.parse(raw) || {};
        return { textSize: Math.max(50, Math.min(300, +o.textSize||110)),
                 contentWidth: Math.max(0, Math.min(100, +o.contentWidth||73)) };
      }
    } catch(_){}
    return { textSize: 110, contentWidth: 73 };
  },
  _saveViewSettings(s){
    try { localStorage.setItem('skt-notes-view-v1', JSON.stringify(s)); } catch(_){}
  },
  _applyViewSettings(){
    const area = this._body && this._body.querySelector('.notes-edit-area');
    if (!area) return;
    const s = this._getViewSettings();
    // Font-size scales the entire preview; 100 % = 13px (the base from CSS).
    area.style.fontSize = (13 * s.textSize / 100).toFixed(1) + 'px';
    // Content width: 0 % narrow (~420 px), 100 % full (no cap). We use max-width
    // so very wide panels still cap content for comfortable reading.
    const minW = 420, maxW = 1200;
    const w = minW + (maxW - minW) * (s.contentWidth / 100);
    area.style.maxWidth = s.contentWidth >= 100 ? 'none' : (w.toFixed(0) + 'px');
    area.style.marginLeft = 'auto'; area.style.marginRight = 'auto';
  },

  // Source-picker screen — left rail with two source tiles, right pane
  // empty placeholder. Picking Local Folder calls notesSync.connect() and
  // swaps the view to 'local'. OneNote tile is disabled (coming soon).
  _renderPickerView(){
    const b = this._body;
    const chromiumOnly = window.notesSync && !window.notesSync.isSupported();
    b.innerHTML = `
      <div class="notes-picker-shell">
        <aside class="notes-picker-side">
          <div class="notes-picker-head">SELECT NOTE SOURCE</div>
          <div class="notes-picker-tiles">
            <button class="notes-source-tile${chromiumOnly?' disabled':''}" data-act="src-local"${chromiumOnly?' disabled title="Local Folder requires Chromium (Chrome/Edge/Opera)"':''}>
              <span class="tile-icon">📁</span>
              <span class="tile-label">LOCAL FOLDER</span>
              ${chromiumOnly?'<span class="tile-coming">Chromium only</span>':''}
            </button>
            <button class="notes-source-tile disabled" data-act="src-onenote" disabled title="OneNote integration coming soon">
              <span class="tile-icon">📘</span>
              <span class="tile-label">ONENOTE</span>
              <span class="tile-coming">Coming soon</span>
            </button>
          </div>
        </aside>
        <div class="notes-picker-empty">Select a note source on the left to begin.</div>
      </div>`;
  },

  // Tree + editor view, scoped to the local-folder source.
  _renderLocalView(){
    const b = this._body;
    const sel = this._selected();
    const tree = this._buildTree();
    b.innerHTML = `
      <div class="notes-shell">
        <div class="notes-tree">
          <div class="notes-tree-head">
            <button class="btn icon-btn" data-act="back-to-picker" title="Choose a different source">←</button>
            <span class="notes-tree-title">LOCAL FOLDER</span>
            <span style="flex:1"></span>
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
        <button class="btn icon-btn" data-act="notes-refresh" title="Sync now (pull latest from disk)">↻</button>
        <button class="btn icon-btn" data-act="notes-settings" title="Display settings">⚙</button>
      </div>
      <div class="notes-toolbar-2">
        <button class="btn" data-nact="bold"   title="Bold (Ctrl+B)"><b>B</b></button>
        <button class="btn" data-nact="italic" title="Italic (Ctrl+I)"><i>I</i></button>
        <button class="btn" data-nact="strike" title="Strikethrough"><span style="text-decoration:line-through">S</span></button>
        <button class="btn" data-nact="code"   title="Inline code">&lt;/&gt;</button>
        <span class="notes-tb-sep"></span>
        <button class="btn" data-nact="h1" title="Heading 1">H1</button>
        <button class="btn" data-nact="h2" title="Heading 2">H2</button>
        <button class="btn" data-nact="h3" title="Heading 3">H3</button>
        <span class="notes-tb-sep"></span>
        <button class="btn" data-nact="bullet" title="Bullet list">≡</button>
        <button class="btn" data-nact="numlist" title="Numbered list">1.</button>
        <button class="btn" data-nact="indent" title="Indent list item">→</button>
        <span class="notes-tb-sep"></span>
        <button class="btn" data-nact="quote"     title="Blockquote">&ldquo;</button>
        <button class="btn" data-nact="codeblock" title="Code block">{ }</button>
        <button class="btn" data-nact="hr"        title="Horizontal rule">—</button>
        <button class="btn" data-nact="table"     title="Insert table">▦</button>
        <span class="notes-tb-sep"></span>
        <button class="btn" data-nact="undo" title="Undo (Ctrl+Z)">↶</button>
        <button class="btn" data-nact="redo" title="Redo (Ctrl+Shift+Z)">↷</button>
      </div>
      <div class="notes-edit-area" id="note-edit-area">${this._renderColored(file)}</div>`;
  },

  // Floating settings popover anchored under the ⚙ button. Holds the
  // per-tab "how should this notes panel look" controls — text size and
  // content width — both as range sliders that update the preview live.
  _openViewSettingsPopover(anchor){
    // If already open, close (toggle).
    const existing = document.getElementById('notes-view-settings-pop');
    if (existing){ existing.remove(); return; }
    const s = this._getViewSettings();
    const pop = document.createElement('div');
    pop.id = 'notes-view-settings-pop';
    pop.className = 'notes-settings-pop';
    pop.innerHTML = `
      <div class="nvs-head">
        <span class="nvs-title">Settings</span>
        <button class="btn icon-btn" id="nvs-close" title="Close">×</button>
      </div>
      <p class="nvs-blurb">Controls for how your notes are displayed.</p>
      <div class="nvs-field">
        <div class="nvs-row"><span class="nvs-label">Text size</span><span class="nvs-val" id="nvs-text-val">${s.textSize}%</span></div>
        <input id="nvs-text" type="range" min="50" max="300" step="5" value="${s.textSize}">
        <div class="nvs-scale"><span>50%</span><span>175%</span><span>300%</span></div>
      </div>
      <div class="nvs-field">
        <div class="nvs-row"><span class="nvs-label">Content width</span><span class="nvs-val" id="nvs-width-val">${s.contentWidth}%</span></div>
        <input id="nvs-width" type="range" min="0" max="100" step="1" value="${s.contentWidth}">
        <div class="nvs-scale"><span>Narrow</span><span>${s.contentWidth}%</span><span>Full</span></div>
      </div>
      <div class="nvs-actions">
        <button class="btn" id="nvs-reset">Reset</button>
        <button class="btn primary" id="nvs-done">Done</button>
      </div>`;
    document.body.appendChild(pop);
    // Position under the anchor button (right-aligned).
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth || 300, ph = pop.offsetHeight || 240;
    let left = r.right - pw, top = r.bottom + 6;
    if (left < 8) left = 8;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
    pop.style.left = left + 'px';
    pop.style.top  = top + 'px';
    const txt = pop.querySelector('#nvs-text');
    const wid = pop.querySelector('#nvs-width');
    const txtVal = pop.querySelector('#nvs-text-val');
    const widVal = pop.querySelector('#nvs-width-val');
    const widLabel = pop.querySelectorAll('.nvs-scale')[1].children[1];
    const apply = () => {
      const next = { textSize: +txt.value, contentWidth: +wid.value };
      txtVal.textContent = next.textSize + '%';
      widVal.textContent = next.contentWidth + '%';
      if (widLabel) widLabel.textContent = next.contentWidth + '%';
      this._saveViewSettings(next);
      this._applyViewSettings();
    };
    txt.addEventListener('input', apply);
    wid.addEventListener('input', apply);
    pop.querySelector('#nvs-reset').addEventListener('click', () => {
      txt.value = 110; wid.value = 73; apply();
    });
    const close = () => pop.remove();
    pop.querySelector('#nvs-close').addEventListener('click', close);
    pop.querySelector('#nvs-done').addEventListener('click', close);
    // Close when clicking outside.
    setTimeout(() => {
      document.addEventListener('mousedown', function outside(e){
        if (!pop.contains(e.target) && e.target !== anchor){
          close();
          document.removeEventListener('mousedown', outside, true);
        }
      }, true);
    }, 0);
  },

  _renderColored(file){
    const lines = (file.content || '').split('\n');
    const authorsMap = this._data.authors || {};
    // Pre-scan to flag lines that are inside fenced code blocks OR part of a
    // GFM table. Code blocks: between matching ``` lines (inclusive of fences).
    // Tables: a run of 2+ contiguous `|`-led lines where line 2 is a separator
    // row (|---|---|...). Flagged lines are still rendered as individual
    // .nl divs (so author-color + click-to-edit still work) but their HTML
    // contents come from a block-aware renderer.
    const flags = new Array(lines.length).fill(null);
    let inCode = false;
    for (let i = 0; i < lines.length; i++){
      const ln = lines[i];
      if (/^```/.test(ln.trim())){
        flags[i] = {type:'code-fence'};
        inCode = !inCode;
        continue;
      }
      if (inCode){ flags[i] = {type:'code-body'}; continue; }
      // Table detection: only kicks off on a header row followed by a separator.
      if (flags[i] == null && /^\s*\|.+\|\s*$/.test(ln) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i+1]||'')){
        // Find the run.
        let j = i;
        while (j < lines.length && /^\s*\|.+\|\s*$/.test(lines[j])) j++;
        flags[i]   = {type:'table-head'};
        flags[i+1] = {type:'table-sep'};
        for (let k = i+2; k < j; k++) flags[k] = {type:'table-row'};
        i = j - 1;
      }
    }
    const renderTableCell = c => '<td>'+_notesMdLine(c.trim())+'</td>';
    const renderTableHead = c => '<th>'+_notesMdLine(c.trim())+'</th>';
    const splitCells = ln => ln.replace(/^\s*\|/,'').replace(/\|\s*$/,'').split('|');
    return lines.map((line, i) => {
      const aId = file.lineAuthors && file.lineAuthors[i];
      const author = aId && authorsMap[aId];
      const color = author && author.color ? author.color : '';
      const tip = author && author.name ? ' title="'+esc(author.name)+'"' : '';
      const styleAttr = color ? ' style="color:'+esc(color)+'"' : '';
      const flag = flags[i];
      let html;
      if (flag){
        if (flag.type === 'code-fence'){
          // Show the bare fence line; visually subtle so the user sees the block boundary.
          html = '<span class="md-code-fence">'+esc(line)+'</span>';
        } else if (flag.type === 'code-body'){
          html = '<pre class="md-code">'+esc(line || ' ')+'</pre>';
        } else if (flag.type === 'table-head'){
          html = '<table class="md-table"><thead><tr>'+splitCells(line).map(renderTableHead).join('')+'</tr></thead></table>';
        } else if (flag.type === 'table-sep'){
          html = '<span class="md-table-sep">'+esc(line)+'</span>';
        } else if (flag.type === 'table-row'){
          html = '<table class="md-table"><tbody><tr>'+splitCells(line).map(renderTableCell).join('')+'</tr></tbody></table>';
        }
      } else {
        html = _notesMdLine(line) || '&nbsp;';
      }
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
        if (e.key === 'b') { e.preventDefault(); this._pushUndo(); this._insert(ta,'bold'); }
        if (e.key === 'i') { e.preventDefault(); this._pushUndo(); this._insert(ta,'italic'); }
        if (e.key === 's') { e.preventDefault(); this._download(); }
        if (e.key === 'z') { e.preventDefault(); this._undo(); }
      }
      if ((e.ctrlKey||e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault(); this._redo();
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
    if (act === 'undo'){ this._undo(); return; }
    if (act === 'redo'){ this._redo(); return; }
    const s = ta.selectionStart, end = ta.selectionEnd;
    const selected = ta.value.slice(s, end);
    const wrap   = {bold:'**', italic:'_', strike:'~~', code:'`'}[act];
    const prefix = {h1:'# ', h2:'## ', h3:'### ', hr:'---', bullet:'- ', numlist:'1. ', indent:'  ', quote:'> '}[act];
    let newCursor = s;
    if (wrap) {
      const insert = wrap + (selected||'') + wrap;
      ta.value = ta.value.slice(0,s) + insert + ta.value.slice(end);
      newCursor = selected ? s + insert.length : s + wrap.length;
    } else if (prefix) {
      const lineStart = ta.value.lastIndexOf('\n', s-1) + 1;
      ta.value = ta.value.slice(0, lineStart) + prefix + ta.value.slice(lineStart);
      newCursor = s + prefix.length;
    } else if (act === 'codeblock') {
      // Wrap selection (or empty cursor) with triple-backtick fences on their
      // own lines. Insert a blank line inside if the selection was empty.
      const body = selected || '';
      const insert = '```\n' + (body || '') + (body ? '\n' : '') + '```\n';
      ta.value = ta.value.slice(0,s) + insert + ta.value.slice(end);
      newCursor = s + 4; // place caret on the empty line between the fences
    } else if (act === 'table') {
      // 3×3 GFM table template at the start of the current line.
      const lineStart = ta.value.lastIndexOf('\n', s-1) + 1;
      const template =
        '| Header 1 | Header 2 | Header 3 |\n'+
        '|----------|----------|----------|\n'+
        '| Row 1 c1 | Row 1 c2 | Row 1 c3 |\n'+
        '| Row 2 c1 | Row 2 c2 | Row 2 c3 |\n';
      ta.value = ta.value.slice(0, lineStart) + template + ta.value.slice(lineStart);
      newCursor = lineStart + 2; // first header cell
    }
    ta.focus();
    ta.setSelectionRange(newCursor, newCursor);
  },

  // Per-file content-history stacks. We snapshot the current textarea value
  // (when in edit mode) or the saved file content into _undoStacks before
  // each mutating action. Capped at 50 entries; oldest dropped first.
  _pushUndo(){
    const file = this._selected(); if (!file) return;
    const id = file.id;
    const ta = this._body && this._body.querySelector('#note-textarea');
    const cur = ta ? ta.value : (file.content || '');
    if (!this._undoStacks[id]) this._undoStacks[id] = [];
    const stack = this._undoStacks[id];
    if (stack.length && stack[stack.length-1] === cur) return; // no-op duplicates
    stack.push(cur);
    if (stack.length > 50) stack.shift();
    this._redoStacks[id] = [];
  },
  _undo(){
    const file = this._selected(); if (!file) return;
    const id = file.id;
    const stack = this._undoStacks[id] || [];
    if (!stack.length) return;
    const ta = this._body && this._body.querySelector('#note-textarea');
    const cur = ta ? ta.value : (file.content || '');
    const prev = stack.pop();
    (this._redoStacks[id] = this._redoStacks[id] || []).push(cur);
    if (ta){ ta.value = prev; ta.focus(); }
    else { file.content = prev; this._save(); this._render(); }
  },
  _redo(){
    const file = this._selected(); if (!file) return;
    const id = file.id;
    const stack = this._redoStacks[id] || [];
    if (!stack.length) return;
    const ta = this._body && this._body.querySelector('#note-textarea');
    const cur = ta ? ta.value : (file.content || '');
    const next = stack.pop();
    (this._undoStacks[id] = this._undoStacks[id] || []).push(cur);
    if (ta){ ta.value = next; ta.focus(); }
    else { file.content = next; this._save(); this._render(); }
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
        // Undo/redo can run without entering edit mode (operate on saved content).
        if (act === 'undo'){ this._undo(); return; }
        if (act === 'redo'){ this._redo(); return; }
        if (!this._editing) {
          const file = this._selected();
          const total = ((file && file.content) || '').split('\n').length;
          this._enterEdit(Math.max(0, total - 1));
        }
        const ta = b.querySelector('#note-textarea');
        if (ta){
          this._pushUndo();
          this._insert(ta, act);
        }
      });
    });

    // Source-picker tiles (only present when _view === 'picker')
    b.querySelector('[data-act="src-local"]')?.addEventListener('click', async () => {
      if (!window.notesSync){ showToast('Notes sync unavailable'); return; }
      if (!window.notesSync.isSupported()){ showToast('Local Folder requires Chromium (Chrome/Edge/Opera)'); return; }
      let connected = window.notesSync.isConnected && window.notesSync.isConnected();
      if (!connected){
        connected = await window.notesSync.connect();
      }
      if (connected){
        try { await window.notesSync.fullSync(this._data, {force:true}); } catch(_){}
        this._view = 'local';
        this._render();
      }
    });
    b.querySelector('[data-act="src-onenote"]')?.addEventListener('click', () => {
      showToast('OneNote integration coming soon');
    });

    // Back-to-picker arrow (only present in local view)
    b.querySelector('[data-act="back-to-picker"]')?.addEventListener('click', () => {
      this._commitEditing();
      this._view = 'picker';
      this._render();
    });

    // Manual sync from disk (the ↻ button next to the gear).
    b.querySelector('[data-act="notes-refresh"]')?.addEventListener('click', async () => {
      if (!window.notesSync || !window.notesSync.isConnected()){
        showToast('No vault connected');
        return;
      }
      try {
        await window.notesSync.fullSync(this._data, { force:true });
        this._render();
        showToast('Sync complete');
      } catch(e){ showToast('Sync failed'); }
    });

    // Settings popover (the ⚙ button next to refresh).
    b.querySelector('[data-act="notes-settings"]')?.addEventListener('click', e => {
      e.stopPropagation();
      this._openViewSettingsPopover(e.currentTarget);
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
