// ============================================================
// BATTLE MAP PANEL
// ============================================================
// Image stored in memory only — never localStorage (avoids freeze/quota)
let _mapBgImage = null; // holds the Image object

// Cached average luminance of the map art, used to pick a grid colour that
// contrasts with it. Computing it means resampling the whole image (3000x1905
// on the current map) down to 4x4 and reading it back — measured at 0.887ms,
// a third of _drawGrid's total cost, and _drawGrid runs on every render, every
// remote update and every fog repaint. The value only depends on the image.
//
// Keyed on the Image OBJECT, not the path: every load path assigns a brand new
// Image, so a different map is automatically a cache miss and there is no
// invalidation to forget. `lum: null` means "couldn't sample" (tainted canvas)
// and is cached too, so a failure doesn't retry the expensive resample forever.
let _bgLumCache = { img: null, lum: null };
function _bgLuminance(){
  if (!_mapBgImage) return null;
  if (_bgLumCache.img === _mapBgImage) return _bgLumCache.lum;
  let lum = null;
  try {
    const off = document.createElement('canvas'); off.width = 4; off.height = 4;
    const octx = off.getContext('2d');
    octx.drawImage(_mapBgImage, 0, 0, 4, 4);
    const d = octx.getImageData(0, 0, 4, 4).data;
    let t = 0;
    for (let i = 0; i < d.length; i += 4) t += (d[i]*299 + d[i+1]*587 + d[i+2]*114) / 1000;
    lum = t / 16;
  } catch(e){
    // Cross-origin image without CORS taints the canvas and getImageData
    // throws. Cache the failure so we stop paying for the resample.
    lum = null;
  }
  _bgLumCache = { img: _mapBgImage, lum };
  return lum;
}

