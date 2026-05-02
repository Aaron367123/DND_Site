// ============================================================
// COMBAT PANEL
// ============================================================
registerPanel('combat',{
  title:'Combat Tracker',icon:'⚔',
  mount(body){this._body=body;this._render();},
  unmount(){this._body=null;},

  _render(){
    const b=this._body;if(!b)return;
    const inCombat=state.combatants.length>0;
    b.innerHTML=`
      <div class="combat-controls">
        <button class="btn small primary" data-act="next" title="Advance turn">▶ Next</button>
        <button class="btn small" data-act="add" title="Add custom combatant">+ Add</button>
        <button class="btn small" data-act="roll" title="Roll initiative for everyone">🎲 Roll all</button>
        <button class="btn small danger" data-act="end" title="End combat, clear enemies">End</button>
        <span class="round-display">${state.combatRound>0?'Round '+state.combatRound:'Round —'}</span>
      </div>

      ${inCombat ? '<div style="padding:4px 8px;font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border)">Initiative order</div><div class="combatant-list" id="combat-list" style="padding-left:14px">'+this._renderCombatants()+'</div>' : ''}

      <div style="padding:4px 8px;font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border);border-top:${inCombat?'1px solid var(--border)':'none'}">Party</div>
      <div class="combatant-list" id="party-list">${this._renderParty()}</div>

      <div class="quick-add">
        <span class="quick-add-label">Quick add:</span>
        ${[['Hill Giant',105,13,-1],['Stone Giant',126,17,2],['Frost Giant',138,15,-1],['Fire Giant',162,18,-1],['Cloud Giant',200,14,0],['Storm Giant',230,16,2],['Goblin',7,15,2],['Orc',15,13,1]].map(([n,h,a,i])=>`<button class="btn small" data-quick="${n}|${h}|${a}|${i}">${n.split(' ')[0]}</button>`).join('')}
      </div>`;
    this._wire();
  },

  _renderCombatants(){
    return state.combatants.map((c,i)=>{
      const active=c.id===state.activeCombatantId, dead=c.hp<=0;
      // Picking the portrait source: explicit `portrait` (from custom upload or
      // monster image) wins; PCs fall back to their party icon; NPCs to the
      // class-icon SVG by `cls`.
      const portrait = c.portrait
        || (c.isPC ? (state.party.find(p=>p.id===c.id)?.icon || '⚔')
                   : (CLASS_ICONS[c.cls] || CLASS_ICONS.enemy));
      const isPC=c.isPC;
      const bonus=c.initBonus||0;
      const bonusStr=bonus>0?'+'+bonus:bonus<0?String(bonus):'';
      return'<div class="combatant '+(active?'active':'')+' '+(dead?'dead':'')+'" data-idx="'+i+'" title="Right-click to add a condition">'
        +'<div class="init-wrap" title="Edit initiative (double-click to reroll)">'
          +'<input class="init-input" type="number" value="'+c.initiative+'" data-ci="'+i+'" data-cf="initiative">'
          +(bonusStr?'<div class="init-bonus-tag">'+bonusStr+'</div>':'')
        +'</div>'
        +'<div class="portrait '+(isPC?'pc':'npc')+'" style="font-size:'+(isPC?'16':'')+'px" data-act="upload-portrait" data-idx="'+i+'" title="Click to upload custom portrait">'+renderIcon(portrait, c.name)+'</div>'
        +'<div class="info">'
          +(isPC
            ? '<div class="name">'+esc(c.name)+(active?'<span class="turn-marker">◀</span>':'')+'</div>'
            : '<div class="name-row">'
                +'<input class="combatant-name-input" type="text" value="'+esc(c.name)+'" data-ci="'+i+'" data-cf="name" title="Edit name">'
                +(()=>{
                  const opts = (state.settings && state.settings.combatNameOptions) || ['spear','hands','rock','small'];
                  return '<select class="combatant-name-quick" data-ci="'+i+'" title="Quick-pick name">'
                    +'<option value="">⌄</option>'
                    + opts.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('')
                    +'<option disabled style="color:var(--text-dim)">─────</option>'
                    +'<option value="__manage__">⚙ Manage options…</option>'
                  +'</select>';
                })()
                +(active?'<span class="turn-marker">◀</span>':'')
              +'</div>')
          +'<div class="stat-row">'
            +'<div class="stat-pill">♥ <input type="number" value="'+c.hp+'" data-ci="'+i+'" data-cf="hp"><span style="color:var(--text-dim)">/'+(c.hpMax||'?')+'</span></div>'
            +'<div class="stat-pill">⛨ <input type="number" value="'+c.ac+'" data-ci="'+i+'" data-cf="ac"></div>'
          +'</div>'
          +(c.conditions&&c.conditions.length?'<div class="conditions">'+c.conditions.map(cd=>'<span class="condition-tag" data-act="rmcond" data-idx="'+i+'" data-cond="'+esc(cd)+'">'+esc(cd)+' ×</span>').join('')+'</div>':'')
        +'</div>'
        +'<button class="btn icon-btn danger" data-act="remove" data-idx="'+i+'" title="Remove from combat">×</button>'
      +'</div>';
    }).join('');
  },

  _renderParty(){
    if(!state.party.length) return '<div class="empty-state" style="padding:12px">No party members yet — add them in the Party Tracker.</div>';
    return state.party.map((p,i)=>{
      const inCombat=state.combatants.find(c=>c.isPC&&c.id===p.id);
      const icon=renderIcon(p.icon||'⚔', p.name);
      const bonus=p.init||0;
      const bonusStr=bonus>0?'+'+bonus:bonus<0?String(bonus):'±0';
      const displayInit=inCombat?inCombat.initiative:bonus;
      return'<div class="combatant party-row '+(inCombat?'in-combat':'')+'">'
        +'<div class="init-wrap" title="'+(inCombat?'Current initiative':'Initiative bonus')+'"><input class="init-input '+(inCombat?'':'dimmed')+'" type="number" value="'+displayInit+'" data-pi="'+i+'" data-pf="'+(inCombat?'combat-init':'init')+'" '+(inCombat?'data-cid="'+inCombat.id+'"':'')+'>'+(!inCombat?'<div class="init-bonus-tag">bonus</div>':'')+'</div>'
        +'<div class="portrait pc" style="font-size:16px">'+icon+'</div>'
        +'<div class="info">'
          +'<div class="name">'+esc(p.name)+(inCombat?' <span style="font-size:9px;color:var(--accent)">IN COMBAT</span>':'')+'</div>'
          +'<div class="stat-row">'
            +'<div class="stat-pill">♥ <input type="number" value="'+p.hp+'" data-pi="'+i+'" data-pf="hp"><span style="color:var(--text-dim)">/'+p.hpMax+'</span></div>'
            +'<div class="stat-pill">⛨ <input type="number" value="'+p.ac+'" data-pi="'+i+'" data-pf="ac"></div>'
          +'</div>'
        +'</div>'
        +(!inCombat
          ?'<button class="btn small primary" data-act="add-pc" data-pi="'+i+'" style="font-size:10px;padding:2px 6px">+</button>'
          :'<button class="btn icon-btn danger" data-act="remove-pc" data-pid="'+inCombat.id+'">×</button>'
        )
      +'</div>';
    }).join('');
  },

  _wire(){
    const b=this._body;if(!b)return;

    // Control buttons
    b.querySelectorAll('[data-act]').forEach(el=>el.addEventListener('click',e=>{
      e.stopPropagation();
      const act=el.dataset.act;
      if(act==='next')      this._nextTurn();
      else if(act==='add')  this._addPrompt();
      else if(act==='roll') this._rollAll();
      else if(act==='end')  this._end();
      else if(act==='remove')    this._remove(parseInt(el.dataset.idx));
      else if(act==='rmcond')    this._removeCond(parseInt(el.dataset.idx),el.dataset.cond);
      else if(act==='add-pc')    this._addPartyToCombat(parseInt(el.dataset.pi));
      else if(act==='remove-pc') this._removeFromCombatById(el.dataset.pid);
      else if(act==='upload-portrait') this._uploadPortrait(parseInt(el.dataset.idx));
    }));

    // Quick-add enemies
    b.querySelectorAll('[data-quick]').forEach(btn=>btn.addEventListener('click',e=>{
      e.stopPropagation();
      const[n,h,a,im]=btn.dataset.quick.split('|');
      this._quickAdd(n,+h,+a,+im);
    }));

    // Combatant stat inputs (hp, ac, initiative, name)
    b.querySelectorAll('input[data-cf]').forEach(inp=>{
      inp.addEventListener('change',e=>{
        const i=+e.target.dataset.ci, f=e.target.dataset.cf;
        const isText = f === 'name';
        const val = isText ? String(e.target.value).trim() : (parseInt(e.target.value)||0);
        state.combatants[i]={...state.combatants[i],[f]:val};
        if(f==='initiative') state.combatants.sort((a,b2)=>b2.initiative-a.initiative);
        save();
        if((f==='hp'||f==='ac')&&state.combatants[i]?.isPC) syncCombatToParty(state.combatants[i].id);
        this._render();
      });
      inp.addEventListener('click',e=>e.stopPropagation());
      if(inp.dataset.cf==='initiative'){
        inp.addEventListener('dblclick',e=>{
          e.stopPropagation();
          const i=+inp.dataset.ci;
          const newInit=d20()+(state.combatants[i].initBonus||0);
          inp.value=newInit;
          state.combatants[i]={...state.combatants[i],initiative:newInit};
          state.combatants.sort((a,b2)=>b2.initiative-a.initiative);
          save();this._render();
          showToast((state.combatants[i]?.name||'')+(': rolled '+newInit));
        });
      }
    });

    // Quick-pick name dropdown (NPC-only) — picking an option sets the name
    // directly. Dropdown is stateless: it always resets to the placeholder ⌄.
    b.querySelectorAll('select.combatant-name-quick').forEach(sel=>{
      sel.addEventListener('change',e=>{
        e.stopPropagation();
        const v = e.target.value;
        if (!v) return;
        if (v === '__manage__') {
          e.target.value = ''; // reset so it doesn't stay selected
          this._manageQuickNames();
          return;
        }
        const i = +e.target.dataset.ci;
        state.combatants[i] = {...state.combatants[i], name: v};
        save();
        this._render();
      });
      sel.addEventListener('click',e=>e.stopPropagation());
    });

    // Right-click on a combatant row → conditions menu
    b.querySelectorAll('.combatant:not(.party-row)').forEach(row=>{
      row.addEventListener('contextmenu',e=>{
        // Let the browser handle right-click on form inputs (so users can paste, etc.)
        if(e.target.matches('input,textarea')) return;
        e.preventDefault(); e.stopPropagation();
        const i=+row.dataset.idx;
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
        if(f==='combat-init'){
          const cid=e.target.dataset.cid;
          const ci=state.combatants.findIndex(c=>c.id===cid);
          if(ci>=0){state.combatants[ci]={...state.combatants[ci],initiative:val};state.combatants.sort((a,b2)=>b2.initiative-a.initiative);}
        } else {
          state.party[pi]={...state.party[pi],[f]:val};
          // If HP/AC changed on party row, also sync to their combat slot
          if((f==='hp'||f==='ac')&&state.party[pi]){
            const cid=state.party[pi].id;
            const ci=state.combatants.findIndex(c=>c.id===cid);
            if(ci>=0) state.combatants[ci]={...state.combatants[ci],[f]:val};
          }
          // Mirror to party panel
          panelDefs.party?._render?.();
        }
        save();this._render();
      });
      inp.addEventListener('click',e=>e.stopPropagation());
    });
  },

  _addPartyToCombat(pi){
    const p=state.party[pi];
    if(state.combatants.find(c=>c.isPC&&c.id===p.id)){showToast(p.name+' already in combat');return;}
    const roll=d20()+p.init;
    // Use party member's id so we can sync back
    state.combatants.push({id:p.id,name:p.name,isPC:true,cls:p.cls||'fighter',hp:p.hp,hpMax:p.hpMax,ac:p.ac,initBonus:p.init,initiative:roll,conditions:[]});
    state.combatants.sort((a,b)=>b.initiative-a.initiative);
    if(!state.combatRound) state.combatRound=1;
    save();this._render();showToast(p.name+' added (rolled '+roll+')');
  },

  _removeFromCombatById(id){
    const i=state.combatants.findIndex(c=>c.id===id);
    if(i>=0){state.combatants.splice(i,1);save();this._render();}
  },

  _quickAdd(name,hp,ac,initMod){
    const existing=state.combatants.filter(c=>c.baseName===name).length;
    const displayName=existing?`${name} ${existing+1}`:name;
    if(existing===1){const oi=state.combatants.findIndex(c=>c.baseName===name);if(oi>=0)state.combatants[oi]={...state.combatants[oi],name:`${name} 1`};}
    state.combatants.push({id:uid(),name:displayName,baseName:name,isPC:false,cls:'enemy',hp,hpMax:hp,ac,initBonus:initMod,initiative:d20()+initMod,conditions:[]});
    state.combatants.sort((a,b)=>b.initiative-a.initiative);
    save();this._render();
  },

  _addPrompt(){
    const defaultInit=d20();
    showModal('⚔ Add Combatant',[
      {id:'name',  label:'Name',       type:'text',   value:'',  placeholder:'Bandit, Ogre...'},
      {id:'hp',    label:'HP',         type:'number', value:20,  min:1},
      {id:'ac',    label:'AC',         type:'number', value:12,  min:1},
      {id:'init',  label:'Initiative', type:'number', value:defaultInit},
    ],'Add to combat').then(r=>{
      if(!r||!r.name)return;
      state.combatants.push({id:uid(),name:r.name,isPC:false,cls:'enemy',hp:r.hp,hpMax:r.hp,ac:r.ac,initBonus:0,initiative:r.init,conditions:[]});
      state.combatants.sort((a,b)=>b.initiative-a.initiative);
      save();this._render();
    });
  },

  _remove(i){state.combatants.splice(i,1);save();this._render();},

  _rollAll(){
    // Roll/re-roll initiative for party members not yet in combat, add them
    state.party.forEach(p=>{
      const existing=state.combatants.find(c=>c.isPC&&c.name===p.name);
      if(existing){
        existing.initiative=d20()+p.init;
      } else {
        state.combatants.push({id:uid(),name:p.name,isPC:true,cls:p.cls,hp:p.hp,hpMax:p.hpMax,ac:p.ac,initBonus:p.init,initiative:d20()+p.init,conditions:[]});
      }
    });
    // Re-roll enemies too
    state.combatants.filter(c=>!c.isPC).forEach(c=>{ c.initiative=d20()+(c.initBonus||0); });
    state.combatants.sort((a,b)=>b.initiative-a.initiative);
    state.combatRound=1;state.activeCombatantId=state.combatants[0]?.id||null;
    save();this._render();showToast('Initiative rolled for all');
  },

  _nextTurn(){
    if(!state.combatants.length){this._rollAll();return;}
    let id=state.activeCombatantId,round=state.combatRound;
    if(!id){id=state.combatants[0].id;round=Math.max(1,round);}
    else{
      let ni=state.combatants.findIndex(c=>c.id===id)+1;
      if(ni>=state.combatants.length){ni=0;round++;showToast(`Round ${round}`);}
      id=state.combatants[ni].id;
    }
    state.activeCombatantId=id;state.combatRound=round;save();this._render();
  },

  _end(){
    showModal('⚠ End Combat', [], 'End Combat').then(r=>{
      if(r===null)return;
      state.combatants=[];state.combatRound=0;state.activeCombatantId=null;save();this._render();
    });
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

  // Manage the quick-pick name list. Stored in state.settings.combatNameOptions
  // so it syncs to the rest of the campaign via skt-workspace-v1.
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
        // refocus the now-blank add input so the user can keep typing
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

  // Click an NPC's portrait to upload a custom image for that combatant only.
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

  addMonster(m){
    const initMod=m.dex?mod(m.dex):0;
    const existing=state.combatants.filter(c=>c.baseName===m.name).length;
    const displayName=existing?`${m.name} ${existing+1}`:m.name;
    if(existing===1){const oi=state.combatants.findIndex(c=>c.baseName===m.name);if(oi>=0)state.combatants[oi]={...state.combatants[oi],name:`${m.name} 1`};}
    // Use the monster's image as its portrait if 5etools fluff provided one.
    // _img is already 'img/...'-relative for non-monsters; for monster fluff the
    // path is bare (e.g. "bestiary/MM/Goblin.webp") and needs the prefix.
    let portrait = null;
    if (m._img) portrait = m._img.startsWith('img/') ? m._img : ('img/' + m._img);
    state.combatants.push({id:uid(),name:displayName,baseName:m.name,isPC:false,cls:'enemy',hp:m.hp,hpMax:m.hp,ac:m.ac,initBonus:initMod,initiative:d20()+initMod,conditions:[],portrait});
    state.combatants.sort((a,b)=>b.initiative-a.initiative);save();this._render();showToast(`Added ${displayName}`);
  },
});
