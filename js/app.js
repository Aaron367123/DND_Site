// ============================================================
// INIT  —  build 20260524e
// ============================================================
// Bumped on every meaningful change so you can verify the new JS shipped:
//   open DevTools console and look for "[app] build 20260524e" — if you see
//   an older stamp, the browser is still serving cached app.js (hard-refresh
//   with Ctrl+Shift+R, or clear site cache in browser settings).
console.log('[app] build 20260524e loaded');
function initPanels(){
  ['combat','party','shop','notes','battlemap','npclib','npcgen','loot','encounter','soundboard','weather','time','bestiary','adventures','books'].forEach(id=>{
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
  // Build the player-view URL robustly. The naive `split('?')[0]+'?player=1'`
  // approach broke whenever the page URL had a `#fragment` (notes / onboarding
  // / scroll-into-view links sometimes add one): the result became
  // `...html#frag?player=1`, where the browser treats `player=1` as part of
  // the fragment instead of as a query string — `?player=1` never matched
  // and the new window booted into DM mode instead of player mode.
  const pvUrl = () => {
    try {
      const u = new URL(window.location.href);
      u.search = '?player=1';
      u.hash = '';
      return u.toString();
    } catch(e){
      // Last-resort fallback for very old browsers without URL constructor.
      return window.location.origin + window.location.pathname + '?player=1';
    }
  };
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
    const url = pvUrl();
    // Use a unique window name each click so the browser never reuses an
    // already-open 'skt-player' tab with its (possibly stale) URL — that
    // was causing the player view to come up looking like the DM view in
    // Opera GX's named-target reuse. A timestamped name forces a fresh
    // window with the correct ?player=1 URL every click.
    const target = 'skt-player-' + Date.now();
    const w = window.open(url, target, 'width=1280,height=720,noopener');
    if (!w){
      showToast('Allow popups to open player view');
      return;
    }
    // Belt-and-suspenders: force-navigate the new window to the URL in case
    // the browser preserved the parent's URL when the popup was blocked then
    // un-blocked, or when 'noopener' lost the reference.
    try { if (w && !w.closed && w.location && w.location.href !== url) w.location.href = url; } catch(_){}
    showToast('Player view opened');
  });
  // Right-click = copy link only.
  pvBtn?.addEventListener('contextmenu', e => { e.preventDefault(); copyPvLink(); });
  pvBtn?.setAttribute('title', 'Open player view (Shift-click or right-click to copy the share link)');
  document.getElementById('reset-layout-btn').addEventListener('click',()=>{
    showConfirm('Reset window layout to defaults?', {title:'Reset layout', confirmLabel:'Reset'}).then(ok=>{
      if(!ok) return;
      layout=JSON.parse(JSON.stringify(DEFAULT_LAYOUT));saveLayout();
      ['combat','party','shop','notes','battlemap','npclib','npcgen','loot','encounter','soundboard','weather','time','bestiary','adventures','books'].forEach(id=>{
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
  initServiceWorker();
  // Rolling local snapshots. Starts its own timer; the first fires a minute
  // in, so it never competes with boot. Player view doesn't need it — it
  // holds no authoritative state of its own.
  if (window.sktBackup && !document.body.classList.contains('player-mode')){
    try { sktBackup.autosave.start(); } catch(e){ console.warn('[backup] autosave unavailable', e); }
  }
}

// ─── Service worker ──────────────────────────────────────────────────────────
// Gives the app offline support (it's a table-side tool — basement wifi is a
// real failure mode) and lets hashed assets be cached hard while the HTML
// stays network-first, so a new build can never be masked by a stale cache.
//
// The update flow is deliberately NOT automatic: a new worker installs and
// then WAITS, and we surface a prompt instead of swapping code underneath a
// live session. That prompt doubles as the fix for version skew — a device
// running old code writes old-shaped sync data, and until now nothing told
// anyone they were behind.
function initServiceWorker(){
  if (!('serviceWorker' in navigator)) return;
  // file:// has no SW support and the preview/dev flow doesn't need it.
  if (location.protocol === 'file:') return;

  navigator.serviceWorker.register('sw.js').then(reg => {
    // Watch one worker to completion. The controller check distinguishes
    // "update to an existing install" from "very first install" — only the
    // former deserves a reload prompt.
    const track = sw => {
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(reg);
      });
    };
    // Detecting "an update is ready" is racy: by the time register() resolves
    // the new worker may not have been fetched yet, may be mid-install, or may
    // already be waiting — and 'updatefound' can fire before we can attach a
    // listener. Rather than rely on catching one specific moment, watch every
    // entry point AND re-check a few times over the first few seconds. The
    // prompt is idempotent (see promptUpdate), so overlapping paths are safe.
    let prompted = false;
    const checkWaiting = () => {
      if (prompted) return;
      if (reg.waiting && navigator.serviceWorker.controller){ prompted = true; promptUpdate(reg); }
    };
    checkWaiting();                                                   // already waiting
    track(reg.installing);                                            // install in flight
    reg.addEventListener('updatefound', () => track(reg.installing)); // install starts later
    [1000, 3000, 8000].forEach(ms => setTimeout(checkWaiting, ms));   // backstop

    // Long sessions: re-check for a new build when the tab regains focus, so
    // a device left open overnight doesn't keep running (and syncing with)
    // stale code.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(()=>{});
    });
  }).catch(err => console.warn('[SKT] service worker registration failed:', err));

  // The new worker took over → reload once so the page runs the new code.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

let _updatePrompted = false;
function promptUpdate(reg){
  if (_updatePrompted) return;   // several detection paths can reach here
  _updatePrompted = true;
  console.info('[SKT] a new build is available — prompting to reload.');
  if (typeof showToast !== 'function'){ console.info('[SKT] update available — reload to apply.'); return; }
  showToast('A new version is available.', {
    action: {
      label: 'Reload',
      run: () => {
        // Tell the waiting worker to take over; controllerchange reloads us.
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        else location.reload();
      },
    },
  });
}

init();