registerPanel('battlemap',{
  title:'Battle Map',icon:'🗺',

  // Items added to the window's ⋯ menu — secondary/destructive actions live
  // here so the toolbar can stay focused on tools the DM uses every turn.
  // Player view sees only the non-destructive "Sync tokens" entry.
  menuItems(){
    const isPlayer = document.body.classList.contains('player-mode');
    const syncItem = { label: '↺ Sync tokens from Combat tracker', run: () => this._syncParty() };
    if (isPlayer) return [syncItem];
    return [
      { label: '📺 Open player view in new tab', run: () => {
        const url = window.location.href.split('?')[0]+'?player=1';
        const w = window.open(url,'skt-player','width=1280,height=720');
        if (!w && typeof showToast==='function') showToast('Allow popups to open player view');
        else if (typeof showToast==='function') showToast('Player view opened');
      } },
      syncItem,
      { label: '🗑 Clear all drawings', run: () => {
        if (!this._drawings.length) return;
        showConfirm('Erase every pencil annotation on this map?', {title:'Clear drawings', confirmLabel:'Clear', danger:true}).then(ok=>{
          if (!ok) return;
          this._drawings = [];
          this._saveMap();
          this._render();
        });
      } },
      { label: '✕ Clear all tokens', run: () => {
        showConfirm('Remove all tokens from the battle map?', {title:'Clear tokens', confirmLabel:'Remove', danger:true}).then(ok=>{
          if (!ok) return;
          this._tokens = []; this._selected = null;
          if (typeof this._closePanel === 'function') this._closePanel();
          this._saveMap(); this._render();
        });
      } },
    ];
  },

  _tokens:[], _tool:'', _selected:null,
  _cellSize:50, _cols:24, _rows:18,
  // Settings sidebar state — toggles persisted via _saveMap.
  _settingsOpen:false,
  _mapRotation:0,                // 0 / 90 / 180 / 270
  // How much ground one cell covers. Was INFERRED from the cell's pixel
  // size via {40:5,50:5,64:5,80:10} — a table that only matched the app's
  // own preset grids, so any map aligned with the Align tool (fractional
  // cell size, 38.46 on the current one) missed it and silently got 5 ft.
  // On an overland map that is not a rounding error, it is three orders of
  // magnitude: the footer read "390x250 ft" for a map of the North.
  _ftPerCell: 5,
  _fogHardness:50,               // 0–100 → blur on fog canvas
  _gridOpacity:60,               // 0–100 → grid line alpha
  // Grid line colour. null = Auto: sample the map art and pick black or white
  // for contrast (see _drawGrid). A '#rrggbb' string overrides that. Kept
  // nullable rather than defaulting to a hex so Auto stays a real state — a
  // stored '#ffffff' would silently disable adaptation on dark-then-light maps.
  _gridColor:null,
  _gridWidth:1,                  // 1–4 px grid line thickness (shared — syncs to player view)
  _tokensVisible:true, _namesVisible:true, _pcsVisible:true, _npcsVisible:true,
  _fogPaintMode:'reveal',        // 'reveal' | 'hide' — replaces the boolean _fogTool
  _fogBrushMode:'grid',          // 'grid' (snap to cells) | 'free' (pixel-level)
  _fogBrushShape:'square',       // 'square' | 'circle'
  _fogStrokes:[],                // free-mode strokes, cell-fraction coords
  // Grid alignment offset (image-pixel space at scale 1). Lets the overlay
  // grid line up with a printed grid on the loaded map. Two-click alignment
  // tool sets these.
  _gridOffsetX:0, _gridOffsetY:0,
  _alignFirstClick:null,   // {ix, iy} in natural image-pixel coords
  _bgColor:'#1a2a1a',
  _drag:null,
  // Fog of war: Set of "col,row" strings that are REVEALED
  _fog: null,        // null = fog disabled, Set = fog enabled
  _fogTool: false,   // true when in fog-paint mode
  _fogRadius: 1,     // brush radius in cells
  _isPainting: false,
  // Path of the currently chosen 5etools adventure map (relative to img/),
  // e.g. "adventure/DIP/004-map-phandalin.webp". Persisted; image is loaded
  // on mount.
  _bgMapPath: null,
  // Whether to draw the grid overlay. Some 5etools maps already have a grid
  // baked into the image — the user can hide ours so the two don't clash.
  _showGrid: true,
  // Grid style: 'square' (classic) | 'hex' (flat-top hexagons) | 'none'.
  // Persisted; back-compat — loaded from `showGrid` when absent.
  _gridType: 'square',
  // Cell-highlight overlay: when true, paints a translucent fill on the cell
  // under the cursor (square or hex). Helps the DM call out the targeted
  // square in theater-of-the-mind moments. Persisted.
  _cellHighlight: false,
  // Runtime-only hover cell tracker (not persisted). For square grids this is
  // {col,row}; for hex grids it's {q,r} axial coords.
  _hoverCell: null,
  // WORLD scale. 1 = natural pixel size. Synced — and, crucially, it defines
  // the units that token x/y and drawing points are stored in (see
  // _scaleTokensTo). It is therefore FROZEN during normal use: only a map
  // swap or a saved-map restore may change it. Zooming does NOT touch it;
  // that's _viewScale below.
  _bgMapScale: 1,
  // VIEW scale — this device's own zoom, layered on top of _bgMapScale as a
  // CSS transform. Per-device and per-window-role, never synced, never
  // written by _saveMap. A phone can sit at 3x while a desktop sits at 0.5x
  // and their token coordinates still agree, because neither one rewrote
  // them. Effective on-screen scale = _bgMapScale * _viewScale.
  _viewScale: 1,
  // True until this device has fitted the CURRENT map. Set in mount() when
  // the stored view state is for a different map than the one now loaded.
  _pendingRefit: false,
  // Whether token drops snap to the cellSize grid. Default off — free movement
  // works better with maps that have their own printed grids. Persisted.
  _snapToGrid: false,
  // Bg scale that token positions are currently aligned to. Tracks _bgMapScale
  // at the moment of the last token-scale adjustment, so `_scaleTokensTo` can
  // compute the correct ratio even across multiple scale changes.
  _lastTokenScale: 1,
  // True when the current scale was set by Fit/auto-fit (vs. wheel/slider).
  // Used by the ResizeObserver to decide whether a panel resize should re-fit
  // the map: if the user manually zoomed, don't yank them back to fit.
  _isFitted: false,
  _resizeObserver: null,
  // Whether the toolbar is hidden to maximize map space. Persisted in localStorage.
  _toolbarHidden: (function(){ try { return localStorage.getItem('skt-bm-toolbar-hidden') === '1'; } catch(e){ return false; } })(),
  // Pencil annotations. Each entry is { c:color, s:size, p:[x1,y1,x2,y2,...] }
  // — a flat int array keeps the JSON small for Firebase/localStorage.
  _drawings: [],
  _drawColor: '#ff4040',
  _drawSize: 4,
  // Natural dimensions of the loaded image — derived from the Image object,
  // not persisted (re-read on next load).
  _bgMapNaturalW: 0,
  _bgMapNaturalH: 0,
  // Picker caches — survive panel re-renders, populated lazily.
  _adventures: null,
  _mapsByAdv: {},
  // Saved-maps library: [{id, name, ts, snapshot:{...}}]. Lets the DM keep
  // multiple full map states (tokens, fog, drawings, grid offset, etc.) and
  // bounce between them — tavern → ambush → dungeon → boss room — without
  // rebuilding each one. Persisted under its own localStorage key so it
  // doesn't bloat the active-map blob.
  _savedMaps: [],
  // Set of 5etools map paths the user has starred. Lets the DM build a
  // personal quick-access list of favorite adventure maps without scrolling
  // through 100+ adventures every session. Persisted as an array under its
  // own localStorage key.
  _starredMaps: null,

  mount(body){
    this._body=body;
    try{
      const raw=localStorage.getItem('skt-battlemap-v1');
      if(raw){const d=JSON.parse(raw);this._tokens=d.tokens||[];this._cellSize=d.cellSize||50;this._cols=d.cols||24;this._rows=d.rows||18;this._bgColor=d.bgColor||'#1a2a1a';
        if(d.fog){this._fog=new Set(d.fog);}else{this._fog=null;}
        this._bgMapPath = d.bgMapPath || null;
        this._showGrid = d.showGrid !== false; // default on
        // gridType new in v3 — fall back to legacy showGrid (square or none).
        this._gridType = d.gridType || (this._showGrid ? 'square' : 'none');
        // Keep the two in sync — 'square' or 'hex' both imply showGrid=true.
        this._showGrid = this._gridType !== 'none';
        this._cellHighlight = !!d.cellHighlight;
        this._bgMapScale = d.bgMapScale || 1;
        this._snapToGrid = !!d.snapToGrid;
        this._gridOffsetX = d.gridOffsetX || 0;
        this._gridOffsetY = d.gridOffsetY || 0;
        // Settings sidebar state (new in v2 — defaults preserve old look).
        this._mapRotation   = d.mapRotation   || 0;
        this._ftPerCell     = +d.ftPerCell > 0 ? +d.ftPerCell : 5;
        this._fogHardness   = (d.fogHardness   != null) ? d.fogHardness   : 50;
        this._gridOpacity   = (d.gridOpacity   != null) ? d.gridOpacity   : 60;
        this._gridColor     = d.gridColor || null;
        this._gridWidth     = (d.gridWidth     != null) ? d.gridWidth     : 1;
        this._tokensVisible = d.tokensVisible !== false;
        this._namesVisible  = d.namesVisible  !== false;
        this._pcsVisible    = d.pcsVisible    !== false;
        this._npcsVisible   = d.npcsVisible   !== false;
        this._fogPaintMode  = d.fogPaintMode || 'reveal';
        // Brush behavior: 'grid' snaps to cells (existing); 'free' is pixel-level.
        // Shape applies to both modes — 'square' keeps the original block stamp.
        this._fogBrushMode  = d.fogBrushMode  || 'grid';
        this._fogBrushShape = d.fogBrushShape || 'square';
        // Free-mode strokes — stored in cell-fraction coords so they survive zoom.
        // {xc, yc, r, op:'reveal'|'hide', shape:'square'|'circle'}
        this._fogStrokes    = Array.isArray(d.fogStrokes) ? d.fogStrokes : [];
      }
      // Migrate any tokens that still use grid-cell coords (gx, gy) to pixel
      // coords (x, y). New code stores tokens in stage pixels; the cellSize
      // grid is now optional/decorative.
      const cs0 = this._cellSize;
      this._tokens.forEach(t => {
        if (t.x == null && t.gx != null){
          const sz = t.size || 1;
          t.x = (t.gx + sz/2) * cs0;
          t.y = (t.gy + sz/2) * cs0;
        }
        delete t.gx; delete t.gy;
      });
      // Track the bg scale tokens are currently aligned to so future scale
      // changes can move them proportionally.
      this._lastTokenScale = this._bgMapScale || 1;
      // Pencil annotations
      this._drawings = Array.isArray(d.drawings) ? d.drawings : [];
    }catch(e){}
    // Saved-maps library — separate key so it survives independent of the
    // active-map blob. Stays an empty array on first run / corrupt JSON.
    try {
      const raw = localStorage.getItem('skt-battlemap-saved-v1');
      if (raw){
        const d = JSON.parse(raw);
        if (Array.isArray(d.saved)) this._savedMaps = d.saved;
      }
    } catch(e){}
    // Starred adventure-map paths — separate key; stored as an array but
    // held as a Set in memory for O(1) lookup during render.
    try {
      const raw = localStorage.getItem('skt-battlemap-starred-v1');
      const arr = raw ? JSON.parse(raw) : [];
      this._starredMaps = new Set(Array.isArray(arr) ? arr : []);
    } catch(e){ this._starredMaps = new Set(); }
    // Restore THIS window's zoom. Read here rather than in the panel object
    // literal (the _toolbarHidden idiom) because body.player-mode is added by
    // initPlayerView() long after this file parses — reading at parse time
    // would always pick the DM key, so a player window would inherit the DM's
    // zoom on every load.
    const _vs = this._loadViewState();
    this._viewScale = (_vs && _vs.v > 0) ? _vs.v : 1;
    // Re-fit if the stored zoom was chosen for a different map — e.g. this
    // device was closed while the DM swapped maps. Otherwise a phone reopens
    // showing a corner of a map it has never fitted.
    //
    // ALSO re-fit whenever the stored zoom came from a Fit rather than from
    // the user, because a fit means "fill THIS viewport" and is worthless once
    // the viewport differs. Storing only the path let a fit computed against a
    // 1207x784 box be restored into a 373x555 phone: measured 0.402 where the
    // correct fit was 0.120, i.e. the map rendered 3.3x too big, and it stuck
    // because nothing ever invalidated it. `f` is absent on states written
    // before this, so treat missing as a fit — that repairs existing devices
    // on their next open. A MANUAL zoom is a deliberate choice and is kept.
    const _wasFit = !_vs || _vs.f !== false;
    this._pendingRefit = !_vs || _vs.p !== (this._bgMapPath || '') || _wasFit;
    // Undo baseline = the state as loaded. Set before the first _saveMap so
    // the first edit of a session has something to return to.
    this._undoStack.length = 0; this._redoStack.length = 0;
    this._lastCommitted = this._undoSnapshot();
    // Catch up on anyone added to the tracker while this panel was closed.
    // The save()-driven reconciler skips a fight whose map has never been
    // created — there is nowhere to put a token before a map exists — and
    // the roster signature then stops it retrying. Opening the map is that
    // moment, so it forces a pass regardless of the signature.
    if (typeof sktEnsureCombatTokens === 'function'){
      try { sktEnsureCombatTokens(true); } catch(e){}
    }
    this._render();
    if (this._bgMapPath) this._loadBgFromPath(this._bgMapPath, this._pendingRefit);
    this._startBroadcast();
    this._startUndoKeys();
    // Watch the panel body for size changes (window resize). When the map is
    // currently in "fit" mode, re-fit on resize so it always fills the new
    // viewport. Doesn't interfere with manual wheel/slider zoom — _isFitted
    // is false in that case.
    if (typeof ResizeObserver === 'function'){
      if (this._resizeObserver) this._resizeObserver.disconnect();
      let _resizeTimer = null;
      this._resizeObserver = new ResizeObserver(() => {
        if (!this._isFitted || !_mapBgImage) return;
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(() => this._fitMapToView(), 80);
      });
      this._resizeObserver.observe(body);
    }
  },
  unmount(){
    if (this._resizeObserver){ this._resizeObserver.disconnect(); this._resizeObserver = null; }
    if (this._docMouseUp){ document.removeEventListener('mouseup', this._docMouseUp); this._docMouseUp = null; }
    // Drop any queued repaint — its callback would run against a torn-down body.
    if (this._rafPending){
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._rafPending);
      else clearTimeout(this._rafPending);
      this._rafPending = null; this._dirty = {};
    }
    this._saveMap();
    this._stopBroadcast();
    this._stopUndoKeys();
    // Would otherwise fire against a torn-down body.
    clearTimeout(this._requalityTimer); this._requalityTimer = null;
    if (this._scrollRaf){
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._scrollRaf);
      this._scrollRaf = null;
    }
    // The scroll listener is on #map-scroll, which dies with the body, but
    // drop the reference so a later mount rebinds cleanly.
    this._onScrollBound = null;
    this._body = null;
  },

  _saveMap(){
    // Undo is captured HERE rather than at each mutation site. There are 20+
    // places that change tokens/fog/drawings, every one of them ends in
    // _saveMap(), and hooking them individually would guarantee a missed one.
    // Snapshotting on commit also gets the granularity right for free: a fog
    // drag, a token drag and a pencil stroke each save once, at the end.
    this._captureUndo();
    try{
      const fogArr=this._fog?Array.from(this._fog):null;
      localStorage.setItem('skt-battlemap-v1',JSON.stringify({tokens:this._tokens,cellSize:this._cellSize,cols:this._cols,rows:this._rows,bgColor:this._bgColor,fog:fogArr,bgMapPath:this._bgMapPath,showGrid:this._showGrid,gridType:this._gridType,cellHighlight:this._cellHighlight,bgMapScale:this._bgMapScale,snapToGrid:this._snapToGrid,drawings:this._drawings,gridOffsetX:this._gridOffsetX,gridOffsetY:this._gridOffsetY,mapRotation:this._mapRotation,ftPerCell:this._ftPerCell,fogHardness:this._fogHardness,gridOpacity:this._gridOpacity,gridColor:this._gridColor,gridWidth:this._gridWidth,tokensVisible:this._tokensVisible,namesVisible:this._namesVisible,pcsVisible:this._pcsVisible,npcsVisible:this._npcsVisible,fogPaintMode:this._fogPaintMode,fogBrushMode:this._fogBrushMode,fogBrushShape:this._fogBrushShape,fogStrokes:this._fogStrokes}));
    }catch(e){
      // Fog sets and freehand strokes grow without bound on large maps — this
      // is a realistic place to hit the quota, and silently dropping the write
      // meant losing everything revealed this session.
      if (typeof warnStorageFailure === 'function') warnStorageFailure('battle map', e);
    }
    this._broadcast();
  },

  // ─── Undo / redo ───────────────────────────────────────────────────────────
  // Snapshot-based, not command-based: the undoable state is small (~20 KB
  // serialized) and inverse-operations for fog brushes and multi-cell drags
  // would be far more code and far easier to get subtly wrong.
  //
  // Deliberately covers CONTENT only — tokens, fog, fog strokes, drawings.
  // Grid size, alignment, rotation, zoom and the map image are excluded: Ctrl+Z
  // silently swapping the map back would be a worse surprise than not undoing.
  _undoStack: [],
  _redoStack: [],
  _lastCommitted: null,   // state as of the last save = the next undo target
  _undoRestoring: false,
  _UNDO_MAX: 30,

  _undoSnapshot(){
    return JSON.stringify({
      tokens: this._tokens || [],
      fog: this._fog ? Array.from(this._fog) : null,
      fogStrokes: this._fogStrokes || [],
      drawings: this._drawings || [],
    });
  },

  // Called at the top of _saveMap. Pushes the PREVIOUS committed state, so the
  // stack holds states to return to rather than states just created.
  _captureUndo(){
    const cur = this._undoSnapshot();
    if (this._undoRestoring){ this._lastCommitted = cur; return; }
    if (this._lastCommitted != null && this._lastCommitted !== cur){
      this._undoStack.push(this._lastCommitted);
      if (this._undoStack.length > this._UNDO_MAX) this._undoStack.shift();
      this._redoStack.length = 0;   // a new action invalidates the redo branch
      this._updateUndoButtons();
    }
    this._lastCommitted = cur;
  },

  _applyUndoSnapshot(s){
    let d; try { d = JSON.parse(s); } catch(e){ return false; }
    this._tokens     = d.tokens || [];
    this._fog        = d.fog ? new Set(d.fog) : null;
    this._fogStrokes = d.fogStrokes || [];
    this._drawings   = d.drawings || [];
    this._selected   = null;   // the selected token may no longer exist
    return true;
  },

  _undoRedo(back){
    const from = back ? this._undoStack : this._redoStack;
    const to   = back ? this._redoStack : this._undoStack;
    if (!from.length){
      if (typeof showToast === 'function') showToast(back ? 'Nothing to undo' : 'Nothing to redo');
      return;
    }
    const cur = this._undoSnapshot();
    const target = from[from.length - 1];
    // _undoRestoring keeps _captureUndo from treating this restore as a fresh
    // action — otherwise undo would push its own result and you could never
    // get further back than one step.
    this._undoRestoring = true;
    let ok = false;
    try {
      ok = this._applyUndoSnapshot(target);
      if (ok) this._saveMap();  // propagate: an undo should reach other devices
    } finally { this._undoRestoring = false; }
    // Move the stacks only once the restore has actually landed. This used to
    // pop `from` and push `to` up front and then bail on a parse failure,
    // which discarded the target step and left a bogus entry on the other
    // stack — the one state where undo history is worth being careful with.
    if (!ok) return;
    from.pop();
    to.push(cur);
    if (to.length > this._UNDO_MAX) to.shift();
    this._closePanel?.();
    // Force the token pass: _repaintLayers skips it when the hash matches, and
    // a restore must always redraw regardless of what the last hash was.
    this._lastTokenHash = null;
    this._repaintLayers({ drawings: true, tokens: this._tokens });
    this._updateUndoButtons();
  },
  _undo(){ this._undoRedo(true); },
  _redo(){ this._undoRedo(false); },

  // A remote change means the stack now describes a history that no longer
  // matches shared state — undoing across it would silently revert someone
  // else's work. Drop it and re-baseline instead.
  _resetUndoBaseline(){
    this._undoStack.length = 0;
    this._redoStack.length = 0;
    this._lastCommitted = this._undoSnapshot();
    this._updateUndoButtons();
  },

  _updateUndoButtons(){
    const b = this._body; if (!b) return;
    const u = b.querySelector('[data-mact="undo"]'), r = b.querySelector('[data-mact="redo"]');
    if (u){ u.disabled = !this._undoStack.length; u.style.opacity = this._undoStack.length ? '' : '.4'; }
    if (r){ r.disabled = !this._redoStack.length; r.style.opacity = this._redoStack.length ? '' : '.4'; }
  },

  // Ctrl+Z / Ctrl+Shift+Z, scoped to the battle map window. Two guards matter:
  // the notes editor owns Ctrl+Z while you're typing in it, and several panels
  // have text inputs — so bail on any editable target, and require this
  // window to be the focused one (window-manager sets .focused on mousedown).
  _startUndoKeys(){
    this._stopUndoKeys();
    this._undoKeyHandler = (e) => {
      if (!(e.ctrlKey || e.metaKey) || (e.key !== 'z' && e.key !== 'Z')) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
      const win = this._body && this._body.closest('.window');
      if (!win || !win.classList.contains('focused')) return;
      e.preventDefault();
      if (e.shiftKey) this._redo(); else this._undo();
    };
    document.addEventListener('keydown', this._undoKeyHandler);
  },
  _stopUndoKeys(){
    if (this._undoKeyHandler){
      document.removeEventListener('keydown', this._undoKeyHandler);
      this._undoKeyHandler = null;
    }
  },

  // Load an image at img/{path} into _mapBgImage and refresh the canvas.
  // When autoFit is true (called from the picker), also fit the loaded image
  // to the panel viewport so the user gets a sensible default zoom.
  //
  // Loads are SEQUENCED and RETRIED. Two rapid picks used to race: whichever
  // image decoded last won, which for a big map beaten by a small one meant the
  // wrong art. And a single onerror was terminal — "Could not load map image"
  // with no way to tell a 404 from a poisoned cache entry from a CORS problem.
  _bgLoadSeq: 0,
  // Attempt ladder, in order. Each one addresses a different cause, so the map
  // only stays broken if all three fail.
  //   1. Plain CORS load — the normal path.
  //   2. Same thing after evicting the URL from every Cache Storage bucket.
  //      A service worker serving a bad cached entry is cache-FIRST, so it
  //      would otherwise keep serving it forever, including across reloads.
  //   3. Cache-busted and WITHOUT crossOrigin. If CORS itself is the problem
  //      this still shows the DM their map; the only casualty is _bgLuminance,
  //      which already treats a tainted canvas as "couldn't sample" and falls
  //      back to the default grid colour. A visible map beats a correct grid.
  _BG_ATTEMPTS: [
    { cors: true,  evict: false, bust: false },
    { cors: true,  evict: true,  bust: false },
    { cors: false, evict: false, bust: true  },
  ],
  // URL of the last load that exhausted the whole ladder. See fromSync below.
  _bgFailedUrl: null,
  // fromSync marks a reload triggered by an incoming Firebase/BroadcastChannel
  // update rather than by the DM. Those arrive on EVERY battlemap write — a fog
  // tick, a token nudge — and the tier that dispatches them re-enters on
  // `!this._bgMapNaturalW`, which a failed load never sets. So one unreachable
  // image turned into an unbounded reload loop: five identical ERR_FAILEDs in
  // the reported console, and 3× that once retries existed. A sync update for
  // the URL we just gave up on is therefore ignored. Any user action still
  // retries, because picking the same map again doesn't come through here, and
  // picking a different one has a different URL.
  _loadBgFromPath(path, autoFit, fromSync){
    const url = assetUrl(path);
    if (fromSync && url && url === this._bgFailedUrl) return;
    const seq = ++this._bgLoadSeq;
    this._bgAttempt(url, autoFit, seq, 0);
  },
  _bgAttempt(url, autoFit, seq, n){
    const plan = this._BG_ATTEMPTS[n];
    const img = new Image();
    img.onload = () => {
      // A newer pick started while this one was in flight — drop it on the
      // floor rather than overwriting the map the DM actually chose.
      if (seq !== this._bgLoadSeq) return;
      this._bgFailedUrl = null;
      _mapBgImage = img;
      this._bgMapNaturalW = img.naturalWidth;
      this._bgMapNaturalH = img.naturalHeight;
      // Pick the cell count / view scale for the new art…
      if (autoFit) this._fitMapToView();   // also runs _fitGridToBg internally
      else         this._fitGridToBg();
      // …then paint it. BOTH branches must do this.
      //
      // The autoFit branch used to skip it and lean on _fitMapToView, which
      // was fine while that ended in _applyZoomTransform — the old zoom
      // resized the stage in pixels, so it called _applyBg on the way past.
      // Per-device zoom replaced it with _applyViewScale, which only sets a
      // CSS transform and therefore has no reason to touch the background.
      // The repaint went with it, so choosing a map re-fitted the grid to the
      // new image's dimensions while leaving the PREVIOUS map's art on the
      // stage — an oversized grid hanging off the old picture, until the
      // window was closed and reopened (mount() re-renders from scratch).
      //
      // Only the DM's own window showed it: every other view receives the
      // change over BroadcastChannel or Firebase and re-renders on that path.
      const b = this._body;
      const stage = b && b.querySelector('#map-stage');
      if (stage){
        const cs = this._csScreen();
        this._applyBg(stage, this._cols*cs, this._rows*cs);
      }
      this._render();
    };
    img.onerror = () => {
      if (seq !== this._bgLoadSeq) return;
      if (n + 1 < this._BG_ATTEMPTS.length){
        this._bgAttempt(url, autoFit, seq, n + 1);
      } else {
        this._bgFailedUrl = url;
        this._reportBgFailure(url);
      }
    };
    // crossOrigin MUST be set before .src. While images are served
    // cross-origin it is also what keeps the response non-opaque, so
    // _bgLuminance can sample the art with getImageData() to pick a grid
    // colour that contrasts with the map, and so the service worker's
    // res.ok check passes and the map gets cached at all. Only the last-ditch
    // attempt drops it, and only because a tainted canvas degrades cleanly.
    if (plan.cors) img.crossOrigin = 'anonymous';
    const go = () => {
      if (seq !== this._bgLoadSeq) return;
      img.src = plan.bust ? url + (url.indexOf('?') === -1 ? '?' : '&') + 'cb=' + seq : url;
    };
    if (plan.evict) this._evictCached(url).then(go, go);
    else go();
  },

  // Drop one URL from every Cache Storage bucket we own. ignoreVary matters:
  // R2 answers with `Vary: Origin`, so a Request built from a bare URL string
  // does not match the stored one and the delete silently does nothing.
  async _evictCached(url){
    try {
      const names = await caches.keys();
      await Promise.all(names
        .filter(n => /^skt-/.test(n))
        .map(async n => { try { await (await caches.open(n)).delete(url, {ignoreVary:true}); } catch(e){} }));
    } catch(e){ /* no Cache Storage (private mode, old browser) — fine */ }
  },

  // Every attempt failed. An <img> error event carries no reason at all, so
  // probe the same URL with fetch(), which does, and put the answer somewhere
  // a report can quote instead of "it doesn't work".
  async _reportBgFailure(url){
    const bits = [];
    if (!navigator.onLine) bits.push('browser reports offline');
    try {
      const r = await fetch(url, { mode: 'cors', cache: 'no-store' });
      // statusText matters: the service worker converts a rejected fetch into a
      // synthetic 504 (so it doesn't log an unhandled rejection) and puts the
      // real reason there. Without this the toast would just say "HTTP 504".
      bits.push('HTTP ' + r.status + (r.statusText ? ' ' + r.statusText : '') + ' ' + r.type);
      // A fetch that succeeds where the <img> failed narrows it to the image
      // pipeline — decode, or a CORS check the fetch didn't have to satisfy.
      if (r.ok) bits.push('fetch OK but image decode failed');
    } catch (e){
      bits.push('fetch threw ' + ((e && e.name) || 'Error') + ': ' + ((e && e.message) || ''));
    }
    if (navigator.serviceWorker && !navigator.serviceWorker.controller) bits.push('no SW controller');
    const why = bits.join('; ');
    console.warn('[battlemap] map image failed after ' + this._BG_ATTEMPTS.length + ' attempts', url, why);
    showToast('Could not load map image — ' + why);
  },

  // Grow/shrink _cols and _rows so the grid covers the map at its current
  // displayed size. Called whenever a map is picked, the scale changes, or
  // the cell size changes. No-op when there's no map.
  // Cell count is anchored to the NATURAL image size — independent of zoom.
  // That way each grid cell continues to represent the same patch of map at
  // any scale; it just gets bigger or smaller on screen with the image.
  _fitGridToBg(){
    if (!_mapBgImage || !this._bgMapNaturalW) return;
    const cs = this._cellSize;
    this._cols = Math.max(8, Math.ceil(this._bgMapNaturalW / cs));
    this._rows = Math.max(6, Math.ceil(this._bgMapNaturalH / cs));
  },

  // ─── Per-device view zoom ──────────────────────────────────────────────────
  // Which localStorage key this window's zoom lives under. A DM workspace and
  // a ?player=1 window in the SAME browser share localStorage, so one key
  // would mean zooming your working view also moves the TV. Scope by role.
  // NOTE: must be called at runtime, not from the panel object literal —
  // body.player-mode is added by initPlayerView() long after this file parses.
  _viewKey(){
    return document.body.classList.contains('player-mode')
      ? 'skt-bm-view-player-v1' : 'skt-bm-view-v1';
  },
  // Stored as {p, v}: the map path the zoom was chosen for, and the zoom.
  // Keeping the path is what makes "re-fit when the map changes" work across
  // devices with no extra sync channel — each device notices the path it
  // saved against no longer matches and re-fits to its own screen.
  _loadViewState(){
    try {
      const raw = localStorage.getItem(this._viewKey());
      if (!raw) return null;
      const d = JSON.parse(raw);
      return (d && typeof d === 'object') ? d : null;
    } catch(e){ return null; }
  },
  _saveViewState(){
    // Silent on failure — this is a display preference. A quota error here
    // must never interrupt play with a toast.
    try {
      localStorage.setItem(this._viewKey(), JSON.stringify({
        p: this._bgMapPath || '', v: this._viewScale || 1,
        // Did this value come from a Fit, or did the user choose it? Only a
        // user's choice is worth restoring verbatim — see mount().
        f: !!this._isFitted,
      }));
    } catch(e){}
  },
  // Total screen pixels per stage pixel: the workspace's CSS scale() times
  // this device's map zoom. Every screen→stage conversion divides by this.
  _screenScale(){
    const z = (typeof getZoom === 'function') ? (getZoom() || 1) : 1;
    return z * (this._viewScale || 1);
  },
  // Max EFFECTIVE zoom. Touch devices get more headroom because the whole
  // point of this feature is a phone being able to read a token label on a
  // map that a desktop is happy viewing whole.
  _maxEff(){
    try {
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return 6;
    } catch(e){}
    return 3;
  },
  // Clamp a candidate _viewScale so the EFFECTIVE scale stays in range.
  // Clamping the view scale directly would give different limits depending on
  // what the frozen world scale happens to be for this map.
  _clampView(v){
    const bg = this._bgMapScale || 1;
    const lo = 0.1 / bg, hi = this._maxEff() / bg;
    return Math.max(lo, Math.min(hi, v || 1));
  },

  // On-screen pixel size of one grid cell — in STAGE pixels, i.e. before this
  // device's _viewScale is applied by the CSS transform. Deliberately unchanged
  // by the per-device zoom work: everything that reads it (grid drawing, fog,
  // cell hit-testing, the Align tool) operates in stage space, which is the
  // space stored coordinates live in.
  _csScreen(){
    return this._cellSize * (_mapBgImage ? (this._bgMapScale || 1) : 1);
  },

  // Screen → stage-pixel conversion that accounts for BOTH the workspace CSS
  // scale() and the stage's rotate() transform. getBoundingClientRect() on a
  // rotated element returns the axis-aligned bounding box, so plain
  // `clientX - rect.left` math swaps/flips axes at 90/180/270° — tokens
  // dragged right moved down, fog painted perpendicular cells, Align broke.
  // The bbox CENTER is rotation-invariant (transform-origin is 50% 50%), so
  // we measure from it, un-rotate, then shift back to top-left origin using
  // the element's UNROTATED size (canvas.width/height = stage pixels).
  // The per-device _viewScale is a uniform scale() on an ancestor, so it
  // changes exactly one thing here: the screen-px-per-stage-px factor. It
  // cannot affect the `+ W/2` shift, because el.width (canvas backing store)
  // and el.offsetWidth (layout size) are both UNTRANSFORMED. That is why this
  // single divisor is the whole coordinate change — see _screenScale().
  _stagePoint(clientX, clientY, el){
    // Always measure from #map-stage, whatever the caller passed. Nine of the
    // ten call sites hand in a CANVAS, which works only while every canvas is
    // exactly the stage's box — an invariant nothing enforces and which any
    // change to how layers are sized would silently break, taking draw, erase,
    // fog paint, token placement, Align and hover with it in one go. The
    // stage is the coordinate system these points are expressed in, so resolve
    // it here rather than trusting the argument. `el` remains the fallback for
    // a caller with no mounted body.
    const stage = (this._body && this._body.querySelector('#map-stage')) || el;
    const rect = stage.getBoundingClientRect();
    const z = this._screenScale();
    const cx = (clientX - (rect.left + rect.width  / 2)) / z;
    const cy = (clientY - (rect.top  + rect.height / 2)) / z;
    const d = this._stageDelta(cx, cy);
    // Stage dimensions come from STATE, never from the element. This used to
    // read el.width, which for a canvas is the BACKING STORE — fine while that
    // equalled the stage size, wrong the moment _sizeLayer started allocating
    // it at k× for high-zoom sharpness. Every element passed here (the grid
    // canvas, the draw canvas, the stage div) is exactly cols×cs by rows×cs,
    // so computing it is both exact and immune to how the layer is rasterised.
    const cs = this._csScreen();
    const W = this._cols * cs, H = this._rows * cs;
    return { x: d.x + W / 2, y: d.y + H / 2 };
  },
  // Rotate a screen-space delta into stage space (inverse of _mapRotation).
  // Used for both point conversion above and drag deltas.
  _stageDelta(dx, dy){
    const rot = (((this._mapRotation || 0) % 360) + 360) % 360;
    if (rot === 90)  return { x: dy,  y: -dx };
    if (rot === 180) return { x: -dx, y: -dy };
    if (rot === 270) return { x: -dy, y: dx  };
    return { x: dx, y: dy };
  },

  // ─── Canvas backing-store resolution ───────────────────────────────────────
  // The three map layers (grid, drawings, fog) are bitmaps sized in STAGE
  // pixels, and the per-device zoom is a CSS transform — so zooming past 100%
  // magnifies those bitmaps and the grid goes soft. Fix: allocate the backing
  // store at k× the stage size and scale the drawing context by k, so the
  // layers rasterise at display resolution. Coordinates are untouched; only
  // the resolution they're rasterised at changes.
  //
  // k is CAPPED, and the cap is the whole reason this is safe. Uncapped, a
  // 1617×1036 stage at 3× zoom on a 2× phone asks for k=6 — 60 MP per canvas,
  // ~240 MB each, ~720 MB across three. Browsers either refuse the allocation
  // or the tab dies. The budget below keeps the worst case at ~32 MB a layer.
  _CANVAS_MAX_PIXELS: 8e6,   // per layer (~32 MB at 4 bytes/px)
  _CANVAS_MAX_SIDE: 16384,   // hard browser limit on either dimension
  // Floor on the backing-store scale. Zoomed right out the canvas only needs
  // as many pixels as it occupies on screen; this just stops a pathological
  // zoom from allocating a buffer so small that the settle-time redraw has
  // nothing useful to show.
  _CANVAS_MIN_K: 0.2,
  _appliedK: 1,

  // Backing-store scale. The goal is ONE backing pixel per device pixel:
  // the canvas is CSS-sized in stage px and an ancestor applies
  // scale(viewScale), so the on-screen size is stage x viewScale x dpr.
  //
  // This used to clamp at >= 1 — "only ever add detail" — on the assumption
  // that extra resolution can't hurt. For thin line art it hurts a lot. At
  // 40% zoom the grid was drawn 3003px wide and downscaled by the browser to
  // ~1200, and resampling a 1px line by 0.4 spreads it across pixel
  // boundaries by an amount that differs per line. Measured over one row at
  // 40%: peak ink ranged from 14 to 230 out of 255, widths split evenly
  // between 1px and 2px, and one line of 39 disappeared altogether. Which
  // lines were faint changed as the zoom changed — the "haywire" grid.
  // Rendering at display resolution instead: 39/39 lines, every one exactly
  // 1px at full 255.
  //
  // Safe for every layer because all three are re-rasterised from state, not
  // resampled from a bitmap — the grid from _cols/_rows, pencil strokes from
  // their stored point arrays, fog from its cell grid. Dropping resolution
  // loses nothing recoverable; _requalityCanvases redraws on the way back up.
  _canvasK(W, H){
    if (!(W > 0 && H > 0)) return 1;
    const dpr = window.devicePixelRatio || 1;
    const want = (this._viewScale || 1) * dpr;
    return Math.max(this._CANVAS_MIN_K, Math.min(
      want,
      this._CANVAS_MAX_SIDE / Math.max(W, H),
      Math.sqrt(this._CANVAS_MAX_PIXELS / (W * H))
    ));
  },

  // Centre of what this device is currently LOOKING AT, in stage coordinates.
  //
  // Deliberately routed through _stagePoint rather than doing the arithmetic
  // here: that one function already accounts for the workspace zoom, the
  // per-device view scale and the stage's rotation, and it is the conversion
  // every pointer interaction uses. Reimplementing it would mean a second
  // copy of the rotation maths to keep in step — and the rotated cases are
  // exactly the ones that get silently wrong.
  //
  // Returns null when there's nothing sensible to measure.
  _viewCenterStage(){
    const b = this._body; if (!b) return null;
    const scroll = b.querySelector('#map-scroll'); if (!scroll) return null;
    const stage  = b.querySelector('#map-stage');  if (!stage)  return null;
    const r = scroll.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return null;
    const p = this._stagePoint(r.left + r.width / 2, r.top + r.height / 2, stage);
    if (!p || !isFinite(p.x) || !isFinite(p.y)) return null;
    return p;
  },

  // Pick a free cell centre at or near a stage point, spiralling outward so
  // adding the whole party doesn't stack everyone on one square. Clamped to
  // the map, so a view centre that sits off the edge still lands on it.
  //
  // The spiral itself is sktFreeCell() below, because the auto-token
  // reconciler has to place tokens with this panel CLOSED — at which point
  // there is no `this._tokens` to read, only the stored JSON. One copy of the
  // search, two callers.
  _freeCellNear(px, py){
    return sktFreeCell(this._tokens, this._cols, this._rows, this._csScreen(), px, py);
  },

  // The part of the stage currently on screen, in STAGE coordinates, or null
  // when the whole stage should be rasterised instead.
  //
  // Why this exists: the pixel budget is per layer, and a layer covering the
  // whole map burns it on area nobody is looking at. A 3003x1925 stage is
  // 5.8 MP, so the 8 MP budget caps k at 1.18 — meaning zooming to 275% just
  // upscales a 1.18x bitmap and the grid, strokes and fog all go soft. At that
  // zoom the viewport shows roughly 440x290 stage px, about 4% of the map, so
  // ~96% of those pixels were never visible. Sizing the layer to the viewport
  // instead lets k reach the full viewScale x dpr and stay well inside budget.
  //
  // Rotation is handled by mapping the viewport's four corners into stage
  // space and taking their bounding box. #map-stage rotates about its own
  // centre, so a corner at (zx, zy) in the un-scaled #map-zoom space becomes
  // _stageDelta(zx - W/2, zy - H/2) + (W/2, H/2) — the same conversion
  // _stagePoint uses, reused rather than re-derived. For the rotations this
  // panel supports (0/90/180/270, all _stageDelta implements) the rotated
  // viewport is still axis-aligned in stage space, so the bounding box is
  // exact rather than conservative.
  //
  // Returns null (⇒ keep the old full-stage behaviour) when:
  //   • the scroll container isn't measurable yet;
  //   • the whole stage already fits, where the two are equivalent anyway.
  _visibleStageRect(){
    const b = this._body; if (!b) return null;
    const scroll = b.querySelector('#map-scroll'); if (!scroll) return null;
    const vs = this._viewScale || 1;
    const cs = this._csScreen();
    const W = this._cols * cs, H = this._rows * cs;
    if (!(W > 0 && H > 0)) return null;
    const vw = scroll.clientWidth, vh = scroll.clientHeight;
    if (!(vw > 0 && vh > 0)) return null;

    if (this._mapRotation){
      // Viewport box in un-scaled #map-zoom coordinates.
      const zx0 = scroll.scrollLeft / vs,       zy0 = scroll.scrollTop / vs;
      const zx1 = (scroll.scrollLeft + vw) / vs, zy1 = (scroll.scrollTop + vh) / vs;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [zx, zy] of [[zx0,zy0],[zx1,zy0],[zx0,zy1],[zx1,zy1]]){
        const d = this._stageDelta(zx - W / 2, zy - H / 2);
        const px = d.x + W / 2, py = d.y + H / 2;
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
      }
      const padR = Math.max(cs, 64 / vs);
      let rx = Math.max(0, minX - padR), ry = Math.max(0, minY - padR);
      let rw = Math.min(W, maxX + padR) - rx, rh = Math.min(H, maxY + padR) - ry;
      if (!(rw > 0 && rh > 0)) return null;
      if (rx <= 0 && ry <= 0 && rw >= W && rh >= H) return null;   // covers it all
      return { x: rx, y: ry, w: rw, h: rh };
    }
    // scrollLeft/clientWidth are in SIZER units, which are stage x viewScale
    // (#map-scroll sits outside the map's transform). Divide to get stage px.
    const w = vw / vs, h = vh / vs;
    if (w >= W && h >= H) return null;          // whole stage visible
    // A margin either side so a small scroll doesn't expose unpainted canvas
    // before the scroll handler catches up.
    const pad = Math.max(cs, 64 / vs);
    let x = scroll.scrollLeft / vs - pad;
    let y = scroll.scrollTop  / vs - pad;
    let rw = w + pad * 2, rh = h + pad * 2;
    x = Math.max(0, Math.min(x, Math.max(0, W - rw)));
    y = Math.max(0, Math.min(y, Math.max(0, H - rh)));
    rw = Math.min(rw, W - x);
    rh = Math.min(rh, H - y);
    return { x, y, w: rw, h: rh };
  },

  // Size one layer and hand back a context already scaled by k, so every
  // existing draw call keeps working in stage coordinates unchanged.
  // `force` re-sizes even when dimensions match — needed after a k change,
  // since the backing store must be reallocated to change resolution.
  _sizeLayer(canvas, W, H, force){
    // Cover only what's on screen when that's a win (see _visibleStageRect),
    // otherwise the whole stage exactly as before.
    const vis = this._visibleStageRect();
    const cw = vis ? vis.w : W, ch = vis ? vis.h : H;
    const ox = vis ? vis.x : 0,  oy = vis ? vis.y : 0;
    const k = this._canvasK(cw, ch);
    const bw = Math.max(1, Math.round(cw * k)), bh = Math.max(1, Math.round(ch * k));
    if (force || canvas.width !== bw || canvas.height !== bh){
      // Assigning width/height reallocates AND resets all context state,
      // including the transform — so it has to be re-applied below.
      canvas.width = bw; canvas.height = bh;
    }
    // CSS size stays in stage px; the extra backing pixels are what buy the
    // sharpness. Without this the canvas would render k× too large.
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    canvas.style.left = ox + 'px';
    canvas.style.top  = oy + 'px';
    const ctx = canvas.getContext('2d');
    // The translate is what keeps EVERY existing draw call correct without
    // touching it: callers still work in stage coordinates and still clear
    // with (0, 0, stageW, stageH); anything outside the covered rect simply
    // falls off the canvas and is clipped, which is exactly what we want.
    ctx.setTransform(k, 0, 0, k, -ox * k, -oy * k);
    return ctx;
  },

  // Repaint the layers when the viewport moves over the map. Only meaningful
  // while the layers are viewport-sized; a full-stage layer already covers
  // wherever the user scrolled to. rAF-throttled — scroll fires far faster
  // than there is any point redrawing.
  _onMapScroll(){
    if (this._scrollRaf) return;
    this._scrollRaf = requestAnimationFrame(() => {
      this._scrollRaf = null;
      if (!this._body || !this._visibleStageRect()) return;
      // All three layers size and position themselves, so moving the viewport
      // just means asking each to repaint.
      const gridC = this._body.querySelector('#map-canvas');
      if (gridC) this._drawGrid(gridC, this._csScreen());
      this._drawAllStrokes();
      if (this._fog !== null) this._drawFog();
    });
  },

  // Re-rasterise every layer at the current zoom. Debounced by its callers:
  // reallocating three backing stores on each wheel tick would be far worse
  // than the moment of softness while the zoom settles.
  _requalityCanvases(){
    const b = this._body; if (!b) return;
    const k = this._canvasK(this._cols * this._csScreen(), this._rows * this._csScreen());
    // Ratio, not absolute difference. k now ranges roughly 0.2–3, and a fixed
    // 0.05 gap means "20% of the resolution" down at 0.2 but under 2% up at 3
    // — so the low end would sit at a stale resolution indefinitely.
    if (Math.abs(k - this._appliedK) / Math.max(k, this._appliedK) < 0.05) return;
    this._appliedK = k;
    const canvas = b.querySelector('#map-canvas');
    if (canvas) this._drawGrid(canvas, this._csScreen());
    const drawC = b.querySelector('#draw-canvas');
    if (drawC){
      this._sizeLayer(drawC, this._cols * this._csScreen(), this._rows * this._csScreen(), true);
      this._drawAllStrokes();
    }
    if (this._fog !== null) this._drawFog(true);
  },
  _scheduleRequality(){
    // The grid is redrawn IMMEDIATELY, not on the debounce. Now that k tracks
    // the zoom downwards as well as up, waiting would leave a canvas rendered
    // for the old scale stretched over the new one — and the grid is the one
    // layer where that reads as an obvious defect rather than mild softness.
    // It costs ~1 ms (measured) because it is only strokes, so there is no
    // reason to make it wait behind the two expensive layers.
    const b = this._body;
    const gridC = b && b.querySelector('#map-canvas');
    if (gridC) this._drawGrid(gridC, this._csScreen());
    clearTimeout(this._requalityTimer);
    this._requalityTimer = setTimeout(() => this._requalityCanvases(), 180);
  },

  _drawAllStrokes(){
    const b = this._body; if (!b) return;
    const canvas = b.querySelector('#draw-canvas'); if (!canvas) return;
    const cs = this._csScreen();
    // Size the layer HERE rather than trusting whatever transform was left on
    // it, matching _drawGrid and _drawFog which have always been
    // self-sufficient. This used to read the context directly, which was safe
    // only while the canvas always covered the whole stage — a stale transform
    // was still the right transform. Now that layers track the viewport, a
    // redraw after the view moved would paint every stroke at the previous
    // scroll offset. Four callers (the eraser, the remote-update repaint, the
    // live-stroke preview and the rAF flush) reach here without sizing first,
    // so the guarantee belongs in one place, not at each of them.
    //
    // Cheap to call repeatedly: _sizeLayer only reallocates when the backing
    // dimensions actually change, which is the same reason _drawFog can do it
    // on every fog-paint mousemove.
    const ctx = this._sizeLayer(canvas, this._cols * cs, this._rows * cs);
    // Clearing uses STAGE dimensions — canvas.width is k× larger and would be
    // scaled by k again, clearing k² the area.
    ctx.clearRect(0, 0, this._cols * cs, this._rows * cs);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const scale = this._bgMapScale || 1;
    (this._drawings||[]).forEach(s => {
      if (!s.p || s.p.length < 2) return;
      ctx.strokeStyle = s.c || '#ff4040';
      ctx.lineWidth = (s.s || 4) * scale;
      ctx.beginPath();
      ctx.moveTo(s.p[0], s.p[1]);
      for (let i = 2; i < s.p.length; i += 2) ctx.lineTo(s.p[i], s.p[i+1]);
      ctx.stroke();
    });
  },
  _drawStrokeIncremental(canvas, stroke){
    const ctx = canvas.getContext('2d');
    const p = stroke.p;
    if (p.length < 4) return;
    ctx.strokeStyle = stroke.c || '#ff4040';
    ctx.lineWidth = (stroke.s || 4) * (this._bgMapScale || 1);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p[p.length-4], p[p.length-3]);
    ctx.lineTo(p[p.length-2], p[p.length-1]);
    ctx.stroke();
  },

  // Distance from point (px,py) to the line segment (x1,y1)→(x2,y2).
  _distToSegment(px, py, x1, y1, x2, y2){
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx*dx + dy*dy;
    if (len2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx, cy = y1 + t * dy;
    return Math.hypot(px - cx, py - cy);
  },

  // Eraser hit-test: walk every stored stroke, check the cursor against each
  // segment. The first stroke whose closest segment is within the brush
  // radius gets removed and the canvas is repainted. Returns true on a hit.
  _eraseStrokeAt(x, y){
    if (!this._drawings || !this._drawings.length) return false;
    // Hit radius scales with the stroke width so thicker lines are also easier
    // to grab, plus a fixed grab affordance around it.
    //
    // The affordance has to be in SCREEN pixels, which is what the old comment
    // claimed ("8 screen-pixels regardless of zoom") and what the arithmetic
    // did not deliver: x/y arrive from _stagePoint in STAGE pixels, so a bare
    // 8 was 8 stage px and the on-screen slop moved with the zoom. Zoomed out
    // to 0.4 it shrank to ~3 screen px and erasing a thin line became a game
    // of pixel-hunting; zoomed in to 2.5 it grew to ~20 and grabbed lines the
    // cursor wasn't near. Dividing by the stage→screen factor holds it at a
    // constant on-screen size. (Listed as an optional one-liner in the
    // per-device zoom plan and never actually done.)
    //
    // The stroke's own half-width stays in world units on purpose — a thick
    // line really is thicker on the map.
    const scr = this._screenScale() || 1;
    for (let i = this._drawings.length - 1; i >= 0; i--){
      const s = this._drawings[i];
      const p = s.p; if (!p || p.length < 2) continue;
      const halfW = ((s.s || 4) * (this._bgMapScale || 1)) / 2;
      const radius = Math.max(8 / scr, halfW + 6 / scr);
      let hit = false;
      if (p.length === 2){
        // Single-point stroke (a dot).
        hit = Math.hypot(p[0] - x, p[1] - y) <= radius;
      } else {
        for (let j = 2; j < p.length; j += 2){
          if (this._distToSegment(x, y, p[j-2], p[j-1], p[j], p[j+1]) <= radius){
            hit = true; break;
          }
        }
      }
      if (hit){
        this._drawings.splice(i, 1);
        this._drawAllStrokes();
        return true;
      }
    }
    return false;
  },

  // Multiply every token's pixel position by (newScale / _lastTokenScale).
  // Keeps tokens in the same map-relative position when the bg image is
  // resized. _lastTokenScale tracks the scale tokens are currently aligned
  // to, so repeated calls compose correctly.
  // Display label for a token — strips multi-word PC names down to the
  // first name so "Zindle \"Deathwhistle\" Farrago" reads as just "Zindle"
  // on the map. The full label stays on t.label for party↔token matching
  // and the rename input in the token options panel.
  _tokenDisplayLabel(t){
    if (!t || t.label == null) return '';
    if (!t.isPC) return t.label;
    // Split on whitespace, drop empties, take the first chunk. Names like
    // "Sir Brody" still show "Sir" (the player's first word of choice);
    // if they want "Brody" they can rename via the token options panel.
    const first = String(t.label).trim().split(/\s+/)[0];
    return first || t.label;
  },

  _saveStarredMaps(){
    saveJson('skt-battlemap-starred-v1', [...(this._starredMaps || [])], 'starred maps');
  },

  // Toggle the starred state of a 5etools map path. Returns the new state
  // (true = now starred). Caller is responsible for updating the visual.
  _toggleStarredMap(path){
    if (!this._starredMaps) this._starredMaps = new Set();
    let nowStarred;
    if (this._starredMaps.has(path)){ this._starredMaps.delete(path); nowStarred = false; }
    else { this._starredMaps.add(path); nowStarred = true; }
    this._saveStarredMaps();
    return nowStarred;
  },

  // Render the "Starred" quick-access section in the map picker. Pulls map
  // metadata from `_allMaps` if it's already been indexed; otherwise renders
  // just the paths (title falls back to the filename slug). Returns '' when
  // nothing is starred yet so the modal stays compact for first-time users.
  _renderStarredMapsSection(){
    const set = this._starredMaps;
    if (!set || !set.size) return '';
    // Resolve each starred path to its full metadata if possible.
    const meta = new Map();
    if (Array.isArray(this._allMaps)){
      this._allMaps.forEach(m => meta.set(m.path, m));
    } else {
      // Fall back to whatever per-adventure caches happen to be populated.
      Object.values(this._mapsByAdv || {}).forEach(list => {
        (list || []).forEach(m => { if (!meta.has(m.path)) meta.set(m.path, m); });
      });
    }
    const cards = [...set].map(path => {
      const m = meta.get(path) || { path, title: path.split('/').pop().replace(/\.[^.]+$/, ''), type:'map' };
      // Thumbnail with full-map fallback — same reasoning as the main grid.
      const tokenSrc = assetThumbUrl(m.path);
      const fullSrc  = assetUrl(m.path);
      return `<div class="mapsel-card starred" data-path="${esc(m.path)}" title="${esc(m.title)}${m.advName?' — '+esc(m.advName):''}">
        <button class="mapsel-star on" data-mapsel-star="${esc(m.path)}" title="Unstar">★</button>
        <img crossorigin="anonymous" src="${esc(tokenSrc)}" data-fb="${esc(fullSrc)}" loading="lazy" decoding="async" alt="${esc(m.title)}" onerror="if(this.dataset.fb){this.src=this.dataset.fb;this.removeAttribute('data-fb');}else{this.style.opacity=.3;}">
        <div class="mapsel-title">${esc(m.title)}</div>
        ${m.advName ? `<div class="mapsel-sub">${esc(m.advName)}</div>` : ''}
        <span class="mapsel-badge ${esc(m.type || 'map')}">${m.type==='mapPlayer'?'Player':'DM'}</span>
      </div>`;
    }).join('');
    return `<div id="mapsel-starred-host" style="margin-bottom:14px">
      <div style="font-size:var(--fs-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:6px;display:flex;align-items:center;gap:6px">
        <span>★ Starred maps</span>
        <span style="color:var(--text-dim);text-transform:none;letter-spacing:0;font-weight:400">${set.size}</span>
      </div>
      <div class="mapsel-grid mapsel-starred-grid">${cards}</div>
    </div>`;
  },

  // Render the "Saved maps" section that sits at the top of the picker
  // modal. Returns empty string when the library is empty so the section
  // doesn't take up vertical space for first-time users.
  _renderSavedMapsSection(){
    if (!this._savedMaps || !this._savedMaps.length) return '';
    const rows = this._savedMaps.map(s => {
      const tokenN = (s.snapshot?.tokens || []).length;
      const fogN   = (s.snapshot?.fog || []).length;
      const drawingN = (s.snapshot?.drawings || []).length;
      const bgLabel = s.snapshot?.bgMapPath
        ? s.snapshot.bgMapPath.split('/').pop().replace(/\.[^.]+$/, '')
        : (s.snapshot?.hadUploadedImage ? '⚠ Upload (no bg)' : 'No background');
      const stats = [
        tokenN   ? tokenN + ' tok'  : null,
        fogN     ? fogN + ' fog'    : null,
        drawingN ? drawingN + ' drw' : null,
      ].filter(Boolean).join(' · ');
      return `<div class="mapsel-saved-row" style="display:flex;align-items:center;gap:6px;background:var(--panel-2);border:1px solid var(--border);border-radius:4px;padding:5px 8px;margin-bottom:4px;font-size:var(--fs-md)">
        <button data-savedmap-load="${esc(s.id)}" style="flex:1;background:transparent;border:none;color:var(--text);font-family:inherit;font-size:var(--fs-md);cursor:pointer;text-align:left;padding:2px 4px;display:flex;flex-direction:column;gap:1px" title="Load this saved map">
          <span style="font-weight:600">${esc(s.name)}</span>
          <span style="font-size:var(--fs-xs);color:var(--text-dim)">${esc(bgLabel)}${stats ? ' · ' + esc(stats) : ''}</span>
        </button>
        <button class="btn icon-btn danger" data-savedmap-del="${esc(s.id)}" title="Delete this saved map" style="padding:2px 6px;font-size:var(--fs-sm)">×</button>
      </div>`;
    }).join('');
    return `<div id="mapsel-saved-host" style="margin-bottom:14px">
      <div style="font-size:var(--fs-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:6px">Saved maps</div>
      <div style="max-height:200px;overflow-y:auto">${rows}</div>
    </div>`;
  },

  // ─── Saved-maps library ──────────────────────────────────────────────────
  // Persist the saved-map list under its own key. Same try/catch shape as
  // the active-map save — quota errors are swallowed (rare for this list
  // since each entry is small, just metadata + token/fog state).
  _saveSavedMaps(){
    saveJson('skt-battlemap-saved-v1', {saved:this._savedMaps}, 'saved maps');
  },

  // Snapshot the full per-map state into a plain JSON object suitable for
  // long-term storage. Deliberately omits the uploaded-image data URL (too
  // big for localStorage) and any session-only flags (visibility toggles).
  _snapshotMap(){
    return {
      bgMapPath:    this._bgMapPath || null,
      bgMapScale:   this._bgMapScale || 1,
      mapRotation:  this._mapRotation || 0,
      ftPerCell:    this._ftPerCell || 5,
      gridOffsetX:  this._gridOffsetX || 0,
      gridOffsetY:  this._gridOffsetY || 0,
      cellSize:     this._cellSize,
      cols:         this._cols,
      rows:         this._rows,
      bgColor:      this._bgColor,
      showGrid:     this._showGrid !== false,
      gridType:     this._gridType || 'square',
      cellHighlight:!!this._cellHighlight,
      snapToGrid:   !!this._snapToGrid,
      tokens:       JSON.parse(JSON.stringify(this._tokens || [])),
      fog:          this._fog ? Array.from(this._fog) : null,
      fogStrokes:   JSON.parse(JSON.stringify(this._fogStrokes || [])),
      fogPaintMode: this._fogPaintMode || 'reveal',
      fogBrushMode: this._fogBrushMode || 'grid',
      fogBrushShape:this._fogBrushShape || 'square',
      fogHardness:  this._fogHardness,
      gridOpacity:  this._gridOpacity,
      gridColor:    this._gridColor || null,
      gridWidth:    this._gridWidth,
      drawings:     JSON.parse(JSON.stringify(this._drawings || [])),
      // Flag uploaded-image state — restore-time we can warn the user that
      // the background needs re-uploading. The path field stays null.
      hadUploadedImage: !this._bgMapPath && !!_mapBgImage,
    };
  },

  // Apply a saved snapshot to the panel. Replaces every per-map field, then
  // either re-fetches the bg image (5etools path) or clears the in-memory
  // image (upload — can't restore without re-upload). Triggers a re-render.
  _restoreMapSnapshot(snap){
    if (!snap) return;
    this._bgMapPath    = snap.bgMapPath || null;
    this._bgMapScale   = snap.bgMapScale || 1;
    this._mapRotation  = snap.mapRotation || 0;
    this._ftPerCell    = +snap.ftPerCell > 0 ? +snap.ftPerCell : 5;
    this._gridOffsetX  = snap.gridOffsetX || 0;
    this._gridOffsetY  = snap.gridOffsetY || 0;
    this._cellSize     = snap.cellSize || this._cellSize;
    this._cols         = snap.cols || this._cols;
    this._rows         = snap.rows || this._rows;
    this._bgColor      = snap.bgColor || this._bgColor;
    this._showGrid     = snap.showGrid !== false;
    this._gridType     = snap.gridType || (this._showGrid ? 'square' : 'none');
    this._showGrid     = this._gridType !== 'none';
    this._cellHighlight= !!snap.cellHighlight;
    this._snapToGrid   = !!snap.snapToGrid;
    this._tokens       = Array.isArray(snap.tokens) ? JSON.parse(JSON.stringify(snap.tokens)) : [];
    this._fog          = Array.isArray(snap.fog) ? new Set(snap.fog) : null;
    this._fogStrokes   = Array.isArray(snap.fogStrokes) ? JSON.parse(JSON.stringify(snap.fogStrokes)) : [];
    this._fogPaintMode = snap.fogPaintMode || 'reveal';
    this._fogBrushMode = snap.fogBrushMode || 'grid';
    this._fogBrushShape= snap.fogBrushShape || 'square';
    if (snap.fogHardness != null) this._fogHardness = snap.fogHardness;
    if (snap.gridOpacity != null) this._gridOpacity = snap.gridOpacity;
    this._gridColor = snap.gridColor || null;
    if (snap.gridWidth   != null) this._gridWidth   = snap.gridWidth;
    this._drawings     = Array.isArray(snap.drawings) ? JSON.parse(JSON.stringify(snap.drawings)) : [];
    this._lastTokenScale = this._bgMapScale;
    // Bg image: either reload via 5etools path, or drop any stale in-memory
    // image (uploads can't survive). The user gets a one-shot toast warning
    // when an upload state is restored without its image.
    if (this._bgMapPath){
      _mapBgImage = null;
      // autoFit: a restored snapshot carries its own world scale and its own
      // image, so this device should fit it fresh rather than keep a zoom
      // chosen for whatever was on screen before.
      this._loadBgFromPath(this._bgMapPath, /*autoFit=*/true);
    } else {
      _mapBgImage = null;
      this._render();
      if (snap.hadUploadedImage && typeof showToast === 'function'){
        showToast('Loaded — re-upload the background image (uploads are session-only)');
      }
    }
    // Same reasoning as _resetMapScene: a restored snapshot is a different
    // scene, so the history that led here no longer applies to it. This path
    // doesn't go through _resetMapScene, so it needs its own reset.
    this._resetUndoBaseline();
    this._saveMap();
    this._broadcast();
  },

  // Reset the scene cleanly when swapping in a NEW map. Three things have
  // to happen, in this order:
  //   1. Bake any in-flight token rescale into canonical pixels by calling
  //      _scaleTokensTo(1) BEFORE clobbering _lastTokenScale. Otherwise
  //      tokens stay at the previous map's scaled coords and appear at
  //      ~40% of their intended positions on the new map.
  //   2. Clear _drawings — they were drawn in the OLD map's coordinate
  //      space (and on top of an image that no longer exists). Keeping
  //      them paints onto whatever pixels happen to land at those coords
  //      in the new image; almost never useful.
  //   3. Clear _fog — fog cells are keyed by "row,col" strings. A new map
  //      has different _cols/_rows (set by _fitGridToBg after this returns),
  //      so old fog cells either disappear silently (outside new bounds)
  //      or paint onto unrelated cells. Cleaner to start fresh.
  // Called by every map-swap path (upload, map-card click, starred-strip
  // map-card click) so the bug doesn't reappear when a fourth call site
  // is added later.
  _resetMapScene(){
    this._scaleTokensTo(1);
    this._drawings = [];
    this._fog = null;
    //   4. Drop the undo history. It describes the OLD map's content, and the
    //      snapshot deliberately excludes the map image — so a single Ctrl+Z
    //      after a swap pasted the previous map's tokens, drawings and fog
    //      cells onto the new one. Measured: switch from a map with two
    //      tokens, a stroke and two fog cells to an empty map, press undo
    //      once, and all of it reappears. Resetting HERE rather than at the
    //      callers means the swap itself also stops being undoable, because
    //      the _saveMap() that follows sees a baseline equal to the state it
    //      is about to write and pushes nothing.
    this._resetUndoBaseline();
  },

  _scaleTokensTo(newScale){
    const old = this._lastTokenScale != null ? this._lastTokenScale : (this._bgMapScale || 1);
    if (!newScale || !old || newScale === old) { this._lastTokenScale = newScale || old; return; }
    const ratio = newScale / old;
    this._tokens.forEach(t => {
      if (t.x != null) t.x *= ratio;
      if (t.y != null) t.y *= ratio;
    });
    // If a token drag is in progress, the drag's anchor (this._drag.startPx /
    // startPy) was captured in pre-zoom stage pixels. Scale it in lockstep
    // with t.x/t.y so the next mousemove computes against the new
    // coordinate system instead of teleporting the token to its pre-zoom
    // location.
    if (this._drag && this._drag.startPx != null){
      this._drag.startPx *= ratio;
      this._drag.startPy *= ratio;
    }
    // Drawings live in stage pixels too — scale them in lockstep.
    (this._drawings||[]).forEach(s => {
      if (!s.p) return;
      for (let i = 0; i < s.p.length; i++) s.p[i] *= ratio;
    });
    this._lastTokenScale = newScale;
  },

  // Apply this device's view zoom. Purely a display operation: it sets one
  // CSS transform and the layout size that drives the scrollbars. It NEVER
  // touches token coordinates, drawing points, or any synced state — which is
  // the whole reason zoom can safely differ per device.
  //
  // Replaces the old _applyZoomTransform, which resized every canvas and
  // rebaked token coords because zoom used to BE the world scale.
  _applyViewScale(v){
    if (v != null) this._viewScale = this._clampView(v);
    const b = this._body; if (!b) return;
    const stage = b.querySelector('#map-stage'); if (!stage) return;
    const sizer = b.querySelector('#map-sizer');
    const zoomEl = b.querySelector('#map-zoom');
    const vs  = this._viewScale || 1;
    const cs  = this._csScreen();
    const W   = this._cols * cs, H = this._rows * cs;

    if (zoomEl){
      zoomEl.style.transformOrigin = '0 0';
      zoomEl.style.transform = 'scale(' + vs + ')';
      zoomEl.style.width  = W + 'px';
      zoomEl.style.height = H + 'px';
    }
    // The sizer carries the SCALED size so #map-scroll can scroll the whole
    // zoomed map. A transform alone leaves layout size unchanged, so without
    // this you'd zoom in and be unable to reach the rest of the map.
    if (sizer){
      sizer.style.width  = (W * vs) + 'px';
      sizer.style.height = (H * vs) + 'px';
    }
    // Consumed by CSS for anything that must stay a fixed SCREEN size despite
    // the transform (mobile token tap targets — see styles/main.css).
    stage.style.setProperty('--bm-vs', String(vs));
    this._counterScaleLabels(vs);

    // Re-rasterise the canvas layers at the new zoom, once the zoom settles.
    // Deliberately debounced rather than immediate: reallocating three backing
    // stores per wheel tick would stutter far worse than the brief softness
    // while zooming.
    this._scheduleRequality();

    const slider = b.querySelector('#map-bg-scale'); if (slider) slider.value = vs;
    const pct = b.querySelector('#map-bg-scale-pct');
    // Show the EFFECTIVE zoom — what the user actually perceives — not the
    // bare view multiplier, which is meaningless without the world scale.
    if (pct) pct.textContent = Math.round(vs * (this._bgMapScale || 1) * 100) + '%';
  },

  // Diameter of a size-1 token, in NATURAL (pre-bgMapScale) pixels.
  //
  // On a square grid that's the cell size. On a hex grid it is NOT: _cellSize
  // is the hex's corner-to-corner width (see _drawHexGrid), so the hex is only
  // cs·√3/2 ≈ 0.866·cs from flat to flat, and columns sit 0.75·cs apart. A
  // token drawn at cs was therefore ~15% taller than the hex holding it and
  // spilled into its neighbours on every side. The inscribed circle — the
  // flat-to-flat height — is the largest circle that actually fits.
  // '#rgb' or '#rrggbb' → {r,g,b}, or null. Tolerates the short form because
  // a hand-edited backup or a synced value from another client can carry it;
  // <input type="color"> itself always emits the long form.
  _hexToRgb(hex){
    if (typeof hex !== 'string') return null;
    let h = hex.trim().replace(/^#/, '');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
  },

  // What Auto currently resolves to, as a hex — seeds the colour input so
  // opening the picker starts from what's on screen rather than from black.
  _autoGridHex(){
    let lum = null;
    if (_mapBgImage){ lum = _bgLuminance(); }
    else {
      const c = this._hexToRgb(this._bgColor);
      if (c) lum = (c.r*299 + c.g*587 + c.b*114) / 1000;
    }
    return (lum != null && lum > 128) ? '#000000' : '#ffffff';
  },

  _tokenUnit(){
    return (this._gridType === 'hex') ? this._cellSize * Math.sqrt(3) / 2 : this._cellSize;
  },
  // Same thing in STAGE pixels — what the edge clamps compare against, since
  // they work in the same space as _csScreen().
  _tokenUnitScreen(){ return this._tokenUnit() * (this._bgMapScale || 1); },

  // Font sizes with a minimum are minimums in SCREEN pixels by intent, but the
  // CSS transform silently reinterprets them as stage pixels. Divide the floor
  // by the view scale so "at least 11px" keeps meaning 11px on the display.
  _counterScaleLabels(vs){
    const b = this._body; if (!b) return;
    const bg = this._bgMapScale || 1;
    b.querySelectorAll('.map-token-name').forEach(el => {
      el.style.fontSize = Math.max(11 / vs, 10 * bg).toFixed(1) + 'px';
    });
    b.querySelectorAll('.map-token').forEach(el => {
      const t = this._tokens.find(x => x.id === el.dataset.tid); if (!t) return;
      const iconSource = t.portrait || t.icon;
      const isImgIcon = typeof iconSource === 'string' && (iconSource.startsWith('data:image/') || iconSource.startsWith('img/') || /^https?:\/\//.test(iconSource));
      const isSvgIcon = typeof iconSource === 'string' && iconSource.startsWith('<svg');
      if (!(!!(t.icon || t.portrait) && !isImgIcon && !isSvgIcon)) return;   // glyph icons only
      const dim = ((t.size || 1) * this._tokenUnit() - 4) * bg;
      el.style.fontSize = Math.max(14 / vs, dim * 0.6).toFixed(1) + 'px';
    });
  },

  // A device still running the OLD code writes _bgMapScale when it zooms, and
  // pushes it together with the tokens it rescaled — so the payload is
  // internally consistent and accepting it can't corrupt anything. But the
  // effective scale here would visibly lurch. Absorb the world-scale change
  // into this device's view scale so the on-screen size is unchanged.
  // Also covers a saved-map restore that lands on the same map path.
  _absorbWorldScaleChange(oldBg, newBg){
    if (!oldBg || !newBg || oldBg === newBg) return;
    const eff = (this._viewScale || 1) * oldBg;   // on-screen size to preserve
    this._viewScale = this._clampView(eff / newBg);
  },

  // Fit-to-view — now a per-device operation. Computes the effective on-screen
  // scale that fits this viewport, then divides out the frozen world scale to
  // get THIS device's view multiplier. Writes nothing synced: fitting on a
  // phone must not move anyone else's view.
  _fitMapToView(){
    if (!_mapBgImage || !this._bgMapNaturalW) return;
    const scrollEl = this._body?.querySelector('#map-scroll');
    if (!scrollEl) return;
    const vw = scrollEl.clientWidth - 4;   // small margin so edges aren't flush
    const vh = scrollEl.clientHeight - 4;
    if (vw <= 0 || vh <= 0) return;
    // Fit the GRID extent, not the raw image. _cols/_rows round UP to whole
    // cells, so the stage is up to a cell wider/taller than the art — and the
    // stage is what gets laid out. Fitting the image instead (what this used
    // to do) left the last row overflowing, which raised a scrollbar, which
    // shrank clientHeight, which meant "Fit" reliably failed to fit.
    const gw = this._cols * this._cellSize, gh = this._rows * this._cellSize;
    if (!gw || !gh) return;
    // Displayed size is grid × bgMapScale × viewScale (_applyBg/_setupMap
    // apply the first, the CSS transform the second), so viewScale = eff / bg.
    const eff = Math.max(0.1, Math.min(this._maxEff(), Math.min(vw / gw, vh / gh)));
    this._fitGridToBg();
    this._isFitted = true; // panel resize will re-fit until the user manually zooms
    this._pendingRefit = false;
    this._applyViewScale(eff / (this._bgMapScale || 1));
    this._saveViewState();
  },

  // BroadcastChannel — lets a player view tab receive live updates from the
  // DM tab in the same browser. Faster than the Firebase localStorage path
  // (which only fires on _saveMap, i.e. fog mouseup), so fog reveals while
  // dragging show up frame-by-frame in the player view.
  _bc: null,
  _startBroadcast(){
    try{
      this._bc=new BroadcastChannel('skt-battlemap');
      const isPlayer = document.body.classList.contains('player-mode');
      // Player tabs also subscribe to the cross-device live-stroke channel so
      // strokes drawn on a remote DM machine show up here in near-real time.
      // Same-browser tabs already get instant updates via BroadcastChannel
      // above; this Firebase listener only matters for cross-device players.
      if (isPlayer && window.realtimeLive){
        try { if (this._unsubLive) this._unsubLive(); } catch(e){}
        this._unsubLive = window.realtimeLive.listen('skt_battlemap_live_v1', val => {
          if (!val || !val.stroke){ this._clearPreviewStroke(); return; }
          this._applyPreviewStroke(val.stroke);
        });
      }
      this._bc.onmessage = ev => {
        const msg = ev.data; if (!msg) return;
        if (!isPlayer){
          // The DM tab used to drop EVERY inbound message, on the stated
          // grounds that it was ignoring its own echoes. It has none to
          // ignore: BroadcastChannel never delivers a message back to the
          // context that posted it. What the guard actually blocked was other
          // tabs — so a player drawing in a second tab of the same browser
          // never reached the DM window, and only turned up later via the
          // Firebase round trip, or not at all when offline.
          //
          // Take exactly two things from a player: pencil annotations, and
          // where an EXISTING token sits. A player's payload carries the whole
          // map state, and applying all of it would let a stale player tab push
          // its fog, its map, or a deleted token back over the DM's.
          //
          // Taking drawings alone was worse than incomplete, because the
          // _saveMap() below broadcasts the DM's FULL state straight back. A
          // player who dragged a token saw it snap home ~200ms later: the move
          // wasn't merely dropped, the echo actively undid it, on this device
          // and on every other one the DM then pushed to.
          //
          // Last-write-wins, as everywhere else on this map: if the DM moves
          // the same token in the same instant, whichever lands second wins.
          if (msg.role !== 'player') return;
          let touched = false;
          if (Array.isArray(msg.drawings)){
            this._drawings = msg.drawings;
            this._previewStroke = null;
            this._drawAllStrokes();
            touched = true;
          }
          if (this._mergeTokenPositions(msg.tokens)){
            this._renderTokens();
            touched = true;
          }
          // Persist so it reaches Firebase and every other device — without
          // this the DM would see the change but never pass it on.
          if (touched) this._saveMap();
          return;
        }
        // Live-drawing messages — applied to a transient preview that doesn't
        // touch _drawings. Once the DM finishes the stroke, a full state push
        // arrives (with the stroke now in _drawings) and the preview is
        // cleared.
        if (msg.kind === 'strokeTick'){ this._applyPreviewStroke(msg.stroke); return; }
        if (msg.kind === 'strokeEnd'){ this._clearPreviewStroke(); return; }
        // Everything else is a full state snapshot. Hand it to the one
        // applier so this route can't drift from the Firebase one again.
        this.applyMapState(msg, { source: 'bc' });
      };
    }catch(e){}
  },

  // Merge ONLY x/y, matched by token id, from a payload we don't fully trust.
  // Unknown ids are dropped, so this can never add a token; tokens absent from
  // the payload are left alone, so it can never remove one; and no other field
  // is read, so a stale sender can't rename, resize, revive or recolour
  // anything. That is what makes it safe to accept from a player when
  // applyMapState (which takes the lot) is not.
  //
  // Returns whether anything actually moved, so the caller can skip a
  // re-render and a sync push for a payload that changed nothing — every
  // player broadcast carries tokens, most of them identical.
  _mergeTokenPositions(incoming){
    if (!Array.isArray(incoming) || !Array.isArray(this._tokens)) return false;
    // Mid-drag, skip entirely. Same reasoning as applyMapState's guard: the
    // DM's own drag is authoritative until mouseup, and rewriting coordinates
    // underneath it would fight the pointer.
    if (this._drag) return false;
    const byId = new Map();
    incoming.forEach(t => { if (t && t.id != null) byId.set(t.id, t); });
    let moved = false;
    this._tokens.forEach(t => {
      const src = (t && t.id != null) ? byId.get(t.id) : null;
      if (!src) return;
      if (typeof src.x === 'number' && src.x !== t.x){ t.x = src.x; moved = true; }
      if (typeof src.y === 'number' && src.y !== t.y){ t.y = src.y; moved = true; }
    });
    return moved;
  },

  // ─── The single way an incoming map update is applied ──────────────────────
  // Every live update arrives on one of three routes: the DM's own window, a
  // same-browser BroadcastChannel message, or a cross-device Firebase apply.
  // Those used to be three separate blocks doing the same job, and they drifted
  // apart repeatedly — a repaint missing from one, a geometry check present in
  // one and not the other, an inbound guard that silently blocked a whole role.
  // Three bugs in one session all had the shape "make path B do what path A
  // already does". This is now the one place that knows how to take a map
  // snapshot and put it on screen; the transports only decide WHAT to hand it.
  //
  // `src` is a plain object using the same field names the stored map JSON and
  // the broadcast payload both already use, so either can be passed unchanged.
  applyMapState(src, opts){
    if (!src || !this._body) return;
    opts = opts || {};
    // A token drag is in flight — replacing _tokens and re-rendering now would
    // destroy the dragged element and orphan the drag's object, so the move
    // would be silently discarded on mouseup. The map is last-write-wins and
    // the drag-end _saveMap() makes this device canonical moments later. This
    // guard existed only on the Firebase route; BroadcastChannel could still
    // yank the map out from under a drag.
    if (this._drag) return;

    const prevPath = this._bgMapPath || null;
    const nextPath = src.bgMapPath !== undefined ? (src.bgMapPath || null) : prevPath;
    // Everything that determines the STAGE's pixel size. Only _setupMap resizes
    // the stage and re-tiles the background, so any change here has to fall
    // through to a full _render() rather than the cheap repaint.
    const struct = () => [this._cols, this._rows, this._cellSize, this._gridType,
      this._bgMapScale, this._mapRotation, this._gridOffsetX, this._gridOffsetY].join('|');
    const structBefore = struct();

    if (src.tokens)   this._tokens   = src.tokens;
    if (src.cellSize) this._cellSize = src.cellSize;
    if (src.cols)     this._cols     = src.cols;
    if (src.rows)     this._rows     = src.rows;
    if (src.bgColor)  this._bgColor  = src.bgColor;
    // showGrid fallback keeps legacy payloads (written before gridType existed)
    // readable.
    this._gridType = src.gridType || (src.showGrid !== false ? 'square' : 'none');
    this._showGrid = this._gridType !== 'none';
    this._fog        = src.fog ? new Set(src.fog) : null;
    if (Array.isArray(src.drawings))   this._drawings   = src.drawings;
    if (Array.isArray(src.fogStrokes)) this._fogStrokes = src.fogStrokes;
    if (src.gridOffsetX != null) this._gridOffsetX = src.gridOffsetX;
    if (src.gridOffsetY != null) this._gridOffsetY = src.gridOffsetY;
    if (src.bgMapScale  != null){
      // Same map, different world scale — an old-code tab zooming, or a
      // saved-map restore. Absorb it into this device's view scale so the
      // on-screen size doesn't lurch. A genuine map change re-fits below.
      if (nextPath === prevPath) this._absorbWorldScaleChange?.(this._bgMapScale || 1, src.bgMapScale);
      this._bgMapScale = src.bgMapScale;
      this._lastTokenScale = src.bgMapScale;
    }
    if (src.mapRotation != null) this._mapRotation = src.mapRotation;
    if (src.gridOpacity != null) this._gridOpacity = src.gridOpacity;
    if ('gridColor' in src) this._gridColor = src.gridColor || null;
    if (src.gridWidth   != null) this._gridWidth   = src.gridWidth;
    this._bgMapPath = nextPath;

    // Three tiers, most expensive first. Only the last one is common.
    if (nextPath && (nextPath !== prevPath || !this._bgMapNaturalW)){
      // A different map, or one whose image this device hasn't loaded yet.
      // autoFit only when the map actually changed, so each device re-fits to
      // its own screen rather than inheriting the sender's zoom.
      // _loadBgFromPath renders on image load.
      this._loadBgFromPath?.(nextPath, nextPath !== prevPath, /*fromSync=*/true);
      return;
    }
    if (struct() !== structBefore || (!nextPath && prevPath)){
      // Stage geometry moved, or the map was cleared — the canvases have to be
      // rebuilt. Re-baseline undo too: the stack would otherwise describe a
      // history that no longer matches shared state.
      if (!nextPath && prevPath) _mapBgImage = null;
      this._resetUndoBaseline?.();
      this._render();
      return;
    }
    // The common case by far: a token moved or fog changed. Repaint the canvas
    // layers only, no innerHTML teardown.
    this._repaintRemote({ drawings: Array.isArray(src.drawings), tokens: src.tokens });
  },

  // Repaint the canvas layers for an incoming REMOTE update, without the
  // innerHTML teardown a full _render() does.
  //
  // Shared by both live paths on purpose. The same-browser BroadcastChannel
  // handler has always used this cheap path; the cross-device Firebase apply
  // in realtime.js used to call _render() for the identical events — a full
  // rebuild of the toolbar, sidebar, stage and every token node, measured at
  // ~10ms here and several times that on a phone. Players on their own
  // devices were paying 10x what a player in a second tab paid, for the same
  // fog reveal. Callers must still fall back to _render() when the map's
  // GEOMETRY changes (cols/rows/cellSize/scale/rotation), since that resizes
  // the stage and the canvases.
  // Remote wrapper: a change arriving from another device invalidates the
  // undo history (see _resetUndoBaseline) before the same painting runs.
  // Undo/redo call _repaintLayers directly — going through here would make
  // undo erase its own stack, which is exactly the bug this split fixes.
  _repaintRemote(opts){
    if (!this._body) return;
    this._resetUndoBaseline();
    this._repaintLayers(opts);
  },

  _repaintLayers(opts){
    const b = this._body; if (!b) return;
    opts = opts || {};
    // Redraw the grid canvas so gridType changes (square/hex/none) reflect
    // without waiting for a full re-render.
    const gridC = b.querySelector('#map-canvas');
    if (gridC) this._drawGrid(gridC, this._csScreen());
    this._drawFog();
    if (opts.drawings){
      // Stroke now committed → drop the live preview (whichever client's tick
      // last painted it) and redraw from canonical state.
      this._previewStroke = null;
      this._drawAllStrokes();
    }
    // Only re-render tokens when the token payload ACTUALLY changed. DM
    // fog-paint broadcasts the entire state every tick, so during a stroke
    // the token array is identical hundreds of times in a row. Re-rendering
    // each time = remove+recreate every token DOM element = paint storm and
    // visible flicker. A cheap JSON hash skips the work entirely.
    const tokenHash = opts.tokens ? JSON.stringify(opts.tokens) : '';
    if (tokenHash !== this._lastTokenHash){
      this._lastTokenHash = tokenHash;
      this._renderTokens();
    }
  },
  _stopBroadcast(){
    try { this._bc?.close(); } catch(e){}
    try { if (this._unsubLive) this._unsubLive(); } catch(e){}
    this._unsubLive = null;
  },

  // Tiny circular marker shown at the first click during grid-align mode so
  // the user can see what they anchored to before placing the second click.
  _showAlignMarker(x, y){
    const stage = this._body?.querySelector('#map-stage'); if (!stage) return;
    this._removeAlignMarker();
    const m = document.createElement('div');
    m.id = 'align-marker';
    m.style.cssText = 'position:absolute;left:'+x+'px;top:'+y+'px;width:14px;height:14px;'
      + 'border:2px solid var(--accent);border-radius:50%;background:rgba(212,165,116,.25);'
      + 'transform:translate(-50%,-50%);z-index:25;pointer-events:none;'
      + 'box-shadow:0 0 8px rgba(212,165,116,.6)';
    stage.appendChild(m);
  },
  _removeAlignMarker(){
    const m = this._body?.querySelector('#align-marker');
    if (m) m.remove();
  },

  _broadcast(){
    try{
      if(!this._bc)return;
      const fogArr=this._fog?Array.from(this._fog):null;
      this._bc.postMessage({
        tokens:this._tokens, cellSize:this._cellSize,
        cols:this._cols, rows:this._rows,
        bgColor:this._bgColor, fog:fogArr,
        gridType: this._gridType || 'square',
        gridOffsetX: this._gridOffsetX || 0,
        gridOffsetY: this._gridOffsetY || 0,
        bgMapScale: this._bgMapScale || 1,
        mapRotation: this._mapRotation || 0,
        // Grid look is shared state — the DM dials in opacity/width and the
        // player view renders the same grid.
        gridOpacity: this._gridOpacity != null ? this._gridOpacity : 60,
        gridColor: this._gridColor || null,
        gridWidth: this._gridWidth || 1,
        bgImageData: _mapBgImage?'present':null,
        bgMapPath: this._bgMapPath,
        // Pencil annotations — players see strokes as the DM commits them
        // (mouseup) and as the eraser removes them.
        drawings: this._drawings || [],
        // Free-mode fog strokes (pixel-level, cell-fraction coords).
        fogStrokes: this._fogStrokes || [],
        // Who sent this. The DM tab needs it to tell a PLAYER tab's message
        // apart from another DM window's, because it accepts different things
        // from each (see the handler in _startBroadcast).
        role: document.body.classList.contains('player-mode') ? 'player' : 'dm',
      });
    }catch(e){}
  },

  // Throttled broadcast for high-frequency events (grid-mode fog paint).
  // Coalesces multiple calls within ~80ms into a single broadcast so the
  // player tab doesn't get hammered with 30+ full-state messages per second
  // (which causes a render storm: full grid redraw + full fog redraw + full
  // token DOM rebuild on the receiving side per message). At 80ms we still
  // get ~12fps player-side updates — visually real-time but stable.
  _broadcastThrottled(){
    if (!this._bc) return;
    const now = Date.now();
    if (!this._lastBroadcastTs) this._lastBroadcastTs = 0;
    const elapsed = now - this._lastBroadcastTs;
    if (elapsed >= 80){
      this._lastBroadcastTs = now;
      this._broadcast();
      return;
    }
    // Schedule a trailing broadcast so the LAST change in a burst always
    // ships (without this, releasing the brush right after a 79ms-spaced
    // change would lose that final tick on the player side).
    if (this._broadcastTrailTimer) return;
    this._broadcastTrailTimer = setTimeout(() => {
      this._broadcastTrailTimer = null;
      this._lastBroadcastTs = Date.now();
      this._broadcast();
    }, 80 - elapsed);
  },

  // Live-stroke broadcast — emits the active stroke to (a) the BroadcastChannel
  // for same-browser tabs and (b) Firebase via realtimeLive for cross-device
  // players. Throttled by the caller (10 fps in the draw mousemove handler) to
  // keep Firebase write traffic reasonable.
  _broadcastStrokeTick(stroke){
    try { if (this._bc) this._bc.postMessage({ kind:'strokeTick', stroke }); } catch(e){}
    try { if (window.realtimeLive) window.realtimeLive.push('skt_battlemap_live_v1', { stroke, ts: Date.now() }); } catch(e){}
  },
  _broadcastStrokeEnd(){
    try { if (this._bc) this._bc.postMessage({ kind:'strokeEnd' }); } catch(e){}
    try { if (window.realtimeLive) window.realtimeLive.clear('skt_battlemap_live_v1'); } catch(e){}
  },

  // Preview-stroke layer (player view only). Lives on the existing draw-canvas
  // — we repaint the committed strokes plus the in-progress one on top.
  _applyPreviewStroke(stroke){
    if (!stroke) return;
    this._previewStroke = stroke;
    this._renderPreview();
  },
  _clearPreviewStroke(){
    if (!this._previewStroke) return;
    this._previewStroke = null;
    this._renderPreview();
  },
  _renderPreview(){
    const b = this._body; if (!b) return;
    const drawC = b.querySelector('#draw-canvas'); if (!drawC) return;
    // Repaint committed drawings, then layer the active stroke on top.
    this._drawAllStrokes();
    const s = this._previewStroke;
    if (!s || !s.p || s.p.length < 2) return;
    const ctx = drawC.getContext('2d');
    ctx.strokeStyle = s.c || '#ff4040';
    ctx.lineWidth = (s.s || 4) * (this._bgMapScale || 1);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(s.p[0], s.p[1]);
    for (let i = 2; i < s.p.length; i += 2) ctx.lineTo(s.p[i], s.p[i+1]);
    ctx.stroke();
  },

  _render(){
    const b=this._body;if(!b)return;
    // Snapshot scroll before innerHTML reset so wheel-zoom / slider release /
    // any other re-render doesn't snap the view back to the top-left.
    const oldScroll = b.querySelector('#map-scroll');
    const savedSx = oldScroll ? oldScroll.scrollLeft : 0;
    const savedSy = oldScroll ? oldScroll.scrollTop  : 0;
    // Same trick for the settings drawer — clicking a tile (grid/fog/etc.)
    // forces a full re-render of the panel, which otherwise yanks the
    // drawer's scrollTop back to 0 every time. Snapshot + restore below.
    const oldSettings = b.querySelector('.bm-settings');
    const savedSettingsScroll = oldSettings ? oldSettings.scrollTop : 0;
    // Player-view detection — used to hide DM-only toolbar controls (fog,
    // open-player) since players receive fog state via the broadcast and
    // shouldn't be able to toggle/paint it.
    const _isPlayer = document.body.classList.contains('player-mode');
    const cs=this._cellSize;
    const ft = this._ftPerCell || 5;
    this._tool=this._tool==='move'?'add-pc':this._tool; // default to add-pc if somehow move
    // Always allow dragging regardless of tool — move is always active
    b.style.cssText='display:flex;flex-direction:column;height:100%;overflow:hidden;position:relative';

    const partyBtns=state.party.map((p,pi)=>{
      const onMap=this._tokens.find(t=>t.label===p.name&&t.isPC);
      if(onMap)return '';
      // renderIcon handles emoji vs uploaded images (data: URLs / img/ paths) vs SVG.
      const iconHtml = renderIcon(p.icon||'⚔', p.name);
      return '<button class="btn small" data-mact="add-party" data-pi="'+pi+'" draggable="true" title="Click to add at the centre of your current view, or drag onto the map for precise placement" style="font-size:var(--fs-xs);display:inline-flex;align-items:center;gap:4px;cursor:grab">'
        +'<span class="map-party-icon">'+iconHtml+'</span>'
        +'<span>'+esc(p.name)+'</span>'
      +'</button>';
    }).join('');

    let html='';
    if (this._toolbarHidden){
      // Wrap the toggle in a small chip with pointer-events:none on the wrapper
      // so right-click pan / token interactions on the map underneath aren't
      // captured by the overlay. Only the button itself receives clicks.
      html += '<div style="position:absolute;top:6px;left:6px;z-index:30;pointer-events:none">'
        + '<button class="btn small" data-mact="toggle-toolbar" style="pointer-events:auto;padding:2px 8px;font-size:var(--fs-xs);opacity:.85" title="Show toolbar">▾ Tools</button>'
        + '</div>';
    } else if (_isPlayer) {
    // Player-view toolbar — minimal: Draw + Erase tools, zoom, Clear
    // (tokens) and Drawings (clear all pencil). Everything DM-only is
    // omitted entirely.
    html+='<div class="map-toolbar">'
      +'<button class="btn icon-btn" data-mact="toggle-toolbar" style="flex-shrink:0;padding:2px 5px" title="Hide toolbar (more map space)">▲</button>'
      +'<button class="btn '+(this._tool==='draw'?'active':'')+'" data-mact="tool-draw" title="Pencil — draw on the map">'+ICO('i-pencil')+'<span class="bt-l">Draw</span></button>'
      +(this._tool==='draw' ? '<input type="color" id="draw-color" value="'+this._drawColor+'" style="width:24px;height:22px;padding:1px;border-radius:3px;flex-shrink:0;cursor:pointer" title="Brush color">' : '')
      +(this._tool==='draw' ? '<select id="draw-size" style="width:64px;font-size:var(--fs-sm);padding:2px 4px;flex-shrink:0">'
        +'<option value="2"'+(this._drawSize===2?' selected':'')+'>Thin</option>'
        +'<option value="4"'+(this._drawSize===4?' selected':'')+'>Med</option>'
        +'<option value="8"'+(this._drawSize===8?' selected':'')+'>Thick</option>'
      +'</select>' : '')
      +'<button class="btn '+(this._tool==='erase'?'active':'')+'" data-mact="tool-erase" title="Erase drawings">'+ICO('i-trash')+'<span class="bt-l">Erase</span></button>'
      // Zoom — the bg-scale slider + % display + Fit, only when a map is loaded.
      +(_mapBgImage?'<div class="bm-div" style="width:1px;background:var(--border);height:18px;margin:0 4px;flex-shrink:0"></div>':'')
      +(_mapBgImage?'<input type="range" id="map-bg-scale" min="0.1" max="3" step="0.05" value="'+(this._bgMapScale||1)+'" style="width:80px;flex-shrink:0" title="Zoom">':'')
      +(_mapBgImage?'<span id="map-bg-scale-pct" style="font-size:var(--fs-xs);color:var(--text-muted);width:34px;text-align:right;flex-shrink:0">'+Math.round((this._bgMapScale||1)*100)+'%</span>':'')
      +(_mapBgImage?'<button class="btn" data-mact="fit-map" style="flex-shrink:0" title="Fit map to panel">⊙ Fit</button>':'')
      +'<div class="bm-spacer" style="flex:1"></div>'
      // Undo/redo sit next to the destructive buttons on purpose — that's
      // where you look after a misclick.
      +'<button class="btn icon-btn" data-mact="undo" style="flex-shrink:0;padding:2px 6px" title="Undo (Ctrl+Z)">'+ICO('i-undo')+'</button>'
      +'<button class="btn icon-btn" data-mact="redo" style="flex-shrink:0;padding:2px 6px" title="Redo (Ctrl+Shift+Z)">'+ICO('i-redo')+'</button>'
      +'<button class="btn" data-mact="clear-draw" style="flex-shrink:0" title="Clear all drawings">'+ICO('i-trash')+'<span class="bt-l">Drawings</span></button>'
      +'<button class="btn danger" data-mact="clear-tokens" style="flex-shrink:0">Clear</button>'
    +'</div>';
    } else {
    html+='<div class="map-toolbar">'
      +'<button class="btn icon-btn" data-mact="toggle-toolbar" style="flex-shrink:0;padding:2px 5px" title="Hide toolbar (more map space)">▲</button>'
      +'<button class="btn '+(this._tool==='add-pc'?'active':'')+'" data-mact="tool-add-pc" title="Place a party member"><span class="bt-l">+ PC</span><span class="bt-s">PC</span></button>'
      +'<button class="btn '+(this._tool==='add-npc'?'active':'')+'" data-mact="tool-add-npc" title="Place an NPC or monster"><span class="bt-l">+ NPC</span><span class="bt-s">NPC</span></button>'
      +'<button class="btn '+(this._tool==='erase'?'active':'')+'" data-mact="tool-erase" title="Erase tokens and drawings">'+ICO('i-trash')+'<span class="bt-l">Erase</span></button>'
      +'<button class="btn '+(this._tool==='draw'?'active':'')+'" data-mact="tool-draw" title="Pencil — draw on the map">'+ICO('i-pencil')+'<span class="bt-l">Draw</span></button>'
      +(this._tool==='draw' ? '<input type="color" id="draw-color" value="'+this._drawColor+'" style="width:24px;height:22px;padding:1px;border-radius:3px;flex-shrink:0;cursor:pointer" title="Brush color">' : '')
      +(this._tool==='draw' ? '<select id="draw-size" style="width:64px;font-size:var(--fs-sm);padding:2px 4px;flex-shrink:0">'
        +'<option value="2"'+(this._drawSize===2?' selected':'')+'>Thin</option>'
        +'<option value="4"'+(this._drawSize===4?' selected':'')+'>Med</option>'
        +'<option value="8"'+(this._drawSize===8?' selected':'')+'>Thick</option>'
      +'</select>' : '')
      +'<div class="bm-div" style="width:1px;background:var(--border);height:18px;margin:0 4px;flex-shrink:0"></div>'
      +'<span class="bt-l" style="font-size:var(--fs-xs);color:var(--text-muted);flex-shrink:0;margin-left:2px">Grid</span>'
      +'<input type="number" id="map-size" min="8" max="400" step="1" value="'+cs+'" style="width:54px;font-size:var(--fs-sm);padding:2px 4px;flex-shrink:0" title="Cell size in pixels (try 30, 50, 64, 80, 100, 120…)">'
      +'<select id="map-size-preset" style="width:34px;font-size:var(--fs-sm);padding:2px 1px;flex-shrink:0" title="Common sizes">'
        +'<option value="">…</option>'
        +'<option value="30">30</option>'
        +'<option value="40">40</option>'
        +'<option value="50">50</option>'
        +'<option value="64">64</option>'
        +'<option value="75">75</option>'
        +'<option value="80">80</option>'
        +'<option value="100">100</option>'
        +'<option value="120">120</option>'
        +'<option value="150">150</option>'
      +'</select>'
      +'<input type="color" id="map-bg-color" value="'+this._bgColor+'" style="width:28px;height:24px;padding:1px;border-radius:3px;cursor:pointer;flex-shrink:0" title="Background color">'
      +'<button class="btn" data-mact="pick-map" style="flex-shrink:0" title="Choose a map image">'+ICO('i-map')+'<span class="bt-l">Map</span></button>'
      +(_mapBgImage?'<button class="btn danger" data-mact="clear-img" style="flex-shrink:0" title="Remove the map image">'+ICO('i-close')+'<span class="bt-l">Map</span></button>':'')
      +(_mapBgImage?'<input type="range" id="map-bg-scale" min="0.1" max="3" step="0.05" value="'+(this._bgMapScale||1)+'" style="width:80px;flex-shrink:0" title="Map size">':'')
      +(_mapBgImage?'<span id="map-bg-scale-pct" style="font-size:var(--fs-xs);color:var(--text-muted);width:34px;text-align:right;flex-shrink:0">'+Math.round((this._bgMapScale||1)*100)+'%</span>':'')
      +(_mapBgImage?'<button class="btn" data-mact="fit-map" style="flex-shrink:0" title="Fit map to panel">⊙ Fit</button>':'')
      +'<button class="btn icon-btn '+(this._showGrid?'active':'')+'" data-mact="toggle-grid" style="flex-shrink:0" title="Grid style: cycle square → hex → none">'+ICO('i-grid')+'</button>'
      +'<button class="btn icon-btn '+(this._snapToGrid?'active':'')+'" data-mact="toggle-snap" style="flex-shrink:0" title="Snap tokens to grid on drop (Shift inverts)">'+ICO('i-magnet')+'</button>'
      +(_mapBgImage?'<button class="btn icon-btn '+(this._tool==='align'?'active':'')+'" data-mact="tool-align" style="flex-shrink:0" title="Align grid to printed map grid: click two opposite corners of one cell">'+ICO('i-ruler')+'</button>':'')
      +((this._gridOffsetX||this._gridOffsetY)?'<button class="btn icon-btn" data-mact="reset-align" style="flex-shrink:0" title="Reset grid alignment (offset back to 0,0)">'+ICO('i-refresh')+'</button>':'')
      // Fog cluster — only the toggle is visible by default. When fog is on,
      // its sub-controls (paint mode, brush radius, hide/show all) appear.
      +'<div class="bm-div" style="width:1px;background:var(--border);height:18px;margin:0 4px;flex-shrink:0"></div>'
      +'<button class="btn '+(this._fog!==null?'active':'')+'" data-mact="fog-toggle" style="flex-shrink:0" title="Toggle Fog of War">'+ICO('i-cloud')+'<span class="bt-l">Fog</span></button>'
      +(this._fog!==null?'<button class="btn icon-btn '+(this._fogTool?'active':'')+'" data-mact="fog-paint" style="flex-shrink:0" title="Paint to reveal fog">'+ICO('i-pencil')+'</button>':'')
      +(this._fog!==null&&this._fogTool?'<input type="range" id="fog-radius" min="1" max="5" value="'+(this._fogRadius||1)+'" style="width:50px;flex-shrink:0" title="Brush size">':'')
      +(this._fog!==null?'<button class="btn icon-btn" data-mact="fog-hide-all" style="flex-shrink:0" title="Hide entire map (fog everything)">'+ICO('i-eye-off')+'</button>':'')
      +(this._fog!==null?'<button class="btn icon-btn" data-mact="fog-show-all" style="flex-shrink:0" title="Reveal entire map">'+ICO('i-eye')+'</button>':'')
      +'<div class="bm-spacer" style="flex:1"></div>'
      // Undo/redo for fog, drawings and tokens. Fog is the one that matters:
      // a stray reveal shows the party a room you hadn't got to yet.
      +'<button class="btn icon-btn" data-mact="undo" style="flex-shrink:0" title="Undo (Ctrl+Z)">'+ICO('i-undo')+'</button>'
      +'<button class="btn icon-btn" data-mact="redo" style="flex-shrink:0" title="Redo (Ctrl+Shift+Z)">'+ICO('i-redo')+'</button>'
      +'<button class="btn icon-btn '+(this._settingsOpen?'active':'')+'" data-mact="toggle-settings" style="flex-shrink:0" title="Map settings">'+ICO('i-gear')+'</button>'
    +'</div>';

    } // end !_toolbarHidden
    // Party bar — list of party members not yet placed on the map. Visible
    // in both DM and player toolbars (when the toolbar isn't collapsed) so
    // players can see their party-icon row mirrored from the DM view.
    if (partyBtns && !this._toolbarHidden){
      // flex-wrap lives in the stylesheet (.map-party-bar), not inline: an
      // inline style beats any selector without !important, so with it here
      // the phone layout could not switch this row to a single scroller.
      html+='<div class="map-party-bar" style="display:flex;gap:4px;padding:4px 8px;border-bottom:1px solid var(--border);background:var(--panel-2);align-items:center">'
        +'<span class="bt-l" style="font-size:var(--fs-xs);color:var(--text-muted)">Party:</span>'+partyBtns+'</div>';
    }

    // Map area + settings sidebar side-by-side. Settings sidebar is rendered
    // outside the scrollable map area so the map keeps panning/zooming without
    // affecting the controls.
    html+='<div class="bm-main" style="flex:1;display:flex;min-height:0;overflow:hidden;position:relative">'
      +'<div id="map-scroll" style="flex:1;overflow:auto;background:#111;position:relative;'
        + (this._tokensVisible?'':'--bm-hide-tokens:1;')+'">'
      // Two wrappers, deliberately. #map-sizer carries the SCALED layout size
      // so #map-scroll gets correct scrollbars (a CSS transform doesn't affect
      // layout, so without this you could zoom in but not scroll to the rest
      // of the map). #map-zoom carries the scale at origin 0 0. They stay
      // separate from #map-stage because that element already owns rotate()
      // at origin 50% 50% — compositing the two on one element would need a
      // hand-written translate sandwich recomputed on every resize, and every
      // existing querySelector('#map-stage') would still have to keep working.
      +'<div id="map-sizer" style="position:relative">'
      +'<div id="map-zoom" style="position:absolute;top:0;left:0;transform-origin:0 0">'
      +'<div id="map-stage" class="'
        + (this._tokensVisible?'':'hide-tokens ')
        + (this._namesVisible?'':'hide-names ')
        + (this._pcsVisible?'':'hide-pcs ')
        + (this._npcsVisible?'':'hide-npcs ')
        + '" style="position:relative;display:inline-block'
        + (this._mapRotation ? `;transform-origin:50% 50%;transform:rotate(${this._mapRotation}deg)` : '')
        + '">'
        +'<canvas id="map-canvas" style="display:block;position:absolute;left:0;top:0;z-index:1"></canvas>'
      +'</div>'   // #map-stage
      +'</div>'   // #map-zoom
      +'</div>'   // #map-sizer
      +'</div>'   // #map-scroll
      + (this._settingsOpen ? this._renderSettingsSidebar() : '')
    +'</div>';

    html+='<div class="map-foot" style="padding:3px 10px;border-top:1px solid var(--border);background:var(--panel-2);font-size:var(--fs-xs);color:var(--text-muted);display:flex;align-items:center;gap:10px;flex-shrink:0">'
      +'<span>1 '+(this._gridType==='hex'?'hex':'sq')+' = <strong>'+_bmDist(ft)+'</strong></span>'
      +'<span class="bt-l" style="color:var(--text-dim)">'+this._cols+'×'+this._rows+' '+(this._gridType==='hex'?'hexes':'squares')+' ('+_bmDist(this._cols*ft)+' × '+_bmDist(this._rows*ft)+')</span>'
      +'<span style="flex:1"></span>'
      // Hidden on touch by CSS: there is no right-click on a phone, so this
      // hint spent a row of a 390px screen telling you to do something you
      // can't.
      +'<span class="map-foot-hint" style="font-size:var(--fs-2xs);color:var(--text-dim)">Drag tokens freely · Right-click for options</span>'
    +'</div>';

    html+='<div id="token-panel" style="position:absolute;right:8px;top:52px;width:164px;background:var(--panel);border:1px solid var(--border);border-radius:5px;padding:10px;font-size:var(--fs-sm);z-index:20;display:none;box-shadow:0 4px 16px rgba(0,0,0,.5)">'
      +'<div style="font-weight:500;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">'
        +'<span id="tp-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px">Token</span>'
        +'<button class="btn icon-btn" id="tp-close" style="padding:0 4px;font-size:var(--fs-lg);flex-shrink:0">'+ICO('i-close')+'</button>'
      +'</div>'
      +'<label class="field-label">Label</label>'
      +'<input type="text" id="tp-label" style="margin-bottom:6px;font-size:var(--fs-sm)">'
      +'<label class="field-label">Color</label>'
      +'<input type="color" id="tp-color" style="width:100%;height:26px;margin-bottom:6px;cursor:pointer">'
      +'<label class="field-label">Size (cells)</label>'
      +'<div style="display:flex;gap:4px;margin-bottom:8px;align-items:center">'
        +'<button class="btn icon-btn" id="tp-size-down" title="Smaller (¼ cell)" style="padding:1px 6px;font-size:var(--fs-lg)">−</button>'
        +'<input type="range" id="tp-size" min="0.25" max="6" step="0.25" value="1" style="flex:1">'
        +'<button class="btn icon-btn" id="tp-size-up" title="Bigger (¼ cell)" style="padding:1px 6px;font-size:var(--fs-lg)">+</button>'
        +'<span id="tp-size-val" style="font-size:var(--fs-sm);color:var(--text-muted);min-width:52px;text-align:right">1.00 cells</span>'
      +'</div>'
      +'<label class="field-label">Facing</label>'
      +'<div style="display:flex;gap:3px;margin-bottom:6px;align-items:center">'
        +'<button class="btn icon-btn" id="tp-rot-left" title="Rotate -45°" style="padding:1px 6px;font-size:var(--fs-sm)">↺</button>'
        +'<input type="range" id="tp-rot" min="0" max="359" step="5" value="0" style="flex:1">'
        +'<button class="btn icon-btn" id="tp-rot-right" title="Rotate +45°" style="padding:1px 6px;font-size:var(--fs-sm)">↻</button>'
        +'<span id="tp-rot-val" style="font-size:var(--fs-xs);color:var(--text-muted);min-width:30px;text-align:right">0°</span>'
      +'</div>'
      +'<div style="display:flex;gap:4px">'
        +'<button class="btn small" id="tp-kill" style="flex:1">☠</button>'
        +'<button class="btn small danger" id="tp-del" style="flex:1">Del</button>'
      +'</div>'
    +'</div>';

    b.innerHTML=html;
    this._setupMap();
    // Restore scroll on the freshly-mounted #map-scroll so cursor-centered
    // wheel-zoom doesn't reset to top-left when the debounced re-render fires.
    const newScroll = b.querySelector('#map-scroll');
    if (newScroll){ newScroll.scrollLeft = savedSx; newScroll.scrollTop = savedSy; }
    // Restore the settings drawer scroll position after the rebuild so
    // clicking tiles deep in the drawer doesn't fling the user back to the
    // MAP section every time.
    const newSettings = b.querySelector('.bm-settings');
    if (newSettings && savedSettingsScroll) newSettings.scrollTop = savedSettingsScroll;
  },

  _setupMap(){
    const b=this._body;if(!b)return;
    const canvas=b.querySelector('#map-canvas');
    const stage=b.querySelector('#map-stage');
    // Use the on-screen cell size (scales with zoom) so the canvas, grid, and
    // bg image always line up in the same coordinate space.
    const cs=this._csScreen();
    const W=this._cols*cs, H=this._rows*cs;

    stage.style.width=W+'px'; stage.style.height=H+'px';

    this._applyBg(stage,W,H);
    this._drawGrid(canvas,cs);
    // Drawing canvas — sits between grid and tokens. pointer-events disabled
    // unless the pencil tool is active so clicks pass through to the main
    // canvas (placement) or tokens.
    let drawCanvas = stage.querySelector('#draw-canvas');
    if (!drawCanvas){
      drawCanvas = document.createElement('canvas');
      drawCanvas.id = 'draw-canvas';
      // z-index 1 puts drawings between the bg/grid (default stacking) and
      // tokens (which use inline z-index:2). Tokens always render on top.
      drawCanvas.style.cssText = 'position:absolute;top:0;left:0;z-index:1';
      stage.appendChild(drawCanvas);
    }
    // Backing store sized by _sizeLayer (k× for sharpness); _drawAllStrokes
    // below inherits the scaled context it leaves on the canvas.
    this._sizeLayer(drawCanvas, W, H);
    // Draw canvas needs to receive clicks for the pencil AND for the eraser
    // (to remove strokes). Other tools/no-tool let clicks pass through.
    drawCanvas.style.pointerEvents = (this._tool === 'draw' || this._tool === 'erase') ? 'auto' : 'none';
    this._drawAllStrokes();
    this._renderTokens();
    // Size the zoom wrappers to match the stage we just built. Must happen
    // BEFORE _render() restores scrollLeft/scrollTop — if the sizer is still
    // 0×0 the browser clamps the restored scroll to 0 and the view jumps to
    // the top-left corner on every re-render.
    this._applyViewScale(null);
    // Viewport-sized layers have to repaint as the viewport moves. Bound once
    // and swapped on re-render, mirroring the _docMouseUp pattern — _setupMap
    // runs on every _render(), so an anonymous handler here would leak one
    // listener per render (the bug npc-library had).
    const scrollHost = b.querySelector('#map-scroll');
    if (scrollHost){
      if (this._onScrollBound) scrollHost.removeEventListener('scroll', this._onScrollBound);
      this._onScrollBound = () => this._onMapScroll();
      scrollHost.addEventListener('scroll', this._onScrollBound, { passive: true });
    }
    // _render() rebuilds the toolbar, so the buttons come back enabled —
    // re-sync them to the actual stack depth.
    this._updateUndoButtons();

    // Default tool is now empty string — tokens are always draggable
    // Tool only controls what happens on canvas click (place PC/NPC or erase)
    if(this._tool==='move') this._tool='';

    // Toolbar actions
    b.querySelectorAll('[data-mact]').forEach(btn=>btn.addEventListener('click',e=>{
      e.stopPropagation();
      const act=btn.dataset.mact;
      if(act.startsWith('tool-')){
        const t=act.slice(5);
        // Toggle off if already active
        this._tool=this._tool===t?'':t;
        // Reset alignment-tool transient state when leaving the mode.
        if (this._tool !== 'align'){
          this._alignFirstClick = null;
          this._removeAlignMarker();
        } else if (typeof showToast === 'function') {
          showToast('Align: click two grid intersections. Span MULTIPLE cells for accuracy.');
        }
        // Full re-render so the toolbar reveals/hides tool-specific controls
        // (e.g. the draw color/size pickers) AND the draw canvas's
        // pointer-events flag flips with the new tool state. Without this the
        // pencil tool can't catch clicks because the canvas above it stays
        // pointer-events:none.
        this._render();
      }
      else if(act==='sync-combat') this._syncParty();
      else if(act==='toggle-settings'){
        this._settingsOpen = !this._settingsOpen;
        this._render();
      }
      else if(act==='clear-tokens'){
        showConfirm('Remove all tokens from the battle map?', {title:'Clear tokens', confirmLabel:'Remove', danger:true}).then(ok=>{
          if(!ok) return;
          this._tokens=[]; this._selected=null; this._closePanel(); this._saveMap(); this._render();
        });
      }
      else if(act==='clear-img'){_mapBgImage=null;this._bgMapPath=null;this._saveMap();this._applyBg(stage,W,H);this._render();}
      else if(act==='pick-map'){this._openMapPicker();}
      else if(act==='toggle-toolbar'){
        this._toolbarHidden = !this._toolbarHidden;
        try { localStorage.setItem('skt-bm-toolbar-hidden', this._toolbarHidden ? '1' : '0'); } catch(e){}
        // Don't auto-refit on the resulting size change — the user wants the
        // current view preserved, not snapped back to fit-from-top-left.
        this._isFitted = false;
        this._render();
      }
      else if(act==='toggle-grid'){
        // Cycle square → hex → none → square
        const next = this._gridType === 'square' ? 'hex' : (this._gridType === 'hex' ? 'none' : 'square');
        this._gridType = next; this._showGrid = next !== 'none';
        this._saveMap(); this._render();
      }
      else if(act==='toggle-snap'){this._snapToGrid=!this._snapToGrid;this._saveMap();this._render();}
      else if(act==='reset-align'){
        this._gridOffsetX=0; this._gridOffsetY=0;
        this._alignFirstClick=null;
        this._saveMap();
        this._render();
        if (typeof showToast==='function') showToast('Grid offset reset');
      }
      else if(act==='clear-draw'){
        if (!this._drawings.length) return;
        showConfirm('Erase every pencil annotation on this map?', {title:'Clear drawings', confirmLabel:'Clear', danger:true}).then(ok=>{
          if(!ok) return;
          this._drawings = [];
          this._saveMap();
          this._render();
        });
      }
      else if(act==='undo'){this._undo();}
      else if(act==='redo'){this._redo();}
      else if(act==='fit-map'){this._fitMapToView();}
      else if(act==='fog-toggle'){
        this._fog=this._fog!==null?null:new Set();
        if(this._fog!==null)this._fogTool=true;
        else this._fogTool=false;
        this._saveMap();this._render();
      }
      else if(act==='fog-paint'){this._fogTool=!this._fogTool;this._render();}
      else if(act==='fog-hide-all'){this._fog=new Set();this._saveMap();this._drawFog();this._broadcast();}
      else if(act==='fog-show-all'){
        const all=new Set();
        for(let x=0;x<this._cols;x++)for(let y=0;y<this._rows;y++)all.add(x+','+y);
        this._fog=all;this._saveMap();this._drawFog();this._broadcast();
      }
      else if(act==='open-player'){
        const url=window.location.href.split('?')[0]+'?player=1';
        const w=window.open(url,'skt-player','width=1280,height=720');
        if(!w)showToast('Allow popups to open player view');
        else showToast('Player view opened');
      }
      else if(act==='add-party'){
        const pi=+btn.dataset.pi;
        const p=state.party[pi];
        if(!p)return;
        // Drop the token where the DM is LOOKING, not at the top-left corner
        // and not at the middle of the whole map. Zoomed into one room, the
        // token should land in that room — otherwise every add means hunting
        // for the token and dragging it back across the map.
        //
        // _viewCenterStage handles the workspace zoom, the per-device view
        // scale and rotation because it goes through _stagePoint. Falling back
        // to the middle of the map keeps this sane if the view can't be
        // measured (panel not laid out yet).
        const cs2=this._csScreen();
        const centre = this._viewCenterStage()
          || { x: this._cols*cs2/2, y: this._rows*cs2/2 };
        // Spiral out from there so adding the whole party doesn't pile every
        // member onto one square.
        const spot = this._freeCellNear(centre.x, centre.y);
        this._tokens.push({id:uid(),label:p.name,x:spot.x,y:spot.y,isPC:true,color:'#696969',size:1,dead:false,icon:p.icon||'⚔',portrait:p.portrait||null});
        this._renderTokens();this._saveMap();
        this._render(); // refresh party quick-add row
      }
    }));

    const applySize = (val) => {
      const n = parseInt(val);
      if (!n || n < 8 || n > 400) return;
      this._cellSize = n;
      if (_mapBgImage){
        // Map loaded: keep grid tight to the image at the new cell size.
        this._fitGridToBg();
      } else {
        const scroll=b.querySelector('#map-scroll');
        if(scroll){
          const cs2=this._cellSize;
          this._cols=Math.max(16,Math.floor(scroll.clientWidth/cs2));
          this._rows=Math.max(12,Math.floor(scroll.clientHeight/cs2));
        }
      }
      this._saveMap();this._render();
    };
    b.querySelector('#map-size')?.addEventListener('change',e=>applySize(e.target.value));
    b.querySelector('#map-size-preset')?.addEventListener('change',e=>{
      if (e.target.value) applySize(e.target.value);
    });
    // Map size slider — only present when an image is loaded.
    // `input` fires continuously while dragging; `change` fires on release.
    // Both run the same comprehensive in-place update — no innerHTML thrash,
    // so the slider drag stays smooth and there's no settle-flicker.
    b.querySelector('#map-bg-scale')?.addEventListener('input',e=>{
      this._isFitted = false;
      // Drives _viewScale only. No _scaleTokensTo, no _bgMapScale write —
      // dragging this slider must not move anybody else's tokens.
      this._applyViewScale(parseFloat(e.target.value));
    });
    b.querySelector('#map-bg-scale')?.addEventListener('change',()=>{
      // Persist to the per-device key on release, NOT _saveMap(). Zoom is no
      // longer campaign state.
      this._saveViewState();
    });
    b.querySelector('#fog-radius')?.addEventListener('input',e=>{this._fogRadius=parseInt(e.target.value)||1;});
    b.querySelector('#draw-color')?.addEventListener('input',e=>{this._drawColor=e.target.value;});
    b.querySelector('#draw-size')?.addEventListener('change',e=>{this._drawSize=parseInt(e.target.value)||4;});

    // Pencil + eraser — mousedown starts an action; subsequent mousemoves
    // continue it. Only active when draw/erase is selected (otherwise
    // pointer-events:none on draw-canvas means we never see events).
    let _curStroke = null;
    drawCanvas.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      // _stagePoint handles the workspace zoom (CSS scale) AND the stage
      // rotation — plain rect math misplaced draw/erase whenever zoom != 1
      // or the map was rotated.
      const p0 = this._stagePoint(e.clientX, e.clientY, drawCanvas);
      const x = Math.round(p0.x);
      const y = Math.round(p0.y);

      if (this._tool === 'erase'){
        e.preventDefault(); e.stopPropagation();
        // Erase any stroke under the click. If nothing is hit, fall through
        // (return) — token erasing is handled by token mousedown handlers.
        let removed = this._eraseStrokeAt(x, y);
        // Drag-to-erase: keep removing strokes the cursor passes over.
        const onMove = ev => {
          const mp = this._stagePoint(ev.clientX, ev.clientY, drawCanvas);
          if (this._eraseStrokeAt(Math.round(mp.x), Math.round(mp.y))) removed = true;
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          if (removed) this._saveMap();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        return;
      }

      if (this._tool !== 'draw') return;
      e.preventDefault(); e.stopPropagation();
      _curStroke = { c: this._drawColor, s: this._drawSize, p: [x, y] };
      this._drawings.push(_curStroke);
      // Live broadcast throttle — push a stroke-tick to player tabs at most
      // 10 fps. Keeps Firebase write traffic minimal while still feeling live.
      let _lastTick = 0;
      const tickIfDue = () => {
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        if (now - _lastTick < 100) return;
        _lastTick = now;
        this._broadcastStrokeTick(_curStroke);
      };
      // Send the initial point so a freshly-joined player sees the dot.
      this._broadcastStrokeTick(_curStroke);
      const onMove = ev => {
        if (!_curStroke) return;
        const mp = this._stagePoint(ev.clientX, ev.clientY, drawCanvas);
        const x2 = Math.round(mp.x);
        const y2 = Math.round(mp.y);
        const lp = _curStroke.p;
        const lx = lp[lp.length-2], ly = lp[lp.length-1];
        if (Math.abs(x2 - lx) + Math.abs(y2 - ly) < 3) return; // sample-down
        lp.push(x2, y2);
        this._drawStrokeIncremental(drawCanvas, _curStroke);
        tickIfDue();
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        _curStroke = null;
        // Clear the live preview slot, then push the canonical state with
        // the new stroke now in _drawings.
        this._broadcastStrokeEnd();
        this._saveMap();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Touch parity — phones/tablets don't fire mouse events on canvas, so the
    // draw/erase tools were silently dead. Wire the same start/move/end flow
    // off touchstart/touchmove/touchend. Single-finger only — multi-touch
    // pinch/pan is handled at the workspace level above.
    drawCanvas.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      // Same zoom+rotation-aware conversion as the mouse path above.
      const p0 = this._stagePoint(touch.clientX, touch.clientY, drawCanvas);
      const x = Math.round(p0.x);
      const y = Math.round(p0.y);

      if (this._tool === 'erase'){
        e.preventDefault(); e.stopPropagation();
        let removed = this._eraseStrokeAt(x, y);
        const onMove = ev => {
          if (ev.touches.length !== 1) return;
          ev.preventDefault();
          const t2 = ev.touches[0];
          const mp = this._stagePoint(t2.clientX, t2.clientY, drawCanvas);
          if (this._eraseStrokeAt(Math.round(mp.x), Math.round(mp.y))) removed = true;
        };
        const onEnd = () => {
          document.removeEventListener('touchmove', onMove);
          document.removeEventListener('touchend', onEnd);
          document.removeEventListener('touchcancel', onEnd);
          if (removed) this._saveMap();
        };
        document.addEventListener('touchmove', onMove, { passive:false });
        document.addEventListener('touchend', onEnd);
        document.addEventListener('touchcancel', onEnd);
        return;
      }

      if (this._tool !== 'draw') return;
      e.preventDefault(); e.stopPropagation();
      _curStroke = { c: this._drawColor, s: this._drawSize, p: [x, y] };
      this._drawings.push(_curStroke);
      let _lastTick = 0;
      const tickIfDue = () => {
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        if (now - _lastTick < 100) return;
        _lastTick = now;
        this._broadcastStrokeTick(_curStroke);
      };
      this._broadcastStrokeTick(_curStroke);
      const onMove = ev => {
        if (!_curStroke || ev.touches.length !== 1) return;
        ev.preventDefault();
        const t2 = ev.touches[0];
        const mp = this._stagePoint(t2.clientX, t2.clientY, drawCanvas);
        const x2 = Math.round(mp.x);
        const y2 = Math.round(mp.y);
        const lp = _curStroke.p;
        const lx = lp[lp.length-2], ly = lp[lp.length-1];
        if (Math.abs(x2 - lx) + Math.abs(y2 - ly) < 3) return;
        lp.push(x2, y2);
        this._drawStrokeIncremental(drawCanvas, _curStroke);
        tickIfDue();
      };
      const onEnd = () => {
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
        document.removeEventListener('touchcancel', onEnd);
        _curStroke = null;
        this._broadcastStrokeEnd();
        this._saveMap();
      };
      document.addEventListener('touchmove', onMove, { passive:false });
      document.addEventListener('touchend', onEnd);
      document.addEventListener('touchcancel', onEnd);
    }, { passive:false });

    b.querySelector('#map-bg-color')?.addEventListener('change',e=>{this._bgColor=e.target.value;this._applyBg(stage,W,H);this._saveMap();});
    // Update stage cursor when fog tool active
    if(this._fogTool || this._tool==='align') stage.style.cursor='crosshair';
    else stage.style.cursor='default';

    // Canvas click = place token when in add-pc/add-npc mode
    canvas.addEventListener('click',e=>{
      if(this._drag?.moved) return;
      // Zoom + rotation-aware conversion (see _stagePoint).
      const _cp = this._stagePoint(e.clientX, e.clientY, canvas);
      let cx=_cp.x, cy=_cp.y;
      // Two-click grid alignment mode — click two opposite corners of one
      // cell on the printed map grid; we infer cell size + offset from that.
      if (this._tool === 'align' && _mapBgImage){
        const scale = this._bgMapScale || 1;
        const ix = cx / scale, iy = cy / scale; // image-pixel space
        if (!this._alignFirstClick){
          this._alignFirstClick = { ix, iy, cx, cy };
          this._showAlignMarker(cx, cy);
          if (typeof showToast === 'function') showToast('Now click another intersection. Spanning multiple cells = more accurate.');
          return;
        }
        const a = this._alignFirstClick;
        const dxImg = Math.abs(ix - a.ix), dyImg = Math.abs(iy - a.iy);
        // Estimate how many cells the user spanned on each axis using the
        // CURRENT cellSize as a hint. Then ask them to confirm/correct via
        // a small prompt — this is what fixes the "drifts further out"
        // bug: measuring N cells instead of 1 divides the alignment error
        // by N. Decimal cellSize (no rounding) eliminates the rest.
        const cur = this._cellSize || 50;
        const guessNx = Math.max(1, Math.round(dxImg / cur));
        const guessNy = Math.max(1, Math.round(dyImg / cur));
        const askAndApply = (nx, ny) => {
          // Don't round — the renderer takes a fractional cellSize, so honor a
          // fractional span (e.g. the user measured 2.5 cells). Rounding here
          // threw away the precision the multi-cell measurement was meant to buy.
          nx = Math.max(0.1, parseFloat(nx) || 1);
          ny = Math.max(0.1, parseFloat(ny) || 1);
          // Cell size on each axis. They SHOULD be equal for a square grid;
          // averaging cancels any small click error. Keep as a float — the
          // canvas renderer accepts fractional values just fine.
          const csX = dxImg / nx;
          const csY = dyImg / ny;
          const newCs = Math.max(8, (csX + csY) / 2);
          const minIx = Math.min(ix, a.ix), minIy = Math.min(iy, a.iy);
          this._cellSize = newCs;
          this._gridOffsetX = ((minIx % newCs) + newCs) % newCs;
          this._gridOffsetY = ((minIy % newCs) + newCs) % newCs;
          this._alignFirstClick = null;
          this._tool = '';
          this._removeAlignMarker();
          this._fitGridToBg();
          this._saveMap();
          this._render();
          if (typeof showToast === 'function') showToast('Grid aligned: ' + newCs.toFixed(2) + 'px cells');
        };
        // Skip the prompt only when the user picked two corners of a
        // single cell (the original UX). For multi-cell spans, confirm
        // the count so we compute cellSize correctly.
        if (guessNx <= 1 && guessNy <= 1){
          askAndApply(1, 1);
        } else if (typeof showModal === 'function'){
          showModal('Align grid', [
            { id: 'nx', label: 'Cells spanned horizontally', type: 'number', value: guessNx, min: 1, max: 200 },
            { id: 'ny', label: 'Cells spanned vertically',   type: 'number', value: guessNy, min: 1, max: 200 },
          ], 'Align').then(res => {
            if (!res){
              // User cancelled — reset transient state without applying.
              this._alignFirstClick = null;
              this._tool = '';
              this._removeAlignMarker();
              this._render();
              return;
            }
            askAndApply(parseFloat(res.nx), parseFloat(res.ny));
          });
        } else {
          askAndApply(guessNx, guessNy);
        }
        return;
      }
      if(!this._tool||this._tool==='erase') return;
      const csClick = this._csScreen();
      if(cx<0||cy<0||cx>this._cols*csClick||cy>this._rows*csClick) return;
      // Snap to grid cell center if snap is on (Shift inverts).
      const wantSnap = e.shiftKey ? !this._snapToGrid : this._snapToGrid;
      if (wantSnap){
        cx = Math.floor(cx/csClick)*csClick + csClick/2;
        cy = Math.floor(cy/csClick)*csClick + csClick/2;
      }
      // Dedupe: don't place a new token directly on top of an existing one.
      if(this._tokens.find(t => Math.abs((t.x||0)-cx) < csClick/2 && Math.abs((t.y||0)-cy) < csClick/2)) return;
      const isPC=this._tool==='add-pc';
      showModal((isPC?'Place PC':'Place NPC'),[
        {id:'label',label:'Name',type:'text',value:'',placeholder:isPC?'PC name':'Enemy name'}
      ],'Place').then(r2=>{
        if(!r2||!r2.label)return;
        this._tokens.push({id:uid(),label:r2.label,x:cx,y:cy,isPC,color:'#696969',size:1,dead:false});
        this._renderTokens();this._saveMap();
      });
    });

    // Fog painting — mousedown + drag. _fog holds REVEALED cells. Reveal
    // mode adds to the set (clears fog), Hide mode removes from the set
    // (re-fogs cells the player had seen).
    const fogPaint=(e)=>{
      if(!this._fogTool||this._fog===null)return;
      // Zoom + rotation-aware conversion (see _stagePoint) — plain rect math
      // painted the wrong cells whenever zoom != 1 or the map was rotated.
      const _sp = this._stagePoint(e.clientX, e.clientY, canvas);
      const ex = _sp.x;
      const ey = _sp.y;
      // Recompute `cs` per event rather than trusting the closure's copy,
      // captured once at _setupMap time. A map swap or an Align adjustment
      // changes _cellSize/_bgMapScale without re-running _setupMap, and a
      // stale cs makes every `(e.clientX-r.left)/cs` division land on the
      // wrong cell (and the brush cover a wrong-sized area).
      const cs = this._csScreen();
      const radius=this._fogRadius||1;
      const mode  = this._fogPaintMode  || 'reveal';
      const shape = this._fogBrushShape || 'square';
      // Free mode — record a pixel-level stroke in cell-fraction coords so it
      // survives zoom. The fog canvas redraw paints these on top of the
      // cell-based reveal pass.
      if ((this._fogBrushMode || 'grid') === 'free'){
        const xc = ex / cs;
        const yc = ey / cs;
        // Free brush radius (in cells): matches grid coverage roughly —
        // radius=1 → 0.5 cell radius (1-cell diameter), radius=5 → 4.5 cell radius.
        const rCells = Math.max(0.25, radius - 0.5);
        this._fogStrokes.push({xc, yc, r:rCells, op:mode, shape});
        // Repaint locally every move so the DM gets immediate feedback —
        // batched to one redraw per frame. Defer the broadcast until mouseup
        // (handled below) to avoid hammering BroadcastChannel/Firebase.
        this._invalidate({fog:true});
        this._fogStrokeDirty = true;
        return;
      }
      // Grid mode — snap to cells. Optional circle shape skips corner cells
      // outside (radius - 0.5)² distance from the brush center.
      // Honor the Align-tool grid offset so revealed cells land on the DRAWN
      // grid squares, not the raw 0,0 origin. _drawGrid offsets its lines the
      // same way and _drawFog mirrors this when rendering — without it, an
      // aligned grid (non-zero offset) reveals shifted off the squares.
      const _fpScale = _mapBgImage ? (this._bgMapScale || 1) : 1;
      const offX = (((this._gridOffsetX || 0) * _fpScale) % cs + cs) % cs;
      const offY = (((this._gridOffsetY || 0) * _fpScale) % cs + cs) % cs;
      const gx=Math.floor((ex-offX)/cs);
      const gy=Math.floor((ey-offY)/cs);
      const r2 = (radius - 0.5) * (radius - 0.5);
      let changed=false;
      for(let dx=-radius+1;dx<radius;dx++){
        for(let dy=-radius+1;dy<radius;dy++){
          if (shape === 'circle' && (dx*dx + dy*dy) > r2) continue;
          const nx=gx+dx, ny=gy+dy;
          if(nx>=0&&ny>=0&&nx<this._cols&&ny<this._rows){
            const key=nx+','+ny;
            if (mode === 'hide'){
              if (this._fog.has(key)){ this._fog.delete(key); changed=true; }
            } else {
              if (!this._fog.has(key)){ this._fog.add(key); changed=true; }
            }
          }
        }
      }
      if(changed){this._invalidate({fog:true});this._broadcastThrottled();}
    };
    canvas.addEventListener('mousedown',e=>{
      if (e.button !== 0) return; // middle/right click handled by pan logic below
      if(!this._fogTool||this._tool==='add-pc'||this._tool==='add-npc')return;
      e.stopPropagation();e.preventDefault();
      this._isPainting=true;
      fogPaint(e);
    });
    canvas.addEventListener('mousemove',e=>{
      if(this._isPainting&&this._fogTool)fogPaint(e);
      // Cell-highlight hover tracking. Cheap: only updates when the cell
      // under the cursor actually changes, then repaints the grid canvas.
      if (this._cellHighlight){
        const _hp = this._stagePoint(e.clientX, e.clientY, canvas);
        const cell = this._cellAtPx(_hp.x, _hp.y);
        const prev = this._hoverCell;
        const same = prev && cell && (
          (cell.col!=null && prev.col===cell.col && prev.row===cell.row) ||
          (cell.q!=null   && prev.q===cell.q     && prev.r===cell.r)
        );
        if (!same){
          this._hoverCell = cell;
          this._invalidate({grid:true});
        }
      }
    });
    canvas.addEventListener('mouseleave',()=>{
      if (this._cellHighlight && this._hoverCell){
        this._hoverCell = null;
        this._invalidate({grid:true});
      }
    });
    // One document-level mouseup total — _setupMap() runs on every _render(),
    // so an anonymous listener here accumulated one copy per render and was
    // never removed on unmount. Swap the old one out before re-adding.
    if (this._docMouseUp) document.removeEventListener('mouseup', this._docMouseUp);
    this._docMouseUp = ()=>{
      if(this._isPainting){
        this._isPainting=false;
        this._saveMap();
        // Free-mode painting deferred broadcast for performance — flush
        // a single payload now so players see the completed stroke.
        if (this._fogStrokeDirty){
          this._fogStrokeDirty = false;
          this._broadcast();
        }
      }
    };
    document.addEventListener('mouseup', this._docMouseUp);

    // Touch fog painting — mirror the mouse handlers so mobile/tablet DMs can
    // reveal/hide fog with a finger. fogPaint() reads clientX/clientY, which a
    // Touch object carries too, so we forward e.touches[0] straight through.
    // Single-finger only: 2-finger gestures fall through (pinch-zoom is gated
    // off while a fog tool is active, but we leave the door open for it).
    canvas.addEventListener('touchstart',e=>{
      if(!this._fogTool||this._tool==='add-pc'||this._tool==='add-npc')return;
      if(e.touches.length!==1)return;
      e.stopPropagation();e.preventDefault();
      this._isPainting=true;
      fogPaint(e.touches[0]);
    },{ passive:false });
    canvas.addEventListener('touchmove',e=>{
      if(!this._isPainting||!this._fogTool)return;
      if(e.touches.length!==1)return;
      e.preventDefault();
      fogPaint(e.touches[0]);
    },{ passive:false });
    const endFogTouch=()=>{
      if(this._isPainting){
        this._isPainting=false;
        this._saveMap();
        if(this._fogStrokeDirty){this._fogStrokeDirty=false;this._broadcast();}
      }
    };
    canvas.addEventListener('touchend',endFogTouch);
    canvas.addEventListener('touchcancel',endFogTouch);

    // Click empty stage = deselect
    stage.addEventListener('click',e=>{
      if(e.target!==canvas&&e.target!==stage) return;
      if(this._drag?.moved) return;
      this._selected=null;this._closePanel();this._renderTokens();
    });

    // ─── Map zoom/pan inside the panel ──────────────────────────────────────
    const scrollEl = b.querySelector('#map-scroll');
    // Wheel = zoom map content (cursor-centered). Ctrl+wheel still bubbles
    // up to zoom-pan.js for whole-workspace zoom.
    let _wheelTimer = null;
    scrollEl.addEventListener('wheel', e => {
      if (e.ctrlKey) return; // hand off to workspace zoom
      if (!_mapBgImage) return; // nothing to zoom without a map
      e.preventDefault();
      const oldScale = this._viewScale || 1;
      const factor = e.deltaY < 0 ? 1.1 : (1/1.1);
      const newScale = this._clampView(oldScale * factor);
      if (newScale === oldScale) return;

      const rect = scrollEl.getBoundingClientRect();
      // scrollLeft/scrollTop are in #map-sizer units — stage px × viewScale —
      // while clientX is screen space. Divide by the WORKSPACE zoom only:
      // #map-scroll sits inside the workspace transform but outside the map
      // one, so _viewScale must not appear here. It is already carried by
      // oldScale/newScale below, which is what makes the anchor math work.
      const _wz = (typeof getZoom === 'function') ? (getZoom() || 1) : 1;
      const cx = (e.clientX - rect.left)/_wz, cy = (e.clientY - rect.top)/_wz;
      // Stage-space point under the cursor before the zoom.
      const imgX = (scrollEl.scrollLeft + cx) / oldScale;
      const imgY = (scrollEl.scrollTop  + cy) / oldScale;

      this._isFitted = false; // manual zoom — panel resize should not re-fit
      // Display-only. No _scaleTokensTo: token coordinates are in stage space
      // and stage space does not move when this device zooms.
      this._applyViewScale(newScale);
      scrollEl.scrollLeft = imgX * newScale - cx;
      scrollEl.scrollTop  = imgY * newScale - cy;

      // Persist to the per-device key on settle. Note what is NOT here any
      // more: _saveMap(), which used to ship the whole battlemap blob
      // (tokens + fog + strokes + drawings) to Firebase on every wheel spin.
      clearTimeout(_wheelTimer);
      _wheelTimer = setTimeout(() => { this._saveViewState(); }, 180);
    }, { passive:false });

    // Pan: middle-click drag, right-click drag, or left-click drag on empty
    // stage when no placement/draw/erase tool is active. Tokens stop event
    // propagation themselves so they keep owning their own clicks.
    const panStart = (e) => {
      // Skip clicks on tokens (they have their own mousedown that calls
      // stopPropagation, but defensive in case anything bubbles).
      if (e.target.closest('.map-token')) return false;
      // Skip clicks on overlay buttons (e.g. the floating "Show toolbar" toggle).
      if (e.target.closest('button')) return false;
      e.preventDefault();
      // Once the user starts panning by hand, stop the resize observer from
      // auto-refitting on subsequent layout changes (panel resize, click-back,
      // toolbar toggle). The user clearly has a preferred view now.
      this._isFitted = false;
      const startX = e.clientX, startY = e.clientY;
      const startScrollX = scrollEl.scrollLeft, startScrollY = scrollEl.scrollTop;
      let didMove = false;
      scrollEl.style.cursor = 'grabbing';
      const onMove = ev => {
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (!didMove && Math.abs(dx)+Math.abs(dy) < 3) return;
        didMove = true;
        scrollEl.scrollLeft = startScrollX - dx;
        scrollEl.scrollTop  = startScrollY - dy;
      };
      const onUp = () => {
        scrollEl.style.cursor = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      return true;
    };
    scrollEl.addEventListener('mousedown', e => {
      // Middle/right always pan
      if (e.button === 1 || e.button === 2){ panStart(e); return; }
      // Left-click pan only when no other tool wants the click
      if (e.button === 0 && !this._tool && !this._fogTool){ panStart(e); }
    });
    // Suppress browser context menu so right-click drag is usable
    scrollEl.addEventListener('contextmenu', e => e.preventDefault());

    // ─── Touch support: 1-finger pan, 2-finger pinch-zoom ──────────────────
    // Only fires if the touch began on the map background (not a token —
    // those have their own touchstart that calls stopPropagation).
    let _touchPan = null;     // { startX, startY, startScrollX, startScrollY }
    let _touchPinch = null;   // { startDist, startScale, anchorX, anchorY }
    const touchDistance = (a, b) => Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    const touchMidpoint = (a, b, rect) => ({
      x: (a.clientX + b.clientX)/2 - rect.left,
      y: (a.clientY + b.clientY)/2 - rect.top,
    });
    scrollEl.addEventListener('touchstart', e => {
      // Skip if a tool is engaged (draw/erase/fog) — those need direct touches.
      if (this._tool || this._fogTool) return;
      if (e.touches.length === 1){
        const t = e.touches[0];
        _touchPan = {
          startX: t.clientX, startY: t.clientY,
          startScrollX: scrollEl.scrollLeft, startScrollY: scrollEl.scrollTop,
          didMove: false,
        };
      } else if (e.touches.length === 2){
        e.preventDefault();
        const rect = scrollEl.getBoundingClientRect();
        const mid = touchMidpoint(e.touches[0], e.touches[1], rect);
        _touchPan = null; // pinch supersedes pan
        _touchPinch = {
          startDist: touchDistance(e.touches[0], e.touches[1]),
          startScale: this._viewScale || 1,
          anchorX: mid.x, anchorY: mid.y,
          // Stage-space point under the pinch center, captured at the start.
          imgX: (scrollEl.scrollLeft + mid.x) / (this._viewScale || 1),
          imgY: (scrollEl.scrollTop  + mid.y) / (this._viewScale || 1),
        };
        this._isFitted = false;
      }
    }, { passive: false });
    scrollEl.addEventListener('touchmove', e => {
      if (_touchPinch && e.touches.length === 2){
        e.preventDefault();
        const dist = touchDistance(e.touches[0], e.touches[1]);
        const ratio = dist / _touchPinch.startDist;
        if (!_mapBgImage) return;
        const newScale = this._clampView(_touchPinch.startScale * ratio);
        // Display-only, exactly like the wheel path — a player pinching their
        // phone must not rescale the DM's tokens.
        this._applyViewScale(newScale);
        scrollEl.scrollLeft = _touchPinch.imgX * newScale - _touchPinch.anchorX;
        scrollEl.scrollTop  = _touchPinch.imgY * newScale - _touchPinch.anchorY;
      } else if (_touchPan && e.touches.length === 1){
        const t = e.touches[0];
        const dx = t.clientX - _touchPan.startX, dy = t.clientY - _touchPan.startY;
        if (!_touchPan.didMove && Math.abs(dx)+Math.abs(dy) < 6) return;
        _touchPan.didMove = true;
        this._isFitted = false;
        e.preventDefault();
        scrollEl.scrollLeft = _touchPan.startScrollX - dx;
        scrollEl.scrollTop  = _touchPan.startScrollY - dy;
      }
    }, { passive: false });
    const endTouch = () => {
      if (_touchPinch){
        // Per-device key, not _saveMap(). Nothing synced changed.
        this._saveViewState();
      }
      _touchPan = null;
      _touchPinch = null;
    };
    scrollEl.addEventListener('touchend', endTouch);
    scrollEl.addEventListener('touchcancel', endTouch);

    // ─── Drop zone: drop a Party member, Bestiary monster, or quick-add ─────
    // ─── button anywhere on the map to place a token at the cursor. ────────
    const dropTypes = ['application/x-skt-party-pi', 'application/x-skt-bestiary-mid'];
    const hasTokenDrop = (e) => dropTypes.some(t => e.dataTransfer.types.includes(t));
    scrollEl.addEventListener('dragover', e => {
      if (!hasTokenDrop(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      scrollEl.classList.add('map-drop-active');
    });
    scrollEl.addEventListener('dragleave', e => {
      if (e.target === scrollEl) scrollEl.classList.remove('map-drop-active');
    });
    scrollEl.addEventListener('drop', e => {
      scrollEl.classList.remove('map-drop-active');
      if (!hasTokenDrop(e)) return;
      e.preventDefault(); e.stopPropagation();
      // Compute drop position in stage coordinates (zoom + rotation aware).
      const stageEl = b.querySelector('#map-stage');
      // On-screen cell size — scales with zoom so snap and bounds match the
      // visible grid.
      const cs2 = this._csScreen();
      const _dp = this._stagePoint(e.clientX, e.clientY, stageEl);
      let x = _dp.x;
      let y = _dp.y;
      const wantSnap = e.shiftKey ? !this._snapToGrid : this._snapToGrid;
      if (wantSnap){
        x = Math.floor(x/cs2)*cs2 + cs2/2;
        y = Math.floor(y/cs2)*cs2 + cs2/2;
      }
      // Clamp to stage bounds so a token can't be dropped off the map.
      const stageW = this._cols*cs2, stageH = this._rows*cs2;
      const half = cs2/2;
      x = Math.max(half, Math.min(stageW - half, x));
      y = Math.max(half, Math.min(stageH - half, y));

      const pi  = e.dataTransfer.getData('application/x-skt-party-pi');
      const mid = e.dataTransfer.getData('application/x-skt-bestiary-mid');
      if (pi !== ''){
        const p = state.party[parseInt(pi)];
        if (!p) return;
        if (this._tokens.find(t => t.label === p.name && t.isPC)){ showToast(p.name+' already on map'); return; }
        this._tokens.push({id:uid(), label:p.name, x, y, isPC:true, color:'#696969', size:1, dead:false, icon:p.icon||'⚔', portrait:p.portrait||null});
        this._renderTokens(); this._saveMap();
        this._render(); // refresh quick-add row (the dropped member disappears from it)
      } else if (mid){
        const bData = panelDefs.bestiary?._data;
        const m = bData?.monsters.find(x=>x.id===mid);
        if (!m){ showToast('Monster not found'); return; }
        // Use the monster name; auto-number duplicates (Goblin → Goblin 2…).
        const existing = this._tokens.filter(t => t.baseName === m.name || t.label === m.name).length;
        const displayName = existing ? `${m.name} ${existing+1}` : m.name;
        if (existing === 1){
          const oi = this._tokens.findIndex(t => t.label === m.name);
          if (oi >= 0) this._tokens[oi] = {...this._tokens[oi], label: m.name+' 1', baseName: m.name};
        }
        const npcIcon = (typeof CLASS_ICONS !== 'undefined' ? (CLASS_ICONS[m.cls] || CLASS_ICONS.enemy) : null) || '🐲';
        // Use the bestiary's token-cropped head-shot if the monster has one,
        // so monsters get the same visual treatment as PCs (round portrait
        // inside the token ring) instead of a generic class-icon emoji.
        // 5etools ships images under bestiary/<source>/ with token-cropped
        // versions under bestiary/tokens/<source>/ — bestiaryPortraitPath
        // picks whichever exists (10% have no crop). Falls back to the
        // existing portrait field, then to the class-icon glyph.
        // NOTE: deliberately NOT assetUrl() — this value is STORED on the
        // token and synced to Firebase. Persisting an absolute CDN URL would
        // bake the current host into saved state (and break if it changes).
        // renderIcon() re-bases it through assetUrl() at render time.
        const tokenImg = m.img ? 'img/' + bestiaryPortraitPath(m.img) : null;
        const portrait = m.portrait || tokenImg || null;
        this._tokens.push({id:uid(), label:displayName, baseName:m.name, x, y, isPC:false, color:'#993333', size:1, dead:false, icon:npcIcon, portrait});
        this._renderTokens(); this._saveMap();
      }
    });

    // Quick-party-add buttons in the toolbar are now also drag sources —
    // drag onto the map for precise placement; the click handler still adds
    // them at the top-left as a quick fallback.
    b.querySelectorAll('[data-mact="add-party"]').forEach(btn => {
      btn.addEventListener('dragstart', e => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/x-skt-party-pi', btn.dataset.pi);
      });
    });

    // Settings sidebar wiring.
    this._wireSettingsSidebar();
  },

  // Surgical sidebar update for settings-only changes (paint mode, brush
  // shape, grid style, token visibility). A full _render() here rebuilt the
  // whole stage — toolbar, canvas handlers, tokens — for a change that only
  // re-tints a few tiles. _saveMap() (called by every handler) still
  // broadcasts, so players stay in sync either way.
  _refreshSettings(){
    const b = this._body; if (!b) return;
    const aside = b.querySelector('.bm-settings');
    if (!aside){ this._render(); return; }
    aside.outerHTML = this._renderSettingsSidebar();
    this._wireSettingsSidebar();
  },

  _wireSettingsSidebar(){
    const b = this._body; if (!b) return;
    // Tile buttons
    b.querySelectorAll('[data-bmset]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      if (btn.disabled) return;
      const k = btn.dataset.bmset;
      if (k === 'close'){ this._settingsOpen = false; this._render(); return; }
      if (k === 'pick-map'){ this._openMapPicker(); return; }
      if (k === 'fog-toggle'){
        this._fog = this._fog!==null ? null : new Set();
        if (this._fog!==null) this._fogTool = true;
        else this._fogTool = false;
        this._saveMap(); this._render(); return;
      }
      if (k === 'rotate'){
        this._mapRotation = ((this._mapRotation || 0) + 90) % 360;
        this._saveMap(); this._render(); return;
      }
      if (k === 'fog-reveal' || k === 'fog-hide'){
        this._fogPaintMode = k === 'fog-hide' ? 'hide' : 'reveal';
        const wasOn = this._fogTool;
        this._fogTool = true;
        this._saveMap();
        // Turning the fog tool ON changes the top toolbar (paint button state,
        // brush slider) → full render. A reveal↔hide swap while already
        // painting only re-tints sidebar tiles.
        if (wasOn) this._refreshSettings(); else this._render();
        return;
      }
      if (k === 'fog-clear'){
        // Reveal everything (clear fog)
        const all=new Set();
        for(let x=0;x<this._cols;x++)for(let y=0;y<this._rows;y++)all.add(x+','+y);
        this._fog=all;this._fogStrokes=[];this._saveMap();this._drawFog();this._broadcast();
        return;
      }
      if (k === 'fog-fill'){
        this._fog = new Set(); this._fogStrokes=[]; this._saveMap(); this._drawFog(); this._broadcast(); return;
      }
      // Before the grid-TYPE branch below, which slices k at 5 chars.
      // 'grid-color-auto' doesn't match any of its three exact keys, but
      // keeping this first makes that independent of how that check evolves.
      if (k === 'grid-color-auto'){
        this._gridColor = null;      // back to sampling the map art
        this._saveMap();
        const c = b.querySelector('#map-canvas');
        if (c) this._drawGrid(c, this._csScreen());
        this._refreshSettings();
        this._broadcast();
        return;
      }
      if (k === 'grid-square' || k === 'grid-hex' || k === 'grid-none'){
        this._gridType = k.slice(5); this._showGrid = this._gridType !== 'none';
        this._saveMap();
        // Same lightweight repaint the remote-update path uses — the grid
        // canvas redraws in place; nothing else on the stage changes.
        const c = b.querySelector('#map-canvas');
        if (c) this._drawGrid(c, this._csScreen());
        this._refreshSettings();
        return;
      }
      if (k === 'grid-cell'){
        this._cellHighlight = !this._cellHighlight;
        if (!this._cellHighlight) this._hoverCell = null;
        this._saveMap();
        const c = b.querySelector('#map-canvas');
        if (c) this._drawGrid(c, this._csScreen());
        this._refreshSettings();
        return;
      }
      if (k === 'fog-mode-grid' || k === 'fog-mode-free'){
        this._fogBrushMode = k === 'fog-mode-free' ? 'free' : 'grid';
        this._saveMap(); this._refreshSettings(); return;
      }
      if (k === 'fog-shape-square' || k === 'fog-shape-circle'){
        this._fogBrushShape = k === 'fog-shape-circle' ? 'circle' : 'square';
        this._saveMap(); this._refreshSettings(); return;
      }
      // Token visibility is pure CSS classes on the stage — toggle in place.
      if (k === 'tok-all' || k === 'tok-names' || k === 'tok-pcs' || k === 'tok-npcs'){
        if (k === 'tok-all')   this._tokensVisible = !this._tokensVisible;
        if (k === 'tok-names') this._namesVisible  = !this._namesVisible;
        if (k === 'tok-pcs')   this._pcsVisible    = !this._pcsVisible;
        if (k === 'tok-npcs')  this._npcsVisible   = !this._npcsVisible;
        this._saveMap();
        const stage = b.querySelector('#map-stage');
        if (stage){
          stage.classList.toggle('hide-tokens', !this._tokensVisible);
          stage.classList.toggle('hide-names',  !this._namesVisible);
          stage.classList.toggle('hide-pcs',    !this._pcsVisible);
          stage.classList.toggle('hide-npcs',   !this._npcsVisible);
        }
        const scroll = b.querySelector('#map-scroll');
        if (scroll){
          if (this._tokensVisible) scroll.style.removeProperty('--bm-hide-tokens');
          else scroll.style.setProperty('--bm-hide-tokens', '1');
        }
        this._refreshSettings();
        return;
      }
      if (k === 'load-init'){ this._syncParty(); return; }
    }));
    // Sliders
    const brushEl = b.querySelector('#bm-set-brush');
    if (brushEl){
      brushEl.addEventListener('input', e => {
        // Map 0-100% → 1-5 cells.
        const r = Math.max(1, Math.min(5, Math.round(1 + (parseInt(e.target.value)/100) * 4)));
        this._fogRadius = r;
        const out = b.querySelector('#bm-set-brush-val');
        if (out) out.textContent = e.target.value + '%';
      });
      brushEl.addEventListener('change', () => this._saveMap());
    }
    const hardEl = b.querySelector('#bm-set-hardness');
    if (hardEl){
      hardEl.addEventListener('input', e => {
        this._fogHardness = parseInt(e.target.value) || 0;
        const out = b.querySelector('#bm-set-hardness-val');
        if (out) out.textContent = this._fogHardness + '%';
        this._applyFogBlur();
      });
      hardEl.addEventListener('change', () => this._saveMap());
    }
    const csEl = b.querySelector('#bm-set-cellsize');
    if (csEl){
      csEl.addEventListener('input', e => {
        const out = b.querySelector('#bm-set-cellsize-val');
        if (out) out.textContent = e.target.value + 'px';
      });
      csEl.addEventListener('change', e => {
        const n = Math.max(8, Math.min(400, parseInt(e.target.value)||50));
        this._cellSize = n;
        if (_mapBgImage) this._fitGridToBg();
        this._saveMap(); this._render();
      });
    }
    // Scale. Stored in FEET whatever the unit box says — one canonical unit
    // downstream, so nothing that measures a distance has to ask which it is.
    const ftEl = b.querySelector('#bm-set-ftper'), unEl = b.querySelector('#bm-set-ftunit');
    if (ftEl && unEl){
      const commit = () => {
        const n = parseFloat(ftEl.value);
        if (!(n > 0)) { ftEl.value = this._ftPerCell || 5; return; }
        this._ftPerCell = unEl.value === 'mi' ? n * 5280 : n;
        this._saveMap(); this._render();
      };
      ftEl.addEventListener('change', commit);
      unEl.addEventListener('change', () => {
        // Switching the unit re-reads the SAME number in the new unit, which
        // is what someone means by picking "miles" next to a 5 — not a
        // conversion of 5 ft into 0.00095 miles.
        commit();
      });
    }
    const opEl = b.querySelector('#bm-set-opacity');
    if (opEl){
      opEl.addEventListener('input', e => {
        this._gridOpacity = parseInt(e.target.value) || 0;
        const out = b.querySelector('#bm-set-opacity-val');
        if (out) out.textContent = this._gridOpacity + '%';
        const grid = b.querySelector('#map-canvas');
        if (grid) this._drawGrid(grid, this._csScreen());
      });
      opEl.addEventListener('change', () => this._saveMap());
    }
    const gwEl = b.querySelector('#bm-set-gridwidth');
    if (gwEl){
      gwEl.addEventListener('input', e => {
        this._gridWidth = Math.max(1, Math.min(4, parseInt(e.target.value) || 1));
        const out = b.querySelector('#bm-set-gridwidth-val');
        if (out) out.textContent = this._gridWidth + 'px';
        const grid = b.querySelector('#map-canvas');
        if (grid) this._drawGrid(grid, this._csScreen());
      });
      gwEl.addEventListener('change', () => this._saveMap());
    }
    const gcEl = b.querySelector('#bm-set-gridcolor');
    if (gcEl){
      // Repaint live on drag (same as the sliders), persist on release. A
      // colour input fires `input` continuously while the picker is open, and
      // _saveMap on each would push a Firebase write per mouse-move.
      gcEl.addEventListener('input', e => {
        this._gridColor = e.target.value;
        const row = gcEl.closest('.bm-set-slider');
        const out = row && row.querySelector('.bm-set-slider-val');
        if (out) out.textContent = this._gridColor;
        const auto = b.querySelector('[data-bmset="grid-color-auto"]');
        if (auto) auto.classList.remove('active');
        const grid = b.querySelector('#map-canvas');
        if (grid) this._drawGrid(grid, this._csScreen());
      });
      gcEl.addEventListener('change', () => { this._saveMap(); this._broadcast(); });
    }
  },

  // Apply CSS blur to the fog canvas based on _fogHardness (0% = sharp,
  // 100% = soft feathered edges). Cheap visual effect; nothing else changes.
  _applyFogBlur(){
    const b = this._body; if (!b) return;
    const fogCanvas = b.querySelector('#fog-canvas');
    if (!fogCanvas) return;
    const px = (this._fogHardness / 100) * 12; // 0–12 px blur
    fogCanvas.style.filter = px > 0.1 ? 'blur(' + px.toFixed(1) + 'px)' : '';
  },

  // Map picker — adventures from data/adventures.json, maps extracted from
  // each adventure's JSON by walking for {type:'image', imageType:'map'|'mapPlayer'}.
  // Per-adventure JSON is fetched lazily on first selection and cached.
  async _openMapPicker(){
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="width:680px;max-width:92vw;max-height:90vh;display:flex;flex-direction:column">
      <h3 style="margin:0 0 10px">Choose a Map</h3>
      <div style="flex:1;overflow-y:auto;padding-right:4px">
        ${this._renderSavedMapsSection()}
        ${this._renderStarredMapsSection()}
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
          <input id="mapsel-search" type="search" autocomplete="off" placeholder="Search maps across every adventure…"
            style="flex:1;background:var(--panel-2);border:1px solid var(--border);color:var(--text);padding:7px 9px;border-radius:5px;font-size:var(--fs-md)">
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
          <input id="mapsel-adv-filter" type="search" autocomplete="off" placeholder="Filter adventures…"
            style="width:170px;background:var(--panel-2);border:1px solid var(--border);color:var(--text);padding:7px 9px;border-radius:5px;font-size:var(--fs-md)">
          <select id="mapsel-adv" disabled
            style="flex:1;background:var(--panel-2);border:1px solid var(--border);color:var(--text);padding:7px 9px;border-radius:5px;font-size:var(--fs-md)">
            <option value="">Loading adventures…</option>
          </select>
        </div>
        <div id="mapsel-grid" class="mapsel-grid"></div>
      </div>
      <div class="modal-actions" style="margin-top:10px">
        ${(this._bgMapPath || _mapBgImage || (this._tokens||[]).length) ? '<button class="btn" id="mapsel-save">'+ICO('i-save')+' Save current as…</button>' : ''}
        ${this._bgMapPath ? '<button class="btn danger" id="mapsel-clear">Clear current map</button>' : ''}
        <button class="btn" id="mapsel-upload-btn">📷 Upload image…</button>
        <input type="file" id="mapsel-upload-input" accept="image/*" style="display:none">
        <button class="btn" id="mapsel-close">Close</button>
      </div>
    </div>`;
    document.body.appendChild(backdrop);

    // Wire saved-maps load/delete clicks (rendered above the adventure section)
    backdrop.querySelectorAll('[data-savedmap-load]').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.savedmapLoad;
      const entry = this._savedMaps.find(s => s.id === id);
      if (!entry) return;
      this._restoreMapSnapshot(entry.snapshot);
      close();
      if (typeof showToast === 'function') showToast('Loaded "' + entry.name + '"');
    }));
    backdrop.querySelectorAll('[data-savedmap-del]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.savedmapDel;
      const entry = this._savedMaps.find(s => s.id === id);
      if (!entry) return;
      const doDelete = () => {
        this._savedMaps = this._savedMaps.filter(s => s.id !== id);
        this._saveSavedMaps();
        // Remove the row from the DOM in place. If the list is now empty,
        // also remove the section header so the picker doesn't show a stale
        // "Saved maps" with nothing under it.
        const row = btn.closest('.mapsel-saved-row');
        if (row) row.remove();
        if (!this._savedMaps.length){
          backdrop.querySelector('#mapsel-saved-host')?.remove();
        }
      };
      if (typeof showConfirm === 'function'){
        showConfirm('Delete saved map "' + entry.name + '"?', {title:'Delete map', confirmLabel:'Delete', danger:true}).then(ok => {
          if (ok) doDelete();
        });
      } else { doDelete(); }
    }));
    backdrop.querySelector('#mapsel-save')?.addEventListener('click', () => {
      const suggested = this._bgMapPath
        ? (this._bgMapPath.split('/').pop().replace(/\.[^.]+$/, '') + ((this._tokens||[]).length ? ' — saved' : ''))
        : (_mapBgImage ? 'Uploaded map' : 'Map ' + (this._savedMaps.length + 1));
      showModal('Save map', [
        { id:'name', label:'Map name', type:'text', value: suggested }
      ], 'Save').then(r => {
        if (!r) return;
        const name = (r.name || '').trim();
        if (!name){ if (typeof showToast==='function') showToast('Name required'); return; }
        const lc = name.toLowerCase();
        const clash = this._savedMaps.find(s => (s.name||'').toLowerCase() === lc);
        const commit = () => {
          // Replace any existing entry with the same case-insensitive name so
          // re-saving overwrites instead of cluttering the list.
          this._savedMaps = this._savedMaps.filter(s => (s.name||'').toLowerCase() !== lc);
          this._savedMaps.unshift({
            id: 'map_' + (typeof uid === 'function' ? uid() : Date.now().toString(36)),
            name,
            ts: Date.now(),
            snapshot: this._snapshotMap(),
          });
          // Cap library so quota doesn't creep over time. Saved-map snapshots
          // can be 20-50 KB each with lots of tokens/fog; 40 caps the list at
          // about 1-2 MB worst case. Say WHICH ones went: new entries unshift
          // to the front, so this drops the oldest saves, and doing it in
          // silence meant a full library quietly ate them.
          let dropped = [];
          if (this._savedMaps.length > 40){
            dropped = this._savedMaps.slice(40).map(s => s.name || 'untitled');
            this._savedMaps.length = 40;
          }
          this._saveSavedMaps();
          close();
          if (typeof showToast === 'function'){
            showToast('Saved "' + name + '"'
              + (dropped.length ? ` · library full, dropped oldest: ${dropped.join(', ')}` : ''));
          }
        };
        // Overwriting is as destructive as deleting, and the delete button
        // asks first — this didn't, so re-saving under a suggested name (which
        // is derived from the map file, and so collides by default on the same
        // map) silently replaced the earlier save with no way back.
        if (clash && typeof showConfirm === 'function'){
          showConfirm('A saved map named "' + clash.name + '" already exists. Overwrite it?',
            {title:'Overwrite saved map', confirmLabel:'Overwrite', danger:true})
            .then(ok => { if (ok) commit(); });
        } else {
          commit();
        }
      });
    });

    const searchInput = backdrop.querySelector('#mapsel-search');
    const sel = backdrop.querySelector('#mapsel-adv');
    const grid = backdrop.querySelector('#mapsel-grid');
    const close = ()=>backdrop.remove();
    backdrop.querySelector('#mapsel-close').addEventListener('click', close);

    // Upload a custom image as the battlemap background. Session-only —
    // the image lives in `_mapBgImage` and is intentionally never persisted
    // to localStorage (data URLs of 5–20 MB images would blow the quota).
    const uploadBtn = backdrop.querySelector('#mapsel-upload-btn');
    const uploadInput = backdrop.querySelector('#mapsel-upload-input');
    uploadBtn.addEventListener('click', ()=>uploadInput.click());
    uploadInput.addEventListener('change', e=>{
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > 20*1024*1024){ showToast('Image too large (max 20MB)'); e.target.value=''; return; }
      showToast('Loading image…');
      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          // Clear any stale stage background NOW so we don't see the old map
          // peek through while the new natural-size calculation runs. Without
          // this, replacing a 5etools map with an upload sometimes leaves the
          // old background painted because CSS backgroundImage was cached on
          // the existing stage element.
          const oldStage = this._body?.querySelector('#map-stage');
          if (oldStage){ oldStage.style.backgroundImage = 'none'; }
          _mapBgImage = img;
          this._bgMapNaturalW = img.naturalWidth;
          this._bgMapNaturalH = img.naturalHeight;
          // Uploaded images aren't 5etools paths — clear any prior path so
          // _saveMap() doesn't try to reload a stale one on next mount.
          this._bgMapPath = null;
          // Bake token rescale + clear stale drawings/fog BEFORE clobbering
          // scale fields. See _resetMapScene comment for the full rationale.
          this._resetMapScene();
          this._bgMapScale = 1;
          this._lastTokenScale = 1;
          this._gridOffsetX = 0;
          this._gridOffsetY = 0;
          this._saveMap();
          // Full re-render rebuilds the stage from scratch so the new image's
          // dimensions, the grid, and the bg URL are all consistent. Then a
          // fit-to-view call sizes it sensibly.
          this._render();
          this._fitMapToView();
          close();
          showToast('Map loaded — this session only');
        };
        img.onerror = () => showToast('Could not load image');
        img.src = ev.target.result;
      };
      reader.onerror = () => showToast('Could not read file');
      reader.readAsDataURL(file);
      e.target.value = '';
    });

    backdrop.querySelector('#mapsel-clear')?.addEventListener('click', ()=>{
      _mapBgImage = null;
      this._bgMapPath = null;
      this._saveMap();
      const stage = this._body?.querySelector('#map-stage');
      if (stage){ const cs=this._csScreen(); this._applyBg(stage, this._cols*cs, this._rows*cs); }
      this._render();
      close();
    });
    backdrop.addEventListener('mousedown', e=>{ if (e.target===backdrop) close(); });
    backdrop.addEventListener('keydown', e=>{ if (e.key==='Escape') close(); });

    // Load the adventure manifest once, sort, populate the <select>.
    if (!this._adventures){
      try {
        const res = await fetch('data/adventures.json');
        const j = await res.json();
        this._adventures = (j.adventure || []).slice().sort((a,b)=>a.name.localeCompare(b.name));
      } catch(e) {
        sel.innerHTML = '<option value="">Failed to load adventures</option>';
        return;
      }
    }
    // Render the <select> options. Helper takes an optional filter substring
    // so the side input can narrow the visible adventures without nuking the
    // current selection (we just hide non-matches via the hidden attribute).
    const renderAdvOptions = (filterStr) => {
      const q = String(filterStr||'').trim().toLowerCase();
      const visible = q
        ? this._adventures.filter(a =>
            (a.name||'').toLowerCase().includes(q) ||
            (a.id||'').toLowerCase().includes(q) ||
            (a.storyline||'').toLowerCase().includes(q))
        : this._adventures;
      const placeholder = q
        ? `<option value="">— ${visible.length} match${visible.length===1?'':'es'} —</option>`
        : '<option value="">— Pick an adventure —</option>';
      sel.innerHTML = placeholder
        + visible.map(a => `<option value="${esc(a.id)}">${esc(a.name)} (${esc(a.id)})</option>`).join('');
    };
    renderAdvOptions('');
    sel.disabled = false;

    // Filter input — repaints the options list on every keystroke. If the
    // narrowed list still contains the currently picked adventure, leave the
    // pick alone; otherwise reset to the placeholder so the user notices.
    const advFilter = backdrop.querySelector('#mapsel-adv-filter');
    if (advFilter){
      advFilter.addEventListener('input', e => {
        const prev = sel.value;
        renderAdvOptions(e.target.value);
        if (prev && Array.from(sel.options).some(o => o.value === prev)) sel.value = prev;
      });
      // Enter in the filter input auto-picks the first match (if any) — quick
      // keyboard-only flow.
      advFilter.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        const first = Array.from(sel.options).find(o => o.value);
        if (first){ sel.value = first.value; sel.dispatchEvent(new Event('change')); }
      });
    }

    searchInput.focus();

    // Resolve a select value (= adventure id) to the manifest entry.
    const resolveAdv = (typed) => {
      const id = (typed || '').trim();
      if (!id) return null;
      return this._adventures.find(a => a.id === id) || null;
    };

    // Walk an adventure JSON tree and collect every {type:'image', imageType:'map'|'mapPlayer'} entry.
    // Captures `id` (for parent linking) and `mapParent.id` so we can backfill
    // player-version titles from their DM counterparts — 5etools data sets the
    // player map's `title` to "Player Version" rather than the actual map name.
    const extractMaps = (node, out)=>{
      if (!node) return;
      if (Array.isArray(node)){ node.forEach(n => extractMaps(n, out)); return; }
      if (typeof node !== 'object') return;
      if (node.type === 'image' && (node.imageType === 'map' || node.imageType === 'mapPlayer') && node.href?.path){
        const path = node.href.path;
        const fallback = path.split('/').pop().replace(/\.[^.]+$/, '');
        out.push({
          path,
          title: node.title || fallback,
          type: node.imageType,
          id: node.id,
          parentId: node.mapParent?.id,
        });
      }
      for (const k in node) extractMaps(node[k], out);
    };

    // Backfill player-map titles from their parent DM map so search by name finds both.
    const linkPlayerTitles = (maps)=>{
      const byId = {};
      maps.forEach(m => { if (m.id) byId[m.id] = m; });
      maps.forEach(m => {
        if (m.type === 'mapPlayer' && m.parentId && byId[m.parentId]){
          const parentTitle = byId[m.parentId].title;
          if (parentTitle && m.title === 'Player Version') m.title = parentTitle;
          // Stash searchable parent title even if the player map already had a unique name.
          m.searchTitle = parentTitle;
        }
      });
      return maps;
    };

    // Fetch + extract maps for one adventure, cached.
    const loadOneAdvMaps = async (advId)=>{
      if (this._mapsByAdv[advId]) return this._mapsByAdv[advId];
      try {
        const res = await fetch('data/adventure/adventure-' + advId.toLowerCase() + '.json');
        const j = await res.json();
        const found = [];
        extractMaps(j, found);
        this._mapsByAdv[advId] = linkPlayerTitles(found);
      } catch(err){
        this._mapsByAdv[advId] = [];
      }
      return this._mapsByAdv[advId];
    };

    const renderCards = (cards, opts={})=>{
      if (!cards.length){
        grid.innerHTML = '<div style="grid-column:1/-1;padding:20px;text-align:center;color:var(--text-muted);font-size:var(--fs-md)">'+(opts.emptyMsg||'No maps.')+'</div>';
        return;
      }
      const starred = this._starredMaps || new Set();
      grid.innerHTML = cards.map(m=>{
        // Browse-sized thumbnail (tools/make-thumbs.py), falling back to the
        // full map if one wasn't generated. Cards render at ~180px; the full
        // maps average 498 KB and peak at 15.7 MB, so a 200-result search
        // used to pull ~100 MB just to draw the grid.
        const tokenSrc = assetThumbUrl(m.path);
        const fullSrc  = assetUrl(m.path);
        const subtitle = opts.showAdv && m.advName ? `<div class="mapsel-sub">${esc(m.advName)}</div>` : '';
        const isStarred = starred.has(m.path);
        return `<div class="mapsel-card${isStarred?' starred':''}" data-path="${esc(m.path)}" title="${esc(m.title)}${m.advName?' — '+esc(m.advName):''}">
          <button class="mapsel-star ${isStarred?'on':''}" data-mapsel-star="${esc(m.path)}" title="${isStarred?'Unstar':'Star (quick-access)'}">${isStarred?'★':'☆'}</button>
          <img crossorigin="anonymous" src="${esc(tokenSrc)}" data-fb="${esc(fullSrc)}" loading="lazy" decoding="async" alt="${esc(m.title)}" onerror="if(this.dataset.fb){this.src=this.dataset.fb;this.removeAttribute('data-fb');}else{this.style.opacity=.3;}">
          <div class="mapsel-title">${esc(m.title)}</div>
          ${subtitle}
          <span class="mapsel-badge ${esc(m.type)}">${m.type==='mapPlayer'?'Player':'DM'}</span>
        </div>`;
      }).join('');
      grid.querySelectorAll('.mapsel-card').forEach(card=>{
        card.addEventListener('click', e => {
          // Star toggle has its own click handler that stops propagation;
          // anything else on the card opens the map.
          if (e.target.closest('.mapsel-star')) return;
          const path = card.dataset.path;
          this._bgMapPath = path;
          // Bake token rescale + clear stale drawings/fog BEFORE clobbering
          // scale fields. See _resetMapScene comment for the full rationale.
          this._resetMapScene();
          this._bgMapScale = 1;
          this._lastTokenScale = 1;
          // Different maps have different printed grids — reset any previous
          // alignment so the new map starts at the canonical origin.
          this._gridOffsetX = 0;
          this._gridOffsetY = 0;
          this._saveMap();
          this._loadBgFromPath(path, /*autoFit=*/true);
          close();
          showToast('Map loaded');
        });
      });
      // Star toggles — works both for cards in the main grid AND for the
      // starred-strip render at the top of the modal (same data attribute).
      // Wires once at the modal root so re-renders pick up new buttons.
      grid.querySelectorAll('[data-mapsel-star]').forEach(btn => btn.addEventListener('click', e => {
        e.stopPropagation();
        const path = btn.dataset.mapselStar;
        const nowStarred = this._toggleStarredMap(path);
        // Update the local card's visual without a full re-render so the
        // user's scroll position / typed search stays put.
        btn.textContent = nowStarred ? '★' : '☆';
        btn.classList.toggle('on', nowStarred);
        btn.title = nowStarred ? 'Unstar' : 'Star (quick-access)';
        btn.closest('.mapsel-card')?.classList.toggle('starred', nowStarred);
        // Refresh the starred strip at the top so it reflects the new state
        // (added/removed). Re-rendering only that host keeps everything else
        // intact.
        const oldHost = backdrop.querySelector('#mapsel-starred-host');
        const newHtml = this._renderStarredMapsSection();
        if (oldHost && newHtml){
          // Replace in place.
          const wrap = document.createElement('div');
          wrap.innerHTML = newHtml;
          oldHost.replaceWith(wrap.firstElementChild);
          wireStarredStrip();
        } else if (oldHost && !newHtml){
          oldHost.remove();
        } else if (!oldHost && newHtml){
          // Insert before the search row (first sibling of the scroll wrapper)
          const scroller = backdrop.querySelector('.modal > div[style*="overflow-y"]');
          const savedHost = backdrop.querySelector('#mapsel-saved-host');
          const wrap = document.createElement('div');
          wrap.innerHTML = newHtml;
          const newHost = wrap.firstElementChild;
          if (savedHost) savedHost.after(newHost);
          else scroller?.prepend(newHost);
          wireStarredStrip();
        }
      }));
    };

    // Wire click handlers for the starred-maps strip cards (separate from
    // renderCards because the strip lives outside the main grid). Called
    // once after the initial modal render and again whenever the strip is
    // rebuilt in response to a star toggle.
    const wireStarredStrip = () => {
      backdrop.querySelectorAll('#mapsel-starred-host .mapsel-card').forEach(card => {
        card.addEventListener('click', e => {
          if (e.target.closest('.mapsel-star')) return;
          const path = card.dataset.path;
          this._bgMapPath = path;
          // Bake token rescale + clear stale drawings/fog BEFORE clobbering
          // scale fields. See _resetMapScene comment for the full rationale.
          this._resetMapScene();
          this._bgMapScale = 1;
          this._lastTokenScale = 1;
          this._gridOffsetX = 0;
          this._gridOffsetY = 0;
          this._saveMap();
          this._loadBgFromPath(path, /*autoFit=*/true);
          close();
          showToast('Map loaded');
        });
      });
      backdrop.querySelectorAll('#mapsel-starred-host [data-mapsel-star]').forEach(btn => btn.addEventListener('click', e => {
        e.stopPropagation();
        const path = btn.dataset.mapselStar;
        this._toggleStarredMap(path);
        // Always unstars (the strip only shows starred items), so the row
        // should vanish from the strip and re-sync the main grid card too.
        const oldHost = backdrop.querySelector('#mapsel-starred-host');
        const newHtml = this._renderStarredMapsSection();
        if (oldHost && newHtml){
          const wrap = document.createElement('div');
          wrap.innerHTML = newHtml;
          oldHost.replaceWith(wrap.firstElementChild);
          wireStarredStrip();
        } else if (oldHost){
          oldHost.remove();
        }
        // Sync the main-grid card visual if it's showing.
        const gridBtn = backdrop.querySelector(`#mapsel-grid [data-mapsel-star="${esc(path)}"]`);
        if (gridBtn){
          gridBtn.textContent = '☆';
          gridBtn.classList.remove('on');
          gridBtn.title = 'Star (quick-access)';
          gridBtn.closest('.mapsel-card')?.classList.remove('starred');
        }
      }));
    };
    // Initial wire for any starred-strip cards rendered with the modal.
    wireStarredStrip();

    // Eager fetch all adventures' maps for global search. Concurrency-limited
    // (8 in flight) so parsing 100+ large 5etools JSON files doesn't block the
    // UI thread or hammer the network. Cached on the panel so reopen is instant.
    let allMapsPromise = null;
    const ensureAllMaps = ()=>{
      if (this._allMaps) return Promise.resolve(this._allMaps);
      if (allMapsPromise) return allMapsPromise;
      const advs = this._adventures;
      const results = new Array(advs.length);
      const CONCURRENCY = 8;
      let cursor = 0;
      const worker = async () => {
        while (true){
          const i = cursor++;
          if (i >= advs.length) return;
          const a = advs[i];
          const list = await loadOneAdvMaps(a.id);
          results[i] = list.map(m => ({...m, advId: a.id, advName: a.name}));
        }
      };
      const workers = Array.from({length: Math.min(CONCURRENCY, advs.length)}, worker);
      allMapsPromise = Promise.all(workers).then(() => {
        this._allMaps = results.flat();
        return this._allMaps;
      });
      return allMapsPromise;
    };

    // Load + render maps for whatever adventure is currently typed/picked.
    // Always prefers an explicit adventure pick over a stale search query.
    const loadPickedAdventure = async () => {
      const adv = resolveAdv(sel.value.trim());
      if (!adv){ grid.innerHTML = ''; return; }
      // An explicit adventure pick should win over a leftover search query —
      // clear the search box so the user sees that adventure's maps directly.
      if (searchInput.value) searchInput.value = '';
      const advId = adv.id;
      if (!this._mapsByAdv[advId]){
        grid.innerHTML = '<div style="grid-column:1/-1;padding:20px;text-align:center;color:var(--text-muted);font-size:var(--fs-md)">Loading maps…</div>';
        await loadOneAdvMaps(advId);
      }
      renderCards(this._mapsByAdv[advId] || [], { emptyMsg: 'No maps in this adventure.' });
    };
    // Convenience wrapper used by the adventure-input listeners. Older code
    // routed through handlePick which had a search-priority bail; we want
    // explicit adventure picks to always work.
    const handlePick = loadPickedAdventure;

    const runSearch = async (q) => {
      const qn = (q||'').toLowerCase().trim();
      if (!qn){ handlePick(); return; }
      if (!this._allMaps){
        grid.innerHTML = '<div style="grid-column:1/-1;padding:20px;text-align:center;color:var(--text-muted);font-size:var(--fs-md)">Indexing every adventure for search…</div>';
        await ensureAllMaps();
        // Bail if the user has typed a different query while we were loading.
        if (searchInput.value.trim().toLowerCase() !== qn) return;
      }
      const matches = this._allMaps.filter(m =>
        m.title.toLowerCase().includes(qn) ||
        (m.searchTitle && m.searchTitle.toLowerCase().includes(qn)) ||
        (m.advName && m.advName.toLowerCase().includes(qn)) ||
        (m.advId && m.advId.toLowerCase().includes(qn))
      ).slice(0, 200);
      renderCards(matches, { showAdv: true, emptyMsg: 'No maps match "'+esc(q)+'".' });
    };
    searchInput.addEventListener('input', e => runSearch(e.target.value));
    // <select> reliably emits 'change' the moment the user picks an option.
    sel.addEventListener('change', handlePick);
  },

  _applyBg(stage,W,H){
    if (_mapBgImage){
      // Render the image at natural × scale — never stretch. The grid was
      // already grown to cover this size in _fitGridToBg. URL source is the
      // 5etools relative path when available; otherwise the in-memory data
      // URL (for custom uploads, which don't have a path).
      const scale = this._bgMapScale || 1;
      const dispW = (this._bgMapNaturalW || _mapBgImage.naturalWidth) * scale;
      const dispH = (this._bgMapNaturalH || _mapBgImage.naturalHeight) * scale;
      const url = this._bgMapPath ? assetUrl(this._bgMapPath) : _mapBgImage.src;
      stage.style.backgroundImage = `url("${url}")`;
      stage.style.backgroundSize = `${dispW}px ${dispH}px`;
      stage.style.backgroundRepeat = 'no-repeat';
      stage.style.backgroundPosition = '0 0';
      stage.style.backgroundColor = '';
    } else {
      stage.style.backgroundImage = 'none';
      stage.style.backgroundRepeat = '';
      stage.style.backgroundPosition = '';
      stage.style.backgroundColor = this._bgColor;
    }
  },

  _drawGrid(canvas,cs){
    const W=this._cols*cs, H=this._rows*cs;
    // Sizes the backing store (at k× for sharpness — see _sizeLayer) and
    // returns a context pre-scaled by k, so everything below stays in stage
    // coordinates exactly as it was.
    const ctx=this._sizeLayer(canvas,W,H);
    ctx.clearRect(0,0,W,H);

    const gt = this._gridType || (this._showGrid ? 'square' : 'none');

    // Grid hidden — still keep the canvas sized, paint the optional hover
    // highlight, then let fog draw on top.
    if (gt === 'none' || !this._showGrid){
      if (this._cellHighlight) this._drawCellHighlight(ctx, cs, gt);
      this._drawFog();
      return;
    }

    // Grid opacity (0–100 from the sidebar; shared — the DM's setting syncs
    // to the player view via broadcast/Firebase). Below 60% (the default)
    // this scales the adaptive base alpha exactly as it always did; above 60%
    // it ramps from that point up to FULLY opaque at 100%. The old mapping
    // capped at the base alpha (0.25–0.4) even with the slider maxed, so the
    // grid could never be made properly bold on busy map art.
    const op = (this._gridOpacity != null ? this._gridOpacity : 60) / 100;
    const alphaFor = base => op <= 0.6
      ? base * op
      : base * 0.6 + (1 - base * 0.6) * ((op - 0.6) / 0.4);

    // Determine if background is light or dark for adaptive grid color
    let gridColor='rgba(255,255,255,'+alphaFor(0.18).toFixed(3)+')';
    if (this._gridColor){
      // Explicit colour. Runs the SAME alphaFor curve as the adaptive branches
      // so the Opacity slider behaves identically either way — 0.3 base, i.e.
      // between the two adaptive bases, so switching to a custom colour doesn't
      // jump in weight. 100% still reaches fully opaque.
      const c = this._hexToRgb(this._gridColor);
      if (c) gridColor = 'rgba('+c.r+','+c.g+','+c.b+','+alphaFor(0.3).toFixed(3)+')';
    } else if(_mapBgImage){
      // Average brightness of the map art, cached per Image — see
      // _bgLuminance(). null means the sample wasn't available (tainted
      // canvas), in which case we keep the default light grid.
      const lum = _bgLuminance();
      if (lum != null){
        gridColor=lum>128?'rgba(0,0,0,'+alphaFor(0.35).toFixed(3)+')':'rgba(255,255,255,'+alphaFor(0.25).toFixed(3)+')';
      }
    } else {
      // Parse bgColor hex to check brightness
      const hex=this._bgColor.replace('#','');
      if(hex.length===6){
        const r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),bv=parseInt(hex.slice(4,6),16);
        const lum=(r*299+g*587+bv*114)/1000;
        gridColor=lum>128?'rgba(0,0,0,'+alphaFor(0.4).toFixed(3)+')':'rgba(255,255,255,'+alphaFor(0.18).toFixed(3)+')';
      }
    }

    ctx.strokeStyle=gridColor;

    // Pixel snapping has to happen in BACKING-STORE space, not stage space.
    //
    // _sizeLayer leaves a setTransform(k,0,0,k,0,0) on the context, so a stage
    // coordinate is multiplied by k before it rasterises. The old
    // `Math.round(x) + .5` snapped in stage space, which only lands on a
    // device half-pixel when k is exactly 1. At k = viewScale x dpr — routinely
    // fractional (1.25 on Windows display scaling, 2.75 zoomed in) — it broke
    // two ways at once:
    //   • consecutive lines landed on DIFFERENT subpixel offsets (.625, .125,
    //     .625, .875 …) so some drew crisp and others smeared over two pixels,
    //     which is the shimmer you see while zooming;
    //   • rounding to whole STAGE pixels quantised a fractional cell size
    //     (77 x 0.44 = 33.88) into gaps of 34,34,34,34,33 — an error the CSS
    //     scale then magnified to 2.75 device px at k=2.75, i.e. one line
    //     visibly out of place.
    //
    // Snapping in device space fixes both: every line lands on the backing
    // pixel grid at any k, and the residual spacing error is bounded at ONE
    // device pixel, which is the floor for a non-integer cell size.
    const k = this._canvasK(W, H);
    // Pick a whole number of backing pixels for the stroke, then express it
    // back in stage units so it survives the k transform exactly. The
    // half-pixel offset applies only to odd widths — an even-width stroke
    // straddles an integer boundary cleanly.
    const wDev = Math.max(1, Math.round(Math.max(1, Math.min(4, this._gridWidth || 1)) * k));
    const half = (wDev % 2) ? 0.5 : 0;
    const snap = v => (Math.round(v * k - half) + half) / k;
    ctx.lineWidth = wDev / k;
    // Offsets are stored in image-pixel space; convert to on-screen pixels.
    const scale = _mapBgImage ? (this._bgMapScale || 1) : 1;
    const offX = (((this._gridOffsetX || 0) * scale) % cs + cs) % cs;
    const offY = (((this._gridOffsetY || 0) * scale) % cs + cs) % cs;

    if (gt === 'hex'){
      this._drawHexGrid(ctx, cs, W, H, offX, offY);
    } else {
      for (let x = offX; x <= W + .01; x += cs){
        const sx = snap(x);
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
      }
      for (let y = offY; y <= H + .01; y += cs){
        const sy = snap(y);
        ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
      }
    }

    // Cell-highlight overlay (above grid lines, below fog).
    if (this._cellHighlight) this._drawCellHighlight(ctx, cs, gt);

    // Draw fog on top of grid
    this._drawFog();
  },

  // Flat-top hex tiling. `cs` is the cell size (also the hex's corner-to-corner
  // width). Columns are spaced by 3/4·cs horizontally; even columns are offset
  // by half a hex height vertically. Honors gridOffsetX/Y the same way the
  // square grid does so the two-click align tool keeps working on hex maps.
  _drawHexGrid(ctx, cs, W, H, offX, offY){
    const s = cs / 2;                   // corner radius
    const h = s * Math.sqrt(3);          // flat-to-flat height
    const colStep = s * 1.5;             // horizontal spacing between columns
    // Build the six corner deltas once.
    const corners = [];
    for (let i=0;i<6;i++){
      const a = i * Math.PI/3;           // 0, 60, 120, …
      corners.push([Math.cos(a)*s, Math.sin(a)*s]);
    }
    // Start one column / one row off-canvas so partial hexes on the edges
    // still draw. The offset wrap keeps the pattern aligned with the square
    // grid the alignment tool produced.
    const startCol = Math.floor(-offX / colStep) - 1;
    const endCol   = Math.ceil((W - offX) / colStep) + 1;
    for (let c = startCol; c <= endCol; c++){
      const cx = offX + c * colStep;
      const yShift = (c & 1) ? h/2 : 0;  // odd columns offset
      const startRow = Math.floor((-offY - yShift) / h) - 1;
      const endRow   = Math.ceil((H - offY - yShift) / h) + 1;
      for (let r = startRow; r <= endRow; r++){
        const cy = offY + yShift + r * h + h/2;
        ctx.beginPath();
        ctx.moveTo(cx + corners[0][0], cy + corners[0][1]);
        for (let i=1;i<6;i++) ctx.lineTo(cx + corners[i][0], cy + corners[i][1]);
        ctx.closePath();
        ctx.stroke();
      }
    }
  },

  // Paint a translucent fill on the cell currently under the cursor. Works
  // for square and hex; no-op when no hover or when the cursor is outside
  // the stage.
  _drawCellHighlight(ctx, cs, gt){
    const hc = this._hoverCell;
    if (!hc) return;
    ctx.save();
    ctx.fillStyle = 'rgba(212,165,116,0.22)';      // soft accent tint
    ctx.strokeStyle = 'rgba(212,165,116,0.85)';
    ctx.lineWidth = 2;
    const scale = _mapBgImage ? (this._bgMapScale || 1) : 1;
    const offX = (((this._gridOffsetX || 0) * scale) % cs + cs) % cs;
    const offY = (((this._gridOffsetY || 0) * scale) % cs + cs) % cs;
    if (gt === 'hex'){
      const s = cs / 2;
      const h = s * Math.sqrt(3);
      const colStep = s * 1.5;
      const cx = offX + hc.q * colStep;
      const cy = offY + ((hc.q & 1) ? h/2 : 0) + hc.r * h + h/2;
      ctx.beginPath();
      for (let i=0;i<6;i++){
        const a = i * Math.PI/3;
        const x = cx + Math.cos(a)*s, y = cy + Math.sin(a)*s;
        if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.closePath();
    } else {
      // square (or grid-less — still uses the cellSize box).
      const x = offX + hc.col * cs, y = offY + hc.row * cs;
      ctx.beginPath();
      ctx.rect(x, y, cs, cs);
    }
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  },

  // Convert stage-pixel coordinates to the hovered cell. Returns null when
  // outside the cols×rows envelope. Square → {col,row}; hex → {q,r}.
  _cellAtPx(px, py){
    const cs = this._csScreen();
    const gt = this._gridType || 'square';
    const scale = _mapBgImage ? (this._bgMapScale || 1) : 1;
    const offX = (((this._gridOffsetX || 0) * scale) % cs + cs) % cs;
    const offY = (((this._gridOffsetY || 0) * scale) % cs + cs) % cs;
    if (gt === 'hex'){
      const s = cs / 2, h = s * Math.sqrt(3), colStep = s * 1.5;
      // Coarse column candidate, then check neighbors to find the hex whose
      // center is closest (axis-aligned distance is fine for flat-top tiling).
      const x = px - offX, y = py - offY;
      const approxQ = Math.round(x / colStep);
      let best = null, bestD = Infinity;
      for (let dq = -1; dq <= 1; dq++){
        const q = approxQ + dq;
        const yShift = (q & 1) ? h/2 : 0;
        const approxR = Math.round((y - yShift - h/2) / h);
        for (let dr = -1; dr <= 1; dr++){
          const r = approxR + dr;
          const cx = q * colStep;
          const cy = yShift + r * h + h/2;
          const d = (cx-x)*(cx-x) + (cy-y)*(cy-y);
          if (d < bestD){ bestD = d; best = {q, r}; }
        }
      }
      return best;
    }
    const col = Math.floor((px - offX) / cs);
    const row = Math.floor((py - offY) / cs);
    if (col < 0 || row < 0 || col >= this._cols || row >= this._rows) return null;
    return {col, row};
  },

  // Coalesce canvas repaints into one per animation frame. Fog painting and
  // cell-hover both fire on mousemove (up to ~120/s on a high-rate mouse) and
  // each used to trigger a synchronous full redraw — clearing and refilling
  // the whole stage, then re-walking every revealed cell and every stroke.
  // Batching means at most one redraw per displayed frame, which is all the
  // screen can show anyway. Network broadcast is throttled separately
  // (_broadcastThrottled, ~80ms) — this is purely about paint cost.
  _invalidate(what){
    this._dirty = Object.assign(this._dirty || {}, what || {});
    if (this._rafPending) return;
    const run = () => {
      this._rafPending = null;
      const d = this._dirty || {}; this._dirty = {};
      if (!this._body) return;
      if (d.grid){
        const c = this._body.querySelector('#map-canvas');
        // _drawGrid finishes by calling _drawFog itself, so a pending fog
        // repaint is already covered by this path.
        if (c){ this._drawGrid(c, this._csScreen()); d.fog = false; }
      }
      if (d.fog)     this._drawFog();
      if (d.strokes) this._drawAllStrokes();
      if (d.tokens)  this._renderTokens();
    };
    this._rafPending = (typeof requestAnimationFrame === 'function')
      ? requestAnimationFrame(run)
      : setTimeout(run, 16);
  },

  // Is this stage point under fog right now? Mirrors exactly how _drawFog
  // composites: everything starts fogged, cells in _fog are revealed, then
  // free-brush strokes apply in the order they were painted, last one wins.
  //
  // _renderTokens used to answer this itself with `_fog.has(floor(x/cs))`,
  // which was wrong twice over. It ignored _fogStrokes, so a DM using the free
  // brush revealed the room to the players but every monster standing in it
  // stayed invisible — and, in the other direction, a free-brush HIDE over a
  // cell-revealed square left the token showing. It also dropped the Align
  // offset that fogPaint applies when building the cell key, so on any map
  // whose grid has been aligned the lookup was a cell off.
  _isFogged(px, py){
    if (!this._fog) return false;               // fog disabled entirely
    const cs = this._csScreen();
    const sc = _mapBgImage ? (this._bgMapScale || 1) : 1;
    const offX = (((this._gridOffsetX || 0) * sc) % cs + cs) % cs;
    const offY = (((this._gridOffsetY || 0) * sc) % cs + cs) % cs;
    const gx = Math.floor((px - offX) / cs), gy = Math.floor((py - offY) / cs);
    let fogged = !this._fog.has(gx + ',' + gy);
    for (const s of (this._fogStrokes || [])){
      const x = s.xc * cs, y = s.yc * cs, r = s.r * cs;
      const inside = s.shape === 'circle'
        ? ((px - x) * (px - x) + (py - y) * (py - y)) <= r * r
        : (Math.abs(px - x) <= r && Math.abs(py - y) <= r);
      if (inside) fogged = (s.op === 'hide');
    }
    return fogged;
  },

  _drawFog(forceResize){
    const b=this._body;if(!b)return;
    // Use a dedicated fog canvas layered above the grid canvas
    const stage=b.querySelector('#map-stage');if(!stage)return;
    let fogCanvas=stage.querySelector('#fog-canvas');
    // Fog canvas matches the on-screen stage so cells overlay the visible grid.
    const cs=this._csScreen();
    const W=this._cols*cs, H=this._rows*cs;
    if(!fogCanvas){
      fogCanvas=document.createElement('canvas');
      fogCanvas.id='fog-canvas';
      fogCanvas.style.cssText='position:absolute;top:0;left:0;z-index:10;pointer-events:none';
      stage.appendChild(fogCanvas);
    }
    // _sizeLayer only reallocates when the backing dimensions actually change,
    // which matters because this runs on every fog-paint mousemove — assigning
    // width/height reallocates even when the value is identical. `forceResize`
    // is passed only by the requality pass, where k itself changed.
    const ctx=this._sizeLayer(fogCanvas,W,H,forceResize);
    ctx.clearRect(0,0,W,H);
    if(this._fog===null)return; // fog disabled
    // DM view: translucent so the DM can still see the map through the fog.
    // Player view: fully opaque — players shouldn't see anything in unrevealed
    // cells. Detected via the body class set by initPlayerView().
    const isPlayer = document.body.classList.contains('player-mode');
    const alpha = isPlayer ? 1 : 0.55;

    // Fog coverage is built as an OPAQUE mask on a scratch layer and stamped
    // once at the display opacity. Painting straight onto the visible canvas
    // at 0.55 had two failures, both measured:
    //
    //  1. Reveals and hides were drawn in two passes grouped BY OPERATION —
    //     every reveal, then every hide — which threw away the order they
    //     were painted in. "Reveal, hide, re-reveal" over one spot rendered
    //     the re-reveal first and the hide last, so the spot stayed fogged
    //     and the reveal brush looked broken. Chronological order is the only
    //     thing that makes a two-way brush behave.
    //  2. Overlapping hide strokes compounded: 0.55 over 0.55 is 0.80, then
    //     0.91. Brushing back and forth turned the DM's see-through fog
    //     effectively opaque, though the code comment said it was repainting
    //     "at the same opacity as the base layer".
    //
    // Working in binary coverage fixes both: order is preserved, and fog is
    // exactly one opacity everywhere it exists.
    //
    // The scratch canvas is cached and resized on the same terms as
    // _sizeLayer, because this runs on every fog-paint mousemove and
    // allocating a full-size canvas per frame is exactly what that guards
    // against.
    let mask = this._fogMask;
    if (!mask){ mask = this._fogMask = document.createElement('canvas'); }
    if (mask.width !== fogCanvas.width || mask.height !== fogCanvas.height){
      mask.width = fogCanvas.width; mask.height = fogCanvas.height;
    }
    const mctx = mask.getContext('2d');
    // Match the k-scale/offset transform _sizeLayer applied, so everything
    // below stays in stage coordinates.
    const t = ctx.getTransform();
    mctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
    // Reset the composite op FIRST. The mask context is cached across repaints
    // and the loops below leave it on 'destination-out', so without this the
    // next repaint's base fill runs as an erase and the whole map comes back
    // unfogged except wherever a hide stroke happened to paint. A single call
    // looks perfect — it only shows up from the second repaint onward.
    mctx.globalCompositeOperation = 'source-over';
    mctx.clearRect(0, 0, W, H);
    mctx.fillStyle = '#000';
    mctx.fillRect(0, 0, W, H);

    // Cut out revealed cells fully
    mctx.globalCompositeOperation='destination-out';
    // Offset cells to match the drawn grid (Align-tool offset) — same formula
    // as _drawGrid + fogPaint, so painted cells render on the squares.
    const _fScale = _mapBgImage ? (this._bgMapScale || 1) : 1;
    const _offX = (((this._gridOffsetX || 0) * _fScale) % cs + cs) % cs;
    const _offY = (((this._gridOffsetY || 0) * _fScale) % cs + cs) % cs;
    this._fog.forEach(key=>{
      const [gx,gy]=key.split(',').map(Number);
      mctx.fillRect(_offX + gx*cs, _offY + gy*cs, cs, cs);
    });
    // Free-mode strokes, in the order they were painted. Coords are cell
    // fractions, scaled to the current cs so they survive zoom.
    const strokes = this._fogStrokes || [];
    const stamp = (s) => {
      const x = s.xc * cs, y = s.yc * cs, rad = s.r * cs;
      if (s.shape === 'circle'){
        mctx.beginPath(); mctx.arc(x, y, rad, 0, Math.PI*2); mctx.fill();
      } else {
        mctx.fillRect(x - rad, y - rad, rad*2, rad*2);
      }
    };
    strokes.forEach(s => {
      mctx.globalCompositeOperation = (s.op === 'hide') ? 'source-over' : 'destination-out';
      stamp(s);
    });

    // Stamp the finished mask once, at identity, so the already-baked
    // transform isn't applied a second time.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(mask, 0, 0);
    ctx.restore();
    // Apply per-user hardness (0% = sharp cells, 100% = blurred fog edges).
    this._applyFogBlur();
  },

  // Right-side Settings drawer. Renders only when this._settingsOpen.
  // Wires up in _wire alongside the toolbar buttons.
  _renderSettingsSidebar(){
    const mapName = this._bgMapPath ? this._bgMapPath.split('/').pop().replace(/\.(webp|jpg|jpeg|png)$/i, '') : 'No map';
    const fogOn = this._fog !== null;
    const paint = this._fogPaintMode;
    // Brush size slider in screenshot is 0–100; map to internal 1–5 cells.
    const brushPct = Math.round(((this._fogRadius||1) - 1) / 4 * 100);
    const tile = (key, label, sub, on, extra) => {
      const cls = 'bm-set-tile' + (on?' active':'') + (extra && extra.disabled ? ' disabled' : '');
      const dis = extra && extra.disabled ? ' disabled' : '';
      const title = extra && extra.title ? ' title="' + esc(extra.title) + '"' : '';
      return '<button class="' + cls + '" data-bmset="' + key + '"' + dis + title + '>'
        + '<span class="bm-set-tile-label">' + esc(label) + '</span>'
        + (sub ? '<span class="bm-set-tile-sub">' + esc(sub) + '</span>' : '')
        + '</button>';
    };
    const slider = (key, label, value, suffix, min, max) => {
      min = min!=null?min:0; max = max!=null?max:100;
      return '<div class="bm-set-slider">'
        + '<div class="bm-set-slider-row"><span>' + esc(label) + '</span>'
        + '<span class="bm-set-slider-val" id="bm-set-' + key + '-val">' + esc(value+suffix) + '</span></div>'
        + '<input type="range" id="bm-set-' + key + '" min="' + min + '" max="' + max + '" value="' + value + '">'
        + '</div>';
    };
    return ''
      + '<aside class="bm-settings">'
      + '<div class="bm-set-head"><span>Settings</span><button class="btn icon-btn" data-bmset="close" title="Close">×</button></div>'

      + '<div class="bm-set-section-head">MAP</div>'
      + '<div class="bm-set-tiles">'
      +   tile('pick-map',    'Battlemap',  mapName,          !!this._bgMapPath, {})
      +   tile('fog-toggle',  'Fog of War', fogOn?'On':'Off', fogOn,             {})
      +   tile('rotate',      'Rotate',     (this._mapRotation||0)+'°', !!this._mapRotation, {})
      + '</div>'

      + '<div class="bm-set-section-head">FOG OF WAR</div>'
      + '<div class="bm-set-tiles four">'
      +   tile('fog-reveal',  'Reveal', '', fogOn && paint==='reveal', {disabled:!fogOn,title:fogOn?'':'Enable Fog of War first'})
      +   tile('fog-hide',    'Hide',   '', fogOn && paint==='hide',   {disabled:!fogOn,title:fogOn?'':'Enable Fog of War first'})
      +   tile('fog-clear',   'Clear',  '', false,                    {disabled:!fogOn,title:fogOn?'':'Enable Fog of War first'})
      +   tile('fog-fill',    'Fill',   '', false,                    {disabled:!fogOn,title:fogOn?'':'Enable Fog of War first'})
      + '</div>'

      + '<div class="bm-set-section-head">BRUSH MODE</div>'
      + '<div class="bm-set-tiles two">'
      +   tile('fog-mode-grid', 'Grid', 'Snap to cells', this._fogBrushMode==='grid', {disabled:!fogOn,title:fogOn?'':'Enable Fog of War first'})
      +   tile('fog-mode-free', 'Free', 'Pixel-level',   this._fogBrushMode==='free', {disabled:!fogOn,title:fogOn?'':'Enable Fog of War first'})
      + '</div>'

      + '<div class="bm-set-section-head">BRUSH SHAPE</div>'
      + '<div class="bm-set-tiles two">'
      +   tile('fog-shape-square', 'Square', '', this._fogBrushShape==='square', {disabled:!fogOn,title:fogOn?'':'Enable Fog of War first'})
      +   tile('fog-shape-circle', 'Circle', '', this._fogBrushShape==='circle', {disabled:!fogOn,title:fogOn?'':'Enable Fog of War first'})
      + '</div>'

      + '<div class="bm-set-section-head">FOG SLIDERS</div>'
      + slider('brush',    'Brush Size', brushPct,          '%', 0, 100)
      + slider('hardness', 'Hardness',   this._fogHardness, '%', 0, 100)

      + '<div class="bm-set-section-head">GRID</div>'
      + '<div class="bm-set-tiles four">'
      +   tile('grid-square', 'Square', '', this._gridType === 'square', {})
      +   tile('grid-hex',    'Hex',    '', this._gridType === 'hex',    {})
      +   tile('grid-none',   'None',   '', this._gridType === 'none',   {})
      +   tile('grid-cell',   'Cell',   '', !!this._cellHighlight, {title:'Hover highlight'})
      + '</div>'
      + slider('cellsize', 'Cell Size', this._cellSize,   'px', 16, 200)
      // Scale is a PROPERTY OF THE MAP, not something to infer from how many
      // pixels a cell happens to be. A dungeon square is 5 ft, a city block
      // map might be 20, and an overland hex is miles — nothing about the
      // pixel size distinguishes them.
      + '<div class="bm-set-slider">'
      +   '<div class="bm-set-slider-row"><span>Scale</span>'
      +   '<span class="bm-set-slider-val">per ' + (this._gridType === 'hex' ? 'hex' : 'square') + '</span></div>'
      +   '<div class="bm-set-scale">'
      +     '<input type="number" id="bm-set-ftper" min="0" step="any" value="' + (this._ftPerCell || 5) + '" aria-label="Distance per cell">'
      +     '<select id="bm-set-ftunit" aria-label="Unit">'
      +       '<option value="ft"' + ((this._ftPerCell||5) < 5280 ? ' selected' : '') + '>ft</option>'
      +       '<option value="mi">miles</option>'
      +     '</select>'
      +   '</div>'
      + '</div>'
      + slider('opacity',  'Opacity',   this._gridOpacity, '%', 0, 100)
      + slider('gridwidth','Line Width', this._gridWidth || 1, 'px', 1, 4)
      // Colour. Auto samples the map art for contrast; the swatch overrides it.
      // Auto is shown as a pressed state rather than a separate "reset" button
      // so it reads as the two-way choice it is.
      + '<div class="bm-set-slider">'
      +   '<div class="bm-set-slider-row"><span>Line Colour</span>'
      +     '<span class="bm-set-slider-val">' + (this._gridColor ? esc(this._gridColor) : 'Auto') + '</span></div>'
      +   '<div style="display:flex;gap:6px;align-items:center">'
      +     '<input type="color" id="bm-set-gridcolor" value="' + esc(this._gridColor || this._autoGridHex()) + '"'
      +       ' style="flex:1;height:26px;padding:1px;border:1px solid var(--border);border-radius:4px;background:var(--panel-2);cursor:pointer"'
      +       ' title="Pick a grid line colour">'
      +     '<button class="bm-set-tile' + (this._gridColor ? '' : ' active') + '" data-bmset="grid-color-auto"'
      +       ' style="flex:0 0 auto;padding:4px 10px" title="Match the map automatically">'
      +       '<span class="bm-set-tile-label">Auto</span></button>'
      +   '</div>'
      + '</div>'

      + '<div class="bm-set-section-head">TOKENS</div>'
      + '<div class="bm-set-tiles four">'
      +   tile('tok-all',   'Tokens', '', this._tokensVisible, {})
      +   tile('tok-names', 'Names',  '', this._namesVisible,  {})
      +   tile('tok-pcs',   'PCs',    '', this._pcsVisible,    {})
      +   tile('tok-npcs',  'NPCs',   '', this._npcsVisible,   {})
      + '</div>'

      + '<button class="btn primary bm-set-load-init" data-bmset="load-init">Load Initiative</button>'
      + '</aside>';
  },

  _renderTokens(){
    const b=this._body;if(!b)return;
    const stage=b.querySelector('#map-stage');if(!stage)return;
    // For fog-cell mapping and default placement we want the on-screen cell
    // size (tokens are stored in stage-pixel coords). Visual diameter still
    // uses the natural cellSize × scale via tokScale below.
    const cs=this._csScreen();
    // Sweep ALL token layers including the rotated facing-arrow overlays.
    // Facing divs (.map-token-facing) are appended per rotated token below;
    // if they aren't cleared here they accumulate every _renderTokens() call
    // (fog paint, drag, zoom all re-render) and pile up as z-fighting clones.
    stage.querySelectorAll('.map-token, .map-token-name, .map-token-facing').forEach(el=>el.remove());

    const tokScale = this._bgMapScale || 1;
    // Player view: hide non-PC tokens that sit in unrevealed cells. The DM
    // sees everything regardless. Fog set is keyed by "gx,gy" — derive cell
    // from the token's pixel center.
    const isPlayer = document.body.classList.contains('player-mode');
    // Batch all token/name/facing nodes into one fragment so the browser does
    // a single layout pass instead of one per appendChild (3 nodes × N tokens).
    const frag = document.createDocumentFragment();
    this._tokens.forEach(t=>{
      const size=t.size||1;
      // Tokens store pixel coordinates (center). Default to middle of stage
      // for any token that's somehow missing them (shouldn't happen post-migration).
      if (t.x == null) t.x = cs * size / 2;
      if (t.y == null) t.y = cs * size / 2;
      // Still fogged where this token stands → hide it from players. See
      // _isFogged: it accounts for free-brush strokes and the Align offset,
      // which the inline cell lookup here did not.
      if (isPlayer && !t.isPC && this._isFogged(t.x, t.y)) return;
      const px=t.x;
      const py=t.y;
      // Visual diameter scales with the bg image so tokens stay proportional
      // to the map at any zoom level.
      const dim=(size*this._tokenUnit()-4) * tokScale;

      const el=document.createElement('div');
      const hasIcon = !!(t.icon || t.portrait);
      // PCs only show their first name on the map ("Zindle" instead of the
      // full "Zindle \"Deathwhistle\" Farrago"). NPCs keep their full label.
      const displayLabel = this._tokenDisplayLabel(t);
      el.className=`map-token ${t.isPC?'pc':'npc-t'} ${t.dead?'dead':''} ${this._selected===t.id?'selected':''}${hasIcon?' has-icon':''}`;
      el.dataset.tid=t.id;
      // Two font-size regimes:
      //  - When the token shows a single-character/emoji icon (🎵 ⚔ 🐲),
      //    we want it to FILL the circle — scale font-size to roughly 60%
      //    of the token's actual pixel diameter so the glyph is unmistakable
      //    at every zoom level. The previous 11px-text-in-a-50px-circle made
      //    emojis read as tiny specks.
      //  - When the token has only initials text (no icon set), keep the
      //    smaller readable size so two letters fit side-by-side.
      const iconSource = t.portrait || t.icon;
      const isImgIcon = typeof iconSource === 'string' && (iconSource.startsWith('data:image/') || iconSource.startsWith('img/') || /^https?:\/\//.test(iconSource));
      const isSvgIcon = typeof iconSource === 'string' && iconSource.startsWith('<svg');
      const isGlyphIcon = hasIcon && !isImgIcon && !isSvgIcon;
      let fontSize;
      if (isGlyphIcon){
        // ~60% of dim — leaves a small ring of the token color around the glyph.
        // Floor at 14px so the glyph stays readable when the map is zoomed far
        // out. The floor is in SCREEN px by intent, but everything here is in
        // stage px and the view transform scales it, so divide the floor by
        // _viewScale to keep its real-world meaning. (_counterScaleLabels
        // reapplies the same expression when only the zoom changes.)
        fontSize = Math.max(14 / (this._viewScale || 1), dim * 0.6);
      } else {
        fontSize = (size > 1 ? 13 : Math.max(8, 11 - (displayLabel.length > 5 ? 2 : 0))) * tokScale;
      }
      // overflow:visible, and it has to be set HERE rather than in the
      // stylesheet — this inline cssText overrides .map-token entirely, which
      // is why setting it in CSS looked right and computed to hidden.
      // Visible is what lets .map-token::after extend past the circle to give
      // touch a 32px tap target without drawing the token any bigger. Nothing
      // is actually clipped by it: portraits carry their own border-radius,
      // icon SVGs sit at 90%, and the name label is a sibling.
      el.style.cssText=`left:${px}px;top:${py}px;width:${dim}px;height:${dim}px;background:${t.color};font-size:${fontSize.toFixed(1)}px;position:absolute;transform:translate(-50%,-50%);z-index:2;border-radius:50%;border:2px solid rgba(212,165,116,0.8);display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;font-weight:600;color:#fff;text-align:center;line-height:1.1;overflow:visible;box-sizing:border-box`;
      if (hasIcon){
        el.innerHTML = (typeof renderIcon === 'function')
          ? renderIcon(iconSource, displayLabel)
          : esc(displayLabel.slice(0,2));
      } else {
        el.textContent = displayLabel.length>7?displayLabel.slice(0,6)+'…':displayLabel;
      }
      // Facing indicator — only rendered when t.rotation is set and non-zero
      // so unrotated tokens don't grow a permanent "pointing north" arrow.
      // 0° = north, increases clockwise. Drawn as a sibling so the token's
      // overflow:hidden doesn't clip it and the portrait inside stays
      // upright while the indicator rotates.
      if (t.rotation){
        const facing = document.createElement('div');
        facing.className = 'map-token-facing' + (t.isPC ? ' pc' : ' npc-t');
        facing.dataset.tid = t.id;
        facing.style.cssText = `left:${px}px;top:${py}px;width:${dim}px;height:${dim}px;position:absolute;transform:translate(-50%,-50%) rotate(${t.rotation}deg);pointer-events:none;z-index:2`;
        frag.appendChild(facing);
      }
      // Name label rendered as a sibling so it sits BELOW the token circle
      // (the circle has overflow:hidden which would clip an inner label).
      const nameEl = document.createElement('div');
      nameEl.className = 'map-token-name' + (t.isPC ? ' pc' : ' npc-t');
      nameEl.dataset.tid = t.id;
      // Floor the label font size at 11px so it stays legible when the map
      // is zoomed out. Soft pill background gives constant contrast against
      // light or dark map art (the previous text-shadow alone wasn't enough
      // on busy backgrounds).
      // Floor divided by _viewScale for the same reason as the glyph floor
      // above — it must stay 11 SCREEN px, not 11 stage px.
      const nameFs = Math.max(11 / (this._viewScale || 1), 10 * tokScale);
      nameEl.style.cssText = `left:${px}px;top:${py + dim/2 + 4}px;font-size:${nameFs.toFixed(1)}px;position:absolute;transform:translateX(-50%);z-index:2;pointer-events:none;color:#fff;background:rgba(0,0,0,.6);padding:1px 6px;border-radius:8px;text-shadow:0 1px 2px rgba(0,0,0,0.9);white-space:nowrap;font-weight:600;line-height:1.25`;
      nameEl.textContent = displayLabel;
      frag.appendChild(nameEl);

      // Right-click on a token opens the options panel (drag/select are left-click only).
      el.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        stage.querySelectorAll('.map-token').forEach(tok=>tok.classList.remove('selected'));
        el.classList.add('selected');
        this._selected = t.id;
        this._showPanel(t);
      });

      el.addEventListener('mousedown',e=>{
        // Right-click is handled by the contextmenu listener above. Don't
        // start a drag, but stop propagation so the map's pan handler doesn't
        // grab right-click here.
        if (e.button === 2){ e.stopPropagation(); return; }
        // Only left-click drives drag/select.
        if (e.button !== 0) return;
        e.stopPropagation();e.preventDefault();

        if(this._tool==='erase'){
          const i=this._tokens.findIndex(x=>x.id===t.id);
          if(i>=0){
            const wasPC = !!this._tokens[i].isPC;
            this._tokens.splice(i,1);
            this._selected=null;
            this._closePanel();
            this._saveMap();
            // PCs come back to the party-quick-bar on removal → full render.
            if (wasPC) this._render(); else this._renderTokens();
          }
          return;
        }

        // Highlight + select immediately (no panel — that's right-click only).
        stage.querySelectorAll('.map-token').forEach(tok=>tok.classList.remove('selected'));
        el.classList.add('selected');
        this._selected=t.id;

        const startX=e.clientX, startY=e.clientY;
        let curPx=t.x, curPy=t.y;
        let moved=false;
        // Drag anchor lives on this._drag (not in the closure) so a remote
        // world-scale change can rescale it in lockstep with t.x/t.y. A
        // pure-closure copy would go stale and teleport the token on the next
        // mousemove. (Local zoom no longer rescales anything — see
        // _applyViewScale — but a saved-map restore mid-drag still can.)
        this._drag = { moved:false, startPx:t.x, startPy:t.y };

        const onMove=ev=>{
          // Token positions are stored in stage-pixel coords, but the cursor
          // delta comes back in screen pixels. TWO CSS scales sit in between:
          // the workspace canvas and this device's map zoom. _screenScale()
          // is their product. Divide the delta by it, then un-rotate into
          // stage space (_stageDelta) so drags track the cursor on rotated maps.
          const z = this._screenScale();
          const _sd = this._stageDelta((ev.clientX-startX)/z, (ev.clientY-startY)/z);
          const dx=_sd.x, dy=_sd.y;
          if(!moved&&Math.abs(dx)<4&&Math.abs(dy)<4) return;
          moved=true;this._drag.moved=true;
          el.style.cursor='grabbing';
          curPx = this._drag.startPx + dx;
          curPy = this._drag.startPy + dy;
          el.style.left=curPx+'px';
          el.style.top=curPy+'px';
        };

        const onUp=ev=>{
          document.removeEventListener('mousemove',onMove);
          document.removeEventListener('mouseup',onUp);
          if(moved){
            let nx = curPx, ny = curPy;
            const wantSnap = ev && ev.shiftKey ? !this._snapToGrid : this._snapToGrid;
            if (wantSnap){
              nx = Math.round(nx/cs - size/2) * cs + size*cs/2;
              ny = Math.round(ny/cs - size/2) * cs + size*cs/2;
            }
            const stageW = this._cols * cs, stageH = this._rows * cs;
            // `cs` (from _csScreen) already incorporates _bgMapScale, so the
            // half-extent is just size*cs/2. Multiplying by _bgMapScale again
            // double-scaled the clamp — at 2x zoom, tokens released near the
            // right/bottom edge jumped inward by an extra full natural-cell.
            const half = size * this._tokenUnitScreen() / 2;
            t.x = Math.max(half, Math.min(stageW - half, nx));
            t.y = Math.max(half, Math.min(stageH - half, ny));
            this._saveMap();
            this._renderTokens();
          }
          // Left-click no longer opens the options panel — right-click does.
          // Clear the drag flag AFTER the synthesized click event has had its
          // turn to fire, so canvas-click bail logic still works for the
          // immediate drag-release click. Without this defer, every future
          // canvas click silently bails on `if (this._drag?.moved) return`
          // — that's what broke the align tool after any token drag.
          setTimeout(() => { this._drag = null; }, 0);
        };

        document.addEventListener('mousemove',onMove);
        document.addEventListener('mouseup',onUp);
      });

      // ── Touch support for mobile ─────────────────────────────────────────
      // Tap-and-drag = move the token. Long-press (500ms without movement) =
      // open the options panel (mobile substitute for right-click).
      el.addEventListener('touchstart', e => {
        if (e.touches.length !== 1) return; // pinch / multi-touch handled at map level
        e.stopPropagation(); e.preventDefault();
        const touch = e.touches[0];

        if(this._tool==='erase'){
          const i=this._tokens.findIndex(x=>x.id===t.id);
          if(i>=0){
            const wasPC = !!this._tokens[i].isPC;
            this._tokens.splice(i,1);
            this._selected=null;
            this._closePanel();
            this._saveMap();
            if (wasPC) this._render(); else this._renderTokens();
          }
          return;
        }

        stage.querySelectorAll('.map-token').forEach(tok=>tok.classList.remove('selected'));
        el.classList.add('selected');
        this._selected=t.id;

        const startX=touch.clientX, startY=touch.clientY;
        let curPx=t.x, curPy=t.y;
        let moved=false;
        let longPressFired=false;
        // Drag anchor lives on this._drag so _scaleTokensTo can rescale it
        // when the user pinch-zooms mid-drag. See mouse handler above for
        // full rationale.
        this._drag = { moved:false, startPx:t.x, startPy:t.y };
        const longPressTimer = setTimeout(() => {
          if (moved) return;
          longPressFired = true;
          this._showPanel(t);
        }, 500);

        const onMove = ev => {
          if (ev.touches.length !== 1) return;
          const tt = ev.touches[0];
          // Same zoom + rotation correction as the mouse drag handler above.
          // This is the touch path — the one the per-device zoom feature
          // exists for, so getting _screenScale() here is not optional.
          const z = this._screenScale();
          const _sd = this._stageDelta((tt.clientX-startX)/z, (tt.clientY-startY)/z);
          const dx = _sd.x, dy = _sd.y;
          if (!moved && Math.abs(dx)<6 && Math.abs(dy)<6) return;
          moved = true; this._drag.moved = true;
          clearTimeout(longPressTimer);
          if (longPressFired) return; // already opened panel; ignore drag
          ev.preventDefault();
          curPx = this._drag.startPx + dx;
          curPy = this._drag.startPy + dy;
          el.style.left = curPx+'px';
          el.style.top  = curPy+'px';
        };
        const onEnd = ev => {
          clearTimeout(longPressTimer);
          document.removeEventListener('touchmove', onMove);
          document.removeEventListener('touchend', onEnd);
          document.removeEventListener('touchcancel', onEnd);
          // Same defer-clear as the mouse path — prevents the drag's "moved"
          // state from poisoning the next tap on the canvas.
          setTimeout(() => { this._drag = null; }, 0);
          if (longPressFired) return;
          if (moved){
            let nx = curPx, ny = curPy;
            if (this._snapToGrid){
              nx = Math.round(nx/cs - size/2) * cs + size*cs/2;
              ny = Math.round(ny/cs - size/2) * cs + size*cs/2;
            }
            const stageW = this._cols * cs, stageH = this._rows * cs;
            // Same double-scale fix as the mouse handler above. `cs` already
            // includes _bgMapScale via _csScreen() — don't apply it twice.
            const half = size * this._tokenUnitScreen() / 2;
            t.x = Math.max(half, Math.min(stageW - half, nx));
            t.y = Math.max(half, Math.min(stageH - half, ny));
            this._saveMap();
            this._renderTokens();
          }
        };
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onEnd);
        document.addEventListener('touchcancel', onEnd);
      }, { passive: false });

      frag.appendChild(el);
    });
    stage.appendChild(frag);
  },

  _showPanel(t){
    const b=this._body;if(!b)return;
    const tp=b.querySelector('#token-panel');if(!tp)return;
    tp.style.display='block';
    b.querySelector('#tp-name').textContent=t.label;
    const rewire=(sel,ev,fn)=>{
      const el=b.querySelector(sel);if(!el)return;
      const fresh=el.cloneNode(true);
      el.parentNode.replaceChild(fresh,el);
      fresh.addEventListener(ev,fn);
    };
    b.querySelector('#tp-label').value=t.label;
    b.querySelector('#tp-color').value=t.color;
    b.querySelector('#tp-size').value=t.size||1;
    const sizeValEl = b.querySelector('#tp-size-val');
    // Tokens can now go sub-cell (¼ cell minimum) for familiars/imps/swarms
    // and up to 6 cells for gargantuans. Label formats as decimal cells.
    const fmtSize = (n) => {
      const r = Math.round(n * 100) / 100;
      return r.toFixed(2).replace(/\.?0+$/, '') + (Math.abs(r - 1) < .01 ? ' cell' : ' cells');
    };
    const setSizeLabel = (n) => { if (sizeValEl) sizeValEl.textContent = fmtSize(n); };
    setSizeLabel(t.size || 1);
    const clampSize = n => Math.max(0.25, Math.min(6, Math.round(n * 4) / 4));
    const stepSize = (delta) => {
      const cur = parseFloat(b.querySelector('#tp-size').value) || 1;
      const next = clampSize(cur + delta);
      if (Math.abs(next - cur) < 0.01) return;
      t.size = next;
      b.querySelector('#tp-size').value = next;
      setSizeLabel(next);
      this._saveMap();
      this._renderTokens();
    };
    rewire('#tp-size-down','click', () => stepSize(-0.25));
    rewire('#tp-size-up',  'click', () => stepSize(+0.25));
    // Sync rotation controls — slider + label show the current angle, with
    // ↺ / ↻ buttons stepping by 45° for quick cardinal/diagonal directions.
    const rot0 = t.rotation || 0;
    b.querySelector('#tp-rot').value = rot0;
    b.querySelector('#tp-rot-val').textContent = rot0 + '°';
    const applyRot = (deg) => {
      const norm = ((deg % 360) + 360) % 360;
      t.rotation = norm;
      b.querySelector('#tp-rot').value = norm;
      b.querySelector('#tp-rot-val').textContent = norm + '°';
      this._saveMap();
      this._renderTokens();
    };
    rewire('#tp-label','change',e=>{t.label=e.target.value;b.querySelector('#tp-name').textContent=t.label;this._saveMap();this._renderTokens();});
    rewire('#tp-color','change',e=>{t.color=e.target.value;this._saveMap();this._renderTokens();});
    // Slider live-updates the readout on input; commits + re-renders on release.
    rewire('#tp-size','input', e => { setSizeLabel(clampSize(parseFloat(e.target.value)||1)); });
    rewire('#tp-size','change',e=>{t.size=clampSize(parseFloat(e.target.value)||1);setSizeLabel(t.size);this._saveMap();this._renderTokens();});
    rewire('#tp-rot','input',e=>applyRot(parseInt(e.target.value)||0));
    rewire('#tp-rot-left','click',()=>applyRot((t.rotation || 0) - 45));
    rewire('#tp-rot-right','click',()=>applyRot((t.rotation || 0) + 45));
    rewire('#tp-kill','click',()=>{t.dead=!t.dead;this._saveMap();this._renderTokens();});
    rewire('#tp-del','click',()=>{
      const i=this._tokens.findIndex(x=>x.id===t.id);
      let wasPC = false;
      if (i>=0){ wasPC = !!this._tokens[i].isPC; this._tokens.splice(i,1); }
      this._selected=null;
      this._closePanel();
      this._saveMap();
      if (wasPC) this._render(); else this._renderTokens();
    });
    rewire('#tp-close','click',()=>{this._selected=null;this._closePanel();this._renderTokens();});
  },

  _closePanel(){const tp=this._body?.querySelector('#token-panel');if(tp)tp.style.display='none';},

  _syncParty(){
    let placed=0;
    // Layout positions are in stage pixels — use the on-screen cell size so
    // newly placed tokens land at the visible grid spacing.
    const cs=this._csScreen();
    const source=state.combatants.filter(c=>c.isPC).length?state.combatants.filter(c=>c.isPC):state.party;
    // Place where the DM is LOOKING and spiral out, exactly like the
    // one-at-a-time "add party member" button. That button was fixed to stop
    // dropping tokens in the top-left corner; this bulk path kept the old
    // top-row layout, so syncing the whole party still dumped everyone in the
    // corner of the map and left the DM dragging them back one by one.
    const centre = this._viewCenterStage()
      || { x: this._cols*cs/2, y: this._rows*cs/2 };
    source.forEach((c)=>{
      const name=c.name||c.label;
      if(!this._tokens.find(t=>t.label===name&&t.isPC)){
        // _freeCellNear reads this._tokens, and we push as we go, so each
        // member takes the next free ring rather than stacking on the first.
        const {x, y} = this._freeCellNear(centre.x, centre.y);
        // Pull the icon from the matching party member so tokens carry the
        // same glyph the user picked in the Party Tracker.
        const partyMatch = state.party.find(p => p.name === name);
        const icon = (c.icon || (partyMatch && partyMatch.icon) || '⚔');
        const portrait = c.portrait || (partyMatch && partyMatch.portrait) || null;
        this._tokens.push({id:uid(),label:name,x,y,isPC:true,color:'#696969',size:1,dead:(c.hp||0)<=0,icon,portrait});
        placed++;
      }
    });
    this._renderTokens();this._saveMap();
    showToast(placed?`${placed} token(s) added`:'Party already placed');
  },
});

