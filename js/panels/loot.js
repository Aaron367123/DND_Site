// ============================================================
// LOOT TRACKER PANEL
// ============================================================
registerPanel('loot',{
  title:'Loot Tracker',icon:'💰',
  _loot:null,
  _view:'all',          // 'all' | 'party' | 'unassigned' | 'tabgroup:<id>'
  _searchQ:'',          // current text in the name/search input
  _searchOpen:false,    // dropdown visibility
  mount(body){
    this._body=body;
    if(!this._loot){try{const r=localStorage.getItem('skt-loot-v1');this._loot=r?JSON.parse(r):{cp:0,sp:0,ep:0,gp:0,pp:0,items:[],tabGroups:[]};}catch(e){this._loot={cp:0,sp:0,ep:0,gp:0,pp:0,items:[],tabGroups:[]}}
    if(!this._loot.items)this._loot.items=[];
    if(!Array.isArray(this._loot.tabGroups))this._loot.tabGroups=[];
    // Migrate items to current shape: `claimed` → `assignedTo`. Drop the old
    // `group` text-tag field that no longer exists in the UI.
    this._loot.items.forEach(it => {
      if (it.assignedTo === undefined) it.assignedTo = null;
      if ('group' in it) delete it.group;
    });}
    this._render();
    // Refresh the dropdown once 5e data finishes loading so suggestions appear
    // even if the user opened the panel before the load completed.
    if (typeof on5eLoaded === 'function') on5eLoaded(() => { if (this._body) this._renderSearchDropdown(); });
    if (typeof load5eData === 'function') load5eData();
  },
  unmount(){this._body=null;},
  _save(){saveJson('skt-loot-v1', this._loot, 'loot');},

  // ─── Random treasure (DMG loot tables) ─────────────────────────────────────
  // data/loot.json ships with the 5etools dump but nothing read it. It holds
  // the individual/hoard treasure tables by CR band, the gem and art-object
  // lists by value, and magic item tables A–I.
  //
  // Fetched on FIRST USE, not at boot: it's 158 KB that most sessions never
  // open, and the boot path is already the app's slowest moment.
  _lootTables: null,
  _lootTablesPromise: null,
  _ensureLootTables(){
    if (this._lootTables) return Promise.resolve(this._lootTables);
    if (this._lootTablesPromise) return this._lootTablesPromise;
    this._lootTablesPromise = fetch('data/loot.json')
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(j => { this._lootTables = j; return j; })
      .catch(e => {
        this._lootTablesPromise = null;   // let a later attempt retry
        if (typeof sktErrors !== 'undefined') sktErrors.report('loot:tables', e);
        if (typeof showToast === 'function') showToast('Could not load the treasure tables');
        return null;
      });
    return this._lootTablesPromise;
  },

  // "5d6", "6d6*100", "2d6*10", "1d4-1" — every shape these tables actually
  // use. The trailing +/- matters: the 2024 CR 0-4 hoard is "1d4-1" magic
  // items, so without it that band would always hand out at least one.
  // A bare number is allowed so a fixed quantity can't blow up the roll.
  _rollDice(expr){
    if (typeof expr === 'number') return expr;
    const m = /^\s*(\d+)\s*d\s*(\d+)\s*(?:\*\s*(\d+))?\s*(?:([+-])\s*(\d+))?\s*$/i.exec(String(expr||''));
    if (!m) { const n = parseInt(expr, 10); return isNaN(n) ? 0 : n; }
    const count = +m[1], sides = +m[2], mult = m[3] ? +m[3] : 1;
    let total = 0;
    for (let i = 0; i < count; i++) total += 1 + Math.floor(Math.random() * sides);
    total *= mult;
    if (m[4]) total += (m[4] === '-' ? -1 : 1) * (+m[5]);
    return Math.max(0, total);
  },

  // Resolve a magic-item table row to a name.
  //
  // 8% of the 2014 rows (29 of 364) and 14% of the 2024 rows carry no literal
  // `item` — they carry a `choose`, and the first version of this roller
  // silently dropped every one of them, so roughly one magic item roll in
  // twelve produced nothing at all. Four shapes exist:
  //
  //   fromItems    an explicit list        → pick one, exact
  //   fromMatching {rarity}                → any magic item of that rarity;
  //                                          resolved against the loaded 5e
  //                                          index, which is what the 2024
  //                                          byLevel tables are built on
  //   fromGroup    a named family          → e.g. "Potion of Resistance", where
  //   fromGeneric  a variant pattern         the DM picks the damage type
  //
  // The last two are deliberately NOT auto-resolved: expanding them properly
  // needs the variant machinery in the data loader, and naming the family with
  // "(choose)" tells the DM exactly what to decide. Silently inventing one
  // member of the family would be worse than asking.
  _resolveMagicRow(row){
    if (!row) return null;
    const ch = row.choose;
    if (ch && Array.isArray(ch.fromItems) && ch.fromItems.length){
      return ch.fromItems[Math.floor(Math.random() * ch.fromItems.length)];
    }
    if (ch && ch.fromMatching && ch.fromMatching.rarity){
      const want = String(ch.fromMatching.rarity).toLowerCase();
      // Honour the hidden-sources filter, the same way the item search in this
      // panel does. The DM curates which books are in play; a roller that
      // quietly hands out an item from a book they switched off is worse than
      // a smaller pool.
      const isHidden = (typeof window.SKT_IS_SOURCE_HIDDEN === 'function')
        ? window.SKT_IS_SOURCE_HIDDEN : () => false;
      const pool = (typeof _5eData !== 'undefined' && Array.isArray(_5eData))
        ? _5eData.filter(d => d.cat === 'item'
            && String(d._rarity || '').toLowerCase() === want
            && !isHidden(d._source))
        : [];
      if (pool.length) return pool[Math.floor(Math.random() * pool.length)].name;
      return 'Random ' + want + ' magic item';       // index not loaded, or all hidden
    }
    if (ch && Array.isArray(ch.fromGroup) && ch.fromGroup.length){
      return ch.fromGroup[Math.floor(Math.random() * ch.fromGroup.length)] + ' (choose)';
    }
    if (ch && Array.isArray(ch.fromGeneric) && ch.fromGeneric.length){
      return ch.fromGeneric[Math.floor(Math.random() * ch.fromGeneric.length)] + ' (choose)';
    }
    return row.item || null;
  },

  // d100 against a [{min,max,...}] table. Returns the matching row.
  _rollOnTable(table){
    const roll = 1 + Math.floor(Math.random() * 100);
    return (table || []).find(r => roll >= (r.min ?? 1) && roll <= (r.max ?? r.min ?? 100)) || null;
  },

  // gems/artObjects are listed twice — once from the DMG and once from the
  // 2024 revision — so `type` alone is ambiguous. Prefer the DMG list, which
  // is what the hoard tables' page references point at.
  _lootListByType(arr, type, edition){
    const hits = (arr || []).filter(x => String(x.type) === String(type));
    return hits.find(x => x.source === (edition || 'DMG')) || hits[0] || null;
  },

  _clean(s){
    // Gem and art-object entries carry flavour text OUTSIDE the item tag:
    //     "{@item Azurite} (opaque mottled deep blue)"
    // Magic items carry meaning INSIDE it:
    //     "{@item Spell Scroll (Cantrip)}"
    // So a trailing parenthetical is only dropped when it sits after the
    // closing brace. Stripping unconditionally — which is what this did first
    // — turned every scroll into a bare "Spell Scroll" with the level gone.
    const str = String(s || '').replace(/\}\s*\([^)]*\)\s*$/, '}');
    return (typeof _stripTags === 'function' ? _stripTags(str) : str).trim();
  },

  // Which rulebook the tables come from. 'DMG' is the 2014 Dungeon Master's
  // Guide, 'XDMG' the 2024 revision — loot.json ships both, and they are
  // genuinely different designs rather than a re-tune:
  //
  //             2014 (DMG)                     2024 (XDMG)
  //   coins     4 lines, cp/sp/gp/pp           one gp line
  //   contents  29-row d100: gems, art,        one row: 1d3-ish magic items
  //             and magic tables A-I           drawn by character level
  //   gems/art  yes                            not in the hoard table
  //
  // 2024 is not the more restrained of the two — its CR 5-10 hoard averages
  // 4,400 gp against 2014's 3,857.
  _lootEdition(){
    try { return localStorage.getItem('skt-loot-edition') === 'XDMG' ? 'XDMG' : 'DMG'; }
    catch(e){ return 'DMG'; }
  },
  _setLootEdition(ed){
    try { localStorage.setItem('skt-loot-edition', ed === 'XDMG' ? 'XDMG' : 'DMG'); } catch(e){}
  },

  // Roll one treasure result. Returns {coins:{cp,sp,...}, items:[{name,qty,value}]}
  // without touching panel state — the caller decides whether to keep it.
  _rollTreasure(kind, crBand, edition){
    const T = this._lootTables; if (!T) return null;
    const coins = {};
    const bucket = new Map();   // name → {name, qty, value}
    const addItem = (name, value) => {
      const n = this._clean(name); if (!n) return;
      const key = n + '|' + (value || '');
      const cur = bucket.get(key);
      if (cur) cur.qty++; else bucket.set(key, { name: n, qty: 1, value: value || '' });
    };
    const addCoins = obj => {
      Object.keys(obj || {}).forEach(c => { coins[c] = (coins[c] || 0) + this._rollDice(obj[c]); });
    };

    // Pin the edition explicitly. Both editions use identical band names
    // ("Challenge 5-10"), so a plain find-by-CR returns whichever the file
    // happens to list first — which gave 2014 only because DMG currently
    // occupies indices 0-3. A regenerated dump with the order flipped would
    // have switched editions silently, with nothing on screen looking wrong.
    const EDITION = edition === 'XDMG' ? 'XDMG' : 'DMG';
    const set = (kind === 'hoard' ? T.hoard : T.individual) || [];
    const band = set.find(x => x.source === EDITION && x.crMin === crBand.min)
              || set.find(x => x.crMin === crBand.min)   // dump missing that edition
              || set[0];
    if (!band) return null;

    if (kind === 'hoard'){
      addCoins(band.coins);                      // hoard coins are unconditional
      const row = this._rollOnTable(band.table);
      if (row){
        if (row.gems){
          const list = this._lootListByType(T.gems, row.gems.type, EDITION);
          const n = this._rollDice(row.gems.amount);
          for (let i = 0; i < n; i++){
            const pick = list && list.table[Math.floor(Math.random() * list.table.length)];
            addItem(pick || (row.gems.type + ' gp gemstone'), row.gems.type + ' gp');
          }
        }
        if (row.artObjects){
          const list = this._lootListByType(T.artObjects, row.artObjects.type, EDITION);
          const n = this._rollDice(row.artObjects.amount);
          for (let i = 0; i < n; i++){
            const pick = list && list.table[Math.floor(Math.random() * list.table.length)];
            addItem(pick || (row.artObjects.type + ' gp art object'), row.artObjects.type + ' gp');
          }
        }
        (row.magicItems || []).forEach(mi => {
          // 2024 says "randomByLevel", meaning the byLevel table for the
          // party's tier. The CR band and the level band line up closely
          // enough that reusing it beats asking for a second number.
          const type = String(mi.type) === 'randomByLevel'
            ? 'byLevel.' + ({0:'1-4', 5:'5-10', 11:'11-16', 17:'17-20'}[crBand.min] || '1-4')
            : String(mi.type);
          const tbl = (T.magicItems || []).find(x => String(x.type) === type);
          const n = this._rollDice(mi.amount);
          for (let i = 0; i < n; i++){
            const name = this._resolveMagicRow(tbl && this._rollOnTable(tbl.table));
            if (name) addItem(name, '');
          }
        });
      }
    } else {
      // Individual: 2014 puts the coins on the rolled row; 2024 has a single
      // row and no band-level coins. Both are covered by rolling and reading
      // the row, with the band-level coins added when a table defines them.
      addCoins(band.coins);
      const row = this._rollOnTable(band.table);
      if (row) addCoins(row.coins);
    }
    return { coins, items: [...bucket.values()] };
  },

  _describeTreasure(res){
    const coinStr = ['pp','gp','ep','sp','cp']
      .filter(c => res.coins[c]).map(c => res.coins[c] + ' ' + c).join(', ');
    const itemStr = res.items
      .map(i => (i.qty > 1 ? i.qty + '× ' : '') + i.name + (i.value ? ' (' + i.value + ')' : ''))
      .join(' · ');
    if (!coinStr && !itemStr) return 'Nothing — the tables came up empty.';
    return (coinStr ? 'Coins: ' + coinStr : 'No coins')
         + (itemStr ? '  ·  ' + itemStr : '  ·  no items');
  },

  _openTreasureRoller(){
    const BANDS = [
      { label: 'Challenge 0–4',   min: 0  },
      { label: 'Challenge 5–10',  min: 5  },
      { label: 'Challenge 11–16', min: 11 },
      { label: 'Challenge 17+',   min: 17 },
    ];
    this._ensureLootTables().then(T => {
      if (!T) return;   // _ensureLootTables already toasted
      return showModal('Roll treasure', [
        { id:'kind', label:'Type', type:'select', value:'hoard',
          options:[{value:'hoard', label:'Hoard (coins, gems, art, magic items)'},
                   {value:'individual', label:'Individual (coins only)'}] },
        { id:'band', label:'Challenge rating', type:'select', value:'0',
          options: BANDS.map(x => ({ value:String(x.min), label:x.label })) },
        // Remembers the last choice — a table runs one edition, so asking
        // afresh every roll would be noise.
        { id:'edition', label:'Rules', type:'select', value:this._lootEdition(),
          options:[{value:'DMG',  label:"2014 DMG — gems, art, tables A–I"},
                   {value:'XDMG', label:'2024 DMG — gold + magic items by level'}] },
      ], 'Roll').then(r => {
        if (!r) return;
        this._setLootEdition(r.edition);
        const band = BANDS.find(x => String(x.min) === String(r.band)) || BANDS[0];
        const res = this._rollTreasure(r.kind, band, r.edition);
        if (!res) { if (typeof showToast === 'function') showToast('No table for that combination'); return; }
        // Show the result BEFORE committing — a roll you can't preview is a
        // roll you end up undoing by hand.
        return showConfirm(this._describeTreasure(res),
          { title: (r.kind === 'hoard' ? 'Hoard' : 'Individual') + ' — ' + band.label,
            confirmLabel: 'Add to loot' }).then(ok => {
          if (!ok) return;
          ['cp','sp','ep','gp','pp'].forEach(c => {
            if (res.coins[c]) this._loot[c] = (this._loot[c] || 0) + res.coins[c];
          });
          res.items.forEach(i => this._loot.items.push({
            id: uid(), name: i.name, qty: i.qty, value: i.value, assignedTo: null }));
          this._save();
          this._render();
          if (typeof showToast === 'function') showToast('Treasure added to the loot pool');
        });
      });
    });
  },

  // Resolve an `assignedTo` id to a display name. Works for both party-member
  // ids and custom tab-group ids; returns null for unassigned / orphaned.
  _memberName(id){
    if (!id) return null;
    const p = state.party.find(p => p.id === id);
    if (p) return p.name;
    const g = (this._loot.tabGroups||[]).find(g => g.id === id);
    return g ? g.name : null;
  },
  // True if assigning to this id is a custom tab group (vs a party member).
  _assignedToGroup(id){
    return !!(this._loot.tabGroups||[]).find(g => g.id === id);
  },
  // Does this item belong in the given member's tab? Either directly assigned
  // to them, or assigned to a custom group that contains them.
  _itemBelongsToMember(item, memberId){
    if (!memberId) return false;
    if (item.assignedTo === memberId) return true;
    const g = (this._loot.tabGroups||[]).find(g => g.id === item.assignedTo);
    return !!(g && Array.isArray(g.memberIds) && g.memberIds.includes(memberId));
  },

  // ── 5e item search ───────────────────────────────────────────────────────────
  _searchItems(q){
    if (!q || typeof _5eLoaded === 'undefined' || !_5eLoaded || !Array.isArray(_5eData)) return [];
    const qLow = q.toLowerCase().trim();
    const tokens = qLow.split(/\s+/).filter(Boolean);
    const matches = (name, meta) =>
      tokens.every(t => (name+' '+(meta||'')).toLowerCase().includes(t));
    // Honor the per-consumer hidden-source filter (toggleable in Books panel).
    const isHidden = (src) => typeof window.SKT_IS_SOURCE_HIDDEN === 'function'
      ? window.SKT_IS_SOURCE_HIDDEN('loot', src)
      : false;
    // Collect all matches first (no early break — there are only ~2,500
    // items, easy to iterate fully). Then rank so prefix matches and
    // shorter names come first: typing "shield" puts the plain Shield base
    // item at the top, not 31 magic shields ahead of it.
    const all = [];
    for (const d of _5eData){
      if (d.cat !== 'item') continue;
      if (isHidden(d._source)) continue;
      // Facets hoisted onto the row by the data loader — avoids walking into
      // _raw for every one of the ~5,800 item rows on each search pass.
      if (matches(d.name, d.meta)) all.push({name:d.name, meta:d.meta, _source:d._source, value:d._value || '', rarity:d._rarity || null, weight: d._weight ?? null});
      // Items with bonus variants (+1, +2, +3) — include each variant as its
      // own selectable row so the user can drop "+2 Longsword" directly
      // into loot without having to retype the prefix.
      if (d._variants){
        for (const v of d._variants){
          if (isHidden(v._source || d._source)) continue;
          if (matches(v.name, v.meta)) all.push({name:v.name, meta:v.meta, _source:v._source||d._source, value:v._raw?.value || '', rarity:v._raw?.rarity || d._raw?.rarity || null, weight: v._raw?.weight ?? d._raw?.weight ?? null});
        }
      }
    }
    // Score each match. Lower score = ranks higher.
    //   • Exact (case-insensitive) name match → 0
    //   • Name starts with the full query → 1
    //   • Otherwise → 2 + name length / 200 (shorter beats longer)
    // Tie-break alphabetically.
    const score = (it) => {
      const n = (it.name || '').toLowerCase();
      if (n === qLow) return 0;
      if (n.startsWith(qLow)) return 1;
      return 2 + (n.length / 200);
    };
    all.sort((a,b) => {
      const sa = score(a), sb = score(b);
      if (sa !== sb) return sa - sb;
      return a.name.localeCompare(b.name);
    });
    return all.slice(0, 20);
  },

  _renderSearchDropdown(){
    const b = this._body; if (!b) return;
    const drop = b.querySelector('#loot-search-results'); if (!drop) return;
    const results = this._searchQ ? this._searchItems(this._searchQ) : [];
    const open = this._searchOpen && results.length;
    drop.classList.toggle('open', !!open);
    if (!open) { drop.innerHTML = ''; return; }
    drop.innerHTML = results.map(d => {
      const srcDisplay = d._source && typeof _formatSource === 'function' ? _formatSource(d._source) : (d._source||'');
      const srcBadge = srcDisplay ? `<span class="loot-search-src">${esc(srcDisplay)}</span>` : '';
      // Rarity chip — colored to match the shop panel's rarity scale so the
      // user gets an at-a-glance feel for what they're picking up. Skipped for
      // mundane/none items so the row stays compact.
      const r = (d.rarity || '').toLowerCase();
      const rarityChip = (!r || r === 'none' || r === 'unknown')
        ? ''
        : `<span class="loot-rarity-chip rarity-${r.replace(/\s+/g,'')}">${esc(d.rarity)}</span>`;
      const metaText = [d.meta, d.value].filter(Boolean).join(' · ');
      const weightAttr = (d.weight != null) ? ` data-iwt="${esc(String(d.weight))}"` : '';
      return `<div class="loot-search-result" data-iname="${esc(d.name)}" data-isrc="${esc(d._source||'')}" data-ival="${esc(d.value||'')}"${weightAttr}>
        <span class="loot-search-name">${esc(d.name)}${rarityChip}${srcBadge}</span>
        <span class="loot-search-meta">${esc(metaText)}</span>
      </div>`;
    }).join('');
    drop.querySelectorAll('.loot-search-result').forEach(el => {
      // Prevent the input from blurring while the user is picking a row —
      // mousedown fires before blur, and preventDefault keeps focus on the
      // input. This removes the fragile 180ms blur-close race.
      el.addEventListener('mousedown', e => e.preventDefault());
      el.addEventListener('click', () => {
        const name = el.dataset.iname;
        // Prefer the qty already typed by the user; default to 1.
        const qtyInp = b.querySelector('#loot-new-qty');
        const valInp = b.querySelector('#loot-new-val');
        const qty = parseInt(qtyInp?.value)||1;
        // Value priority: user-typed value > 5e item's listed value > empty.
        const typed = (valInp?.value||'').trim();
        const value = typed || (el.dataset.ival || '');
        // Pull weight from the 5e entry when known. Stored even if the
        // encumbrance toggle is off, so flipping it on later picks up
        // accurate weights without re-adding everything.
        const wRaw = el.dataset.iwt;
        const weight = (wRaw != null && wRaw !== '') ? parseFloat(wRaw) : undefined;
        const newItem = {id:uid(), name, qty, value, assignedTo:null};
        if (weight != null && !isNaN(weight)) newItem.weight = weight;
        this._loot.items.push(newItem);
        this._save();
        this._searchQ = ''; this._searchOpen = false;
        this._render();
      });
    });
  },

  // ── List rendering ───────────────────────────────────────────────────────────
  _assignSelect(item, idx){
    const opts = ['<option value="">— Unassigned —</option>'];
    state.party.forEach(p => {
      opts.push(`<option value="${esc(p.id)}"${item.assignedTo===p.id?' selected':''}>${esc(p.name)}</option>`);
    });
    const groups = this._loot.tabGroups || [];
    if (groups.length){
      opts.push('<optgroup label="Custom groups">');
      groups.forEach(g => {
        opts.push(`<option value="${esc(g.id)}"${item.assignedTo===g.id?' selected':''}>👥 ${esc(g.name)}</option>`);
      });
      opts.push('</optgroup>');
    }
    return `<select class="loot-assign" data-lfield="assignedTo" data-li="${idx}" title="Assign to party member or custom group">${opts.join('')}</select>`;
  },
  // ── Drag-to-reorder ──────────────────────────────────────────────────────
  // Wires HTML5 drag events on every visible item row so the user can drag a
  // row up or down to change its position in the underlying items list. Works
  // in any view (All / per-member / per-group / custom-tab) because every row
  // carries its absolute index in `data-i`.
  _wireRowDrag(){
    const b = this._body; if (!b) return;
    b.querySelectorAll('.loot-item').forEach(row => {
      row.addEventListener('dragstart', e => {
        // Don't start a drag if the user grabbed an editable control —
        // they're trying to interact with it, not move the row.
        if (e.target.closest('input,select,textarea,button')) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-skt-loot-idx', row.dataset.i);
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        b.querySelectorAll('.loot-item.drop-before,.loot-item.drop-after')
          .forEach(el => el.classList.remove('drop-before','drop-after'));
      });
      row.addEventListener('dragover', e => {
        if (!e.dataTransfer.types.includes('application/x-skt-loot-idx')) return;
        e.preventDefault();
        const r = row.getBoundingClientRect();
        const before = e.clientY < r.top + r.height/2;
        row.classList.toggle('drop-before', before);
        row.classList.toggle('drop-after', !before);
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('drop-before','drop-after');
      });
      row.addEventListener('drop', e => {
        const fromStr = e.dataTransfer.getData('application/x-skt-loot-idx');
        if (!fromStr) return;
        e.preventDefault();
        const from = parseInt(fromStr);
        const targetIdx = parseInt(row.dataset.i);
        row.classList.remove('drop-before','drop-after');
        if (isNaN(from) || isNaN(targetIdx) || from === targetIdx) return;
        const r = row.getBoundingClientRect();
        const before = e.clientY < r.top + r.height/2;
        let insertAt = before ? targetIdx : targetIdx + 1;
        // Removing the source first shifts every later index down by one.
        if (from < insertAt) insertAt--;
        const arr = this._loot.items;
        const [moved] = arr.splice(from, 1);
        arr.splice(insertAt, 0, moved);
        this._save();
        this._render();
      });
    });
  },

  // ── Custom tab groups (named bundles of party members) ────────────────────
  _findTabGroup(id){ return (this._loot.tabGroups||[]).find(g => g.id === id) || null; },
  // Items belonging to this tab group: directly assigned to the group, OR
  // assigned to any of its member ids.
  _itemsForTabGroup(group){
    const memberSet = new Set(group.memberIds||[]);
    const out = [];
    this._loot.items.forEach((item, i) => {
      if (item.assignedTo === group.id || memberSet.has(item.assignedTo)){
        out.push({item, idx:i});
      }
    });
    return out;
  },
  _renderTabGroupView(groupId){
    const g = this._findTabGroup(groupId);
    if (!g) return '<div class="empty-state">Group not found.</div>';
    const matched = this._itemsForTabGroup(g);
    if (!matched.length){
      return `<div class="empty-state">No items assigned to anyone in <strong>${esc(g.name)}</strong> yet.</div>`;
    }
    const totalVal = matched.reduce((sum, {item}) => {
      const q = parseInt(item.qty)||1;
      return sum + this._parseGp(item.value) * q;
    }, 0);
    return `<div class="loot-group">
      <div class="loot-group-head">
        <span class="loot-group-icon">👥</span>
        <span class="loot-group-name">${esc(g.name)}</span>
        <span class="loot-group-meta">${matched.length} item${matched.length===1?'':'s'}${totalVal?` · ${totalVal.toFixed(2)} gp`:''}</span>
      </div>
      ${matched.map(({item, idx}) => this._itemRow(item, idx)).join('')}
    </div>`;
  },

  // Modal: create or edit a tab group. Pass groupId to edit, or null to create.
  _openTabGroupModal(groupId){
    const editing = groupId ? this._findTabGroup(groupId) : null;
    const initialName = editing?.name || '';
    const initialMembers = new Set(editing?.memberIds || []);

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const memberRows = state.party.length
      ? state.party.map(p => `
          <label class="cg-member">
            <input type="checkbox" data-pid="${esc(p.id)}" ${initialMembers.has(p.id)?'checked':''}>
            <span>${esc(p.name)}</span>
          </label>`).join('')
      : '<div style="font-size:var(--fs-sm);color:var(--text-muted)">Add party members in the Party panel first.</div>';

    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="width:380px;max-width:92vw">
      <h3>${editing?'Edit Custom Tab':'New Custom Tab'}</h3>
      <div class="modal-fields">
        <div class="modal-field">
          <label>Tab name</label>
          <input id="cg-name" type="text" value="${esc(initialName)}" placeholder="e.g. Frontline" autocomplete="off">
        </div>
        <div class="modal-field">
          <label>Members in this tab</label>
          <div class="cg-members">${memberRows}</div>
        </div>
      </div>
      <div class="modal-actions" style="display:flex;gap:6px;justify-content:flex-end;margin-top:14px">
        ${editing ? '<button class="btn danger" id="cg-del" style="margin-right:auto">Delete</button>' : ''}
        <button class="btn" id="cg-cancel">Cancel</button>
        <button class="btn primary" id="cg-save">${editing?'Save':'Create'}</button>
      </div>
    </div>`;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    setTimeout(()=> backdrop.querySelector('#cg-name')?.focus(), 30);

    const saveAction = () => {
      const name = (backdrop.querySelector('#cg-name')?.value||'').trim();
      if (!name){ backdrop.querySelector('#cg-name')?.focus(); return; }
      const memberIds = [...backdrop.querySelectorAll('.cg-members input[type=checkbox]:checked')]
        .map(cb => cb.dataset.pid);
      if (editing){
        editing.name = name;
        editing.memberIds = memberIds;
      } else {
        const id = 'tg_' + (typeof uid==='function' ? uid() : Math.random().toString(36).slice(2,10));
        this._loot.tabGroups.push({ id, name, memberIds });
        this._view = 'tabgroup:'+id;
      }
      this._save();
      close();
      this._render();
    };
    backdrop.querySelector('#cg-save').addEventListener('click', saveAction);
    backdrop.querySelector('#cg-cancel').addEventListener('click', close);
    backdrop.querySelector('#cg-del')?.addEventListener('click', () => {
      this._loot.tabGroups = this._loot.tabGroups.filter(g => g.id !== editing.id);
      if (this._view === 'tabgroup:'+editing.id) this._view = 'all';
      this._save();
      close();
      this._render();
    });
    backdrop.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type === 'text'){
        e.preventDefault(); saveAction();
      } else if (e.key === 'Escape') close();
    });
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
  },

  // Find the matching 5e item entry for a given user-typed loot name. Tries
  // an exact match against the top-level item list AND any of its bonus
  // variants (+1/+2/+3) so "+1 Longsword" finds the Longsword entry.
  _findFiveItem(name){
    if (typeof _5eLoaded === 'undefined' || !_5eLoaded || !Array.isArray(_5eData)) return null;
    const lower = (name||'').trim().toLowerCase();
    if (!lower) return null;
    for (const d of _5eData){
      if (d.cat !== 'item') continue;
      if (d.name.toLowerCase() === lower) return d;
      if (d._variants){
        for (const v of d._variants){
          if (v.name && v.name.toLowerCase() === lower) return d;
        }
      }
    }
    return null;
  },

  // Open the same detail popout the global search uses. Falls back to a tiny
  // toast for custom items the 5e library doesn't know about.
  _openItemDetail(idx){
    const item = this._loot.items[idx]; if (!item) return;
    const match = this._findFiveItem(item.name);
    if (match && typeof popOutDetail === 'function'){
      popOutDetail(match);
      return;
    }
    if (typeof showToast === 'function'){
      showToast(`No 5e entry for "${item.name}" — custom item.`);
    }
  },

  _itemRow(item, i){
    const assignedName = this._memberName(item.assignedTo);
    const paid = !!item.paid;
    const paidTitle = paid && item.paidTs
      ? 'Marked paid · ' + new Date(item.paidTs).toLocaleString()
      : 'Mark as paid / collected';
    // Weight column only renders when the user has flipped on the
    // encumbrance toggle. When hidden, the field is omitted entirely so
    // existing flex layout stays clean.
    const showWeight = !!(state.settings && state.settings.lootEncumbrance);
    const weightInp = showWeight
      ? `<input type="number" step="0.1" min="0" class="loot-wt" value="${item.weight!=null?esc(String(item.weight)):''}" data-lfield="weight" data-li="${i}" placeholder="lb" title="Weight per item (lbs)">`
      : '';
    return `<div class="loot-item ${item.assignedTo?'assigned':''} ${paid?'paid':''}" data-i="${i}" draggable="true">
      <span class="loot-drag-handle" title="Drag to reorder">⋮⋮</span>
      <button class="loot-paid-btn ${paid?'on':''}" data-lact="paid" data-li="${i}" title="${esc(paidTitle)}">${paid?ICO('i-check'):'<span class="loot-unpaid">○</span>'}</button>
      <div class="loot-name">
        <button class="loot-info-btn" data-lact="info" data-li="${i}" title="View item details">${ICO('i-book-open')}</button>
        <input class="loot-name-input" type="text" value="${esc(item.name)}" data-lfield="name" data-li="${i}" title="Click to rename" spellcheck="false">
        ${assignedName?`<span class="loot-assigned-pill" title="${esc(assignedName)}">→ ${esc(assignedName)}</span>`:''}
      </div>
      <input type="number" class="loot-qty" value="${item.qty||1}" min="1" data-lfield="qty" data-li="${i}" title="Quantity">
      <input type="text" class="loot-val" value="${esc(item.value||'')}" data-lfield="value" data-li="${i}" placeholder="gp val" title="Value">
      ${weightInp}
      ${this._assignSelect(item, i)}
      <button class="btn icon-btn danger" data-lact="del" data-li="${i}" title="Remove">×</button>
    </div>`;
  },

  // Free-form "10 gp" / "50 sp" / "200 cp" → numeric gp. Shared between the
  // per-member and per-group totals.
  _parseGp(s){
    const str = String(s||'').toLowerCase().trim();
    if (!str) return 0;
    const num = parseFloat(str.replace(/[^\d.-]/g,''));
    if (isNaN(num)) return 0;
    if (/\bcp\b/.test(str)) return num / 100;
    if (/\bsp\b/.test(str)) return num / 10;
    if (/\bep\b/.test(str)) return num / 2;
    if (/\bpp\b/.test(str)) return num * 10;
    return num;
  },
  _renderAllView(){
    if (!this._loot.items.length) return emptyState({ icon:'i-chest', title:'No loot yet',
      hint:'Add an item above, or roll random treasure.' });
    return this._loot.items.map((item,i)=>this._itemRow(item,i)).join('');
  },
  // True if this assignedTo value still resolves to a current party member or
  // a custom tab group (i.e. it's a real, non-orphan assignment).
  _isAssignedTo(assignedTo){
    if (!assignedTo) return false;
    if (state.party.some(p => p.id === assignedTo)) return true;
    if ((this._loot.tabGroups||[]).some(g => g.id === assignedTo)) return true;
    return false;
  },
  // One-member view: just the rows assigned to that member, with a header
  // showing the count + total gp value.
  _renderMemberView(memberId){
    const member = memberId === '__unassigned__'
      ? {name:'Group (shared loot)', icon:'📦'}
      : state.party.find(p => p.id === memberId);
    if (!member) return '<div class="empty-state">Member not found.</div>';
    const matched = [];
    this._loot.items.forEach((item, i) => {
      // Unassigned bucket: any item that doesn't resolve to a real assignee.
      if (memberId === '__unassigned__'){
        if (!this._isAssignedTo(item.assignedTo)) matched.push({item, idx:i});
        return;
      }
      // Member tab: item is for them directly, OR for a custom group they're in.
      if (this._itemBelongsToMember(item, memberId)) matched.push({item, idx:i});
    });
    if (!matched.length){
      return `<div class="empty-state">${memberId==='__unassigned__'?'No shared/group loot — all items are assigned.':'No items assigned to '+esc(member.name)+'.'}</div>`;
    }
    return this._renderMemberSection(member, matched);
  },

  // One section's HTML — used by the combined Party view and the lone-member
  // / shared-loot view. Header shows icon + name + count + total gp.
  _renderMemberSection(member, matched){
    const totalVal = matched.reduce((sum, {item}) => {
      const q = parseInt(item.qty)||1;
      return sum + this._parseGp(item.value) * q;
    }, 0);
    const showWeight = !!(state.settings && state.settings.lootEncumbrance);
    const icon = member.icon || '👤';
    const iconHtml = typeof icon === 'string' && icon.startsWith('data:')
      ? `<img src="${esc(icon)}">` : esc(icon);
    // Encumbrance subtotal — sum weight × qty across items in this section.
    // Capacity follows the 5e variant rule: STR × 15 = lbs carrying capacity.
    // When the section is for a custom group or the "Group (shared loot)"
    // bucket, capacity is omitted (no single STR to use).
    let weightHtml = '';
    if (showWeight){
      const totalWt = matched.reduce((sum, {item}) => {
        const q = parseInt(item.qty)||1;
        const w = parseFloat(item.weight);
        return sum + (isNaN(w) ? 0 : w * q);
      }, 0);
      const str = member.abilities?.str;
      const capacity = (typeof str === 'number') ? str * 15 : null;
      const over = capacity != null && totalWt > capacity;
      const enc = capacity != null && totalWt > str * 5;
      const enc2 = capacity != null && totalWt > str * 10;
      const wtCls = over ? 'over' : enc2 ? 'heavy' : enc ? 'enc' : '';
      const tooltip = capacity != null
        ? `STR ${str} · normal ≤${str*5} lb · encumbered ${str*5+1}–${str*10} lb · heavily ${str*10+1}–${capacity} lb · max ${capacity} lb`
        : 'No STR score available for capacity calc';
      const capPart = capacity != null ? ` / ${capacity} lb` : ' lb';
      weightHtml = ` · <span class="loot-weight-meta ${wtCls}" title="${esc(tooltip)}">${totalWt.toFixed(1)}${capPart}</span>`;
    }
    return `<div class="loot-group">
      <div class="loot-group-head">
        <span class="loot-group-icon">${iconHtml}</span>
        <span class="loot-group-name">${esc(member.name)}</span>
        <span class="loot-group-meta">${matched.length} item${matched.length===1?'':'s'}${totalVal?` · ${totalVal.toFixed(2)} gp`:''}${weightHtml}</span>
      </div>
      ${matched.map(({item, idx}) => this._itemRow(item, idx)).join('')}
    </div>`;
  },

  // Combined "Party" view: one section per party member. (Unassigned items
  // live in their own dedicated tab — the Group tab — and don't appear here.)
  _renderPartyView(){
    if (!state.party.length) return '<div class="empty-state">Add party members in the Party panel first.</div>';
    if (!this._loot.items.length) return emptyState({ icon:'i-chest', title:'No loot yet',
      hint:'Add an item above, or roll random treasure.' });
    let out = '';
    state.party.forEach(p => {
      const matched = [];
      this._loot.items.forEach((item, i) => {
        if (this._itemBelongsToMember(item, p.id)) matched.push({item, idx:i});
      });
      if (matched.length) out += this._renderMemberSection(p, matched);
    });
    if (!out) out = '<div class="empty-state">No items assigned to any party member yet.</div>';
    return out;
  },

  // ── Add an item (manual or from search) ──────────────────────────────────────
  _addManualItem(){
    const b = this._body; if (!b) return;
    const nameInp = b.querySelector('#loot-new-name');
    const qtyInp  = b.querySelector('#loot-new-qty');
    const valInp  = b.querySelector('#loot-new-val');
    const name = (nameInp?.value||'').trim();
    if (!name) { nameInp?.focus(); return; }
    const qty = Math.max(1, parseInt(qtyInp?.value)||1);
    const value = (valInp?.value||'').trim();
    this._loot.items.push({id:uid(), name, qty, value, assignedTo:null});
    this._save();
    this._searchQ = ''; this._searchOpen = false;
    this._render();
  },

  _render(){
    const b=this._body;if(!b)return;
    // Snapshot the items-list scroll position before innerHTML wipes the DOM,
    // so editing qty/assignment (which triggers a re-render) doesn't fling
    // the user back to the top of the list.
    const oldList = b.querySelector('.loot-items');
    const savedScroll = oldList ? oldList.scrollTop : 0;
    const totalGp=((this._loot.cp||0)/100+(this._loot.sp||0)/10+(this._loot.ep||0)/2+(this._loot.gp||0)+(this._loot.pp||0)*10).toFixed(2);
    const view = this._view;
    b.innerHTML=`<div class="loot-panel">
      <div class="loot-summary">
        ${['cp','sp','ep','gp','pp'].map(c=>`<div class="loot-coin"><div class="l">${c.toUpperCase()}</div><input type="number" id="loot-${c}" value="${this._loot[c]||0}" min="0"></div>`).join('')}
      </div>
      <div style="padding:6px 10px;border-bottom:1px solid var(--border);font-size:var(--fs-sm);color:var(--text-muted);display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span>Total: <strong style="color:var(--warning)">${totalGp} gp</strong> equivalent</span>
        <span>· Per party member: <strong style="color:var(--warning)">${state.party.length?(totalGp/state.party.length).toFixed(2):totalGp} gp</strong></span>
        <label class="loot-encumbrance-toggle" title="Show a weight column on items and per-member encumbrance subtotals (5e: STR×15 = lbs)">
          <input type="checkbox" id="loot-encumbrance-toggle" ${state.settings?.lootEncumbrance?'checked':''}>
          <span>${ICO('i-scale')} Weight</span>
        </label>
        <span style="flex:1"></span>
        <button class="btn small" id="loot-roll" title="Roll random treasure on the DMG tables">${ICO('i-dice')} Roll treasure</button>
        <button class="btn small" id="loot-divvy">Divvy up</button>
      </div>
      <div class="loot-add-row">
        <div class="loot-search-wrap">
          <input type="text" id="loot-new-name" placeholder="Item name or search 5e items..." autocomplete="off" value="${esc(this._searchQ)}">
          <div class="loot-search-dropdown" id="loot-search-results"></div>
        </div>
        <input type="number" id="loot-new-qty" value="1" min="1" placeholder="Qty">
        <input type="text" id="loot-new-val" placeholder="Value">
        <button class="btn small primary" id="loot-add-item">Add</button>
      </div>
      <div class="loot-view-tabs">
        <button class="loot-view-tab ${view==='all'?'active':''}" data-view="all" title="All items">All${this._loot.items.length?` <span class="loot-tab-count">${this._loot.items.length}</span>`:''}</button>
        ${state.party.length ? (() => {
          const cnt = this._loot.items.filter(it => state.party.some(p => this._itemBelongsToMember(it, p.id))).length;
          return `<button class="loot-view-tab ${view==='party'?'active':''}" data-view="party" title="All party members, grouped by character"><span class="loot-tab-icon">${ICO('i-user')}</span><span class="loot-tab-name">Party</span>${cnt?`<span class="loot-tab-count">${cnt}</span>`:''}</button>`;
        })() : ''}
        ${(this._loot.tabGroups||[]).map(g => {
          const cnt = this._itemsForTabGroup(g).length;
          const key = 'tabgroup:'+g.id;
          return `<button class="loot-view-tab tabgroup ${view===key?'active':''}" data-view="${esc(key)}" title="${esc(g.name)} — ${(g.memberIds||[]).length} member(s)">
            <span class="loot-tab-icon">${ICO('i-user')}</span>
            <span class="loot-tab-name">${esc(g.name)}</span>
            ${cnt?`<span class="loot-tab-count">${cnt}</span>`:''}
            <span class="loot-tab-edit" data-tg-edit="${esc(g.id)}" title="Edit tab">${ICO('i-gear')}</span>
          </button>`;
        }).join('')}
        <button class="loot-view-tab loot-tab-add" data-tg-add="1" title="Create a custom tab grouping party members"><span class="loot-tab-icon">${ICO('i-tag')}</span><span class="loot-tab-name">Tab</span></button>
        ${(() => {
          // "Group" tab = shared / unassigned loot (treats items pointing at
          // a deleted party member as unassigned too).
          const cnt = this._loot.items.filter(it => !this._isAssignedTo(it.assignedTo)).length;
          return `<button class="loot-view-tab ${view==='unassigned'?'active':''}" data-view="unassigned" title="Shared / group loot"><span class="loot-tab-icon">${ICO('i-chest')}</span><span class="loot-tab-name">Group</span>${cnt?`<span class="loot-tab-count">${cnt}</span>`:''}</button>`;
        })()}
      </div>
      <div class="loot-items">
        ${(() => {
          if (view === 'unassigned') return this._renderMemberView('__unassigned__');
          if (view === 'party') return this._renderPartyView();
          if (view.startsWith('tabgroup:')) return this._renderTabGroupView(view.slice(9));
          return this._renderAllView();
        })()}
      </div>
    </div>`;

    // Coins
    ['cp','sp','ep','gp','pp'].forEach(c=>{b.querySelector(`#loot-${c}`).addEventListener('change',e=>{this._loot[c]=parseInt(e.target.value)||0;this._save();this._render();});});

    // View tabs — including the "+ Tab" button (opens new-group modal) and the
    // ⚙ icon inside each custom-tab chip (opens the edit modal for that tab).
    b.querySelectorAll('.loot-view-tab').forEach(tab=>tab.addEventListener('click',e=>{
      // ⚙ edit click — handle first so it doesn't also switch tabs.
      const editBadge = e.target.closest('[data-tg-edit]');
      if (editBadge){
        e.stopPropagation();
        this._openTabGroupModal(editBadge.dataset.tgEdit);
        return;
      }
      if (tab.dataset.tgAdd){
        this._openTabGroupModal(null);
        return;
      }
      this._view = tab.dataset.view; this._render();
    }));

    // Encumbrance toggle — flips state.settings.lootEncumbrance and
    // re-renders so item rows grow/lose the weight column and member
    // section headers gain/lose the lb subtotal. Persisted via the
    // shared settings save() so it survives reloads + syncs to Firebase.
    b.querySelector('#loot-encumbrance-toggle')?.addEventListener('change', e => {
      if (!state.settings) state.settings = {};
      state.settings.lootEncumbrance = !!e.target.checked;
      if (typeof save === 'function') save();
      this._render();
    });

    // Add (manual / Enter on name input)
    b.querySelector('#loot-add-item').addEventListener('click', () => this._addManualItem());

    // Search input — only update dropdown on input/focus so the input keeps focus.
    const nameInp = b.querySelector('#loot-new-name');
    nameInp.addEventListener('input', e => {
      this._searchQ = e.target.value;
      this._searchOpen = true;
      // Debounce the dropdown render — _searchItems scans the full _5eData
      // catalog (thousands of entries), so doing it on every keystroke janks
      // fast typing. Fire ~120ms after the user pauses.
      clearTimeout(this._searchDebounce);
      this._searchDebounce = setTimeout(() => this._renderSearchDropdown(), 120);
    });
    nameInp.addEventListener('focus', () => {
      this._searchOpen = true;
      this._renderSearchDropdown();
    });
    nameInp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // Flush any pending debounced render so the dropdown reflects what was
        // just typed before we read the first result.
        clearTimeout(this._searchDebounce);
        this._renderSearchDropdown();
        // If dropdown has results, pick the first; otherwise add as manual.
        const first = b.querySelector('#loot-search-results.open .loot-search-result');
        if (first) first.click();
        else this._addManualItem();
      } else if (e.key === 'Escape') {
        this._searchOpen = false;
        this._renderSearchDropdown();
      }
    });
    // Close dropdown when the input loses focus. The 180ms delay only exists
    // as a safety net now — result rows use mousedown.preventDefault() to
    // keep focus on the input, so blur typically only fires when the user
    // tabs/clicks somewhere outside the dropdown entirely.
    nameInp.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.activeElement === nameInp) return; // refocused before timer
        if (this._searchOpen){ this._searchOpen = false; this._renderSearchDropdown(); }
      }, 80);
    });

    // Initial dropdown paint (handles re-render after picking from dropdown)
    if (this._searchQ && this._searchOpen) this._renderSearchDropdown();

    // Item actions: delete + info popup + paid toggle
    b.querySelectorAll('[data-lact]').forEach(el=>el.addEventListener('click',e=>{
      e.stopPropagation();
      const i=+el.dataset.li;
      if(el.dataset.lact==='del'){
        this._loot.items.splice(i,1);
        this._save();this._render();
      } else if (el.dataset.lact==='info'){
        this._openItemDetail(i);
      } else if (el.dataset.lact==='paid'){
        // Toggle paid/collected status with a timestamp. Hover the ✓ to see
        // when it was marked. Toggling off clears the timestamp.
        const it = this._loot.items[i]; if (!it) return;
        if (it.paid){ delete it.paid; delete it.paidTs; }
        else { it.paid = true; it.paidTs = Date.now(); }
        this._save(); this._render();
      }
    }));

    // Field changes (name, qty, value, assignedTo)
    b.querySelectorAll('[data-lfield]').forEach(inp=>{
      inp.addEventListener('change', e => {
        const i=+e.target.dataset.li, f=e.target.dataset.lfield;
        let v = e.target.value;
        if (f==='qty') v = Math.max(1, parseInt(v)||1);
        else if (f==='assignedTo') v = v || null;
        else if (f==='weight'){
          // Empty string → clear (undefined) so the row shows the
          // placeholder again instead of "0". Numeric values are clamped
          // to non-negative; decimals allowed for fractional lbs.
          const trimmed = String(v||'').trim();
          if (!trimmed){ delete this._loot.items[i].weight; this._save(); this._render(); return; }
          const num = parseFloat(trimmed);
          if (isNaN(num) || num < 0){ delete this._loot.items[i].weight; this._save(); this._render(); return; }
          v = num;
        }
        else if (f==='name'){
          const trimmed = String(v||'').trim();
          // Empty name → restore the old value rather than persisting blank.
          if (!trimmed){ e.target.value = this._loot.items[i].name; return; }
          v = trimmed;
        }
        this._loot.items[i][f]=v;
        this._save();
        // Re-render so pills / counts / totals refresh.
        if (f==='assignedTo' || f==='qty' || f==='weight') this._render();
      });
    });
    // Enter on the name input commits + moves focus off (so it feels like a
    // proper rename); Escape restores the previous value.
    b.querySelectorAll('.loot-name-input').forEach(inp=>{
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter'){ e.preventDefault(); inp.blur(); }
        else if (e.key === 'Escape'){
          const i = +inp.dataset.li;
          inp.value = this._loot.items[i].name;
          inp.blur();
        }
      });
    });

    // Random treasure
    b.querySelector('#loot-roll')?.addEventListener('click',()=>this._openTreasureRoller());

    // Divvy
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
        <p style="color:var(--text-muted);font-size:var(--fs-sm);margin:0 0 10px">
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

    // Drag-to-reorder on every item row.
    this._wireRowDrag();

    // Restore the items-list scroll position after the new DOM is wired up,
    // so re-renders (qty / assignment change) feel in-place.
    const newList = b.querySelector('.loot-items');
    if (newList) newList.scrollTop = savedScroll;
  },
});
