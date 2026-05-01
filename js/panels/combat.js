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
      const icon=c.isPC?(state.party.find(p=>p.id===c.id)?.icon||'⚔'):(CLASS_ICONS[c.cls]||CLASS_ICONS.enemy);
      const isPC=c.isPC;
      const bonus=c.initBonus||0;
      const bonusStr=bonus>0?'+'+bonus:bonus<0?String(bonus):'';
      return'<div class="combatant '+(active?'active':'')+' '+(dead?'dead':'')+'">'
        +'<div class="init-wrap" title="Edit initiative (double-click to reroll)">'
          +'<input class="init-input" type="number" value="'+c.initiative+'" data-ci="'+i+'" data-cf="initiative">'
          +(bonusStr?'<div class="init-bonus-tag">'+bonusStr+'</div>':'')
        +'</div>'
        +'<div class="portrait '+(isPC?'pc':'npc')+'" style="font-size:'+(isPC?'16':'')+'px">'+(isPC?icon:icon)+'</div>'
        +'<div class="info">'
          +'<div class="name">'+esc(c.name)+(active?'<span class="turn-marker">◀</span>':'')+'</div>'
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
      const icon=p.icon||'⚔';
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
    }));

    // Quick-add enemies
    b.querySelectorAll('[data-quick]').forEach(btn=>btn.addEventListener('click',e=>{
      e.stopPropagation();
      const[n,h,a,im]=btn.dataset.quick.split('|');
      this._quickAdd(n,+h,+a,+im);
    }));

    // Combatant stat inputs (hp, ac, initiative)
    b.querySelectorAll('input[data-cf]').forEach(inp=>{
      inp.addEventListener('change',e=>{
        const i=+e.target.dataset.ci, f=e.target.dataset.cf;
        const val=parseInt(e.target.value)||0;
        state.combatants[i]={...state.combatants[i],[f]:val};
        if(f==='initiative') state.combatants.sort((a,b2)=>b2.initiative-a.initiative);
        save();
        // Sync HP/AC back to party card if this is a PC
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

  applyCondition(cond){
    if(!state.activeCombatantId){showToast('No active combatant');return false;}
    const i=state.combatants.findIndex(c=>c.id===state.activeCombatantId);if(i<0)return false;
    const conds=state.combatants[i].conditions||[];
    if(!conds.includes(cond)){state.combatants[i]={...state.combatants[i],conditions:[...conds,cond]};save();this._render();}
    showToast(`${cond} → ${state.combatants[i].name}`);return true;
  },

  addMonster(m){
    const initMod=m.dex?mod(m.dex):0;
    const existing=state.combatants.filter(c=>c.baseName===m.name).length;
    const displayName=existing?`${m.name} ${existing+1}`:m.name;
    if(existing===1){const oi=state.combatants.findIndex(c=>c.baseName===m.name);if(oi>=0)state.combatants[oi]={...state.combatants[oi],name:`${m.name} 1`};}
    state.combatants.push({id:uid(),name:displayName,baseName:m.name,isPC:false,cls:'enemy',hp:m.hp,hpMax:m.hp,ac:m.ac,initBonus:initMod,initiative:d20()+initMod,conditions:[]});
    state.combatants.sort((a,b)=>b.initiative-a.initiative);save();this._render();showToast(`Added ${displayName}`);
  },
});
