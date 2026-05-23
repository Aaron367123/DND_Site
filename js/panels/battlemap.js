// ============================================================
// BATTLE MAP PANEL
// ============================================================
// Image stored in memory only — never localStorage (avoids freeze/quota)
let _mapBgImage = null; // holds the Image object

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
  _fogHardness:50,               // 0–100 → blur on fog canvas
  _gridOpacity:60,               // 0–100 → grid line alpha
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
  // Map image scale (1 = natural pixel size). Persisted; the toolbar slider
  // adjusts it. Aspect ratio is always preserved.
  _bgMapScale: 1,
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
        this._fogHardness   = (d.fogHardness   != null) ? d.fogHardness   : 50;
        this._gridOpacity   = (d.gridOpacity   != null) ? d.gridOpacity   : 60;
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
    this._render();
    if (this._bgMapPath) this._loadBgFromPath(this._bgMapPath);
    this._startBroadcast();
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
    this._saveMap();
    this._stopBroadcast();
    this._body = null;
  },

  _saveMap(){
    try{
      const fogArr=this._fog?Array.from(this._fog):null;
      localStorage.setItem('skt-battlemap-v1',JSON.stringify({tokens:this._tokens,cellSize:this._cellSize,cols:this._cols,rows:this._rows,bgColor:this._bgColor,fog:fogArr,bgMapPath:this._bgMapPath,showGrid:this._showGrid,gridType:this._gridType,cellHighlight:this._cellHighlight,bgMapScale:this._bgMapScale,snapToGrid:this._snapToGrid,drawings:this._drawings,gridOffsetX:this._gridOffsetX,gridOffsetY:this._gridOffsetY,mapRotation:this._mapRotation,fogHardness:this._fogHardness,gridOpacity:this._gridOpacity,tokensVisible:this._tokensVisible,namesVisible:this._namesVisible,pcsVisible:this._pcsVisible,npcsVisible:this._npcsVisible,fogPaintMode:this._fogPaintMode,fogBrushMode:this._fogBrushMode,fogBrushShape:this._fogBrushShape,fogStrokes:this._fogStrokes}));
    }catch(e){}
    this._broadcast();
  },

  // Load an image at img/{path} into _mapBgImage and refresh the canvas.
  // When autoFit is true (called from the picker), also fit the loaded image
  // to the panel viewport so the user gets a sensible default zoom.
  _loadBgFromPath(path, autoFit){
    const img = new Image();
    img.onload = () => {
      _mapBgImage = img;
      this._bgMapNaturalW = img.naturalWidth;
      this._bgMapNaturalH = img.naturalHeight;
      if (autoFit){
        this._fitMapToView();
      } else {
        this._fitGridToBg();
        const b = this._body;
        const stage = b && b.querySelector('#map-stage');
        if (stage){
          const cs = this._csScreen();
          this._applyBg(stage, this._cols*cs, this._rows*cs);
        }
        this._render();
      }
    };
    img.onerror = () => { showToast('Could not load map image'); };
    img.src = 'img/' + path;
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

  // On-screen pixel size of one grid cell at the current zoom level. When no
  // map is loaded, scale is 1.0 (grid is drawn at the natural cellSize).
  _csScreen(){
    return this._cellSize * (_mapBgImage ? (this._bgMapScale || 1) : 1);
  },

  _drawAllStrokes(){
    const b = this._body; if (!b) return;
    const canvas = b.querySelector('#draw-canvas'); if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
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
    // Hit radius scales with the stroke width so thicker lines are also
    // easier to grab. Floor of 8 screen-pixels regardless of zoom.
    for (let i = this._drawings.length - 1; i >= 0; i--){
      const s = this._drawings[i];
      const p = s.p; if (!p || p.length < 2) continue;
      const radius = Math.max(8, ((s.s || 4) * (this._bgMapScale || 1)) / 2 + 6);
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
    try {
      localStorage.setItem('skt-battlemap-starred-v1', JSON.stringify([...(this._starredMaps || [])]));
    } catch(e){}
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
      const tokenSrc = 'img/' + m.path;
      return `<div class="mapsel-card starred" data-path="${esc(m.path)}" title="${esc(m.title)}${m.advName?' — '+esc(m.advName):''}">
        <button class="mapsel-star on" data-mapsel-star="${esc(m.path)}" title="Unstar">★</button>
        <img src="${esc(tokenSrc)}" loading="lazy" alt="${esc(m.title)}" onerror="this.style.opacity=.3">
        <div class="mapsel-title">${esc(m.title)}</div>
        ${m.advName ? `<div class="mapsel-sub">${esc(m.advName)}</div>` : ''}
        <span class="mapsel-badge ${esc(m.type || 'map')}">${m.type==='mapPlayer'?'Player':'DM'}</span>
      </div>`;
    }).join('');
    return `<div id="mapsel-starred-host" style="margin-bottom:14px">
      <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:6px;display:flex;align-items:center;gap:6px">
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
      return `<div class="mapsel-saved-row" style="display:flex;align-items:center;gap:6px;background:var(--panel-2);border:1px solid var(--border);border-radius:4px;padding:5px 8px;margin-bottom:4px;font-size:12px">
        <button data-savedmap-load="${esc(s.id)}" style="flex:1;background:transparent;border:none;color:var(--text);font-family:inherit;font-size:12px;cursor:pointer;text-align:left;padding:2px 4px;display:flex;flex-direction:column;gap:1px" title="Load this saved map">
          <span style="font-weight:600">${esc(s.name)}</span>
          <span style="font-size:10px;color:var(--text-dim)">${esc(bgLabel)}${stats ? ' · ' + esc(stats) : ''}</span>
        </button>
        <button class="btn icon-btn danger" data-savedmap-del="${esc(s.id)}" title="Delete this saved map" style="padding:2px 6px;font-size:11px">×</button>
      </div>`;
    }).join('');
    return `<div id="mapsel-saved-host" style="margin-bottom:14px">
      <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:6px">Saved maps</div>
      <div style="max-height:200px;overflow-y:auto">${rows}</div>
    </div>`;
  },

  // ─── Saved-maps library ──────────────────────────────────────────────────
  // Persist the saved-map list under its own key. Same try/catch shape as
  // the active-map save — quota errors are swallowed (rare for this list
  // since each entry is small, just metadata + token/fog state).
  _saveSavedMaps(){
    try { localStorage.setItem('skt-battlemap-saved-v1', JSON.stringify({saved:this._savedMaps})); }
    catch(e){}
  },

  // Snapshot the full per-map state into a plain JSON object suitable for
  // long-term storage. Deliberately omits the uploaded-image data URL (too
  // big for localStorage) and any session-only flags (visibility toggles).
  _snapshotMap(){
    return {
      bgMapPath:    this._bgMapPath || null,
      bgMapScale:   this._bgMapScale || 1,
      mapRotation:  this._mapRotation || 0,
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
    this._drawings     = Array.isArray(snap.drawings) ? JSON.parse(JSON.stringify(snap.drawings)) : [];
    this._lastTokenScale = this._bgMapScale;
    // Bg image: either reload via 5etools path, or drop any stale in-memory
    // image (uploads can't survive). The user gets a one-shot toast warning
    // when an upload state is restored without its image.
    if (this._bgMapPath){
      _mapBgImage = null;
      this._loadBgFromPath(this._bgMapPath);
    } else {
      _mapBgImage = null;
      this._render();
      if (snap.hadUploadedImage && typeof showToast === 'function'){
        showToast('Loaded — re-upload the background image (uploads are session-only)');
      }
    }
    this._saveMap();
    this._broadcast();
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

  // Resize the stage + every canvas in place and redraw the grid/strokes/fog/
  // tokens at the given scale. Used by the wheel/pinch zoom paths so a live
  // zoom is glitch-free without forcing an innerHTML rebuild.
  // Caller is responsible for already having set this._bgMapScale and run
  // _scaleTokensTo so token coords are at the new scale.
  _applyZoomTransform(scale){
    const b = this._body; if (!b) return;
    const stage  = b.querySelector('#map-stage'); if (!stage) return;
    const grid   = b.querySelector('#map-canvas');
    const drawC  = b.querySelector('#draw-canvas');
    const csNow  = this._csScreen();
    const W      = this._cols * csNow;
    const H      = this._rows * csNow;

    stage.style.width  = W + 'px';
    stage.style.height = H + 'px';
    this._applyBg(stage, W, H);

    if (grid){
      grid.width = W; grid.height = H;
      this._drawGrid(grid, csNow);
    }
    if (drawC){
      drawC.width = W; drawC.height = H;
      this._drawAllStrokes();
    }
    if (this._fog !== null) this._drawFog();

    // Token DOM positions/sizes — tokens use stage-pixel coords (already
    // scaled in _scaleTokensTo) and visual diameter = natural cellSize × scale.
    const csNat = this._cellSize;
    // Track each token's current diameter so we can place its name label
    // below it (labels are siblings of .map-token, not children).
    const tokenDim = new Map();
    b.querySelectorAll('.map-token').forEach(el => {
      const t = this._tokens.find(x => x.id === el.dataset.tid);
      if (!t || t.x == null) return;
      el.style.left = t.x + 'px';
      el.style.top  = t.y + 'px';
      const sz = t.size || 1;
      const dim = (sz * csNat - 4) * scale;
      // Match the glyph vs initials font-size logic from _renderTokens so
      // emoji icons stay big at every zoom level.
      const iconSource = t.portrait || t.icon;
      const isImgIcon = typeof iconSource === 'string' && (iconSource.startsWith('data:image/') || iconSource.startsWith('img/') || /^https?:\/\//.test(iconSource));
      const isSvgIcon = typeof iconSource === 'string' && iconSource.startsWith('<svg');
      const isGlyphIcon = !!(t.icon || t.portrait) && !isImgIcon && !isSvgIcon;
      const fontSize = isGlyphIcon
        ? Math.max(14, dim * 0.6)
        : (sz > 1 ? 13 : Math.max(8, 11 - (this._tokenDisplayLabel(t).length > 5 ? 2 : 0))) * scale;
      el.style.width  = dim + 'px';
      el.style.height = dim + 'px';
      el.style.fontSize = fontSize.toFixed(1) + 'px';
      tokenDim.set(t.id, dim);
    });
    // Reposition the name labels (siblings of .map-token) to track their
    // tokens through the zoom. Without this they stick at their pre-zoom
    // y-coordinate and drift away from the circle.
    b.querySelectorAll('.map-token-name').forEach(el => {
      const t = this._tokens.find(x => x.id === el.dataset.tid);
      if (!t || t.x == null) return;
      const dim = tokenDim.get(t.id) || ((t.size||1) * csNat - 4) * scale;
      el.style.left = t.x + 'px';
      el.style.top  = (t.y + dim/2 + 4) + 'px';
      // Floor font-size at 11px so labels stay readable at low zoom.
      el.style.fontSize = Math.max(11, 10 * scale).toFixed(1) + 'px';
    });

    // Keep the toolbar slider/% display in sync.
    const slider = b.querySelector('#map-bg-scale'); if (slider) slider.value = scale;
    const pct    = b.querySelector('#map-bg-scale-pct'); if (pct) pct.textContent = Math.round(scale*100)+'%';
  },

  // Fit-to-view: pick the largest scale that makes the map fully fit inside
  // the current panel viewport, then refit grid + render.
  _fitMapToView(){
    if (!_mapBgImage || !this._bgMapNaturalW) return;
    const scrollEl = this._body?.querySelector('#map-scroll');
    if (!scrollEl) return;
    const vw = scrollEl.clientWidth - 4;   // small margin so edges aren't flush
    const vh = scrollEl.clientHeight - 4;
    if (vw <= 0 || vh <= 0) return;
    const sx = vw / this._bgMapNaturalW;
    const sy = vh / this._bgMapNaturalH;
    this._bgMapScale = Math.max(0.05, Math.min(3, Math.min(sx, sy)));
    this._scaleTokensTo(this._bgMapScale);
    this._fitGridToBg();
    this._isFitted = true; // panel resize will re-fit until the user manually zooms
    this._saveMap();
    // Glitch-free fit: in-place size every layer instead of an innerHTML
    // rebuild that would briefly flash the empty stage.
    this._applyZoomTransform(this._bgMapScale);
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
        if (!isPlayer) return; // DM tab only sends; ignore its own echoes
        const msg = ev.data; if (!msg) return;
        // Live-drawing messages — applied to a transient preview that doesn't
        // touch _drawings. Once the DM finishes the stroke, a full state push
        // arrives (with the stroke now in _drawings) and the preview is
        // cleared.
        if (msg.kind === 'strokeTick'){ this._applyPreviewStroke(msg.stroke); return; }
        if (msg.kind === 'strokeEnd'){ this._clearPreviewStroke(); return; }
        // Apply incoming state directly. Avoid a full _render() — that would
        // tear down the canvas and cause a visible flicker on every fog
        // sample. For typical paint events we just need the fog canvas and
        // the token positions repainted in place.
        const prevPath = this._bgMapPath;
        if (msg.tokens)   this._tokens   = msg.tokens;
        if (msg.cellSize) this._cellSize = msg.cellSize;
        if (msg.cols)     this._cols     = msg.cols;
        if (msg.rows)     this._rows     = msg.rows;
        if (msg.bgColor)  this._bgColor  = msg.bgColor;
        if (msg.gridType){ this._gridType = msg.gridType; this._showGrid = msg.gridType !== 'none'; }
        this._fog = msg.fog ? new Set(msg.fog) : null;
        if (Array.isArray(msg.drawings))   this._drawings   = msg.drawings;
        if (Array.isArray(msg.fogStrokes)) this._fogStrokes = msg.fogStrokes;
        if (msg.bgMapPath !== undefined) this._bgMapPath = msg.bgMapPath;

        // Map path changed → reload the bg image, then full re-render so the
        // canvas is sized to the new map.
        if (msg.bgMapPath && msg.bgMapPath !== prevPath){
          if (this._loadBgFromPath) this._loadBgFromPath(this._bgMapPath);
          return; // _loadBgFromPath triggers _render() on image load
        }
        // Map was cleared on the DM side → drop the cached image and re-render
        // so the player sees the empty background instead of stale art.
        if (!msg.bgMapPath && prevPath){
          _mapBgImage = null;
          if (this._render) this._render();
          return;
        }
        // Lightweight repaint — fog + drawings + tokens only. No flicker.
        if (this._body){
          // Redraw grid canvas so gridType changes (square/hex/none) reflect
          // on the player side without waiting for a full re-render.
          const _gridC = this._body.querySelector('#map-canvas');
          if (_gridC) this._drawGrid(_gridC, this._csScreen());
          this._drawFog();
          if (Array.isArray(msg.drawings)){
            // Stroke now committed → drop the live preview (whichever client's
            // tick last painted it) and redraw from canonical state.
            this._previewStroke = null;
            this._drawAllStrokes();
          }
          this._renderTokens();
        }
      };
    }catch(e){}
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
        bgImageData: _mapBgImage?'present':null,
        bgMapPath: this._bgMapPath,
        // Pencil annotations — players see strokes as the DM commits them
        // (mouseup) and as the eraser removes them.
        drawings: this._drawings || [],
        // Free-mode fog strokes (pixel-level, cell-fraction coords).
        fogStrokes: this._fogStrokes || [],
      });
    }catch(e){}
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
    const ft={40:5,50:5,64:5,80:10}[cs]||5;
    this._tool=this._tool==='move'?'add-pc':this._tool; // default to add-pc if somehow move
    // Always allow dragging regardless of tool — move is always active
    b.style.cssText='display:flex;flex-direction:column;height:100%;overflow:hidden;position:relative';

    const partyBtns=state.party.map((p,pi)=>{
      const onMap=this._tokens.find(t=>t.label===p.name&&t.isPC);
      if(onMap)return '';
      // renderIcon handles emoji vs uploaded images (data: URLs / img/ paths) vs SVG.
      const iconHtml = renderIcon(p.icon||'⚔', p.name);
      return '<button class="btn small" data-mact="add-party" data-pi="'+pi+'" draggable="true" title="Click to add at top-left, or drag onto the map for precise placement" style="font-size:10px;display:inline-flex;align-items:center;gap:4px;cursor:grab">'
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
        + '<button class="btn small" data-mact="toggle-toolbar" style="pointer-events:auto;padding:2px 8px;font-size:10px;opacity:.85" title="Show toolbar">▾ Tools</button>'
        + '</div>';
    } else if (_isPlayer) {
    // Player-view toolbar — minimal: Draw + Erase tools, zoom, Clear
    // (tokens) and Drawings (clear all pencil). Everything DM-only is
    // omitted entirely.
    html+='<div class="map-toolbar">'
      +'<button class="btn icon-btn" data-mact="toggle-toolbar" style="flex-shrink:0;padding:2px 5px" title="Hide toolbar (more map space)">▲</button>'
      +'<button class="btn '+(this._tool==='draw'?'active':'')+'" data-mact="tool-draw" title="Pencil — draw on the map">🖊 Draw</button>'
      +(this._tool==='draw' ? '<input type="color" id="draw-color" value="'+this._drawColor+'" style="width:24px;height:22px;padding:1px;border-radius:3px;flex-shrink:0;cursor:pointer" title="Brush color">' : '')
      +(this._tool==='draw' ? '<select id="draw-size" style="width:64px;font-size:11px;padding:2px 4px;flex-shrink:0">'
        +'<option value="2"'+(this._drawSize===2?' selected':'')+'>Thin</option>'
        +'<option value="4"'+(this._drawSize===4?' selected':'')+'>Med</option>'
        +'<option value="8"'+(this._drawSize===8?' selected':'')+'>Thick</option>'
      +'</select>' : '')
      +'<button class="btn '+(this._tool==='erase'?'active':'')+'" data-mact="tool-erase">🗑 Erase</button>'
      // Zoom — the bg-scale slider + % display + Fit, only when a map is loaded.
      +(_mapBgImage?'<div style="width:1px;background:var(--border);height:18px;margin:0 4px;flex-shrink:0"></div>':'')
      +(_mapBgImage?'<input type="range" id="map-bg-scale" min="0.1" max="3" step="0.05" value="'+(this._bgMapScale||1)+'" style="width:80px;flex-shrink:0" title="Zoom">':'')
      +(_mapBgImage?'<span id="map-bg-scale-pct" style="font-size:10px;color:var(--text-muted);width:34px;text-align:right;flex-shrink:0">'+Math.round((this._bgMapScale||1)*100)+'%</span>':'')
      +(_mapBgImage?'<button class="btn" data-mact="fit-map" style="flex-shrink:0" title="Fit map to panel">⊙ Fit</button>':'')
      +'<div style="flex:1"></div>'
      +'<button class="btn" data-mact="clear-draw" style="flex-shrink:0" title="Clear all drawings">🗑 Drawings</button>'
      +'<button class="btn danger" data-mact="clear-tokens" style="flex-shrink:0">Clear</button>'
    +'</div>';
    } else {
    html+='<div class="map-toolbar">'
      +'<button class="btn icon-btn" data-mact="toggle-toolbar" style="flex-shrink:0;padding:2px 5px" title="Hide toolbar (more map space)">▲</button>'
      +'<button class="btn '+(this._tool==='add-pc'?'active':'')+'" data-mact="tool-add-pc">+ PC</button>'
      +'<button class="btn '+(this._tool==='add-npc'?'active':'')+'" data-mact="tool-add-npc">+ NPC</button>'
      +'<button class="btn '+(this._tool==='erase'?'active':'')+'" data-mact="tool-erase">🗑 Erase</button>'
      +'<button class="btn '+(this._tool==='draw'?'active':'')+'" data-mact="tool-draw" title="Pencil — draw on the map">🖊 Draw</button>'
      +(this._tool==='draw' ? '<input type="color" id="draw-color" value="'+this._drawColor+'" style="width:24px;height:22px;padding:1px;border-radius:3px;flex-shrink:0;cursor:pointer" title="Brush color">' : '')
      +(this._tool==='draw' ? '<select id="draw-size" style="width:64px;font-size:11px;padding:2px 4px;flex-shrink:0">'
        +'<option value="2"'+(this._drawSize===2?' selected':'')+'>Thin</option>'
        +'<option value="4"'+(this._drawSize===4?' selected':'')+'>Med</option>'
        +'<option value="8"'+(this._drawSize===8?' selected':'')+'>Thick</option>'
      +'</select>' : '')
      +'<div style="width:1px;background:var(--border);height:18px;margin:0 4px;flex-shrink:0"></div>'
      +'<span style="font-size:10px;color:var(--text-muted);flex-shrink:0;margin-left:2px">Grid</span>'
      +'<input type="number" id="map-size" min="8" max="400" step="1" value="'+cs+'" style="width:54px;font-size:11px;padding:2px 4px;flex-shrink:0" title="Cell size in pixels (try 30, 50, 64, 80, 100, 120…)">'
      +'<select id="map-size-preset" style="width:34px;font-size:11px;padding:2px 1px;flex-shrink:0" title="Common sizes">'
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
      +'<button class="btn" data-mact="pick-map" style="flex-shrink:0">🗺 Map</button>'
      +(_mapBgImage?'<button class="btn danger" data-mact="clear-img" style="flex-shrink:0">✕ Map</button>':'')
      +(_mapBgImage?'<input type="range" id="map-bg-scale" min="0.1" max="3" step="0.05" value="'+(this._bgMapScale||1)+'" style="width:80px;flex-shrink:0" title="Map size">':'')
      +(_mapBgImage?'<span id="map-bg-scale-pct" style="font-size:10px;color:var(--text-muted);width:34px;text-align:right;flex-shrink:0">'+Math.round((this._bgMapScale||1)*100)+'%</span>':'')
      +(_mapBgImage?'<button class="btn" data-mact="fit-map" style="flex-shrink:0" title="Fit map to panel">⊙ Fit</button>':'')
      +'<button class="btn icon-btn '+(this._showGrid?'active':'')+'" data-mact="toggle-grid" style="flex-shrink:0" title="Grid style: cycle square → hex → none">⊞</button>'
      +'<button class="btn icon-btn '+(this._snapToGrid?'active':'')+'" data-mact="toggle-snap" style="flex-shrink:0" title="Snap tokens to grid on drop (Shift inverts)">🧲</button>'
      +(_mapBgImage?'<button class="btn icon-btn '+(this._tool==='align'?'active':'')+'" data-mact="tool-align" style="flex-shrink:0" title="Align grid to printed map grid: click two opposite corners of one cell">📐</button>':'')
      +((this._gridOffsetX||this._gridOffsetY)?'<button class="btn icon-btn" data-mact="reset-align" style="flex-shrink:0" title="Reset grid alignment (offset back to 0,0)">↺</button>':'')
      // Fog cluster — only the toggle is visible by default. When fog is on,
      // its sub-controls (paint mode, brush radius, hide/show all) appear.
      +'<div style="width:1px;background:var(--border);height:18px;margin:0 4px;flex-shrink:0"></div>'
      +'<button class="btn '+(this._fog!==null?'active':'')+'" data-mact="fog-toggle" style="flex-shrink:0" title="Toggle Fog of War">🌫 Fog</button>'
      +(this._fog!==null?'<button class="btn icon-btn '+(this._fogTool?'active':'')+'" data-mact="fog-paint" style="flex-shrink:0" title="Paint to reveal fog">🖌</button>':'')
      +(this._fog!==null&&this._fogTool?'<input type="range" id="fog-radius" min="1" max="5" value="'+(this._fogRadius||1)+'" style="width:50px;flex-shrink:0" title="Brush size">':'')
      +(this._fog!==null?'<button class="btn icon-btn" data-mact="fog-hide-all" style="flex-shrink:0" title="Hide entire map (fog everything)">🚫</button>':'')
      +(this._fog!==null?'<button class="btn icon-btn" data-mact="fog-show-all" style="flex-shrink:0" title="Reveal entire map">👁</button>':'')
      +'<div style="flex:1"></div>'
      +'<button class="btn icon-btn '+(this._settingsOpen?'active':'')+'" data-mact="toggle-settings" style="flex-shrink:0" title="Map settings">⚙</button>'
    +'</div>';

    } // end !_toolbarHidden
    // Party bar — list of party members not yet placed on the map. Visible
    // in both DM and player toolbars (when the toolbar isn't collapsed) so
    // players can see their party-icon row mirrored from the DM view.
    if (partyBtns && !this._toolbarHidden){
      html+='<div style="display:flex;gap:4px;padding:4px 8px;border-bottom:1px solid var(--border);background:var(--panel-2);flex-wrap:wrap;align-items:center">'
        +'<span style="font-size:10px;color:var(--text-muted)">Party:</span>'+partyBtns+'</div>';
    }

    // Map area + settings sidebar side-by-side. Settings sidebar is rendered
    // outside the scrollable map area so the map keeps panning/zooming without
    // affecting the controls.
    html+='<div class="bm-main" style="flex:1;display:flex;min-height:0;overflow:hidden;position:relative">'
      +'<div id="map-scroll" style="flex:1;overflow:auto;background:#111;position:relative;'
        + (this._tokensVisible?'':'--bm-hide-tokens:1;')+'">'
      +'<div id="map-stage" class="'
        + (this._tokensVisible?'':'hide-tokens ')
        + (this._namesVisible?'':'hide-names ')
        + (this._pcsVisible?'':'hide-pcs ')
        + (this._npcsVisible?'':'hide-npcs ')
        + '" style="position:relative;display:inline-block'
        + (this._mapRotation ? `;transform-origin:50% 50%;transform:rotate(${this._mapRotation}deg)` : '')
        + '">'
        +'<canvas id="map-canvas" style="display:block;position:relative;z-index:1"></canvas>'
      +'</div>'
      +'</div>'
      + (this._settingsOpen ? this._renderSettingsSidebar() : '')
    +'</div>';

    html+='<div style="padding:3px 10px;border-top:1px solid var(--border);background:var(--panel-2);font-size:10px;color:var(--text-muted);display:flex;align-items:center;gap:10px;flex-shrink:0">'
      +'<span>1 sq = <strong>'+ft+' ft</strong></span>'
      +'<span style="color:var(--text-dim)">'+this._cols+'×'+this._rows+' squares ('+this._cols*ft+'×'+this._rows*ft+' ft)</span>'
      +'<span style="flex:1"></span>'
      +'<span style="font-size:9px;color:var(--text-dim)">Drag tokens freely · Right-click for options</span>'
    +'</div>';

    html+='<div id="token-panel" style="position:absolute;right:8px;top:52px;width:164px;background:var(--panel);border:1px solid var(--border);border-radius:5px;padding:10px;font-size:11px;z-index:20;display:none;box-shadow:0 4px 16px rgba(0,0,0,.5)">'
      +'<div style="font-weight:500;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">'
        +'<span id="tp-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px">Token</span>'
        +'<button class="btn icon-btn" id="tp-close" style="padding:0 4px;font-size:13px;flex-shrink:0">✕</button>'
      +'</div>'
      +'<label class="field-label">Label</label>'
      +'<input type="text" id="tp-label" style="margin-bottom:6px;font-size:11px">'
      +'<label class="field-label">Color</label>'
      +'<input type="color" id="tp-color" style="width:100%;height:26px;margin-bottom:6px;cursor:pointer">'
      +'<label class="field-label">Size (cells)</label>'
      +'<div style="display:flex;gap:4px;margin-bottom:8px;align-items:center">'
        +'<button class="btn icon-btn" id="tp-size-down" title="Smaller (¼ cell)" style="padding:1px 6px;font-size:13px">−</button>'
        +'<input type="range" id="tp-size" min="0.25" max="6" step="0.25" value="1" style="flex:1">'
        +'<button class="btn icon-btn" id="tp-size-up" title="Bigger (¼ cell)" style="padding:1px 6px;font-size:13px">+</button>'
        +'<span id="tp-size-val" style="font-size:11px;color:var(--text-muted);min-width:52px;text-align:right">1.00 cells</span>'
      +'</div>'
      +'<label class="field-label">Facing</label>'
      +'<div style="display:flex;gap:3px;margin-bottom:6px;align-items:center">'
        +'<button class="btn icon-btn" id="tp-rot-left" title="Rotate -45°" style="padding:1px 6px;font-size:11px">↺</button>'
        +'<input type="range" id="tp-rot" min="0" max="359" step="5" value="0" style="flex:1">'
        +'<button class="btn icon-btn" id="tp-rot-right" title="Rotate +45°" style="padding:1px 6px;font-size:11px">↻</button>'
        +'<span id="tp-rot-val" style="font-size:10px;color:var(--text-muted);min-width:30px;text-align:right">0°</span>'
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

    canvas.width=W; canvas.height=H;
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
    drawCanvas.width = W; drawCanvas.height = H;
    // Draw canvas needs to receive clicks for the pencil AND for the eraser
    // (to remove strokes). Other tools/no-tool let clicks pass through.
    drawCanvas.style.pointerEvents = (this._tool === 'draw' || this._tool === 'erase') ? 'auto' : 'none';
    this._drawAllStrokes();
    this._renderTokens();

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
        // Place at first empty slot in the top row, in stage-pixel coords.
        // Use on-screen cellSize so placement scales with the current zoom.
        const cs2=this._csScreen();
        const usedCols=new Set(this._tokens.filter(t=>t.y!=null && t.y<cs2).map(t=>Math.round(t.x/cs2 - 0.5)));
        let col=0; while(usedCols.has(col))col++;
        const newX=(col + 0.5)*cs2, newY=cs2/2;
        this._tokens.push({id:uid(),label:p.name,x:newX,y:newY,isPC:true,color:'#696969',size:1,dead:false,icon:p.icon||'⚔',portrait:p.portrait||null});
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
      const newScale = parseFloat(e.target.value);
      this._isFitted = false;
      this._scaleTokensTo(newScale);
      this._bgMapScale = newScale;
      this._applyZoomTransform(newScale);
      const pct = b.querySelector('#map-bg-scale-pct');
      if (pct) pct.textContent = Math.round(newScale*100)+'%';
    });
    b.querySelector('#map-bg-scale')?.addEventListener('change',()=>{
      // Persist on release. _applyZoomTransform during the drag already kept
      // every visual layer in sync.
      this._saveMap();
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
      const rect = drawCanvas.getBoundingClientRect();
      const x = Math.round(e.clientX - rect.left);
      const y = Math.round(e.clientY - rect.top);

      if (this._tool === 'erase'){
        e.preventDefault(); e.stopPropagation();
        // Erase any stroke under the click. If nothing is hit, fall through
        // (return) — token erasing is handled by token mousedown handlers.
        let removed = this._eraseStrokeAt(x, y);
        // Drag-to-erase: keep removing strokes the cursor passes over.
        const onMove = ev => {
          const mx = Math.round(ev.clientX - rect.left);
          const my = Math.round(ev.clientY - rect.top);
          if (this._eraseStrokeAt(mx, my)) removed = true;
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
        const x2 = Math.round(ev.clientX - rect.left);
        const y2 = Math.round(ev.clientY - rect.top);
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
    b.querySelector('#map-bg-color')?.addEventListener('change',e=>{this._bgColor=e.target.value;this._applyBg(stage,W,H);this._saveMap();});
    // Update stage cursor when fog tool active
    if(this._fogTool || this._tool==='align') stage.style.cursor='crosshair';
    else stage.style.cursor='default';

    // Canvas click = place token when in add-pc/add-npc mode
    canvas.addEventListener('click',e=>{
      if(this._drag?.moved) return;
      const r=canvas.getBoundingClientRect();
      let cx=e.clientX-r.left, cy=e.clientY-r.top;
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
          nx = Math.max(1, Math.round(nx || 1));
          ny = Math.max(1, Math.round(ny || 1));
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
      const r=canvas.getBoundingClientRect();
      const radius=this._fogRadius||1;
      const mode  = this._fogPaintMode  || 'reveal';
      const shape = this._fogBrushShape || 'square';
      // Free mode — record a pixel-level stroke in cell-fraction coords so it
      // survives zoom. The fog canvas redraw paints these on top of the
      // cell-based reveal pass.
      if ((this._fogBrushMode || 'grid') === 'free'){
        const xc = (e.clientX - r.left) / cs;
        const yc = (e.clientY - r.top)  / cs;
        // Free brush radius (in cells): matches grid coverage roughly —
        // radius=1 → 0.5 cell radius (1-cell diameter), radius=5 → 4.5 cell radius.
        const rCells = Math.max(0.25, radius - 0.5);
        this._fogStrokes.push({xc, yc, r:rCells, op:mode, shape});
        // Repaint locally every move so the DM gets immediate feedback.
        // Defer the broadcast until mouseup (handled below) to avoid
        // hammering BroadcastChannel/Firebase at 60fps with full payloads.
        this._drawFog();
        this._fogStrokeDirty = true;
        return;
      }
      // Grid mode — snap to cells. Optional circle shape skips corner cells
      // outside (radius - 0.5)² distance from the brush center.
      const gx=Math.floor((e.clientX-r.left)/cs);
      const gy=Math.floor((e.clientY-r.top)/cs);
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
      if(changed){this._drawFog();this._broadcast();}
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
        const rr = canvas.getBoundingClientRect();
        const cell = this._cellAtPx(e.clientX - rr.left, e.clientY - rr.top);
        const prev = this._hoverCell;
        const same = prev && cell && (
          (cell.col!=null && prev.col===cell.col && prev.row===cell.row) ||
          (cell.q!=null   && prev.q===cell.q     && prev.r===cell.r)
        );
        if (!same){
          this._hoverCell = cell;
          this._drawGrid(canvas, this._csScreen());
        }
      }
    });
    canvas.addEventListener('mouseleave',()=>{
      if (this._cellHighlight && this._hoverCell){
        this._hoverCell = null;
        this._drawGrid(canvas, this._csScreen());
      }
    });
    document.addEventListener('mouseup',()=>{
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
    });

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
      const oldScale = this._bgMapScale || 1;
      const factor = e.deltaY < 0 ? 1.1 : (1/1.1);
      const newScale = Math.max(0.1, Math.min(3, oldScale * factor));
      if (newScale === oldScale) return;

      const rect = scrollEl.getBoundingClientRect();
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      // Image-space point under cursor before zoom
      const imgX = (scrollEl.scrollLeft + cx) / oldScale;
      const imgY = (scrollEl.scrollTop  + cy) / oldScale;

      this._bgMapScale = newScale;
      this._isFitted = false; // manual zoom — panel resize should not re-fit
      // Update token positions in lockstep so they stay anchored to the map
      // during the wheel spin.
      this._scaleTokensTo(newScale);

      // Comprehensive in-place update: resize stage + every canvas + redraw
      // the grid, strokes, fog, tokens. No innerHTML thrash, so the zoom is
      // fluid and there's no settle-flicker when the wheel timer fires.
      this._applyZoomTransform(newScale);
      scrollEl.scrollLeft = imgX * newScale - cx;
      scrollEl.scrollTop  = imgY * newScale - cy;
      const slider = b.querySelector('#map-bg-scale'); if (slider) slider.value = newScale;
      const pct    = b.querySelector('#map-bg-scale-pct'); if (pct) pct.textContent = Math.round(newScale*100)+'%';

      // Just persist the new state on settle — no full _render needed since
      // every visual layer was already updated above.
      clearTimeout(_wheelTimer);
      _wheelTimer = setTimeout(() => { this._saveMap(); }, 180);
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
          startScale: this._bgMapScale || 1,
          anchorX: mid.x, anchorY: mid.y,
          // Image-space point under the pinch center, captured at the start
          imgX: (scrollEl.scrollLeft + mid.x) / (this._bgMapScale || 1),
          imgY: (scrollEl.scrollTop  + mid.y) / (this._bgMapScale || 1),
        };
        this._isFitted = false;
      }
    }, { passive: false });
    scrollEl.addEventListener('touchmove', e => {
      if (_touchPinch && e.touches.length === 2){
        e.preventDefault();
        const dist = touchDistance(e.touches[0], e.touches[1]);
        const ratio = dist / _touchPinch.startDist;
        const newScale = Math.max(0.1, Math.min(3, _touchPinch.startScale * ratio));
        if (!_mapBgImage) return;
        this._bgMapScale = newScale;
        this._scaleTokensTo(newScale);
        // Same in-place comprehensive update as the wheel path.
        this._applyZoomTransform(newScale);
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
        // Persist the new scale. No full _render — _applyZoomTransform during
        // the pinch already updated every visual layer.
        this._saveMap();
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
      // Compute drop position in stage coordinates.
      const stageEl = b.querySelector('#map-stage');
      const sr = stageEl.getBoundingClientRect();
      // On-screen cell size — scales with zoom so snap and bounds match the
      // visible grid.
      const cs2 = this._csScreen();
      let x = e.clientX - sr.left;
      let y = e.clientY - sr.top;
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
        // versions under bestiary/tokens/<source>/ — we mirror the path
        // mapping the Bestiary panel itself uses. Falls back to the existing
        // portrait field, then to the class-icon glyph.
        const tokenImg = m.img ? 'img/' + m.img.replace(/^bestiary\//, 'bestiary/tokens/') : null;
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
      if (k === 'fog-reveal'){ this._fogPaintMode = 'reveal'; this._fogTool = true; this._saveMap(); this._render(); return; }
      if (k === 'fog-hide'){   this._fogPaintMode = 'hide';   this._fogTool = true; this._saveMap(); this._render(); return; }
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
      if (k === 'grid-square'){ this._gridType = 'square'; this._showGrid = true;  this._saveMap(); this._render(); return; }
      if (k === 'grid-hex'){    this._gridType = 'hex';    this._showGrid = true;  this._saveMap(); this._render(); return; }
      if (k === 'grid-none'){   this._gridType = 'none';   this._showGrid = false; this._saveMap(); this._render(); return; }
      if (k === 'grid-cell'){   this._cellHighlight = !this._cellHighlight; if (!this._cellHighlight) this._hoverCell = null; this._saveMap(); this._render(); return; }
      if (k === 'fog-mode-grid' || k === 'fog-mode-free'){
        this._fogBrushMode = k === 'fog-mode-free' ? 'free' : 'grid';
        this._saveMap(); this._render(); return;
      }
      if (k === 'fog-shape-square' || k === 'fog-shape-circle'){
        this._fogBrushShape = k === 'fog-shape-circle' ? 'circle' : 'square';
        this._saveMap(); this._render(); return;
      }
      if (k === 'tok-all'){   this._tokensVisible = !this._tokensVisible; this._saveMap(); this._render(); return; }
      if (k === 'tok-names'){ this._namesVisible  = !this._namesVisible;  this._saveMap(); this._render(); return; }
      if (k === 'tok-pcs'){   this._pcsVisible    = !this._pcsVisible;    this._saveMap(); this._render(); return; }
      if (k === 'tok-npcs'){  this._npcsVisible   = !this._npcsVisible;   this._saveMap(); this._render(); return; }
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
          <input id="mapsel-search" type="search" autocomplete="off" placeholder="🔎 Search maps across every adventure…"
            style="flex:1;background:var(--panel-2);border:1px solid var(--border);color:var(--text);padding:7px 9px;border-radius:5px;font-size:12px">
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
          <input id="mapsel-adv-filter" type="search" autocomplete="off" placeholder="Filter adventures…"
            style="width:170px;background:var(--panel-2);border:1px solid var(--border);color:var(--text);padding:7px 9px;border-radius:5px;font-size:12px">
          <select id="mapsel-adv" disabled
            style="flex:1;background:var(--panel-2);border:1px solid var(--border);color:var(--text);padding:7px 9px;border-radius:5px;font-size:12px">
            <option value="">Loading adventures…</option>
          </select>
        </div>
        <div id="mapsel-grid" class="mapsel-grid"></div>
      </div>
      <div class="modal-actions" style="margin-top:10px">
        ${(this._bgMapPath || _mapBgImage || (this._tokens||[]).length) ? '<button class="btn" id="mapsel-save">💾 Save current as…</button>' : ''}
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
        // Replace any existing entry with the same case-insensitive name so
        // re-saving overwrites instead of cluttering the list.
        const lc = name.toLowerCase();
        this._savedMaps = this._savedMaps.filter(s => (s.name||'').toLowerCase() !== lc);
        this._savedMaps.unshift({
          id: 'map_' + (typeof uid === 'function' ? uid() : Date.now().toString(36)),
          name,
          ts: Date.now(),
          snapshot: this._snapshotMap(),
        });
        // Cap library so quota doesn't creep over time. Saved-map snapshots
        // can be 20-50 KB each with lots of tokens/fog; 40 caps the list at
        // about 1-2 MB worst case.
        if (this._savedMaps.length > 40) this._savedMaps.length = 40;
        this._saveSavedMaps();
        close();
        if (typeof showToast === 'function') showToast('Saved "' + name + '"');
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
        grid.innerHTML = '<div style="grid-column:1/-1;padding:20px;text-align:center;color:var(--text-muted);font-size:12px">'+(opts.emptyMsg||'No maps.')+'</div>';
        return;
      }
      const starred = this._starredMaps || new Set();
      grid.innerHTML = cards.map(m=>{
        const tokenSrc = 'img/'+m.path;
        const subtitle = opts.showAdv && m.advName ? `<div class="mapsel-sub">${esc(m.advName)}</div>` : '';
        const isStarred = starred.has(m.path);
        return `<div class="mapsel-card${isStarred?' starred':''}" data-path="${esc(m.path)}" title="${esc(m.title)}${m.advName?' — '+esc(m.advName):''}">
          <button class="mapsel-star ${isStarred?'on':''}" data-mapsel-star="${esc(m.path)}" title="${isStarred?'Unstar':'Star (quick-access)'}">${isStarred?'★':'☆'}</button>
          <img src="${esc(tokenSrc)}" loading="lazy" alt="${esc(m.title)}" onerror="this.style.opacity=.3">
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
        grid.innerHTML = '<div style="grid-column:1/-1;padding:20px;text-align:center;color:var(--text-muted);font-size:12px">Loading maps…</div>';
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
        grid.innerHTML = '<div style="grid-column:1/-1;padding:20px;text-align:center;color:var(--text-muted);font-size:12px">Indexing every adventure for search…</div>';
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
      const url = this._bgMapPath ? `img/${this._bgMapPath}` : _mapBgImage.src;
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
    const ctx=canvas.getContext('2d');
    const W=this._cols*cs, H=this._rows*cs;
    // Make sure canvas is sized correctly (fixes black area when resizing)
    canvas.width=W; canvas.height=H;
    ctx.clearRect(0,0,W,H);

    const gt = this._gridType || (this._showGrid ? 'square' : 'none');

    // Grid hidden — still keep the canvas sized, paint the optional hover
    // highlight, then let fog draw on top.
    if (gt === 'none' || !this._showGrid){
      if (this._cellHighlight) this._drawCellHighlight(ctx, cs, gt);
      this._drawFog();
      return;
    }

    // Per-user grid opacity (0–100 from the sidebar). Scales the base alpha.
    const op = (this._gridOpacity != null ? this._gridOpacity : 60) / 100;

    // Determine if background is light or dark for adaptive grid color
    let gridColor='rgba(255,255,255,'+(0.18*op).toFixed(3)+')';
    if(_mapBgImage){
      // Sample corners of the image to estimate brightness
      const off=document.createElement('canvas');off.width=4;off.height=4;
      const octx=off.getContext('2d');octx.drawImage(_mapBgImage,0,0,4,4);
      try{
        const d=octx.getImageData(0,0,4,4).data;
        let lum=0;for(let i=0;i<d.length;i+=4)lum+=(d[i]*299+d[i+1]*587+d[i+2]*114)/1000;
        lum/=16;
        gridColor=lum>128?'rgba(0,0,0,'+(0.35*op).toFixed(3)+')':'rgba(255,255,255,'+(0.25*op).toFixed(3)+')';
      }catch(e){}
    } else {
      // Parse bgColor hex to check brightness
      const hex=this._bgColor.replace('#','');
      if(hex.length===6){
        const r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),bv=parseInt(hex.slice(4,6),16);
        const lum=(r*299+g*587+bv*114)/1000;
        gridColor=lum>128?'rgba(0,0,0,'+(0.4*op).toFixed(3)+')':'rgba(255,255,255,'+(0.18*op).toFixed(3)+')';
      }
    }

    ctx.strokeStyle=gridColor;
    ctx.lineWidth=1;
    // Offsets are stored in image-pixel space; convert to on-screen pixels.
    const scale = _mapBgImage ? (this._bgMapScale || 1) : 1;
    const offX = (((this._gridOffsetX || 0) * scale) % cs + cs) % cs;
    const offY = (((this._gridOffsetY || 0) * scale) % cs + cs) % cs;

    if (gt === 'hex'){
      this._drawHexGrid(ctx, cs, W, H, offX, offY);
    } else {
      for (let x = offX; x <= W + .01; x += cs){
        ctx.beginPath(); ctx.moveTo(Math.round(x)+.5, 0); ctx.lineTo(Math.round(x)+.5, H); ctx.stroke();
      }
      for (let y = offY; y <= H + .01; y += cs){
        ctx.beginPath(); ctx.moveTo(0, Math.round(y)+.5); ctx.lineTo(W, Math.round(y)+.5); ctx.stroke();
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

  _drawFog(){
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
    fogCanvas.width=W;fogCanvas.height=H;
    const ctx=fogCanvas.getContext('2d');
    ctx.clearRect(0,0,W,H);
    if(this._fog===null)return; // fog disabled
    // DM view: translucent so the DM can still see the map through the fog.
    // Player view: fully opaque — players shouldn't see anything in unrevealed
    // cells. Detected via the body class set by initPlayerView().
    const isPlayer = document.body.classList.contains('player-mode');
    ctx.fillStyle = isPlayer ? 'rgba(0,0,0,1)' : 'rgba(0,0,0,0.55)';
    ctx.fillRect(0,0,W,H);
    // Cut out revealed cells fully
    ctx.globalCompositeOperation='destination-out';
    ctx.fillStyle='rgba(0,0,0,1)';
    this._fog.forEach(key=>{
      const [gx,gy]=key.split(',').map(Number);
      ctx.fillRect(gx*cs,gy*cs,cs,cs);
    });
    // Free-mode strokes — two passes: reveals (destination-out, punches more
    // holes) then hides (source-over, repaints fog over previously revealed
    // areas). Stroke coords are in cell fractions, scaled to the current cs.
    const strokes = this._fogStrokes || [];
    const stamp = (s, alpha) => {
      const x = s.xc * cs, y = s.yc * cs, rad = s.r * cs;
      if (s.shape === 'circle'){
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI*2); ctx.fill();
      } else {
        ctx.fillRect(x - rad, y - rad, rad*2, rad*2);
      }
    };
    // Reveal pass
    strokes.forEach(s => { if (s.op === 'reveal') stamp(s); });
    // Hide pass — repaint fog at the same opacity as the base layer.
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle = isPlayer ? 'rgba(0,0,0,1)' : 'rgba(0,0,0,0.55)';
    strokes.forEach(s => { if (s.op === 'hide') stamp(s); });
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
      + slider('opacity',  'Opacity',   this._gridOpacity, '%', 0, 100)

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
    stage.querySelectorAll('.map-token, .map-token-name').forEach(el=>el.remove());

    const tokScale = this._bgMapScale || 1;
    const csNat = this._cellSize;
    // Player view: hide non-PC tokens that sit in unrevealed cells. The DM
    // sees everything regardless. Fog set is keyed by "gx,gy" — derive cell
    // from the token's pixel center.
    const isPlayer = document.body.classList.contains('player-mode');
    const fogSet = this._fog;
    this._tokens.forEach(t=>{
      const size=t.size||1;
      // Tokens store pixel coordinates (center). Default to middle of stage
      // for any token that's somehow missing them (shouldn't happen post-migration).
      if (t.x == null) t.x = cs * size / 2;
      if (t.y == null) t.y = cs * size / 2;
      if (isPlayer && fogSet && !t.isPC){
        const gx = Math.floor(t.x / cs);
        const gy = Math.floor(t.y / cs);
        if (!fogSet.has(gx+','+gy)) return; // cell still fogged → hide from player
      }
      const px=t.x;
      const py=t.y;
      // Visual diameter scales with the bg image so tokens stay proportional
      // to the map at any zoom level.
      const dim=(size*csNat-4) * tokScale;

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
        // Floor at 14px so the glyph stays readable when the map is zoomed far out.
        fontSize = Math.max(14, dim * 0.6);
      } else {
        fontSize = (size > 1 ? 13 : Math.max(8, 11 - (displayLabel.length > 5 ? 2 : 0))) * tokScale;
      }
      el.style.cssText=`left:${px}px;top:${py}px;width:${dim}px;height:${dim}px;background:${t.color};font-size:${fontSize.toFixed(1)}px;position:absolute;transform:translate(-50%,-50%);z-index:2;border-radius:50%;border:2px solid rgba(212,165,116,0.8);display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;font-weight:600;color:#fff;text-align:center;line-height:1.1;overflow:hidden;box-sizing:border-box`;
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
        stage.appendChild(facing);
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
      const nameFs = Math.max(11, 10 * tokScale);
      nameEl.style.cssText = `left:${px}px;top:${py + dim/2 + 4}px;font-size:${nameFs.toFixed(1)}px;position:absolute;transform:translateX(-50%);z-index:2;pointer-events:none;color:#fff;background:rgba(0,0,0,.6);padding:1px 6px;border-radius:8px;text-shadow:0 1px 2px rgba(0,0,0,0.9);white-space:nowrap;font-weight:600;line-height:1.25`;
      nameEl.textContent = displayLabel;
      stage.appendChild(nameEl);

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
        // Drag anchor lives on this._drag (not in the closure) so
        // _scaleTokensTo() can rescale it when the user zooms mid-drag.
        // A pure-closure copy would go stale: t.x/t.y get multiplied by the
        // new zoom ratio while the closure's startPx/startPy don't,
        // teleporting the token on the next mousemove.
        this._drag = { moved:false, startPx:t.x, startPy:t.y };

        const onMove=ev=>{
          // Token positions are stored in stage-pixel coords, but the cursor
          // delta comes back in screen pixels. The workspace-canvas has a
          // CSS transform: scale(zoom), so one stage pixel == `zoom` screen
          // pixels. Divide the delta by zoom to keep the token under the
          // cursor at any zoom level.
          const z = (typeof getZoom === 'function') ? getZoom() : 1;
          const dx=(ev.clientX-startX)/z, dy=(ev.clientY-startY)/z;
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
            const half = (size*cs/2) * (this._bgMapScale || 1);
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
          // Same zoom-correction as the mouse drag handler above.
          const z = (typeof getZoom === 'function') ? getZoom() : 1;
          const dx = (tt.clientX-startX)/z, dy = (tt.clientY-startY)/z;
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
            const half = (size*cs/2) * (this._bgMapScale || 1);
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

      stage.appendChild(el);
    });
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
    source.forEach((c,i)=>{
      const name=c.name||c.label;
      if(!this._tokens.find(t=>t.label===name&&t.isPC)){
        // Lay them out on a virtual top-row grid using cellSize as spacing.
        const col = i % this._cols, row = Math.floor(i / this._cols);
        const x = (col + 0.5) * cs, y = (row + 0.5) * cs;
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
