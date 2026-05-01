// ============================================================
// WINDOW MANAGER
// ============================================================
const panelDefs={};
const mounted=new Set();
let zCounter=10;

function registerPanel(id,def){panelDefs[id]=def;}

function openPanel(id){
  layout[id]={...layout[id],open:true,minimized:false,z:++zCounter};
  saveLayout();ensurePanel(id);updateDock();
}
function closePanel(id){
  layout[id]={...layout[id],open:false};
  saveLayout();
  const el=document.querySelector(`.window[data-panel="${id}"]`);
  if(el){if(panelDefs[id]?.unmount)panelDefs[id].unmount();el.remove();mounted.delete(id);}
  updateDock();
}
function togglePanel(id){
  if(layout[id]?.open&&!layout[id]?.minimized)closePanel(id);else openPanel(id);
}
function focusPanel(id){
  layout[id]={...layout[id],z:++zCounter};saveLayout();
  document.querySelectorAll('.window').forEach(w=>w.classList.remove('focused'));
  const el=document.querySelector(`.window[data-panel="${id}"]`);
  if(el){el.classList.add('focused');el.style.zIndex=layout[id].z;}
}

function ensurePanel(id){
  if(mounted.has(id)){
    const el=document.querySelector(`.window[data-panel="${id}"]`);
    if(el){const l=layout[id];el.style.left=l.x+'px';el.style.top=l.y+'px';el.style.width=l.w+'px';el.style.height=l.h+'px';el.style.zIndex=l.z;el.classList.toggle('minimized',!!l.minimized);}
    return;
  }
  const def=panelDefs[id];if(!def)return;
  const l=layout[id]||{x:40,y:40,w:320,h:400,z:++zCounter,minimized:false};
  const ws=document.getElementById('workspace');
  const el=document.createElement('div');
  el.className='window'+(l.minimized?' minimized':'');
  el.dataset.panel=id;
  Object.assign(el.style,{left:l.x+'px',top:l.y+'px',width:l.w+'px',height:l.h+'px',zIndex:l.z});
  el.innerHTML=`<div class="window-head"><div class="window-title"><span class="window-title-icon">${def.icon||'◇'}</span><span>${def.title}</span></div><div class="window-actions"><button class="btn" data-wact="min">_</button><button class="btn" data-wact="close">✕</button></div></div><div class="window-body" id="panel-body-${id}"></div><div class="window-resize"></div>`;
  ws.appendChild(el);
  def.mount(el.querySelector('.window-body'));
  mounted.add(id);
  wireWindow(el,id);
}

function wireWindow(el,id){
  el.addEventListener('mousedown',()=>focusPanel(id));
  const head=el.querySelector('.window-head');
  const resizeEl=el.querySelector('.window-resize');
  let drag=null,rs=null;
  head.addEventListener('mousedown',e=>{if(e.target.closest('button'))return;const l=layout[id];drag={sx:e.clientX,sy:e.clientY,ox:l.x,oy:l.y};e.preventDefault();});
  document.addEventListener('mousemove',e=>{
    if(drag){const nx=Math.max(0,drag.ox+e.clientX-drag.sx),ny=Math.max(0,drag.oy+e.clientY-drag.sy);el.style.left=nx+'px';el.style.top=ny+'px';}
    if(rs){const nw=Math.max(240,rs.ow+e.clientX-rs.sx),nh=Math.max(120,rs.oh+e.clientY-rs.sy);el.style.width=nw+'px';el.style.height=nh+'px';}
  });
  document.addEventListener('mouseup',()=>{
    if(drag){layout[id]={...layout[id],x:parseInt(el.style.left),y:parseInt(el.style.top)};saveLayout();drag=null;}
    if(rs){layout[id]={...layout[id],w:parseInt(el.style.width),h:parseInt(el.style.height)};saveLayout();rs=null;}
  });
  resizeEl.addEventListener('mousedown',e=>{e.stopPropagation();const l=layout[id];rs={sx:e.clientX,sy:e.clientY,ow:l.w,oh:l.h};e.preventDefault();});
  el.querySelector('[data-wact="min"]').addEventListener('click',e=>{e.stopPropagation();const cur=layout[id]?.minimized;layout[id]={...layout[id],minimized:!cur};saveLayout();el.classList.toggle('minimized',!cur);});
  el.querySelector('[data-wact="close"]').addEventListener('click',e=>{e.stopPropagation();closePanel(id);});
}

function updateDock(){
  document.querySelectorAll('.dock-btn[data-panel]').forEach(btn=>{
    btn.classList.toggle('active',!!layout[btn.dataset.panel]?.open);
  });
}

// ============================================================
// PARTY <-> COMBAT SYNC HELPERS
// ============================================================
function syncPartyToCombat(partyIdx){
  // When party HP/AC changes, mirror to their combat slot if in combat
  const p=state.party[partyIdx];
  const ci=state.combatants.findIndex(c=>c.isPC&&c.id===p.id);
  if(ci>=0){
    state.combatants[ci]={...state.combatants[ci],hp:p.hp,hpMax:p.hpMax,ac:p.ac};
    panelDefs.combat?._render?.();
  }
}

function syncCombatToParty(combatantId){
  // When combat HP/AC changes, mirror to party card
  const c=state.combatants.find(x=>x.id===combatantId);
  if(!c||!c.isPC)return;
  const pi=state.party.findIndex(p=>p.id===c.id);
  if(pi>=0){
    state.party[pi]={...state.party[pi],hp:c.hp,hpMax:c.hpMax,ac:c.ac};
    panelDefs.party?._render?.();
  }
}
