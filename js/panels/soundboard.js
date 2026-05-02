// ============================================================
// SOUND BOARD
// ============================================================
// Two sources of sounds:
//   • Shared — listed in audio/manifest.json, hosted in the repo,
//     visible to every player. Curated by editing the manifest + git push.
//   • Personal — uploaded in-browser, kept in RAM only. Same model as before.
// Left-click = play once. Right-click = loop.

const _sb = { shared:[], personal:[], playing:{}, volumes:{}, vol:0.7, manifestLoaded:false };

registerPanel('soundboard', {
  title:'Sound Board', icon:'🔊',
  mount(body){
    this._body = body;
    this._render();
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
  },
  unmount(){ this._stopAll(); this._body=null; },

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

    // Combined grid: shared first, then personal. Each entry carries a `source`
    // tag so the renderer can show the right badge and decide whether the × is
    // visible.
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

    // Upload row — affects only this client's personal list.
    html+='<div class="sb-upload-row">'
      +'<label class="btn" style="cursor:pointer;flex-shrink:0">📁 Upload sounds'
        +'<input type="file" id="sb-upload" accept="audio/*" multiple style="display:none">'
      +'</label>'
      +'<span style="font-size:10px;color:var(--text-muted)">MP3 · WAV · OGG &nbsp;|&nbsp; Left-click: play once &nbsp;|&nbsp; Right-click: loop</span>'
    +'</div>';

    b.innerHTML=html;
    this._wire();
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
        if(e.target.dataset.del) return; // ignore clicks on the X button
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
    });

    // Per-tile volume sliders — adjusts only this sound, not master.
    b.querySelectorAll('input[data-vol]').forEach(slider=>{
      // Don't let dragging the slider toggle play/stop on the parent tile.
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

    // Delete buttons — only present on personal sounds
    b.querySelectorAll('[data-del]').forEach(el=>el.addEventListener('click',e=>{
      e.stopPropagation();
      const id=el.dataset.del;
      this._stop(id);
      _sb.personal=_sb.personal.filter(s=>s.id!==id);
      this._render();
    }));

    // Upload
    b.querySelector('#sb-upload')?.addEventListener('change',e=>{
      Array.from(e.target.files).forEach(f=>this._load(f));
      e.target.value='';
    });
  },

  _play(id,loop){
    this._stop(id);
    const s=this._findSound(id); if(!s) return;
    const src = s.source === 'shared' ? s.path : s.url;
    if (!src) return;
    const audio=new Audio(src);
    audio.volume=this._volumeFor(id);
    audio.loop=loop;
    audio.play().catch(()=>{});
    _sb.playing[id]={audio,loop};
    if(!loop) audio.addEventListener('ended',()=>{ delete _sb.playing[id]; this._render(); },{once:true});
    this._render();
  },

  _stop(id){
    const p=_sb.playing[id]; if(!p)return;
    try{ p.audio.pause(); p.audio.currentTime=0; }catch(e){}
    delete _sb.playing[id];
  },

  _stopAll(){ Object.keys(_sb.playing).forEach(id=>this._stop(id)); },

  _load(file){
    const url=URL.createObjectURL(file);
    const name=file.name.replace(/\.[^.]+$/,'').slice(0,28);
    _sb.personal.push({id:'p_'+uid(), name, url, source:'personal'});
    showToast('Loaded: '+name);
    this._render();
  },
});
