// ============================================================
// INIT
// ============================================================
function initPanels(){
  ['combat','party','shop','notes','battlemap','npclib','npcgen','loot','encounter','soundboard','weather','time','bestiary'].forEach(id=>{
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
  const pvUrl = () => window.location.href.split('?')[0]+'?player=1';
  const copyPvLink = async () => {
    const url = pvUrl();
    try {
      await navigator.clipboard.writeText(url);
      showToast('Player link copied');
    } catch(_) {
      // Fallback when clipboard API isn't available (e.g. http://, older browsers)
      const ta = document.createElement('textarea');
      ta.value = url; ta.style.cssText='position:fixed;top:-9999px';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); showToast('Player link copied'); }
      catch(_2){ prompt('Copy this link:', url); }
      ta.remove();
    }
  };
  const pvBtn = document.getElementById('player-view-btn');
  pvBtn?.addEventListener('click', e => {
    // Shift+click = copy link without opening a window.
    if (e.shiftKey){ copyPvLink(); return; }
    const w = window.open(pvUrl(),'skt-player','width=1280,height=720');
    if(!w) showToast('Allow popups to open player view');
    else   showToast('Player view opened');
  });
  // Right-click = copy link only.
  pvBtn?.addEventListener('contextmenu', e => { e.preventDefault(); copyPvLink(); });
  pvBtn?.setAttribute('title', 'Open player view (Shift-click or right-click to copy the share link)');
  document.getElementById('reset-layout-btn').addEventListener('click',()=>{
    showConfirm('Reset window layout to defaults?', {title:'Reset layout', confirmLabel:'Reset'}).then(ok=>{
      if(!ok) return;
      layout=JSON.parse(JSON.stringify(DEFAULT_LAYOUT));saveLayout();
      ['combat','party','shop','notes','battlemap','npclib','npcgen','loot','encounter','soundboard','weather','time','bestiary'].forEach(id=>{
        const el=document.querySelector('.window[data-panel="'+id+'"]');
        if(el){if(panelDefs[id]?.unmount)panelDefs[id].unmount();el.remove();mounted.delete(id);}
      });
      Object.entries(layout).forEach(([id,l])=>{if(l.open)ensurePanel(id);});updateDock();
    });
  });
  Object.entries(layout).forEach(([id,l])=>{if(l.open)ensurePanel(id);});
  updateDock();
  initSearch();
  initSettings();
  initWorkspaceContextMenu();
  initZoomPan();
  if (typeof initOnboarding === 'function') initOnboarding();
}

init();
