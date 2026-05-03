// ============================================================
// BESTIARY PANEL — quick-access stat blocks
// ============================================================
// Folder grid of monster cards backed by 5etools data. Click a
// card to open the full stat block in a floating window. Monsters
// are added by searching the loaded 5e bestiary; HP/AC/CR are
// snapshotted onto the saved entry so cards render before the
// 5etools dataset finishes loading.

const BESTIARY_STORAGE_KEY = 'skt-bestiary-v1';
const BESTIARY_UNFILED = '__unfiled__';

function _bestInitials(name){
  return (name||'?').split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase().slice(0,2);
}

registerPanel('bestiary', {
  title:'Bestiary', icon:'🐲',
  _data:null, _searchQ:'', _loaded:false,

  mount(body){
    this._body = body;
    if (!this._data){
      try {
        const r = localStorage.getItem(BESTIARY_STORAGE_KEY);
        this._data = r ? JSON.parse(r) : null;
      } catch(e){ this._data = null; }
      if (!this._data) this._data = { folders:[], collapsed:{}, monsters:[] };
      if (!this._data.folders) this._data.folders = [];
      if (!this._data.collapsed) this._data.collapsed = {};
      if (!this._data.monsters) this._data.monsters = [];
    }
    this._render();
    // Kick off 5e data load and re-render the picker once available
    if (typeof load5eData === 'function' && !this._loaded){
      if (typeof on5eLoaded === 'function'){
        on5eLoaded(()=>{ this._loaded = true; if (this._body) this._render(); });
      }
      load5eData();
    }
  },
  unmount(){ this._body = null; },

  _save(){ try { localStorage.setItem(BESTIARY_STORAGE_KEY, JSON.stringify(this._data)); } catch(e){} },

  _render(){
    const b = this._body; if (!b) return;
    const q = this._searchQ.toLowerCase();
    const filterMon = m => !q || m.name.toLowerCase().includes(q) || (m.source||'').toLowerCase().includes(q);

    const folderSections = this._data.folders.map(f => {
      const monsters = this._data.monsters.filter(m => m.folderId === f.id).filter(filterMon);
      if (q && !monsters.length) return '';
      return this._renderFolder(f.id, f.name, monsters);
    });
    const unfiled = this._data.monsters.filter(m => !m.folderId).filter(filterMon);
    if (unfiled.length || (!q && !this._data.folders.length)) {
      folderSections.push(this._renderFolder(BESTIARY_UNFILED, 'Unfiled', unfiled));
    }

    const empty = !this._data.monsters.length && !this._data.folders.length;
    const ready = (typeof _5eLoaded !== 'undefined') && _5eLoaded;

    b.innerHTML = `<div class="bestiary-root">
      <div class="bestiary-toolbar">
        <input type="search" id="best-search" placeholder="🔎 Search bestiary..." value="${esc(this._searchQ)}">
        <button class="btn icon-btn" id="best-add-folder" title="New folder">📁+</button>
        <button class="btn primary small" id="best-add-monster" title="${ready?'Add monster':'Loading 5e data…'}" ${ready?'':'disabled'}>+ Add</button>
      </div>
      <div class="bestiary-body">
        ${empty
          ? `<div class="empty-state" style="padding:30px;text-align:center;color:var(--text-muted)">
              <div style="font-size:32px;margin-bottom:8px">🐲</div>
              <div>Click <strong>+ Add</strong> to put a monster in your bestiary.</div>
              ${ready?'':'<div style="font-size:11px;margin-top:6px;color:var(--text-dim)">Loading 5e data…</div>'}
            </div>`
          : folderSections.join('')}
      </div>
    </div>`;
    this._wire();
  },

  _renderFolder(id, name, monsters){
    const collapsed = this._data.collapsed[id] === true;
    const isUnfiled = id === BESTIARY_UNFILED;
    return `<div class="bestiary-folder" data-folder="${esc(id)}">
      <div class="bestiary-folder-head">
        <span class="caret">${collapsed?'▸':'▾'}</span>
        <span class="folder-name">${esc(name)}</span>
        <span class="folder-count">${monsters.length}</span>
        ${isUnfiled?'':`<button class="btn icon-btn folder-menu" title="Folder options" data-fmenu="${esc(id)}">⋯</button>`}
      </div>
      ${collapsed?'':`<div class="bestiary-grid">
        ${monsters.map(m => this._renderCard(m)).join('')}
      </div>`}
    </div>`;
  },

  _renderCard(m){
    // Prefer the small token image; fall back to full art, then to initials.
    const tokenSrc = m.img ? 'img/' + m.img.replace(/^bestiary\//, 'bestiary/tokens/') : null;
    const fullSrc  = m.img ? 'img/' + m.img : null;
    const img = m.img
      ? `<img src="${esc(tokenSrc)}" data-fb="${esc(fullSrc)}" alt="" onerror="if(this.dataset.fb){this.src=this.dataset.fb;this.removeAttribute('data-fb');}else{this.parentNode.textContent='${esc(_bestInitials(m.name))}';}">`
      : esc(_bestInitials(m.name));
    return `<div class="bestiary-card" data-mid="${esc(m.id)}" draggable="true" title="Click for stat block · Drag to combat tracker">
      <button class="bestiary-card-x" data-rmid="${esc(m.id)}" title="Remove from bestiary">×</button>
      <div class="bestiary-card-avatar">${img}</div>
      <div class="bestiary-card-name">${esc(m.name)}</div>
      <div class="bestiary-card-stats">
        <span title="HP">♥ ${m.hp||'?'}</span>
        <span title="AC">⛨ ${m.ac||'?'}</span>
        <span title="CR">CR ${esc(String(m.cr??'?'))}</span>
      </div>
    </div>`;
  },

  _wire(){
    const b = this._body; if (!b) return;

    b.querySelector('#best-search').addEventListener('input', e=>{
      this._searchQ = e.target.value;
      // Re-render only the body to preserve focus; rerender wholesale for simplicity
      const body = b.querySelector('.bestiary-body');
      const q = this._searchQ.toLowerCase();
      const filterMon = m => !q || m.name.toLowerCase().includes(q) || (m.source||'').toLowerCase().includes(q);
      const sections = this._data.folders.map(f => {
        const monsters = this._data.monsters.filter(m => m.folderId === f.id).filter(filterMon);
        if (q && !monsters.length) return '';
        return this._renderFolder(f.id, f.name, monsters);
      });
      const unfiled = this._data.monsters.filter(m => !m.folderId).filter(filterMon);
      if (unfiled.length) sections.push(this._renderFolder(BESTIARY_UNFILED, 'Unfiled', unfiled));
      body.innerHTML = sections.join('') || '<div class="empty-state" style="padding:30px;text-align:center;color:var(--text-muted)">No matches</div>';
    });

    b.querySelector('#best-add-folder').addEventListener('click', ()=>this._addFolder());
    const addBtn = b.querySelector('#best-add-monster');
    addBtn.addEventListener('click', ()=>{ if (!addBtn.disabled) this._openMonsterPicker(); });

    // Folder header: toggle collapse, options menu, rename
    b.querySelectorAll('.bestiary-folder-head').forEach(head=>{
      head.addEventListener('click', e=>{
        if (e.target.closest('.folder-menu')) return;
        const folder = head.parentElement.dataset.folder;
        this._data.collapsed[folder] = !this._data.collapsed[folder];
        this._save(); this._render();
      });
      head.addEventListener('contextmenu', e=>{
        const folder = head.parentElement.dataset.folder;
        if (folder === BESTIARY_UNFILED) return;
        e.preventDefault(); e.stopPropagation();
        this._showFolderMenu(e.clientX, e.clientY, folder);
      });
    });
    b.querySelectorAll('.folder-menu').forEach(btn=>{
      btn.addEventListener('click', e=>{
        e.stopPropagation();
        const r = btn.getBoundingClientRect();
        this._showFolderMenu(r.left, r.bottom, btn.dataset.fmenu);
      });
    });

    // Card click — open stat block; right-click — menu; dragstart — to combat or another folder
    b.querySelectorAll('.bestiary-card').forEach(card=>{
      card.addEventListener('click', e=>{
        // Skip if the user clicked the × button (handled separately).
        if (e.target.closest('.bestiary-card-x')) return;
        this._openStatBlock(card.dataset.mid);
      });
      card.addEventListener('contextmenu', e=>{
        e.preventDefault(); e.stopPropagation();
        this._showCardMenu(e.clientX, e.clientY, card.dataset.mid);
      });
      card.addEventListener('dragstart', e=>{
        e.dataTransfer.effectAllowed = 'copyMove';
        e.dataTransfer.setData('application/x-skt-bestiary-mid', card.dataset.mid);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', ()=>card.classList.remove('dragging'));
    });

    // Folder drop target — drag a monster card onto a folder to move it there.
    b.querySelectorAll('.bestiary-folder').forEach(folderEl => {
      const folderId = folderEl.dataset.folder;
      folderEl.addEventListener('dragover', e => {
        if (!e.dataTransfer.types.includes('application/x-skt-bestiary-mid')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        folderEl.classList.add('drop-target');
      });
      folderEl.addEventListener('dragleave', e => {
        // Only clear if we actually left the folder (not just moved over a child).
        if (!folderEl.contains(e.relatedTarget)) folderEl.classList.remove('drop-target');
      });
      folderEl.addEventListener('drop', e => {
        folderEl.classList.remove('drop-target');
        const mid = e.dataTransfer.getData('application/x-skt-bestiary-mid');
        if (!mid) return;
        e.preventDefault(); e.stopPropagation();
        const m = this._data.monsters.find(x=>x.id===mid); if (!m) return;
        // BESTIARY_UNFILED maps to folderId === null in the data model.
        const target = (folderId === BESTIARY_UNFILED) ? null : folderId;
        if (m.folderId === target) return; // no-op
        m.folderId = target;
        this._save();
        this._render();
      });
    });

    // × button on each card — visible on hover, removes the monster.
    b.querySelectorAll('.bestiary-card-x').forEach(btn=>{
      btn.addEventListener('click', e=>{
        e.stopPropagation();
        const mid = btn.dataset.rmid;
        const m = this._data.monsters.find(x=>x.id===mid); if (!m) return;
        showConfirm(`Remove "${m.name}" from the bestiary?`, {title:'Remove monster', confirmLabel:'Remove', danger:true}).then(ok=>{
          if(!ok) return;
          this._data.monsters = this._data.monsters.filter(x=>x.id!==mid);
          this._save();
          this._render();
        });
      });
    });
  },

  _addFolder(){
    showModal('New Folder', [
      {id:'name', label:'Folder name', type:'text', value:'', placeholder:'Boss fights, Forest, …'}
    ], 'Create').then(r=>{
      if (!r || !r.name) return;
      this._data.folders.push({id:uid(), name:r.name});
      this._save(); this._render();
    });
  },

  _showFolderMenu(x, y, folderId){
    const f = this._data.folders.find(x=>x.id===folderId); if (!f) return;
    showContextMenu(x, y, [
      {label:'Rename folder', onClick:()=>this._renameFolder(folderId)},
      {label:'Delete folder', onClick:()=>this._deleteFolder(folderId)},
    ]);
  },

  _renameFolder(folderId){
    const f = this._data.folders.find(x=>x.id===folderId); if (!f) return;
    showModal('Rename Folder', [
      {id:'name', label:'Folder name', type:'text', value:f.name}
    ], 'Save').then(r=>{
      if (!r || !r.name) return;
      f.name = r.name;
      this._save(); this._render();
    });
  },

  _deleteFolder(folderId){
    const f = this._data.folders.find(x=>x.id===folderId); if (!f) return;
    const count = this._data.monsters.filter(m=>m.folderId===folderId).length;
    const doDelete = () => {
      this._data.monsters.forEach(m=>{ if (m.folderId===folderId) m.folderId = null; });
      this._data.folders = this._data.folders.filter(x=>x.id!==folderId);
      delete this._data.collapsed[folderId];
      this._save(); this._render();
    };
    if (!count) return doDelete();
    showConfirm(`Delete "${f.name}"? Its ${count} monster(s) will move to Unfiled.`, {title:'Delete folder', confirmLabel:'Delete', danger:true}).then(ok=>{
      if (ok) doDelete();
    });
  },

  _showCardMenu(x, y, mid){
    const m = this._data.monsters.find(x=>x.id===mid); if (!m) return;
    const items = [{label:'Open stat block', onClick:()=>this._openStatBlock(mid)}];
    // Move-to submenu via flat list of folders
    if (this._data.folders.length){
      this._data.folders.forEach(f=>{
        if (f.id === m.folderId) return;
        items.push({label:'Move to: '+f.name, onClick:()=>{ m.folderId=f.id; this._save(); this._render(); }});
      });
      if (m.folderId) items.push({label:'Move to: Unfiled', onClick:()=>{ m.folderId=null; this._save(); this._render(); }});
    }
    items.push({label:'Remove from bestiary', onClick:()=>{
      this._data.monsters = this._data.monsters.filter(x=>x.id!==mid);
      this._save(); this._render();
    }});
    showContextMenu(x, y, items);
  },

  _openStatBlock(mid){
    const m = this._data.monsters.find(x=>x.id===mid); if (!m) return;
    let entry = null;
    if (typeof _5eData !== 'undefined' && _5eLoaded){
      entry = _5eData.find(d => d.cat==='monster' && d._slug === m.slug);
    }
    if (entry && typeof popOutDetail === 'function'){
      // Reuse the search popout — same header, image layout, source badge,
      // and "+ Add to combat" button users get from the search dropdown.
      popOutDetail(entry);
      return;
    }
    // Fallback before 5e data is loaded — show the saved snapshot.
    const html = `<div class="search-detail">
      <div class="detail-title-row"><h4 class="detail-title">${esc(m.name)}</h4></div>
      <div class="detail-meta">${esc(m.source||'')}</div>
      <div class="detail-stats">
        <div class="stat-block"><div class="lab">HP</div><div class="val">${m.hp||'?'}</div></div>
        <div class="stat-block"><div class="lab">AC</div><div class="val">${m.ac||'?'}</div></div>
        <div class="stat-block"><div class="lab">CR</div><div class="val">${esc(String(m.cr??'?'))}</div></div>
      </div>
      <div class="detail-section" style="color:var(--text-muted)">Full stat block will load once the 5e dataset finishes loading.</div>
    </div>`;
    const win = createFloatingWindow({ title: m.name, icon: '🐲', w: 380, h: 500 });
    win.body.innerHTML = html;
    win.body.style.padding = '12px';
    win.body.style.overflowY = 'auto';
  },

  _openMonsterPicker(){
    if (typeof _5eData === 'undefined' || !_5eLoaded){
      showToast?.('5e data still loading — try again in a moment');
      return;
    }
    const all = _5eData.filter(d => d.cat === 'monster')
      .sort((a,b)=>a.name.localeCompare(b.name));

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="width:520px;max-width:90vw">
      <h3>Add Monster</h3>
      <input type="search" id="best-pick-search" placeholder="🔎 Search 5e monsters…" autocomplete="off"
        style="width:100%;background:var(--panel-2);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:5px;font-size:12px;margin-bottom:10px">
      ${this._data.folders.length ? `<div class="modal-field" style="margin-bottom:10px">
        <label>Folder</label>
        <select id="best-pick-folder">
          <option value="">Unfiled</option>
          ${this._data.folders.map(f=>`<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('')}
        </select>
      </div>` : ''}
      <div id="best-pick-list" style="max-height:380px;overflow-y:auto;border:1px solid var(--border);border-radius:5px;background:var(--panel-2)"></div>
      <div class="modal-actions"><button class="btn" id="best-pick-close">Close</button></div>
    </div>`;
    document.body.appendChild(backdrop);

    const list = backdrop.querySelector('#best-pick-list');
    const folderSel = backdrop.querySelector('#best-pick-folder');
    const renderList = (q)=>{
      const qn = (q||'').toLowerCase().trim();
      const pool = qn
        ? all.filter(d => d.name.toLowerCase().includes(qn) || (d.meta||'').toLowerCase().includes(qn) || (d._source||'').toLowerCase().includes(qn) || (_formatSource(d._source)||'').toLowerCase().includes(qn)).slice(0,200)
        : all.slice(0,200);
      list.innerHTML = pool.map(d => `<div class="bestiary-pick-row" data-slug="${esc(d._slug)}">
        <div class="bestiary-pick-left">
          <span class="bestiary-pick-name">${esc(d.name)}</span>
          ${d._source ? `<span class="detail-source-badge">${esc(_formatSource(d._source))}</span>` : ''}
        </div>
        <span class="bestiary-pick-meta">${esc(d.meta||'')}</span>
      </div>`).join('') || '<div style="padding:14px;text-align:center;color:var(--text-muted);font-size:12px">No matches</div>';
    };
    renderList('');

    const close = ()=>backdrop.remove();
    backdrop.querySelector('#best-pick-search').addEventListener('input', e=>renderList(e.target.value));
    backdrop.querySelector('#best-pick-close').addEventListener('click', close);
    backdrop.addEventListener('mousedown', e=>{ if (e.target===backdrop) close(); });
    backdrop.addEventListener('keydown', e=>{ if (e.key==='Escape') close(); });
    list.addEventListener('click', e=>{
      const row = e.target.closest('.bestiary-pick-row'); if (!row) return;
      const slug = row.dataset.slug;
      const d = all.find(x=>x._slug===slug); if (!d) return;
      const folderId = folderSel ? (folderSel.value || null) : null;
      this._data.monsters.push({
        id: uid(),
        folderId,
        slug: d._slug,
        name: d.name,
        source: d._source || '',
        hp: d.hp,
        ac: d.ac,
        cr: d._raw?.challenge_rating ?? '?',
        img: d._img || null,
      });
      this._save();
      close();
      this._render();
    });
    setTimeout(()=>backdrop.querySelector('#best-pick-search').focus(), 30);
  },
});