// ─── Free-cell search ────────────────────────────────────────────────────────
// Pure, so the auto-token reconciler below can place tokens with the panel
// CLOSED, where `this._tokens` does not exist. Callers mutate `tokens`
// between calls, which is the point: placing five creatures walks five
// different cells instead of stacking them all on the first free one.
function sktFreeCell(tokens, cols, rows, cs, px, py){
  const list = Array.isArray(tokens) ? tokens : [];
  const maxCol = Math.max(0, (cols || 1) - 1), maxRow = Math.max(0, (rows || 1) - 1);
  const col0 = Math.max(0, Math.min(maxCol, Math.floor(px / cs)));
  const row0 = Math.max(0, Math.min(maxRow, Math.floor(py / cs)));
  const taken = (c, r) => {
    const x = (c + 0.5) * cs, y = (r + 0.5) * cs;
    return list.some(t => t.x != null &&
      Math.abs(t.x - x) < cs / 2 && Math.abs(t.y - y) < cs / 2);
  };
  if (!taken(col0, row0)) return { x: (col0 + 0.5) * cs, y: (row0 + 0.5) * cs };
  // Rings outward from the centre cell. Bounded by the map, so this always
  // terminates; if every cell is occupied we fall back to the centre.
  const maxRing = Math.max(cols || 1, rows || 1);
  for (let ring = 1; ring <= maxRing; ring++){
    for (let dc = -ring; dc <= ring; dc++){
      for (let dr = -ring; dr <= ring; dr++){
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;   // ring edge only
        const c = col0 + dc, r = row0 + dr;
        if (c < 0 || r < 0 || c > maxCol || r > maxRow) continue;
        if (!taken(c, r)) return { x: (c + 0.5) * cs, y: (r + 0.5) * cs };
      }
    }
  }
  return { x: (col0 + 0.5) * cs, y: (row0 + 0.5) * cs };
}

