// ============================================================
// LOOT TRACKER PANEL
// ============================================================
// Take one off a stack as a row of its own, just below it, given to `to`
// (a character's id, a group's, or null for the party loot). The Loot window
// and the sheet's "Claim one" share it. A new row and a smaller count: two
// devices doing it at once both count.
// Pay `cost` copper's worth out of a purse: gold first, then silver, copper,
// electrum, platinum; when nothing smaller is left to make it up, one bigger
// coin is broken and the change comes back as gold, silver and copper.
// The new purse, or null when there isn't enough.
function sktLootPay(purse, cost){
  const V = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 }, have = {};
  for (const k in V) have[k] = Math.max(0, parseInt(purse && purse[k]) || 0);
  cost = Math.max(0, Math.round(+cost || 0));
  if (Object.keys(V).reduce((t, k) => t + have[k] * V[k], 0) < cost) return null;
  let rem = cost;
  for (const k of ['gp', 'sp', 'cp', 'ep', 'pp']){ const n = Math.min(have[k], Math.floor(rem / V[k])); have[k] -= n; rem -= n * V[k]; }
  if (rem > 0){
    // every coin left is worth more than what's still owed: break the smallest
    const k = ['cp', 'sp', 'ep', 'gp', 'pp'].find(c => have[c] > 0);
    have[k]--; let change = V[k] - rem;
    for (const c of ['gp', 'sp', 'cp']){ const n = Math.floor(change / V[c]); have[c] += n; change -= n * V[c]; }
  }
  return have;
}
// Bought in the Shop: paid from the party's coins, into the party loot (one
// more on the stack when it's already there). The Shop's Buy added the item
// and took no money at all (Aaron's call, 2026-11-17: the party's coins pay).
// `also` runs inside the same undo step (the Shop's stock). { ok, why }.
function sktLootBuy(name, priceGp, opts){
  opts = opts || {};
  const P = typeof panelDefs !== 'undefined' && panelDefs.loot;
  let cur = P && P._loot;
  if (!cur){ try { cur = JSON.parse(localStorage.getItem('skt-loot-v1') || 'null'); } catch(e){ cur = null; } }
  if (!cur || typeof cur !== 'object') cur = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, items: [], tabGroups: [] };
  if (!Array.isArray(cur.items)) cur.items = [];
  const cost = Math.max(0, Math.round((+priceGp || 0) * 100));
  // (Table rules: the house rule off — the shop's Buy takes no coins, as before it.)
  const paid = sktRuleOn('shopCoins') ? sktLootPay(cur, cost) : { cp: +cur.cp || 0, sp: +cur.sp || 0, ep: +cur.ep || 0, gp: +cur.gp || 0, pp: +cur.pp || 0 };
  const coins = c => ['pp', 'gp', 'ep', 'sp', 'cp'].filter(k => +c[k]).map(k => (+c[k]).toLocaleString() + ' ' + k).join(' ') || 'nothing';
  if (!paid) return { ok: false, why: 'The party has ' + coins(cur) + ' — not enough for ' + name + ' (' + (opts.value || sktGp(cost / 100) + ' gp') + ')' };
  const value = opts.value || (cost ? sktGp(cost / 100) + ' gp' : '');
  const run = () => {
    Object.assign(cur, paid);
    const same = cur.items.find(x => !x.assignedTo && String(x.name).toLowerCase() === String(name).toLowerCase() && String(x.value || '') === value);
    if (same) same.qty = (parseInt(same.qty) || 1) + 1;
    else {
      const it = { id: uid(), name, qty: 1, value, assignedTo: null };
      if (opts.weight != null && !isNaN(+opts.weight)) it.weight = +opts.weight;
      cur.items.push(it);
    }
    if (typeof opts.also === 'function') opts.also();
    saveJson('skt-loot-v1', cur, 'loot');
    if (P){ P._loot = cur; if (P._body) P._render(); P._tellSheet(); }
  };
  const label = 'Bought ' + name + (cost ? ' for ' + value : '');
  if (typeof sktUndoable === 'function') sktUndoable(label, run, { keys: ['skt-loot-v1', 'skt-shop-v1'] }); else run();
  return { ok: true, label };
}
// Gold as it reads elsewhere in the window: "5,000", "12.5" — not "5000.00".
function sktGp(n){ return (+n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function sktLootSplit(L, id, to){
  const a = L && L.items, i = a ? a.findIndex(x => x.id === id) : -1;
  if (i < 0) return null;
  const x = a[i], n = parseInt(x.qty) || 1; if (n < 2) return null;
  x.qty = n - 1;
  const one = Object.assign({}, x, { id: uid(), qty: 1, assignedTo: to || null });
  delete one.paid; delete one.paidTs;
  a.splice(i + 1, 0, one);
  return one;
}
registerPanel('loot',{
  title:'Loot Tracker',icon:'💰',
  _loot:null,
  _view:'all',          // 'all' | 'party' | 'unassigned' | 'tabgroup:<id>'
  _searchQ:'',          // current text in the name/search input
  _searchOpen:false,    // dropdown visibility
  _filter:'',           // the list's filter box
  mount(body){
    // Mounted again over itself: a change from another device, or an undo.
    // It wiped whatever was being typed — the price half-typed in the add
    // row, a row's new value before Enter — and took the cursor away.
    const keep = body && body === this._body ? this._grabEdit() : null;
    this._body=body;
    if(!this._loot){try{const r=localStorage.getItem('skt-loot-v1');this._loot=r?JSON.parse(r):{cp:0,sp:0,ep:0,gp:0,pp:0,items:[],tabGroups:[]};}catch(e){this._loot={cp:0,sp:0,ep:0,gp:0,pp:0,items:[],tabGroups:[]}}
    if(!this._loot.items)this._loot.items=[];
    if(!Array.isArray(this._loot.tabGroups))this._loot.tabGroups=[];
    // Migrate items to current shape: `claimed` → `assignedTo`. Drop the old
    // `group` text-tag field that no longer exists in the UI.
    // Two rows with one id, and the sync could no longer tell rows apart: a
    // change on two devices kept only one side's whole list (a claimed potion
    // vanished). Each gets its own; saved only when one was mended.
    const seen = new Set(); let mended = false;
    this._loot.items.forEach(it => {
      if (it.assignedTo === undefined) it.assignedTo = null;
      if ('group' in it) delete it.group;
      if (!it.id || seen.has(it.id)){ it.id = uid(); mended = true; }
      seen.add(it.id);
    });
    if (mended && this._canAdd()) this._save();}
    this._render();
    if (keep) this._putEdit(keep);
    // Refresh the dropdown once 5e data finishes loading so suggestions appear
    // even if the user opened the panel before the load completed.
    if (typeof on5eLoaded === 'function') on5eLoaded(() => { if (this._body) this._renderSearchDropdown(); });
    if (typeof load5eData === 'function') load5eData();
  },
  unmount(){this._body=null;},
  _grabEdit(){
    const b = this._body; if (!b) return null;
    const v = s => { const el = b.querySelector(s); return el ? el.value : null; };
    const k = { qty: v('#loot-new-qty'), val: v('#loot-new-val'), focus: null };
    const a = document.activeElement;
    if (a && b.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)){
      const row = a.closest('.loot-item');
      let s = null, e = null; try { s = a.selectionStart; e = a.selectionEnd; } catch(err){}
      k.focus = { id: a.id || null, rowId: row ? row.dataset.id : null, field: a.dataset.lfield || null,
                  value: a.value, typed: a.tagName !== 'SELECT' && a.value !== a.defaultValue, s, e };
    }
    return k;
  },
  _putEdit(k){
    const b = this._body; if (!b) return;
    const set = (s, val) => { const el = b.querySelector(s); if (el && val != null && el.value !== val) el.value = val; };
    set('#loot-new-qty', k.qty); set('#loot-new-val', k.val);
    const f = k.focus; if (!f) return;
    const el = f.id ? b.querySelector('#' + CSS.escape(f.id))
      : f.rowId && f.field ? b.querySelector('.loot-item[data-id="' + CSS.escape(f.rowId) + '"] [data-lfield="' + CSS.escape(f.field) + '"]') : null;
    if (!el || el.readOnly || el.disabled) return;
    if (f.typed && el.value !== f.value){
      el.value = f.value;
      // Leaving the box saves it, as it would have: setting the text by hand
      // means the browser no longer counts it as typed.
      if (el.dataset.lfield){
        let done = false;
        el.addEventListener('change', () => { done = true; }, { once: true });
        el.addEventListener('blur', () => { if (!done && el.isConnected && el.value !== el.defaultValue) el.dispatchEvent(new Event('change', { bubbles: true })); }, { once: true });
      }
    }
    try { el.focus({ preventScroll: true }); } catch(err){ el.focus(); }
    try { if (f.s != null) el.setSelectionRange(f.s, f.e); } catch(err){}
  },
  _save(){saveJson('skt-loot-v1', this._loot, 'loot'); this._tellSheet();},
  // A character sheet open on this screen lists their share of the loot: a
  // potion claimed here didn't appear on Zoey's open sheet until something
  // else redrew it (another device's change already did).
  _tellSheet(){ if (typeof csRender === 'function' && document.getElementById('cs-root')){ try { csRender(); } catch(e){} } },
  // A change the DM (or a player) can take back: made, saved, drawn, and in
  // the undo history (Ctrl+Z, or the toast's Undo). Deleting an item had no
  // way back at all — one stray × and it was gone. `party`: it touches the
  // characters too (a payout).
  _undoable(label, fn, party){
    const keys = (party && typeof SKT_UNDO_DEFAULT_KEYS !== 'undefined' ? SKT_UNDO_DEFAULT_KEYS : []).concat(['skt-loot-v1']);
    const run = () => { fn(); this._save(); };
    if (typeof sktUndoable === 'function') sktUndoable(label, run, { keys }); else run();
    this._render();
  },
  // ─── What a player may change ──────────────────────────────────────────────
  // Shared with the players, a phone had every DM control: it could delete
  // anything, hand another character's things to itself (Ulrick's half
  // plate), roll treasure and pay the purse out into everyone's sheets. As on
  // D&D Beyond: the party's coins and its unclaimed loot are everyone's, and a
  // player may claim from it or give their own back. Another character's
  // things, rolling treasure and paying out are the DM's. The TV changes
  // nothing.
  _isPlayer(){ return document.body.classList.contains('player-mode'); },
  _me(){ return this._isPlayer() && typeof paPc === 'function' ? paPc() : null; },
  _canEdit(item){
    if (!this._isPlayer()) return true;
    const me = this._me(); if (!me) return false;
    if (!item || !this._isAssignedTo(item.assignedTo)) return true;     // the party's
    return this._itemBelongsToMember(item, me.id);                      // mine (or my group's)
  },
  _canAdd(){ return !this._isPlayer() || !!this._me(); },
  // The party's share: its player characters (not a rival kept in the list).
  _sharers(){ return typeof sktPlayerParty === 'function' ? sktPlayerParty() : state.party; },

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
    for (let i = 0; i < count; i++) total += sktD(sides);
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
  _rollOnTable(table, forced){
    const roll = forced >= 1 && forced <= 100 ? Math.round(forced) : sktD(100);
    this._lastD100 = roll;
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
  _rollTreasure(kind, crBand, edition, d100){
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
      const row = this._rollOnTable(band.table, d100);
      var rolled = this._lastD100;
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
      const row = this._rollOnTable(band.table, d100);
      var rolled = this._lastD100;
      if (row) addCoins(row.coins);
    }
    return { coins, items: [...bucket.values()], d100: rolled };
  },

  // THE ROLL, BEFORE IT'S KEPT. It was a line of text to take or leave. Now:
  // the coins can be typed (what was rolled at the table — everything that
  // rolls takes a physical roll), the d100 that picked the table row can be
  // set ("Use this roll" re-reads the row; a hoard keeps the coins already
  // there), an item can be left out, and "Roll again" rolls it all afresh.
  _treasurePreview(res, kind, band, edition){
    document.getElementById('loot-tp')?.remove();
    const back = document.createElement('div');
    back.className = 'modal-backdrop'; back.id = 'loot-tp';
    const COINS = ['cp','sp','ep','gp','pp'];
    let cur = res;
    const paint = () => {
      back.innerHTML = '<div class="modal loot-tp" role="dialog" aria-modal="true" aria-label="Treasure">'
        + '<h3>' + (kind === 'hoard' ? 'Hoard' : 'Individual') + ' — ' + esc(band.label) + '</h3>'
        + '<div class="loot-tp-roll"><label>Table roll (d100) <input type="number" id="loot-tp-d100" min="1" max="100" inputmode="numeric" value="' + (cur.d100 || '') + '"></label>'
        +   '<button class="btn small" data-tp="use">Use this roll</button><button class="btn small" data-tp="again">' + ICO('i-dice') + ' Roll again</button></div>'
        + '<div class="loot-tp-coins">' + COINS.map(c => '<label>' + c + ' <input type="number" min="0" inputmode="numeric" data-tpc="' + c + '" value="' + (cur.coins[c] || 0) + '"></label>').join('') + '</div>'
        + (cur.items.length ? '<div class="loot-tp-items">' + cur.items.map((it, k) => '<label><input type="checkbox" data-tpi="' + k + '" checked> ' + (it.qty > 1 ? it.qty + '× ' : '') + esc(it.name) + (it.value ? ' <span class="cb-dim">(' + esc(it.value) + ')</span>' : '') + '</label>').join('') + '</div>'
                            : '<div class="cb-dim" style="margin:6px 0">No items on this roll.</div>')
        + '<div class="modal-actions"><button class="btn" data-tp="cancel">Cancel</button><button class="btn primary" data-tp="add">Add to loot</button></div></div>';
    };
    const coinsNow = () => Object.fromEntries(COINS.map(c => [c, Math.max(0, parseInt((back.querySelector('[data-tpc="' + c + '"]') || {}).value) || 0)]));
    paint();
    document.body.appendChild(back);
    const close = () => back.remove();
    back.addEventListener('click', e => {
      const a = e.target.closest('[data-tp]'); if (!a) return;
      if (a.dataset.tp === 'cancel') return close();
      if (a.dataset.tp === 'again'){ const n = this._rollTreasure(kind, band, edition); if (n){ cur = n; paint(); } return; }
      if (a.dataset.tp === 'use'){
        const d = parseInt(back.querySelector('#loot-tp-d100').value, 10);
        if (!(d >= 1 && d <= 100)){ if (typeof showToast === 'function') showToast('A d100 is 1 to 100', { alert: true }); return; }
        const keep = coinsNow(), n = this._rollTreasure(kind, band, edition, d);
        if (n){ cur = kind === 'hoard' ? Object.assign(n, { coins: keep }) : n; paint(); }
        return;
      }
      if (a.dataset.tp === 'add'){
        const coins = coinsNow(), items = cur.items.filter((it, k) => { const cb = back.querySelector('[data-tpi="' + k + '"]'); return !cb || cb.checked; });
        close();
        if (!COINS.some(c => coins[c]) && !items.length) return;
        this._undoable('Treasure added to the loot', () => {
          COINS.forEach(c => { if (coins[c]) this._loot[c] = (this._loot[c] || 0) + coins[c]; });
          items.forEach(i => this._loot.items.push({ id: uid(), name: i.name, qty: i.qty, value: i.value, assignedTo: null }));
        });
      }
    });
    back.addEventListener('mousedown', e => { if (e.target === back) close(); });
    back.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
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
        this._treasurePreview(res, r.kind, band, r.edition);
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

  // A magic item's value when the book prints none. A table on the 2024 rules
  // uses the 2024 DMG's price by rarity (half for a potion, a scroll or
  // ammunition), the Shop's own rule; 2014 gives only a range, so nothing is
  // made up. A +1 Longsword came in at 15 gp — the plain longsword's price —
  // and a Bag of Holding at nothing, so it counted for nothing and couldn't
  // be sold.
  _magicValue(rarity, raw){
    const S = typeof panelDefs !== 'undefined' && panelDefs.shop;
    if (!S || typeof S._priceEdition !== 'function' || S._priceEdition() !== '2024') return '';
    const key = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', 'very rare': 'VeryRare', legendary: 'Legendary' }[String(rarity || '').toLowerCase()];
    if (!key) return '';
    const t = String(raw && raw.type || '').split('|')[0];
    const p = S._magicPriceForRarity(key, t === 'P' || t === 'SC' || t === 'A');
    return p ? p.toLocaleString() + ' gp' : '';
  },
  // What the book says it's worth, by its name: the catalogue's price (a
  // magic item's by rarity), or a spell scroll's by its spell's level —
  // "Spell Scroll (Charm Person)" is a 1st-level scroll, 50 gp. '' if none.
  _bookValue(name){
    const n = String(name || '').trim(), low = n.toLowerCase(); if (!n) return '';
    const exact = q => this._searchItems(q).find(d => d.name.toLowerCase() === q.toLowerCase() && this._parseGp(d.value) > 0);
    const hit = exact(n); if (hit) return hit.value;
    const S = typeof panelDefs !== 'undefined' && panelDefs.shop;
    const m = /^spell scroll\s*\((.+)\)$/i.exec(n) || /^scroll of (.+)$/i.exec(n);
    if (!m || !S || typeof S._priceEdition !== 'function' || S._priceEdition() !== '2024' || !Array.isArray(_5eData)) return '';
    const sp = _5eData.find(d => d.cat === 'spell' && d.name.toLowerCase() === m[1].trim().toLowerCase() && d._raw && d._raw.level != null);
    if (!sp) return '';
    const lvl = +sp._raw.level, row = exact(lvl === 0 ? 'Spell Scroll (Cantrip)' : 'Spell Scroll (Level ' + lvl + ')');
    if (row) return row.value;
    return this._magicValue(lvl <= 1 ? 'common' : lvl <= 3 ? 'uncommon' : lvl <= 5 ? 'rare' : lvl <= 8 ? 'very rare' : 'legendary', { type: 'SC' });
  },
  // One item's weight: as typed, else the book's (a magic variant weighs what
  // its base does). The same rule the character sheet uses.
  _itemWt(it){
    const w = parseFloat(it && it.weight); if (!isNaN(w)) return w;
    const n = String(it && it.name || '').trim().toLowerCase();
    if (!n || typeof _5eData === 'undefined' || !Array.isArray(_5eData)) return 0;
    for (const d of _5eData){
      if (d.cat !== 'item') continue;
      if (d.name.toLowerCase() === n && d._weight != null) return +d._weight || 0;
      if (d._variants && d._weight != null && d._variants.some(v => v.name && v.name.toLowerCase() === n)) return +d._weight || 0;
    }
    return 0;
  },
  _isMagicRarity(r){ r = String(r || '').toLowerCase(); return !!r && r !== 'none' && r !== 'unknown' && r !== 'varies'; },
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
      if (matches(d.name, d.meta)) all.push({name:d.name, meta:d.meta, _source:d._source, value:d._value || (this._isMagicRarity(d._rarity) ? this._magicValue(d._rarity, d._raw) : ''), rarity:d._rarity || null, weight: d._weight ?? null});
      // Items with bonus variants (+1, +2, +3) — include each variant as its
      // own selectable row so the user can drop "+2 Longsword" directly
      // into loot without having to retype the prefix.
      if (d._variants){
        for (const v of d._variants){
          if (isHidden(v._source || d._source)) continue;
          if (matches(v.name, v.meta)){
            // a magic variant is priced as the magic item it is, not as its base
            const vr = v._raw?.rarity || d._raw?.rarity || null;
            const val = this._isMagicRarity(vr) ? this._magicValue(vr, v._raw || d._raw) : (v._raw?.value || '');
            all.push({name:v.name, meta:v.meta, _source:v._source||d._source, value:val, rarity:vr, weight: v._raw?.weight ?? d._raw?.weight ?? null});
          }
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
    // Nobody's is the party's: assigned is the character's own.
    const opts = ['<option value="">Party loot</option>'];
    const me = this._me();
    if (this._isPlayer()){
      if (me) opts.push(`<option value="${esc(me.id)}"${item.assignedTo===me.id?' selected':''}>${esc(me.name)} (me)</option>`);
      const g = (this._loot.tabGroups || []).find(x => x.id === item.assignedTo);
      if (g) opts.push(`<option value="${esc(g.id)}" selected>👥 ${esc(g.name)}</option>`);
      return `<select class="loot-assign" data-lfield="assignedTo" data-li="${idx}" title="Claim it for yourself, or give it back to the party">${opts.join('')}</select>`;
    }
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
    return `<select class="loot-assign" data-lfield="assignedTo" data-li="${idx}" title="Who has it — a character's is theirs (it shows in their inventory); nobody's is the party's">${opts.join('')}</select>`;
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
        <span class="loot-group-meta">${matched.length} item${matched.length===1?'':'s'}${totalVal?` · ${sktGp(totalVal)} gp`:''}</span>
      </div>
      ${matched.map(({item, idx}) => this._itemRow(item, idx)).join('')}
    </div>`;
  },

  // Modal: create or edit a tab group. Pass groupId to edit, or null to create.
  _openTabGroupModal(groupId){
    if (this._isPlayer()) return;   // the DM's way of sorting the loot
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
    // (undoable: it went at once, and its items fell back to the party loot)
    backdrop.querySelector('#cg-del')?.addEventListener('click', () => {
      close();
      if (this._view === 'tabgroup:'+editing.id) this._view = 'all';
      this._undoable('Deleted the tab “' + editing.name + '”', () => { this._loot.tabGroups = this._loot.tabGroups.filter(g => g.id !== editing.id); });
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
    if (match && !item.notes && typeof popOutDetail === 'function'){
      popOutDetail(match);
      return;
    }
    this._openNotes(idx);
  },
  // What an item is, in the DM's words. Half the party's haul is their own —
  // a locket, a crown with fifteen gems, a certificate — and there was nowhere
  // to say what any of it was: the book button said "custom item". The notes
  // show on the character's sheet too. Its owner (or the DM) can change them.
  _openNotes(idx){
    const item = this._loot.items[idx]; if (!item) return;
    const can = this._canEdit(item), match = this._findFiveItem(item.name);
    document.getElementById('loot-notes')?.remove();
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop'; bd.id = 'loot-notes';
    bd.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(item.name)}" style="width:420px;max-width:92vw">
      <h3>${esc(item.name)}</h3>
      <p class="loot-notes-sub">${esc([(item.qty || 1) > 1 ? '×' + item.qty : '', item.value || '', this._memberName(item.assignedTo) || 'Party loot'].filter(Boolean).join(' · '))}${match ? '' : ' · your own item'}</p>
      ${can ? `<textarea id="loot-notes-t" rows="5" maxlength="1000" placeholder="What it is, what it does, where it came from…">${esc(item.notes || '')}</textarea>`
            : `<div class="loot-notes-ro">${item.notes ? esc(item.notes).replace(/\n/g, '<br>') : '<i>No notes.</i>'}</div>`}
      <div class="modal-actions" style="display:flex;gap:6px;justify-content:flex-end;margin-top:12px">
        ${match ? '<button class="btn" id="loot-notes-book" style="margin-right:auto">The book’s entry</button>' : ''}
        <button class="btn" id="loot-notes-x">${can ? 'Cancel' : 'Close'}</button>
        ${can ? '<button class="btn primary" id="loot-notes-ok">Save</button>' : ''}
      </div>
    </div>`;
    document.body.appendChild(bd);
    const close = () => bd.remove();
    bd.querySelector('#loot-notes-x').addEventListener('click', close);
    bd.querySelector('#loot-notes-book')?.addEventListener('click', () => { close(); if (typeof popOutDetail === 'function') popOutDetail(match); });
    bd.querySelector('#loot-notes-ok')?.addEventListener('click', () => {
      const v = bd.querySelector('#loot-notes-t').value.trim().slice(0, 1000);
      close();
      const it = this._loot.items.find(x => x.id === item.id) || item;
      if (v === (it.notes || '')) return;
      this._undoable((v ? 'Notes on ' : 'Cleared the notes on ') + it.name, () => { if (v) it.notes = v; else delete it.notes; });
    });
    bd.addEventListener('mousedown', e => { if (e.target === bd) close(); });
    bd.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    setTimeout(() => (bd.querySelector('#loot-notes-t') || bd.querySelector('#loot-notes-x'))?.focus(), 30);
  },

  _itemRow(item, i){
    if (!this._canEdit(item)) return this._lockedRow(item, i);
    // Who has it is the dropdown on the right. A "→ Name" pill beside the name
    // said the same thing again and took the name's room: with "→ Ulrick
    // Axeborne" in the row, "Handaxe" got a 12px box.
    // (A "paid / collected" circle sat beside each name; nothing read it and
    // nobody knew what it was for. Gone — an item's old mark is left alone.)
    const assignedName = this._memberName(item.assignedTo);
    // Weight column only renders when the user has flipped on the
    // encumbrance toggle. When hidden, the field is omitted entirely so
    // existing flex layout stays clean.
    const showWeight = !!(state.settings && state.settings.lootEncumbrance);
    const weightInp = showWeight
      ? `<input type="number" step="0.1" min="0" class="loot-wt" value="${item.weight!=null?esc(String(item.weight)):''}" data-lfield="weight" data-li="${i}" placeholder="${this._itemWt(item) ? esc(String(this._itemWt(item))) : 'lb'}" title="Weight per item (lb)${item.weight == null && this._itemWt(item) ? ' — the book’s, until you type one' : ''}">`
      : '';
    return `<div class="loot-item ${item.assignedTo?'assigned':''}" data-i="${i}" data-id="${esc(item.id||'')}" draggable="true" title="Right-click (or hold) to sell, split or move it">
      <span class="loot-drag-handle" title="Drag to reorder">⋮⋮</span>
      <div class="loot-name">
        <button class="loot-info-btn${item.notes ? ' has-notes' : ''}" data-lact="info" data-li="${i}" title="${item.notes ? esc(item.notes.slice(0, 200)) : 'What it is: the book’s entry, or your notes'}">${ICO('i-book-open')}</button>
        <input class="loot-name-input" type="text" value="${esc(item.name)}" data-lfield="name" data-li="${i}" title="${esc(item.name)}${assignedName ? ' → ' + esc(assignedName) : ''} — click to rename" spellcheck="false">
      </div>
      <input type="number" class="loot-qty" value="${item.qty||1}" min="1" data-lfield="qty" data-li="${i}" title="Quantity">
      <input type="text" class="loot-val" value="${esc(item.value||'')}" data-lfield="value" data-li="${i}" placeholder="gp val" title="Value">
      ${weightInp}
      ${this._assignSelect(item, i)}
      <button class="btn icon-btn loot-more" data-lact="menu" data-li="${i}" title="Sell, split or move it…" aria-label="Sell, split or move ${esc(item.name)}">⋯</button>
      <button class="btn icon-btn danger" data-lact="del" data-li="${i}" title="Remove">×</button>
    </div>`;
  },

  // ─── Filtering the list ────────────────────────────────────────────────────
  // 33 items and room for six: a word finds one. Matches the name, the notes,
  // the value and who has it, in whatever tab is showing.
  _applyFilter(){
    const b = this._body; if (!b) return;
    const list = b.querySelector('.loot-items'); if (!list) return;
    const words = String(this._filter || '').toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0, total = 0;
    list.querySelectorAll('.loot-item').forEach(row => {
      const it = this._loot.items[+row.dataset.i]; if (!it) return;
      total++;
      const hay = [it.name, it.notes, it.value, this._memberName(it.assignedTo) || 'party loot'].join(' ').toLowerCase();
      const hit = words.every(w => hay.includes(w));
      row.style.display = hit ? '' : 'none';
      if (hit) shown++;
    });
    list.querySelectorAll('.loot-group').forEach(g => { g.style.display = g.querySelector('.loot-item:not([style*="none"])') ? '' : 'none'; });
    list.querySelector('.loot-filter-none')?.remove();
    if (words.length && total && !shown){
      const d = document.createElement('div');
      d.className = 'empty-state loot-filter-none';
      d.textContent = 'Nothing here matches “' + this._filter.trim() + '”.';
      list.appendChild(d);
    }
    const fl = b.querySelector('#loot-filter');
    if (fl) fl.classList.toggle('on', !!words.length);
  },
  // ─── Changing coins up ─────────────────────────────────────────────────────
  // The purse as gold where it can be: ten copper a silver, ten silver a gold,
  // two electrum a gold. Platinum is left as it is. Null when there's nothing
  // to change (the party carried 1,729 silver — some 35 lb of coin).
  _changeUp(){
    const c = k => Math.max(0, parseInt(this._loot[k]) || 0);
    let cp = c('cp'), sp = c('sp'), ep = c('ep'), gp = c('gp');
    sp += Math.floor(cp / 10); cp %= 10;
    gp += Math.floor(sp / 10); sp %= 10;
    gp += Math.floor(ep / 2); ep %= 2;
    if (cp === c('cp') && sp === c('sp') && ep === c('ep')) return null;
    return { cp, sp, ep, gp };
  },
  _changeUpText(){
    const to = this._changeUp(); if (!to) return '';
    const f = o => ['gp', 'ep', 'sp', 'cp'].filter(k => o[k]).map(k => (+o[k]).toLocaleString() + ' ' + k).join(' ') || 'nothing';
    const from = {}; ['cp', 'sp', 'ep'].forEach(k => { if ((parseInt(this._loot[k]) || 0) !== to[k]) from[k] = parseInt(this._loot[k]) || 0; });
    const into = { gp: to.gp - (parseInt(this._loot.gp) || 0) }; ['ep', 'sp', 'cp'].forEach(k => { if (k in from && to[k]) into[k] = to[k]; });
    return f(from) + ' → ' + f(into);
  },
  // ─── Selling ────────────────────────────────────────────────────────────────
  // Loot sold in town turns into coins in the purse: half its value as the
  // rules have it for selling found treasure, or the full value (a gem, art
  // that sells at its worth). Right-click a row, or hold it. Undoable.
  // Coins as handed over: whole gold, then silver, then copper.
  _toCoins(gp){
    let cp = Math.round(gp * 100);
    const g = Math.floor(cp / 100); cp -= g * 100;
    const s = Math.floor(cp / 10); cp -= s * 10;
    return { gp: g, sp: s, cp };
  },
  _fmtCoins(c){ return ['gp','sp','cp'].filter(k => c[k]).map(k => c[k].toLocaleString() + ' ' + k).join(' ') || '0 gp'; },
  _sell(i, share, one){
    const it = this._loot.items[i]; if (!it || !this._canEdit(it)) return;
    const each = this._parseGp(it.value); if (!(each > 0)) return;
    const n = one ? 1 : Math.max(1, parseInt(it.qty) || 1);
    const c = this._toCoins(each * n * share);
    this._undoable('Sold ' + (n > 1 ? n + ' × ' : '') + it.name + ' for ' + this._fmtCoins(c), () => {
      ['gp','sp','cp'].forEach(k => { if (c[k]) this._loot[k] = (+this._loot[k] || 0) + c[k]; });
      if (one && (parseInt(it.qty) || 1) > 1) it.qty = (parseInt(it.qty) || 1) - 1;
      else this._loot.items.splice(this._loot.items.indexOf(it), 1);
    });
  },
  _rowMenu(i, x, y){
    const it = this._loot.items[i]; if (!it || !this._canEdit(it) || typeof showContextMenu !== 'function') return;
    const each = this._parseGp(it.value), n = Math.max(1, parseInt(it.qty) || 1);
    if (!(each > 0)){
      // Added before it had a price (a Ring of the Ram, a Potion of Longevity:
      // nothing, so they counted for nothing and couldn't be sold) — the book's.
      const bv = this._bookValue(it.name);
      const first = bv ? { label: 'Use the book’s price — ' + bv, onClick: () => { const x = this._loot.items.find(y => y.id === it.id) || it; this._undoable(x.name + ' — ' + bv, () => { x.value = bv; }); } }
                       : { label: 'No value to sell it for — type one in', disabled: true, onClick: () => {} };
      showContextMenu(x, y, [first].concat(this._notesItem(i), this._splitItems(i), this._moveItems(i))); return;
    }
    const items = [
      { label: 'Sell' + (n > 1 ? ' all ' + n : '') + ' for half — ' + this._fmtCoins(this._toCoins(each * n / 2)), onClick: () => this._sell(i, 0.5, false) },
      { label: 'Sell' + (n > 1 ? ' all ' + n : '') + ' for full value — ' + this._fmtCoins(this._toCoins(each * n)), onClick: () => this._sell(i, 1, false) },
    ];
    if (n > 1) items.push({ label: 'Sell one for half — ' + this._fmtCoins(this._toCoins(each / 2)), onClick: () => this._sell(i, 0.5, true) });
    showContextMenu(x, y, items.concat(this._notesItem(i), this._splitItems(i), this._moveItems(i)));
  },
  _notesItem(i){ const it = this._loot.items[i]; return [{ label: '─────' }, { label: it && it.notes ? 'Notes…' : 'Add notes…', onClick: () => this._openNotes(i) }]; },
  // One from a stack. Five potions of healing were one row, and claiming it
  // gave a character all five: there was no handing out one each.
  _splitItems(i){
    const it = this._loot.items[i]; if (!it || (parseInt(it.qty) || 1) < 2) return [];
    const one = (label, to) => ({ label, onClick: () => {
      this._undoable(label.replace(/ one\b/, ' one ' + it.name), () => { sktLootSplit(this._loot, it.id, to === undefined ? it.assignedTo : to); });
    } });
    const out = [{ label: '─────' }], me = this._me(), party = !this._isAssignedTo(it.assignedTo);
    if (me && party) out.push(one('Claim one', me.id));
    if (!party) out.push(one('Give one back to the party loot', null));
    if (!this._isPlayer()) out.push(one('Split off one'));
    return out;
  },
  // Up and down the list, for a finger (dragging a row needs a mouse).
  _moveItems(i){
    const n = this._loot.items.length, mv = (to, label) => ({ label, onClick: () => {
      const it = this._loot.items[i]; if (!it) return;
      this._undoable('Moved ' + it.name, () => { const a = this._loot.items; a.splice(i, 1); a.splice(to, 0, it); });
    } });
    const out = [];
    if (i > 0) out.push(mv(i - 1, 'Move up'), mv(0, 'Move to the top'));
    if (i < n - 1) out.push(mv(i + 1, 'Move down'));
    return out.length ? [{ label: '─────' }].concat(out) : [];
  },
  // Another character's, on a player's phone: to look at, not to change.
  _lockedRow(item, i){
    const who = this._memberName(item.assignedTo) || 'someone';
    return `<div class="loot-item assigned locked" data-i="${i}" title="${esc(who)}’s — only they or the DM can change it">
      <span class="loot-drag-handle" aria-hidden="true"></span>
      <div class="loot-name">
        <button class="loot-info-btn${item.notes ? ' has-notes' : ''}" data-lact="info" data-li="${i}" title="${item.notes ? esc(item.notes.slice(0, 200)) : 'What it is'}">${ICO('i-book-open')}</button>
        <span class="loot-name-text">${esc(item.name)}</span>
      </div>
      <span class="loot-qty loot-ro">${item.qty||1}</span>
      <span class="loot-val loot-ro">${esc(item.value||'')}</span>
      <span class="loot-assign loot-ro">${esc(who)}</span>
      <span class="loot-del-space" aria-hidden="true"></span>
    </div>`;
  },
  // Free-form "10 gp" / "50 sp" / "200 cp" → numeric gp. Shared between the
  // per-member and per-group totals.
  _parseGp(s){
    // "10sp", "3pp", "25GP": the coin straight after the number. With no
    // space, \bsp\b never matched, so 10 sp read as 10 gp and 3 pp as 3 gp.
    const str = String(s||'').toLowerCase().trim().replace(/(\d)\s*(cp|sp|ep|gp|pp)\b/g, '$1 $2');
    if (!str) return 0;
    // Several coins at once — "184 gp 7 sp", as the shop writes a price.
    // Stripping every non-digit below would read that as 1847 sp.
    const coins = [...str.matchAll(/(-?[\d,.]+)\s*(cp|sp|ep|gp|pp)\b/g)];
    if (coins.length > 1){
      const per = { cp:0.01, sp:0.1, ep:0.5, gp:1, pp:10 };
      return Math.round(coins.reduce((t, m) => t + (parseFloat(m[1].replace(/,/g,'')) || 0) * per[m[2]], 0) * 100) / 100;
    }
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
      ? {name:'Party loot', icon:'📦'}
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
      return `<div class="empty-state">${memberId==='__unassigned__'?'No party loot — everything has been claimed.':esc(member.name)+' hasn\u2019t claimed anything.'}</div>`;
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
    // What the claimed loot weighs, by the sheet's own rule (as typed, else
    // the book's). It said "6.0 / 240 lb" for Ulrick, whose sheet carries
    // 107: only typed weights counted (his half plate, nothing) and it read as
    // everything he carries. His sheet adds his own gear and coins to this.
    let weightHtml = '';
    if (showWeight){
      const totalWt = Math.round(matched.reduce((sum, {item}) => sum + this._itemWt(item) * (parseInt(item.qty) || 1), 0) * 10) / 10;
      const tip = member.id ? 'What ' + member.name + ' has claimed here weighs ' + totalWt + ' lb; their sheet adds what else they carry' : 'What it weighs, as typed or from the book';
      weightHtml = ` · <span class="loot-weight-meta" title="${esc(tip)}">${totalWt.toLocaleString()} lb${member.id ? ' claimed' : ''}</span>`;
    }
    return `<div class="loot-group">
      <div class="loot-group-head">
        <span class="loot-group-icon">${iconHtml}</span>
        <span class="loot-group-name">${esc(member.name)}</span>
        <span class="loot-group-meta">${matched.length} item${matched.length===1?'':'s'}${totalVal?` · ${sktGp(totalVal)} gp`:''}${weightHtml}</span>
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
        ${['cp','sp','ep','gp','pp'].map(c=>`<div class="loot-coin"><div class="l">${c.toUpperCase()}</div><input type="number" id="loot-${c}" value="${this._loot[c]||0}" min="0"${this._canAdd() ? '' : ' readonly'}></div>`).join('')}
      </div>
      <div class="loot-sumbar">
        <span title="Everything converted to gold, and an even share for each party member">Total <strong style="color:var(--warning)">${(+totalGp).toLocaleString(undefined, { maximumFractionDigits: 2 })} gp</strong>
          · <strong style="color:var(--warning)">${(+(this._sharers().length ? totalGp / this._sharers().length : totalGp)).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong> each</span>
        ${state.settings?.lootEncumbrance ? (() => {
          // The purse weighs too: fifty coins a pound (3,671 coins, 73 lb).
          const n = ['cp','sp','ep','gp','pp'].reduce((t, k) => t + Math.max(0, parseInt(this._loot[k]) || 0), 0);
          return n ? `<span class="loot-coinwt" title="${n.toLocaleString()} coins — fifty weigh a pound">Coins ${(Math.round(n / 50 * 10) / 10).toLocaleString()} lb</span>` : '';
        })() : ''}
        ${this._canAdd() && this._changeUp() ? `<button class="btn small" id="loot-changeup" title="Trade copper, silver and electrum up into gold, the same value: ${esc(this._changeUpText())}">Change up</button>` : ''}
        ${this._isPlayer() ? '' : `<label class="loot-encumbrance-toggle" title="Show a weight column on items and per-member encumbrance subtotals (5e: STR×15 = lbs)">
          <input type="checkbox" id="loot-encumbrance-toggle" ${state.settings?.lootEncumbrance?'checked':''}>
          <span>${ICO('i-scale')} Weight</span>
        </label>`}
        <span style="flex:1"></span>
        ${this._isPlayer() ? '' : `<button class="btn small" id="loot-roll" title="Roll random treasure on the DMG tables">${ICO('i-dice')} Roll treasure</button>
        <button class="btn small" id="loot-divvy">Divvy up</button>`}
      </div>
      <div class="loot-add-row"${this._canAdd() ? '' : ' style="display:none"'}>
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
          return `<button class="loot-view-tab ${view==='party'?'active':''}" data-view="party" title="What each character has claimed — theirs, and in their inventory"><span class="loot-tab-icon">${ICO('i-user')}</span><span class="loot-tab-name">Claimed</span>${cnt?`<span class="loot-tab-count">${cnt}</span>`:''}</button>`;
        })() : ''}
        ${(this._loot.tabGroups||[]).map(g => {
          const cnt = this._itemsForTabGroup(g).length;
          const key = 'tabgroup:'+g.id;
          return `<button class="loot-view-tab tabgroup ${view===key?'active':''}" data-view="${esc(key)}" title="${esc(g.name)} — ${(g.memberIds||[]).length} member(s)">
            <span class="loot-tab-icon">${ICO('i-user')}</span>
            <span class="loot-tab-name">${esc(g.name)}</span>
            ${cnt?`<span class="loot-tab-count">${cnt}</span>`:''}
            ${this._isPlayer() ? '' : `<span class="loot-tab-edit" data-tg-edit="${esc(g.id)}" title="Edit tab">${ICO('i-gear')}</span>`}
          </button>`;
        }).join('')}
        ${this._isPlayer() ? '' : `<button class="loot-view-tab loot-tab-add" data-tg-add="1" title="Create a custom tab grouping party members"><span class="loot-tab-icon">${ICO('i-tag')}</span><span class="loot-tab-name">Tab</span></button>`}
        ${(() => {
          // "Group" tab = shared / unassigned loot (treats items pointing at
          // a deleted party member as unassigned too).
          const cnt = this._loot.items.filter(it => !this._isAssignedTo(it.assignedTo)).length;
          return `<button class="loot-view-tab ${view==='unassigned'?'active':''}" data-view="unassigned" title="Nobody has claimed it — the party's"><span class="loot-tab-icon">${ICO('i-chest')}</span><span class="loot-tab-name">Party loot</span>${cnt?`<span class="loot-tab-count">${cnt}</span>`:''}</button>`;
        })()}
        ${this._loot.items.length > 6 || this._filter ? `<input type="search" id="loot-filter" class="loot-filter" placeholder="Filter" value="${esc(this._filter || '')}" autocomplete="off" spellcheck="false" title="Show only what matches: a name, a note, a value or who has it" aria-label="Filter the loot">` : ''}
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
    // (never below nothing: −50 gp was kept as −50)
    ['cp','sp','ep','gp','pp'].forEach(c=>{b.querySelector(`#loot-${c}`).addEventListener('change',e=>{
      if (!this._canAdd()){ this._render(); return; }
      const v = Math.max(0, parseInt(e.target.value)||0), was = +this._loot[c] || 0;
      if (v === was){ e.target.value = was; return; }
      this._undoable(c + ' ' + was.toLocaleString() + ' → ' + v.toLocaleString(), () => { this._loot[c] = v; });
    });});

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
      if (el.dataset.lact !== 'info' && !this._canEdit(this._loot.items[i])) return;
      if(el.dataset.lact==='del'){
        const it = this._loot.items[i]; if (!it) return;
        this._undoable('Removed ' + it.name + (it.qty > 1 ? ' ×' + it.qty : ''), () => { this._loot.items.splice(i,1); });
      } else if (el.dataset.lact==='info'){
        this._openItemDetail(i);
      } else if (el.dataset.lact==='menu'){
        // (the row's menu: right-click or a held finger reached it, and only
        // a tooltip said so — which a phone never shows)
        const r = el.getBoundingClientRect();
        this._rowMenu(i, r.left, r.bottom + 2);
      }
    }));

    // Field changes (name, qty, value, assignedTo)
    b.querySelectorAll('[data-lfield]').forEach(inp=>{
      inp.addEventListener('change', e => {
        const i=+e.target.dataset.li, f=e.target.dataset.lfield;
        if (!this._canEdit(this._loot.items[i])){ this._render(); return; }
        let v = e.target.value;
        // a player claims for themselves, or gives back — no one else
        if (f==='assignedTo' && this._isPlayer()){ const me = this._me(); if (v && (!me || v !== me.id) && !this._assignedToGroup(v)){ this._render(); return; } }
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
        if (f==='assignedTo'){
          const it = this._loot.items[i], who = this._memberName(v) || 'the party';
          this._undoable(it.name + ' → ' + who, () => { it.assignedTo = v; });
          return;
        }
        // Undoable (Ctrl+Z), quietly: a name typed over or a wrong count had
        // no way back, though deleting the item had one.
        const it = this._loot.items[i], was = it[f];
        if (String(was ?? '') === String(v)) return;
        const run = () => { it[f] = v; this._save(); };
        const label = f === 'name' ? 'Renamed ' + was + ' to ' + v : it.name + ' — ' + (f === 'qty' ? '×' : f === 'weight' ? 'weight ' : '') + v;
        if (typeof sktUndoable === 'function') sktUndoable(label, run, { keys: ['skt-loot-v1'], quiet: true }); else run();
        // Re-render so pills / counts / totals refresh.
        if (f==='qty' || f==='weight') this._render();
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
    b.querySelector('#loot-divvy')?.addEventListener('click',()=>{
      // The player characters only: a rival or foe kept in the party list
      // isn't owed a share (it was split between everyone in it).
      const pcs = typeof sktPlayerParty === 'function' ? sktPlayerParty() : state.party;
      const n=pcs.length;if(!n){showToast('No party members');return;}
      const each=sktGp(parseFloat(totalGp)/n);
      // Coin by coin, as it can be handed out: each gets an equal share of
      // every coin, and what doesn't divide evenly stays in the party loot.
      const COINS = ['pp','gp','ep','sp','cp'];
      const share = Object.fromEntries(COINS.map(k => [k, Math.floor((+this._loot[k] || 0) / n)]));
      const left = Object.fromEntries(COINS.map(k => [k, (+this._loot[k] || 0) - share[k] * n]));
      const fmt = o => COINS.filter(k => o[k]).map(k => o[k] + ' ' + k).join(', ') || 'nothing';
      const rows = pcs.map(p =>
        `<div class="divvy-row"><span>${esc(p.name)}</span><span class="divvy-amt">${esc(fmt(share))}</span></div>`
      ).join('');
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="min-width:300px">
        <h3>Divvy up loot</h3>
        <p style="color:var(--text-muted);font-size:var(--fs-sm);margin:0 0 10px">
          <strong style="color:var(--accent)">${sktGp(+totalGp)} gp</strong> split between
          <strong>${n}</strong> party member${n===1?'':'s'} —
          <strong style="color:var(--accent)">${each} gp</strong> each.
        </p>
        <div class="divvy-list">${rows}</div>
        <p style="color:var(--text-muted);font-size:var(--fs-sm);margin:10px 0 0">Left in the party loot: ${esc(fmt(left))}</p>
        <div class="modal-actions" style="margin-top:14px"><button class="btn" id="divvy-ok">Close</button><button class="btn primary" id="divvy-pay"${COINS.some(k => share[k]) ? '' : ' disabled'}>Pay it out</button></div>
      </div>`;
      document.body.appendChild(backdrop);
      const close = () => backdrop.remove();
      backdrop.querySelector('#divvy-ok').addEventListener('click', close);
      // Into each character's purse; the loot keeps the remainder.
      backdrop.querySelector('#divvy-pay').addEventListener('click', () => {
        const ids = new Set(pcs.map(p => p.id));
        const run = () => {
          state.party = state.party.map(p => ids.has(p.id) ? Object.assign({}, p, { gold: (+p.gold || 0) + share.gp,
            coins: Object.assign({}, p.coins, { pp: (+(p.coins || {}).pp || 0) + share.pp, ep: (+(p.coins || {}).ep || 0) + share.ep, sp: (+(p.coins || {}).sp || 0) + share.sp, cp: (+(p.coins || {}).cp || 0) + share.cp }) }) : p);
          COINS.forEach(k => { this._loot[k] = left[k]; });
          this._save(); save(); this._render();
          try { panelDefs.party && panelDefs.party._render && panelDefs.party._render(); } catch(e){}
        };
        if (typeof sktUndoable === 'function') sktUndoable('Paid out ' + fmt(share) + ' each', run, { keys: SKT_UNDO_DEFAULT_KEYS.concat(['skt-loot-v1']) }); else run();
        close();
      });
      backdrop.addEventListener('mousedown', e => { if (e.target===backdrop) close(); });
      backdrop.addEventListener('keydown', e => { if (e.key==='Escape') close(); });
      setTimeout(()=>backdrop.querySelector('#divvy-ok')?.focus(), 30);
    });

    // Drag-to-reorder on every item row.
    this._wireRowDrag();
    // The filter: rows hide as you type, nothing re-drawn (the box keeps the
    // cursor). Escape clears it.
    const fl = b.querySelector('#loot-filter');
    if (fl){
      fl.addEventListener('input', () => { this._filter = fl.value; this._applyFilter(); });
      fl.addEventListener('keydown', e => { if (e.key === 'Escape' && fl.value){ e.stopPropagation(); fl.value = ''; this._filter = ''; this._applyFilter(); } });
    }
    this._applyFilter();
    b.querySelector('#loot-changeup')?.addEventListener('click', () => {
      const to = this._changeUp(); if (!to) return;
      const was = this._changeUpText();
      this._undoable('Changed up: ' + was, () => { Object.assign(this._loot, to); });
    });
    // Right-click (or hold) a row: sell it.
    b.querySelectorAll('.loot-item:not(.locked)').forEach(row => {
      const open = (x, y) => this._rowMenu(+row.dataset.i, x, y);
      row.addEventListener('contextmenu', e => { if (e.target.closest('input,select,textarea')) return; e.preventDefault(); open(e.clientX, e.clientY); });
      if (typeof addLongPress === 'function') addLongPress(row, (x, y) => open(x, y));
    });

    // Restore the items-list scroll position after the new DOM is wired up,
    // so re-renders (qty / assignment change) feel in-place.
    const newList = b.querySelector('.loot-items');
    if (newList) newList.scrollTop = savedScroll;
  },
});
