// ============================================================
// LOOT TRACKER PANEL
// ============================================================
registerPanel('loot',{
  title:'Loot Tracker',icon:'💰',
  _loot:null,
  mount(body){
    this._body=body;
    if(!this._loot){try{const r=localStorage.getItem('skt-loot-v1');this._loot=r?JSON.parse(r):{cp:0,sp:0,ep:0,gp:0,pp:0,items:[]};}catch(e){this._loot={cp:0,sp:0,ep:0,gp:0,pp:0,items:[]}}
    if(!this._loot.items)this._loot.items=[];}
    this._render();
  },
  unmount(){this._body=null;},
  _save(){try{localStorage.setItem('skt-loot-v1',JSON.stringify(this._loot));}catch(e){}},
  _render(){
    const b=this._body;if(!b)return;
    const totalGp=((this._loot.cp||0)/100+(this._loot.sp||0)/10+(this._loot.ep||0)/2+(this._loot.gp||0)+(this._loot.pp||0)*10).toFixed(2);
    b.innerHTML=`<div class="loot-panel">
      <div class="loot-summary">
        ${['cp','sp','ep','gp','pp'].map(c=>`<div class="loot-coin"><div class="l">${c.toUpperCase()}</div><input type="number" id="loot-${c}" value="${this._loot[c]||0}" min="0"></div>`).join('')}
      </div>
      <div style="padding:6px 10px;border-bottom:1px solid var(--border);font-size:11px;color:var(--text-muted)">
        Total: <strong style="color:var(--warning)">${totalGp} gp</strong> equivalent &nbsp;·&nbsp;
        Per party member: <strong style="color:var(--warning)">${state.party.length?(totalGp/state.party.length).toFixed(2):totalGp} gp</strong>
        <button class="btn small" id="loot-divvy" style="float:right;margin-top:-2px">Divvy up</button>
      </div>
      <div style="display:flex;gap:6px;padding:8px;border-bottom:1px solid var(--border);align-items:center">
        <input type="text" id="loot-new-name" placeholder="Item name..." style="font-size:11px;flex:1">
        <input type="number" id="loot-new-qty" value="1" min="1" style="width:48px;font-size:11px" placeholder="Qty">
        <input type="text" id="loot-new-val" placeholder="Value" style="width:60px;font-size:11px">
        <button class="btn small primary" id="loot-add-item">Add</button>
      </div>
      <div class="loot-items">
        ${!this._loot.items.length?'<div class="empty-state">No items yet. Add loot above.</div>':
          this._loot.items.map((item,i)=>`<div class="loot-item" data-i="${i}">
            <div class="loot-name">${esc(item.name)}</div>
            <input type="number" class="loot-qty" value="${item.qty||1}" min="1" data-lfield="qty" data-li="${i}" title="Quantity">
            <input type="text" class="loot-val" value="${esc(item.value||'')}" data-lfield="value" data-li="${i}" placeholder="gp val" title="Value">
            <span class="loot-claimed ${item.claimed?'done':''}" data-lact="claim" data-li="${i}" title="Toggle claimed">${item.claimed?'✓ Claimed':'Unclaimed'}</span>
            <button class="btn icon-btn danger" data-lact="del" data-li="${i}" title="Remove">×</button>
          </div>`).join('')}
      </div>
    </div>`;
    // Wire coins
    ['cp','sp','ep','gp','pp'].forEach(c=>{b.querySelector(`#loot-${c}`).addEventListener('change',e=>{this._loot[c]=parseInt(e.target.value)||0;this._save();this._render();});});
    // Add item
    b.querySelector('#loot-add-item').addEventListener('click',()=>{
      const name=b.querySelector('#loot-new-name').value.trim();if(!name)return;
      this._loot.items.push({id:uid(),name,qty:parseInt(b.querySelector('#loot-new-qty').value)||1,value:b.querySelector('#loot-new-val').value.trim(),claimed:false});
      this._save();this._render();
    });
    b.querySelector('#loot-new-name').addEventListener('keydown',e=>{if(e.key==='Enter')b.querySelector('#loot-add-item').click();});
    // Item actions
    b.querySelectorAll('[data-lact]').forEach(el=>el.addEventListener('click',e=>{
      e.stopPropagation();const i=+el.dataset.li;
      if(el.dataset.lact==='del'){this._loot.items.splice(i,1);this._save();this._render();}
      else if(el.dataset.lact==='claim'){this._loot.items[i].claimed=!this._loot.items[i].claimed;this._save();this._render();}
    }));
    b.querySelectorAll('[data-lfield]').forEach(inp=>inp.addEventListener('change',e=>{
      const i=+e.target.dataset.li,f=e.target.dataset.lfield;
      this._loot.items[i][f]=f==='qty'?(parseInt(e.target.value)||1):e.target.value;this._save();
    }));
    b.querySelector('#loot-divvy').addEventListener('click',()=>{
      const n=state.party.length;if(!n){showToast('No party members');return;}
      const each=(parseFloat(totalGp)/n).toFixed(2);
      const rows = state.party.map(p =>
        `<div class="divvy-row"><span>${esc(p.name)}</span><span class="divvy-amt">${each} gp</span></div>`
      ).join('');
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="min-width:300px">
        <h3>Divvy up loot</h3>
        <p style="color:var(--text-muted);font-size:11px;margin:0 0 10px">
          <strong style="color:var(--accent)">${totalGp} gp</strong> split between
          <strong>${n}</strong> party member${n===1?'':'s'} —
          <strong style="color:var(--accent)">${each} gp</strong> each.
        </p>
        <div class="divvy-list">${rows}</div>
        <div class="modal-actions" style="margin-top:14px"><button class="btn primary" id="divvy-ok">Done</button></div>
      </div>`;
      document.body.appendChild(backdrop);
      const close = () => backdrop.remove();
      backdrop.querySelector('#divvy-ok').addEventListener('click', close);
      backdrop.addEventListener('mousedown', e => { if (e.target===backdrop) close(); });
      backdrop.addEventListener('keydown', e => { if (e.key==='Escape') close(); });
      setTimeout(()=>backdrop.querySelector('#divvy-ok')?.focus(), 30);
    });
  },
});
