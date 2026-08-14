// ============================================================
// PLAYER VIEW — boot
// ============================================================
// Activated by opening this same HTML file with ?player=1.
//
// This used to be the DM workspace with panels subtracted: floating windows
// gated by what the DM had shared, plus a pile of machinery to make that
// bearable on a phone — an at-most-one-panel invariant, a rotate-back
// ratchet, a scroll-hiding dock, a patched closePanel. All of it existed to
// fight the fact that a draggable workspace is the wrong shape for someone
// glancing at a phone at a table.
//
// It is now a boot file. The player's actual surface is js/player/player-app.js
// — one screen, a tab bar, and a character it knows is yours. Live updates
// arrive through the same per-key Firebase sync the DM tab uses.

// Belt-and-suspenders fullscreen sizing on mobile. CSS `dvh` covers most
// browsers but some embedded webviews still measure 100vh as the layout
// viewport, so push the real visible height into a variable the CSS consumes.
function _updatePlayerViewportVars(){
  if (!document.body.classList.contains('player-mode')) return;
  const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  const w = (window.visualViewport && window.visualViewport.width)  || window.innerWidth;
  document.documentElement.style.setProperty('--pv-vh', h + 'px');
  document.documentElement.style.setProperty('--pv-vw', w + 'px');
  // The floating search/settings pill is fixed at z-index 9000 over the
  // top-right corner. Measured from the element rather than assumed, so the
  // turn strip stops short of it instead of running underneath.
  const ft = document.getElementById('float-toolbar');
  const clear = ft ? Math.max(0, w - ft.getBoundingClientRect().left) + 8 : 0;
  document.documentElement.style.setProperty('--pv-topright', clear + 'px');
}

// Realtime calls these by name after applying a remote change. Both now mean
// the same thing — redraw the player screen — and are kept as separate names
// so the sync layer doesn't have to know the player view was rewritten.
function _applySharedPanelsToPlayerView(){ if (typeof paRender === 'function') paRender(); }
function _renderPlayerTurnBar(){ if (typeof paRender === 'function') paRender(); }

function initPlayerView(){
  document.body.classList.add('player-mode');
  load();
  initRealtime();
  if (typeof initSettings === 'function'){
    try { initSettings(); } catch(e){ console.warn('initSettings failed in player view', e); }
  }
  // Search stays: a player looking up a spell mid-turn is the single most
  // common thing they do that isn't their own character sheet.
  if (typeof initSearch === 'function'){
    try { initSearch(); } catch(e){ console.warn('initSearch failed in player view', e); }
  }
  initPlayerApp();
  // The bestiary/spell data the search needs, and the class data the
  // character screen reads for subclass features.
  if (typeof load5eData === 'function') load5eData();
  if (typeof on5eLoaded === 'function') on5eLoaded(() => { if (typeof paRender === 'function') paRender(); });

  _updatePlayerViewportVars();
  window.addEventListener('resize', _updatePlayerViewportVars);
  window.addEventListener('orientationchange', _updatePlayerViewportVars);
  if (window.visualViewport){
    window.visualViewport.addEventListener('resize', _updatePlayerViewportVars);
    window.visualViewport.addEventListener('scroll', _updatePlayerViewportVars);
  }
  // Same-browser DM tab and player tab: localStorage fires `storage` in the
  // other tab, which is the cheapest possible live link for the common
  // "second window on the same laptop" setup.
  window.addEventListener('storage', e => {
    if (!e.key || !/^skt-(combat|party|shared-panels|battlemap|settings)/.test(e.key)) return;
    const domain = e.key.includes('combat') ? 'combat'
                 : e.key.includes('party') ? 'party'
                 : e.key.includes('settings') ? 'settings' : null;
    if (domain && typeof loadDomain === 'function') loadDomain(domain);
    if (e.key.includes('shared-panels')){
      try { const a = JSON.parse(e.newValue || '[]'); if (Array.isArray(a)) state.sharedPanels = a; } catch(err){}
    }
    if (typeof paRender === 'function') paRender();
  });
}
