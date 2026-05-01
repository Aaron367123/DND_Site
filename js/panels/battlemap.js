// ============================================================
// BATTLE MAP PANEL
// ============================================================
// Image stored in memory only — never localStorage (avoids freeze/quota)
let _mapBgImage = null; // holds the Image object

registerPanel('battlemap',{
  title:'Battle Map',icon:'🗺',
  _tokens:[], _tool:'', _selected:null,
  _cellSize:50, _cols:24, _rows:18,
  _bgColor:'#1a2a1a',
  _drag:null,
  // Fog of war: Set of "col,row" strings that are REVEALED
  _fog: null,        // null = fog disabled, Set = fog enabled
  _fogTool: false,   // true when in fog-paint mode
  _fogRadius: 1,     // brush radius in cells
  _isPainting: false,

  mount(body){
    this._body=body;
    try{
      const raw=localStorage.getItem('skt-battlemap-v1');
      if(raw){const d=JSON.parse(raw);this._tokens=d.tokens||[];this._cellSize=d.cellSize||50;this._cols=d.cols||24;this._rows=d.rows||18;this._bgColor=d.bgColor||'#1a2a1a';
        if(d.fog){this._fog=new Set(d.fog);}else{this._fog=null;}
      }
    }catch(e){}
    this._render();
    this._startBroadcast();
  },
  unmount(){this._saveMap();this._stopBroadcast();this._body=null;},

  _saveMap(){
    try{
      const fogArr=this._fog?Array.from(this._fog):null;
      localStorage.setItem('skt-battlemap-v1',JSON.stringify({tokens:this._tokens,cellSize:this._cellSize,cols:this._cols,rows:this._rows,bgColor:this._bgColor,fog:fogArr}));
    }catch(e){}
    this._broadcast();
  },

  // BroadcastChannel — lets a player view tab receive updates
  _bc: null,
  _startBroadcast(){
    try{
      this._bc=new BroadcastChannel('skt-battlemap');
      this._bc.onmessage=ev=>{
        // DM view ignores incoming — only sends
      };
    }catch(e){}
  },
  _stopBroadcast(){try{this._bc?.close();}catch(e){}},

  _broadcast(){
    try{
      if(!this._bc)return;
      const fogArr=this._fog?Array.from(this._fog):null;
      this._bc.postMessage({
        tokens:this._tokens, cellSize:this._cellSize,
        cols:this._cols, rows:this._rows,
        bgColor:this._bgColor, fog:fogArr,
        bgImageData: _mapBgImage?'present':null,
      });
    }catch(e){}
  },

  _render(){
    const b=this._body;if(!b)return;
    const cs=this._cellSize;
    const ft={40:5,50:5,64:5,80:10}[cs]||5;
    this._tool=this._tool==='move'?'add-pc':this._tool; // default to add-pc if somehow move
    // Always allow dragging regardless of tool — move is always active
    b.style.cssText='display:flex;flex-direction:column;height:100%;overflow:hidden';

    const partyBtns=state.party.map((p,pi)=>{
      const onMap=this._tokens.find(t=>t.label===p.name&&t.isPC);
      if(onMap)return '';
      return '<button class="btn small" data-mact="add-party" data-pi="'+pi+'" style="font-size:10px">'+(p.icon||'⚔')+' '+esc(p.name)+'</button>';
    }).join('');

    let html='';
    html+='<div class="map-toolbar">'
      +'<button class="btn '+(this._tool==='add-pc'?'active':'')+'" data-mact="tool-add-pc">+ PC</button>'
      +'<button class="btn '+(this._tool==='add-npc'?'active':'')+'" data-mact="tool-add-npc">+ NPC</button>'
      +'<button class="btn '+(this._tool==='erase'?'active':'')+'" data-mact="tool-erase">🗑 Erase</button>'
      +'<div style="width:1px;background:var(--border);height:18px;margin:0 4px;flex-shrink:0"></div>'
      +'<select id="map-size" style="width:70px;font-size:11px;padding:2px 4px;flex-shrink:0">'
        +'<option value="40" '+(cs===40?'selected':'')+'>40px/5ft</option>'
        +'<option value="50" '+(cs===50?'selected':'')+'>50px/5ft</option>'
        +'<option value="64" '+(cs===64?'selected':'')+'>64px/5ft</option>'
        +'<option value="80" '+(cs===80?'selected':'')+'>80px/10ft</option>'
      +'</select>'
      +'<input type="color" id="map-bg-color" value="'+this._bgColor+'" style="width:28px;height:24px;padding:1px;border-radius:3px;cursor:pointer;flex-shrink:0" title="Background color">'
      +'<label class="btn" style="cursor:pointer;flex-shrink:0;margin:0">📷 Map<input type="file" id="map-img-upload" accept="image/*" style="display:none"></label>'
      +(_mapBgImage?'<button class="btn danger" data-mact="clear-img" style="flex-shrink:0">✕ Map</button>':'')
      +'<div style="flex:1"></div>'
      +'<button class="btn" data-mact="sync-combat" style="flex-shrink:0">↺ Sync</button>'
      +'<button class="btn danger" data-mact="clear-tokens" style="flex-shrink:0">Clear</button>'
      // Fog of war controls
      +'<div style="width:1px;background:var(--border);height:18px;margin:0 2px;flex-shrink:0"></div>'
      +'<button class="btn '+(this._fog!==null?'active':'')+'" data-mact="fog-toggle" style="flex-shrink:0" title="Toggle Fog of War">🌫 Fog</button>'
      +(this._fog!==null?'<button class="btn '+(this._fogTool?'active':'')+'" data-mact="fog-paint" style="flex-shrink:0" title="Paint to reveal fog">🖌 Reveal</button>':'')
      +(this._fog!==null&&this._fogTool?'<input type="range" id="fog-radius" min="1" max="5" value="'+(this._fogRadius||1)+'" style="width:60px;flex-shrink:0" title="Brush size">':'')
      +(this._fog!==null?'<button class="btn" data-mact="fog-hide-all" style="flex-shrink:0" title="Hide everything">◼ Hide All</button>':'')
      +(this._fog!==null?'<button class="btn" data-mact="fog-show-all" style="flex-shrink:0" title="Reveal everything">◻ Show All</button>':'')
      +'<div style="width:1px;background:var(--border);height:18px;margin:0 2px;flex-shrink:0"></div>'
      +'<button class="btn" data-mact="open-player" style="flex-shrink:0" title="Open player view in new tab">📺 Player View</button>'
    +'</div>';

    if(partyBtns){
      html+='<div style="display:flex;gap:4px;padding:4px 8px;border-bottom:1px solid var(--border);background:var(--panel-2);flex-wrap:wrap;align-items:center">'
        +'<span style="font-size:10px;color:var(--text-muted)">Party:</span>'+partyBtns+'</div>';
    }

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
  },

  _setupMap(){
    const b=this._body;if(!b)return;
    const canvas=b.querySelector('#map-canvas');
    const stage=b.querySelector('#map-stage');
    const cs=this._cellSize;
    const W=this._cols*cs, H=this._rows*cs;

    canvas.width=W; canvas.height=H;
    stage.style.width=W+'px'; stage.style.height=H+'px';

    this._applyBg(stage,W,H);
    this._drawGrid(canvas,cs);
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
        b.querySelectorAll('[data-mact^="tool-"]').forEach(el=>el.classList.toggle('active',el.dataset.mact==='tool-'+this._tool));
      }
      else if(act==='sync-combat') this._syncParty();
      else if(act==='clear-tokens'){if(!confirm('Remove all tokens?'))return;this._tokens=[];this._selected=null;this._closePanel();this._renderTokens();this._saveMap();}
      else if(act==='clear-img'){_mapBgImage=null;this._applyBg(stage,W,H);this._render();}
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
        else showToast('Player view opened — share that window on your second screen');
      }
      else if(act==='add-party'){
        const pi=+btn.dataset.pi;
        const p=state.party[pi];
        if(!p)return;
        // Place at first empty row-0 slot
        const usedX=new Set(this._tokens.filter(t=>t.gy===0).map(t=>t.gx));
        let gx=0; while(usedX.has(gx))gx++;
        this._tokens.push({id:uid(),label:p.name,gx,gy:0,isPC:true,color:'#696969',size:1,dead:false});
        this._renderTokens();this._saveMap();
        this._render(); // refresh party quick-add row
      }
    }));

    b.querySelector('#map-size').addEventListener('change',e=>{
      this._cellSize=parseInt(e.target.value);
      const scroll=b.querySelector('#map-scroll');
      if(scroll){
        const cs2=this._cellSize;
        this._cols=Math.max(16,Math.floor(scroll.clientWidth/cs2));
        this._rows=Math.max(12,Math.floor(scroll.clientHeight/cs2));
      }
      this._saveMap();this._render();
    });
    b.querySelector('#fog-radius')?.addEventListener('input',e=>{this._fogRadius=parseInt(e.target.value)||1;});
    b.querySelector('#map-bg-color').addEventListener('change',e=>{this._bgColor=e.target.value;this._applyBg(stage,W,H);this._saveMap();});
    // Update stage cursor when fog tool active
    if(this._fogTool) stage.style.cursor='crosshair';
    else stage.style.cursor='default';

    // Image upload — load into an Image object, never touch localStorage
    b.querySelector('#map-img-upload').addEventListener('change',e=>{
      const file=e.target.files[0];if(!file)return;
      if(file.size>20*1024*1024){showToast('Image too large (max 20MB)');e.target.value='';return;}
      showToast('Loading image…');
      const reader=new FileReader();
      reader.onload=ev=>{
        const img=new Image();
        img.onload=()=>{
          _mapBgImage=img;
          this._applyBg(stage,W,H);
          this._render(); // re-render toolbar to show ✕ button
          showToast('Map image loaded');
        };
        img.onerror=()=>{showToast('Could not load image');};
        img.src=ev.target.result;
      };
      reader.onerror=()=>showToast('Could not read file');
      reader.readAsDataURL(file);
      e.target.value='';
    });

    // Canvas click = place token when in add-pc/add-npc mode
    canvas.addEventListener('click',e=>{
      if(this._drag?.moved) return;
      if(!this._tool||this._tool==='erase') return;
      const r=canvas.getBoundingClientRect();
      const gx=Math.floor((e.clientX-r.left)/cs);
      const gy=Math.floor((e.clientY-r.top)/cs);
      if(gx<0||gy<0||gx>=this._cols||gy>=this._rows) return;
      if(this._tokens.find(t=>t.gx===gx&&t.gy===gy)) return;
      const isPC=this._tool==='add-pc';
      showModal((isPC?'Place PC':'Place NPC'),[
        {id:'label',label:'Name',type:'text',value:'',placeholder:isPC?'PC name':'Enemy name'}
      ],'Place').then(r2=>{
        if(!r2||!r2.label)return;
        this._tokens.push({id:uid(),label:r2.label,gx,gy,isPC,color:'#696969',size:1,dead:false});
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
  },

  _applyBg(stage,W,H){
    if(_mapBgImage){
      // Draw the image into an offscreen canvas then set as CSS background
      // This avoids blocking the main canvas and is instant
      const off=document.createElement('canvas');
      off.width=W;off.height=H;
      off.getContext('2d').drawImage(_mapBgImage,0,0,W,H);
      stage.style.backgroundImage=`url(${off.toDataURL()})`;
      stage.style.backgroundSize=`${W}px ${H}px`;
      stage.style.backgroundColor='';
    } else {
      stage.style.backgroundImage='none';
      stage.style.backgroundColor=this._bgColor;
    }
  },

  _drawGrid(canvas,cs){
    const ctx=canvas.getContext('2d');
    const W=this._cols*cs, H=this._rows*cs;
    // Make sure canvas is sized correctly (fixes black area when resizing)
    canvas.width=W; canvas.height=H;
    ctx.clearRect(0,0,W,H);

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
    for(let x=0;x<=this._cols;x++){
      ctx.beginPath();ctx.moveTo(x*cs+.5,0);ctx.lineTo(x*cs+.5,H);ctx.stroke();
    }
    for(let y=0;y<=this._rows;y++){
      ctx.beginPath();ctx.moveTo(0,y*cs+.5);ctx.lineTo(W,y*cs+.5);ctx.stroke();
    }
    // Draw fog on top of grid
    this._drawFog();
  },

  _drawFog(){
    const b=this._body;if(!b)return;
    // Use a dedicated fog canvas layered above the grid canvas
    const stage=b.querySelector('#map-stage');if(!stage)return;
    let fogCanvas=stage.querySelector('#fog-canvas');
    const cs=this._cellSize;
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
    // Fill everything with fully opaque fog
    ctx.fillStyle='#000000';
    ctx.fillRect(0,0,W,H);
    // Cut out revealed cells
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
    const cs=this._cellSize;
    stage.querySelectorAll('.map-token').forEach(el=>el.remove());

    this._tokens.forEach(t=>{
      const size=t.size||1;
      const px=(t.gx+size/2)*cs;
      const py=(t.gy+size/2)*cs;
      const dim=size*cs-4;

      const el=document.createElement('div');
      el.className=`map-token ${t.isPC?'pc':'npc-t'} ${t.dead?'dead':''} ${this._selected===t.id?'selected':''}`;
      el.dataset.tid=t.id;
      const fontSize=size>1?13:Math.max(8,11-(t.label.length>5?2:0));
      el.style.cssText=`left:${px}px;top:${py}px;width:${dim}px;height:${dim}px;background:${t.color};font-size:${fontSize}px;position:absolute;transform:translate(-50%,-50%);z-index:2;border-radius:50%;border:2px solid rgba(212,165,116,0.8);display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;font-weight:600;color:#fff;text-align:center;line-height:1.1;overflow:hidden;box-sizing:border-box`;
      el.textContent=t.label.length>7?t.label.slice(0,6)+'…':t.label;

      el.addEventListener('mousedown',e=>{
        e.stopPropagation();e.preventDefault();

        if(this._tool==='erase'){
          const i=this._tokens.findIndex(x=>x.id===t.id);
          if(i>=0){this._tokens.splice(i,1);this._selected=null;this._closePanel();this._renderTokens();this._saveMap();}
          return;
        }
        // Always allow drag/select regardless of current placement tool

        // Highlight immediately
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

        const onUp=()=>{
          document.removeEventListener('mousemove',onMove);
          document.removeEventListener('mouseup',onUp);
          if(moved){
            // Snap to nearest grid cell on release
            const newGx=Math.max(0,Math.min(this._cols-size,Math.round(curPx/cs-size/2)));
            const newGy=Math.max(0,Math.min(this._rows-size,Math.round(curPy/cs-size/2)));
            t.gx=newGx;t.gy=newGy;
            this._saveMap();
            this._renderTokens();
          }
          this._showPanel(t);
        };

        document.addEventListener('mousemove',onMove);
        document.addEventListener('mouseup',onUp);
      });

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
    const source=state.combatants.filter(c=>c.isPC).length?state.combatants.filter(c=>c.isPC):state.party;
    source.forEach((c,i)=>{
      const name=c.name||c.label;
      if(!this._tokens.find(t=>t.label===name&&t.isPC)){
        this._tokens.push({id:uid(),label:name,gx:i%this._cols,gy:Math.floor(i/this._cols),isPC:true,color:'#696969',size:1,dead:(c.hp||0)<=0});
        placed++;
      }
    });
    this._renderTokens();this._saveMap();
    showToast(placed?`${placed} token(s) added`:'All party already on map');
  },
});
