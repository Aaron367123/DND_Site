// ============================================================
// SHOP PANEL
// ============================================================
registerPanel('shop',{
  title:'Shop Generator',icon:'$',
  // Inventory display cap — large catalogs (50+ items) become an unscrollable
  // wall otherwise. User clicks "Show more" to expand 20 at a time.
  _invLimit:20,
  // Saved shops library: [{id, name, ts, shop}]. Lets the DM keep a town's
  // shops between sessions instead of regenerating each time.
  _saved:[],
  mount(body){
    this._body=body;
    try { const r = localStorage.getItem('skt-shops-v1'); if (r){ const d = JSON.parse(r); if (Array.isArray(d.saved)) this._saved = d.saved; } } catch(e){}
    this._render();
    // Kick off the 5e dataset load early so the catalog is full by the time
    // the user clicks Generate. Generate still works (cold-start fallback)
    // before the load completes.
    if (typeof load5eData === 'function') load5eData();
  },
  unmount(){this._body=null;},
  _saveShops(){ try { localStorage.setItem('skt-shops-v1', JSON.stringify({saved:this._saved})); } catch(e){} },
  _render(){
    const b=this._body;if(!b)return;
    const types=Object.keys(ITEM_CATALOG);
    b.innerHTML=`<div class="shop-layout">
      <div class="shop-controls">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:4px">
          <span class="field-label" style="margin:0">Shop</span>
          <button class="btn icon-btn" data-act="settings" title="Pricing settings (currency, jitter, rounding)" style="padding:2px 6px;font-size:13px;line-height:1">⚙</button>
        </div>
        <div><label class="field-label">Shop Type</label><select id="shop-type">${types.map(t=>`<option ${state.shop?.type===t?'selected':''}>${t}</option>`).join('')}</select></div>
        <div><label class="field-label">Shop Price</label><select id="shop-price"><option>Cheap</option><option selected>Average</option><option>Expensive</option><option>Premium</option></select></div>
        <div><label class="field-label">Town Economy</label><select id="shop-economy"><option>Poor</option><option selected>Average</option><option>Wealthy</option></select></div>
        <div><label class="field-label">Assortment</label><select id="shop-assort"><option>Sparse</option><option selected>Standard</option><option>Abundant</option></select></div>
        <button class="btn primary" data-act="gen" style="margin-top:4px">Generate Shop</button>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="btn small" data-act="save-shop" style="flex:1" ${!state.shop?'disabled title="Generate a shop first"':''}>💾 Save</button>
        </div>
        ${this._renderSavedShops()}
      </div>
      <div class="shop-display" id="shop-display">${this._renderDisplay()}</div>
    </div>`;
    b.querySelector('[data-act="gen"]').addEventListener('click',e=>{e.stopPropagation();this._invLimit=20;this._generate();});
    b.querySelector('[data-act="settings"]').addEventListener('click',e=>{e.stopPropagation();this._openSettings();});
    b.querySelector('[data-act="save-shop"]')?.addEventListener('click', () => this._saveCurrentShop());
    b.querySelectorAll('[data-act="load-shop"]').forEach(btn => btn.addEventListener('click', () => {
      const s = this._saved.find(x => x.id === btn.dataset.sid); if (!s) return;
      state.shop = JSON.parse(JSON.stringify(s.shop));
      save();
      this._invLimit = 20;
      this._render();
      if (typeof showToast==='function') showToast('Loaded "' + s.name + '"');
    }));
    b.querySelectorAll('[data-act="del-shop"]').forEach(btn => btn.addEventListener('click', () => {
      const s = this._saved.find(x => x.id === btn.dataset.sid); if (!s) return;
      showConfirm('Delete saved shop "' + s.name + '"?',
        {title:'Delete shop', confirmLabel:'Delete', danger:true}).then(ok => {
          if (!ok) return;
          this._saved = this._saved.filter(x => x.id !== s.id);
          this._saveShops(); this._render();
        });
    }));
    this._wireDisplay();
  },

  _renderSavedShops(){
    if (!this._saved.length) return '';
    return '<div style="margin-top:10px"><div class="field-label">Saved shops</div>'
      + '<div style="display:flex;flex-direction:column;gap:3px;max-height:160px;overflow-y:auto">'
      + this._saved.map(s => `<div style="display:flex;align-items:center;gap:4px;background:var(--panel-2);border:1px solid var(--border);border-radius:3px;padding:3px 5px;font-size:11px">
          <button class="btn small" data-act="load-shop" data-sid="${esc(s.id)}" style="flex:1;text-align:left;padding:2px 6px;font-size:11px;justify-content:flex-start" title="Load — ${esc(s.shop?.type||'')}">${esc(s.name)}</button>
          <button class="btn icon-btn danger" data-act="del-shop" data-sid="${esc(s.id)}" title="Delete saved shop" style="padding:1px 4px;font-size:10px">×</button>
        </div>`).join('')
      + '</div></div>';
  },

  _saveCurrentShop(){
    if (!state.shop) return;
    const suggested = state.shop.name || (state.shop.type + ' shop');
    showModal('Save shop', [
      { id:'name', label:'Save as', type:'text', value: suggested }
    ], 'Save').then(r => {
      if (!r) return;
      const name = (r.name||'').trim();
      if (!name){ if (typeof showToast==='function') showToast('Name required'); return; }
      // Replace existing entry with the same name
      const lc = name.toLowerCase();
      this._saved = this._saved.filter(s => (s.name||'').toLowerCase() !== lc);
      this._saved.unshift({
        id: 'shop_' + (typeof uid==='function' ? uid() : Date.now().toString(36)),
        name,
        ts: Date.now(),
        shop: JSON.parse(JSON.stringify(state.shop)),
      });
      if (this._saved.length > 30) this._saved.length = 30;
      this._saveShops(); this._render();
      if (typeof showToast==='function') showToast('Saved "' + name + '"');
    });
  },

  // Wire the per-row Buy buttons + Show-more pagination on the inventory.
  _wireDisplay(){
    const b = this._body; if (!b) return;
    b.querySelectorAll('[data-act="buy-item"]').forEach(btn => btn.addEventListener('click', () => {
      const i = +btn.dataset.idx;
      const inv = state.shop?.inventory; if (!inv || !inv[i]) return;
      if ((inv[i].stock||0) <= 0) return;
      inv[i].stock = inv[i].stock - 1;
      save();
      // Mirror to the Loot tracker if it has been opened at least once this
      // session (which initialised its localStorage). Writes directly to
      // localStorage so a closed panel still receives the entry.
      this._pushToLoot(inv[i]);
      const sd = b.querySelector('#shop-display'); if (sd){ sd.innerHTML = this._renderDisplay(); this._wireDisplay(); }
      if (typeof showToast === 'function'){
        const left = inv[i].stock;
        showToast('Bought ' + inv[i].name + (left>0 ? ' · ' + left + ' left' : ' · last one'));
      }
    }));
    b.querySelectorAll('[data-act="show-more-inv"]').forEach(btn => btn.addEventListener('click', () => {
      const all = btn.dataset.mode === 'all';
      const inv = state.shop?.inventory || [];
      this._invLimit = all ? inv.length : Math.min(inv.length, (this._invLimit||20) + 20);
      const sd = b.querySelector('#shop-display'); if (sd){ sd.innerHTML = this._renderDisplay(); this._wireDisplay(); }
    }));
  },

  // Add a purchased item to the Loot tracker. Reads-merges-writes localStorage
  // so it works whether the Loot panel is mounted or not, and triggers a
  // re-render if it is.
  _pushToLoot(item){
    try {
      const cur = JSON.parse(localStorage.getItem('skt-loot-v1') || '{"cp":0,"sp":0,"ep":0,"gp":0,"pp":0,"items":[],"tabGroups":[]}');
      if (!Array.isArray(cur.items)) cur.items = [];
      const newId = (typeof uid === 'function' ? uid() : String(Math.random()).slice(2,9));
      cur.items.push({
        id: newId,
        name: item.name,
        qty: 1,
        value: this._fmtPrice(item.price),
        assignedTo: null,
      });
      localStorage.setItem('skt-loot-v1', JSON.stringify(cur));
      // If the panel is mounted, refresh it directly from the stored value.
      if (panelDefs.loot && panelDefs.loot._loot){
        panelDefs.loot._loot = cur;
        panelDefs.loot._render?.();
      }
    } catch(e){ console.warn('[shop] failed to push to loot', e); }
  },

  // Pricing settings popover — currency symbol, price jitter, rounding step.
  // These used to live in the global ⚙ Settings drawer but are scoped to the
  // shop generator, so we surface them here on a dedicated button instead.
  _openSettings(){
    const backdrop=document.createElement('div');
    backdrop.className='modal-backdrop';
    const cur = state.settings.currencySymbol || 'gp';
    const jit = state.settings.priceJitter ?? 20;
    const rnd = state.settings.rounding ?? 'none';
    // Ensure shopFilters exists (may be missing on saves from before this
    // feature). Default everything-true.
    if (!state.settings.shopFilters){
      state.settings.shopFilters = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.shopFilters));
    }
    if (!state.settings.shopAssortmentCounts){
      state.settings.shopAssortmentCounts = {...DEFAULT_SETTINGS.shopAssortmentCounts};
    }
    const sf = state.settings.shopFilters;
    const sac = state.settings.shopAssortmentCounts;
    sf.rarity = sf.rarity || {};
    sf.categories = sf.categories || {};
    const RARITIES = [
      ['Common',    'Common'],
      ['Uncommon',  'Uncommon'],
      ['Rare',      'Rare'],
      ['VeryRare',  'Very Rare'],
      ['Legendary', 'Legendary'],
    ];
    const CATEGORIES = [
      ['weapons',   'Weapons'],
      ['ammo',      'Ammunition'],
      ['armor',     'Armor & Shields'],
      ['tools',     'Tools & Gear'],
      ['potions',   'Potions'],
      ['wondrous',  'Wondrous Items'],
      ['rodsWands', 'Wands & Rods'],
      ['rings',     'Rings'],
      ['scrolls',   'Scrolls'],
      ['foci',      'Spellcasting Foci'],
      ['treasure',  'Treasure & Gems'],
      ['foodDrink', 'Food & Drink'],
      ['other',     'Other'],
    ];
    const cb = (id, label, checked) =>
      `<label class="shop-filter-chk"><input type="checkbox" id="${id}" ${checked?'checked':''}> ${esc(label)}</label>`;

    backdrop.innerHTML=`<div class="modal" role="dialog" aria-modal="true" style="width:420px;max-width:94vw;max-height:88vh;display:flex;flex-direction:column;padding:18px 20px">
      <h3 style="margin:0 0 12px">Shop settings</h3>
      <div style="flex:1;overflow-y:auto;padding-right:4px">

        <div class="modal-field" style="margin-bottom:10px">
          <label>Currency symbol</label>
          <input type="text" id="shop-cur" value="${esc(cur)}" maxlength="6" autocomplete="off">
        </div>
        <div class="modal-field" style="margin-bottom:10px">
          <label>Price jitter <span id="shop-jit-val" style="float:right;color:var(--text-muted);font-size:11px">${jit}%</span></label>
          <input type="range" id="shop-jit" min="0" max="50" value="${jit}">
        </div>
        <div class="modal-field" style="margin-bottom:14px">
          <label>Rounding</label>
          <div class="toggle-group" id="shop-rnd">
            <button data-val="none" class="${rnd==='none'?'active':''}">None</button>
            <button data-val="1" class="${String(rnd)==='1'?'active':''}">1</button>
            <button data-val="5" class="${String(rnd)==='5'?'active':''}">5</button>
            <button data-val="10" class="${String(rnd)==='10'?'active':''}">10</button>
          </div>
        </div>

        <div class="shop-filter-section">
          <div class="shop-filter-head"><span>Items per assortment</span></div>
          <div class="shop-assort-grid">
            <label>Sparse<input type="number" min="1" max="200" id="shop-sac-sparse" value="${sac.Sparse}"></label>
            <label>Standard<input type="number" min="1" max="200" id="shop-sac-standard" value="${sac.Standard}"></label>
            <label>Abundant<input type="number" min="1" max="200" id="shop-sac-abundant" value="${sac.Abundant}"></label>
          </div>
          <p class="shop-filter-note" style="margin-top:6px">Caps at the catalog size if the shop type has fewer items available.</p>
        </div>

        <div class="shop-filter-section">
          <div class="shop-filter-head">
            <span>Item type</span>
            <button class="shop-filter-mini" data-act="type-all">All</button>
          </div>
          <div class="shop-filter-grid">
            ${cb('shop-magic', 'Include magic items',  sf.includeMagic   !== false)}
            ${cb('shop-mund',  'Include mundane items', sf.includeMundane !== false)}
          </div>
        </div>

        <div class="shop-filter-section">
          <div class="shop-filter-head">
            <span>Rarity</span>
            <span>
              <button class="shop-filter-mini" data-act="rar-all">All</button>
              <button class="shop-filter-mini" data-act="rar-none">None</button>
            </span>
          </div>
          <div class="shop-filter-grid">
            ${RARITIES.map(([k,l]) => cb('shop-rar-'+k, l, sf.rarity[k] !== false)).join('')}
          </div>
        </div>

        <div class="shop-filter-section">
          <div class="shop-filter-head">
            <span>Categories</span>
            <span>
              <button class="shop-filter-mini" data-act="cat-all">All</button>
              <button class="shop-filter-mini" data-act="cat-none">None</button>
            </span>
          </div>
          <div class="shop-filter-grid">
            ${CATEGORIES.map(([k,l]) => cb('shop-cat-'+k, l, sf.categories[k] !== false)).join('')}
          </div>
        </div>

        <p class="shop-filter-note">Filters apply to <strong>every</strong> shop type — disable Magic to keep "+1 Longsword" out of the blacksmith, or uncheck Legendary to cap loot rarity.</p>
      </div>
      <div class="modal-actions" style="margin-top:14px;flex-shrink:0">
        <button class="btn primary" id="shop-cfg-close">Done</button>
      </div>
    </div>`;
    document.body.appendChild(backdrop);
    const close=()=>backdrop.remove();
    backdrop.querySelector('#shop-cfg-close').addEventListener('click',close);
    backdrop.addEventListener('mousedown',e=>{ if(e.target===backdrop) close(); });
    backdrop.addEventListener('keydown',e=>{ if(e.key==='Escape') close(); });

    // Existing pricing controls.
    const sym=backdrop.querySelector('#shop-cur');
    const slider=backdrop.querySelector('#shop-jit');
    const sliderVal=backdrop.querySelector('#shop-jit-val');
    sym.addEventListener('change',()=>{ state.settings.currencySymbol=sym.value.trim()||'gp'; save(); this._render(); });
    slider.addEventListener('input',()=>{ sliderVal.textContent=slider.value+'%'; });
    slider.addEventListener('change',()=>{ state.settings.priceJitter=parseInt(slider.value); save(); });
    backdrop.querySelectorAll('#shop-rnd button').forEach(btn=>btn.addEventListener('click',()=>{
      const v=btn.dataset.val==='none'?'none':parseInt(btn.dataset.val);
      backdrop.querySelectorAll('#shop-rnd button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      state.settings.rounding=v;
      save();
    }));

    // Items-per-assortment inputs.
    const wireSac = (id, key) => {
      const el = backdrop.querySelector('#'+id);
      el.addEventListener('change', () => {
        const n = Math.max(1, parseInt(el.value)||1);
        el.value = n;
        sac[key] = n;
        save();
      });
    };
    wireSac('shop-sac-sparse',   'Sparse');
    wireSac('shop-sac-standard', 'Standard');
    wireSac('shop-sac-abundant', 'Abundant');

    // Magic / mundane toggles.
    backdrop.querySelector('#shop-magic').addEventListener('change', e => { sf.includeMagic   = e.target.checked; save(); });
    backdrop.querySelector('#shop-mund') .addEventListener('change', e => { sf.includeMundane = e.target.checked; save(); });

    // Rarity toggles.
    RARITIES.forEach(([k]) => {
      const el = backdrop.querySelector('#shop-rar-'+k);
      el.addEventListener('change', e => { sf.rarity[k] = e.target.checked; save(); });
    });

    // Category toggles.
    CATEGORIES.forEach(([k]) => {
      const el = backdrop.querySelector('#shop-cat-'+k);
      el.addEventListener('change', e => { sf.categories[k] = e.target.checked; save(); });
    });

    // Bulk "All / None" mini-buttons.
    const setAll = (selPrefix, value, keys) => {
      keys.forEach(k => {
        const el = backdrop.querySelector('#'+selPrefix+k);
        if (el) el.checked = value;
      });
    };
    backdrop.querySelectorAll('.shop-filter-mini').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'rar-all'  || act === 'rar-none'){
        const v = act === 'rar-all';
        RARITIES.forEach(([k]) => { sf.rarity[k] = v; });
        setAll('shop-rar-', v, RARITIES.map(r => r[0]));
      } else if (act === 'cat-all' || act === 'cat-none'){
        const v = act === 'cat-all';
        CATEGORIES.forEach(([k]) => { sf.categories[k] = v; });
        setAll('shop-cat-', v, CATEGORIES.map(c => c[0]));
      } else if (act === 'type-all'){
        sf.includeMagic = true; sf.includeMundane = true;
        backdrop.querySelector('#shop-magic').checked = true;
        backdrop.querySelector('#shop-mund').checked  = true;
      }
      save();
    }));

    setTimeout(()=>sym.focus(),30);
  },
  _renderDisplay(){
    if(!state.shop)return'<div class="empty-state">Configure settings and click Generate Shop.</div>';
    const s=state.shop;
    const inv = s.inventory || [];
    const limit = Math.max(0, Math.min(this._invLimit || 20, inv.length));
    const shown = inv.slice(0, limit);
    const remaining = inv.length - limit;
    const rowsHtml = shown.map((item, i) => {
      const out = (item.stock||0) <= 0;
      return `<tr class="${out?'shop-out':''}">
        <td>${esc(item.name)}</td>
        <td>${esc(item.category)}</td>
        <td><span class="rarity-badge rarity-${item.rarity.replace(/\s/,'')}">${item.rarity}</span></td>
        <td>${this._fmtPrice(item.price)}</td>
        <td>${out ? '<span style="color:var(--text-dim);font-size:11px">out</span>' : '×'+item.stock}</td>
        <td style="text-align:right;padding-right:14px">
          <button class="btn small" data-act="buy-item" data-idx="${i}" ${out?'disabled title="Out of stock"':'title="Buy one (decrements stock, adds to Loot tracker)"'} style="padding:1px 8px;font-size:11px">Buy</button>
        </td>
      </tr>`;
    }).join('');
    return`<div class="shop-section"><div class="shop-name">${esc(s.name)} <span class="shop-type">(${esc(s.type)})</span></div><div class="meta-line" style="margin-top:4px">Wealth: ${s.meta.economy} · Band: ${s.meta.price} · Assortment: ${s.meta.assortment}</div></div>
    <div class="shop-section"><h3>Shopkeeper</h3><div><strong>${esc(s.keeper)}</strong> · ${esc(s.tone)}</div><div class="meta-line" style="margin-top:4px">Quirks: ${s.quirks.map(esc).join(', ')}</div></div>
    <div class="shop-section"><h3>Aesthetic</h3><div class="meta-line" style="font-style:italic">${esc(s.aesthetic)}</div></div>
    <div class="shop-section" style="padding:0"><h3 style="padding:12px 14px 6px">Inventory</h3>
    ${inv.length
      ? `<table class="shop-table"><thead><tr><th>Item</th><th>Category</th><th>Rarity</th><th>Price</th><th>Stock</th><th></th></tr></thead>
         <tbody>${rowsHtml}</tbody></table>
         <div style="padding:8px 14px;font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:10px">
           <span>Showing ${shown.length} of ${inv.length} item(s)</span>
           ${remaining > 0 ? `<button class="btn small" data-act="show-more-inv" style="padding:2px 8px;font-size:11px">Show ${Math.min(20, remaining)} more</button>` : ''}
           ${remaining > 0 ? `<button class="btn small" data-act="show-more-inv" data-mode="all" style="padding:2px 8px;font-size:11px">Show all</button>` : ''}
         </div>`
      : `<div style="padding:18px 14px;font-size:12px;color:var(--text-muted);text-align:center">No items match the active filters. Open <strong>⚙</strong> to allow more rarities or categories.</div>`
    }
    </div>`;
  },
  // Type-code → shop-type predicate. Each filter examines a 5e item entry's
  // _raw and decides whether the item belongs in this shop. Predicates return
  // true for inclusion. We strip "|SOURCE" suffixes from type codes since
  // 5etools sometimes carries them (e.g. "HA|XPHB").
  _shopFilters: {
    'Blacksmith/Armory': r => {
      const t = (r.type||'').split('|')[0];
      return ['HA','MA','LA','S','M'].includes(t) && (r.rarity==='none' || !r.rarity || r.rarity==='unknown');
    },
    'General Store': r => {
      const t = (r.type||'').split('|')[0];
      return ['G','AT','T','GS','TAH','TG','INS','OTH'].includes(t)
        && (r.rarity==='none' || !r.rarity || r.rarity==='unknown');
    },
    'Alchemist': r => {
      const t = (r.type||'').split('|')[0];
      if (t === 'P') return true;
      const n = (r.name||'').toLowerCase();
      return /^(acid|antitoxin|alchemist's fire|holy water|oil)\b/.test(n);
    },
    'Magic Shop': r => {
      const rar = (r.rarity||'').toLowerCase();
      return ['uncommon','rare','very rare','legendary'].includes(rar);
    },
    'Tavern': r => {
      const t = (r.type||'').split('|')[0];
      return t === 'FD';
    },
    'Jeweler': r => {
      const t = (r.type||'').split('|')[0];
      const rar = (r.rarity||'').toLowerCase();
      if (t === '$') return true;
      if (t === 'RG' && (rar==='none' || rar==='common' || rar==='uncommon' || rar==='rare')) return true;
      return /^(gemstone|silver ring|gold ring|pearl)\b/i.test(r.name||'');
    },
    'Bookshop': r => {
      const t = (r.type||'').split('|')[0];
      return t === 'SC';
    },
    'Fletcher': r => {
      const t = (r.type||'').split('|')[0];
      const rar = (r.rarity||'').toLowerCase();
      return (t === 'R' || t === 'A') && (rar==='none' || !rar || rar==='unknown');
    },
  },

  // Curated extras for shop types that 5e doesn't fully model as items
  // (taverns sell ales/inn stays; bookshops sell books/maps/spellbooks).
  // These guarantee the shop never feels empty even when the dataset is thin.
  _shopExtras: {
    'Tavern': [
      {name:'Ale (mug)',category:'Drink',basePrice:0.04,rarity:'Common'},
      {name:'Wine, Fine (bottle)',category:'Drink',basePrice:10,rarity:'Uncommon'},
      {name:'Bread, Loaf',category:'Food',basePrice:0.02,rarity:'Common'},
      {name:'Stew, Bowl',category:'Food',basePrice:0.1,rarity:'Common'},
      {name:'Inn Stay, Common',category:'Lodging',basePrice:0.5,rarity:'Common'},
      {name:'Inn Stay, Comfortable',category:'Lodging',basePrice:2,rarity:'Uncommon'},
    ],
    'Bookshop': [
      {name:'Book, Common',category:'Book',basePrice:25,rarity:'Common'},
      {name:'Spellbook (blank)',category:'Book',basePrice:50,rarity:'Common'},
      {name:'Map, Local',category:'Book',basePrice:10,rarity:'Common'},
      {name:'Map, Regional',category:'Book',basePrice:50,rarity:'Uncommon'},
      {name:'Ink (1 oz)',category:'Tool',basePrice:10,rarity:'Common'},
      {name:'Parchment (sheet)',category:'Tool',basePrice:0.1,rarity:'Common'},
    ],
    'Jeweler': [
      {name:'Gemstone, Amethyst',category:'Gem',basePrice:100,rarity:'Uncommon'},
      {name:'Gemstone, Emerald',category:'Gem',basePrice:1000,rarity:'Rare'},
      {name:'Gemstone, Ruby',category:'Gem',basePrice:1000,rarity:'Rare'},
      {name:'Pearl',category:'Gem',basePrice:100,rarity:'Uncommon'},
      {name:'Silver Ring',category:'Jewelry',basePrice:25,rarity:'Common'},
      {name:'Gold Ring',category:'Jewelry',basePrice:75,rarity:'Uncommon'},
    ],
  },

  // Map raw 5etools rarity strings to the bucket names the shop uses.
  _normRarity(r){
    const x = (r||'').toLowerCase();
    if (x === 'uncommon') return 'Uncommon';
    if (x === 'rare') return 'Rare';
    if (x === 'very rare') return 'VeryRare';
    if (x === 'legendary') return 'Legendary';
    return 'Common';
  },

  // 5etools type code → broad shop-filter category. Drives the "Categories"
  // checkboxes in the settings popover. Anything unmatched falls into 'other'.
  _typeToCategory(typeCode){
    const t = (typeCode || '').split('|')[0];
    const map = {
      M:'weapons', R:'weapons',
      A:'ammo', AF:'ammo',
      HA:'armor', MA:'armor', LA:'armor', S:'armor',
      AT:'tools', T:'tools', G:'tools', GS:'tools', TAH:'tools', TG:'tools', INS:'tools',
      P:'potions',
      WD:'rodsWands', RD:'rodsWands',
      RG:'rings',
      SC:'scrolls',
      SCF:'foci',
      $:'treasure',
      FD:'foodDrink',
    };
    return map[t] || 'other';
  },

  // True if an item passes the user's currently-active shop filters
  // (rarity / categories / magic-vs-mundane). Empty / missing settings
  // default to "everything allowed".
  _passesFilters(rarityBucket, typeCode, isMagic){
    const f = (state.settings && state.settings.shopFilters) || {};
    const rarity = f.rarity || {};
    const cats = f.categories || {};
    if (rarity[rarityBucket] === false) return false;
    const cat = this._typeToCategory(typeCode);
    if (cats[cat] === false) return false;
    if (isMagic && f.includeMagic === false) return false;
    if (!isMagic && f.includeMundane === false) return false;
    return true;
  },

  // For magic items without an explicit price, sample from the standard
  // 5e fan-convention rarity bands.
  _magicPriceForRarity(rarity){
    const rand = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    switch (rarity){
      case 'Uncommon':  return rand(101,   500);
      case 'Rare':      return rand(501,  5000);
      case 'VeryRare':  return rand(5001, 50000);
      case 'Legendary': return rand(50001, 250000);
      case 'Common':    return rand(50,    100);
      default:          return 100;
    }
  },

  // Build a catalog (the shape the existing _generate weighted-shuffle expects)
  // by filtering _5eData with the shop-type predicate and shaping each entry.
  // Caps at 60 items per shop so the assortment-fraction math stays sane.
  _buildShopCatalog(shopType){
    if (typeof _5eLoaded === 'undefined' || !_5eLoaded || !Array.isArray(_5eData)) return null;
    const filter = this._shopFilters[shopType];
    if (!filter) return null;
    const out = [];
    const seen = new Set();
    const TYPE_LABELS = (typeof _ITEM_TYPE_LABEL !== 'undefined') ? _ITEM_TYPE_LABEL : {};
    // Hidden-sources filter: any book the user has hidden via the Books
    // panel's × button is excluded from the shop catalog so generated shops
    // only contain items from sources the DM is actually using.
    const hiddenSrc = window.SKT_HIDDEN_SOURCES || null;
    for (const d of _5eData){
      if (d.cat !== 'item') continue;
      if (hiddenSrc && hiddenSrc.has(String(d._source || '').toLowerCase())) continue;
      const r = d._raw || {};
      if (!filter(r)) continue;
      const key = (d.name + '|' + (d._source||'')).toLowerCase();
      if (seen.has(key)) continue;
      const rarity = this._normRarity(r.rarity);
      const tCode = (r.type||'').split('|')[0];
      // Magic = anything with rarity above none/common gets treated as magic
      // for the magic/mundane toggle. Items with rarity 'common' (a thing
      // 5etools labels for cheap magic items like Spell Scroll 1st) are
      // treated as magic too.
      const rawRar = (r.rarity||'').toLowerCase();
      const isMagic = rawRar && rawRar !== 'none' && rawRar !== 'unknown';
      // User filters (rarity / category / magic-vs-mundane).
      if (!this._passesFilters(rarity, r.type, isMagic)) continue;
      seen.add(key);
      const category = TYPE_LABELS[tCode] || (rarity==='Common' ? 'Item' : 'Magic');
      const basePrice = (typeof r.value_cp === 'number' && r.value_cp > 0)
        ? r.value_cp / 100
        : this._magicPriceForRarity(rarity);
      out.push({ name: d.name, category, basePrice, rarity, _source: d._source });
    }
    // Append curated extras for shops that need them — also subject to user
    // filters (rarity + category + magic/mundane), so disabling "Food & Drink"
    // empties the Tavern's curated ales/inn-stays too.
    (this._shopExtras[shopType] || []).forEach(e => {
      const key = (e.name + '|extra').toLowerCase();
      if (seen.has(key)) return;
      // Curated extras are mundane (rarity none/common). Map their displayed
      // category to the filter bucket via a small reverse-lookup so the
      // toggle UX is consistent.
      const catLower = (e.category||'').toLowerCase();
      const extraCat = catLower.includes('drink') || catLower.includes('food') || catLower.includes('lodging') ? 'foodDrink'
                     : catLower.includes('book') ? 'tools'
                     : catLower.includes('gem') ? 'treasure'
                     : catLower.includes('jewel') || catLower.includes('ring') ? 'rings'
                     : catLower.includes('tool') ? 'tools'
                     : 'other';
      const f = (state.settings && state.settings.shopFilters) || {};
      const rarity = f.rarity || {};
      const cats = f.categories || {};
      if (rarity[e.rarity] === false) return;
      if (cats[extraCat] === false) return;
      if (f.includeMundane === false) return;
      seen.add(key);
      out.push(e);
    });
    // Shuffle so each Generate sees a different slice of the larger dataset
    // (Fisher-Yates), then cap to 80 entries. The downstream weighted shuffle
    // in _generate picks the actual inventory based on assortment fraction.
    for (let i = out.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out.length > 80 ? out.slice(0, 80) : out;
  },

  // Pick the live 5e-derived catalog when ready, otherwise fall back to the
  // hardcoded ITEM_CATALOG so generation works even on a cold page. If the
  // live catalog is non-null but empty, that means the user's filters have
  // excluded everything — return it as-is rather than secretly bypassing
  // their filters by falling back.
  _catalogFor(shopType){
    const live = this._buildShopCatalog(shopType);
    if (live !== null) return live;
    return ITEM_CATALOG[shopType] || ITEM_CATALOG['General Store'];
  },

  _generate(){
    const b=this._body;if(!b)return;
    const type=b.querySelector('#shop-type').value,price=b.querySelector('#shop-price').value,economy=b.querySelector('#shop-economy').value,assortment=b.querySelector('#shop-assort').value;
    const pm={Cheap:.7,Average:1,Expensive:1.3,Premium:1.6}[price];
    const em={Poor:.85,Average:1,Wealthy:1.15}[economy];
    // Catalog now comes from the full 5e dataset when loaded; falls back to
    // the hand-curated ITEM_CATALOG before _5eLoaded fires.
    const catalog=this._catalogFor(type);
    // Items per assortment is now configurable in shop settings; default
    // counts are Sparse:8, Standard:18, Abundant:32. Cap at catalog size.
    const sac = (state.settings && state.settings.shopAssortmentCounts) || DEFAULT_SETTINGS.shopAssortmentCounts;
    const desired = Math.max(1, parseInt(sac[assortment]) || DEFAULT_SETTINGS.shopAssortmentCounts[assortment]);
    const target = Math.max(1, Math.min(catalog.length, desired));
    const rw={Common:5,Uncommon:3,Rare:1.2,VeryRare:.4,Legendary:.15};
    // Weighted shuffle: assign each item score = random * rarityWeight, sort
    // descending, take top N. Rarer items rarely score high → end up rare.
    const chosen = [...catalog]
      .map(item => ({ item, score: Math.random() * (rw[item.rarity] || 1) }))
      .sort((a,b) => b.score - a.score)
      .slice(0, target)
      .map(x => x.item);
    const inventory=chosen.map(item=>{
      const j=state.settings.priceJitter/100,v=1+(Math.random()*2-1)*j;
      let p=item.basePrice*pm*em*v;const r=state.settings.rounding;
      if(r==='none')p=p<1?Math.round(p*100)/100:Math.round(p*10)/10;
      else{const n=parseInt(r)||1;p=Math.max(1,Math.round(p/n)*n);}
      const stock=Math.max(1,Math.floor(Math.random()*10)+(assortment==='Abundant'?4:assortment==='Sparse'?0:2));
      return{...item,price:p,stock};
    }).sort((a,b)=>a.category.localeCompare(b.category)||a.name.localeCompare(b.name));
    const prefixes=['Blade','Iron','Stone','Hearth','Silver','Old','Wandering','Black','Golden'];
    const sfxMap={'Blacksmith/Armory':['Foundry','Anvil','Smithy'],'General Store':['Sundries','Trading Post','Provisions'],'Alchemist':['Apothecary','Cauldron','Reagents'],'Magic Shop':['Curios','Arcanum','Enchantments'],'Tavern':['Tankard','Hearth','Inn'],'Jeweler':['Gemworks','Treasury'],'Bookshop':['Folio','Tome','Library'],'Fletcher':['Bowyer','Quiver']};
    const sfx=(sfxMap[type]||['Shop']);
    const name=`${prefixes[Math.floor(Math.random()*prefixes.length)]} ${sfx[Math.floor(Math.random()*sfx.length)]}`;
    // Defensive picks — fall back to literal strings if data-loader hasn't
    // populated these globals (or they failed to load). Without this guard,
    // Math.floor(Math.random() * undefined.length) throws and the whole
    // Generate Shop button is dead.
    const pick = (arr, fallback) => {
      if (!Array.isArray(arr) || arr.length === 0) return fallback;
      return arr[Math.floor(Math.random() * arr.length)];
    };
    const keeperList    = (typeof SHOPKEEPER_NAMES !== 'undefined') ? SHOPKEEPER_NAMES : null;
    const toneList      = (typeof TONES            !== 'undefined') ? TONES            : null;
    const quirksList    = (typeof QUIRKS           !== 'undefined') ? QUIRKS           : null;
    const aestheticsMap = (typeof AESTHETICS       !== 'undefined') ? AESTHETICS       : null;
    const aesthetic = aestheticsMap
      ? pick(aestheticsMap[type] || aestheticsMap['General Store'] || [], 'A quiet shop.')
      : 'A quiet shop.';
    const q1 = pick(quirksList, '');
    const q2 = pick(quirksList, '');
    state.shop={
      type, name,
      keeper: pick(keeperList, 'Shopkeeper'),
      tone:   pick(toneList,   'Cordial'),
      quirks: [q1, q2].filter((v,i,a) => v && a.indexOf(v)===i),
      aesthetic,
      inventory, meta:{price,economy,assortment}
    };
    save();
    this._invLimit = 20;
    const sd=b.querySelector('#shop-display');
    if(sd){ sd.innerHTML = this._renderDisplay(); this._wireDisplay(); }
    // The Save button gates on state.shop — re-render the controls column
    // header on Generate so the button (and saved-shops list ordering) refresh.
    this._render();
  },
  _fmtPrice(amt){const sym=state.settings.currencySymbol||'gp';if(amt<1)return`${amt.toFixed(2)}${sym}`;return`${Number.isInteger(amt)?amt:amt.toFixed(2)}${sym}`;}
});
