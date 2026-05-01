// ============================================================
// PLAYER VIEW
// ============================================================
// Activated by opening this same HTML file with ?player=1 in the URL.
// Receives map state from the DM tab via BroadcastChannel.
// Shows fog-occluded map with tokens; no DM controls.

function initPlayerView(){
  // Hide the DM shell completely
  document.querySelector('.app-shell').style.display='none';

  // Build a minimal full-screen map container
  const root=document.createElement('div');
  root.id='player-root';
  root.style.cssText='position:fixed;inset:0;background:#111;display:flex;flex-direction:column;align-items:stretch;font-family:inherit';

  const header=document.createElement('div');
  header.style.cssText='background:#1a1a1a;border-bottom:1px solid #333;padding:8px 16px;display:flex;align-items:center;gap:12px;flex-shrink:0';
  header.innerHTML='<span style="color:#d4a574;font-weight:600;font-size:14px">⚔ SKT Campaign — Player View</span>'
    +'<span id="pv-status" style="font-size:11px;color:#666;margin-left:auto">Waiting for DM…</span>';

  const mapWrap=document.createElement('div');
  mapWrap.id='pv-scroll';
  mapWrap.style.cssText='flex:1;overflow:auto;position:relative;background:#111';

  const stage=document.createElement('div');
  stage.id='pv-stage';
  stage.style.cssText='position:relative;display:inline-block';

  const canvas=document.createElement('canvas');
  canvas.id='pv-canvas';
  canvas.style.cssText='display:block;z-index:1;position:relative';

  stage.appendChild(canvas);
  mapWrap.appendChild(stage);
  root.appendChild(header);
  root.appendChild(mapWrap);
  document.body.appendChild(root);

  // State received from DM
  let pvState={tokens:[],cellSize:50,cols:24,rows:18,bgColor:'#1a2a1a',fog:null};
  let pvBgImage=null;
  let connected=false;

  function drawMap(){
    const {cellSize:cs,cols,rows,bgColor,fog,tokens}=pvState;
    const W=cols*cs, H=rows*cs;
    canvas.width=W; canvas.height=H;
    stage.style.width=W+'px'; stage.style.height=H+'px';

    const ctx=canvas.getContext('2d');
    // Background
    if(pvBgImage){
      const off=document.createElement('canvas');off.width=W;off.height=H;
      off.getContext('2d').drawImage(pvBgImage,0,0,W,H);
      stage.style.backgroundImage='url('+off.toDataURL()+')';
      stage.style.backgroundSize=W+'px '+H+'px';
      stage.style.backgroundColor='';
    } else {
      stage.style.backgroundImage='none';
      stage.style.backgroundColor=bgColor;
    }

    // Grid lines
    ctx.clearRect(0,0,W,H);
    ctx.strokeStyle='rgba(255,255,255,0.15)';
    ctx.lineWidth=1;
    for(let x=0;x<=cols;x++){ctx.beginPath();ctx.moveTo(x*cs+.5,0);ctx.lineTo(x*cs+.5,H);ctx.stroke();}
    for(let y=0;y<=rows;y++){ctx.beginPath();ctx.moveTo(0,y*cs+.5);ctx.lineTo(W,y*cs+.5);ctx.stroke();}

    // Tokens (above fog — we'll handle layering via z-index)
    stage.querySelectorAll('.pv-token').forEach(e=>e.remove());
    const fogSet=fog?new Set(fog):null;
    tokens.forEach(t=>{
      // Hide NPC tokens that are in fogged cells from player
      if(fogSet&&!t.isPC){
        const revealed=fogSet.has(t.gx+','+t.gy);
        if(!revealed)return;
      }
      const size=t.size||1;
      const px=(t.gx+size/2)*cs;
      const py=(t.gy+size/2)*cs;
      const dim=size*cs-4;
      const el=document.createElement('div');
      el.className='pv-token';
      el.style.cssText='position:absolute;left:'+px+'px;top:'+py+'px;width:'+dim+'px;height:'+dim+'px;'
        +'background:'+t.color+';border-radius:50%;border:2px solid rgba(212,165,116,0.8);'
        +'transform:translate(-50%,-50%);z-index:2;display:flex;align-items:center;justify-content:center;'
        +'font-size:11px;font-weight:600;color:#fff;user-select:none;'+(t.dead?'opacity:.4;':'');
      el.textContent=t.label.length>7?t.label.slice(0,6)+'…':t.label;
      stage.appendChild(el);
    });

    // Fog canvas (player sees full black over unrevealed)
    let fogCanvas=stage.querySelector('#pv-fog');
    if(!fogCanvas){
      fogCanvas=document.createElement('canvas');
      fogCanvas.id='pv-fog';
      fogCanvas.style.cssText='position:absolute;top:0;left:0;z-index:4;pointer-events:none';
      stage.appendChild(fogCanvas);
    }
    fogCanvas.width=W;fogCanvas.height=H;
    const fctx=fogCanvas.getContext('2d');
    fctx.clearRect(0,0,W,H);
    if(fogSet){
      // Fill everything black
      fctx.fillStyle='rgba(0,0,0,1)';
      fctx.fillRect(0,0,W,H);
      // Cut out revealed cells
      fctx.globalCompositeOperation='destination-out';
      fogSet.forEach(key=>{
        const [gx,gy]=key.split(',').map(Number);
        fctx.fillRect(gx*cs,gy*cs,cs,cs);
      });
      fctx.globalCompositeOperation='source-over';
    }
  }

  // Listen for DM broadcasts
  const bc=new BroadcastChannel('skt-battlemap');
  bc.onmessage=ev=>{
    const d=ev.data;
    pvState={
      tokens:d.tokens||[],
      cellSize:d.cellSize||50,
      cols:d.cols||24,
      rows:d.rows||18,
      bgColor:d.bgColor||'#1a2a1a',
      fog:d.fog||null,
    };
    if(!connected){
      connected=true;
      document.getElementById('pv-status').textContent='Connected to DM';
      document.getElementById('pv-status').style.color='#6b9e6b';
    }
    drawMap();
  };

  // Also load initial state from localStorage as fallback
  try{
    const raw=localStorage.getItem('skt-battlemap-v1');
    if(raw){
      const d=JSON.parse(raw);
      pvState={tokens:d.tokens||[],cellSize:d.cellSize||50,cols:d.cols||24,rows:d.rows||18,bgColor:d.bgColor||'#1a2a1a',fog:d.fog||null};
      drawMap();
      document.getElementById('pv-status').textContent='Showing last saved map — waiting for DM…';
    }
  }catch(e){}
}
