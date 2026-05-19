// ============================================================
// WORKSPACE ZOOM + PAN
// ============================================================
// The workspace is now a scrollable viewport containing a large
// canvas (5000x5000) that holds all windows. The canvas is scaled
// via CSS transform to implement zoom. Pan = native scrollbars,
// space-drag, or middle-mouse-drag.

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.1;

let _zoom = 1.0;

function getZoom(){ return _zoom; }

// Per-call hint: when true, the next _applyZoom adds a brief CSS transition
// so button/keyboard zoom changes ease instead of snapping. Wheel zoom
// keeps it false because cursor-anchor scroll math needs the new transform
// to be effective immediately or the point under the cursor drifts.
let _zoomSmoothNext = false;
let _zoomSmoothClearTimer = null;
function _applyZoom(){
  const canvas = document.getElementById('workspace-canvas');
  if (!canvas) return;
  if (_zoomSmoothNext){
    canvas.style.transition = 'transform .18s cubic-bezier(.22,.61,.36,1)';
    _zoomSmoothNext = false;
    if (_zoomSmoothClearTimer) clearTimeout(_zoomSmoothClearTimer);
    _zoomSmoothClearTimer = setTimeout(() => {
      // Strip the transition after the animation completes so subsequent
      // wheel-zooms remain instant for the cursor-anchor math.
      if (canvas) canvas.style.transition = '';
      _zoomSmoothClearTimer = null;
    }, 220);
  }
  canvas.style.transform = `scale(${_zoom})`;
  const lbl = document.getElementById('zoom-reset');
  if (lbl) lbl.textContent = Math.round(_zoom*100)+'%';
  try { localStorage.setItem('skt-zoom-v1', String(_zoom)); } catch(e){}
  // Zoom changes screen positions of every window; re-evaluate whether any
  // title bar now overlaps the floating top-right toolbar.
  if (typeof _updateToolbarOcclusion === 'function') _updateToolbarOcclusion();
}

// Set zoom while keeping the point under the cursor (or viewport center)
// stationary on screen.
function setZoom(target, pivotClientX, pivotClientY){
  target = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, target));
  if (Math.abs(target - _zoom) < 0.001) return;
  const ws = document.getElementById('workspace');
  if (!ws) { _zoom = target; _applyZoom(); return; }
  const r = ws.getBoundingClientRect();
  // Default pivot: viewport center
  if (pivotClientX == null) pivotClientX = r.left + r.width/2;
  if (pivotClientY == null) pivotClientY = r.top  + r.height/2;
  // Canvas-coord position under the pivot before zoom
  const cx = (ws.scrollLeft + (pivotClientX - r.left)) / _zoom;
  const cy = (ws.scrollTop  + (pivotClientY - r.top))  / _zoom;
  _zoom = target;
  _applyZoom();
  // Re-derive scroll position so the same canvas point is under the pivot
  ws.scrollLeft = cx * _zoom - (pivotClientX - r.left);
  ws.scrollTop  = cy * _zoom - (pivotClientY - r.top);
}

// Button/keyboard zoom paths — flag the next _applyZoom call to animate so
// the user gets a feel of "zooming" rather than a hard snap. `px`/`py` only
// supplied by wheel handlers, which skip this path.
function zoomIn(px, py){  _zoomSmoothNext = (px == null); setZoom(_zoom + ZOOM_STEP, px, py); }
function zoomOut(px, py){ _zoomSmoothNext = (px == null); setZoom(_zoom - ZOOM_STEP, px, py); }
function zoomReset(){     _zoomSmoothNext = true; setZoom(1.0); }

// Smooth-scroll the workspace so the bounding box of all open panels is
// centered. Useful when zoom or panning has lost the windows off-screen.
function zoomFitContent(){
  const ws = document.getElementById('workspace');
  if (!ws) return;
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity, count=0;
  Object.values(layout||{}).forEach(l => {
    if (!l || !l.open) return;
    minX = Math.min(minX, l.x);
    minY = Math.min(minY, l.y);
    maxX = Math.max(maxX, l.x + l.w);
    maxY = Math.max(maxY, l.y + l.h);
    count++;
  });
  if (!count) return;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  ws.scrollLeft = cx * _zoom - ws.clientWidth  / 2;
  ws.scrollTop  = cy * _zoom - ws.clientHeight / 2;
}

// Convert a clientX/Y (viewport) coordinate to canvas-space (un-zoomed,
// un-scrolled). Used by anything that places elements in the canvas.
function clientToCanvas(clientX, clientY){
  const ws = document.getElementById('workspace');
  if (!ws) return {x: clientX, y: clientY};
  const r = ws.getBoundingClientRect();
  return {
    x: (ws.scrollLeft + (clientX - r.left)) / _zoom,
    y: (ws.scrollTop  + (clientY - r.top))  / _zoom,
  };
}

