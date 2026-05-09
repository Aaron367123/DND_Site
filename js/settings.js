// ============================================================
// SETTINGS DRAWER
// ============================================================

// Apply a global UI scale factor to everything inside the app shell using the
// CSS `zoom` property. This is the cleanest way to make text + buttons +
// windows all grow together: the browser handles every measurement (paddings,
// border widths, viewport coords) so no per-element math is needed. We
// deliberately set this on the body rather than `.app` so the settings
// drawer, modals, and popovers (which live outside `.app`) also scale.
function applyFontScale(scale){
  const s = Math.max(0.5, Math.min(2, scale || 1));
  document.body.style.zoom = s;
}

// Apply per-element visibility toggles by setting body classes that the CSS
// uses to hide the matching widget. Settings (⚙) and search (🔎) intentionally
// stay visible so the user can always return to this drawer.
function applyUiHide(uiHide){
  const u = uiHide || {};
  document.body.classList.toggle('hide-dock',          !!u.dock);
  document.body.classList.toggle('hide-player-view',   !!u.playerView);
  document.body.classList.toggle('hide-sync-status',   !!u.syncStatus);
  document.body.classList.toggle('hide-tutorial-btn',  !!u.tutorialBtn);
  document.body.classList.toggle('hide-zoom-controls', !!u.zoomControls);
  document.body.classList.toggle('hide-window-focus',  !!u.windowFocus);
}

function initSettings(){
  // Apply the saved font scale immediately, before any UI shows up, so the
  // page renders at the right size from the first paint.
  applyFontScale(state.settings.fontScale ?? 1);
  // Apply saved UI-visibility toggles too.
  applyUiHide(state.settings.uiHide || {});

  const drawer=document.getElementById('settings-drawer');
  const settingsBtn=document.getElementById('settings-btn');
  // Toggle on mousedown (not click) so the document-level "click outside to
  // close" handler below sees stopPropagation in time. Otherwise the document
  // closes the drawer first, then the button's click re-opens it on the same gesture.
  settingsBtn.addEventListener('mousedown',e=>{
    e.stopPropagation();
    drawer.classList.toggle('open');
  });
  document.getElementById('close-drawer').addEventListener('click',()=>drawer.classList.remove('open'));
  drawer.addEventListener('mousedown',e=>e.stopPropagation());
  document.addEventListener('mousedown',()=>{
    if(drawer.classList.contains('open')) drawer.classList.remove('open');
  });
  // Escape also closes
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape' && drawer.classList.contains('open')) drawer.classList.remove('open');
  });

  // Shop generator controls (currency symbol, price jitter, rounding) used to
  // live in this drawer; they were moved into the Shop Generator panel itself
  // via a small ⚙ button so the settings drawer focuses on global preferences.

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

  // Visibility toggles for chrome elements (sidebar, top-bar buttons, status).
  // Stored as `state.settings.uiHide.<key>` (true = hidden). Each checkbox
  // shows the OPPOSITE state to the user (checked = visible).
  const uiHide = state.settings.uiHide = state.settings.uiHide || {};
  const visControls = [
    { id:'show-dock',           key:'dock' },
    { id:'show-player-view',    key:'playerView' },
    { id:'show-sync-status',    key:'syncStatus' },
    { id:'show-tutorial-btn',   key:'tutorialBtn' },
    { id:'show-zoom-controls',  key:'zoomControls' },
    { id:'show-window-focus',   key:'windowFocus' },
  ];
  visControls.forEach(({id, key}) => {
    const cb = document.getElementById(id);
    if (!cb) return;
    cb.checked = !uiHide[key];
    cb.addEventListener('change', () => {
      uiHide[key] = !cb.checked;
      save();
      applyUiHide(uiHide);
    });
  });

  // Display font-scale — slider for the common range (80–150%) + number
  // input for arbitrary values (50–200%). Either control drives the other,
  // and both call applyFontScale via CSS `zoom`. The slider provides a live
  // preview during drag; release / blur commits to state.
  const fs  = document.getElementById('font-scale');
  const fsn = document.getElementById('font-scale-num');
  if (fs && fsn){
    const SLIDER_MIN = 80, SLIDER_MAX = 150;
    const NUM_MIN = 50, NUM_MAX = 200;
    const initPct = Math.round(((state.settings.fontScale ?? 1) * 100));
    fs.value  = String(Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, initPct)));
    fsn.value = String(initPct);

    // Mirror current value into both controls without re-firing each other.
    let _muting = false;
    const setBoth = (pct, opts={}) => {
      const clampedNum = Math.max(NUM_MIN, Math.min(NUM_MAX, pct));
      _muting = true;
      fsn.value = String(clampedNum);
      fs.value  = String(Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, clampedNum)));
      _muting = false;
      applyFontScale(clampedNum / 100);
      if (opts.commit){
        state.settings.fontScale = clampedNum / 100;
        save();
      }
    };

    // Slider: preview on input, commit on change.
    fs.addEventListener('input', () => { if (_muting) return; setBoth(parseInt(fs.value)); });
    fs.addEventListener('change', () => { if (_muting) return; setBoth(parseInt(fs.value), {commit:true}); });
    // Number input: only apply on blur / Enter, NOT on every keystroke. If
    // we previewed on `input`, typing "1" while replacing "200" with "100"
    // would briefly scale the page to 1% and make the input unreachable.
    // `change` fires on blur or Enter so the user can finish typing first.
    fsn.addEventListener('change', () => {
      if (_muting) return;
      const v = parseInt(fsn.value);
      if (!isNaN(v)) setBoth(v, {commit:true});
    });
    // Pressing Enter inside the number input should immediately commit
    // (without waiting for blur, which is what `change` would normally need).
    fsn.addEventListener('keydown', e => {
      if (e.key === 'Enter') fsn.blur();
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
    reader.onload=ev=>{try{const d=JSON.parse(ev.target.result);if(Array.isArray(d.party))state.party=d.party;if(Array.isArray(d.combatants))state.combatants=d.combatants;if(typeof d.combatRound==='number')state.combatRound=d.combatRound;state.activeCombatantId=d.activeCombatantId??null;state.shop=d.shop??null;if(d.settings)state.settings={...state.settings,...d.settings};save();applyFontScale(state.settings.fontScale??1);applyUiHide(state.settings.uiHide||{});initPanels();showToast('Imported');}catch(err){alert('Invalid JSON: '+err.message);}};
    reader.readAsText(f);e.target.value='';
  });
  document.getElementById('reset-data-btn').addEventListener('click',()=>{
    showModal('⚠ Reset Everything?',[],'Reset to Defaults').then(r=>{
      if(r===null)return;
      state.party=JSON.parse(JSON.stringify(DEFAULT_PARTY));state.combatants=[];state.combatRound=0;state.activeCombatantId=null;state.shop=null;state.settings={...DEFAULT_SETTINGS};
      save();applyFontScale(state.settings.fontScale??1);applyUiHide(state.settings.uiHide||{});initPanels();showToast('Reset to defaults');
    });
  });
} // end initSettings