// ─── Auto-tokens: the tracker is the roster, the map is the picture ──────────
// Adding a creature to the Combat Tracker drops a token for it on the map.
// Before this the two lists were maintained by hand and drifted immediately —
// a live campaign was found with five PC tokens and three monsters that
// existed only in the tracker, which leaves the Turn View with no square to
// centre on, no reach ring and no opportunity attacks on a monster's turn.
//
// RECONCILIATION, not an add-hook. Six places across four files push a
// combatant, and hooking each one guarantees the seventh gets missed. This
// derives the tokens the map SHOULD have from the roster, and runs off save().
//
// Only tokens it created carry `auto: true`, and only those are removed again:
// a token the DM placed by hand is theirs and outlives the fight.

function _sktTokenForNewCombatant(c, x, y){
  const isPC = !!c.isPC;
  const glyph = (typeof CLASS_ICONS !== 'undefined'
    ? (CLASS_ICONS[c.cls] || (isPC ? CLASS_ICONS.fighter : CLASS_ICONS.enemy)) : null)
    || (isPC ? '⚔' : '🐲');
  // A combatant carries a portrait when it came from the bestiary. For PCs
  // fall back to the party slot, so an auto-placed PC token looks the same as
  // a hand-placed one.
  const mate = isPC && typeof state !== 'undefined'
    ? (state.party || []).find(p => sktNormName(p.name) === sktNormName(c.name)) : null;
  const tok = {
    id: (typeof uid === 'function' ? uid() : String(Math.random()).slice(2)),
    // The link back to the combatant. Everything else here can be edited by
    // the DM; this is what survives a rename on either side.
    cid: c.id,
    label: c.name,
    x, y,
    isPC,
    color: isPC ? '#696969' : '#993333',
    size: 1,
    dead: (c.hp || 0) <= 0,
    icon: c.icon || (mate && mate.icon) || glyph,
    portrait: c.portrait || (mate && mate.portrait) || null,
    auto: true,
  };
  if (c.baseName) tok.baseName = c.baseName;
  return tok;
}

