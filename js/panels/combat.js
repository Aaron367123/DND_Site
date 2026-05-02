// ============================================================
// COMBAT PANEL
// ============================================================
// Card-based tracker. Order is manually controlled by the user
// (drag to reorder), not auto-sorted by initiative. Bestiary cards
// can be dragged into the panel to add monsters; monster cards
// show a duplicate button beneath the delete button so groups of
// the same creature can be added quickly.

registerPanel('combat',{
  title:'Combat Tracker',icon:'⚔',
  mount(body){this._body=body;this._render();},
  unmount(){this._body=null;},

  _render(){
    const b=this._body;if(!b)return;
    const inCombat=state.combatants.length>0;
    b.innerHTML=`
      <div class="combat-controls">
        <button class="btn icon-btn" data-act="next" title="Advance turn">▶</button>
        <button class="btn icon-btn" data-act="add" title="Add custom combatant">+</button>
        <button class="btn icon-btn" data-act="add-monster" title="Add monster from bestiary">🐲</button>
        ${inCombat?`<span class="round-display">Round ${state.combatRound||1}</span>`:''}
        <span style="flex:1"></span>
        <button class="btn icon-btn" data-act="player-view" title="Open player view">🖥</button>
        <button class="btn icon-btn" data-act="settings" title="Manage quick-pick names">⚙</button>
      </div>

      ${inCombat ? '<div class="combatant-list" id="combat-list">'+this._renderCombatants()+'</div>' : ''}

      <div class="combat-section-label">Party</div>
      <div class="combatant-list" id="party-list">${this._renderParty()}</div>

      <div class="combat-droptip" id="combat-droptip">Drag a monster from the Bestiary to add it</div>`;
    this._wire();
  },

  _renderCombatants(){
    return state.combatants.map((c,i)=>this._renderCard(c,i,false)).join('');
  },

  _renderParty(){
    if(!state.party.length) return '<div class="empty-state" style="padding:12px">No party members yet — add them in the Party Tracker.</div>';
    return state.party.map((p,i)=>{
      const inCombat=state.combatants.find(c=>c.isPC&&c.id===p.id);
      const icon=renderIcon(p.icon||'⚔', p.name);
      return `<div class="combatant-card party-row pc ${inCombat?'in-combat':''}">
        <div class="card-avatar pc">${icon}</div>
        <div class="card-body">
          <div class="card-name">${esc(p.name)}${inCombat?' <span class="in-combat-pill">IN COMBAT</span>':''}</div>
          <div class="card-stats">
            <div class="card-stat" title="HP"><span class="lab">♥</span><input type="number" value="${p.hp}" data-pi="${i}" data-pf="hp"></div>
            <div class="card-stat" title="AC"><span class="lab">⛨</span><input type="number" value="${p.ac}" data-pi="${i}" data-pf="ac"></div>
            <div class="card-stat" title="Init bonus"><span class="lab">⚡</span><input type="number" value="${p.init||0}" data-pi="${i}" data-pf="init"></div>
          </div>
        </div>
        <div class="card-actions">
          ${inCombat
            ? `<button class="btn icon-btn danger" data-act="remove-pc" data-pid="${inCombat.id}" title="Remove from combat">×</button>`
            : `<button class="btn icon-btn" data-act="add-pc" data-pi="${i}" title="Add to combat">+</button>`}
        </div>
      </div>`;
    }).join('');
  },

  _renderCard(c, i, isParty){
    const active = c.id === state.activeCombatantId;
    const dead = c.hp <= 0;
    const isPC = c.isPC;
    const portrait = c.portrait
      || (isPC ? (state.party.find(p=>p.id===c.id)?.icon || '⚔')
               : (CLASS_ICONS[c.cls] || CLASS_ICONS.enemy));
    return `<div class="combatant-card ${active?'active':''} ${dead?'dead':''} ${isPC?'pc':'npc'}" data-idx="${i}" draggable="true">
      <div class="drag-handle" title="Drag to reorder">⋮⋮</div>
      <div class="card-avatar ${isPC?'pc':'npc'}" data-act="upload-portrait" data-idx="${i}" title="Click to upload portrait">${renderIcon(portrait, c.name)}</div>
      <div class="card-body">
        ${isPC
          ? `<div class="card-name">${esc(c.name)}${active?' <span class="turn-marker">◀</span>':''}</div>`
          : `<div class="card-name-row">
              <input class="card-name-input" type="text" value="${esc(c.name)}" data-ci="${i}" data-cf="name" title="Edit name">
              ${(()=>{
                const opts = (state.settings && state.settings.combatNameOptions) || ['spear','hands','rock','small'];
                return `<select class="card-name-quick" data-ci="${i}" title="Quick-pick name">
                  <option value="">⌄</option>
                  ${opts.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('')}
                  <option disabled>─────</option>
                  <option value="__manage__">⚙ Manage…</option>
                </select>`;
              })()}
              ${active?'<span class="turn-marker">◀</span>':''}
            </div>`}
        <div class="card-stats">
          <div class="card-stat" title="HP"><span class="lab">♥</span><input type="number" value="${c.hp}" data-ci="${i}" data-cf="hp"></div>
          <div class="card-stat" title="AC"><span class="lab">⛨</span><input type="number" value="${c.ac}" data-ci="${i}" data-cf="ac"></div>
          <div class="card-stat" title="Initiative"><span class="lab">⚡</span><input type="number" value="${c.initiative||0}" data-ci="${i}" data-cf="initiative"></div>
        </div>
        ${c.conditions&&c.conditions.length?`<div class="conditions">${c.conditions.map(cd=>`<span class="condition-tag" data-act="rmcond" data-idx="${i}" data-cond="${esc(cd)}">${esc(cd)} ×</span>`).join('')}</div>`:''}
      </div>
      <div class="card-actions">
        <button class="btn icon-btn danger" data-act="remove" data-idx="${i}" title="Remove">×</button>
        ${isPC?'':`<button class="btn icon-btn" data-act="duplicate" data-idx="${i}" title="Duplicate">⎘</button>`}
      </div>
    </div>`;
  },

  _wire(){
    const b=this._body;if(!b)return;

    // Toolbar + per-card actions
    b.querySelectorAll('[data-act]').forEach(el=>el.addEventListener('click',e=>{
      e.stopPropagation();
      const act=el.dataset.act;
      if(act==='next')                this._nextTurn();
      else if(act==='add')            this._addPrompt();
      else if(act==='add-monster')    this._openMonsterPicker();
      else if(act==='player-view')    this._openPlayerView();
      else if(act==='settings')       this._manageQuickNames();
      else if(act==='remove')         this._remove(parseInt(el.dataset.idx));
      else if(act==='duplicate')      this._duplicate(parseInt(el.dataset.idx));
      else if(act==='rmcond')         this._removeCond(parseInt(el.dataset.idx),el.dataset.cond);
      else if(act==='add-pc')         this._addPartyToCombat(parseInt(el.dataset.pi));
      else if(act==='remove-pc')      this._removeFromCombatById(el.dataset.pid);
      else if(act==='upload-portrait')this._uploadPortrait(parseInt(el.dataset.idx));
    }));

    // Combatant inputs (hp, ac, initiative, name) — no auto-sort
    b.querySelectorAll('input[data-cf]').forEach(inp=>{
      inp.addEventListener('change',e=>{
        const i=+e.target.dataset.ci, f=e.target.dataset.cf;
        const isText = f === 'name';
        const val = isText ? String(e.target.value).trim() : (parseInt(e.target.value)||0);
        state.combatants[i]={...state.combatants[i],[f]:val};
        save();
        if((f==='hp'||f==='ac')&&state.combatants[i]?.isPC) syncCombatToParty(state.combatants[i].id);
        this._render();
      });
      inp.addEventListener('click',e=>e.stopPropagation());
      inp.addEventListener('mousedown',e=>e.stopPropagation()); // don't start card drag from input
    });

    // Quick-pick name dropdown
    b.querySelectorAll('select.card-name-quick').forEach(sel=>{
      sel.addEventListener('change',e=>{
        e.stopPropagation();
        const v = e.target.value;
        if (!v) return;
        if (v === '__manage__'){ e.target.value=''; this._manageQuickNames(); return; }
        const i = +e.target.dataset.ci;
        state.combatants[i] = {...state.combatants[i], name: v};
        save(); this._render();
      });
      sel.addEventListener('click',e=>e.stopPropagation());
      sel.addEventListener('mousedown',e=>e.stopPropagation());
    });

    // Right-click: conditions menu
    b.querySelectorAll('.combatant-card:not(.party-row)').forEach(card=>{
      card.addEventListener('contextmenu',e=>{
        if(e.target.matches('input,textarea,select')) return;
        e.preventDefault(); e.stopPropagation();
        const i=+card.dataset.idx;
        const c=state.combatants[i]; if(!c) return;
        const have=new Set(c.conditions||[]);
        const items=SEARCH_DATA
          .filter(d=>d.cat==='condition')
          .map(d=>({label:d.name, checked:have.has(d.name), onClick:()=>this._toggleCondAtIdx(i,d.name)}));
        showContextMenu(e.clientX, e.clientY, items);
      });
    });

    // Party section stat inputs
    b.querySelectorAll('input[data-pf]').forEach(inp=>{
      inp.addEventListener('change',e=>{
        const pi=+e.target.dataset.pi, f=e.target.dataset.pf;
        const val=parseInt(e.target.value)||0;
        state.party[pi]={...state.party[pi],[f]:val};
        if((f==='hp'||f==='ac')&&state.party[pi]){
          const cid=state.party[pi].id;
          const ci=state.combatants.findIndex(c=>c.id===cid);
          if(ci>=0) state.combatants[ci]={...state.combatants[ci],[f]:val};
        }
        panelDefs.party?._render?.();
        save();this._render();
      });
      inp.addEventListener('click',e=>e.stopPropagation());
    });

    this._wireDragReorder();
    this._wireBestiaryDrop();
  },

  // HTML5 drag-and-drop — reorder combatant cards by dragging.
  _wireDragReorder(){
    const b=this._body;if(!b)return;
    const list = b.querySelector('#combat-list');
    if (!list) return;
    list.querySelectorAll('.combatant-card').forEach(card=>{
      card.addEventListener('dragstart', e=>{
        // Suppress drag if user grabbed an input/select (they need text drag)
        if (e.target.closest('input,select,textarea,button')) { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-skt-combat-idx', card.dataset.idx);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', ()=>card.classList.remove('dragging'));
      card.addEventListener('dragover', e=>{
        if (!e.dataTransfer.types.includes('application/x-skt-combat-idx')) return;
        e.preventDefault();
        const r = card.getBoundingClientRect();
        const before = e.clientY < r.top + r.height/2;
        card.classList.toggle('drop-before', before);
        card.classList.toggle('drop-after', !before);
      });
      card.addEventListener('dragleave', ()=>{
        card.classList.remove('drop-before','drop-after');
      });
      card.addEventListener('drop', e=>{
        const fromStr = e.dataTransfer.getData('application/x-skt-combat-idx');
        if (!fromStr) return;
        e.preventDefault();
        const from = parseInt(fromStr);
        const r = card.getBoundingClientRect();
        const before = e.clientY < r.top + r.height/2;
        let to = parseInt(card.dataset.idx);
        if (!before) to += 1;
        // Adjust because removing from earlier index shifts indices down
        if (from < to) to -= 1;
        card.classList.remove('drop-before','drop-after');
        if (from === to) return;
        const [moved] = state.combatants.splice(from, 1);
        state.combatants.splice(to, 0, moved);
        save(); this._render();
      });
    });
  },

  // Bestiary → combat drop zone. Listens on the whole panel body so users
  // can drop anywhere inside the tracker, not just on an existing card.
  _wireBestiaryDrop(){
    const b=this._body;if(!b)return;
    b.addEventListener('dragover', e=>{
      if (!e.dataTransfer.types.includes('application/x-skt-bestiary-mid')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      b.classList.add('drop-active');
    });
    b.addEventListener('dragleave', e=>{
      // Only clear when leaving the panel boundary, not just moving over children
      if (e.target === b) b.classList.remove('drop-active');
    });
    b.addEventListener('drop', e=>{
      const mid = e.dataTransfer.getData('application/x-skt-bestiary-mid');
      b.classList.remove('drop-active');
      if (!mid) return;
      e.preventDefault();
      const bData = panelDefs.bestiary?._data;
      const m = bData?.monsters.find(x=>x.id===mid);
      if (!m){ showToast('Monster not found'); return; }
      // Look up the full 5e entry for stats; fall back to bestiary snapshot
      let entry = null;
      if (typeof _5eData !== 'undefined' && _5eLoaded){
        entry = _5eData.find(d => d.cat==='monster' && d._slug === m.slug);
      }
      if (entry){
        this.addMonster(entry);
      } else {
        // Use the snapshot saved on the bestiary card
        this.addMonster({name:m.name, hp:m.hp||10, ac:m.ac||10, dex:10, _img:m.img||null});
      }
    });
  },

  _addPartyToCombat(pi){
    const p=state.party[pi];
    if(state.combatants.find(c=>c.isPC&&c.id===p.id)){showToast(p.name+' already in combat');return;}
    state.combatants.push({id:p.id,name:p.name,isPC:true,cls:p.cls||'fighter',hp:p.hp,hpMax:p.hpMax,ac:p.ac,initBonus:p.init,initiative:0,conditions:[]});
    if(!state.combatRound) state.combatRound=1;
    save();this._render();showToast(p.name+' added');
  },

  _removeFromCombatById(id){
    const i=state.combatants.findIndex(c=>c.id===id);
    if(i>=0){state.combatants.splice(i,1);save();this._render();}
  },

  _addPrompt(){
    showModal('⚔ Add Combatant',[
      {id:'name',  label:'Name',       type:'text',   value:'',  placeholder:'Bandit, Ogre...'},
      {id:'hp',    label:'HP',         type:'number', value:20,  min:1},
      {id:'ac',    label:'AC',         type:'number', value:12,  min:1},
      {id:'init',  label:'Initiative', type:'number', value:0},
    ],'Add to combat').then(r=>{
      if(!r||!r.name)return;
      state.combatants.push({id:uid(),name:r.name,isPC:false,cls:'enemy',hp:r.hp,hpMax:r.hp,ac:r.ac,initBonus:0,initiative:r.init,conditions:[]});
      if(!state.combatRound) state.combatRound=1;
      save();this._render();
    });
  },

  // Open a monster picker that searches the loaded 5e bestiary. Shares the
  // same picker UI flow as the Bestiary panel but adds the chosen monster
  // straight into combat.
  _openMonsterPicker(){
    if (typeof _5eData === 'undefined' || !_5eLoaded){
      showToast('5e data still loading — try again in a moment');
      return;
    }
    const all = _5eData.filter(d=>d.cat==='monster').sort((a,b)=>a.name.localeCompare(b.name));
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="width:520px;max-width:90vw">
      <h3>Add Monster to Combat</h3>
      <input type="search" id="cmb-pick-search" placeholder="🔎 Search 5e monsters…" autocomplete="off"
        style="width:100%;background:var(--panel-2);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:5px;font-size:12px;margin-bottom:10px">
      <div id="cmb-pick-list" style="max-height:380px;overflow-y:auto;border:1px solid var(--border);border-radius:5px;background:var(--panel-2)"></div>
      <div class="modal-actions"><button class="btn" id="cmb-pick-close">Close</button></div>
    </div>`;
    document.body.appendChild(backdrop);
    const list = backdrop.querySelector('#cmb-pick-list');
    const renderList = q=>{
      const qn=(q||'').toLowerCase().trim();
      const pool = qn ? all.filter(d=>d.name.toLowerCase().includes(qn)||(d.meta||'').toLowerCase().includes(qn)).slice(0,200) : all.slice(0,200);
      list.innerHTML = pool.map(d=>`<div class="bestiary-pick-row" data-slug="${esc(d._slug)}">
        <span class="bestiary-pick-name">${esc(d.name)}</span>
        <span class="bestiary-pick-meta">${esc(d.meta||'')}</span>
      </div>`).join('') || '<div style="padding:14px;text-align:center;color:var(--text-muted);font-size:12px">No matches</div>';
    };
    renderList('');
    const close = ()=>backdrop.remove();
    backdrop.querySelector('#cmb-pick-search').addEventListener('input', e=>renderList(e.target.value));
    backdrop.querySelector('#cmb-pick-close').addEventListener('click', close);
    backdrop.addEventListener('mousedown', e=>{ if (e.target===backdrop) close(); });
    backdrop.addEventListener('keydown', e=>{ if (e.key==='Escape') close(); });
    list.addEventListener('click', e=>{
      const row = e.target.closest('.bestiary-pick-row'); if (!row) return;
      const d = all.find(x=>x._slug===row.dataset.slug); if (!d) return;
      this.addMonster(d);
      close();
    });
    setTimeout(()=>backdrop.querySelector('#cmb-pick-search').focus(), 30);
  },

  _openPlayerView(){
    const url = window.location.href.split('?')[0]+'?player=1';
    const w = window.open(url,'skt-player','width=1280,height=720');
    if (!w) showToast('Allow popups to open player view');
    else showToast('Player view opened');
  },

  _remove(i){state.combatants.splice(i,1);save();this._render();},

  // Duplicate a monster card. Re-uses the same baseName logic addMonster
  // uses so a second Goblin becomes "Goblin 2" (and the original gets
  // renamed to "Goblin 1" so the group is unambiguous).
  _duplicate(i){
    const c = state.combatants[i]; if (!c || c.isPC) return;
    const base = c.baseName || c.name;
    const existing = state.combatants.filter(x=>x.baseName===base || x.name===base).length;
    const copyNum = Math.max(existing, 1) + 1;
    const newName = base + ' ' + copyNum;
    if (existing === 1){
      // First duplicate — number the original too
      const oi = state.combatants.findIndex(x=>x.baseName===base || x.name===base);
      if (oi >= 0) state.combatants[oi] = {...state.combatants[oi], name: base+' 1', baseName: base};
    }
    state.combatants.splice(i+1, 0, {
      ...c,
      id: uid(),
      name: newName,
      baseName: base,
      hp: c.hpMax || c.hp,
      conditions: [],
    });
    save(); this._render();
  },

  _nextTurn(){
    if(!state.combatants.length){ showToast('No combatants yet'); return; }
    let id=state.activeCombatantId,round=state.combatRound;
    if(!id){id=state.combatants[0].id;round=Math.max(1,round);}
    else{
      let ni=state.combatants.findIndex(c=>c.id===id)+1;
      if(ni>=state.combatants.length){ni=0;round++;showToast(`Round ${round}`);}
      id=state.combatants[ni].id;
    }
    state.activeCombatantId=id;state.combatRound=round;save();this._render();
  },

  _removeCond(i,cond){
    state.combatants[i]={...state.combatants[i],conditions:(state.combatants[i].conditions||[]).filter(x=>x!==cond)};
    save();this._render();
  },

  _toggleCondAtIdx(i,cond){
    const c=state.combatants[i]; if(!c) return;
    const conds=c.conditions||[];
    const has=conds.includes(cond);
    const next=has?conds.filter(x=>x!==cond):[...conds,cond];
    state.combatants[i]={...c,conditions:next};
    save();this._render();
    showToast(has?(cond+' removed from '+c.name):(cond+' → '+c.name));
  },

  applyCondition(cond){
    if(!state.activeCombatantId){showToast('No active combatant');return false;}
    const i=state.combatants.findIndex(c=>c.id===state.activeCombatantId);if(i<0)return false;
    const conds=state.combatants[i].conditions||[];
    if(!conds.includes(cond)){state.combatants[i]={...state.combatants[i],conditions:[...conds,cond]};save();this._render();}
    showToast(`${cond} → ${state.combatants[i].name}`);return true;
  },

  _manageQuickNames(){
    if (!state.settings.combatNameOptions) state.settings.combatNameOptions = ['spear','hands','rock','small'];
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const renderList = () => {
      return state.settings.combatNameOptions.map((v,i) =>
        `<div class="qn-row">
          <input class="qn-input" data-i="${i}" value="${esc(v)}">
          <button class="btn icon-btn danger" data-rm="${i}" title="Remove">×</button>
        </div>`
      ).join('') || '<div style="color:var(--text-muted);font-size:11px;padding:8px 0">No options yet — add one below.</div>';
    };
    const renderModal = () => {
      backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="min-width:320px">
        <h3>Quick-pick Name Options</h3>
        <p style="color:var(--text-muted);font-size:11px;margin:0 0 10px">Used by the dropdown next to combatant names. Edit or remove existing options, or add new ones below.</p>
        <div class="qn-list">${renderList()}</div>
        <div class="qn-add-row">
          <input class="qn-add-input" placeholder="New option (e.g. axe, bow, mage)" autocomplete="off">
          <button class="btn primary" id="qn-add-btn">+ Add</button>
        </div>
        <div class="modal-actions" style="margin-top:14px">
          <button class="btn" id="qn-reset">Reset to defaults</button>
          <button class="btn primary" id="qn-done">Done</button>
        </div>
      </div>`;
      wire();
    };
    const wire = () => {
      backdrop.querySelectorAll('input.qn-input').forEach(inp => inp.addEventListener('change', e => {
        const i = +e.target.dataset.i;
        const v = String(e.target.value).trim();
        if (!v) { state.settings.combatNameOptions.splice(i,1); }
        else    { state.settings.combatNameOptions[i] = v; }
        save();
        renderModal();
      }));
      backdrop.querySelectorAll('[data-rm]').forEach(btn => btn.addEventListener('click', e => {
        e.stopPropagation();
        state.settings.combatNameOptions.splice(+btn.dataset.rm, 1);
        save();
        renderModal();
      }));
      const addInp = backdrop.querySelector('.qn-add-input');
      const addBtn = backdrop.querySelector('#qn-add-btn');
      const doAdd = () => {
        const v = String(addInp.value).trim();
        if (!v) return;
        if (state.settings.combatNameOptions.includes(v)) { addInp.value=''; return; }
        state.settings.combatNameOptions.push(v);
        save();
        renderModal();
        backdrop.querySelector('.qn-add-input')?.focus();
      };
      addBtn.addEventListener('click', doAdd);
      addInp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
      backdrop.querySelector('#qn-reset').addEventListener('click', () => {
        state.settings.combatNameOptions = ['spear','hands','rock','small'];
        save();
        renderModal();
      });
      backdrop.querySelector('#qn-done').addEventListener('click', () => {
        backdrop.remove();
        this._render();
      });
    };
    document.body.appendChild(backdrop);
    renderModal();
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) { backdrop.remove(); this._render(); }});
    setTimeout(() => backdrop.querySelector('.qn-add-input')?.focus(), 30);
  },

  _uploadPortrait(i){
    const c = state.combatants[i]; if(!c) return;
    const inp = document.createElement('input');
    inp.type='file'; inp.accept='image/*';
    inp.addEventListener('change', async ev => {
      const f = ev.target.files[0]; if(!f) return;
      try {
        const dataUrl = await showCropModal(f, {size:96, shape:'circle', title:'Crop combatant portrait'});
        if (!dataUrl) return;
        state.combatants[i] = {...state.combatants[i], portrait: dataUrl};
        save(); this._render();
        showToast('Portrait uploaded');
      } catch(err){ showToast('Upload failed: '+err.message); }
    });
    inp.click();
  },

  // Public API used by other panels (Bestiary drag-drop, search results, etc).
  // Appends to the end of the combatant list — manual reordering is the user's
  // job now, so we don't auto-sort by initiative.
  addMonster(m){
    const initMod = m.dex ? mod(m.dex) : 0;
    const existing = state.combatants.filter(c=>c.baseName===m.name).length;
    const displayName = existing ? `${m.name} ${existing+1}` : m.name;
    if (existing === 1){
      const oi = state.combatants.findIndex(c=>c.baseName===m.name);
      if (oi >= 0) state.combatants[oi] = {...state.combatants[oi], name:`${m.name} 1`};
    }
    let portrait = null;
    if (m._img) portrait = m._img.startsWith('img/') ? m._img : ('img/' + m._img);
    state.combatants.push({
      id: uid(),
      name: displayName,
      baseName: m.name,
      isPC: false,
      cls: 'enemy',
      hp: m.hp,
      hpMax: m.hp,
      ac: m.ac,
      initBonus: initMod,
      initiative: 0,
      conditions: [],
      portrait,
    });
    if (!state.combatRound) state.combatRound = 1;
    save(); this._render();
    showToast(`Added ${displayName}`);
  },
});