function initZoomPan(){
  const ws = document.getElementById('workspace');
  if (!ws) return;

  // Restore persisted zoom
  try {
    const saved = parseFloat(localStorage.getItem('skt-zoom-v1'));
    if (!isNaN(saved)) _zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, saved));
  } catch(e){}
  _applyZoom();

  // Buttons
  document.getElementById('zoom-in') ?.addEventListener('click', () => zoomIn());
  document.getElementById('zoom-out')?.addEventListener('click', () => zoomOut());
  document.getElementById('zoom-reset')?.addEventListener('click', () => zoomReset());
  document.getElementById('zoom-fit')?.addEventListener('click', () => zoomFitContent());

  // Panning the workspace shifts every window's screen position relative to
  // the fixed top-right toolbar — re-check overlap on every scroll tick.
  ws.addEventListener('scroll', () => {
    if (typeof _updateToolbarOcclusion === 'function') _updateToolbarOcclusion();
  });
  // Browser window resize moves the fixed toolbar in screen space too.
  window.addEventListener('resize', () => {
    if (typeof _updateToolbarOcclusion === 'function') _updateToolbarOcclusion();
  });

  // Ctrl + wheel = zoom (centered on cursor)
  ws.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    if (e.deltaY < 0) zoomIn(e.clientX, e.clientY);
    else              zoomOut(e.clientX, e.clientY);
  }, { passive: false });

  // Pan: space-drag, middle-mouse drag, or right-click drag on empty canvas.
  // Right-click drag pans; a right-click without drag still opens the workspace
  // context menu (handled in context-menu.js). The contextmenu event is
  // suppressed during the same gesture if a drag occurred.
  let pan = null;
  let spaceHeld = false;
  let suppressNextContextMenu = false;
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      spaceHeld = true; ws.style.cursor = 'grab';
    }
    // `?` opens the keyboard-shortcut overlay. Ignored while typing in an
    // input/textarea/contenteditable so users can still type the literal
    // character in notes etc.
    if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey){
      const ae = document.activeElement;
      const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
      if (!typing && typeof window.showHelpOverlay === 'function'){
        e.preventDefault();
        window.showHelpOverlay();
        return;
      }
    }
    // Ctrl+0 / Ctrl+= / Ctrl+-
    if (e.ctrlKey || e.metaKey) {
      if (e.key === '0') { e.preventDefault(); zoomReset(); }
      if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomIn(); }
      if (e.key === '-') { e.preventDefault(); zoomOut(); }
      // Ctrl+Shift+A → auto-tile all open windows into a clean grid.
      // Defined on the global by window-manager.js.
      if (e.shiftKey && (e.key === 'A' || e.key === 'a') && typeof window.smartArrange === 'function'){
        e.preventDefault();
        window.smartArrange();
      }
    }
  });
  document.addEventListener('keyup', e => {
    if (e.code === 'Space') { spaceHeld = false; ws.style.cursor = ''; }
  });
  ws.addEventListener('mousedown', e => {
    const insideWindow = e.target.closest('.window');
    const isMiddle = e.button === 1;
    const isRight  = e.button === 2;
    const isSpaceDrag = spaceHeld && e.button === 0;
    if (!isMiddle && !isRight && !isSpaceDrag) return;
    // Inside a window: only middle-mouse pans (left/right belong to the window).
    if (insideWindow && !isMiddle) return;
    e.preventDefault();
    pan = { sx: e.clientX, sy: e.clientY, sl: ws.scrollLeft, st: ws.scrollTop, button: e.button, didDrag: false };
    ws.style.cursor = 'grabbing';
  });
  document.addEventListener('mousemove', e => {
    if (!pan) return;
    const dx = e.clientX - pan.sx, dy = e.clientY - pan.sy;
    if (!pan.didDrag && Math.abs(dx)+Math.abs(dy) < 3) return; // dead-zone
    pan.didDrag = true;
    ws.scrollLeft = pan.sl - dx;
    ws.scrollTop  = pan.st - dy;
  });
  document.addEventListener('mouseup', () => {
    if (!pan) return;
    // If the gesture was right-click + drag, suppress the contextmenu event
    // that's about to fire so the focus menu doesn't pop up at drag-end.
    if (pan.button === 2 && pan.didDrag) suppressNextContextMenu = true;
    pan = null;
    ws.style.cursor = spaceHeld ? 'grab' : '';
  });
  // Capture-phase contextmenu so this runs before the workspace-context-menu
  // handler in context-menu.js (both attach to ws). When suppressed, we
  // stopImmediatePropagation so the menu never opens.
  ws.addEventListener('contextmenu', e => {
    if (!suppressNextContextMenu) return;
    suppressNextContextMenu = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
}
