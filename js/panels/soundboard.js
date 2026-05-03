// ============================================================
// SOUND BOARD
// ============================================================
// Two sources of sounds:
//   • Shared — listed in audio/manifest.json, hosted in the repo,
//     visible to every player. Curated by editing the manifest + git push.
//   • Personal — uploaded in-browser, persisted to IndexedDB so they
//     survive a page refresh without ever touching the network.
// Left-click = play once. Right-click = loop.
// A spectrum visualizer at the top of the panel taps the master output
// via Web Audio so it reflects whatever is currently playing.

const _sb = {
  shared:[], personal:[], playing:{}, volumes:{}, vol:0.7,
  manifestLoaded:false, personalLoaded:false,
  // Web Audio (created lazily on first play — browsers block AudioContext
  // construction outside a user gesture)
  ctx:null, analyser:null, vizData:null, vizRunning:false,
};

// ─── IndexedDB persistence for personal uploads ──────────────────────────────
// Audio files are too big for localStorage (5-10 MB cap, plus base64 inflation).
// IDB stores raw Blobs and gives us hundreds of MB on every modern browser.
const _IDB = { name:'skt-soundboard', store:'sounds', ver:1 };

function _sbIdbOpen(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_IDB.name, _IDB.ver);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(_IDB.store)){
        db.createObjectStore(_IDB.store, { keyPath:'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
async function _sbIdbPut(rec){
  const db = await _sbIdbOpen();
  return new Promise((res,rej)=>{
    const tx = db.transaction(_IDB.store,'readwrite');
    tx.objectStore(_IDB.store).put(rec);
    tx.oncomplete = ()=>res(); tx.onerror = ()=>rej(tx.error);
  });
}
async function _sbIdbAll(){
  const db = await _sbIdbOpen();
  return new Promise((res,rej)=>{
    const req = db.transaction(_IDB.store,'readonly').objectStore(_IDB.store).getAll();
    req.onsuccess = ()=>res(req.result||[]); req.onerror = ()=>rej(req.error);
  });
}
async function _sbIdbDel(id){
  const db = await _sbIdbOpen();
  return new Promise((res,rej)=>{
    const tx = db.transaction(_IDB.store,'readwrite');
    tx.objectStore(_IDB.store).delete(id);
    tx.oncomplete = ()=>res(); tx.onerror = ()=>rej(tx.error);
  });
}

registerPanel('soundboard', {
  title:'Sound Board', icon:'🔊',
  mount(body){
    this._body = body;
    this._render();

    // Load shared list from manifest (one-time per page load)
    if (!_sb.manifestLoaded){
      fetch('audio/manifest.json')
        .then(r => r.ok ? r.json() : {sounds:[]})
        .then(j => {
          _sb.shared = (j.sounds||[]).map(s => ({...s, source:'shared'}));
          _sb.manifestLoaded = true;
          if (this._body) this._render();
        })
        .catch(() => { _sb.manifestLoaded = true; });
    }

    // Load personal sounds from IndexedDB (one-time per page load)
    if (!_sb.personalLoaded){
      _sbIdbAll().then(records => {
        records.forEach(r => {
          if (_sb.personal.find(s => s.id === r.id)) return;
          const url = URL.createObjectURL(r.blob);
          _sb.personal.push({ id:r.id, name:r.name, url, source:'personal' });
        });
        _sb.personalLoaded = true;
        if (this._body) this._render();
      }).catch(() => { _sb.personalLoaded = true; });
    }

    // Kick the visualizer if anything was already playing across remounts
    if (Object.keys(_sb.playing).length) this._startVisualizer();
  },
  unmount(){
    this._stopAll();
    _sb.vizRunning = false;
    this._body = null;
  },

  _findSound(id){
    return _sb.shared.find(s=>s.id===id) || _sb.personal.find(s=>s.id===id);
  },

  // Final playback volume = master × per-tile. Per-tile defaults to 1.0
  // (no attenuation) so behavior is unchanged for tiles the user hasn't touched.
  _volumeFor(id){
    return _sb.vol * (_sb.volumes[id] != null ? _sb.volumes[id] : 1);
  },

  _render(){
    const b=this._body; if(!b)return;
    const playing=Object.keys(_sb.playing);
    b.style.cssText='display:flex;flex-direction:column;height:100%;overflow:hidden';

    let html='';
    // Master bar
    html+='<div class="sb-master">'
      +'<span class="sb-master-label">🔊 Master</span>'
      +'<input type="range" class="sb-vol-slider" id="sb-mvol" min="0" max="1" step="0.01" value="'+_sb.vol+'">'
      +'<span id="sb-mpct" style="font-size:10px;color:var(--text-muted);width:34px;text-align:right">'+Math.round(_sb.vol*100)+'%</span>'
      +(playing.length?'<button class="btn small danger" id="sb-stop-all" style="margin-left:auto">⏹ Stop all</button>':'')
    +'</div>';

    // Spectrum visualizer — taps the master output via Web Audio. Canvas
    // internal resolution stays fixed; CSS scales to whatever width the panel is.
    html+='<div class="sb-viz-wrap"><canvas id="sb-viz-canvas" width="600" height="64"></canvas></div>';

    // Now playing chips
    if(playing.length){
      html+='<div class="sb-playing-bar"><span class="sb-now-playing">Now playing:</span>';
      playing.forEach(id=>{
        const s=this._findSound(id);
        const loop=_sb.playing[id]&&_sb.playing[id].loop;
        html+='<span class="sb-active-chip" data-stop="'+id+'">'
          +esc(s?s.name:'?')+' '+(loop?'↺ ':'')+'×</span>';
      });
      html+='</div>';
    }

    // Combined grid: shared first, then personal.
    html+='<div style="flex:1;overflow-y:auto"><div class="sb-grid">';
    const all = [..._sb.shared, ..._sb.personal];
    if(!all.length){
      html+='<div class="empty-state" style="grid-column:1/-1;padding:40px 20px">No sounds yet.<br><br>Upload MP3, WAV, or OGG files below — or add shared sounds in audio/manifest.json.</div>';
    } else {
      all.forEach(s=>{
        const isPlaying=!!_sb.playing[s.id];
        const isLoop=isPlaying&&_sb.playing[s.id].loop;
        const tv = _sb.volumes[s.id] != null ? _sb.volumes[s.id] : 1;
        const pct = Math.round(tv*100);
        html+='<div class="sb-btn '+(isPlaying?'playing ':'')+(isLoop?'loop-on':'')+'" data-sid="'+s.id+'">'
          +'<div class="sb-tile-head"><span class="sb-name">'+esc(s.name)+'</span></div>'
          +'<div class="sb-tile-pct">'+pct+'%</div>'
          +'<input type="range" class="sb-tile-vol" data-vol="'+s.id+'" min="0" max="1" step="0.01" value="'+tv+'">'
          +'<div class="sb-tile-foot">'
            +'<span class="sb-loop-icon" title="Looping">∞</span>'
            +'<span class="sb-source-badge sb-'+s.source+'">'+(s.source==='shared'?'shared':'yours')+'</span>'
            +(s.source==='personal' ? '<button class="sb-x" data-del="'+s.id+'" title="Remove">×</button>' : '<span class="sb-foot-spacer"></span>')
          +'</div>'
        +'</div>';
      });
    }
    html+='</div></div>';

    // Upload row
    html+='<div class="sb-upload-row">'
      +'<label class="btn" style="cursor:pointer;flex-shrink:0">📁 Upload sounds'
        +'<input type="file" id="sb-upload" accept="audio/*" multiple style="display:none">'
      +'</label>'
      +'<span style="font-size:10px;color:var(--text-muted)">MP3 · WAV · OGG · saved on this device</span>'
    +'</div>';

    b.innerHTML=html;
    this._wire();
    if (_sb.vizRunning) this._startVisualizer(); // re-kick after innerHTML reset
  },

  _wire(){
    const b=this._body; if(!b)return;

    b.querySelector('#sb-mvol')?.addEventListener('input',e=>{
      _sb.vol=parseFloat(e.target.value);
      b.querySelector('#sb-mpct').textContent=Math.round(_sb.vol*100)+'%';
      Object.entries(_sb.playing).forEach(([id,p])=>{ if(p.audio) p.audio.volume=this._volumeFor(id); });
    });

    b.querySelector('#sb-stop-all')?.addEventListener('click',e=>{
      e.stopPropagation(); this._stopAll(); this._render();
    });

    b.querySelectorAll('[data-stop]').forEach(el=>el.addEventListener('click',e=>{
      e.stopPropagation(); this._stop(el.dataset.stop); this._render();
    }));

    // Sound buttons — left click = play, right click = loop
    b.querySelectorAll('[data-sid]').forEach(btn=>{
      btn.addEventListener('click',e=>{
        e.stopPropagation();
        if(e.target.dataset.del) return;
        const sid=btn.dataset.sid;
        if(_sb.playing[sid]){ this._stop(sid); this._render(); }
        else this._play(sid,false);
      });
      btn.addEventListener('contextmenu',e=>{
        e.preventDefault(); e.stopPropagation();
        const sid=btn.dataset.sid;
        if(_sb.playing[sid]){ this._stop(sid); this._render(); }
        else this._play(sid,true);
      });
      // Long-press on mobile = loop the sound (substitute for right-click).
      addLongPress(btn, () => {
        const sid = btn.dataset.sid;
        if(_sb.playing[sid]){ this._stop(sid); this._render(); }
        else this._play(sid, true);
      });
    });

    // Per-tile volume sliders
    b.querySelectorAll('input[data-vol]').forEach(slider=>{
      ['mousedown','click','dblclick','contextmenu'].forEach(ev =>
        slider.addEventListener(ev, e => e.stopPropagation()));
      slider.addEventListener('input', e=>{
        const id = e.target.dataset.vol;
        const v  = parseFloat(e.target.value);
        _sb.volumes[id] = v;
        const p = _sb.playing[id];
        if (p && p.audio) p.audio.volume = this._volumeFor(id);
        const tile = e.target.closest('.sb-btn');
        const pctEl = tile && tile.querySelector('.sb-tile-pct');
        if (pctEl) pctEl.textContent = Math.round(v*100)+'%';
      });
    });

    // Delete buttons — also remove from IndexedDB
    b.querySelectorAll('[data-del]').forEach(el=>el.addEventListener('click',e=>{
      e.stopPropagation();
      const id=el.dataset.del;
      this._stop(id);
      const removed = _sb.personal.find(s => s.id === id);
      if (removed?.url) try { URL.revokeObjectURL(removed.url); } catch(_){}
      _sb.personal = _sb.personal.filter(s=>s.id!==id);
      _sbIdbDel(id).catch(()=>{});
      this._render();
    }));

    // Upload
    b.querySelector('#sb-upload')?.addEventListener('change',e=>{
      Array.from(e.target.files).forEach(f=>this._load(f));
      e.target.value='';
    });
  },

  // ─── Web Audio: shared analyser fed by every playing sound ─────────────────
  _ensureAudioCtx(){
    if (_sb.ctx) return _sb.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    _sb.ctx = new Ctx();
    _sb.analyser = _sb.ctx.createAnalyser();
    _sb.analyser.fftSize = 256;             // 128 frequency bins
    _sb.analyser.smoothingTimeConstant = 0.7;
    _sb.analyser.connect(_sb.ctx.destination);
    return _sb.ctx;
  },

  _wireAudioToAnalyser(audio){
    const ctx = this._ensureAudioCtx();
    if (!ctx || audio._sktWired) return;
    try {
      // createMediaElementSource throws if called twice on the same element —
      // guard with a marker. The source/audio pair lives until GC'd.
      const src = ctx.createMediaElementSource(audio);
      src.connect(_sb.analyser);
      audio._sktWired = true;
    } catch(e) { /* ignore (already connected, CORS-tainted, etc) */ }
  },

  _startVisualizer(){
    if (_sb.vizRunning) return;
    if (!_sb.analyser) return;
    _sb.vizRunning = true;
    const tick = () => {
      if (!_sb.vizRunning) return;
      const canvas = this._body && this._body.querySelector('#sb-viz-canvas');
      if (!canvas){ _sb.vizRunning = false; return; }
      // Stop animating once nothing is playing (CPU friendly)
      if (Object.keys(_sb.playing).length === 0){
        this._drawVizFlat(canvas);
        _sb.vizRunning = false;
        return;
      }
      this._drawViz(canvas);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },

  _drawViz(canvas){
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const bins = _sb.analyser.frequencyBinCount;
    if (!_sb.vizData || _sb.vizData.length !== bins) _sb.vizData = new Uint8Array(bins);
    _sb.analyser.getByteFrequencyData(_sb.vizData);

    ctx.clearRect(0, 0, W, H);
    // Use the lower ~80% of the spectrum — the very top tends to be empty noise
    const barCount = Math.floor(bins * 0.8);
    const barW = W / barCount;
    const grad = ctx.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, 'rgba(212,165,116,0.35)');
    grad.addColorStop(1, 'rgba(212,165,116,0.95)');
    ctx.fillStyle = grad;
    for (let i = 0; i < barCount; i++){
      const v = _sb.vizData[i] / 255;
      const h = Math.max(1, v * H * 0.95);
      ctx.fillRect(i * barW, H - h, Math.max(1, barW - 1), h);
    }
  },

  _drawVizFlat(canvas){
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  },

  _play(id,loop){
    this._stop(id);
    const s=this._findSound(id); if(!s) return;
    const src = s.source === 'shared' ? s.path : s.url;
    if (!src) return;
    const audio=new Audio(src);
    audio.volume=this._volumeFor(id);
    audio.loop=loop;
    this._wireAudioToAnalyser(audio);
    if (_sb.ctx?.state === 'suspended') _sb.ctx.resume();
    audio.play().catch(()=>{});
    _sb.playing[id]={audio,loop};
    if(!loop) audio.addEventListener('ended',()=>{ delete _sb.playing[id]; this._render(); },{once:true});
    this._startVisualizer();
    this._render();
  },

  _stop(id){
    const p=_sb.playing[id]; if(!p)return;
    try{ p.audio.pause(); p.audio.currentTime=0; }catch(e){}
    delete _sb.playing[id];
  },

  _stopAll(){ Object.keys(_sb.playing).forEach(id=>this._stop(id)); },

  _load(file){
    const id = 'p_'+uid();
    const name = file.name.replace(/\.[^.]+$/,'').slice(0,28);
    const url = URL.createObjectURL(file);
    _sb.personal.push({ id, name, url, source:'personal' });
    // Persist the original Blob so we can rebuild the URL after a reload.
    _sbIdbPut({ id, name, blob:file }).catch(err => {
      showToast('Saved this session only — IDB error: '+(err?.message||'unknown'));
    });
    showToast('Loaded: '+name);
    this._render();
  },
});
