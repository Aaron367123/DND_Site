// ============================================================
// PLAYER VIEW
// ============================================================
// Activated by opening this same HTML file with ?player=1 in the URL.
//
// Reuses the regular workspace + panel system, gated to read-only and
// constrained to whatever panels the DM has shared via the 👁 button on
// each window. Live updates come through the same per-key Firebase sync
// the DM tab uses, so a remote player on their own laptop sees changes
// without any custom transport.

function _applySharedPanelsToPlayerView(){
  const desired = new Set(state.sharedPanels || []);
  const open = new Set(Array.from(document.querySelectorAll('.window[data-panel]'))
    .map(el => el.dataset.panel));

  // Open anything in `desired` that isn't already open.
  desired.forEach(id => {
    if (!open.has(id) && panelDefs[id]){
      // Mirror in `layout` so position/size are remembered, then mount.
      if (!layout[id]) layout[id] = (DEFAULT_LAYOUT[id] ? {...DEFAULT_LAYOUT[id]} : {x:40,y:40,w:480,h:520,open:true,minimized:false,z:1});
      layout[id] = {...layout[id], open:true, minimized:false};
      ensurePanel(id);
    }
  });
  // Close anything currently open that isn't in `desired`.
  open.forEach(id => {
    if (!desired.has(id)) closePanel(id);
  });

  // Empty-state placeholder
  const canvas = document.getElementById('workspace-canvas');
  if (!canvas) return;
  const empty = canvas.querySelector('#pv-empty');
  if (!desired.size && !empty){
    canvas.insertAdjacentHTML('beforeend',
      '<div id="pv-empty" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#666;font-size:14px;text-align:center;pointer-events:none">'
      + 'Waiting for the DM to share something…<br><br>'
      + '<span style="font-size:11px">Click the 👁 in any panel\'s title bar on the DM tab.</span>'
      + '</div>');
  } else if (desired.size && empty){
    empty.remove();
  }
}

function initPlayerView(){
  document.body.classList.add('player-mode');
  load();
  initRealtime();
  initZoomPan();
  _applySharedPanelsToPlayerView();
}
