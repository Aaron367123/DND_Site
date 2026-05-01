// ============================================================
// NPC LIBRARY PANEL
// ============================================================
const DEFAULT_NPCS=[
  {id:'n1',name:'King Hekaton',role:'Storm King · Maelstrom',hp:230,ac:16,cr:'CR 13',attitude:'Imprisoned',tags:['giant','plot'],notes:'Ruler of the storm giants. Imprisoned by his daughters.',quirks:'Regal, weary, desperate to reclaim the ordning.',secret:'His scepter was stolen — whoever holds it commands his loyalty.'},
  {id:'n2',name:'Iymrith',role:'Ancient Blue Dragon · Antagonist',hp:481,ac:22,cr:'CR 22',attitude:'Hostile',tags:['dragon','bbeg'],notes:'Disguised as a storm giant elder. Orchestrated Hekaton\'s capture.',quirks:'Patient, manipulative, ancient cunning.',secret:'Has an alias as "the Doom of the Desert" among desert tribes.'},
  {id:'n3',name:'Zephyros',role:'Cloud Giant Wizard',hp:200,ac:14,cr:'CR 9',attitude:'Friendly',tags:['giant','ally'],notes:'Eccentric cloud giant who offers the party a ride in his tower.',quirks:'Distracted, talks to invisible spirits, generous.',secret:'His divinations have been deliberately clouded by Iymrith.'},
];
registerPanel('npclib',{
  title:'NPC Library',icon:'👤',
  _npcs:null,_expanded:null,
  mount(body){
    this._body=body;
    if(!this._npcs){try{const r=localStorage.getItem('skt-npcs-v1');this._npcs=r?JSON.parse(r):JSON.parse(JSON.stringify(DEFAULT_NPCS));}catch(e){this._npcs=JSON.parse(JSON.stringify(DEFAULT_NPCS));}}
    this._render();
  },
  unmount(){this._body=null;},
  _save(){try{localStorage.setItem('skt-npcs-v1',JSON.stringify(this._npcs));}catch(e){}},
  _render(){
    const b=this._body;if(!b)return;
    b.innerHTML=`
      <div style="display:flex;gap:6px;padding:8px;border-bottom:1px solid var(--border)">
        <input type="text" id="npc-search" placeholder="Search NPCs..." style="font-size:11px">
        <button class="btn small primary" id="npc-add">+ New NPC</button>
      </div>
      <div class="npc-list" id="npc-list">${this._renderList()}</div>`;
    b.querySelector('#npc-add').addEventListener('click',()=>{
      const n={id:uid(),name:'New NPC',role:'',hp:30,ac:12,cr:'CR 1',attitude:'Neutral',tags:[],notes:'',quirks:'',secret:''};
      this._npcs.unshift(n);this._expanded=n.id;this._save();this._render();
    });
    b.querySelector('#npc-search').addEventListener('input',e=>{
      const q=e.target.value.toLowerCase();
      b.querySelectorAll('.npc-card').forEach(card=>{card.style.display=card.dataset.name.includes(q)?'':'none';});
    });
    b.querySelectorAll('.npc-card').forEach(card=>{
      const id=card.dataset.id;
      card.querySelector('.npc-header').addEventListener('click',()=>{this._expanded=this._expanded===id?null:id;this._render();});
      if(this._expanded===id){
        const n=this._npcs.find(x=>x.id===id);if(!n)return;
        const wire=(sel,field,isNum)=>{const el=card.querySelector(sel);if(el)el.addEventListener('change',e=>{n[field]=isNum?(parseInt(e.target.value)||0):e.target.value;this._save();});};
        wire('#npc-name-'+id,'name');wire('#npc-role-'+id,'role');wire('#npc-hp-'+id,'hp',true);wire('#npc-ac-'+id,'ac',true);wire('#npc-cr-'+id,'cr');wire('#npc-att-'+id,'attitude');wire('#npc-notes-'+id,'notes');wire('#npc-quirks-'+id,'quirks');wire('#npc-secret-'+id,'secret');
        card.querySelector('#npc-tags-'+id)?.addEventListener('change',e=>{n.tags=e.target.value.split(',').map(t=>t.trim()).filter(Boolean);this._save();});
        card.querySelector('#npc-del-'+id)?.addEventListener('click',()=>{showModal('Delete NPC?',[],`Delete ${n.name}`).then(r=>{if(!r)return;this._npcs=this._npcs.filter(x=>x.id!==id);this._expanded=null;this._save();this._render();});});
        card.querySelector('#npc-to-combat-'+id)?.addEventListener('click',()=>{panelDefs.combat.addMonster({name:n.name,hp:n.hp,hpMax:n.hp,ac:n.ac,dex:10});showToast(`${n.name} added to combat`);});
      }
    });
  },
  _renderList(){
    return this._npcs.map(n=>{
      const exp=this._expanded===n.id;
      return`<div class="npc-card ${exp?'expanded':''}" data-id="${n.id}" data-name="${esc(n.name.toLowerCase())} ${esc((n.role||'').toLowerCase())}">
        <div class="npc-header">
          <div><div class="npc-name">${esc(n.name)}</div><div class="npc-role">${esc(n.role||'')}</div></div>
          <div style="display:flex;gap:4px;align-items:center">
            <span class="npc-tag">${esc(n.attitude||'')}</span>
            <span class="npc-tag">${esc(n.cr||'')}</span>
          </div>
        </div>
        <div class="npc-tags">${(n.tags||[]).map(t=>`<span class="npc-tag">${esc(t)}</span>`).join('')}</div>
        ${exp?`<div class="npc-body">
          <div class="npc-field"><label>Name</label><input type="text" id="npc-name-${n.id}" value="${esc(n.name)}" style="font-size:11px"></div>
          <div class="npc-field"><label>Role / Description</label><input type="text" id="npc-role-${n.id}" value="${esc(n.role||'')}" style="font-size:11px"></div>
          <div class="npc-stat-row">
            <div class="npc-stat-mini"><div class="l">HP</div><input type="number" id="npc-hp-${n.id}" value="${n.hp}" style="width:100%;background:transparent;border:none;text-align:center;font-weight:600;font-size:13px"></div>
            <div class="npc-stat-mini"><div class="l">AC</div><input type="number" id="npc-ac-${n.id}" value="${n.ac}" style="width:100%;background:transparent;border:none;text-align:center;font-weight:600;font-size:13px"></div>
            <div class="npc-stat-mini"><div class="l">CR</div><input type="text" id="npc-cr-${n.id}" value="${esc(n.cr||'')}" style="width:100%;background:transparent;border:none;text-align:center;font-weight:600;font-size:12px"></div>
          </div>
          <div class="npc-field"><label>Attitude</label>
            <select id="npc-att-${n.id}" style="font-size:11px"><option ${n.attitude==='Friendly'?'selected':''}>Friendly</option><option ${n.attitude==='Neutral'?'selected':''}>Neutral</option><option ${n.attitude==='Hostile'?'selected':''}>Hostile</option><option ${n.attitude==='Imprisoned'?'selected':''}>Imprisoned</option><option ${n.attitude==='Unknown'?'selected':''}>Unknown</option></select>
          </div>
          <div class="npc-field"><label>Tags (comma separated)</label><input type="text" id="npc-tags-${n.id}" value="${esc((n.tags||[]).join(', '))}" style="font-size:11px"></div>
          <div class="npc-field"><label>Notes</label><textarea id="npc-notes-${n.id}" style="min-height:60px">${esc(n.notes||'')}</textarea></div>
          <div class="npc-field"><label>Quirks / Personality</label><textarea id="npc-quirks-${n.id}" style="min-height:40px">${esc(n.quirks||'')}</textarea></div>
          <div class="npc-field"><label>🔒 Secret (DM only)</label><textarea id="npc-secret-${n.id}" style="min-height:40px;border-color:rgba(212,165,116,.3)">${esc(n.secret||'')}</textarea></div>
          <div style="display:flex;gap:6px;margin-top:6px">
            <button class="btn small primary" id="npc-to-combat-${n.id}">+ Add to combat</button>
            <button class="btn small danger" id="npc-del-${n.id}">Delete NPC</button>
          </div>
        </div>`:''}
      </div>`;
    }).join('');
  },
});
