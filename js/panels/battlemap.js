// ============================================================
// BATTLE MAP PANEL
// ============================================================
// Image stored in memory only — never localStorage (avoids freeze/quota)
let _mapBgImage = null; // holds the Image object

registerPanel('battlemap',{
  title:'Battle Map',icon:'🗺',
  _tokens:[], _tool:'', _selected:null,
  _cellSize:50, _cols:24, _rows:18,
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

  mount(body){
    this._body=body;
    try{
      const raw=localStorage.getItem('skt-battlemap-v1');
      if(raw){const d=JSON.parse(raw);this._tokens=d.tokens||[];this._cellSize=d.cellSize||50;this._cols=d.cols||24;this._rows=d.rows||18;this._bgColor=d.bgColor||'#1a2a1a';
        if(d.fog){this._fog=new Set(d.fog);}else{this._fog=null;}
        this._bgMapPath = d.bgMapPath || null;
        this._showGrid = d.showGrid !== false; // default on
        this._bgMapScale = d.bgMapScale || 1;
        this._snapToGrid = !!d.snapToGrid;
        this._gridOffsetX = d.gridOffsetX || 0;
        this._gridOffsetY = d.gridOffsetY || 0;
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
      localStorage.setItem('skt-battlemap-v1',JSON.stringify({tokens:this._tokens,cellSize:this._cellSize,cols:this._cols,rows:this._rows,bgColor:this._bgColor,fog:fogArr,bgMapPath:this._bgMapPath,showGrid:this._showGrid,bgMapScale:this._bgMapScale,snapToGrid:this._snapToGrid,drawings:this._drawings,gridOffsetX:this._gridOffsetX,gridOffsetY:this._gridOffsetY}));
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
  _scaleTokensTo(newScale){
    const old = this._lastTokenScale != null ? this._lastTokenScale : (this._bgMapScale || 1);
    if (!newScale || !old || newScale === old) { this._lastTokenScale = newScale || old; return; }
    const ratio = newScale / old;
    this._tokens.forEach(t => {
      if (t.x != null) t.x *= ratio;
      if (t.y != null) t.y *= ratio;
    });
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
    b.querySelectorAll('.map-token').forEach(el => {
      const t = this._tokens.find(x => x.id === el.dataset.tid);
      if (!t || t.x == null) return;
      el.style.left = t.x + 'px';
      el.style.top  = t.y + 'px';
      const sz = t.size || 1;
      const dim = (sz * csNat - 4) * scale;
      const fontSize = (sz > 1 ? 13 : Math.max(8, 11 - (t.label.length > 5 ? 2 : 0))) * scale;
      el.style.width  = dim + 'px';
      el.style.height = dim + 'px';
      el.style.fontSize = fontSize + 'px';
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
      this._bc.onmessage = ev => {
        if (!isPlayer) return; // DM tab only sends; ignore its own echoes
        const msg = ev.data; if (!msg) return;
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
        this._fog = msg.fog ? new Set(msg.fog) : null;
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
        // Lightweight repaint — fog + tokens only. No flicker.
        if (this._body){
          this._drawFog();
          this._renderTokens();
        }
      };
    }catch(e){}
  },
  _stopBroadcast(){try{this._bc?.close();}catch(e){}},

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
        bgImageData: _mapBgImage?'present':null,
        bgMapPath: this._bgMapPath,
      });
    }catch(e){}
  },

  _render(){
    const b=this._body;if(!b)return;
    // Snapshot scroll before innerHTML reset so wheel-zoom / slider release /
    // any other re-render doesn't snap the view back to the top-left.
    const oldScroll = b.querySelector('#map-scroll');
    const savedSx = oldScroll ? oldScroll.scrollLeft : 0;
    const savedSy = oldScroll ? oldScroll.scrollTop  : 0;
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
      +'<button class="btn '+(this._showGrid?'active':'')+'" data-mact="toggle-grid" style="flex-shrink:0" title="Show/hide grid overlay">⊞ Grid</button>'
      +'<button class="btn '+(this._snapToGrid?'active':'')+'" data-mact="toggle-snap" style="flex-shrink:0" title="Snap tokens to grid on drop (Shift inverts)">🧲 Snap</button>'
      +(_mapBgImage?'<button class="btn '+(this._tool==='align'?'active':'')+'" data-mact="tool-align" style="flex-shrink:0" title="Align grid to printed map grid: click two opposite corners of one cell">📐 Align</button>':'')
      +((this._gridOffsetX||this._gridOffsetY)?'<button class="btn" data-mact="reset-align" style="flex-shrink:0" title="Reset grid alignment (offset back to 0,0)">↺</button>':'')
      +'<div style="flex:1"></div>'
      +'<button class="btn" data-mact="sync-combat" style="flex-shrink:0">↺ Sync</button>'
      +'<button class="btn danger" data-mact="clear-tokens" style="flex-shrink:0">Clear</button>'
      +'<button class="btn" data-mact="clear-draw" style="flex-shrink:0" title="Clear all drawings">🗑 Drawings</button>'
      // Fog of war + open-player launch — DM-only.
      +'<div style="width:1px;background:var(--border);height:18px;margin:0 2px;flex-shrink:0"></div>'
      +'<button class="btn '+(this._fog!==null?'active':'')+'" data-mact="fog-toggle" style="flex-shrink:0" title="Toggle Fog of War">🌫 Fog</button>'
      +(this._fog!==null?'<button class="btn '+(this._fogTool?'active':'')+'" data-mact="fog-paint" style="flex-shrink:0" title="Paint to reveal fog">🖌 Reveal</button>':'')
      +(this._fog!==null&&this._fogTool?'<input type="range" id="fog-radius" min="1" max="5" value="'+(this._fogRadius||1)+'" style="width:60px;flex-shrink:0" title="Brush size">':'')
      +(this._fog!==null?'<button class="btn" data-mact="fog-hide-all" style="flex-shrink:0" title="Hide everything">◼ Hide All</button>':'')
      +(this._fog!==null?'<button class="btn" data-mact="fog-show-all" style="flex-shrink:0" title="Reveal everything">◻ Show All</button>':'')
      +'<div style="width:1px;background:var(--border);height:18px;margin:0 2px;flex-shrink:0"></div>'
      +'<button class="btn" data-mact="open-player" style="flex-shrink:0" title="Open player view in new tab">📺 Player View</button>'
    +'</div>';

    // The "Party:" quick-add row is DM-only (lets the DM drop PCs onto the
    // map). Players already see the placed tokens via sync.
    if (partyBtns && !_isPlayer){
      html+='<div style="display:flex;gap:4px;padding:4px 8px;border-bottom:1px solid var(--border);background:var(--panel-2);flex-wrap:wrap;align-items:center">'
        +'<span style="font-size:10px;color:var(--text-muted)">Party:</span>'+partyBtns+'</div>';
    }
    } // end !_toolbarHidden

    html+='<div id="map-scroll" style="flex:1;overflow:auto;background:#111;position:relative">'
      +'<div id="map-stage" style="position:relative;display:inline-block">'
        +'<canvas id="map-canvas" style="display:block;position:relative;z-index:1"></canvas>'
      +'</div>'
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
      +'<input type="number" id="tp-size" min="1" max="6" value="1" style="margin-bottom:8px;font-size:11px">'
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
          showToast('Click two opposite corners of one cell on the printed grid.');
        }
        // Full re-render so the toolbar reveals/hides tool-specific controls
        // (e.g. the draw color/size pickers) AND the draw canvas's
        // pointer-events flag flips with the new tool state. Without this the
        // pencil tool can't catch clicks because the canvas above it stays
        // pointer-events:none.
        this._render();
      }
      else if(act==='sync-combat') this._syncParty();
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
      else if(act==='toggle-grid'){this._showGrid=!this._showGrid;this._saveMap();this._render();}
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
        this._tokens.push({id:uid(),label:p.name,x:newX,y:newY,isPC:true,color:'#696969',size:1,dead:false});
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
      const onMove = ev => {
        if (!_curStroke) return;
        const x2 = Math.round(ev.clientX - rect.left);
        const y2 = Math.round(ev.clientY - rect.top);
        const lp = _curStroke.p;
        const lx = lp[lp.length-2], ly = lp[lp.length-1];
        if (Math.abs(x2 - lx) + Math.abs(y2 - ly) < 3) return; // sample-down
        lp.push(x2, y2);
        this._drawStrokeIncremental(drawCanvas, _curStroke);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        _curStroke = null;
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
          if (typeof showToast === 'function') showToast('Now click the opposite corner of the same cell.');
          return;
        }
        const a = this._alignFirstClick;
        const dxImg = Math.abs(ix - a.ix), dyImg = Math.abs(iy - a.iy);
        // Average so the user can pick imperfectly opposite corners. Round
        // to integer pixels for a clean cellSize.
        const newCs = Math.max(8, Math.round((dxImg + dyImg) / 2));
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
        if (typeof showToast === 'function') showToast('Grid aligned: ' + newCs + 'px cells');
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

    // Fog painting — mousedown + drag
    const fogPaint=(e)=>{
      if(!this._fogTool||this._fog===null)return;
      const r=canvas.getBoundingClientRect();
      const gx=Math.floor((e.clientX-r.left)/cs);
      const gy=Math.floor((e.clientY-r.top)/cs);
      const radius=this._fogRadius||1;
      let changed=false;
      for(let dx=-radius+1;dx<radius;dx++){
        for(let dy=-radius+1;dy<radius;dy++){
          const nx=gx+dx, ny=gy+dy;
          if(nx>=0&&ny>=0&&nx<this._cols&&ny<this._rows){
            const key=nx+','+ny;
            if(!this._fog.has(key)){this._fog.add(key);changed=true;}
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
    });
    document.addEventListener('mouseup',()=>{
      if(this._isPainting){this._isPainting=false;this._saveMap();}
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
        this._tokens.push({id:uid(), label:p.name, x, y, isPC:true, color:'#696969', size:1, dead:false});
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
        this._tokens.push({id:uid(), label:displayName, baseName:m.name, x, y, isPC:false, color:'#993333', size:1, dead:false});
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
  },

  // Map picker — adventures from data/adventures.json, maps extracted from
  // each adventure's JSON by walking for {type:'image', imageType:'map'|'mapPlayer'}.
  // Per-adventure JSON is fetched lazily on first selection and cached.
  async _openMapPicker(){
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="width:680px;max-width:92vw">
      <h3>Choose a Map</h3>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <input id="mapsel-search" type="search" autocomplete="off" placeholder="🔎 Search maps across every adventure…"
          style="flex:1;background:var(--panel-2);border:1px solid var(--border);color:var(--text);padding:7px 9px;border-radius:5px;font-size:12px">
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
        <input id="mapsel-adv" list="mapsel-adv-list" autocomplete="off" placeholder="Loading adventures…" disabled
          style="flex:1;background:var(--panel-2);border:1px solid var(--border);color:var(--text);padding:7px 9px;border-radius:5px;font-size:12px">
        <datalist id="mapsel-adv-list"></datalist>
      </div>
      <div id="mapsel-grid" class="mapsel-grid"></div>
      <div class="modal-actions" style="margin-top:10px">
        ${this._bgMapPath ? '<button class="btn danger" id="mapsel-clear">Clear current map</button>' : ''}
        <button class="btn" id="mapsel-close">Close</button>
      </div>
    </div>`;
    document.body.appendChild(backdrop);

    const searchInput = backdrop.querySelector('#mapsel-search');
    const sel = backdrop.querySelector('#mapsel-adv');
    const grid = backdrop.querySelector('#mapsel-grid');
    const close = ()=>backdrop.remove();
    backdrop.querySelector('#mapsel-close').addEventListener('click', close);
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

    const dlist = backdrop.querySelector('#mapsel-adv-list');

    // Load the adventure manifest once, sort, populate datalist.
    if (!this._adventures){
      try {
        const res = await fetch('data/adventures.json');
        const j = await res.json();
        this._adventures = (j.adventure || []).slice().sort((a,b)=>a.name.localeCompare(b.name));
      } catch(e) {
        sel.placeholder = 'Failed to load adventures';
        return;
      }
    }
    // Datalist option label = display name. Also include the id in parentheses
    // so duplicates (rare, but possible) stay disambiguated.
    dlist.innerHTML = this._adventures
      .map(a=>`<option value="${esc(a.name)} (${esc(a.id)})"></option>`).join('');
    sel.disabled = false;
    sel.placeholder = 'Or pick an adventure…';
    searchInput.focus();

    // Resolve "Lost Mine of Phandelver (LMoP)" → adventure id "LMoP". Falls
    // back to a name-only match for users who hand-type without the id.
    const resolveAdv = (typed) => {
      if (!typed) return null;
      const m = typed.match(/\(([^)]+)\)\s*$/);
      if (m){
        const found = this._adventures.find(a => a.id === m[1]);
        if (found) return found;
      }
      return this._adventures.find(a => a.name.toLowerCase() === typed.toLowerCase()) || null;
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
      grid.innerHTML = cards.map(m=>{
        const tokenSrc = 'img/'+m.path;
        const subtitle = opts.showAdv && m.advName ? `<div class="mapsel-sub">${esc(m.advName)}</div>` : '';
        return `<div class="mapsel-card" data-path="${esc(m.path)}" title="${esc(m.title)}${m.advName?' — '+esc(m.advName):''}">
          <img src="${esc(tokenSrc)}" loading="lazy" alt="${esc(m.title)}" onerror="this.style.opacity=.3">
          <div class="mapsel-title">${esc(m.title)}</div>
          ${subtitle}
          <span class="mapsel-badge ${esc(m.type)}">${m.type==='mapPlayer'?'Player':'DM'}</span>
        </div>`;
      }).join('');
      grid.querySelectorAll('.mapsel-card').forEach(card=>{
        card.addEventListener('click', ()=>{
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
    };

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
    // 'change' fires on blur or when the user picks a suggestion from the
    // datalist dropdown. 'input' covers the case where typing produces an
    // exact match — without it, picking from the dropdown via mouse-click in
    // some browsers doesn't reliably fire 'change' until they tab away.
    sel.addEventListener('change', handlePick);
    sel.addEventListener('input', () => {
      // Only resolve if the typed value matches an adventure exactly — that's
      // the case where the user picked from the suggestion list. Otherwise
      // wait for them to keep typing.
      if (resolveAdv(sel.value.trim())) handlePick();
    });
  },

  _applyBg(stage,W,H){
    if (_mapBgImage && this._bgMapPath){
      // Render the image at natural × scale — never stretch. The grid was
      // already grown to cover this size in _fitGridToBg.
      const scale = this._bgMapScale || 1;
      const dispW = (this._bgMapNaturalW || _mapBgImage.naturalWidth) * scale;
      const dispH = (this._bgMapNaturalH || _mapBgImage.naturalHeight) * scale;
      stage.style.backgroundImage = `url('img/${this._bgMapPath}')`;
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

    // Grid hidden — still keep the canvas sized and let fog draw on top.
    if (!this._showGrid){ this._drawFog(); return; }

    // Determine if background is light or dark for adaptive grid color
    let gridColor='rgba(255,255,255,0.18)';
    if(_mapBgImage){
      // Sample corners of the image to estimate brightness
      const off=document.createElement('canvas');off.width=4;off.height=4;
      const octx=off.getContext('2d');octx.drawImage(_mapBgImage,0,0,4,4);
      try{
        const d=octx.getImageData(0,0,4,4).data;
        let lum=0;for(let i=0;i<d.length;i+=4)lum+=(d[i]*299+d[i+1]*587+d[i+2]*114)/1000;
        lum/=16;
        gridColor=lum>128?'rgba(0,0,0,0.35)':'rgba(255,255,255,0.25)';
      }catch(e){}
    } else {
      // Parse bgColor hex to check brightness
      const hex=this._bgColor.replace('#','');
      if(hex.length===6){
        const r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),bv=parseInt(hex.slice(4,6),16);
        const lum=(r*299+g*587+bv*114)/1000;
        gridColor=lum>128?'rgba(0,0,0,0.4)':'rgba(255,255,255,0.18)';
      }
    }

    ctx.strokeStyle=gridColor;
    ctx.lineWidth=1;
    // Offsets are stored in image-pixel space; convert to on-screen pixels.
    const scale = _mapBgImage ? (this._bgMapScale || 1) : 1;
    const offX = (((this._gridOffsetX || 0) * scale) % cs + cs) % cs;
    const offY = (((this._gridOffsetY || 0) * scale) % cs + cs) % cs;
    for (let x = offX; x <= W + .01; x += cs){
      ctx.beginPath(); ctx.moveTo(Math.round(x)+.5, 0); ctx.lineTo(Math.round(x)+.5, H); ctx.stroke();
    }
    for (let y = offY; y <= H + .01; y += cs){
      ctx.beginPath(); ctx.moveTo(0, Math.round(y)+.5); ctx.lineTo(W, Math.round(y)+.5); ctx.stroke();
    }
    // Draw fog on top of grid
    this._drawFog();
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
    ctx.globalCompositeOperation='source-over';
  },

  _renderTokens(){
    const b=this._body;if(!b)return;
    const stage=b.querySelector('#map-stage');if(!stage)return;
    // For fog-cell mapping and default placement we want the on-screen cell
    // size (tokens are stored in stage-pixel coords). Visual diameter still
    // uses the natural cellSize × scale via tokScale below.
    const cs=this._csScreen();
    stage.querySelectorAll('.map-token').forEach(el=>el.remove());

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
      el.className=`map-token ${t.isPC?'pc':'npc-t'} ${t.dead?'dead':''} ${this._selected===t.id?'selected':''}`;
      el.dataset.tid=t.id;
      const fontSize=(size>1?13:Math.max(8,11-(t.label.length>5?2:0))) * tokScale;
      el.style.cssText=`left:${px}px;top:${py}px;width:${dim}px;height:${dim}px;background:${t.color};font-size:${fontSize}px;position:absolute;transform:translate(-50%,-50%);z-index:2;border-radius:50%;border:2px solid rgba(212,165,116,0.8);display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;font-weight:600;color:#fff;text-align:center;line-height:1.1;overflow:hidden;box-sizing:border-box`;
      el.textContent=t.label.length>7?t.label.slice(0,6)+'…':t.label;

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
          if(i>=0){this._tokens.splice(i,1);this._selected=null;this._closePanel();this._renderTokens();this._saveMap();}
          return;
        }

        // Highlight + select immediately (no panel — that's right-click only).
        stage.querySelectorAll('.map-token').forEach(tok=>tok.classList.remove('selected'));
        el.classList.add('selected');
        this._selected=t.id;

        const startX=e.clientX, startY=e.clientY;
        const startPx=px, startPy=py;
        let curPx=px, curPy=py;
        let moved=false;
        this._drag={moved:false};

        const onMove=ev=>{
          const dx=ev.clientX-startX, dy=ev.clientY-startY;
          if(!moved&&Math.abs(dx)<4&&Math.abs(dy)<4) return;
          moved=true;this._drag.moved=true;
          el.style.cursor='grabbing';
          curPx=startPx+dx; curPy=startPy+dy;
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
          if(i>=0){this._tokens.splice(i,1);this._selected=null;this._closePanel();this._renderTokens();this._saveMap();}
          return;
        }

        stage.querySelectorAll('.map-token').forEach(tok=>tok.classList.remove('selected'));
        el.classList.add('selected');
        this._selected=t.id;

        const startX=touch.clientX, startY=touch.clientY;
        const startPx=px, startPy=py;
        let curPx=px, curPy=py;
        let moved=false;
        let longPressFired=false;
        this._drag={moved:false};
        const longPressTimer = setTimeout(() => {
          if (moved) return;
          longPressFired = true;
          this._showPanel(t);
        }, 500);

        const onMove = ev => {
          if (ev.touches.length !== 1) return;
          const tt = ev.touches[0];
          const dx = tt.clientX-startX, dy = tt.clientY-startY;
          if (!moved && Math.abs(dx)<6 && Math.abs(dy)<6) return;
          moved = true; this._drag.moved = true;
          clearTimeout(longPressTimer);
          if (longPressFired) return; // already opened panel; ignore drag
          ev.preventDefault();
          curPx = startPx+dx; curPy = startPy+dy;
          el.style.left = curPx+'px';
          el.style.top  = curPy+'px';
        };
        const onEnd = ev => {
          clearTimeout(longPressTimer);
          document.removeEventListener('touchmove', onMove);
          document.removeEventListener('touchend', onEnd);
          document.removeEventListener('touchcancel', onEnd);
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
    rewire('#tp-label','change',e=>{t.label=e.target.value;b.querySelector('#tp-name').textContent=t.label;this._saveMap();this._renderTokens();});
    rewire('#tp-color','change',e=>{t.color=e.target.value;this._saveMap();this._renderTokens();});
    rewire('#tp-size','change',e=>{t.size=Math.max(1,Math.min(6,parseInt(e.target.value)||1));this._saveMap();this._renderTokens();});
    rewire('#tp-kill','click',()=>{t.dead=!t.dead;this._saveMap();this._renderTokens();});
    rewire('#tp-del','click',()=>{const i=this._tokens.findIndex(x=>x.id===t.id);if(i>=0)this._tokens.splice(i,1);this._selected=null;this._closePanel();this._renderTokens();this._saveMap();});
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
        this._tokens.push({id:uid(),label:name,x,y,isPC:true,color:'#696969',size:1,dead:(c.hp||0)<=0});
        placed++;
      }
    });
    this._renderTokens();this._saveMap();
    showToast(placed?`${placed} token(s) added`:'Party already placed');
  },
});
