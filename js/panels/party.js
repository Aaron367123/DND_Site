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
      +'<div style="padding:0 10px 10px;display:flex;gap:6px">'
      +'<button class="btn small" data-act="add">+ Add character</button>'
      +'<button class="btn small" data-act="import-pdf" title="Import a D&D Beyond character sheet">📄 Import PDF</button>'
      +'</div>';
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

    return '<div class="char-card" data-cidx="'+i+'" draggable="true" title="Drag to Combat Tracker to add to combat">'
      // Header: icon + name + remove
      +'<div class="char-header" style="position:relative">'
        +'<button class="char-icon-btn" data-act="icon-btn" data-idx="'+i+'" title="Change icon">'+renderIcon(icon, c.name)+'</button>'
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
      +'</div>'
      // Resources
      +resHtml
      // Inspiration row: Heroic (the original generic toggle) + Bardic
      +'<div class="inspiration-pair">'
        +'<div class="inspiration-row '+(c.inspiration?'has-inspiration':'')+'" data-act="insp" data-idx="'+i+'" title="Heroic Inspiration">'
          +'<div class="inspiration-toggle"></div><span>Heroic</span>'
        +'</div>'
        +'<div class="inspiration-row '+(c.bardicInspiration?'has-inspiration bardic':'')+'" data-act="bardic-insp" data-idx="'+i+'" title="Bardic Inspiration">'
          +'<div class="inspiration-toggle"></div><span>Bardic</span>'
        +'</div>'
      +'</div>'
    +'</div>';
  },

  _iconPicker(i){
    return '<div class="icon-picker" data-picker="'+i+'">'
      +'<button class="icon-upload-btn" data-act="upload-icon" data-idx="'+i+'" title="Upload custom image">📷</button>'
      +PARTY_ICONS.map(ic=>'<button data-act="set-icon" data-idx="'+i+'" data-icon="'+ic+'">'+ic+'</button>').join('')
      +'</div>';
  },

  _wire(){
    const b=this._body;if(!b)return;
    // Drag a party card → drop on Combat Tracker to add to combat. Suppress
    // drag when grabbing inputs/buttons so text selection still works.
    b.querySelectorAll('.char-card').forEach(card=>{
      card.addEventListener('dragstart', e=>{
        if (e.target.closest('input,select,textarea,button,.icon-picker,.pip')){ e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/x-skt-party-pi', card.dataset.cidx);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', ()=>card.classList.remove('dragging'));
      // Drag-reorder: dropping a party card onto another party card
      // moves it to that position. The same drag still works for cross-panel
      // drops (combat tracker, battle map) — those panels listen on their own
      // bodies, so a drop on a .char-card never reaches them.
      card.addEventListener('dragover', e => {
        if (!e.dataTransfer.types.includes('application/x-skt-party-pi')) return;
        e.preventDefault();
        const r = card.getBoundingClientRect();
        const before = (e.clientY - r.top) < r.height / 2;
        card.classList.toggle('drop-before', before);
        card.classList.toggle('drop-after', !before);
      });
      card.addEventListener('dragleave', () => card.classList.remove('drop-before','drop-after'));
      card.addEventListener('drop', e => {
        card.classList.remove('drop-before','drop-after');
        const fromStr = e.dataTransfer.getData('application/x-skt-party-pi');
        if (!fromStr) return;
        const from = parseInt(fromStr);
        const to0 = parseInt(card.dataset.cidx);
        const r = card.getBoundingClientRect();
        const before = (e.clientY - r.top) < r.height / 2;
        let to = to0 + (before ? 0 : 1);
        // Ignore no-op drops (onto self or on the immediate boundary)
        if (from === to0 || from === to0 + (before ? -1 : 0)) return;
        if (from < to) to -= 1; // splice-from-earlier-index correction
        e.preventDefault(); e.stopPropagation();
        const [moved] = state.party.splice(from, 1);
        state.party.splice(to, 0, moved);
        save(); this._render();
      });
    });
    // Inputs
    b.querySelectorAll('input[data-field]').forEach(inp=>{
      inp.addEventListener('change',e=>{
        const i=+e.target.dataset.idx, f=e.target.dataset.field;
        let v=e.target.value;
        if(['hp','hpMax','ac','init','spd'].includes(f))v=parseInt(v)||0;
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
      else if(act==='bardic-insp'){state.party[i]={...state.party[i],bardicInspiration:!state.party[i].bardicInspiration};save();this._render();}
      else if(act==='add'){
        state.party.push({id:uid(),name:'New Character',cls:'fighter',icon:'⚔',hp:30,hpMax:30,ac:14,init:0,spd:30,pp:10,inspiration:false,resources:[]});
        save();this._render();
      }
      else if(act==='import-pdf'){
        this._importPdf();
      }
      else if(act==='icon-btn'){
        this._pickerOpen=this._pickerOpen===i?null:i;
        this._render();
      }
      else if(act==='set-icon'){
        state.party[i]={...state.party[i],icon:el.dataset.icon};
        this._pickerOpen=null;save();this._render();
        panelDefs.combat?._render?.();
      }
      else if(act==='upload-icon'){
        // Trigger a hidden file input — keep picker open until upload finishes
        const inp=document.createElement('input');
        inp.type='file'; inp.accept='image/*';
        inp.addEventListener('change',async ev=>{
          const f=ev.target.files[0]; if(!f) return;
          try {
            const dataUrl = await showCropModal(f, {size:96, shape:'circle', title:'Crop character icon'});
            if (!dataUrl) return; // user cancelled
            state.party[i]={...state.party[i],icon:dataUrl};
            this._pickerOpen=null; save(); this._render();
            panelDefs.combat?._render?.();
            showToast('Icon uploaded');
          } catch(err){ showToast('Upload failed: '+err.message); }
        });
        inp.click();
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
          {id:'type',label:'Type',type:'select',value:'pool',options:[
            {value:'pool',  label:'Pool (multiple uses, click pips to spend)'},
            {value:'toggle',label:'Toggle (single on/off)'},
          ]},
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

  // PDF import flow: file picker → parseDDBeyondPdf → preview modal → apply.
  // Pulls in fields from a D&D Beyond character sheet PDF and writes them to
  // an existing or new party slot. The preview modal is fully editable so the
  // user can correct any mis-extracted fields before saving.
  _importPdf(){
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/pdf';
    inp.addEventListener('change', async ev => {
      const f = ev.target.files[0]; if (!f) return;
      showToast('Reading PDF…');
      try {
        const data = await parseDDBeyondPdf(f);
        this._showPdfPreview(data);
      } catch(err){
        console.error(err);
        showToast('PDF parse failed: ' + (err?.message || 'unknown'));
      }
    });
    inp.click();
  },

  _showPdfPreview(data){
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const slotOptions = state.party.map((p,i) =>
      `<option value="${i}"${(data.name && p.name.toLowerCase() === data.name.toLowerCase()) ? ' selected' : ''}>${esc(p.name)}</option>`
    ).join('') + '<option value="new">— New character —</option>';
    const ab = data.abilities || {};
    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="width:520px;max-width:92vw">
      <h3>Import character sheet</h3>
      <p style="color:var(--text-muted);font-size:11px;margin:0 0 12px">Review the values pulled from the PDF and pick which party slot to apply them to. Anything that didn't extract cleanly can be edited before saving.</p>
      <div class="modal-fields">
        <div class="modal-field"><label>Apply to</label><select id="pdf-slot">${slotOptions}</select></div>
        <div class="modal-field"><label>Name</label><input id="pdf-name" type="text" value="${esc(data.name||'')}"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div class="modal-field"><label>Class</label><input id="pdf-cls" type="text" value="${esc(data.cls||'')}"></div>
          <div class="modal-field"><label>Level</label><input id="pdf-lvl" type="number" value="${data.level||1}" min="1" max="20"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div class="modal-field"><label>Race</label><input id="pdf-race" type="text" value="${esc(data.race||'')}"></div>
          <div class="modal-field"><label>Background</label><input id="pdf-bg" type="text" value="${esc(data.background||'')}"></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
          <div class="modal-field"><label>HP</label><input id="pdf-hp" type="number" value="${data.hp??''}"></div>
          <div class="modal-field"><label>HP Max</label><input id="pdf-hpmax" type="number" value="${data.hpMax??''}"></div>
          <div class="modal-field"><label>AC</label><input id="pdf-ac" type="number" value="${data.ac??''}"></div>
          <div class="modal-field"><label>Speed</label><input id="pdf-spd" type="number" value="${data.speed??''}"></div>
        </div>
        <div class="modal-field"><label>Initiative bonus</label><input id="pdf-init" type="number" value="${data.init??''}"></div>
        <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px">
          ${['str','dex','con','int','wis','cha'].map(k=>`<div class="modal-field"><label>${k.toUpperCase()}</label><input id="pdf-${k}" type="number" value="${ab[k]??''}"></div>`).join('')}
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn" id="pdf-cancel">Cancel</button>
        <button class="btn primary" id="pdf-apply">Apply</button>
      </div>
    </div>`;
    document.body.appendChild(backdrop);
    const close = ()=>backdrop.remove();
    backdrop.querySelector('#pdf-cancel').addEventListener('click', close);
    backdrop.addEventListener('mousedown', e=>{ if (e.target===backdrop) close(); });
    backdrop.addEventListener('keydown', e=>{ if (e.key==='Escape') close(); });
    backdrop.querySelector('#pdf-apply').addEventListener('click', () => {
      const get = id => backdrop.querySelector('#'+id).value;
      const num = id => parseInt(get(id)) || 0;
      const slot = get('pdf-slot');
      const data2 = {
        name: get('pdf-name').trim() || 'New Character',
        cls: get('pdf-cls').trim().toLowerCase() || 'fighter',
        level: num('pdf-lvl') || 1,
        race: get('pdf-race').trim(),
        background: get('pdf-bg').trim(),
        hp: num('pdf-hp'),
        hpMax: num('pdf-hpmax') || num('pdf-hp'),
        ac: num('pdf-ac') || 10,
        spd: num('pdf-spd') || 30,
        init: num('pdf-init'),
        abilities: {
          str: num('pdf-str'), dex: num('pdf-dex'), con: num('pdf-con'),
          int: num('pdf-int'), wis: num('pdf-wis'), cha: num('pdf-cha'),
        },
      };
      if (slot === 'new'){
        state.party.push({
          id: uid(),
          icon: '⚔',
          pp: 10,
          inspiration: false, resources: [],
          ...data2,
        });
      } else {
        const i = parseInt(slot);
        const existing = state.party[i] || {};
        state.party[i] = { ...existing, ...data2 };
      }
      save();
      close();
      this._render();
      // Mirror HP/AC into combat slot if this PC is currently in combat.
      const idx = state.party.findIndex(p => p.name === data2.name);
      if (idx >= 0) syncPartyToCombat(idx);
      showToast('Imported: ' + data2.name);
    });
  },
});