// The reconciliation, over a plain view of the map. Mutates `tokens`.
function sktReconcileTokens(tokens, combatants, cols, rows, cs, centre){
  const list = Array.isArray(combatants) ? combatants : [];
  let added = 0, removed = 0, renamed = 0;

  // Drop auto tokens whose combatant has left the fight, and any duplicate
  // that shares a `cid` with an earlier one.
  //
  // The duplicate case is a two-DM-device race: device A adds a monster and
  // pushes combat and battlemap as separate keys, so B can see the new
  // combatant before the token that came with it. A local save() on B in that
  // window places a second token for the same creature. Both then merge by
  // token id and the map keeps both. Cheaper to make it self-healing here
  // than to try to order two independent Firebase keys.
  const seenCid = new Set();
  for (let i = 0; i < tokens.length; i++){
    const t = tokens[i];
    if (!t || t.cid == null) continue;
    if (seenCid.has(t.cid)){ tokens.splice(i, 1); i--; removed++; continue; }
    seenCid.add(t.cid);
  }
  for (let i = tokens.length - 1; i >= 0; i--){
    const t = tokens[i];
    if (!t || !t.auto) continue;
    if (!list.some(c => sktTokenForCombatant([t], c))){ tokens.splice(i, 1); removed++; }
  }

  list.forEach(c => {
    const t = sktTokenForCombatant(tokens, c);
    if (t){
      // A linked token follows its combatant's name — the tracker is the
      // roster. Renaming IN PLACE is the point: culling and re-placing would
      // move the creature, which is what the `cid` link exists to prevent.
      if (t.cid != null && t.cid === c.id){
        if (t.label !== c.name){
          t.label = c.name;
          if (c.baseName) t.baseName = c.baseName; else delete t.baseName;
          renamed++;
        }
        // Death follows the tracker too. Nothing propagated it before, so a
        // monster killed in the tracker went on standing upright on the map
        // until the DM remembered to hit the skull button on its token.
        const isDead = !!c.dead || (c.hp || 0) <= 0;
        if (!!t.dead !== isDead){ t.dead = isDead; renamed++; }
      }
      return;
    }
    const { x, y } = sktFreeCell(tokens, cols, rows, cs, centre.x, centre.y);
    tokens.push(_sktTokenForNewCombatant(c, x, y));
    added++;
  });

  return { added, removed, renamed };
}

