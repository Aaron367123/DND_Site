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
  unmount(){
    // Modal backdrops are appended to document.body, so they outlive the panel
    // window. If the user closes the shop while its item-detail or settings
    // modal is open, that backdrop would otherwise be orphaned over the
    // workspace forever. Sweep any shop-owned backdrops here.
    document.querySelectorAll('.modal-backdrop[data-shop-modal]').forEach(el => el.remove());
    this._body=null;
  },
  _saveShops(){ saveJson('skt-shops-v1', {saved:this._saved}, 'saved shops'); },
  _render(){
    const b=this._body;if(!b)return;
    const types=Object.keys(ITEM_CATALOG);
    b.innerHTML=`<div class="shop-layout">
      <div class="shop-controls">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:4px">
          <span class="field-label" style="margin:0">Shop</span>
          <button class="btn icon-btn" data-act="settings" title="Pricing settings (currency, jitter, rounding)" style="padding:2px 6px;font-size:var(--fs-lg);line-height:1">${ICO('i-gear')}</button>
        </div>
        <div><label class="field-label">Shop Type</label><select id="shop-type">${types.map(t=>`<option ${state.shop?.type===t?'selected':''}>${t}</option>`).join('')}</select></div>
        <div><label class="field-label">Shop Price</label><select id="shop-price"><option>Cheap</option><option selected>Average</option><option>Expensive</option><option>Premium</option></select></div>
        <div><label class="field-label">Town Economy</label><select id="shop-economy"><option>Poor</option><option selected>Average</option><option>Wealthy</option></select></div>
        <div><label class="field-label">Assortment</label><select id="shop-assort"><option>Sparse</option><option selected>Standard</option><option>Abundant</option></select></div>
        <button class="btn primary" data-act="gen" style="margin-top:4px">Generate Shop</button>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="btn small" data-act="save-shop" style="flex:1" ${!state.shop?'disabled title="Generate a shop first"':''}>${ICO('i-save')} Save</button>
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
      + this._saved.map(s => `<div style="display:flex;align-items:center;gap:4px;background:var(--panel-2);border:1px solid var(--border);border-radius:3px;padding:3px 5px;font-size:var(--fs-sm)">
          <button class="btn small" data-act="load-shop" data-sid="${esc(s.id)}" style="flex:1;text-align:left;padding:2px 6px;font-size:var(--fs-sm);justify-content:flex-start" title="Load — ${esc(s.shop?.type||'')}">${esc(s.name)}</button>
          <button class="btn icon-btn danger" data-act="del-shop" data-sid="${esc(s.id)}" title="Delete saved shop" style="padding:1px 4px;font-size:var(--fs-xs)">×</button>
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
    // Item-name click → open a modal with the full 5etools detail. Falls
    // back to a "no description available" note for curated extras (ales,
    // lodging, etc.) that aren't backed by 5etools data.
    b.querySelectorAll('[data-act="show-item"]').forEach(el => el.addEventListener('click', e => {
      e.preventDefault();
      const i = +el.dataset.idx;
      const inv = state.shop?.inventory; if (!inv || !inv[i]) return;
      this._openItemDetail(inv[i]);
    }));
  },

  // Find the matching _5eData entry by (name, source) and render its full
  // description in a modal. Reuses renderItemFull() from search.js so the
  // formatting matches everywhere else in the app.
  _openItemDetail(item){
    if (!item) return;
    let detail = null;
    if (typeof _5eLoaded !== 'undefined' && _5eLoaded && Array.isArray(_5eData)){
      const wantName = (item.name || '').toLowerCase();
      const wantSrc  = (item._source || '').toLowerCase();
      // Try exact name+source first, fall back to name only (covers curated
      // extras and any items whose source was lost in shop catalog building).
      detail = _5eData.find(d => d.cat === 'item'
        && (d.name||'').toLowerCase() === wantName
        && (d._source||'').toLowerCase() === wantSrc)
        || _5eData.find(d => d.cat === 'item' && (d.name||'').toLowerCase() === wantName);
    }
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop'; backdrop.dataset.shopModal = '1';
    let bodyHtml;
    if (detail && typeof renderItemFull === 'function'){
      bodyHtml = renderItemFull(detail);
    } else if (detail && detail.desc){
      bodyHtml = '<div style="white-space:pre-wrap;font-size:var(--fs-md);line-height:1.55">' + esc(detail.desc) + '</div>';
    } else {
      bodyHtml = '<div style="color:var(--text-muted);font-size:var(--fs-md);font-style:italic">No description available for this item — likely a curated shop extra (food, lodging, etc.).</div>';
    }
    // Source-book tag — pulled from the canonical _5eData entry when available,
    // falling back to the shop catalog's stored _source. Renders as a small
    // accent pill at the right of the meta line so the user can see at a
    // glance which book the item is from (helpful when curating sources).
    const sourceTag = (() => {
      const src = (detail && detail._source) || item._source || '';
      if (!src) return '';
      return '<span class="shop-item-source-tag" title="Source book">' + esc(src) + '</span>';
    })();
    const priceLine = '<div style="font-size:var(--fs-sm);color:var(--text-muted);margin-bottom:10px;display:flex;align-items:center;gap:8px"><span>Category: ' + esc(item.category) + ' · Rarity: ' + esc(item.rarity) + ' · Price: ' + esc(this._fmtPrice(item.price)) + '</span><span style="flex:1"></span>' + sourceTag + '</div>';
    backdrop.innerHTML = '<div class="modal" role="dialog" aria-modal="true" style="width:560px;max-width:94vw;max-height:88vh;display:flex;flex-direction:column">'
      + '<h3 style="margin:0 0 4px;display:flex;align-items:center;gap:8px"><span style="font-size:var(--fs-2xl)">📜</span> ' + esc(item.name) + '</h3>'
      + priceLine
      + '<div style="flex:1;overflow-y:auto;padding-right:4px">' + bodyHtml + '</div>'
      + '<div class="modal-actions" style="margin-top:12px">'
      +   '<span style="flex:1"></span>'
      +   '<button class="btn primary" id="shop-item-close">Close</button>'
      + '</div></div>';
    document.body.appendChild(backdrop);
    // Escape must be bound on document, not the backdrop: a plain <div> isn't
    // focusable, so it never receives keydown and the old backdrop listener
    // never fired. close() removes the document listener so it can't leak.
    const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    backdrop.querySelector('#shop-item-close').addEventListener('click', close);
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', onKey);
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
      saveJson('skt-loot-v1', cur, 'loot');
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
    backdrop.className='modal-backdrop'; backdrop.dataset.shopModal='1';
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
    // Migrate the legacy `excludeFirearms` flag to the new tech-level radio,
    // and fill in any new-key defaults so the UI controls all bind cleanly
    // even on saves from before these toggles existed.
    if (sf.excludeFirearms === true && !sf.techLevel) sf.techLevel = 'medieval';
    ['maxPrice','hideAttunement','hideCursed','hideSentient','hideArtifacts',
     'excludeConsumables','techLevel','maxScrollLevel','blocklist','rarityBias'
    ].forEach(k => { if (sf[k] === undefined) sf[k] = DEFAULT_SETTINGS.shopFilters[k]; });
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
          <label>Price jitter <span id="shop-jit-val" style="float:right;color:var(--text-muted);font-size:var(--fs-sm)">${jit}%</span></label>
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
          <div class="shop-filter-head"><span>Restrictions</span></div>
          <div class="shop-filter-grid shop-filter-grid-1col">
            ${cb('shop-hide-att',   'Hide attunement-required items',   !!sf.hideAttunement)}
            ${cb('shop-hide-curse', 'Hide cursed items',                !!sf.hideCursed)}
            ${cb('shop-hide-sent',  'Hide sentient items',              !!sf.hideSentient)}
            ${cb('shop-hide-art',   'Hide artifacts',                   !!sf.hideArtifacts)}
            ${cb('shop-no-cons',    'Exclude consumables',              !!sf.excludeConsumables)}
          </div>
          <p class="shop-filter-note" style="margin:4px 0 8px;font-size:var(--fs-xs)">Consumables = potions, scrolls, ammunition.</p>
          <div class="shop-filter-slider">
            <div class="shop-filter-slider-row">
              <span>Max spell scroll level</span>
              <span class="shop-filter-slider-val" id="shop-scroll-val">${sf.maxScrollLevel >= 10 ? 'No cap' : (sf.maxScrollLevel === 0 ? 'None' : (sf.maxScrollLevel === 1 ? 'Cantrip + 1st' : sf.maxScrollLevel+(['','st','nd','rd'][sf.maxScrollLevel]||'th')))}</span>
            </div>
            <input type="range" id="shop-scroll" min="0" max="10" step="1" value="${sf.maxScrollLevel}">
          </div>
        </div>

        <div class="shop-filter-section">
          <div class="shop-filter-head"><span>Era</span></div>
          <div class="shop-filter-radio-row">
            ${['any','medieval','renaissance','modern'].map(t => `
              <label class="shop-filter-radio${sf.techLevel===t?' active':''}">
                <input type="radio" name="shop-tech" value="${t}" ${sf.techLevel===t?'checked':''}>
                <span>${t.charAt(0).toUpperCase()+t.slice(1)}</span>
              </label>
            `).join('')}
          </div>
          <p class="shop-filter-note" style="margin-top:6px">Medieval: no firearms/lasers. Renaissance: muskets &amp; pistols return. Modern: rifles &amp; semi-autos too.</p>
        </div>

        <div class="shop-filter-section">
          <div class="shop-filter-head"><span>Price cap</span></div>
          <div class="shop-filter-price-row">
            <label for="shop-maxprice" style="font-size:var(--fs-sm);color:var(--text-muted)">Max item price (gp)</label>
            <input type="number" id="shop-maxprice" min="0" step="50" value="${sf.maxPrice||0}" placeholder="0 = no cap" style="width:120px">
          </div>
          <p class="shop-filter-note" style="margin-top:4px">Try <strong>100</strong> for a village peddler, <strong>5000</strong> for a city emporium, <strong>50000</strong> for a capital city. <strong>0</strong> = no limit.</p>
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
          <div class="shop-filter-slider shop-filter-bias" style="margin-top:8px">
            <div class="shop-filter-slider-row">
              <span>Bias <span style="color:var(--text-dim)">(common ↔ rare)</span></span>
              <span class="shop-filter-slider-val" id="shop-bias-val">${sf.rarityBias > 0 ? '+'+sf.rarityBias : sf.rarityBias}</span>
            </div>
            <input type="range" id="shop-bias" min="-100" max="100" step="5" value="${sf.rarityBias||0}">
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

        <details class="shop-filter-section shop-filter-blocklist">
          <summary>Custom blocklist (advanced)</summary>
          <p class="shop-filter-note" style="margin:6px 0 4px">One item name per line. Matched case-insensitively against the full item name.</p>
          <textarea id="shop-blocklist" rows="6" placeholder="Sword of Sharpness&#10;Bag of Holding&#10;…">${(sf.blocklist||'').replace(/</g,'&lt;')}</textarea>
        </details>

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
    // Restriction checkboxes.
    backdrop.querySelector('#shop-hide-att')  ?.addEventListener('change', e => { sf.hideAttunement     = e.target.checked; save(); });
    backdrop.querySelector('#shop-hide-curse')?.addEventListener('change', e => { sf.hideCursed         = e.target.checked; save(); });
    backdrop.querySelector('#shop-hide-sent') ?.addEventListener('change', e => { sf.hideSentient       = e.target.checked; save(); });
    backdrop.querySelector('#shop-hide-art')  ?.addEventListener('change', e => { sf.hideArtifacts      = e.target.checked; save(); });
    backdrop.querySelector('#shop-no-cons')   ?.addEventListener('change', e => { sf.excludeConsumables = e.target.checked; save(); });
    // Era radios — set techLevel and clear the legacy excludeFirearms flag.
    backdrop.querySelectorAll('input[name="shop-tech"]').forEach(rb => rb.addEventListener('change', e => {
      if (!e.target.checked) return;
      sf.techLevel = e.target.value;
      sf.excludeFirearms = false; // legacy flag retired in favour of techLevel
      backdrop.querySelectorAll('.shop-filter-radio').forEach(l => l.classList.toggle('active', l.querySelector('input').checked));
      save();
    }));
    // Max-price input.
    backdrop.querySelector('#shop-maxprice')?.addEventListener('change', e => {
      sf.maxPrice = Math.max(0, parseInt(e.target.value)||0);
      e.target.value = sf.maxPrice;
      save();
    });
    // Spell-scroll cap slider.
    const scrollEl = backdrop.querySelector('#shop-scroll');
    const scrollValEl = backdrop.querySelector('#shop-scroll-val');
    const scrollLabel = (v) => {
      if (v >= 10) return 'No cap';
      if (v === 0) return 'None';
      if (v === 1) return 'Cantrip + 1st';
      return v + (['','st','nd','rd'][v] || 'th');
    };
    if (scrollEl){
      scrollEl.addEventListener('input',  e => { if (scrollValEl) scrollValEl.textContent = scrollLabel(parseInt(e.target.value)); });
      scrollEl.addEventListener('change', e => { sf.maxScrollLevel = parseInt(e.target.value); save(); });
    }
    // Rarity-bias slider.
    const biasEl = backdrop.querySelector('#shop-bias');
    const biasValEl = backdrop.querySelector('#shop-bias-val');
    if (biasEl){
      biasEl.addEventListener('input', e => {
        const v = parseInt(e.target.value);
        if (biasValEl) biasValEl.textContent = v > 0 ? '+'+v : String(v);
      });
      biasEl.addEventListener('change', e => { sf.rarityBias = parseInt(e.target.value); save(); });
    }
    // Custom blocklist textarea.
    backdrop.querySelector('#shop-blocklist')?.addEventListener('input', e => {
      sf.blocklist = e.target.value;
      save();
    });

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
    // A shop object that is missing the fields the render needs is not a shop.
    // `!state.shop` alone let an empty object through — {} is truthy — and the
    // render then read s.meta.economy off undefined and threw, which takes the
    // whole panel down: no shop, no controls, no way back short of a reload.
    // An empty object is not exotic either. It is what a partial sync, a
    // restore from a backup written before a field existed, or a hand-edited
    // key all look like.
    const _shopIsUsable = s => !!(s && typeof s === 'object' && !Array.isArray(s)
      && s.meta && Array.isArray(s.inventory) && Array.isArray(s.quirks));
    if(!_shopIsUsable(state.shop))return'<div class="empty-state">Configure settings and click Generate Shop.</div>';
    const s=state.shop;
    const inv = s.inventory || [];
    const limit = Math.max(0, Math.min(this._invLimit || 20, inv.length));
    const shown = inv.slice(0, limit);
    const remaining = inv.length - limit;
    const rowsHtml = shown.map((item, i) => {
      const out = (item.stock||0) <= 0;
      // Make the name a clickable link if the item exists in _5eData — clicking
      // pops open the full description. We don't bother checking up-front
      // because the lookup is cheap; the handler shows a friendly fallback
      // for curated extras (ales, lodging, etc.) that aren't in 5etools data.
      return `<tr class="${out?'shop-out':''}">
        <td><a class="shop-item-name" href="javascript:void(0)" data-act="show-item" data-idx="${i}" title="Click to view item details">${esc(item.name)}</a></td>
        <td>${esc(item.category)}</td>
        <td><span class="rarity-badge rarity-${item.rarity.replace(/\s/,'')}">${item.rarity}</span></td>
        <td>${this._fmtPrice(item.price)}</td>
        <td>${out ? '<span style="color:var(--text-dim);font-size:var(--fs-sm)">out</span>' : '×'+item.stock}</td>
        <td style="text-align:right;padding-right:14px">
          <button class="btn small" data-act="buy-item" data-idx="${i}" ${out?'disabled title="Out of stock"':'title="Buy one (decrements stock, adds to Loot tracker)"'} style="padding:1px 8px;font-size:var(--fs-sm)">Buy</button>
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
         <div style="padding:8px 14px;font-size:var(--fs-sm);color:var(--text-muted);display:flex;align-items:center;gap:10px">
           <span>Showing ${shown.length} of ${inv.length} item(s)</span>
           ${remaining > 0 ? `<button class="btn small" data-act="show-more-inv" style="padding:2px 8px;font-size:var(--fs-sm)">Show ${Math.min(20, remaining)} more</button>` : ''}
           ${remaining > 0 ? `<button class="btn small" data-act="show-more-inv" data-mode="all" style="padding:2px 8px;font-size:var(--fs-sm)">Show all</button>` : ''}
         </div>`
      : `<div style="padding:18px 14px;font-size:var(--fs-md);color:var(--text-muted);text-align:center">No items match the active filters. Open <strong>settings</strong> to allow more rarities or categories.</div>`
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
      // Armor (HA/MA/LA/S), melee weapons (M), and mundane ammunition (A:
      // arrows/bolts/bullets — smithed metal parts). Mundane only — magic
      // pieces flow through Magic Shop.
      return ['HA','MA','LA','S','M','A'].includes(t)
        && (r.rarity==='none' || !r.rarity || r.rarity==='unknown');
    },
    'General Store': r => {
      const t = (r.type||'').split('|')[0];
      // Added SCF (spellcasting foci — orbs/crystals/druidic foci, 77 items)
      // and TB (trinkets) so general stores actually feel general.
      return ['G','AT','T','GS','TAH','TG','INS','OTH','SCF','TB'].includes(t)
        && (r.rarity==='none' || !r.rarity || r.rarity==='unknown');
    },
    'Alchemist': r => {
      const t = (r.type||'').split('|')[0];
      if (t === 'P') return true;           // potions
      if (t === 'EXP') return true;         // bombs, alchemist's fire, acid flasks
      const n = (r.name||'').toLowerCase();
      return /^(acid|antitoxin|alchemist's fire|holy water|oil|basic poison|perfume|incense|soap|tindertwig|smokestick|smokepowder)\b/.test(n);
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
      // 5etools treasure type codes are `$A` (art objects), `$G` (gems),
      // `$C` (coinage), `$?` (uncategorized) — NOT plain `$`. The old check
      // `t === '$'` matched zero items, so every gem (Diamond, Ruby, etc.)
      // was excluded from the Jeweler. Match the whole `$*` family instead.
      if (t.startsWith('$')) return true;
      if (t === 'RG' && (rar==='none' || rar==='common' || rar==='uncommon' || rar==='rare')) return true;
      return /^(gemstone|silver ring|gold ring|pearl)\b/i.test(r.name||'');
    },
    'Bookshop': r => {
      const t = (r.type||'').split('|')[0];
      if (t === 'SC') return true;          // spell scrolls
      // Magic books/tomes/manuals/codices/folios/libram — typed OTH but
      // clearly belong on a bookshop's shelf.
      return /^(book|tome|manual|codex|folio|libram|grimoire) of\b/i.test(r.name||'');
    },
    'Fletcher': r => {
      const t = (r.type||'').split('|')[0];
      const rar = (r.rarity||'').toLowerCase();
      // R (ranged weapons), A (mundane ammo), AF (firearm ammo — gated by
      // techLevel filter elsewhere if the campaign forbids guns).
      return (t === 'R' || t === 'A' || t === 'AF') && (rar==='none' || !rar || rar==='unknown');
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
    // 5etools treasure codes are `$A` (art) / `$G` (gem) / `$C` (coinage)
    // / `$?` (uncategorized). Plain `$` never appears. Bucket the entire
    // family into the existing 'treasure' category.
    if (t && t.charAt(0) === '$') return 'treasure';
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

  // Detect firearms (pistols, rifles, laser/antimatter weapons, etc.) so the
  // "Exclude firearms" toggle in the shop settings can filter them out.
  // Two signals:
  //   1. `age` field — 5etools tags every classic firearm with one of
  //      'renaissance' | 'modern' | 'futuristic'. Most reliable detector.
  //   2. Property "AF" (ammunition-firearm) — picks up older PHB/DMG entries
  //      whose age might be missing.
  //   3. Name pattern — XPHB-2024 demoted muskets/pistols/revolvers to plain
  //      martial ranged weapons (no age, no AF property). Keyword-match the
  //      common firearm names so they still get filtered.
  _isFirearm(r){
    if (!r) return false;
    const age = String(r.age || '').toLowerCase();
    if (age === 'renaissance' || age === 'modern' || age === 'futuristic') return true;
    const props = Array.isArray(r.property) ? r.property : [];
    if (props.some(p => /^AF($|\|)/.test(String(p)))) return true;
    const n = String(r.name || '').toLowerCase();
    return /\b(pistol|revolver|musket|rifle|carbine|shotgun|firearm|laser|antimatter|machine gun|gatling|hunting rifle|automatic)\b/.test(n);
  },

  // ─── Additional content filters ────────────────────────────────────────
  _isAttunement(r){ return !!(r && r.reqAttune); },
  _isCursed(r){     return !!(r && r.curse); },
  _isSentient(r){   return !!(r && r.sentient); },
  _isArtifact(r){   return String(r && r.rarity || '').toLowerCase() === 'artifact'; },
  _isConsumable(r){
    const t = String(r && r.type || '').split('|')[0];
    return t === 'P' || t === 'SC' || t === 'A';
  },
  // `allowed` is one of 'any' | 'medieval' | 'renaissance' | 'modern'.
  // 5etools tags renaissance/modern/futuristic via the `age` field BUT the
  // XPHB-2024 reprints of muskets/pistols/rifles dropped that tag entirely.
  // So we can't just trust `age === undefined → medieval`; we have to also
  // run firearm detection by name + property and assign a synthetic tier
  // when age is missing.
  _techLevelAllowed(r, allowed){
    if (!allowed || allowed === 'any') return true;
    const order = ['medieval','renaissance','modern','futuristic'];
    const max = order.indexOf(allowed);
    if (max < 0) return true;
    const age = String(r && r.age || '').toLowerCase();
    if (age){
      const i = order.indexOf(age);
      return i >= 0 && i <= max;
    }
    // No age tag. If the item is detectably a firearm (name pattern, AF
    // property), infer its tier from the name so XPHB muskets/pistols still
    // get blocked at medieval and modern rifles still get blocked at
    // renaissance, etc. Non-firearms with no age → medieval (the default,
    // always allowed for any tech-level setting).
    if (this._isFirearm(r)){
      const n = String(r.name || '').toLowerCase();
      // Futuristic: energy weapons.
      if (/(laser|antimatter|plasma|disintegrat|phaser|blaster)/.test(n))   return max >= 3;
      // Modern: rifles, automatics, shotguns, machine guns.
      if (/(automatic|rifle|machine gun|gatling|shotgun|carbine|hunting rifle|semi)/.test(n)) return max >= 2;
      // Renaissance: musket, pistol, revolver (powder firearms).
      return max >= 1;
    }
    return true;
  },
  // Test a (post-shaping) catalog row name against a spell-scroll cap. 10 = no cap.
  _scrollLevelOK(item, maxLevel){
    if (maxLevel == null || maxLevel >= 10) return true;
    const m = /^Spell Scroll \((?:(\d+)(?:st|nd|rd|th)? Level|(Cantrip))\)$/i.exec(item.name || '');
    if (!m) return true; // not a scroll
    const lvl = m[2] ? 0 : parseInt(m[1]);
    return lvl <= maxLevel;
  },
  _isBlocked(item, blocklistSet){
    if (!blocklistSet || !blocklistSet.size) return false;
    return blocklistSet.has(String(item.name || '').toLowerCase().trim());
  },
  // Rarity-bias multiplier — slider value in [-100, 100]. Negative biases
  // toward Common/Uncommon, positive biases toward Rare/VeryRare/Legendary.
  // Returns ~0.25–4× depending on slider extremity. 0 returns 1 for all.
  _biasMultiplier(rarityBucket, slider){
    if (!slider) return 1;
    const tier = { Common: -2, Uncommon: -1, Rare: 1, VeryRare: 2, Legendary: 3 }[rarityBucket] || 0;
    // Map slider [-100, 100] to exponent in [-1.4, 1.4] (so 2^±1.4 ≈ 0.38–2.6).
    const s = Math.max(-100, Math.min(100, slider)) / 100;
    return Math.pow(2, s * tier * 0.7);
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
    // Per-consumer scope test — honors `state.settings.hiddenSourceScope.shop`
    // so the user can have books/adventures hidden EVERYWHERE except here
    // (or vice versa).
    const isHidden = (src) => window.SKT_IS_SOURCE_HIDDEN
      ? window.SKT_IS_SOURCE_HIDDEN('shop', src)
      : !!(window.SKT_HIDDEN_SOURCES && window.SKT_HIDDEN_SOURCES.has(String(src||'').toLowerCase()));
    const sf = (state.settings && state.settings.shopFilters) || {};
    // Exclude-firearms / new tech-level radio. The tech-level filter is the
    // newer general control; the boolean stays around for back-compat.
    const skipFirearms = !!sf.excludeFirearms;
    const techLevel = sf.techLevel || 'any';
    const maxPrice = +sf.maxPrice || 0;
    const maxScroll = (sf.maxScrollLevel == null) ? 10 : +sf.maxScrollLevel;
    const blocklistSet = new Set(
      String(sf.blocklist || '').split('\n').map(s => s.trim().toLowerCase()).filter(Boolean)
    );
    for (const d of _5eData){
      if (d.cat !== 'item') continue;
      if (isHidden(d._source)) continue;
      const r = d._raw || {};
      if (skipFirearms && this._isFirearm(r)) continue;
      if (!this._techLevelAllowed(r, techLevel)) continue;
      if (sf.hideAttunement     && this._isAttunement(r)) continue;
      if (sf.hideCursed         && this._isCursed(r))     continue;
      if (sf.hideSentient       && this._isSentient(r))   continue;
      if (sf.hideArtifacts      && this._isArtifact(r))   continue;
      if (sf.excludeConsumables && this._isConsumable(r)) continue;
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
      const category = TYPE_LABELS[tCode] || (rarity==='Common' ? 'Item' : 'Magic');
      const basePrice = (typeof r.value_cp === 'number' && r.value_cp > 0)
        ? r.value_cp / 100
        : this._magicPriceForRarity(rarity);
      // Post-shape filters: price cap, scroll-level cap, custom blocklist.
      const shaped = { name: d.name, category, basePrice, rarity, _source: d._source };
      if (maxPrice > 0 && shaped.basePrice > maxPrice) continue;
      if (!this._scrollLevelOK(shaped, maxScroll)) continue;
      if (this._isBlocked(shaped, blocklistSet)) continue;
      seen.add(key);
      out.push(shaped);
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
      // Apply the same post-shape filters as the catalog items.
      if (maxPrice > 0 && (e.basePrice || 0) > maxPrice) return;
      if (this._isBlocked(e, blocklistSet)) return;
      // Match the main catalog's "consumable" definition (P/SC/A + food/drink).
      // Curated extras carry a free-text `category`, so detect by substring:
      // potions, scrolls, ammunition and food/drink all count.
      if (f.excludeConsumables && /drink|food|potion|consumable|scroll|ammo/.test(catLower)) return;
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
    let target = Math.max(1, Math.min(catalog.length, desired));
    // Variety guard — when the requested assortment would take essentially
    // every item in the catalog (e.g. Tavern only has ~13 food/drink items
    // but Standard wants 18), the weighted-shuffle has nothing to leave out
    // and the same inventory comes back every Generate. Drop a random
    // 15-30% so each re-roll sees a different ~70-85% slice.
    // Only kicks in when target consumes ≥90% of the catalog.
    if (catalog.length >= 4 && target >= catalog.length * 0.9){
      const dropFrac = 0.15 + Math.random() * 0.15;
      target = Math.max(2, Math.floor(catalog.length * (1 - dropFrac)));
    }
    const rw={Common:5,Uncommon:3,Rare:1.2,VeryRare:.4,Legendary:.15};
    // Rarity-bias slider (-100…+100): multiplies the per-tier weights so the
    // user can skew the mix toward common (negative) or rare (positive) without
    // having to toggle individual rarity checkboxes off.
    const bias = (state.settings && state.settings.shopFilters && state.settings.shopFilters.rarityBias) || 0;
    // Weighted shuffle: assign each item score = random * rarityWeight * bias,
    // sort descending, take top N. Rarer items rarely score high → end up rare.
    const chosen = [...catalog]
      .map(item => ({ item, score: Math.random() * (rw[item.rarity] || 1) * this._biasMultiplier(item.rarity, bias) }))
      .sort((a,b) => b.score - a.score)
      .slice(0, target)
      .map(x => x.item);
    const inventory=chosen.map(item=>{
      const j=state.settings.priceJitter/100,v=1+(Math.random()*2-1)*j;
      let p=item.basePrice*pm*em*v;const r=state.settings.rounding;
      // Floor at a copper piece. Rounding to 2dp sent anything under half a
      // copper to zero, and the cheapest ammunition is 2cp before a jitter
      // that can take 27% off it — so roughly one item in forty was on sale
      // for nothing. The other rounding branch already floors at 1gp; this
      // one floored at nothing at all.
      if(r==='none')p=Math.max(0.01, p<1?Math.round(p*100)/100:Math.round(p*10)/10);
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
