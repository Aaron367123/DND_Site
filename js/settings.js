// ============================================================
// SETTINGS DRAWER
// ============================================================
function initSettings(){
  const drawer=document.getElementById('settings-drawer');
  document.getElementById('settings-btn').addEventListener('click',()=>drawer.classList.add('open'));
  document.getElementById('close-drawer').addEventListener('click',()=>drawer.classList.remove('open'));

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
