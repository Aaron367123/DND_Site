// ============================================================
// LOOT TRACKER PANEL
// ============================================================
registerPanel('loot',{
  title:'Loot Tracker',icon:'💰',
  _loot:null,
  _view:'all',          // 'all' | 'byMember' | 'byGroup'
  _searchQ:'',          // current text in the name/search input
  _searchOpen:false,    // dropdown visibility
  mount(body){
    this._body=body;
    if(!this._loot){try{const r=localStorage.getItem('skt-loot-v1');this._loot=r?JSON.parse(r):{cp:0,sp:0,ep:0,gp:0,pp:0,items:[]};}catch(e){this._loot={cp:0,sp:0,ep:0,gp:0,pp:0,items:[]}}
    if(!this._loot.items)this._loot.items=[];
    // Migrate items to current shape: `claimed` → `assignedTo`, ensure `group`.
    this._loot.items.forEach(it => {
      if (it.assignedTo === undefined) it.assignedTo = null;
      if (it.group === undefined) it.group = '';
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
  // Distinct group names already in use, for the autocomplete datalist.
  _groupNames(){
    const set = new Set();
    (this._loot.items||[]).forEach(it => { if (it.group) set.add(it.group); });
    return [...set].sort();
  },
  _itemRow(item, i){
    const assignedName = this._memberName(item.assignedTo);
    return `<div class="loot-item ${item.assignedTo?'assigned':''}" data-i="${i}">
      <div class="loot-name">${esc(item.name)}${assignedName?` <span class="loot-assigned-pill">→ ${esc(assignedName)}</span>`:''}${item.group?` <span class="loot-group-pill">${esc(item.group)}</span>`:''}</div>
      <input type="number" class="loot-qty" value="${item.qty||1}" min="1" data-lfield="qty" data-li="${i}" title="Quantity">
      <input type="text" class="loot-val" value="${esc(item.value||'')}" data-lfield="value" data-li="${i}" placeholder="gp val" title="Value">
      <input type="text" class="loot-grp" list="loot-group-list" value="${esc(item.group||'')}" data-lfield="group" data-li="${i}" placeholder="Group" title="Group / category">
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
      ? {name:'Unassigned', icon:'❔'}
      : state.party.find(p => p.id === memberId);
    if (!member) return '<div class="empty-state">Member not found.</div>';
    const matched = [];
    this._loot.items.forEach((item, i) => {
      // Items assigned to a deleted/missing party member fall through to
      // "Unassigned" so they don't disappear from the UI entirely.
      const key = this._isAssignedTo(item.assignedTo) ? item.assignedTo : '__unassigned__';
      if (key === memberId) matched.push({item, idx:i});
    });
    if (!matched.length){
      return `<div class="empty-state">No items ${memberId==='__unassigned__'?'unassigned':'assigned to '+esc(member.name)}.</div>`;
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

  _renderByGroupView(){
    if (!this._loot.items.length) return '<div class="empty-state">No items yet. Add loot above.</div>';
    // Bucket items by their `group` field. Empty group → "Ungrouped".
    const groups = new Map();
    this._loot.items.forEach((item, i) => {
      const key = (item.group||'').trim() || '__ungrouped__';
      if (!groups.has(key)) groups.set(key, {name: key === '__ungrouped__' ? 'Ungrouped' : item.group, items: []});
      groups.get(key).items.push({item, idx:i});
    });
    // Stable order: named groups alphabetically, "Ungrouped" last.
    const sortedKeys = [...groups.keys()].sort((a, b) => {
      if (a === '__ungrouped__') return 1;
      if (b === '__ungrouped__') return -1;
      return a.localeCompare(b);
    });
    let out = '';
    sortedKeys.forEach(key => {
      const g = groups.get(key);
      const totalVal = g.items.reduce((sum, {item}) => {
        const q = parseInt(item.qty)||1;
        return sum + this._parseGp(item.value) * q;
      }, 0);
      out += `<div class="loot-group">
        <div class="loot-group-head">
          <span class="loot-group-icon">📦</span>
          <span class="loot-group-name">${esc(g.name)}</span>
          <span class="loot-group-meta">${g.items.length} item${g.items.length===1?'':'s'}${totalVal?` · ${totalVal.toFixed(2)} gp`:''}</span>
        </div>
        ${g.items.map(({item, idx}) => this._itemRow(item, idx)).join('')}
      </div>`;
    });
    return out;
  },

  // ── Add an item (manual or from search) ──────────────────────────────────────
  _addManualItem(){
    const b = this._body; if (!b) return;
    const nameInp = b.querySelector('#loot-new-name');
    const qtyInp  = b.querySelector('#loot-new-qty');
    const valInp  = b.querySelector('#loot-new-val');
    const grpInp  = b.querySelector('#loot-new-grp');
    const name = (nameInp?.value||'').trim();
    if (!name) { nameInp?.focus(); return; }
    const qty = Math.max(1, parseInt(qtyInp?.value)||1);
    const value = (valInp?.value||'').trim();
    const group = (grpInp?.value||'').trim();
    this._loot.items.push({id:uid(), name, qty, value, group, assignedTo:null});
    this._save();
    this._searchQ = ''; this._searchOpen = false;
    this._render();
  },

  _render(){
    const b=this._body;if(!b)return;
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
      <datalist id="loot-group-list">${this._groupNames().map(g=>`<option value="${esc(g)}">`).join('')}</datalist>
      <div class="loot-add-row">
        <div class="loot-search-wrap">
          <input type="text" id="loot-new-name" placeholder="Item name or 🔎 search 5e items..." autocomplete="off" value="${esc(this._searchQ)}">
          <div class="loot-search-dropdown" id="loot-search-results"></div>
        </div>
        <input type="number" id="loot-new-qty" value="1" min="1" placeholder="Qty">
        <input type="text" id="loot-new-val" placeholder="Value">
        <input type="text" id="loot-new-grp" list="loot-group-list" placeholder="Group">
        <button class="btn small primary" id="loot-add-item">Add</button>
      </div>
      <div class="loot-view-tabs">
        <button class="loot-view-tab ${view==='all'?'active':''}" data-view="all">All (${this._loot.items.length})</button>
        ${state.party.map(p => {
          const cnt = this._loot.items.filter(it => it.assignedTo === p.id).length;
          const key = 'member:'+p.id;
          return `<button class="loot-view-tab ${view===key?'active':''}" data-view="${esc(key)}" title="${esc(p.name)}">${esc(p.name)}${cnt?` <span class="loot-tab-count">${cnt}</span>`:''}</button>`;
        }).join('')}
        ${(() => {
          // Treat items assigned to a deleted member as unassigned for counting.
          const cnt = this._loot.items.filter(it => !this._isAssignedTo(it.assignedTo)).length;
          return `<button class="loot-view-tab ${view==='unassigned'?'active':''}" data-view="unassigned">Unassigned${cnt?` <span class="loot-tab-count">${cnt}</span>`:''}</button>`;
        })()}
        <button class="loot-view-tab ${view==='byGroup'?'active':''}" data-view="byGroup">By Group</button>
      </div>
      <div class="loot-items">
        ${(() => {
          if (view === 'byGroup') return this._renderByGroupView();
          if (view === 'unassigned') return this._renderMemberView('__unassigned__');
          if (view.startsWith('member:')) return this._renderMemberView(view.slice(7));
          return this._renderAllView();
        })()}
      </div>
    </div>`;

    // Coins
    ['cp','sp','ep','gp','pp'].forEach(c=>{b.querySelector(`#loot-${c}`).addEventListener('change',e=>{this._loot[c]=parseInt(e.target.value)||0;this._save();this._render();});});

    // View tabs
    b.querySelectorAll('.loot-view-tab').forEach(tab=>tab.addEventListener('click',()=>{
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

    // Item delete
    b.querySelectorAll('[data-lact]').forEach(el=>el.addEventListener('click',e=>{
      e.stopPropagation();
      if(el.dataset.lact==='del'){
        const i=+el.dataset.li;
        this._loot.items.splice(i,1);
        this._save();this._render();
      }
    }));

    // Field changes (qty, value, group, assignedTo)
    b.querySelectorAll('[data-lfield]').forEach(inp=>{
      inp.addEventListener('change', e => {
        const i=+e.target.dataset.li, f=e.target.dataset.lfield;
        let v = e.target.value;
        if (f==='qty') v = Math.max(1, parseInt(v)||1);
        else if (f==='assignedTo') v = v || null;
        else if (f==='group') v = (v||'').trim();
        this._loot.items[i][f]=v;
        this._save();
        // Re-render so pills / grouping / totals refresh.
        if (f==='assignedTo' || f==='qty' || f==='group') this._render();
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
  },
});
