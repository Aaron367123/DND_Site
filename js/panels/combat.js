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
  mount(body){
    this._body=body;
    this._wireBestiaryDrop();
    this._render();
  },
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
        <button class="btn icon-btn ${state.settings?.hideMonsterStats?'active':''}" data-act="toggle-hide-stats" title="Hide monster HP/AC from player view">🙈</button>
        <button class="btn icon-btn" data-act="settings" title="Manage quick-pick names">⚙</button>
      </div>

      ${state.settings?.hideMonsterStats ? '<div class="combat-hide-banner">🙈 Monster HP &amp; AC hidden from players</div>' : ''}

      ${inCombat
        ? '<div class="combatant-list" id="combat-list">'+this._renderCombatants()+'</div>'
        : '<div class="empty-state" style="padding:30px;text-align:center;color:var(--text-muted)"><div style="font-size:24px;margin-bottom:6px">⚔</div>Drag a party member or monster here, or use the + / 🐲 buttons above.</div>'}

      <div class="combat-droptip" id="combat-droptip">Drop to add to combat</div>`;
    this._wire();
  },

  _renderCombatants(){
    return state.combatants.map((c,i)=>this._renderCard(c,i,false)).join('');
  },

  _renderCard(c, i, isParty){
    const active = c.id === state.activeCombatantId;
    const dead = c.hp <= 0;
    const isPC = c.isPC;
    const portrait = c.portrait
      || (isPC ? (state.party.find(p=>p.id===c.id)?.icon || '⚔')
               : (CLASS_ICONS[c.cls] || CLASS_ICONS.enemy));
    // Hide HP/AC for monsters in the player view when the DM has toggled it on.
    // DM tab always shows real values regardless of the setting.
    const hideStats = !isPC
      && state.settings?.hideMonsterStats
      && document.body.classList.contains('player-mode');
    const hpField = hideStats
      ? '<span class="card-stat-hidden">?</span>'
      : `<input type="number" value="${c.hp}" data-ci="${i}" data-cf="hp">`;
    const acField = hideStats
      ? '<span class="card-stat-hidden">?</span>'
      : `<input type="number" value="${c.ac}" data-ci="${i}" data-cf="ac">`;
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
          <div class="card-stat" title="HP"><span class="lab">♥</span>${hpField}</div>
          <div class="card-stat" title="AC"><span class="lab">⛨</span>${acField}</div>
          <div class="card-stat" title="Initiative"><span class="lab">⚡</span><input type="number" value="${c.initiative||0}" data-ci="${i}" data-cf="initiative"></div>
        </div>
        ${c.conditions&&c.conditions.length?`<div class="conditions">${c.conditions.map(cd=>`<span class="condition-tag" data-act="rmcond" data-idx="${i}" data-cond="${esc(cd)}">${esc(cd)} ×</span>`).join('')}</div>`:''}
        ${(isPC && (c.hp||0) <= 0) ? this._renderDeathSaves(i, c) : ''}
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
      else if(act==='settings')       this._manageQuickNames();
      else if(act==='toggle-hide-stats'){
        state.settings.hideMonsterStats = !state.settings.hideMonsterStats;
        save(); this._render();
      }
      else if(act==='remove')         this._remove(parseInt(el.dataset.idx));
      else if(act==='duplicate')      this._duplicate(parseInt(el.dataset.idx));
      else if(act==='rmcond')         this._removeCond(parseInt(el.dataset.idx),el.dataset.cond);
      else if(act==='upload-portrait')this._uploadPortrait(parseInt(el.dataset.idx));
      else if(act==='death-save'){
        const i = parseInt(el.dataset.idx);
        const kind = el.dataset.kind; // 'success' | 'fail'
        const n = parseInt(el.dataset.n);
        const c = state.combatants[i]; if (!c) return;
        const ds = {...(c.deathSaves || {success:0, fail:0})};
        // Click N: if already at >=N, set to N-1 (un-click); else set to N.
        ds[kind] = (ds[kind] >= n) ? (n-1) : n;
        state.combatants[i] = {...c, deathSaves: ds};
        if (ds.success >= 3){
          state.combatants[i].deathSaves = {success:0, fail:0};
          showToast(c.name + ' stabilized');
        } else if (ds.fail >= 3){
          showToast(c.name + ' has died');
        }
        save(); this._render();
      }
    }));

    // Combatant inputs (hp, ac, initiative, name) — no auto-sort
    b.querySelectorAll('input[data-cf]').forEach(inp=>{
      inp.addEventListener('change',e=>{
        const i=+e.target.dataset.ci, f=e.target.dataset.cf;
        const isText = f === 'name';
        const val = isText ? String(e.target.value).trim() : (parseInt(e.target.value)||0);
        state.combatants[i]={...state.combatants[i],[f]:val};
        // PC came back above 0 HP — clear death-save tracker.
        if (f === 'hp' && state.combatants[i].isPC && val > 0 && state.combatants[i].deathSaves){
          state.combatants[i] = {...state.combatants[i], deathSaves: undefined};
        }
        // Mirror to the party slot BEFORE saving so localStorage (and the
        // resulting Firebase push) captures both halves in one consistent
        // write — see the matching comment in party.js.
        if((f==='hp'||f==='ac')&&state.combatants[i]?.isPC) syncCombatToParty(state.combatants[i].id);
        save();
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
    b.querySelectorAll('.combatant-card').forEach(card=>{
      card.addEventListener('contextmenu',e=>{
        if(e.target.matches('input,textarea,select')) return;
        e.preventDefault(); e.stopPropagation();
        const i=+card.dataset.idx;
        const c=state.combatants[i]; if(!c) return;
        // PCs → quick-reference popout (saves, passive perception, etc).
        // NPCs/monsters → conditions menu (prior behavior).
        if (c.isPC){
          this._showPcQuickRef(c, e.clientX, e.clientY);
          return;
        }
        const have=new Set(c.conditions||[]);
        const items=SEARCH_DATA
          .filter(d=>d.cat==='condition')
          .map(d=>({label:d.name, checked:have.has(d.name), onClick:()=>this._toggleCondAtIdx(i,d.name)}));
        showContextMenu(e.clientX, e.clientY, items);
      });
    });

    this._wireDragReorder();
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

  // External drop zone — accepts bestiary monsters and party members dragged
  // in from their respective panels. Listens on the whole panel body so the
  // user can drop anywhere inside the tracker, not just on an existing card.
  // Wired exactly once per mount — _render() rebuilds innerHTML but keeps
  // the body element, so re-attaching here on every render would stack
  // duplicate listeners and a single drop would fire multiple times.
  _wireBestiaryDrop(){
    const b=this._body;if(!b)return;
    if (b._bestiaryDropWired) return;
    b._bestiaryDropWired = true;
    const externalTypes = ['application/x-skt-bestiary-mid','application/x-skt-party-pi'];
    const hasExternal = e => externalTypes.some(t => e.dataTransfer.types.includes(t));
    b.addEventListener('dragover', e=>{
      if (!hasExternal(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      b.classList.add('drop-active');
    });
    b.addEventListener('dragleave', e=>{
      if (e.target === b) b.classList.remove('drop-active');
    });
    b.addEventListener('drop', e=>{
      b.classList.remove('drop-active');
      const mid = e.dataTransfer.getData('application/x-skt-bestiary-mid');
      const pi  = e.dataTransfer.getData('application/x-skt-party-pi');
      if (mid){
        e.preventDefault();
        const bData = panelDefs.bestiary?._data;
        const m = bData?.monsters.find(x=>x.id===mid);
        if (!m){ showToast('Monster not found'); return; }
        let entry = null;
        if (typeof _5eData !== 'undefined' && _5eLoaded){
          entry = _5eData.find(d => d.cat==='monster' && d._slug === m.slug);
        }
        if (entry) this.addMonster(entry);
        else       this.addMonster({name:m.name, hp:m.hp||10, ac:m.ac||10, dex:10, _img:m.img||null});
      } else if (pi !== ''){
        e.preventDefault();
        this._addPartyToCombat(parseInt(pi));
      }
    });
  },

  _addPartyToCombat(pi){
    const p=state.party[pi];
    if(state.combatants.find(c=>c.isPC&&c.id===p.id)){showToast(p.name+' already in combat');return;}
    const dexMod = (p.abilities && typeof p.abilities.dex === 'number') ? Math.floor((p.abilities.dex - 10)/2) : null;
    const initBonus = (typeof p.init === 'number' ? p.init : null) ?? dexMod ?? 0;
    state.combatants.push({id:p.id,name:p.name,isPC:true,cls:p.cls||'fighter',hp:p.hp,hpMax:p.hpMax,ac:p.ac,initBonus,initiative:p.init||0,conditions:[]});
    if(!state.combatRound) state.combatRound=1;
    save();this._render();
    showToast(`${p.name} added`);
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
      const pool = qn ? all.filter(d=>d.name.toLowerCase().includes(qn)||(d.meta||'').toLowerCase().includes(qn)||(d._source||'').toLowerCase().includes(qn)||(_formatSource(d._source)||'').toLowerCase().includes(qn)).slice(0,200) : all.slice(0,200);
      list.innerHTML = pool.map(d=>`<div class="bestiary-pick-row" data-slug="${esc(d._slug)}">
        <div class="bestiary-pick-left">
          <span class="bestiary-pick-name">${esc(d.name)}</span>
          ${d._source ? `<span class="detail-source-badge">${esc(_formatSource(d._source))}</span>` : ''}
        </div>
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

  _renderDeathSaves(i, c){
    const ds = c.deathSaves || {success:0, fail:0};
    const pip = (filled, kind, n) =>
      `<span class="ds-pip ${kind} ${filled?'on':''}" data-act="death-save" data-idx="${i}" data-kind="${kind}" data-n="${n}"></span>`;
    return `<div class="death-saves">
      <span class="ds-label">Saves</span>
      <span class="ds-row ds-success">${[1,2,3].map(n=>pip(ds.success>=n,'success',n)).join('')}</span>
      <span class="ds-row ds-fail">${[1,2,3].map(n=>pip(ds.fail>=n,'fail',n)).join('')}</span>
    </div>`;
  },

  // Show a small popout near (x,y) with the PC's saves and passive Perception.
  // Reads from the matched party member's imported abilities.
  _showPcQuickRef(combatant, x, y){
    // Remove any prior popout.
    document.querySelectorAll('.pc-quickref').forEach(el => el.remove());
    const p = state.party.find(pp => pp.id === combatant.id);
    const ab = (p && p.abilities) || null;
    const fmtMod = m => (m >= 0 ? '+' : '') + m;
    const modOf = score => score == null ? null : Math.floor((score - 10) / 2);
    const row = (label, val) => `<div class="pc-quickref-row"><span>${esc(label)}</span><span>${esc(val)}</span></div>`;
    let html = `<div class="pc-quickref-name">${esc(combatant.name)}${p && p.cls ? ' <span style="color:var(--text-dim);font-weight:400">'+esc(p.cls)+(p.level?' '+p.level:'')+'</span>' : ''}</div>`;
    html += row('AC', combatant.ac ?? p?.ac ?? '?');
    html += row('HP', `${combatant.hp ?? '?'} / ${combatant.hpMax ?? p?.hpMax ?? '?'}`);
    html += row('Speed', (p && p.spd) ? p.spd + ' ft' : '—');
    if (ab){
      html += '<div class="pc-quickref-section">Saves</div>';
      ['str','dex','con','int','wis','cha'].forEach(k => {
        const m = modOf(ab[k]);
        html += row(k.toUpperCase(), m == null ? '—' : fmtMod(m));
      });
      const wisMod = modOf(ab.wis);
      if (wisMod != null) html += row('Passive Perception', 10 + wisMod);
    } else {
      html += '<div class="pc-quickref-empty">No imported abilities. Use 📄 Import PDF on the party tracker for save bonuses and passive perception.</div>';
    }
    const div = document.createElement('div');
    div.className = 'pc-quickref';
    div.innerHTML = html;
    document.body.appendChild(div);
    // Position with viewport clamping.
    const rect = div.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    div.style.left = Math.min(x, vw - rect.width - 8) + 'px';
    div.style.top  = Math.min(y, vh - rect.height - 8) + 'px';
    // Dismiss on outside click or Escape.
    const dismiss = (ev) => {
      if (ev && ev.type === 'mousedown' && div.contains(ev.target)) return;
      div.remove();
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (ev) => { if (ev.key === 'Escape') dismiss(); };
    setTimeout(() => {
      document.addEventListener('mousedown', dismiss);
      document.addEventListener('keydown', onKey);
    }, 0);
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
    if (m._img){
      // Prefer the head-shot token over the full creature art for the small
      // round portrait. Tokens live alongside the fluff at
      // img/bestiary/tokens/<source>/<name>.webp.
      const raw = m._img.startsWith('img/') ? m._img.slice(4) : m._img;
      const token = raw.replace(/^bestiary\//, 'bestiary/tokens/');
      portrait = 'img/' + token;
    }
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
      initiative: initMod, // pre-fill with dex modifier; user can bump it before/during combat
      conditions: [],
      portrait,
    });
    if (!state.combatRound) state.combatRound = 1;
    save(); this._render();
    showToast(`Added ${displayName}`);
  },
});
