// ============================================================
// SOUND BOARD
// ============================================================
// Upload your own audio. Left-click = play once. Right-click = loop.
// Session-only — re-upload after page refresh.

const _sb = { sounds:[], playing:{}, vol:0.7 };

registerPanel('soundboard', {
  title:'Sound Board', icon:'🔊',
  mount(body){ this._body=body; this._render(); },
  unmount(){ this._stopAll(); this._body=null; },

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
        const s=_sb.sounds.find(x=>x.id===id);
        const loop=_sb.playing[id]&&_sb.playing[id].loop;
        html+='<span class="sb-active-chip" data-stop="'+id+'">'
          +esc(s?s.name:'?')+' '+(loop?'↺ ':'')+'×</span>';
      });
      html+='</div>';
    }

    // Sound grid
    html+='<div style="flex:1;overflow-y:auto"><div class="sb-grid">';
    if(!_sb.sounds.length){
      html+='<div class="empty-state" style="grid-column:1/-1;padding:40px 20px">No sounds yet.<br><br>Upload MP3, WAV, or OGG files below.</div>';
    } else {
      _sb.sounds.forEach(s=>{
        const isPlaying=!!_sb.playing[s.id];
        const isLoop=isPlaying&&_sb.playing[s.id].loop;
        html+='<div class="sb-btn '+(isPlaying?'playing ':'')+(isLoop?'loop-on':'')+'" data-sid="'+s.id+'">'
          +'<span class="sb-icon">🎵</span>'
          +'<span class="sb-name">'+esc(s.name)+'</span>'
          +'<span class="sb-loop-badge">LOOP</span>'
          +(isLoop?'<div class="sb-bar"></div>':'')
          +'<button class="sb-x" data-del="'+s.id+'" title="Remove">×</button>'
          +'</div>';
      });
    }
    html+='</div></div>';

    // Upload row
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
      Object.values(_sb.playing).forEach(p=>{if(p.audio)p.audio.volume=_sb.vol;});
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

    // Delete buttons
    b.querySelectorAll('[data-del]').forEach(el=>el.addEventListener('click',e=>{
      e.stopPropagation();
      const id=el.dataset.del;
      this._stop(id);
      _sb.sounds=_sb.sounds.filter(s=>s.id!==id);
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
    const s=_sb.sounds.find(x=>x.id===id); if(!s||!s.url)return;
    const audio=new Audio(s.url);
    audio.volume=_sb.vol;
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
    _sb.sounds.push({id:'s_'+uid(), name, url});
    showToast('Loaded: '+name);
    this._render();
  },
});
