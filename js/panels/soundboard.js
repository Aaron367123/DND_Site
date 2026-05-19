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
  // Set of sound ids flagged as "ambient" — ambient tracks duck (drop to
  // 30% volume) when any non-ambient effect plays, then restore. Persisted
  // in localStorage so the flag survives reloads.
  ambient: new Set(),
  // Saved scenes — captures of currently-looping sounds the DM can recall
  // with one click. [{id, name, ts, sounds:[{id, loop, ambient}]}]
  scenes: [],
  // Currently active scene id (last loaded) — purely visual; helps the user
  // see which preset is in effect.
  activeSceneId: null,
};

function _sbSaveAmbient(){
  try { localStorage.setItem('skt-sb-ambient-v1', JSON.stringify([..._sb.ambient])); } catch(e){}
}
function _sbLoadAmbient(){
  try {
    const arr = JSON.parse(localStorage.getItem('skt-sb-ambient-v1') || '[]');
    _sb.ambient = new Set(Array.isArray(arr) ? arr : []);
  } catch(e){ _sb.ambient = new Set(); }
}
function _sbSaveScenes(){
  try { localStorage.setItem('skt-sb-scenes-v1', JSON.stringify(_sb.scenes)); } catch(e){}
}
function _sbLoadScenes(){
  try {
    const arr = JSON.parse(localStorage.getItem('skt-sb-scenes-v1') || '[]');
    _sb.scenes = Array.isArray(arr) ? arr : [];
  } catch(e){ _sb.scenes = []; }
}

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
    _sbLoadAmbient();
    _sbLoadScenes();
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

  // Final playback volume = master × per-tile × duck-factor. Per-tile
  // defaults to 1.0 (no attenuation). Duck factor is 0.3 when this is an
  // ambient sound AND a non-ambient effect is currently playing — fades
  // ambient down so an effect punches through without the DM scrambling
  // for the master slider.
  _volumeFor(id){
    const base = _sb.vol * (_sb.volumes[id] != null ? _sb.volumes[id] : 1);
    if (!_sb.ambient || !_sb.ambient.has(id)) return base;
    // Look for any non-ambient sound currently playing — if found, duck.
    for (const playingId of Object.keys(_sb.playing)){
      if (!_sb.ambient.has(playingId)) return base * 0.3;
    }
    return base;
  },

  // Re-evaluate every currently-playing audio's effective volume. Called
  // when a sound starts/stops (so ducking kicks in immediately) or when
  // the ambient flag toggles on/off mid-playback.
  _updateLiveVolumes(){
    Object.entries(_sb.playing).forEach(([id, p]) => {
      if (p && p.audio){
        // Quick easing — set target volume directly; browsers smooth it
        // perceptually for short changes anyway.
        p.audio.volume = this._volumeFor(id);
      }
    });
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
    // No intrinsic width/height — _resizeVizCanvas sets them to match the
    // displayed size × devicePixelRatio so the bars stay crisp at any zoom.
    html+='<div class="sb-viz-wrap"><canvas id="sb-viz-canvas" style="width:100%;height:64px;display:block"></canvas></div>';

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

    // Scenes — saved sets of currently-looping sounds. Bar of clickable
    // chips that one-click-restore a configured ambience. Only rendered
    // when at least one scene has been saved OR something is currently
    // looping (so the "Save scene" button has a target).
    const hasLoops = playing.some(id => _sb.playing[id]?.loop);
    if ((_sb.scenes && _sb.scenes.length) || hasLoops){
      html += '<div class="sb-scenes">';
      html += '<span class="sb-scenes-label">🎬 Scenes</span>';
      (_sb.scenes || []).forEach(sc => {
        const active = sc.id === _sb.activeSceneId;
        html += '<button class="sb-scene-chip'+(active?' active':'')+'" data-scene="'+esc(sc.id)+'" title="'+(sc.sounds||[]).length+' track'+((sc.sounds||[]).length===1?'':'s')+' — click to load (replaces current playback)">'+esc(sc.name)
          +' <span class="sb-scene-del" data-scene-del="'+esc(sc.id)+'" title="Delete scene">×</span>'
          +'</button>';
      });
      if (hasLoops){
        html += '<button class="btn small" id="sb-save-scene" title="Save the currently-looping sounds as a named scene">💾 Save scene…</button>';
      }
      html += '</div>';
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
        const isAmbient = _sb.ambient && _sb.ambient.has(s.id);
        const tv = _sb.volumes[s.id] != null ? _sb.volumes[s.id] : 1;
        const pct = Math.round(tv*100);
        html+='<div class="sb-btn '+(isPlaying?'playing ':'')+(isLoop?'loop-on ':'')+(isAmbient?'ambient':'')+'" data-sid="'+s.id+'">'
          +'<button class="sb-ambient-toggle '+(isAmbient?'on':'')+'" data-ambient="'+s.id+'" title="'+(isAmbient?'Ambient — ducks when effects play. Click to un-mark.':'Mark as ambient (ducks under effects)')+'">🌙</button>'
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
        // Skip if the click landed on a sub-control (delete, ambient
        // toggle) — those have their own handlers above.
        if(e.target.dataset.del) return;
        if(e.target.closest('[data-ambient]')) return;
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
      // Also strip the deleted sound from any saved scene.
      _sb.scenes = _sb.scenes.map(sc => ({...sc, sounds: (sc.sounds||[]).filter(s => s.id !== id)})).filter(sc => sc.sounds.length);
      _sbSaveScenes();
      this._render();
    }));

    // Ambient toggle per tile — flips the ambient flag and persists. Doesn't
    // open/close the tile or interfere with click-to-play.
    b.querySelectorAll('[data-ambient]').forEach(el => el.addEventListener('click', e => {
      e.stopPropagation();
      const id = el.dataset.ambient;
      if (_sb.ambient.has(id)) _sb.ambient.delete(id);
      else _sb.ambient.add(id);
      _sbSaveAmbient();
      // Re-evaluate live volumes (newly ambient sounds may need to duck;
      // un-marked sounds should pop back to full volume).
      this._updateLiveVolumes();
      this._render();
    }));

    // Save current loops as a scene
    b.querySelector('#sb-save-scene')?.addEventListener('click', () => {
      const looping = Object.entries(_sb.playing)
        .filter(([id, p]) => p && p.loop)
        .map(([id]) => ({ id, loop: true, ambient: _sb.ambient.has(id) }));
      if (!looping.length) return;
      const suggested = 'Scene ' + (_sb.scenes.length + 1);
      const promptIt = (defaultName, applyFn) => {
        if (typeof showModal === 'function'){
          showModal('Save scene', [
            { id:'name', label:'Scene name', type:'text', value: defaultName }
          ], 'Save').then(r => {
            if (!r) return;
            const name = (r.name || '').trim();
            if (!name) return;
            applyFn(name);
          });
        } else {
          const name = window.prompt('Scene name', defaultName);
          if (name && name.trim()) applyFn(name.trim());
        }
      };
      promptIt(suggested, name => {
        // Replace existing scene with same name (case-insensitive)
        const lc = name.toLowerCase();
        _sb.scenes = _sb.scenes.filter(sc => (sc.name||'').toLowerCase() !== lc);
        const sceneId = 'scene_' + (typeof uid === 'function' ? uid() : Date.now().toString(36));
        _sb.scenes.unshift({ id: sceneId, name, ts: Date.now(), sounds: looping });
        _sb.activeSceneId = sceneId;
        if (_sb.scenes.length > 30) _sb.scenes.length = 30;
        _sbSaveScenes();
        if (typeof showToast === 'function') showToast('Saved "' + name + '" with ' + looping.length + ' track' + (looping.length===1?'':'s'));
        this._render();
      });
    });

    // Load a scene — stops all current playback, then re-plays each
    // saved track. Ambient flags are restored too so ducking works on
    // first play.
    b.querySelectorAll('[data-scene]').forEach(btn => btn.addEventListener('click', e => {
      // Skip if the user clicked the inline delete × inside the chip.
      if (e.target.closest('[data-scene-del]')) return;
      const sceneId = btn.dataset.scene;
      const sc = _sb.scenes.find(x => x.id === sceneId);
      if (!sc) return;
      this._stopAll();
      // Restore ambient flags for the scene's sounds (additive — doesn't
      // remove ambient state from sounds not in this scene).
      (sc.sounds || []).forEach(s => {
        if (s.ambient) _sb.ambient.add(s.id);
        else _sb.ambient.delete(s.id);
      });
      _sbSaveAmbient();
      // Play each sound. The first play kicks the audio context so
      // subsequent ones don't get blocked.
      (sc.sounds || []).forEach(s => this._play(s.id, !!s.loop));
      _sb.activeSceneId = sceneId;
      if (typeof showToast === 'function') showToast('Loaded "' + sc.name + '"');
      this._render();
    }));
    b.querySelectorAll('[data-scene-del]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      const sceneId = btn.dataset.sceneDel;
      const sc = _sb.scenes.find(x => x.id === sceneId);
      if (!sc) return;
      const proceed = ok => {
        if (!ok) return;
        _sb.scenes = _sb.scenes.filter(x => x.id !== sceneId);
        if (_sb.activeSceneId === sceneId) _sb.activeSceneId = null;
        _sbSaveScenes();
        this._render();
      };
      if (typeof showConfirm === 'function'){
        showConfirm('Delete scene "' + sc.name + '"?', {title:'Delete scene', confirmLabel:'Delete', danger:true}).then(proceed);
      } else proceed(window.confirm('Delete scene "' + sc.name + '"?'));
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

  // Resize the visualizer canvas to match its CSS-displayed size at the
  // device's pixel density. Without this the canvas renders at its 600×64
  // intrinsic resolution and the browser stretches it — blurry bars on any
  // HiDPI screen. Cheap to call every frame because `width=` is only re-set
  // when the actual displayed size changes.
  _resizeVizCanvas(canvas){
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width  * dpr));
    const h = Math.max(1, Math.floor(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h){
      canvas.width  = w;
      canvas.height = h;
    }
  },

  _startVisualizer(){
    if (_sb.vizRunning) return;
    if (!_sb.analyser) return;
    _sb.vizRunning = true;
    const tick = () => {
      if (!_sb.vizRunning) return;
      const canvas = this._body && this._body.querySelector('#sb-viz-canvas');
      if (!canvas){ _sb.vizRunning = false; return; }
      this._resizeVizCanvas(canvas);
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
    audio.loop=loop;
    this._wireAudioToAnalyser(audio);
    if (_sb.ctx?.state === 'suspended') _sb.ctx.resume();
    audio.play().catch(()=>{});
    _sb.playing[id]={audio,loop};
    // Volume must be set AFTER inserting into _sb.playing so the duck
    // calculation in _volumeFor sees this sound's playing status.
    audio.volume=this._volumeFor(id);
    if(!loop) audio.addEventListener('ended',()=>{
      delete _sb.playing[id];
      this._updateLiveVolumes(); // ambient may now un-duck
      this._render();
    },{once:true});
    // Existing ambient sounds may need to duck now that an effect started.
    this._updateLiveVolumes();
    this._startVisualizer();
    this._render();
  },

  _stop(id){
    const p=_sb.playing[id]; if(!p)return;
    try{ p.audio.pause(); p.audio.currentTime=0; }catch(e){}
    delete _sb.playing[id];
    // Other still-playing ambient sounds may need to un-duck now.
    this._updateLiveVolumes();
  },

  _stopAll(){ Object.keys(_sb.playing).forEach(id=>this._stop(id)); },

  _load(file){
    // Hard cap on personal uploads — IndexedDB has plenty of room, but a
    // 200MB+ WAV is almost never what the user intended and saving it
    // silently bloats local storage forever. Reject up front with a clear
    // message so the user can re-encode/trim and retry.
    const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
    if (file.size > MAX_BYTES){
      const mb = (file.size / 1024 / 1024).toFixed(1);
      showToast('"' + file.name + '" is ' + mb + 'MB — max is 25MB. Re-encode and try again.');
      return;
    }
    if (!file.type.startsWith('audio/')){
      showToast('"' + file.name + '" doesn\'t look like an audio file');
      return;
    }
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
