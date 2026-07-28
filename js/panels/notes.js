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
      // Stored value exists but is malformed — keep a backup so the user can
      // recover by hand if the auto-default below isn't what they wanted.
      try { localStorage.setItem('skt-notes-v2-corrupt-backup', raw); } catch(e2){}
      console.warn('[notes] skt-notes-v2 parsed but had no items array; keeping a corrupt-backup copy and resetting to default.');
    }
  } catch(e){
    try {
      const raw = localStorage.getItem('skt-notes-v2');
      if (raw) localStorage.setItem('skt-notes-v2-corrupt-backup', raw);
    } catch(e2){}
    console.warn('[notes] Failed to parse skt-notes-v2 — original value preserved under skt-notes-v2-corrupt-backup. Error:', e);
  }
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
  oldAuthors = oldAuthors || [];
  // Build, per distinct line TEXT, an ordered QUEUE of the authors that owned
  // each occurrence. Consuming from the queue (rather than always reading the
  // single first match) preserves per-occurrence authorship for duplicate
  // lines — blank lines in particular are everywhere, and the old first-match
  // map collapsed all of them onto the first blank line's author.
  const queues=new Map();
  oldLines.forEach((line,i)=>{
    let q=queues.get(line); if(!q){ q=[]; queues.set(line,q); }
    q.push(oldAuthors[i]);
  });
  return newLines.map(line => {
    const q=queues.get(line);
    if (q && q.length){
      const prior=q.shift();
      return prior!=null ? prior : myId;
    }
    return myId; // genuinely new (or surplus duplicate) line → current author
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
  // Wiki-style backlinks — `[[Note Name]]` becomes a clickable chip that
  // jumps to the matching note. Resolution happens at click time so the
  // link survives note renames (matched by name, case-insensitive). The
  // `[[` text was already entity-escaped above so we match `&#91;&#91;` —
  // but the input is already-escaped, so `[[` is literal. The data-attr
  // carries the raw target name; click handler in _wire dispatches.
  h = h.replace(/\[\[([^\]\n]+?)\]\]/g, (_m, target) => {
    const safe = target.replace(/"/g, '&quot;');
    return '<a class="note-wiki-link" data-wiki-target="'+safe+'" href="#" title="Jump to note &quot;'+safe+'&quot;">'+target+'</a>';
  });
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
  // Toolbar collapse state. Matches the battlemap pattern — same localStorage
  // contract, same UX (small "▾ Toolbar" chip to restore when hidden). The
  // formatting bar eats 70px of vertical space on a phone, so being able to
  // tuck it away while reading / writing long notes is worth more than the
  // taps it saves on power users.
  _toolbarHidden: (function(){ try { return localStorage.getItem('skt-notes-toolbar-hidden') === '1'; } catch(e){ return false; } })(),

  mount(body){
    this._body = body;
    if (!this._data) this._data = _notesHydrate();
    // Commit + flush on tab hide/close so an edit typed in the last 800 ms
    // isn't lost when the page goes away (unmount() won't fire on tab close).
    // visibilitychange→hidden is the reliable signal (fires before pagehide on
    // mobile + desktop); pagehide is the belt-and-suspenders for hard closes.
    if (!this._onPageHide){
      this._onPageHide = () => {
        this._commitEditing();
        if (window.notesSync   && window.notesSync.flushPending)   window.notesSync.flushPending();
        if (window.dropboxSync && window.dropboxSync.flushPending) window.dropboxSync.flushPending();
      };
      this._onVisChange = () => { if (document.visibilityState === 'hidden') this._onPageHide(); };
      window.addEventListener('pagehide', this._onPageHide);
      document.addEventListener('visibilitychange', this._onVisChange);
    }
    // Attach the divider's document-level mousemove/mouseup ONCE per mount.
    // (Previously these were re-attached inside _wireDivider() — which runs
    // from _wire() on every _render() — so each sync-pull poll added a new
    // closure-retaining listener, leaking the panel and slowing every
    // document click. Now there's exactly one pair, gated on
    // this._dividerDrag which the divider's mousedown sets up.)
    if (!this._onDividerMove){
      this._onDividerMove = (e) => {
        const drag = this._dividerDrag; if (!drag) return;
        const b = this._body; if (!b) return;
        const tree = b.querySelector('.notes-tree');
        const root = b.querySelector('.notes-shell');
        if (!tree || !root) return;
        const z = (typeof getZoom === 'function') ? getZoom() : 1;
        const rootW = root.getBoundingClientRect().width / z;
        const min = 160, max = Math.max(min + 100, rootW - 320);
        let w = drag.ow + (e.clientX - drag.sx) / z;
        w = Math.max(min, Math.min(max, w));
        tree.style.flex = `0 0 ${w}px`;
        tree.style.width = w + 'px';
        try { localStorage.setItem('skt-notes-treew', String(w)); } catch(err){}
      };
      this._onDividerUp = () => {
        if (this._dividerDrag){
          this._dividerDrag = null;
          document.body.style.cursor = '';
        }
      };
      document.addEventListener('mousemove', this._onDividerMove);
      document.addEventListener('mouseup', this._onDividerUp);
    }
    // Source preference order on mount:
    //  1. Dropbox if a token is configured (the "always logged in" shared
    //     account) — auto-skips the picker entirely. notesSync is NOT
    //     started in this branch so the browser doesn't prompt for File
    //     System Access permission for a stale local-vault handle.
    //  2. Local folder if a vault from a prior session is still connected.
    //  3. Otherwise show the picker.
    if (window.dropboxSync && window.dropboxSync.isConfigured()){
      this._initDropbox();
      this._view = 'dropbox';
    } else if (window.notesSync && window.notesSync.isConnected && window.notesSync.isConnected()){
      this._initLocalSync();
      this._view = 'local';
    }
    // Else: picker view — neither adapter is started until the user picks one.
    this._render();
  },

  // Wire the Dropbox adapter — BACKUP MIRROR ONLY (sync redesign step 3).
  // Notes now sync device-to-device through Firebase like everything else
  // (per-note entity nodes — fast, no polling, no delete-resurrection class
  // of bugs). Dropbox keeps receiving write-through pushes on every edit /
  // rename / delete so the .md mirror stays fresh, but it is no longer a
  // sync SOURCE: no polling, no mount-time fullSync merging Dropbox back
  // into the app. A manual "Pull from Dropbox backup" stays available in
  // the vault menu for disaster recovery.
  _initDropbox(){
    const ds = window.dropboxSync; if (!ds) return;
    ds.init(() => this._editing);
    ds.onStatus(() => { if (this._body) this._renderVaultPill(); });
  },

  // Wire the local-folder adapter. Idempotent — only attaches once.
  _initLocalSync(){
    if (this._localSyncWired) return;
    const ns = window.notesSync; if (!ns) return;
    this._localSyncWired = true;
    ns.init(() => this._editing);
    ns.onStatus(() => { if (this._body) this._renderVaultPill(); });
    ns._onPullCallback = () => { if (!this._editing && this._body) this._renderKeepScroll(); };
    // Conflict subscription — when notes-sync detects a two-sided change,
    // surface a banner so the user can review and choose a winner.
    if (typeof ns.onConflict === 'function'){
      ns.onConflict(list => {
        this._pendingConflicts = list || [];
        if (this._body) this._render();
      });
    }
    ns.startPolling(() => this._data);
  },
  unmount(){
    this._commitEditing();
    // Flush any debounced push before tearing down so a just-typed edit isn't
    // stranded in the 800 ms window when the panel closes.
    if (window.notesSync   && window.notesSync.flushPending)   window.notesSync.flushPending();
    if (window.dropboxSync && window.dropboxSync.flushPending) window.dropboxSync.flushPending();
    if (this._onPageHide){
      window.removeEventListener('pagehide', this._onPageHide);
      document.removeEventListener('visibilitychange', this._onVisChange);
      this._onPageHide = null; this._onVisChange = null;
    }
    if (window.notesSync)   { window.notesSync.stopPolling();   window.notesSync._onPullCallback   = null; }
    if (window.dropboxSync) { window.dropboxSync.stopPolling(); window.dropboxSync._onPullCallback = null; }
    if (this._paneObserver){ this._paneObserver.disconnect(); this._paneObserver = null; }
    // Detach the document-level divider listeners attached in mount().
    // Without this, repeated mount/unmount cycles (e.g., reset-layout) would
    // each leave a dangling listener pair.
    if (this._onDividerMove) document.removeEventListener('mousemove', this._onDividerMove);
    if (this._onDividerUp)   document.removeEventListener('mouseup',   this._onDividerUp);
    this._onDividerMove = null;
    this._onDividerUp = null;
    this._dividerDrag = null;
    this._body = null;
  },

  _save(){
    const me = _getMe();
    if (!this._data.authors) this._data.authors = {};
    this._data.authors[me.id] = {name:me.name, color:me.color};
    try { localStorage.setItem('skt-notes-v2', JSON.stringify(this._data)); }
    catch(e){ if (typeof warnStorageFailure === 'function') warnStorageFailure('session notes', e); }
  },

  _touchSelf(){
    if (!this._data) return;
    this._save();
    if (this._body && !this._editing) this._refreshPreview();
  },

  _selected(){
    return this._data.items.find(i => i.id === this._data.selectedId && i.type === 'file');
  },

  // True when `descId` is `ancestorId` or sits anywhere under it. Used by
  // the drag handler to reject moving a folder into one of its own
  // descendants (which would orphan the subtree).
  _isDescendant(descId, ancestorId){
    if (descId === ancestorId) return true;
    let cur = this._data.items.find(x => x.id === descId);
    while (cur && cur.parent){
      if (cur.parent === ancestorId) return true;
      cur = this._data.items.find(x => x.id === cur.parent);
    }
    return false;
  },

  // Recompute `order` values on the siblings under `parentId`. Two modes:
  //   • `end:true` → put `movedId` at the bottom of its new siblings.
  //   • `end:false, anchorId, before` → insert `movedId` immediately
  //     before/after `anchorId` among its siblings.
  // Order values are renumbered 10, 20, 30… so future inserts have room
  // without renumbering everyone.
  _reorderSiblings(parentId, movedId, end, anchorId, before){
    const all = this._data.items.filter(x => (x.parent || null) === (parentId || null));
    // Keep current sort (folders first, then by existing order then alpha)
    // before we insert/move so the user sees a stable result.
    all.sort((a,b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      const ao = (typeof a.order === 'number') ? a.order : Infinity;
      const bo = (typeof b.order === 'number') ? b.order : Infinity;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    });
    // Pull the moved item out of its current position.
    const withoutMoved = all.filter(x => x.id !== movedId);
    const moved = this._data.items.find(x => x.id === movedId);
    if (!moved) return;
    let next;
    if (end || !anchorId){
      next = withoutMoved.concat([moved]);
    } else {
      const ai = withoutMoved.findIndex(x => x.id === anchorId);
      if (ai < 0) next = withoutMoved.concat([moved]);
      else {
        const insertAt = before ? ai : ai + 1;
        next = withoutMoved.slice(0, insertAt).concat([moved]).concat(withoutMoved.slice(insertAt));
      }
    }
    next.forEach((it, i) => { it.order = (i + 1) * 10; });
  },

  // Build a sorted tree from the flat items list. Items with an explicit
  // `order` number sort by that first (manual drag-reorder); anything
  // without falls back to alphabetical. Folders always cluster before files
  // so the visual hierarchy stays clean even after manual ordering.
  _buildTree(){
    const byParent = new Map();
    this._data.items.forEach(it => {
      const k = it.parent || '__root__';
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k).push(it);
    });
    byParent.forEach(arr => arr.sort((a,b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      const ao = (typeof a.order === 'number') ? a.order : Infinity;
      const bo = (typeof b.order === 'number') ? b.order : Infinity;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    }));
    return byParent;
  },

  // Re-render while keeping the click-to-edit preview's scroll position.
  // Used by the sync-pull callbacks: a remote change (or another tab's edit)
  // shouldn't yank the DM back to the top of a long note they're reading.
  _renderKeepScroll(){
    const area = this._body && this._body.querySelector('.notes-edit-area');
    const st = area ? area.scrollTop : 0;
    this._render();
    const area2 = this._body && this._body.querySelector('.notes-edit-area');
    if (area2) area2.scrollTop = st;
  },

  _render(){
    const b = this._body; if (!b) return;
    b.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden';
    if      (this._view === 'dropbox') this._renderDropboxView();
    else if (this._view === 'local')   this._renderLocalView();
    else                                this._renderPickerView();
    this._editing = false;
    this._applyViewSettings();
    this._observePaneResize();
    this._wire();
  },

  // Dropbox view — identical structure to local view; only the header label
  // differs. The same tree, editor, toolbar, undo stack, settings popover,
  // etc. all keep working unchanged.
  _renderDropboxView(){
    const b = this._body;
    const sel = this._selected();
    const tree = this._buildTree();
    b.innerHTML = `
      <div class="notes-shell">
        <div class="notes-tree">
          <div class="notes-tree-head">
            <button class="btn icon-btn" data-act="back-to-picker" title="Choose a different source">←</button>
            <span class="notes-tree-title">DROPBOX</span>
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
    // Content width: constrain each LINE (.nl) via a CSS variable, not the
    // whole edit area. That way the editable surface always fills the pane
    // (clicking anywhere on the right works), but text wraps at the
    // requested column width. A 30 % floor keeps the column readable.
    //
    // Auto-disable when the pane itself is narrow — below 500 px the slider
    // would only make already-cramped text narrower, so we just fill the
    // pane regardless of slider position.
    const paneW = area.getBoundingClientRect().width;
    const effective = (paneW < 500 || s.contentWidth >= 100)
      ? 100
      : Math.max(30, s.contentWidth);
    area.style.setProperty('--note-line-width', effective + '%');
    // Clear any leftover max-width from earlier revisions.
    area.style.maxWidth = '';
    area.style.marginLeft = '';
    area.style.marginRight = '';
    area.style.textAlign = '';
  },

  // Watch the editor pane for size changes (window resize, divider drag)
  // and re-run _applyViewSettings so the narrow-pane threshold flips at
  // the right moment without needing a re-render.
  _observePaneResize(){
    if (this._paneObserver){ this._paneObserver.disconnect(); this._paneObserver = null; }
    const editor = this._body && this._body.querySelector('.notes-editor');
    if (!editor || typeof ResizeObserver === 'undefined') return;
    this._paneObserver = new ResizeObserver(() => this._applyViewSettings());
    this._paneObserver.observe(editor);
  },

  // Source-picker screen — left rail with two source tiles, right pane
  // empty placeholder. Picking Local Folder calls notesSync.connect() and
  // swaps the view to 'local'. OneNote tile is disabled (coming soon).
  _renderPickerView(){
    const b = this._body;
    const chromiumOnly = window.notesSync && !window.notesSync.isSupported();
    const dropboxConfigured = window.dropboxSync && window.dropboxSync.isConfigured();
    b.innerHTML = `
      <div class="notes-picker-shell">
        <aside class="notes-picker-side">
          <div class="notes-picker-head">SELECT NOTE SOURCE</div>
          <div class="notes-picker-tiles">
            <button class="notes-source-tile${dropboxConfigured?'':' disabled'}" data-act="src-dropbox"${dropboxConfigured?'':' disabled title="Dropbox not configured — paste a token in js/dropbox-config.js"'}>
              <span class="tile-icon">📦</span>
              <span class="tile-label">DROPBOX</span>
              ${dropboxConfigured?'':'<span class="tile-coming">Not configured</span>'}
            </button>
            <button class="notes-source-tile${chromiumOnly?' disabled':''}" data-act="src-local"${chromiumOnly?' disabled title="Local Folder requires Chromium (Chrome/Edge/Opera)"':''}>
              <span class="tile-icon">📁</span>
              <span class="tile-label">LOCAL FOLDER</span>
              ${chromiumOnly?'<span class="tile-coming">Chromium only</span>':''}
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
    const conflicts = this._pendingConflicts || [];
    const conflictBanner = conflicts.length
      ? `<div class="notes-conflict-banner" data-act="open-conflicts" title="Review the differences and pick a winner">
           ⚠ ${conflicts.length} sync conflict${conflicts.length===1?'':'s'} — click to resolve
         </div>`
      : '';
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
          ${conflictBanner}
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
        return `<div class="notes-tree-row notes-folder" data-id="${it.id}" data-act="toggle-folder" draggable="true" style="padding-left:${8+depth*14}px">
            <span class="caret">${expanded?'▾':'▸'}</span>
            <span class="notes-tree-name">${esc(it.name)}</span>
            <span class="notes-tree-actions">
              <button class="icon-btn" data-act="add-file-in" data-id="${it.id}" title="New file in folder"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg></button>
              <button class="icon-btn" data-act="rename" data-id="${it.id}" title="Rename"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5l2 2L5 13H3v-2l8.5-8.5z"/><line x1="10" y1="4" x2="12" y2="6"/></svg></button>
              <button class="icon-btn danger" data-act="delete" data-id="${it.id}" title="Delete"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 5h10M6 5V3.5h4V5M5 5l.6 8.2c0 .5.4.8.9.8h3c.5 0 .9-.3.9-.8L11 5"/></svg></button>
            </span>
          </div>
          ${expanded ? this._renderTree(tree, it.id, depth+1) : ''}`;
      } else {
        const sel = it.id === this._data.selectedId ? ' selected' : '';
        return `<div class="notes-tree-row notes-file${sel}" data-id="${it.id}" data-act="select-file" draggable="true" style="padding-left:${8+depth*14+12}px">
          <span class="notes-tree-name">${esc(it.name)}.md</span>
          <span class="notes-tree-actions">
            <button class="icon-btn" data-act="rename" data-id="${it.id}" title="Rename"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5l2 2L5 13H3v-2l8.5-8.5z"/><line x1="10" y1="4" x2="12" y2="6"/></svg></button>
            <button class="icon-btn danger" data-act="delete" data-id="${it.id}" title="Delete"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 5h10M6 5V3.5h4V5M5 5l.6 8.2c0 .5.4.8.9.8h3c.5 0 .9-.3.9-.8L11 5"/></svg></button>
          </span>
        </div>`;
      }
    }).join('');
  },

  _renderEditor(file){
    const tbHidden = !!this._toolbarHidden;
    return `<div class="notes-editor-head">
        <input class="notes-file-title" type="text" value="${esc(file.name)}" data-act="rename-inline">
        <span class="notes-file-tag">MARKDOWN</span>
        <span style="flex:1"></span>
        <button class="btn small" id="note-download" title="Save to desktop">💾</button>
        <button class="btn icon-btn" data-act="notes-refresh" title="Sync now (pull latest from disk)">↻</button>
        <button class="btn icon-btn" data-act="notes-settings" title="Display settings">⚙</button>
        <button class="btn icon-btn ${tbHidden?'':'active'}" data-act="notes-toggle-toolbar" title="${tbHidden?'Show formatting toolbar':'Hide formatting toolbar (more room to write)'}" style="font-size:13px">${tbHidden?'▼ Tools':'▲'}</button>
      </div>
      ${tbHidden ? '' : `<div class="notes-toolbar-2">
        <button class="btn" data-nact="bold"   title="Bold (Ctrl+B)"><b>B</b></button>
        <button class="btn" data-nact="italic" title="Italic (Ctrl+I)"><i>I</i></button>
        <button class="btn" data-nact="strike" title="Strikethrough"><span style="text-decoration:line-through">S</span></button>
        <button class="btn" data-nact="code"   title="Inline code">&lt;/&gt;</button>
        <span class="notes-tb-sep"></span>
        <button class="btn" data-nact="h1" title="Heading 1">H1</button>
        <button class="btn" data-nact="h2" title="Heading 2">H2</button>
        <button class="btn" data-nact="h3" title="Heading 3">H3</button>
        <span class="notes-tb-sep"></span>
        <button class="btn" data-nact="bullet" title="Bullet list"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="3" cy="4" r="1" fill="currentColor"/><circle cx="3" cy="8" r="1" fill="currentColor"/><circle cx="3" cy="12" r="1" fill="currentColor"/><line x1="6" y1="4" x2="14" y2="4"/><line x1="6" y1="8" x2="14" y2="8"/><line x1="6" y1="12" x2="14" y2="12"/></svg></button>
        <button class="btn" data-nact="numlist" title="Numbered list">1.</button>
        <button class="btn" data-nact="indent" title="Indent list item">→</button>
        <span class="notes-tb-sep"></span>
        <button class="btn" data-nact="quote"     title="Blockquote"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M3 4h4v4H5c0 1.5 1 2.5 2 2.5V12c-2.5 0-4-1.7-4-4V4zm6 0h4v4h-2c0 1.5 1 2.5 2 2.5V12c-2.5 0-4-1.7-4-4V4z"/></svg></button>
        <button class="btn" data-nact="codeblock" title="Code block">{ }</button>
        <button class="btn" data-nact="hr"        title="Horizontal rule">—</button>
        <button class="btn" data-nact="table"     title="Insert table"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="3" width="12" height="10" rx="1"/><line x1="2" y1="7" x2="14" y2="7"/><line x1="2" y1="10" x2="14" y2="10"/><line x1="6" y1="3" x2="6" y2="13"/><line x1="10" y1="3" x2="10" y2="13"/></svg></button>
        <span class="notes-tb-sep"></span>
        <button class="btn" data-nact="undo" title="Undo (Ctrl+Z)">↶</button>
        <button class="btn" data-nact="redo" title="Redo (Ctrl+Shift+Z)">↷</button>
      </div>`}
      <div class="notes-edit-area" id="note-edit-area">${this._renderColored(file)}</div>`;
  },

  // Floating settings popover anchored under the ⚙ button. Holds the
  // per-tab "how should this notes panel look" controls — text size and
  // content width — both as range sliders that update the preview live.
  // Render the per-author color list that goes inside the settings popover.
  // Each line is `<swatch> <name input> <delete>` so the user can rename
  // / recolor their own entry and remove stale collaborator entries. The
  // "me" row is highlighted and its swatch writes back to skt-me-v1 (the
  // global identity), which the rest of the app reads from too.
  _renderAuthorsSection(){
    const authors = this._data?.authors || {};
    const meId = (typeof _getMe === 'function') ? _getMe().id : null;
    const ids = Object.keys(authors);
    if (!ids.length){
      return `<div class="nvs-field"><div class="nvs-row"><span class="nvs-label">Authors</span></div>
        <p style="font-size:10px;color:var(--text-dim);margin:2px 0 0">No collaborators yet — each browser that edits a note will appear here with its identity color.</p>
      </div>`;
    }
    // Put "me" first.
    ids.sort((a, b) => (a === meId ? -1 : b === meId ? 1 : 0));
    const rows = ids.map(id => {
      const a = authors[id] || {};
      const isMe = id === meId;
      return `<div class="nvs-author-row" data-author-id="${esc(id)}">
        <input type="color" class="nvs-author-color" value="${esc(a.color || '#888888')}" title="Color">
        <input type="text"  class="nvs-author-name"  value="${esc(a.name || 'Anonymous')}" ${isMe ? '' : 'readonly'} title="${isMe ? 'Your display name' : 'Read-only — other collaborator'}">
        ${isMe ? '<span class="nvs-author-tag">you</span>' : '<button class="nvs-author-del" data-author-del="'+esc(id)+'" title="Remove this collaborator from the legend">×</button>'}
      </div>`;
    }).join('');
    return `<div class="nvs-field">
      <div class="nvs-row"><span class="nvs-label">Authors</span></div>
      <div class="nvs-authors-list">${rows}</div>
    </div>`;
  },

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
      ${this._renderAuthorsSection()}
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

    // Author rows — "me" row edits color/name (and writes back to the
    // global identity via _getMe → localStorage). Other rows let the user
    // delete the entry from the legend (which doesn't unattribute the
    // existing per-line colors — those are baked into lineAuthors arrays).
    const meId = (typeof _getMe === 'function') ? _getMe().id : null;
    pop.querySelectorAll('.nvs-author-row').forEach(row => {
      const id = row.dataset.authorId;
      const colorInp = row.querySelector('.nvs-author-color');
      const nameInp  = row.querySelector('.nvs-author-name');
      const delBtn   = row.querySelector('.nvs-author-del');
      const writeBack = () => {
        if (!this._data.authors) this._data.authors = {};
        this._data.authors[id] = this._data.authors[id] || {};
        this._data.authors[id].color = colorInp.value;
        this._data.authors[id].name  = nameInp.value;
        // For "me", also update the global identity so other panels (and
        // future writes) use the new values.
        if (id === meId){
          try {
            const me = JSON.parse(localStorage.getItem('skt-me-v1') || '{}') || {};
            me.color = colorInp.value;
            me.name  = nameInp.value;
            localStorage.setItem('skt-me-v1', JSON.stringify(me));
          } catch(e){}
        }
        this._save();
        // Re-render the editor so existing colored lines pick up the new
        // palette immediately.
        if (this._body && !this._editing) this._refreshPreview();
      };
      colorInp.addEventListener('input', writeBack);
      if (id === meId) nameInp.addEventListener('change', writeBack);
      delBtn?.addEventListener('click', () => {
        if (!this._data.authors) return;
        delete this._data.authors[id];
        // Scrub orphan references. Any line still attributed to the removed
        // author would look up a now-missing legend entry and render as a
        // colorless "ghost" author. Null those entries so the lines fall back
        // to the unattributed style instead of dangling on a dead id.
        (this._data.items || []).forEach(it => {
          if (!Array.isArray(it.lineAuthors)) return;
          for (let i = 0; i < it.lineAuthors.length; i++){
            if (it.lineAuthors[i] === id) it.lineAuthors[i] = null;
          }
        });
        this._save();
        // Re-render the popover content so the row disappears immediately.
        const list = pop.querySelector('.nvs-authors-list');
        if (list) row.remove();
        if (this._body && !this._editing) this._refreshPreview();
      });
    });
    // close() also tears down the document outside-click listener. The old
    // code only removed it on the outside-click path, so closing via Close/Done
    // left a dangling capture-phase listener bound until the next stray click.
    const onOutside = (e) => { if (!pop.contains(e.target) && e.target !== anchor) close(); };
    const close = () => { pop.remove(); document.removeEventListener('mousedown', onOutside, true); };
    pop.querySelector('#nvs-close').addEventListener('click', close);
    pop.querySelector('#nvs-done').addEventListener('click', close);
    // Close when clicking outside.
    setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
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
      this._pushActive(file);
    }
    this._save();
  },

  // Push a file to whichever sync adapter is active (debounced inside each
  // module). Centralized so every content mutation — commit, AND undo/redo
  // while not in edit mode — propagates to Dropbox / the vault, not just
  // localStorage.
  _pushActive(file){
    if (!file) return;
    if (this._view === 'dropbox' && window.dropboxSync && window.dropboxSync.isConfigured()) {
      window.dropboxSync.pushFile(file, this._data.items);
    } else if (window.notesSync && window.notesSync.isConnected()) {
      window.notesSync.pushFile(file, this._data.items);
    }
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
    else { file.content = prev; this._save(); this._pushActive(file); this._render(); }
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
    else { file.content = next; this._save(); this._pushActive(file); this._render(); }
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

    // Conflict banner — opens the per-file resolve modal for the first
    // pending conflict. After resolution, fresh conflicts (if any remain)
    // surface via the onConflict subscription and re-render the banner.
    b.querySelector('[data-act="open-conflicts"]')?.addEventListener('click', () => this._openConflictResolver());

    // ── Drag-to-reorder / reparent ─────────────────────────────────────────
    // HTML5 drag-and-drop on tree rows. dragstart stamps the source id;
    // dragover highlights drop-before / drop-after / drop-into based on
    // cursor Y relative to the row midpoint (and on folders, top/bottom
    // 1/3 reorders while middle 1/3 reparents). drop applies the change.
    b.querySelectorAll('.notes-tree-row').forEach(row => {
      row.addEventListener('dragstart', e => {
        e.dataTransfer.setData('application/x-skt-note-id', row.dataset.id);
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        b.querySelectorAll('.notes-tree-row').forEach(r => r.classList.remove('drop-before','drop-after','drop-into'));
      });
      row.addEventListener('dragover', e => {
        if (!e.dataTransfer.types.includes('application/x-skt-note-id')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const r = row.getBoundingClientRect();
        const y = e.clientY - r.top;
        const isFolder = row.classList.contains('notes-folder');
        row.classList.remove('drop-before','drop-after','drop-into');
        if (isFolder && y > r.height/3 && y < r.height*2/3){
          row.classList.add('drop-into');
        } else if (y < r.height/2){
          row.classList.add('drop-before');
        } else {
          row.classList.add('drop-after');
        }
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('drop-before','drop-after','drop-into');
      });
      row.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        const fromId = e.dataTransfer.getData('application/x-skt-note-id');
        const toId   = row.dataset.id;
        if (!fromId || fromId === toId) return;
        const from = this._data.items.find(x => x.id === fromId);
        const to   = this._data.items.find(x => x.id === toId);
        if (!from || !to) return;
        // Reject moving a folder into its own descendant.
        if (from.type === 'folder' && this._isDescendant(toId, fromId)){
          if (typeof showToast === 'function') showToast("Can't move a folder into itself");
          row.classList.remove('drop-before','drop-after','drop-into');
          return;
        }
        const dropInto = row.classList.contains('drop-into');
        const dropBefore = row.classList.contains('drop-before');
        row.classList.remove('drop-before','drop-after','drop-into');

        // Capture the OLD Dropbox path BEFORE mutating `from.parent`. Once
        // the parent changes, _buildPath would walk the new tree and give
        // the new path — leaving the file stranded on Dropbox at its old
        // location, and the next poll would silently restore the move.
        // Folder moves are handled by Dropbox's move_v2 server-side with
        // all descendants, so we only need the top-level item's path.
        const isDropbox = this._view === 'dropbox' && window.dropboxSync && window.dropboxSync.isConfigured();
        const oldParent = from.parent;
        let oldPath = null;
        if (isDropbox && window.dropboxSync.buildPath){
          oldPath = window.dropboxSync.buildPath(from, this._data.items, from.type === 'folder' ? '' : '.md');
        }

        if (dropInto && to.type === 'folder'){
          // Move into folder. Place at the end of that folder's children.
          from.parent = to.id;
          to.expanded = true; // reveal the new contents
          this._reorderSiblings(to.id, from.id, /*end*/true);
        } else {
          // Reorder among siblings of `to`. Reparent to `to.parent` if
          // different, then insert before/after `to`.
          from.parent = to.parent;
          this._reorderSiblings(to.parent, from.id, /*end*/false, to.id, dropBefore);
        }
        this._save();
        this._render();

        // Sync the move to the remote. Two cases:
        //   • Parent CHANGED → path changed on Dropbox/disk; we need to
        //     move the file (Dropbox) or re-push and orphan the old (vault).
        //   • Parent DIDN'T change (pure within-folder reorder) → path is
        //     identical; no remote action needed. Tree position is a
        //     client-only concern that Dropbox doesn't care about.
        const parentChanged = (from.parent || null) !== (oldParent || null);
        if (!parentChanged) return;
        if (isDropbox && oldPath){
          const newPath = window.dropboxSync.buildPath(from, this._data.items, from.type === 'folder' ? '' : '.md');
          if (newPath && newPath !== oldPath){
            window.dropboxSync.movePath(oldPath, newPath);
          }
        } else {
          // Local vault path — notesSync has no move primitive, so
          // _syncAfter() re-pushes every file at its new path. This leaves
          // the old file orphaned at the old path on disk (separate audit
          // item); the user's INTENT (the move) at least lands correctly
          // at the new location.
          this._syncAfter();
        }
      });
    });

    // Wiki-link clicks: [[Note Name]] resolves to a note in this._data.items
    // (case-insensitive name match). Jumps to the target by selecting it.
    // Falls back to a toast if no matching note exists. Wired at the panel
    // level so the click handler survives editor re-renders.
    b.querySelectorAll('.note-wiki-link').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const target = (a.dataset.wikiTarget || '').trim();
      if (!target) return;
      const lc = target.toLowerCase();
      const hit = (this._data.items || []).find(it => it.type === 'file' && (it.name||'').toLowerCase() === lc);
      if (hit){
        this._commitEditing();
        this._data.selectedId = hit.id;
        this._save();
        this._render();
      } else if (typeof showToast === 'function'){
        showToast('No note named "' + target + '"');
      }
    }));

    // Editor area
    const area = b.querySelector('#note-edit-area');
    if (area) area.addEventListener('click', e => {
      if (this._editing) return;
      // Ignore clicks on wiki-links — their own handler dispatched first;
      // letting this fire would also flip the line into edit mode.
      if (e.target.closest('.note-wiki-link')) return;
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
    b.querySelector('[data-act="src-dropbox"]')?.addEventListener('click', () => {
      if (!window.dropboxSync || !window.dropboxSync.isConfigured()){
        showToast('Dropbox not configured — paste a token in js/dropbox-config.js');
        return;
      }
      this._initDropbox();
      this._view = 'dropbox';
      this._render();
    });
    b.querySelector('[data-act="src-local"]')?.addEventListener('click', async () => {
      if (!window.notesSync){ showToast('Notes sync unavailable'); return; }
      if (!window.notesSync.isSupported()){ showToast('Local Folder requires Chromium (Chrome/Edge/Opera)'); return; }
      let connected = window.notesSync.isConnected && window.notesSync.isConnected();
      if (!connected){
        connected = await window.notesSync.connect();
      }
      if (connected){
        // User explicitly opted into Local Folder — safe to start the
        // polling loop now (it may trigger an FS permission prompt, which
        // is expected at this point because they just clicked the tile).
        this._initLocalSync();
        try { await window.notesSync.fullSync(this._data, {force:true}); } catch(_){}
        this._view = 'local';
        this._render();
      }
    });
    // Back-to-picker arrow (only present in local view)
    b.querySelector('[data-act="back-to-picker"]')?.addEventListener('click', () => {
      this._commitEditing();
      this._view = 'picker';
      this._render();
    });

    // Manual sync (the ↻ button next to the gear). For the local vault this
    // is a normal pull. For Dropbox — now a backup mirror, not a live sync
    // source — this is the DELIBERATE disaster-recovery path: fullSync
    // merges the backup in and re-pushes local-only files. Day-to-day
    // cross-device sync happens via Firebase and never touches this.
    b.querySelector('[data-act="notes-refresh"]')?.addEventListener('click', async () => {
      const adapter = (this._view === 'dropbox' && window.dropboxSync && window.dropboxSync.isConfigured())
        ? window.dropboxSync
        : (window.notesSync && window.notesSync.isConnected() ? window.notesSync : null);
      if (!adapter){ showToast('No source connected'); return; }
      try {
        await adapter.fullSync(this._data, { force:true });
        this._render();
        showToast('Sync complete');
      } catch(e){ showToast('Sync failed'); }
    });

    // Settings popover (the ⚙ button next to refresh).
    b.querySelector('[data-act="notes-settings"]')?.addEventListener('click', e => {
      e.stopPropagation();
      this._openViewSettingsPopover(e.currentTarget);
    });

    // Toolbar collapse toggle — mirrors the battlemap's ▲/▾ tools button.
    // Persisted across sessions so a player who hates the toolbar can lose
    // it once and have it stay gone.
    b.querySelector('[data-act="notes-toggle-toolbar"]')?.addEventListener('click', () => {
      this._toolbarHidden = !this._toolbarHidden;
      try { localStorage.setItem('skt-notes-toolbar-hidden', this._toolbarHidden ? '1' : '0'); } catch(e){}
      this._render();
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
    // Pick the adapter that matches the current view. Dropbox pill is
    // simpler since there's no "connect" step — it's configured or not.
    if (this._view === 'dropbox'){
      const ds = window.dropboxSync;
      if (!ds){ pill.style.display='none'; return; }
      const s = ds.getStatus();
      pill.style.display = '';
      if (!s.configured){
        pill.className = 'notes-vault-pill unsupported';
        pill.textContent = '⚠ No token';
        pill.title = 'Set accessToken in js/dropbox-config.js';
        pill.onclick = null;
        return;
      }
      if (s.busy){
        pill.className = 'notes-vault-pill syncing';
        pill.textContent = '⟳ Syncing…';
        pill.title = ''; pill.onclick = null;
        return;
      }
      if (!s.connected){
        pill.className = 'notes-vault-pill disconnected';
        pill.textContent = '⚠ ' + (s.error || 'Disconnected');
        pill.title = s.error || 'Dropbox unreachable';
        pill.onclick = null;
        return;
      }
      pill.className = 'notes-vault-pill connected';
      pill.textContent = '📦 ' + (s.vaultName || 'Dropbox');
      const ago = s.lastSync ? Math.round((Date.now() - s.lastSync)/1000) : null;
      pill.title = ago != null ? ('Last synced '+ago+'s ago') : '';
      pill.onclick = null;
      return;
    }
    // Local-folder pill (original behavior, untouched)
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
    if (s.needsPermission) {
      // Handle restored from IndexedDB but the readwrite grant lapsed on
      // reload. Don't pretend we're synced — make the user re-grant. The click
      // is a user gesture, so requestAccess() can actually open the dialog.
      pill.className = 'notes-vault-pill needs-permission';
      pill.textContent = '🔓 Grant vault access';
      pill.title = 'Folder permission lapsed after reload — click to re-grant access to ' + (s.vaultName || 'your vault');
      pill.onclick = async () => {
        const ok = await window.notesSync.requestAccess();
        if (ok) await window.notesSync.fullSync(this._data, { force: true });
        this._render();
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

  // Open the conflict-resolution modal for the first pending sync conflict.
  // Shows both versions side-by-side with three resolve buttons and an
  // optional manual-merge text area. After resolving one, if more remain,
  // the user can click the banner again — the next one comes up.
  _openConflictResolver(){
    const c = (this._pendingConflicts || [])[0];
    if (!c) return;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="width:760px;max-width:96vw;max-height:90vh;display:flex;flex-direction:column">
      <h3 style="margin:0 0 4px">⚠ Sync conflict — "${esc(c.name)}"</h3>
      <p style="margin:0 0 12px;font-size:11px;color:var(--text-muted)">Both the app and the file on disk changed since the last sync. Pick which version wins, or merge by hand.</p>
      <div style="flex:1;overflow:hidden;display:grid;grid-template-columns:1fr 1fr;gap:10px;min-height:200px">
        <div style="display:flex;flex-direction:column;min-height:0">
          <div style="font-size:10px;color:var(--accent);font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px">📱 App version</div>
          <pre id="notes-conflict-app" style="flex:1;overflow:auto;background:var(--panel-2);border:1px solid var(--border);border-radius:5px;padding:10px;margin:0;font-size:11px;line-height:1.5;color:var(--text);white-space:pre-wrap;word-break:break-word">${esc(c.appContent || '')}</pre>
        </div>
        <div style="display:flex;flex-direction:column;min-height:0">
          <div style="font-size:10px;color:#9ad1ff;font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px">💾 Disk version</div>
          <pre id="notes-conflict-disk" style="flex:1;overflow:auto;background:var(--panel-2);border:1px solid var(--border);border-radius:5px;padding:10px;margin:0;font-size:11px;line-height:1.5;color:var(--text);white-space:pre-wrap;word-break:break-word">${esc(c.diskContent || '')}</pre>
        </div>
      </div>
      <details style="margin-top:8px;font-size:11px">
        <summary style="cursor:pointer;color:var(--text-muted)">✎ Manual merge — edit a combined version</summary>
        <textarea id="notes-conflict-manual" style="width:100%;height:140px;margin-top:6px;background:var(--panel-2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:8px;font-size:11px;font-family:'Cascadia Code',Consolas,monospace;resize:vertical">${esc(c.appContent || '')}</textarea>
      </details>
      <div class="modal-actions" style="margin-top:12px">
        <button class="btn" id="notes-conflict-cancel">Decide later</button>
        <span style="flex:1"></span>
        <button class="btn" id="notes-conflict-disk-btn" title="Replace the app version with what's on disk">Use disk</button>
        <button class="btn" id="notes-conflict-app-btn" title="Overwrite disk with the app version">Use app</button>
        <button class="btn primary" id="notes-conflict-manual-btn" title="Use the manual-merge text (open the section below first)">Use merged</button>
      </div>
    </div>`;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector('#notes-conflict-cancel').addEventListener('click', close);
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
    backdrop.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

    const apply = async (choice) => {
      let opts = { data: this._data };
      if (choice === 'manual'){
        const v = backdrop.querySelector('#notes-conflict-manual').value;
        opts.manualContent = v;
      }
      if (window.notesSync && typeof window.notesSync.resolveConflict === 'function'){
        await window.notesSync.resolveConflict(c.itemId, choice, opts);
      }
      this._save();
      this._render();
      close();
      if (typeof showToast === 'function') showToast('Conflict resolved');
    };
    backdrop.querySelector('#notes-conflict-app-btn').addEventListener('click', () => apply('app'));
    backdrop.querySelector('#notes-conflict-disk-btn').addEventListener('click', () => apply('disk'));
    backdrop.querySelector('#notes-conflict-manual-btn').addEventListener('click', () => apply('manual'));
  },

  _showVaultMenu(x, y){
    const items = [
      { label: '🔄 Sync now', onClick: async () => {
          await window.notesSync.fullSync(this._data, { force: true });
          this._render();
          showToast('Sync complete');
        }},
      { label: '📁 Switch vault…', onClick: async () => {
          // Disconnect first so the new directory picker doesn't try to
          // reconcile with the old handle's stored state. The user picks
          // a fresh folder; we then trigger a fullSync to populate it.
          await window.notesSync.disconnect();
          const ok = await window.notesSync.connect();
          if (ok){
            await window.notesSync.fullSync(this._data, { force: true });
            this._render();
          }
          this._renderVaultPill();
        }},
      { label: '🔌 Disconnect', onClick: async () => {
          await window.notesSync.disconnect();
          this._renderVaultPill();
        }},
    ];
    showContextMenu(x, y, items);
  },

  _wireDivider(){
    // Only the divider's mousedown is per-render (the element is rebuilt
    // every _render). Document-level mousemove/mouseup live on the panel
    // instance — attached once in mount(), removed in unmount(). The drag
    // state lives on this._dividerDrag so the document handlers can read it.
    const b = this._body;
    const divider = b.querySelector('#notes-divider');
    const tree = b.querySelector('.notes-tree');
    if (!divider || !tree) return;
    divider.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      this._dividerDrag = { sx: e.clientX, ow: tree.getBoundingClientRect().width };
      document.body.style.cursor = 'ew-resize';
    });
    // Restore persisted width
    try {
      const v = parseFloat(localStorage.getItem('skt-notes-treew'));
      if (!isNaN(v)) { tree.style.flex = `0 0 ${v}px`; tree.style.width = v + 'px'; }
    } catch(e){}
  },

  // ─── Tree mutations ───────────────────────────────────────────────────────

  _syncAfter(){
    // Tree mutations (add/rename/delete) need to push the new shape to the
    // active adapter — only one is in use at a time per the current _view.
    //
    // Dropbox path: pushFile each file individually so adds/renames go up
    // without triggering a destructive fullSync (which rebuilds items[]
    // from Dropbox truth and would clobber locally-added files that
    // haven't been uploaded yet). Folders are created implicitly when
    // their contained files upload.
    if (this._view === 'dropbox' && window.dropboxSync && window.dropboxSync.isConfigured()){
      const items = this._data.items || [];
      items.forEach(it => {
        if (it.type === 'file') window.dropboxSync.pushFile(it, items);
      });
      return;
    }
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
      // Capture OLD Dropbox path before mutating the name — once renamed,
      // _buildPath would give the new path. Dropbox's move_v2 handles
      // folder moves with all descendants in one server-side call.
      let oldPath = null;
      const isDropbox = this._view === 'dropbox' && window.dropboxSync && window.dropboxSync.isConfigured();
      if (isDropbox && window.dropboxSync.buildPath){
        oldPath = window.dropboxSync.buildPath(it, this._data.items, it.type === 'folder' ? '' : '.md');
      }
      it.name = r.name.trim();
      this._save(); this._render();
      if (isDropbox && oldPath){
        const newPath = window.dropboxSync.buildPath(it, this._data.items, it.type === 'folder' ? '' : '.md');
        if (newPath && newPath !== oldPath) window.dropboxSync.movePath(oldPath, newPath);
      } else {
        this._syncAfter();
      }
    });
  },

  _deletePrompt(id){
    const it = this._data.items.find(x => x.id === id); if (!it) return;
    const isFolder = it.type === 'folder';
    const desc = isFolder ? 'Folder and ALL its contents' : 'File';
    showModal('Delete '+desc+'?', [], 'Delete '+it.name).then(r => {
      if (!r) return;
      // Compute the Dropbox path BEFORE mutating items[] — once the item
      // (and its parent chain) is removed, _buildPath can't walk it.
      // Folder deletes cascade server-side, so we only need the top-level
      // item's path.
      let dropboxPath = null;
      const isDropbox = this._view === 'dropbox' && window.dropboxSync && window.dropboxSync.isConfigured();
      if (isDropbox && window.dropboxSync.buildPath){
        dropboxPath = window.dropboxSync.buildPath(it, this._data.items, isFolder ? '' : '.md');
      }
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
      this._save(); this._render();
      if (isDropbox && dropboxPath){
        window.dropboxSync.deletePath(dropboxPath);
      } else {
        this._syncAfter();
      }
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