// Roster signature. Cheap enough to run on every save(), and it means an
// ordinary HP tick — the highest-frequency save there is — reconciles
// nothing. Liveness is in the signature because a token's `dead` mark follows
// the tracker, and dying is the one HP change the map has to notice.
function _sktRosterSig(){
  if (typeof state === 'undefined' || !Array.isArray(state.combatants)) return '';
  return state.combatants
    .map(c => sktNormName(c.name) + ((c.dead || (c.hp || 0) <= 0) ? '†' : ''))
    .join('|');
}
let _sktLastRosterSig = null;

// Entry point, called from save(). Works whether or not the panel is mounted:
// with it closed the STORED JSON is edited directly, because the panel's
// in-memory _tokens is an empty array until mount() and writing that back
// would erase the map.
function sktEnsureCombatTokens(force){
  try {
    // Players never create tokens. The battle map drops unknown token ids
    // arriving from a player for the same reason, and the Firebase rules
    // cannot tell the two apart — so the check has to be here.
    if (document.body.classList.contains('player-mode')) return;
    if (typeof state === 'undefined' || !Array.isArray(state.combatants)) return;

    const sig = _sktRosterSig();
    if (!force && sig === _sktLastRosterSig) return;
    _sktLastRosterSig = sig;
    // No early return on an empty roster. Ending combat clears every
    // combatant at once, and skipping the pass there meant removing seven of
    // eight creatures took seven tokens with them while removing the eighth
    // took none — the map kept a full set of dead monsters after every fight.
    // Hand-placed tokens are untouched either way.

    const def = (typeof panelDefs !== 'undefined') && panelDefs.battlemap;
    if (def && def._body){
      const centre = def._viewCenterStage()
        || { x: def._cols * def._csScreen() / 2, y: def._rows * def._csScreen() / 2 };
      const r = sktReconcileTokens(def._tokens, state.combatants,
                                   def._cols, def._rows, def._csScreen(), centre);
      if (r.added || r.removed || r.renamed){ def._renderTokens(); def._saveMap(); }
      return r;
    }

    const raw = localStorage.getItem('skt-battlemap-v1');
    if (!raw) return;                     // no map yet — nothing to place onto
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.tokens)) return;
    const cs   = (d.cellSize || 50) * (d.bgMapPath ? (d.bgMapScale || 1) : 1);
    const cols = d.cols || 24, rows = d.rows || 18;
    // No viewport to read with the panel closed, so aim at the middle of what
    // is already placed — beside the party, not in a far corner.
    const placed = d.tokens.filter(t => t.x != null);
    const centre = placed.length
      ? { x: placed.reduce((s, t) => s + t.x, 0) / placed.length,
          y: placed.reduce((s, t) => s + t.y, 0) / placed.length }
      : { x: cols * cs / 2, y: rows * cs / 2 };
    const r = sktReconcileTokens(d.tokens, state.combatants, cols, rows, cs, centre);
    if (r.added || r.removed || r.renamed){
      // setItem is enough to sync: realtime.js patches Storage.prototype and
      // pushes any dirtied SKT_SYNC_KEYS key. Deliberately NOT broadcast on
      // the 'skt-battlemap' channel — a listener there treats any message
      // without a `kind` as a full state snapshot and hands it to
      // applyMapState(), so a partial payload would blank a player's map.
      localStorage.setItem('skt-battlemap-v1', JSON.stringify(d));
    }
    return r;
  } catch(e){
    // A token that failed to place must never take down the save() that
    // triggered it.
    console.warn('[SKT] auto-token', e);
  }
}

// Feet, or miles once feet stop being readable. 390 ft is a room; 2,059,200 ft
// is a map of the North and nobody can see that it means 390 miles.
function _bmDist(ft){
  if (!(ft > 0)) return '0 ft';
  if (ft >= 5280){
    const mi = ft / 5280;
    return (mi >= 10 ? Math.round(mi) : Math.round(mi * 10) / 10) + ' mi';
  }
  return (Math.round(ft * 10) / 10) + ' ft';
}
