// ============================================================
// PARTY PANEL
// ============================================================
const PARTY_ICONS=['⚔','🗡','🏹','🪄','🔮','🛡','🪓','👊','🌿','🎵','🔥','❄️','⚡','☀','🌙','💀','🐉','🦅','🐺','🌊','📿','🏺','🎭','🌟','💎','🩸','🦴','🌀','👁','🗝'];

registerPanel('party',{
  title:'Party Tracker',icon:'♥',
  _pickerOpen:null, // idx of card with open icon picker
  mount(body){this._body=body;this._render();},
  unmount(){this._body=null;},

  _render(){
    const b=this._body;if(!b)return;
    b.innerHTML='<div class="party-grid">'+state.party.map((c,i)=>this._card(c,i)).join('')+'</div>'
      +'<div style="padding:0 10px 10px"><button class="btn small" data-act="add">+ Add character</button></div>';
    this._wire();
  },

  _card(c,i){
    const icon=c.icon||'⚔';
    const hpPct=c.hpMax>0?Math.max(0,Math.min(100,(c.hp/c.hpMax)*100)):0;
    const hpColor=hpPct>50?'#6b9e6b':hpPct>25?'#c9a050':'#c25450';
    const resources=c.resources||[];

    let resHtml='';
    if(resources.length){
      resHtml='<div class="resource-section"><div class="resource-section-head"><span>Resources</span>'
        +'<button class="btn small" data-act="add-res" data-idx="'+i+'" style="font-size:9px;padding:1px 5px">+ Add</button></div>';
      resources.forEach((r,ri)=>{
        const pips=r.type==='pool'?r.max:1;
        let pipHtml='<div class="resource-pips">';
        for(let p=0;p<pips;p++){
          pipHtml+='<div class="pip '+(p<r.current?'filled':'')+'" data-act="pip" data-idx="'+i+'" data-ri="'+ri+'" data-pi="'+p+'"></div>';
        }
        pipHtml+='</div>';
        resHtml+='<div class="resource-row">'
          +'<span class="resource-label" title="'+esc(r.name)+'">'+esc(r.name)+'</span>'
          +pipHtml
          +'<button class="btn icon-btn" data-act="del-res" data-idx="'+i+'" data-ri="'+ri+'" style="font-size:10px;padding:0 4px;opacity:.5">×</button>'
          +'</div>';
      });
      resHtml+='</div>';
    } else {
      resHtml='<button class="btn small" data-act="add-res" data-idx="'+i+'" style="font-size:9px;padding:2px 6px;align-self:flex-start">+ Add resource</button>';
    }

    return '<div class="char-card" data-cidx="'+i+'">'
      // Header: icon + name + remove
      +'<div class="char-header" style="position:relative">'
        +'<button class="char-icon-btn" data-act="icon-btn" data-idx="'+i+'" title="Change icon">'+esc(icon)+'</button>'
        +(this._pickerOpen===i?this._iconPicker(i):'')
        +'<input class="char-name" value="'+esc(c.name)+'" data-field="name" data-idx="'+i+'" placeholder="Character name">'
        +'<button class="btn icon-btn danger" data-act="remove" data-idx="'+i+'" title="Remove character" style="flex-shrink:0">×</button>'
      +'</div>'
      // HP block
      +'<div class="char-hp-block">'
        +'<div class="char-hp-row">'
          +'<input class="char-hp-current" type="number" value="'+c.hp+'" data-field="hp" data-idx="'+i+'" title="Current HP">'
          +'<span class="char-hp-sep">/</span>'
          +'<input class="char-hp-max" type="number" value="'+c.hpMax+'" data-field="hpMax" data-idx="'+i+'" title="Max HP">'
          +'<span style="font-size:10px;color:var(--text-dim);margin-left:auto">HP</span>'
        +'</div>'
        +'<div class="hp-bar-wrap"><div class="hp-bar-fill" style="width:'+hpPct+'%;background:'+hpColor+'"></div></div>'
      +'</div>'
      // Stats: AC, Init, Spd, PP
      +'<div class="char-stats-row">'
        +'<div class="char-stat"><div class="l">⛨ AC</div><input type="number" value="'+c.ac+'" data-field="ac" data-idx="'+i+'"></div>'
        +'<div class="char-stat"><div class="l">⚡ Init</div><input type="number" value="'+c.init+'" data-field="init" data-idx="'+i+'"></div>'
        +'<div class="char-stat"><div class="l">Spd</div><input type="number" value="'+c.spd+'" data-field="spd" data-idx="'+i+'"></div>'
        +'<div class="char-stat"><div class="l">GP</div><input type="number" value="'+(c.gp||0)+'" data-field="gp" data-idx="'+i+'"></div>'
      +'</div>'
      // Resources
      +resHtml
      // Inspiration
      +'<div class="inspiration-row '+(c.inspiration?'has-inspiration':'')+'" data-act="insp" data-idx="'+i+'">'
        +'<div class="inspiration-toggle"></div><span>Inspiration</span>'
      +'</div>'
    +'</div>';
  },

  _iconPicker(i){
    return '<div class="icon-picker" data-picker="'+i+'">'
      +PARTY_ICONS.map(ic=>'<button data-act="set-icon" data-idx="'+i+'" data-icon="'+ic+'">'+ic+'</button>').join('')
      +'</div>';
  },

  _wire(){
    const b=this._body;if(!b)return;
    // Inputs
    b.querySelectorAll('input[data-field]').forEach(inp=>{
      inp.addEventListener('change',e=>{
        const i=+e.target.dataset.idx, f=e.target.dataset.field;
        let v=e.target.value;
        if(['hp','hpMax','ac','init','spd','gp'].includes(f))v=parseInt(v)||0;
        state.party[i]={...state.party[i],[f]:v};
        save();
        if(['hp','hpMax','ac'].includes(f))syncPartyToCombat(i);
        // Re-render just this card's HP bar without full re-render
        if(f==='hp'||f==='hpMax'){
          const card=b.querySelector('[data-cidx="'+i+'"]');
          if(card){
            const p=state.party[i];
            const pct=p.hpMax>0?Math.max(0,Math.min(100,(p.hp/p.hpMax)*100)):0;
            const col=pct>50?'#6b9e6b':pct>25?'#c9a050':'#c25450';
            const bar=card.querySelector('.hp-bar-fill');
            if(bar){bar.style.width=pct+'%';bar.style.background=col;}
          }
        }
      });
      inp.addEventListener('click',e=>e.stopPropagation());
    });

    // Actions
    b.querySelectorAll('[data-act]').forEach(el=>el.addEventListener('click',e=>{
      e.stopPropagation();
      const act=el.dataset.act, i=+el.dataset.idx;
      if(act==='remove'){
        showModal('Remove '+state.party[i].name+'?',[],'Remove')
          .then(r=>{if(r===null)return;state.party.splice(i,1);save();this._render();});
      }
      else if(act==='insp'){state.party[i]={...state.party[i],inspiration:!state.party[i].inspiration};save();this._render();}
      else if(act==='add'){
        state.party.push({id:uid(),name:'New Character',cls:'fighter',icon:'⚔',hp:30,hpMax:30,ac:14,init:0,spd:30,pp:10,gp:0,inspiration:false,resources:[]});
        save();this._render();
      }
      else if(act==='icon-btn'){
        this._pickerOpen=this._pickerOpen===i?null:i;
        this._render();
      }
      else if(act==='set-icon'){
        state.party[i]={...state.party[i],icon:el.dataset.icon};
        this._pickerOpen=null;save();this._render();
      }
      else if(act==='pip'){
        const ri=+el.dataset.ri, pi=+el.dataset.pi;
        const res=[...state.party[i].resources];
        const r={...res[ri]};
        // Toggle: clicking a filled pip unfills it and all after; clicking empty fills up to it
        r.current=pi<r.current?pi:pi+1;
        res[ri]=r;
        state.party[i]={...state.party[i],resources:res};
        save();this._render();
      }
      else if(act==='del-res'){
        const res=state.party[i].resources.filter((_,ri)=>ri!==+el.dataset.ri);
        state.party[i]={...state.party[i],resources:res};save();this._render();
      }
      else if(act==='add-res'){
        showModal('Add Resource',[
          {id:'name',label:'Name',type:'text',value:'',placeholder:'Spell Slots L1, Rage, Focus Points...'},
          {id:'max', label:'Max uses',type:'number',value:4,min:1,max:99},
          {id:'type',label:'Type (pool/toggle)',type:'text',value:'pool',placeholder:'pool or toggle'},
        ],'Add').then(r=>{
          if(!r||!r.name)return;
          const res=[...(state.party[i].resources||[])];
          res.push({name:r.name,type:r.type==='toggle'?'toggle':'pool',current:parseInt(r.max)||1,max:parseInt(r.max)||1});
          state.party[i]={...state.party[i],resources:res};save();this._render();
        });
      }
    }));

    // Close icon picker when clicking outside
    b.addEventListener('click',()=>{if(this._pickerOpen!==null){this._pickerOpen=null;this._render();}});
  },
});
