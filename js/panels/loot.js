// ============================================================
// LOOT TRACKER PANEL
// ============================================================
registerPanel('loot',{
  title:'Loot Tracker',icon:'💰',
  _loot:null,
  _view:'all',          // 'all' | 'member:<id>' | 'unassigned' | 'tabgroup:<id>'
  _searchQ:'',          // current text in the name/search input
  _searchOpen:false,    // dropdown visibility
  mount(body){
    this._body=body;
    if(!this._loot){try{const r=localStorage.getItem('skt-loot-v1');this._loot=r?JSON.parse(r):{cp:0,sp:0,ep:0,gp:0,pp:0,items:[],tabGroups:[]};}catch(e){this._loot={cp:0,sp:0,ep:0,gp:0,pp:0,items:[],tabGroups:[]}}
    if(!this._loot.items)this._loot.items=[];
    if(!Array.isArray(this._loot.tabGroups))this._loot.tabGroups=[];
    // Migrate items to current shape: `claimed` → `assignedTo`. Drop the old
    // `group` text-tag field that no longer exists in the UI.
    this._loot.items.forEach(it => {
      if (it.assignedTo === undefined) it.assignedTo = null;
      if ('group' in it) delete it.group;
    });}
    this._render();
    // Refresh the dropdown once 5e data finishes loading so suggestions appear
    // even if the user opened the panel before the load completed.
    if (typeof on5eLoaded === 'function') on5eLoaded(() => { if (this._body) this._renderSearchDropdown(); });
    if (typeof load5eData === 'function') load5eData();
  },
  unmount(){this._body=null;},
  _save(){try{localStorage.setItem('skt-loot-v1',JSON.stringify(this._loot));}catch(e){}},

  _memberName(id){
    if (!id) return null;
    const p = state.party.find(p => p.id === id);
    return p ? p.name : null;
  },

  // ── 5e item search ───────────────────────────────────────────────────────────
  _searchItems(q){
    if (!q || typeof _5eLoaded === 'undefined' || !_5eLoaded || !Array.isArray(_5eData)) return [];
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (name, meta) =>
      tokens.every(t => (name+' '+(meta||'')).toLowerCase().includes(t));
    const out = [];
    for (const d of _5eData){
      if (d.cat !== 'item') continue;
      if (matches(d.name, d.meta)) out.push({name:d.name, meta:d.meta, _source:d._source, value:d._raw?.value || ''});
      // Items with bonus variants (+1, +2, +3) — include each variant as its
      // own selectable row so the user can drop "+2 Longsword" directly
      // into loot without having to retype the prefix.
      if (d._variants){
        for (const v of d._variants){
          if (matches(v.name, v.meta)) out.push({name:v.name, meta:v.meta, _source:v._source||d._source, value:v._raw?.value || ''});
        }
      }
      if (out.length >= 20) break;
    }
    return out.slice(0, 20);
  },

  _renderSearchDropdown(){
    const b = this._body; if (!b) return;
    const drop = b.querySelector('#loot-search-results'); if (!drop) return;
    const results = this._searchQ ? this._searchItems(this._searchQ) : [];
    const open = this._searchOpen && results.length;
    drop.classList.toggle('open', !!open);
    if (!open) { drop.innerHTML = ''; return; }
    drop.innerHTML = results.map(d => {
      const srcDisplay = d._source && typeof _formatSource === 'function' ? _formatSource(d._source) : (d._source||'');
      const srcBadge = srcDisplay ? `<span class="loot-search-src">${esc(srcDisplay)}</span>` : '';
      const metaText = [d.meta, d.value].filter(Boolean).join(' · ');
      return `<div class="loot-search-result" data-iname="${esc(d.name)}" data-isrc="${esc(d._source||'')}" data-ival="${esc(d.value||'')}">
        <span class="loot-search-name">${esc(d.name)}${srcBadge}</span>
        <span class="loot-search-meta">${esc(metaText)}</span>
      </div>`;
    }).join('');
    drop.querySelectorAll('.loot-search-result').forEach(el => el.addEventListener('click', () => {
      const name = el.dataset.iname;
      // Prefer the qty already typed by the user; default to 1.
      const qtyInp = b.querySelector('#loot-new-qty');
      const valInp = b.querySelector('#loot-new-val');
      const qty = parseInt(qtyInp?.value)||1;
      // Value priority: user-typed value > 5e item's listed value > empty.
      const typed = (valInp?.value||'').trim();
      const value = typed || (el.dataset.ival || '');
      this._loot.items.push({id:uid(), name, qty, value, assignedTo:null});
      this._save();
      this._searchQ = ''; this._searchOpen = false;
      this._render();
    }));
  },

  // ── List rendering ───────────────────────────────────────────────────────────
  _assignSelect(item, idx){
    const opts = ['<option value="">— Unassigned —</option>']
      .concat(state.party.map(p => `<option value="${esc(p.id)}"${item.assignedTo===p.id?' selected':''}>${esc(p.name)}</option>`));
    return `<select class="loot-assign" data-lfield="assignedTo" data-li="${idx}" title="Assign to party member">${opts.join('')}</select>`;
  },
  // ── Drag-to-reorder ──────────────────────────────────────────────────────
  // Wires HTML5 drag events on every visible item row so the user can drag a
  // row up or down to change its position in the underlying items list. Works
  // in any view (All / per-member / per-group / custom-tab) because every row
  // carries its absolute index in `data-i`.
  _wireRowDrag(){
    const b = this._body; if (!b) return;
    b.querySelectorAll('.loot-item').forEach(row => {
      row.addEventListener('dragstart', e => {
        // Don't start a drag if the user grabbed an editable control —
        // they're trying to interact with it, not move the row.
        if (e.target.closest('input,select,textarea,button')) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-skt-loot-idx', row.dataset.i);
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        b.querySelectorAll('.loot-item.drop-before,.loot-item.drop-after')
          .forEach(el => el.classList.remove('drop-before','drop-after'));
      });
      row.addEventListener('dragover', e => {
        if (!e.dataTransfer.types.includes('application/x-skt-loot-idx')) return;
        e.preventDefault();
        const r = row.getBoundingClientRect();
        const before = e.clientY < r.top + r.height/2;
        row.classList.toggle('drop-before', before);
        row.classList.toggle('drop-after', !before);
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('drop-before','drop-after');
      });
      row.addEventListener('drop', e => {
        const fromStr = e.dataTransfer.getData('application/x-skt-loot-idx');
        if (!fromStr) return;
        e.preventDefault();
        const from = parseInt(fromStr);
        const targetIdx = parseInt(row.dataset.i);
        row.classList.remove('drop-before','drop-after');
        if (isNaN(from) || isNaN(targetIdx) || from === targetIdx) return;
        const r = row.getBoundingClientRect();
        const before = e.clientY < r.top + r.height/2;
        let insertAt = before ? targetIdx : targetIdx + 1;
        // Removing the source first shifts every later index down by one.
        if (from < insertAt) insertAt--;
        const arr = this._loot.items;
        const [moved] = arr.splice(from, 1);
        arr.splice(insertAt, 0, moved);
        this._save();
        this._render();
      });
    });
  },

  // ── Custom tab groups (named bundles of party members) ────────────────────
  _findTabGroup(id){ return (this._loot.tabGroups||[]).find(g => g.id === id) || null; },
  // Items belonging to this tab group: those assigned to any of its members.
  _itemsForTabGroup(group){
    const set = new Set(group.memberIds||[]);
    const out = [];
    this._loot.items.forEach((item, i) => { if (set.has(item.assignedTo)) out.push({item, idx:i}); });
    return out;
  },
  _renderTabGroupView(groupId){
    const g = this._findTabGroup(groupId);
    if (!g) return '<div class="empty-state">Group not found.</div>';
    const matched = this._itemsForTabGroup(g);
    if (!matched.length){
      return `<div class="empty-state">No items assigned to anyone in <strong>${esc(g.name)}</strong> yet.</div>`;
    }
    const totalVal = matched.reduce((sum, {item}) => {
      const q = parseInt(item.qty)||1;
      return sum + this._parseGp(item.value) * q;
    }, 0);
    return `<div class="loot-group">
      <div class="loot-group-head">
        <span class="loot-group-icon">👥</span>
        <span class="loot-group-name">${esc(g.name)}</span>
        <span class="loot-group-meta">${matched.length} item${matched.length===1?'':'s'}${totalVal?` · ${totalVal.toFixed(2)} gp`:''}</span>
      </div>
      ${matched.map(({item, idx}) => this._itemRow(item, idx)).join('')}
    </div>`;
  },

  // Modal: create or edit a tab group. Pass groupId to edit, or null to create.
  _openTabGroupModal(groupId){
    const editing = groupId ? this._findTabGroup(groupId) : null;
    const initialName = editing?.name || '';
    const initialMembers = new Set(editing?.memberIds || []);

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const memberRows = state.party.length
      ? state.party.map(p => `
          <label class="cg-member">
            <input type="checkbox" data-pid="${esc(p.id)}" ${initialMembers.has(p.id)?'checked':''}>
            <span>${esc(p.name)}</span>
          </label>`).join('')
      : '<div style="font-size:11px;color:var(--text-muted)">Add party members in the Party panel first.</div>';

    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="width:380px;max-width:92vw">
      <h3>${editing?'Edit Custom Tab':'New Custom Tab'}</h3>
      <div class="modal-fields">
        <div class="modal-field">
          <label>Tab name</label>
          <input id="cg-name" type="text" value="${esc(initialName)}" placeholder="e.g. Frontline" autocomplete="off">
        </div>
        <div class="modal-field">
          <label>Members in this tab</label>
          <div class="cg-members">${memberRows}</div>
        </div>
      </div>
      <div class="modal-actions" style="display:flex;gap:6px;justify-content:flex-end;margin-top:14px">
        ${editing ? '<button class="btn danger" id="cg-del" style="margin-right:auto">Delete</button>' : ''}
        <button class="btn" id="cg-cancel">Cancel</button>
        <button class="btn primary" id="cg-save">${editing?'Save':'Create'}</button>
      </div>
    </div>`;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    setTimeout(()=> backdrop.querySelector('#cg-name')?.focus(), 30);

    const saveAction = () => {
      const name = (backdrop.querySelector('#cg-name')?.value||'').trim();
      if (!name){ backdrop.querySelector('#cg-name')?.focus(); return; }
      const memberIds = [...backdrop.querySelectorAll('.cg-members input[type=checkbox]:checked')]
        .map(cb => cb.dataset.pid);
      if (editing){
        editing.name = name;
        editing.memberIds = memberIds;
      } else {
        const id = 'tg_' + (typeof uid==='function' ? uid() : Math.random().toString(36).slice(2,10));
        this._loot.tabGroups.push({ id, name, memberIds });
        this._view = 'tabgroup:'+id;
      }
      this._save();
      close();
      this._render();
    };
    backdrop.querySelector('#cg-save').addEventListener('click', saveAction);
    backdrop.querySelector('#cg-cancel').addEventListener('click', close);
    backdrop.querySelector('#cg-del')?.addEventListener('click', () => {
      this._loot.tabGroups = this._loot.tabGroups.filter(g => g.id !== editing.id);
      if (this._view === 'tabgroup:'+editing.id) this._view = 'all';
      this._save();
      close();
      this._render();
    });
    backdrop.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type === 'text'){
        e.preventDefault(); saveAction();
      } else if (e.key === 'Escape') close();
    });
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
  },

  // Find the matching 5e item entry for a given user-typed loot name. Tries
  // an exact match against the top-level item list AND any of its bonus
  // variants (+1/+2/+3) so "+1 Longsword" finds the Longsword entry.
  _findFiveItem(name){
    if (typeof _5eLoaded === 'undefined' || !_5eLoaded || !Array.isArray(_5eData)) return null;
    const lower = (name||'').trim().toLowerCase();
    if (!lower) return null;
    for (const d of _5eData){
      if (d.cat !== 'item') continue;
      if (d.name.toLowerCase() === lower) return d;
      if (d._variants){
        for (const v of d._variants){
          if (v.name && v.name.toLowerCase() === lower) return d;
        }
      }
    }
    return null;
  },

  // Open the same detail popout the global search uses. Falls back to a tiny
  // toast for custom items the 5e library doesn't know about.
  _openItemDetail(idx){
    const item = this._loot.items[idx]; if (!item) return;
    const match = this._findFiveItem(item.name);
    if (match && typeof popOutDetail === 'function'){
      popOutDetail(match);
      return;
    }
    if (typeof showToast === 'function'){
      showToast(`No 5e entry for "${item.name}" — custom item.`);
    }
  },

  _itemRow(item, i){
    const assignedName = this._memberName(item.assignedTo);
    return `<div class="loot-item ${item.assignedTo?'assigned':''}" data-i="${i}" draggable="true">
      <span class="loot-drag-handle" title="Drag to reorder">⋮⋮</span>
      <div class="loot-name">
        <button class="loot-info-btn" data-lact="info" data-li="${i}" title="View item details">📖</button>
        <input class="loot-name-input" type="text" value="${esc(item.name)}" data-lfield="name" data-li="${i}" title="Click to rename" spellcheck="false">
        ${assignedName?`<span class="loot-assigned-pill">→ ${esc(assignedName)}</span>`:''}
      </div>
      <input type="number" class="loot-qty" value="${item.qty||1}" min="1" data-lfield="qty" data-li="${i}" title="Quantity">
      <input type="text" class="loot-val" value="${esc(item.value||'')}" data-lfield="value" data-li="${i}" placeholder="gp val" title="Value">
      ${this._assignSelect(item, i)}
      <button class="btn icon-btn danger" data-lact="del" data-li="${i}" title="Remove">×</button>
    </div>`;
  },

  // Free-form "10 gp" / "50 sp" / "200 cp" → numeric gp. Shared between the
  // per-member and per-group totals.
  _parseGp(s){
    const str = String(s||'').toLowerCase().trim();
    if (!str) return 0;
    const num = parseFloat(str.replace(/[^\d.-]/g,''));
    if (isNaN(num)) return 0;
    if (/\bcp\b/.test(str)) return num / 100;
    if (/\bsp\b/.test(str)) return num / 10;
    if (/\bep\b/.test(str)) return num / 2;
    if (/\bpp\b/.test(str)) return num * 10;
    return num;
  },
  _renderAllView(){
    if (!this._loot.items.length) return '<div class="empty-state">No items yet. Add loot above.</div>';
    return this._loot.items.map((item,i)=>this._itemRow(item,i)).join('');
  },
  // True if this assignedTo value still points at a current party member.
  _isAssignedTo(assignedTo){
    return !!assignedTo && state.party.some(p => p.id === assignedTo);
  },
  // One-member view: just the rows assigned to that member, with a header
  // showing the count + total gp value.
  _renderMemberView(memberId){
    const member = memberId === '__unassigned__'
      ? {name:'Group (shared loot)', icon:'📦'}
      : state.party.find(p => p.id === memberId);
    if (!member) return '<div class="empty-state">Member not found.</div>';
    const matched = [];
    this._loot.items.forEach((item, i) => {
      // Items assigned to a deleted/missing party member fall through to the
      // shared/group bucket so they don't disappear from the UI entirely.
      const key = this._isAssignedTo(item.assignedTo) ? item.assignedTo : '__unassigned__';
      if (key === memberId) matched.push({item, idx:i});
    });
    if (!matched.length){
      return `<div class="empty-state">${memberId==='__unassigned__'?'No shared/group loot — all items are assigned.':'No items assigned to '+esc(member.name)+'.'}</div>`;
    }
    const totalVal = matched.reduce((sum, {item}) => {
      const q = parseInt(item.qty)||1;
      return sum + this._parseGp(item.value) * q;
    }, 0);
    const icon = member.icon || '👤';
    const iconHtml = typeof icon === 'string' && icon.startsWith('data:')
      ? `<img src="${esc(icon)}">` : esc(icon);
    return `<div class="loot-group">
      <div class="loot-group-head">
        <span class="loot-group-icon">${iconHtml}</span>
        <span class="loot-group-name">${esc(member.name)}</span>
        <span class="loot-group-meta">${matched.length} item${matched.length===1?'':'s'}${totalVal?` · ${totalVal.toFixed(2)} gp`:''}</span>
      </div>
      ${matched.map(({item, idx}) => this._itemRow(item, idx)).join('')}
    </div>`;
  },

  // ── Add an item (manual or from search) ──────────────────────────────────────
  _addManualItem(){
    const b = this._body; if (!b) return;
    const nameInp = b.querySelector('#loot-new-name');
    const qtyInp  = b.querySelector('#loot-new-qty');
    const valInp  = b.querySelector('#loot-new-val');
    const name = (nameInp?.value||'').trim();
    if (!name) { nameInp?.focus(); return; }
    const qty = Math.max(1, parseInt(qtyInp?.value)||1);
    const value = (valInp?.value||'').trim();
    this._loot.items.push({id:uid(), name, qty, value, assignedTo:null});
    this._save();
    this._searchQ = ''; this._searchOpen = false;
    this._render();
  },

  _render(){
    const b=this._body;if(!b)return;
    // Snapshot the items-list scroll position before innerHTML wipes the DOM,
    // so editing qty/assignment (which triggers a re-render) doesn't fling
    // the user back to the top of the list.
    const oldList = b.querySelector('.loot-items');
    const savedScroll = oldList ? oldList.scrollTop : 0;
    const totalGp=((this._loot.cp||0)/100+(this._loot.sp||0)/10+(this._loot.ep||0)/2+(this._loot.gp||0)+(this._loot.pp||0)*10).toFixed(2);
    const view = this._view;
    b.innerHTML=`<div class="loot-panel">
      <div class="loot-summary">
        ${['cp','sp','ep','gp','pp'].map(c=>`<div class="loot-coin"><div class="l">${c.toUpperCase()}</div><input type="number" id="loot-${c}" value="${this._loot[c]||0}" min="0"></div>`).join('')}
      </div>
      <div style="padding:6px 10px;border-bottom:1px solid var(--border);font-size:11px;color:var(--text-muted)">
        Total: <strong style="color:var(--warning)">${totalGp} gp</strong> equivalent &nbsp;·&nbsp;
        Per party member: <strong style="color:var(--warning)">${state.party.length?(totalGp/state.party.length).toFixed(2):totalGp} gp</strong>
        <button class="btn small" id="loot-divvy" style="float:right;margin-top:-2px">Divvy up</button>
      </div>
      <div class="loot-add-row">
        <div class="loot-search-wrap">
          <input type="text" id="loot-new-name" placeholder="Item name or 🔎 search 5e items..." autocomplete="off" value="${esc(this._searchQ)}">
          <div class="loot-search-dropdown" id="loot-search-results"></div>
        </div>
        <input type="number" id="loot-new-qty" value="1" min="1" placeholder="Qty">
        <input type="text" id="loot-new-val" placeholder="Value">
        <button class="btn small primary" id="loot-add-item">Add</button>
      </div>
      <div class="loot-view-tabs">
        <button class="loot-view-tab ${view==='all'?'active':''}" data-view="all" title="All items">All${this._loot.items.length?` <span class="loot-tab-count">${this._loot.items.length}</span>`:''}</button>
        ${state.party.map(p => {
          const cnt = this._loot.items.filter(it => it.assignedTo === p.id).length;
          const key = 'member:'+p.id;
          // Trim long names down to just the first word ("Zindle 'Deathwhistle'
          // Farrago" → "Zindle"). Full name lives on the title attribute.
          const short = (p.name||'').split(/\s+/)[0] || p.name;
          const icon = p.icon || '👤';
          const iconHtml = typeof icon==='string' && icon.startsWith('data:')
            ? `<img class="loot-tab-icon" src="${esc(icon)}">`
            : `<span class="loot-tab-icon emoji">${esc(icon)}</span>`;
          return `<button class="loot-view-tab ${view===key?'active':''}" data-view="${esc(key)}" title="${esc(p.name)}">${iconHtml}<span class="loot-tab-name">${esc(short)}</span>${cnt?`<span class="loot-tab-count">${cnt}</span>`:''}</button>`;
        }).join('')}
        ${(this._loot.tabGroups||[]).map(g => {
          const cnt = this._itemsForTabGroup(g).length;
          const key = 'tabgroup:'+g.id;
          return `<button class="loot-view-tab tabgroup ${view===key?'active':''}" data-view="${esc(key)}" title="${esc(g.name)} — ${(g.memberIds||[]).length} member(s)">
            <span class="loot-tab-icon emoji">👥</span>
            <span class="loot-tab-name">${esc(g.name)}</span>
            ${cnt?`<span class="loot-tab-count">${cnt}</span>`:''}
            <span class="loot-tab-edit" data-tg-edit="${esc(g.id)}" title="Edit tab">⚙</span>
          </button>`;
        }).join('')}
        <button class="loot-view-tab loot-tab-add" data-tg-add="1" title="Create a custom tab grouping party members"><span class="loot-tab-icon emoji">＋</span><span class="loot-tab-name">Tab</span></button>
        ${(() => {
          // "Group" tab = shared / unassigned loot (treats items pointing at a
          // deleted party member as unassigned too).
          const cnt = this._loot.items.filter(it => !this._isAssignedTo(it.assignedTo)).length;
          return `<button class="loot-view-tab ${view==='unassigned'?'active':''}" data-view="unassigned" title="Shared / group loot"><span class="loot-tab-icon emoji">📦</span><span class="loot-tab-name">Group</span>${cnt?`<span class="loot-tab-count">${cnt}</span>`:''}</button>`;
        })()}
      </div>
      <div class="loot-items">
        ${(() => {
          if (view === 'unassigned') return this._renderMemberView('__unassigned__');
          if (view.startsWith('member:')) return this._renderMemberView(view.slice(7));
          if (view.startsWith('tabgroup:')) return this._renderTabGroupView(view.slice(9));
          return this._renderAllView();
        })()}
      </div>
    </div>`;

    // Coins
    ['cp','sp','ep','gp','pp'].forEach(c=>{b.querySelector(`#loot-${c}`).addEventListener('change',e=>{this._loot[c]=parseInt(e.target.value)||0;this._save();this._render();});});

    // View tabs — including the "+ Tab" button (opens new-group modal) and the
    // ⚙ icon inside each custom-tab chip (opens the edit modal for that tab).
    b.querySelectorAll('.loot-view-tab').forEach(tab=>tab.addEventListener('click',e=>{
      // ⚙ edit click — handle first so it doesn't also switch tabs.
      const editBadge = e.target.closest('[data-tg-edit]');
      if (editBadge){
        e.stopPropagation();
        this._openTabGroupModal(editBadge.dataset.tgEdit);
        return;
      }
      if (tab.dataset.tgAdd){
        this._openTabGroupModal(null);
        return;
      }
      this._view = tab.dataset.view; this._render();
    }));

    // Add (manual / Enter on name input)
    b.querySelector('#loot-add-item').addEventListener('click', () => this._addManualItem());

    // Search input — only update dropdown on input/focus so the input keeps focus.
    const nameInp = b.querySelector('#loot-new-name');
    nameInp.addEventListener('input', e => {
      this._searchQ = e.target.value;
      this._searchOpen = true;
      this._renderSearchDropdown();
    });
    nameInp.addEventListener('focus', () => {
      this._searchOpen = true;
      this._renderSearchDropdown();
    });
    nameInp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // If dropdown has results, pick the first; otherwise add as manual.
        const first = b.querySelector('#loot-search-results.open .loot-search-result');
        if (first) first.click();
        else this._addManualItem();
      } else if (e.key === 'Escape') {
        this._searchOpen = false;
        this._renderSearchDropdown();
      }
    });
    // Close dropdown when the input loses focus. Delay so a click on a
    // dropdown result registers before the dropdown disappears.
    nameInp.addEventListener('blur', () => {
      setTimeout(() => {
        if (this._searchOpen) { this._searchOpen = false; this._renderSearchDropdown(); }
      }, 180);
    });

    // Initial dropdown paint (handles re-render after picking from dropdown)
    if (this._searchQ && this._searchOpen) this._renderSearchDropdown();

    // Item actions: delete + info popup
    b.querySelectorAll('[data-lact]').forEach(el=>el.addEventListener('click',e=>{
      e.stopPropagation();
      const i=+el.dataset.li;
      if(el.dataset.lact==='del'){
        this._loot.items.splice(i,1);
        this._save();this._render();
      } else if (el.dataset.lact==='info'){
        this._openItemDetail(i);
      }
    }));

    // Field changes (name, qty, value, assignedTo)
    b.querySelectorAll('[data-lfield]').forEach(inp=>{
      inp.addEventListener('change', e => {
        const i=+e.target.dataset.li, f=e.target.dataset.lfield;
        let v = e.target.value;
        if (f==='qty') v = Math.max(1, parseInt(v)||1);
        else if (f==='assignedTo') v = v || null;
        else if (f==='name'){
          const trimmed = String(v||'').trim();
          // Empty name → restore the old value rather than persisting blank.
          if (!trimmed){ e.target.value = this._loot.items[i].name; return; }
          v = trimmed;
        }
        this._loot.items[i][f]=v;
        this._save();
        // Re-render so pills / counts / totals refresh.
        if (f==='assignedTo' || f==='qty') this._render();
      });
    });
    // Enter on the name input commits + moves focus off (so it feels like a
    // proper rename); Escape restores the previous value.
    b.querySelectorAll('.loot-name-input').forEach(inp=>{
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter'){ e.preventDefault(); inp.blur(); }
        else if (e.key === 'Escape'){
          const i = +inp.dataset.li;
          inp.value = this._loot.items[i].name;
          inp.blur();
        }
      });
    });

    // Divvy
    b.querySelector('#loot-divvy').addEventListener('click',()=>{
      const n=state.party.length;if(!n){showToast('No party members');return;}
      const each=(parseFloat(totalGp)/n).toFixed(2);
      const rows = state.party.map(p =>
        `<div class="divvy-row"><span>${esc(p.name)}</span><span class="divvy-amt">${each} gp</span></div>`
      ).join('');
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="min-width:300px">
        <h3>Divvy up loot</h3>
        <p style="color:var(--text-muted);font-size:11px;margin:0 0 10px">
          <strong style="color:var(--accent)">${totalGp} gp</strong> split between
          <strong>${n}</strong> party member${n===1?'':'s'} —
          <strong style="color:var(--accent)">${each} gp</strong> each.
        </p>
        <div class="divvy-list">${rows}</div>
        <div class="modal-actions" style="margin-top:14px"><button class="btn primary" id="divvy-ok">Done</button></div>
      </div>`;
      document.body.appendChild(backdrop);
      const close = () => backdrop.remove();
      backdrop.querySelector('#divvy-ok').addEventListener('click', close);
      backdrop.addEventListener('mousedown', e => { if (e.target===backdrop) close(); });
      backdrop.addEventListener('keydown', e => { if (e.key==='Escape') close(); });
      setTimeout(()=>backdrop.querySelector('#divvy-ok')?.focus(), 30);
    });

    // Drag-to-reorder on every item row.
    this._wireRowDrag();

    // Restore the items-list scroll position after the new DOM is wired up,
    // so re-renders (qty / assignment change) feel in-place.
    const newList = b.querySelector('.loot-items');
    if (newList) newList.scrollTop = savedScroll;
  },
});
