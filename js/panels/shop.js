// ============================================================
// SHOP PANEL
// ============================================================
registerPanel('shop',{
  title:'Shop Generator',icon:'$',
  mount(body){this._body=body;this._render();},
  unmount(){this._body=null;},
  _render(){
    const b=this._body;if(!b)return;
    const types=Object.keys(ITEM_CATALOG);
    b.innerHTML=`<div class="shop-layout">
      <div class="shop-controls">
        <div><label class="field-label">Shop Type</label><select id="shop-type">${types.map(t=>`<option ${state.shop?.type===t?'selected':''}>${t}</option>`).join('')}</select></div>
        <div><label class="field-label">Shop Price</label><select id="shop-price"><option>Cheap</option><option selected>Average</option><option>Expensive</option><option>Premium</option></select></div>
        <div><label class="field-label">Town Economy</label><select id="shop-economy"><option>Poor</option><option selected>Average</option><option>Wealthy</option></select></div>
        <div><label class="field-label">Assortment</label><select id="shop-assort"><option>Sparse</option><option selected>Standard</option><option>Abundant</option></select></div>
        <button class="btn primary" data-act="gen" style="margin-top:4px">Generate Shop</button>
      </div>
      <div class="shop-display" id="shop-display">${this._renderDisplay()}</div>
    </div>`;
    b.querySelector('[data-act="gen"]').addEventListener('click',e=>{e.stopPropagation();this._generate();});
  },
  _renderDisplay(){
    if(!state.shop)return'<div class="empty-state">Configure settings and click Generate Shop.</div>';
    const s=state.shop;
    return`<div class="shop-section"><div class="shop-name">${esc(s.name)} <span class="shop-type">(${esc(s.type)})</span></div><div class="meta-line" style="margin-top:4px">Wealth: ${s.meta.economy} · Band: ${s.meta.price} · Assortment: ${s.meta.assortment}</div></div>
    <div class="shop-section"><h3>Shopkeeper</h3><div><strong>${esc(s.keeper)}</strong> · ${esc(s.tone)}</div><div class="meta-line" style="margin-top:4px">Quirks: ${s.quirks.map(esc).join(', ')}</div></div>
    <div class="shop-section"><h3>Aesthetic</h3><div class="meta-line" style="font-style:italic">${esc(s.aesthetic)}</div></div>
    <div class="shop-section" style="padding:0"><h3 style="padding:12px 14px 6px">Inventory</h3>
    <table class="shop-table"><thead><tr><th>Item</th><th>Category</th><th>Rarity</th><th>Price</th><th>Stock</th></tr></thead>
    <tbody>${s.inventory.map(item=>`<tr><td>${esc(item.name)}</td><td>${esc(item.category)}</td><td><span class="rarity-badge rarity-${item.rarity.replace(/\s/,'')}">${item.rarity}</span></td><td>${this._fmtPrice(item.price)}</td><td>×${item.stock}</td></tr>`).join('')}</tbody></table>
    <div style="padding:8px 14px;font-size:11px;color:var(--text-muted)">Showing ${s.inventory.length} item(s)</div></div>`;
  },
  _generate(){
    const b=this._body;if(!b)return;
    const type=b.querySelector('#shop-type').value,price=b.querySelector('#shop-price').value,economy=b.querySelector('#shop-economy').value,assortment=b.querySelector('#shop-assort').value;
    const pm={Cheap:.7,Average:1,Expensive:1.3,Premium:1.6}[price];
    const em={Poor:.85,Average:1,Wealthy:1.15}[economy];
    // Target a FRACTION of the catalog rather than a fixed count, so different
    // shop types yield genuinely different-sized inventories and there's always
    // headroom for randomness. Was: fixed 8/14/22 — but most catalogs only have
    // 5-17 items, so target == catalog.length and every shop showed everything.
    const fraction={Sparse:0.45,Standard:0.7,Abundant:0.95}[assortment];
    const catalog=ITEM_CATALOG[type]||ITEM_CATALOG['General Store'];
    const target=Math.max(3, Math.min(catalog.length, Math.round(catalog.length * fraction)));
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
    state.shop={type,name,keeper:SHOPKEEPER_NAMES[Math.floor(Math.random()*SHOPKEEPER_NAMES.length)],tone:TONES[Math.floor(Math.random()*TONES.length)],quirks:[QUIRKS[Math.floor(Math.random()*QUIRKS.length)],QUIRKS[Math.floor(Math.random()*QUIRKS.length)]].filter((v,i,a)=>a.indexOf(v)===i),aesthetic:(AESTHETICS[type]||AESTHETICS['General Store'])[Math.floor(Math.random()*3)],inventory,meta:{price,economy,assortment}};
    save();
    const sd=b.querySelector('#shop-display');if(sd)sd.innerHTML=this._renderDisplay();
  },
  _fmtPrice(amt){const sym=state.settings.currencySymbol||'gp';if(amt<1)return`${amt.toFixed(2)}${sym}`;return`${Number.isInteger(amt)?amt:amt.toFixed(2)}${sym}`;}
});
