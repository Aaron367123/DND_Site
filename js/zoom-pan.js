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

function _applyZoom(){
  const canvas = document.getElementById('workspace-canvas');
  if (!canvas) return;
  canvas.style.transform = `scale(${_zoom})`;
  const lbl = document.getElementById('zoom-reset');
  if (lbl) lbl.textContent = Math.round(_zoom*100)+'%';
  try { localStorage.setItem('skt-zoom-v1', String(_zoom)); } catch(e){}
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

function zoomIn(px, py){  setZoom(_zoom + ZOOM_STEP, px, py); }
function zoomOut(px, py){ setZoom(_zoom - ZOOM_STEP, px, py); }
function zoomReset(){     setZoom(1.0); }

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

  // Ctrl + wheel = zoom (centered on cursor)
  ws.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    if (e.deltaY < 0) zoomIn(e.clientX, e.clientY);
    else              zoomOut(e.clientX, e.clientY);
  }, { passive: false });

  // Pan: space-drag OR middle-mouse-drag on empty canvas
  let pan = null;
  let spaceHeld = false;
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      spaceHeld = true; ws.style.cursor = 'grab';
    }
    // Ctrl+0 / Ctrl+= / Ctrl+-
    if (e.ctrlKey || e.metaKey) {
      if (e.key === '0') { e.preventDefault(); zoomReset(); }
      if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomIn(); }
      if (e.key === '-') { e.preventDefault(); zoomOut(); }
    }
  });
  document.addEventListener('keyup', e => {
    if (e.code === 'Space') { spaceHeld = false; ws.style.cursor = ''; }
  });
  ws.addEventListener('mousedown', e => {
    const insideWindow = e.target.closest('.window');
    const isMiddle = e.button === 1;
    const isSpaceDrag = spaceHeld && e.button === 0;
    if (!isMiddle && !isSpaceDrag) return;
    if (insideWindow && !isMiddle) return;
    e.preventDefault();
    pan = { sx: e.clientX, sy: e.clientY, sl: ws.scrollLeft, st: ws.scrollTop };
    ws.style.cursor = 'grabbing';
  });
  document.addEventListener('mousemove', e => {
    if (!pan) return;
    ws.scrollLeft = pan.sl - (e.clientX - pan.sx);
    ws.scrollTop  = pan.st - (e.clientY - pan.sy);
  });
  document.addEventListener('mouseup', () => {
    if (pan) { pan = null; ws.style.cursor = spaceHeld ? 'grab' : ''; }
  });
}
