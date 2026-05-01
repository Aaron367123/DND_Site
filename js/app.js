// ============================================================
// INIT
// ============================================================
function initPanels(){
  ['combat','party','shop','notes','battlemap','npclib','npcgen','loot','encounter','soundboard'].forEach(id=>{
    const def=panelDefs[id];const b=document.getElementById('panel-body-'+id);
    if(b&&def)def.mount(b);
  });
}

function init(){
  // Check if this is the player view tab
  if(new URLSearchParams(location.search).get('player')==='1'){
    initPlayerView();
    return;
  }

  load();
  initRealtime();
  document.querySelectorAll('.dock-btn[data-panel]').forEach(btn=>btn.addEventListener('click',()=>togglePanel(btn.dataset.panel)));
  document.getElementById('reset-layout-btn').addEventListener('click',()=>{
    if(!confirm('Reset window layout?'))return;
    layout=JSON.parse(JSON.stringify(DEFAULT_LAYOUT));saveLayout();
    ['combat','party','shop','notes','battlemap','npclib','npcgen','loot','encounter','soundboard'].forEach(id=>{
      const el=document.querySelector('.window[data-panel="'+id+'"]');
      if(el){if(panelDefs[id]?.unmount)panelDefs[id].unmount();el.remove();mounted.delete(id);}
    });
    Object.entries(layout).forEach(([id,l])=>{if(l.open)ensurePanel(id);});updateDock();
  });
  Object.entries(layout).forEach(([id,l])=>{if(l.open)ensurePanel(id);});
  updateDock();
  initSearch();
  initSettings();
}

init();
