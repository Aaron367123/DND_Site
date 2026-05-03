// ============================================================
// SETTINGS DRAWER
// ============================================================
function initSettings(){
  const drawer=document.getElementById('settings-drawer');
  const settingsBtn=document.getElementById('settings-btn');
  settingsBtn.addEventListener('click',e=>{e.stopPropagation();drawer.classList.add('open');});
  document.getElementById('close-drawer').addEventListener('click',()=>drawer.classList.remove('open'));
  // Click outside the drawer closes it. stopPropagation on the open click and
  // on clicks inside the drawer keeps this from immediately re-closing.
  drawer.addEventListener('mousedown',e=>e.stopPropagation());
  document.addEventListener('mousedown',()=>{
    if(drawer.classList.contains('open')) drawer.classList.remove('open');
  });
  // Escape also closes
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape' && drawer.classList.contains('open')) drawer.classList.remove('open');
  });

  const sym=document.getElementById('currency-symbol');
  const jit=document.getElementById('price-jitter');
  const jval=document.getElementById('jitter-val');
  sym.value=state.settings.currencySymbol;
  jit.value=state.settings.priceJitter;
  jval.textContent=state.settings.priceJitter+'%';
  document.querySelectorAll('#rounding-group button').forEach(b=>b.classList.toggle('active',String(state.settings.rounding)===b.dataset.val));

  sym.addEventListener('change',()=>{state.settings.currencySymbol=sym.value||'gp';save();});
  jit.addEventListener('input',()=>{jval.textContent=jit.value+'%';});
  jit.addEventListener('change',()=>{state.settings.priceJitter=parseInt(jit.value);save();});
  document.querySelectorAll('#rounding-group button').forEach(btn=>btn.addEventListener('click',()=>{
    const v=btn.dataset.val==='none'?'none':parseInt(btn.dataset.val);
    document.querySelectorAll('#rounding-group button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');state.settings.rounding=v;save();
  }));

  // Per-user identity (local-only, drives per-line author coloring in Notes).
  const meName = document.getElementById('me-name');
  const meColor = document.getElementById('me-color');
  const me = _getMe();
  meName.value = me.name;
  meColor.value = me.color;
  function _persistMe(){
    const updated = { id: me.id, name: (meName.value || 'Player').trim(), color: meColor.value };
    me.name = updated.name; me.color = updated.color;
    try { localStorage.setItem('skt-me-v1', JSON.stringify(updated)); } catch(e) {}
    // Push the updated registry entry into the synced notes blob so other clients see it.
    panelDefs.notes && panelDefs.notes._touchSelf && panelDefs.notes._touchSelf();
  }
  meName.addEventListener('change', _persistMe);
  meColor.addEventListener('change', _persistMe);

  // Theme picker (presets + custom). Local-only, lives in localStorage.
  if (typeof initThemeControls === 'function') initThemeControls();

  // Window-snapping toggle.
  const snap = document.getElementById('snap-windows');
  if (snap) {
    snap.checked = state.settings.snapWindows !== false;
    snap.addEventListener('change', () => {
      state.settings.snapWindows = snap.checked;
      save();
    });
  }

  // Reprint policy — controls whether reprinted entries appear in search.
  const reprintPolicy = state.settings.reprintPolicy || 'all';
  document.querySelectorAll('#reprint-group button').forEach(b=>{
    b.classList.toggle('active', b.dataset.val === reprintPolicy);
  });
  document.querySelectorAll('#reprint-group button').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('#reprint-group button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    state.settings.reprintPolicy = btn.dataset.val;
    save();
    // Refresh the search popup if it's open so the change is visible immediately
    if (document.getElementById('search-popup')?.classList.contains('open')) {
      renderSearchTabs(); renderSearchResults();
    }
  }));

  document.getElementById('export-btn').addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify({party:state.party,combatants:state.combatants,combatRound:state.combatRound,activeCombatantId:state.activeCombatantId,shop:state.shop,settings:state.settings},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=Object.assign(document.createElement('a'),{href:url,download:`skt-${new Date().toISOString().slice(0,10)}.json`});
    a.click();URL.revokeObjectURL(url);showToast('Exported');
  });
  document.getElementById('import-btn').addEventListener('click',()=>document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change',e=>{
    const f=e.target.files[0];if(!f)return;
    const reader=new FileReader();
    reader.onload=ev=>{try{const d=JSON.parse(ev.target.result);if(Array.isArray(d.party))state.party=d.party;if(Array.isArray(d.combatants))state.combatants=d.combatants;if(typeof d.combatRound==='number')state.combatRound=d.combatRound;state.activeCombatantId=d.activeCombatantId??null;state.shop=d.shop??null;if(d.settings)state.settings={...state.settings,...d.settings};save();initPanels();showToast('Imported');}catch(err){alert('Invalid JSON: '+err.message);}};
    reader.readAsText(f);e.target.value='';
  });
  document.getElementById('reset-data-btn').addEventListener('click',()=>{
    showModal('⚠ Reset Everything?',[],'Reset to Defaults').then(r=>{
      if(r===null)return;
      state.party=JSON.parse(JSON.stringify(DEFAULT_PARTY));state.combatants=[];state.combatRound=0;state.activeCombatantId=null;state.shop=null;state.settings={...DEFAULT_SETTINGS};
      save();initPanels();showToast('Reset to defaults');
    });
  });
} // end initSettings
