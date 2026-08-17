// ============================================================
// TURN VIEW — one surface for one creature's turn
// ============================================================
// Running a turn took four windows: the Combat Tracker for whose turn it is,
// the bestiary for what the creature can do, the Attack Runner to roll it, and
// the battle map for where everyone is standing. This is those four collapsed
// into the span of one turn.
//
// It OWNS NOTHING. Every number on it lives somewhere else and is read through
// to its owner:
//
//   order, initiative, whose turn, HP, conditions → state.combatants, and the
//     Combat Tracker's own methods for anything that mutates the order
//   resource pools                                → state.party[i].resources
//   positions                                     → battlemap's own tokens
//   stat blocks and attacks                       → the same parse the Attack
//                                                    Runner uses
//   damage                                        → combat._applyHpDelta, so
//                                                    resistances, immunities
//                                                    and concentration all
//                                                    still apply
//
// That is the whole design constraint. A turn view holding its own copy of the
// initiative order would be a second tracker that silently disagrees with the
// first, and the disagreement would surface mid-fight.

registerPanel('turnview', {
  title: 'Turn View', icon: '⚔',

  _log: [],
  _adv: 0,            // -1 disadvantage, 0 straight, +1 advantage — sticky for the turn
  _undo: null,        // one step back: HP, saves, pools, spent reactions
  _queue: null,       // an in-flight multiattack: one entry per swing
  _pending: null,     // {kind:'hit'|'move', …} — an outcome awaiting a decision
  _armed: null,       // combatant id the next roll will hit
  _editInit: false,
  _mapBig: false,
  // Manual zoom over the automatic framing. 1 = fit the fight. Deliberately
  // per-session and not persisted: the frame follows whoever is acting, so a
  // zoom that made sense for one creature's turn is rarely right for the next
  // session's opening round.
  _mapZoom: 1,
  _MAP_ZOOMS: [0.5, 0.75, 1, 1.5, 2, 3, 4, 6],
  _artMode: 'auto',   // grid when compact, map art when enlarged
  _sig: null,
  _result: '',
  _resultLive: false,
  _drag: null,        // {id, from:{x,y}} while a token is being dragged

  mount(body){
    this._body = body;
    this._render();
    // Same-browser DM tab + player tab. Firebase covers separate devices;
    // this covers the second window on one laptop, where nothing goes over
    // the network at all.
    if (!this._promptWired){
      this._promptWired = true;
      window.addEventListener('storage', e => {
        if (e.key !== 'skt-prompt-v1') return;
        try { state.prompt = e.newValue ? JSON.parse(e.newValue) : null; } catch(err){ state.prompt = null; }
        this._onPromptChange();
      });
    }
    if (typeof on5eLoaded === 'function' && !(typeof _5eLoaded !== 'undefined' && _5eLoaded)){
      on5eLoaded(() => { if (this._body) this._render(); });
    }
    if (typeof load5eData === 'function') load5eData();
  },
  unmount(){ this._body = null; this._pending = null; },

  menuItems(){
    return [
      { label: '↻ Refresh from the tracker', run: () => this._render() },
      { label: '🧹 Clear this panel\'s log', run: () => { this._log = []; this._render(); } },
      { label: '🗺 Map art: ' + this._artMode, run: () => {
          this._artMode = this._artMode === 'auto' ? 'on' : this._artMode === 'on' ? 'off' : 'auto';
          this._render();
        } },
    ];
  },

  // ─── Sync ─────────────────────────────────────────────────────────────────
  // Called from save(), i.e. after any change anywhere. Same cheap-signature
  // trick the Attack Runner uses: build a string of only what this panel
  // displays and do nothing the vast majority of the time. Without it, ending
  // a turn in the Combat Tracker would leave this panel showing the previous
  // creature — the exact desync the "owns nothing" rule exists to prevent.
  _combatSig(){
    return String(state.activeCombatantId) + '#' + (state.combatRound || 0) + '#'
      + (state.combatants || []).map(c =>
          [c.id, c.name, c.hp, c.hpMax, c.ac, c.initiative, c.isPC ? 1 : 0,
           c.reactionUsed ? 1 : 0, (c.conditions || []).join(',')].join('~')
        ).join('|');
  },
  _syncFromCombat(){
    if (!this._body || this._applying) return;
    if (this._combatSig() === this._sig) return;
    this._render();
  },

  // ─── Reading the tracker ──────────────────────────────────────────────────
  _order(){ return state.combatants || []; },
  _active(){
    const o = this._order();
    return o.find(c => c.id === state.activeCombatantId) || o[0] || null;
  },
  _partyOf(c){
    return (c && c.isPC) ? (state.party || []).find(p => p.id === c.id) || null : null;
  },
  _entryOf(c){
    const C = panelDefs.combat;
    return (C && typeof C.statBlockFor === 'function') ? C.statBlockFor(c) : null;
  },

  _roll(dice){
    const m = String(dice || '').replace(/\s+/g, '').match(/^(\d*)d(\d+)([+-]\d+)?$/i);
    if (!m) return { total: 0, detail: '—' };
    const n = parseInt(m[1] || '1'), sides = parseInt(m[2]), mod = parseInt(m[3] || '0');
    const rolls = [];
    for (let i = 0; i < n; i++) rolls.push(1 + Math.floor(Math.random() * sides));
    const sum = rolls.reduce((a, b) => a + b, 0);
    return { total: Math.max(0, sum + mod), detail: rolls.join('+') + (mod ? (mod > 0 ? '+' + mod : String(mod)) : '') };
  },
  _d(n){ return 1 + Math.floor(Math.random() * n); },

  // ─── Reactions ────────────────────────────────────────────────────────────
  // The table is generated by tools/extract-reactions.js out of data/class,
  // data/feats.json and data/spells — 5 reactions come from base classes, 79
  // from subclasses, 17 from feats. Class and level alone would find 5 of 101,
  // which is why subclass is read too.
  //
  // The six below are the ones with real mechanics here. Everything else is
  // offered, spent and logged for the DM to adjudicate: automating a hundred
  // features badly would be worse than automating six honestly.
  MECH: {
    // Damage-side: these change what lands.
    'Uncanny Dodge':    { when:'damage', halve:true },
    'Spirit Shield':    { when:'damage', reduce:[2,6], needs:'raging' },
    'Absorb Elements':  { when:'damage', halve:true,
                          onlyTypes:['acid','cold','fire','lightning','thunder'] },
    // To-hit side: these can turn a hit into a miss, so the roll is re-tested.
    'Cutting Words':    { when:'tohit',  die:8 },
    'Defensive Duelist':{ when:'tohit',  pb:true },
    'Shield':           { when:'tohit',  ac:5 },
    'Arcane Deflection':{ when:'tohit',  ac:2 },
    // Disadvantage: reroll the d20 and keep the lower. Modelled rather than
    // approximated as a flat penalty because the two aren't the same shape —
    // disadvantage bites hardest in the middle of the range and barely at all
    // at the ends, and against a low AC it often changes nothing.
    'Warding Flare':    { when:'tohit', disadv:true },
    'Entropic Ward':    { when:'tohit', disadv:true },
    'Shadowy Dodge':    { when:'tohit', disadv:true },
    'Instinctive Charm':{ when:'tohit', disadv:true },
    // Reroll: a fresh d20, not the lower of two. Silvery Barbs makes the
    // creature reroll and it must use the new roll even if it is better.
    'Silvery Barbs':    { when:'tohit', reroll:true },
    'Second Chance':    { when:'tohit', reroll:true },
  },
  // A monster's Parry says how much it adds in its own text — "adds 2 to its
  // AC", "adds 3". Read rather than assumed, so a Bandit Captain and a
  // Githyanki Knight get their own numbers.
  _statBlockMech(r){
    const m = /adds? (\d+) to its AC/i.exec(String(r.note || ''));
    if (m) return { when:'tohit', ac: parseInt(m[1], 10) };
    return null;
  },
  // What a reaction spends, named to match the party tracker's own pools. In
  // this panel those ARE the party tracker's pools — spending here decrements
  // state.party[i].resources[j] and the party card repaints, because there is
  // only one copy of the number.
  COST: {
    'Cutting Words':   { res:'Bardic Inspiration', n:1 },
    'Absorb Elements': { slot:1 },
    'Silvery Barbs':   { slot:1 },
    'Shield':          { slot:1 },
    'Spirit Shield':   { needs:'raging' },
  },

  _rxTable(){ return (typeof window !== 'undefined' && window.SKT_REACTIONS) || null; },

  // Proficiency bonus from level, for the handful of reactions that add it.
  _pb(lvl){ return 2 + Math.floor(Math.max(1, lvl || 1) - 1) / 4 | 0; },

  // Everything this creature could spend a reaction on, and where each came
  // from. A wrong guess by the derivation shows up as a visible chip rather
  // than silently shaping the prompt.
  _reactionsFor(c){
    const T = this._rxTable();
    if (!T) return [];
    const out = [];
    const p = this._partyOf(c);
    if (p){
      const sheet = p.sheet || {};
      const cls = String(p.cls || sheet.class || '').trim().toLowerCase();
      const sub = String(p.subclass || '').trim().toLowerCase();
      const lvl = parseInt(p.level || sheet.level || 0) || 0;
      T.classes.forEach(r => {
        if (r.cls.toLowerCase() === cls && r.lvl <= lvl) out.push({ ...r, from:'class' });
      });
      // Matched the same fuzzy way the Party panel's Features tab matches, so
      // "Circle of the Moon", "Moon" and "circle of the moon" all resolve.
      // Exact equality meant a DM who typed the full name got no subclass
      // reactions at all — 79 of the 101 in the table.
      const normSub = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const subN = normSub(sub);
      const subHit = rs => {
        const n = normSub(rs);
        return !!n && !!subN && (n === subN || n.includes(subN) || subN.includes(n));
      };
      T.subclasses.forEach(r => {
        if (r.cls.toLowerCase() === cls && subHit(r.sub) && r.lvl <= lvl)
          out.push({ ...r, from:'subclass' });
      });
      // Feats aren't a structured field anywhere in the app — the closest thing
      // is the free-text "Features and Traits" box a PDF import fills. Matching
      // names against that text finds Defensive Duelist when it is written
      // down and finds nothing when it isn't, which is the honest answer.
      const featText = String(sheet.features || '') + ' ' + (Array.isArray(p.feats) ? p.feats.join(' ') : '');
      if (featText.trim()){
        const hay = featText.toLowerCase();
        T.feats.forEach(f => { if (hay.includes(f.name.toLowerCase())) out.push({ ...f, from:'feat' }); });
      }
      // Reaction spells can't come from class and level — they depend on what
      // this character actually has written down.
      const known = Array.isArray(sheet.spells) ? sheet.spells.map(s => String(s).toLowerCase()) : [];
      T.spells.forEach(sp => {
        if (known.includes(sp.name.toLowerCase())) out.push({ ...sp, from:'spell', scope:'self' });
      });
      out.forEach(r => { r._lvl = lvl; });
    } else {
      // A monster's reactions are printed in its stat block, so they are read
      // rather than derived — Parry, Snapping Bite, whatever the entry says.
      const raw = (this._entryOf(c) || {})._raw;
      this._rawList(raw, ['reactions', 'reaction']).forEach(r => {
        out.push({ name: r.name.replace(/\s*\(.*\)$/, ''), note: r.text, from:'stat block',
                   scope: this._scopeOf(r.text), range: this._rangeOf(r.text) });
      });
    }
    // Everyone has these, monsters included.
    (T.universal || []).forEach(r => out.push({ ...r, from:'always', scope:'self' }));

    const seen = new Set();
    return out.filter(r => !seen.has(r.name) && seen.add(r.name))
              .map(r => ({ ...r, key: r.name,
                           ...(this.MECH[r.name] || this._statBlockMech(r) || {}) }));
  },

  // The loaded bestiary is the open5e-shaped normalisation, where a trait is
  // {name, desc} under `special_abilities` and a reaction is {name, desc} under
  // `reactions`. The 5etools shape — `trait`/`reaction` with `entries` — is
  // accepted too, so this doesn't break if the loader's normalisation changes.
  // Reading only one of the two was why the Ogre's stat block came out empty.
  _rawList(raw, names){
    if (!raw) return [];
    for (const n of names){
      const list = raw[n];
      if (Array.isArray(list) && list.length){
        return list.map(x => ({ name: String(x.name || ''),
                                text: x.desc != null ? String(x.desc) : this._flatten(x.entries) }));
      }
    }
    return [];
  },

  // A stat-block field as a readable line. The loader hands back strings for
  // some fields, arrays for the damage lists and an object for senses; an
  // empty array is the common case and must render as nothing, not as a label
  // with nothing after it.
  _plain(v){
    if (v == null) return '';
    if (Array.isArray(v)) return v.map(x => this._plain(x)).filter(Boolean).join(', ');
    if (typeof v === 'object'){
      return Object.keys(v).map(k => {
        const label = k.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
        return label + ' ' + v[k];
      }).join(' · ');
    }
    return String(v).trim();
  },

  // 5etools markup → plain text, and the same trigger-scope reading the
  // extractor does, for the stat-block reactions it never sees.
  _flatten(entries){
    const parts = [];
    (function walk(n){
      if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === 'object'){ if (n.name) parts.push(n.name); Object.keys(n).forEach(k => { if (k !== 'name') walk(n[k]); }); }
      else if (typeof n === 'string') parts.push(n);
    })(entries);
    return parts.join(' ')
      .replace(/\{@(?:\w+)\s+([^}|]+)(?:\|[^}]*)?\}/g, '$1')
      .replace(/\s+/g, ' ').trim();
  },
  _rangeOf(txt){ const m = String(txt).match(/within (\d+) feet/i); return m ? parseInt(m[1], 10) : null; },
  _scopeOf(txt){
    const t = String(txt);
    const self = /hits you|against you|you are attacked|when you take damage|you suffer|reduced to 0 hit points/i.test(t);
    const allyIsAttacker = /another creature[^.]{0,30}(hits|attacks|makes an attack against) you/i.test(t);
    const ally = /another creature|you or a creature|an ally\b|other than you/i.test(t) && !allyIsAttacker;
    if (self && ally) return 'both';
    if (ally) return 'ally';
    if (self) return 'self';
    if (/makes an attack roll/i.test(t)) return 'both';
    return 'self';
  },

  // ─── Resource pools ───────────────────────────────────────────────────────
  _pool(c, name){
    const p = this._partyOf(c);
    return p && Array.isArray(p.resources) ? p.resources.find(r => r.name === name) || null : null;
  },
  // Lowest slot at or above `min` that still has a charge. One store only:
  // sheet.spellSlots. The "Spell Slots L1" resource pools this used to also
  // read are migrated into it on load — see migratePartySpellSlots.
  _slot(c, min){
    const p = this._partyOf(c);
    const slots = p && p.sheet && p.sheet.spellSlots;
    if (!slots) return null;
    for (let l = min; l <= 9; l++){
      const s = slots[l];
      if (s && (s.total || 0) - (s.expended || 0) > 0) return { slot:s, lvl:l };
    }
    return null;
  },
  // null when payable. A cost this app doesn't track is NOT a blocker —
  // returning a problem for it would refuse a reaction the character really
  // has just because nobody has typed the pool in.
  _costProblem(c, r){
    const k = this.COST[r.name]; if (!k) return null;
    const p = this._partyOf(c);
    if (k.needs === 'raging' && p && !p.rage) return 'not raging';
    if (k.res){ const pool = this._pool(c, k.res); if (pool && pool.current < (k.n || 1)) return 'no ' + k.res.toLowerCase(); }
    if (k.slot && p && (this._hasAnySlotTracking(p)) && !this._slot(c, k.slot)) return 'no spell slot';
    return null;
  },
  _hasAnySlotTracking(p){
    return !!(p.sheet && p.sheet.spellSlots && Object.keys(p.sheet.spellSlots).length);
  },
  _costLabel(c, r){
    const k = this.COST[r.name]; if (!k) return '';
    if (k.res){ const pool = this._pool(c, k.res); return pool ? `${k.res} ${pool.current}/${pool.max}` : k.res + ' (untracked)'; }
    if (k.slot){ const s = this._slot(c, k.slot); return s ? 'slot L' + s.lvl : (this._partyOf(c) && this._hasAnySlotTracking(this._partyOf(c)) ? 'no slot' : 'slot (untracked)'); }
    if (k.needs) return k.needs;
    return '';
  },
  // Spends for real: this writes to state.party, which is the party tracker's
  // own array, then repaints that panel and saves.
  _payCost(c, r){
    const k = this.COST[r.name]; if (!k) return '';
    let spent = '';
    if (k.res){
      const pool = this._pool(c, k.res);
      if (pool){ pool.current = Math.max(0, pool.current - (k.n || 1)); spent = `${k.res} ${pool.current}/${pool.max}`; }
    }
    if (k.slot){
      const s = this._slot(c, k.slot);
      if (s){
        s.slot.expended = (s.slot.expended || 0) + 1;
        spent = `slot L${s.lvl} ${(s.slot.total || 0) - s.slot.expended}/${s.slot.total || 0}`;
      }
    }
    if (spent){ panelDefs.party?._render?.(); }
    return spent;
  },

  // ─── The map ──────────────────────────────────────────────────────────────
  // Battlemap's own tokens, matched the same way every other cross-panel link
  // in this app matches them: by name. Positions are stage pixels; one square
  // is _csScreen() of them.
  _bm(){ return panelDefs.battlemap || null; },
  // The battle map only reads its own saved state when it mounts, so a DM who
  // has never opened it this session would see an empty map here and — worse —
  // silently lose every reach test, since a creature with no token is treated
  // as distance-unknown. So: live panel when there is one, its saved state when
  // there isn't. The fallback is READ-ONLY on purpose. Writing tokens back into
  // skt-battlemap-v1 from here would mean reproducing battlemap's serializer,
  // and a partial write would destroy the fog and drawings stored beside them.
  _mapSrc(){
    const B = this._bm();
    if (B && Array.isArray(B._tokens) && B._tokens.length){
      let cs = B._cellSize || 50;
      try { if (B._csScreen) cs = B._csScreen() || cs; } catch(e){}
      return { live:true, tokens:B._tokens, cs, cols:B._cols || 24, rows:B._rows || 18,
               gridType:B._gridType || 'square', bgPath:B._bgMapPath || null,
               bgScale:B._bgMapScale || 1,
               rotation:((B._mapRotation || 0) % 360 + 360) % 360,
               snap:!!B._snapToGrid,
               drawings:Array.isArray(B._drawings) ? B._drawings : [] };
    }
    try {
      const d = JSON.parse(localStorage.getItem('skt-battlemap-v1') || 'null');
      if (d && Array.isArray(d.tokens)){
        return { live:false, tokens:d.tokens, cols:d.cols || 24, rows:d.rows || 18,
                 cs: (d.cellSize || 50) * (d.bgMapPath ? (d.bgMapScale || 1) : 1),
                 gridType:d.gridType || (d.showGrid === false ? 'none' : 'square'),
                 bgPath:d.bgMapPath || null, bgScale:d.bgMapScale || 1,
                 rotation:((d.mapRotation || 0) % 360 + 360) % 360,
                 snap:!!d.snapToGrid,
                 drawings:Array.isArray(d.drawings) ? d.drawings : [] };
      }
    } catch(e){}
    return { live:false, tokens:[], cs:50, cols:24, rows:18, gridType:'square',
             bgPath:null, bgScale:1, rotation:0, snap:false, drawings:[] };
  },
  _map(){ return this._mapCache || (this._mapCache = this._mapSrc()); },

  // The map art. Normally the battle map has already loaded it into
  // _mapBgImage; when that panel has never been opened it hasn't, and the
  // thumbnail would fall back to a bare grid on a session that plainly has a
  // map. One load per path, cached, and a re-place when it arrives.
  _bgImage(){
    const src = this._map();
    if (typeof _mapBgImage !== 'undefined' && _mapBgImage && src.live) return _mapBgImage;
    if (!src.bgPath) return null;
    if (this._bgCache && this._bgCache.path === src.bgPath) return this._bgCache.img;
    const img = new Image();
    this._bgCache = { path: src.bgPath, img: null };
    img.onload = () => {
      if (this._bgCache && this._bgCache.path === src.bgPath){
        this._bgCache.img = img;
        this._placeTokens();
      }
    };
    img.src = assetUrl(src.bgPath);
    return null;
  },

  // Which slice of the battle map to show. Not the whole thing: a 24×18 map
  // with the fight happening in one corner renders as five dots in the top
  // left of a mostly-empty grid, which tells the DM nothing they can use. So
  // the thumbnail frames the creatures, padded, with a floor so two adjacent
  // tokens don't fill the box.
  //
  // The aspect ratio is forced to match the box because otherwise the cells
  // come out rectangular, and a grid whose squares aren't square is actively
  // misleading about distance — the one thing this map exists to show.
  _viewport(){
    if (this._drag && this._vp) return this._vp;      // don't pan under a drag
    const m = this._map(), cs = m.cs || 50;
    const RATIO = 1.45, PAD = 2, MINW = 10, MINH = 7;
    // Frame the FIGHT, not the map. Framing every token meant one creature
    // parked twenty squares away — a scout, or someone left behind by the
    // last scene — stretched the box to 37x25 on a real campaign and shrank
    // every cell to 7px. So: anchor on whoever is acting and take only what
    // is within reach of the action. A token further out is still on the map,
    // it just doesn't get to decide the zoom.
    //
    // NEAR is generous on purpose — 14 squares is 70 ft, past any melee reach
    // and most spell ranges, so the whole engagement stays in frame and only
    // genuine stragglers drop out.
    const NEAR = 14;
    const cur = this._tokenFor(this._active());
    const inFrame = cur
      ? m.tokens.filter(t => Math.max(Math.abs(t.x - cur.x), Math.abs(t.y - cur.y)) / cs <= NEAR)
      : m.tokens;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    (inFrame.length ? inFrame : m.tokens).forEach(t => {
      const x = Math.round(t.x / cs), y = Math.round(t.y / cs);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    });
    if (!isFinite(x0)) return (this._vp = { x:0, y:0, w:Math.min(MINW, m.cols), h:Math.min(MINH, m.rows) });
    x0 -= PAD; y0 -= PAD; x1 += PAD + 1; y1 += PAD + 1;   // +1: a token fills its own square
    let w = Math.max(MINW, x1 - x0), h = Math.max(MINH, y1 - y0);
    if (w / h < RATIO) w = Math.ceil(h * RATIO); else h = Math.ceil(w / RATIO);
    // Manual zoom on top of the automatic framing. The auto frame is a good
    // default and a bad cage: sometimes you want the next room, sometimes one
    // corner of a melee. Fewer cells in the box = more zoomed in, so the
    // multiplier divides. MINCELL keeps a zoom-in from collapsing to a single
    // square you can no longer aim in.
    const z = this._mapZoom || 1;
    const MINCELL = 4;
    w = Math.max(MINCELL, Math.round(w / z));
    h = Math.max(MINCELL, Math.round(h / z));
    w = Math.min(w, m.cols); h = Math.min(h, m.rows);
    // Zoomed IN, frame the actor rather than the group — the group no longer
    // fits, and the creature whose turn it is outranks the bounding box.
    if (z > 1 && cur){ x0 = x1 = cur.x / cs; y0 = y1 = cur.y / cs; }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const x = Math.max(0, Math.min(Math.round(cx - w / 2), m.cols - w));
    const y = Math.max(0, Math.min(Math.round(cy - h / 2), m.rows - h));
    return (this._vp = { x, y, w, h });
  },
  // Name matching, forgiving in the ways real data is inconsistent: exact
  // first, then trimmed and case-folded, then the group base name a numbered
  // duplicate carries ("Ogre 1 2" → "Ogre"). Strict equality matched two of
  // eight creatures in a real fight.
  // Both live in js/core/utils.js now. The auto-token reconciler has to make
  // exactly the same call about whether a token already exists, and a second
  // copy of this rule drifting from the first is how the map ended up drawing
  // two of eight creatures in the first place.
  _norm(s){ return sktNormName(s); },
  _tokenFor(c){ return sktTokenForCombatant(this._map().tokens, c); },
  // The reverse lookup, for drawing the map rather than the order.
  _combatantForToken(t){
    if (!t) return null;
    const order = this._order();
    const exact = order.find(c => c.name === t.label);
    if (exact) return exact;
    const n = this._norm(t.label);
    return order.find(c => this._norm(c.name) === n)
        || order.find(c => c.baseName && this._norm(c.baseName) === n)
        || (t.baseName ? order.find(c => this._norm(c.name) === this._norm(t.baseName)) : null)
        || null;
  },
  _cs(){ return this._map().cs || 50; },
  // 5e counts a diagonal as 5 ft like any other square, so the metric is
  // Chebyshev. Euclidean would put a creature three squares away diagonally at
  // 21 ft instead of 15 and quietly change who can react.
  _feetBetween(a, b){
    const ta = this._tokenFor(a), tb = this._tokenFor(b);
    if (!ta || !tb) return null;                 // not on the map: unknown, not zero
    const cs = this._cs() || 50;
    const dx = Math.abs(ta.x - tb.x) / cs, dy = Math.abs(ta.y - tb.y) / cs;
    return Math.round(Math.max(dx, dy)) * 5;
  },
  _reachOf(c){
    if (c.isPC) return 5;
    const entry = this._entryOf(c);
    const raw = entry && entry._raw;
    // Read off the creature's own melee actions rather than assumed, so a
    // giant with a 10 ft reach provokes from 10 ft. Straight out of the action
    // text, which is where the number actually lives.
    let reach = 5;
    if (raw){
      const text = JSON.stringify(raw.actions || raw.action || '');
      const re = /reach (\d+) ?ft/gi;
      let m;
      while ((m = re.exec(text))) reach = Math.max(reach, parseInt(m[1], 10));
    }
    return reach;
  },
  _sideOf(c){ return c.isPC ? 'party' : 'foe'; },

  // ─── Who can react to this ────────────────────────────────────────────────
  _gatherReactions(o){
    const rows = [];
    this._order().forEach(c => {
      if (c.reactionUsed || (c.hp || 0) <= 0) return;
      if (o.attackerId && c.id === o.attackerId) return;    // not the one swinging
      const isTarget = c.id === o.target.id;
      this._reactionsFor(c).forEach(r => {
        // Only things with mechanics or an explicit hit trigger. Opportunity
        // Attack shouldn't appear every time someone is punched.
        if (!r.when &&
            !/hits you|hit by an attack|takes damage|makes an attack roll|suffers a critical/i.test(r.note || '')) return;
        const ok = isTarget ? (r.scope === 'self' || r.scope === 'both')
                            : (r.scope === 'ally' || r.scope === 'both');
        if (!ok) return;
        if (r.when === 'damage' && !o.hit) return;          // nothing to reduce
        // A saving throw is not an attack roll, so nothing that modifies one
        // can answer it. Absorb Elements still can, because it triggers on
        // taking the damage.
        if (o.save && r.when === 'tohit') return;
        if (r.onlyTypes && !r.onlyTypes.includes(String(o.type || '').toLowerCase())) return;
        let ft = 0;
        if (!isTarget){
          ft = this._feetBetween(c, o.target);
          // Not on the map is not "out of range" — the DM may not be using it.
          if (ft != null && r.range != null && ft > r.range) return;
        }
        rows.push({ who:c, r, ft, problem: this._costProblem(c, r) });
      });
    });
    return rows;
  },

  // ─── Render ───────────────────────────────────────────────────────────────
  _render(){
    const b = this._body; if (!b) return;
    this._sig = this._combatSig();
    // Re-read the map once per render rather than once per distance test:
    // _gatherReactions asks for the distance between every pair of creatures.
    this._mapCache = null; this._map();
    const order = this._order();

    if (!order.length){
      b.innerHTML = `<div class="tv-root tv-root-empty">` + emptyState({
        icon:'i-combat',
        title:'No one is in the fight yet',
        hint:'Add combatants in the <strong>Combat Tracker</strong> — this panel runs whatever is in there, it doesn\'t keep its own list.',
      }) + `</div>`;
      return;
    }
    const c = this._active();
    this._rollRecharges(c);

    b.innerHTML = `<div class="tv-root">
      <div class="tv-initbar">
        <div class="tv-init">${this._renderInit()}</div>
        <div class="tv-init-tools">${this._renderInitTools()}</div>
      </div>
      ${this._editInit ? this._renderAddRow() : ''}
      <div class="tv-main">
        <div class="tv-actor">
          ${this._renderActorHead(c)}
          ${this._renderActions(c)}
          ${this._renderLegendary()}
          <div class="tv-result${this._resultLive ? ' on' : ''}" role="status" aria-live="polite">${this._result
            || '<span class="dim">Pick a target, then roll an attack.</span>'}${
            this._undo ? `<button class="btn tv-undo" data-tv="undo"
              title="Undo ${esc(this._undo.label)} — HP, death saves, pools and spent reactions">${ICO('i-undo')}Undo</button>` : ''}</div>
          <div class="tv-tail">
            <div class="tv-traits">${this._renderTraits(c)}</div>
            <div class="tv-log">${this._renderLog()}</div>
          </div>
        </div>
        <div class="tv-side">
          ${this._renderMap()}
          <div class="tv-targets">${this._renderTargets(c)}</div>
          <div class="tv-adjust">${this._renderAdjust()}</div>
        </div>
      </div>
      ${this._renderPending()}
      <div class="tv-foot">
        <div class="tv-turnline">${this._renderTurnline(c)}</div>
        <button class="btn primary tv-end" data-tv="end">End turn</button>
      </div>
    </div>`;
    this._wire();
    this._placeTokens();
    // When the tail has to scroll, the live end wins the visible space. A
    // dragon's five actions leave it 40px tall, and left at the top that
    // showed a "Traits" heading with its content and the whole log below the
    // fold. Measured against the tail rather than via offsetTop, which is
    // relative to the nearest positioned ancestor and not this box.
    const tail = b.querySelector('.tv-tail'), lg = b.querySelector('.tv-log');
    if (tail && lg) tail.scrollTop = lg.offsetTop - tail.offsetTop;
  },

  _renderInit(){
    const order = this._order();
    const activeId = state.activeCombatantId;
    if (this._editInit){
      return order.map(c => `
        <span class="tv-pip edit ${c.id === activeId ? 'cur' : ''}">
          <input class="tv-init-in" type="number" data-tvinit="${esc(c.id)}" value="${c.initiative ?? 0}"
                 aria-label="${esc(c.name)} initiative">
          <span><span class="tv-pip-name">${esc(c.name)}</span><br>
          <span class="tv-pip-hp">${(c.initBonus || 0) >= 0 ? '+' : ''}${c.initBonus || 0} init</span></span>
          <button class="tv-pip-x" data-tv="rm" data-id="${esc(c.id)}"
                  title="Remove ${esc(c.name)} from the fight" aria-label="Remove ${esc(c.name)}">&times;</button>
        </span>`).join('');
    }
    let seenActive = false;
    return order.map(c => {
      const cur = c.id === activeId;
      if (cur) seenActive = true;
      const dead = (c.hp || 0) <= 0;
      return `<button class="tv-pip ${cur ? 'cur' : ''} ${!cur && !seenActive ? 'done' : ''} ${dead ? 'dead' : ''}"
                      data-tv="jump" data-id="${esc(c.id)}" aria-current="${cur}">
        <span class="tv-pip-init">${c.initiative ?? '–'}</span>
        <span><span class="tv-pip-name">${esc(c.name)}</span><br>
        <span class="tv-pip-hp">${c.hp}/${c.hpMax}</span></span>
      </button>`;
    }).join('');
  },
  _renderInitTools(){
    return this._editInit
      ? `<button class="btn" data-tv="rollinit" title="Roll initiative for the monsters — players call their own out loud">Roll NPCs</button>
         <button class="btn primary" data-tv="initdone">Done</button>`
      : `<span class="tv-round">Round ${state.combatRound || 1}</span>
         <button class="btn" data-tv="initedit" title="Set initiative, add or remove combatants">Initiative</button>`;
  },
  _renderAddRow(){
    return `<div class="tv-init-add">
      <span class="tv-manual-l">Add</span>
      <input class="tv-in wide" data-tvadd="name" placeholder="name" aria-label="Name">
      <input class="tv-in" data-tvadd="init" type="number" placeholder="init" aria-label="Initiative">
      <input class="tv-in" data-tvadd="hp" type="number" placeholder="hp" aria-label="Hit points">
      <input class="tv-in" data-tvadd="ac" type="number" placeholder="ac" aria-label="Armour class">
      <button class="btn primary" data-tv="add">Add</button>
      <span class="tv-note">Blank initiative rolls a d20. For a creature with a stat block, add it
        from the Bestiary or the Combat Tracker so its attacks come with it.</span>
    </div>`;
  },

  // ─── Wild Shape ───────────────────────────────────────────────────────────
  // A wild-shaped druid IS the beast for the length of the form: damage lands
  // on the beast's pool (combat.js routes it there), the AC is the beast's,
  // and the actions are the beast's. The panel was showing the druid's HP, the
  // druid's AC and the druid's weapon list the whole time — every number on
  // the card was the wrong one.
  _wsOf(c){
    const p = this._partyOf(c);
    const ws = p && p.wildshape;
    return (ws && ws.name) ? ws : null;
  },
  // The beast's stat block, for actions/speed/senses. Only name/slug/hp/ac are
  // snapshotted onto the character — the rest is looked up, exactly as the
  // Party panel's overlay does, and absent until the dataset has loaded.
  _wsRaw(ws){
    if (!ws || !ws.slug) return null;
    if (typeof _5eData === 'undefined' || !Array.isArray(_5eData)) return null;
    const e = _5eData.find(d => d.cat === 'monster' && d._slug === ws.slug);
    return (e && e._raw) || null;
  },

  _renderActorHead(c){
    const p = this._partyOf(c);
    const entry = this._entryOf(c);
    const ws = this._wsOf(c);
    const sub = ws ? `Wild Shape · ${ws.name}${ws.cr != null ? ' · CR ' + ws.cr : ''}`
              : p ? [p.cls, p.subclass, p.level ? 'level ' + p.level : ''].filter(Boolean).join(' · ')
                  : (entry && entry.meta) || (c.isPC ? 'Player character' : 'No stat block');
    const conds = (c.conditions || []).map(x => `<span class="tv-cond">${esc(x)}</span>`).join('');
    const res = p && Array.isArray(p.resources) ? p.resources.map(r => {
      const max = Math.max(0, Math.min(20, r.max || 0));
      let pips = '';
      for (let i = 0; i < max; i++) pips += `<span class="tv-pip-o ${i < r.current ? '' : 'off'}"></span>`;
      return `<span class="tv-res-i">${esc(r.name)}<span class="tv-pips">${pips}</span></span>`;
    }).join('') : '';
    const rx = this._reactionsFor(c);
    const rxHtml = !rx.length ? '' :
      `<span class="tv-rx-l">Reactions</span>` + rx.map(r =>
        `<span class="tv-rx ${c.reactionUsed ? 'spent' : ''} ${r.when ? 'hit' : ''}"
               title="${esc(r.note || '')}">${esc(r.name)}<span class="tv-rx-src">${esc(r.from)}${r.lvl ? ' L' + r.lvl : ''}${
          r.scope === 'ally' ? ' · ally' : r.scope === 'both' ? ' · either' : ''}</span></span>`).join('');
    return `<div class="tv-actor-head">
        <div class="tv-avatar">${esc(String(c.name || '?').trim().charAt(0).toUpperCase())}</div>
        <div class="tv-actor-id">
          <div class="tv-actor-name">${esc(c.name)}</div>
          <div class="tv-actor-sub">${esc(sub)}</div>
        </div>
        <div class="tv-vitals">
          <div class="tv-vital"><div class="l">${ws ? 'BEAST HP' : 'HP'}</div><div class="v">${
            ws ? `${ws.hp}<span class="tv-temp" title="${esc(p.name)}'s own hit points — the form drops back to these when the beast reaches 0">${p.hp} ${esc(String(p.cls || 'druid'))}</span>`
               : `${c.hp}${(p && p.tempHp > 0) ? `<span class="tv-temp" title="Temporary HP — absorbs damage first">+${p.tempHp}</span>` : ''}`
          }</div></div>
          <div class="tv-vital"><div class="l">AC</div><div class="v">${(ws && ws.ac != null ? ws.ac : c.ac) ?? '–'}</div></div>
        </div>
      </div>
      ${conds ? `<div class="tv-conds">${conds}</div>` : ''}
      ${rxHtml ? `<div class="tv-rxlist">${rxHtml}</div>` : ''}
      ${res ? `<div class="tv-res">${res}</div>` : ''}`;
  },

  // A creature's attacks: the parsed stat block for a monster, the imported
  // sheet's weapon rows for a PC. Neither is invented here — both come from
  // the same places the rest of the app reads them.
  _attacksFor(c){
    if (c.isPC){
      // In a beast's body you make the beast's attacks, not the druid's. The
      // stat block goes through the same Attack Runner parse a monster's does,
      // so a Bite is rollable here exactly like an ogre's Greatclub.
      const ws = this._wsOf(c);
      if (ws){
        const raw = this._wsRaw(ws);
        const parsed = (raw && panelDefs.attacks) ? (panelDefs.attacks._parsed(raw).attacks || []) : [];
        // Fall back to the druid's own list rather than an empty panel when
        // the beast has no slug or the dataset hasn't loaded yet.
        if (parsed.length) return parsed;
      }
      const p = this._partyOf(c);
      const rows = (p && p.sheet && Array.isArray(p.sheet.attacks)) ? p.sheet.attacks : [];
      return rows.filter(a => a && a.name).map(a => ({
        name: a.name, pc: true,
        bonus: parseInt(String(a.atkBonus || '').replace(/[^\d+-]/g, ''), 10) || 0,
        dmgText: a.damage || '',
      }));
    }
    const entry = this._entryOf(c);
    const raw = entry && entry._raw;
    if (!raw || !panelDefs.attacks) return [];
    return panelDefs.attacks._parsed(raw).attacks || [];
  },

  // The Multiattack sentence, and the plan it resolves to. Reuses the Attack
  // Runner's parse rather than a second one — about four in ten stat blocks
  // say "makes two melee attacks" and name nothing resolvable, and the two
  // panels have to agree about which those are.
  _multiOf(c){
    // A wild-shaped druid runs the beast's Multiattack if it has one — the
    // usual PC short-circuit would have hidden it.
    const ws = c.isPC ? this._wsOf(c) : null;
    if (c.isPC && !ws) return null;
    const raw = ws ? this._wsRaw(ws) : (this._entryOf(c) || {})._raw;
    if (!raw || !panelDefs.attacks) return null;
    const p = panelDefs.attacks._parsed(raw);
    if (!p.multi) return null;
    return { text: p.multi.text, plan: panelDefs.attacks._plan({ multi: p.multi, attacks: p.attacks }) };
  },

  // The damage types THIS creature can actually deal, read off the same parse
  // the attack rows are drawn from, in the order the stat block lists them.
  // A dragon offers piercing and fire; a rogue offers whatever is on their
  // sheet. Everything else is still reachable below the divider — a DM
  // improvises, and a picker that refuses to say "radiant" because the ogre
  // has no radiant attack would be worse than the free-text box it replaces.
  _dmgTypesFor(c){
    const seen = [];
    const add = t => {
      const n = String(t || '').trim().toLowerCase();
      if (n && SKT_DAMAGE_TYPES.includes(n) && !seen.includes(n)) seen.push(n);
    };
    (this._attacksFor(c) || []).forEach(a => {
      (a.parts || []).forEach(p => add(p.type));
      // A PC's sheet attack carries its damage as free text ("1d8+3 slashing").
      if (a.dmgText){ const m = SKT_DMG_TYPE_RE.exec(String(a.dmgText).toLowerCase()); if (m) add(m[0]); }
    });
    return seen;
  },

  // Free text was the wrong control here: the value is compared against
  // c.resistances / c.immunities / c.vulnerabilities, so "Fire ", "slash" or a
  // typo silently skipped resistance maths and applied full damage with no
  // error anywhere. A select can only emit one of the thirteen.
  _dmgTypeSelect(c){
    const mine = this._dmgTypesFor(c);
    const rest = SKT_DAMAGE_TYPES.filter(t => !mine.includes(t));
    const opt = t => `<option value="${t}">${t}</option>`;
    return `<select class="tv-in wide" data-tvman="type" aria-label="Damage type">
      <option value="">type…</option>
      ${mine.length ? `<optgroup label="${esc(c.name)}">${mine.map(opt).join('')}</optgroup>` : ''}
      <optgroup label="${mine.length ? 'Other' : 'Damage type'}">${rest.map(opt).join('')}</optgroup>
    </select>`;
  },

  // ─── Class mechanics ──────────────────────────────────────────────────────
  // Rage and Wild Shape are turn decisions, and the Turn View could only point
  // at the Party panel for them — so running a barbarian meant leaving the
  // panel built for running a turn.
  //
  // The MARKUP is the Party panel's own _formsRow(), not a second copy: it
  // carries the level-scaled rage damage, the rounds-left counter and the
  // rules text in its tooltips, and a reimplementation here would be a second
  // thing to keep in step with the barbarian table. Clicks are delegated to
  // the same handlers, so the two surfaces cannot disagree about state.
  _renderClassRow(c){
    const p = this._partyOf(c);
    const P = panelDefs.party;
    if (!p || !P || typeof P._formsRow !== 'function') return '';
    const i = state.party.indexOf(p);
    if (i < 0) return '';
    let row = '';
    try { row = P._formsRow(p, i) || ''; } catch(e){ return ''; }
    if (!row) return '';                 // not a barbarian or a druid
    return `<div class="tv-classrow">${row}</div>`;
  },

  // The Party panel binds its own click handler to its own body, so nothing
  // it renders is live inside this panel. Route the two actions to the same
  // methods rather than duplicating what they do.
  _classAction(act, i){
    const P = panelDefs.party; if (!P) return false;
    if (act === 'rage-on')  { P._setRage(i, true);  this._render(); return true; }
    if (act === 'rage-off') { P._setRage(i, false); this._render(); return true; }
    if (act === 'ws-start' || act === 'ws-edit'){ P._editWildShape(i); return true; }
    if (act === 'ws-end')   { P._endWildShape(i); this._render(); return true; }
    return false;
  },

  _renderActions(c){
    // Exactly one legal action when a PC is dying, so offer exactly that.
    if (this._isDowned(c)) return this._renderDeathSaves(c);
    const list = this._attacksFor(c);
    const manual = `<div class="tv-manual ${list.length ? '' : 'lead'}">
      <span class="tv-manual-l">${list.length ? 'Rolled it yourself?' : esc(c.name) + ' rolls — enter the result:'}</span>
      <input class="tv-in" data-tvman="tohit" type="number" placeholder="hit?"
             title="Optional — leave it blank and the damage just lands. Fill it in to have the panel check it against the target's AC."
             aria-label="Attack roll total (optional)">
      <input class="tv-in" data-tvman="dmg" type="number" placeholder="dmg" aria-label="Damage">
      ${this._dmgTypeSelect(c)}
      <button class="btn ${list.length ? '' : 'primary'}" data-tv="manual">Apply</button>
    </div>`;
    if (!list.length){
      return `<div class="tv-actions-wrap"><div class="tv-actions">${this._renderClassRow(c)}${manual}
        <div class="tv-act-line" style="padding:0 2px">Or use the −/+ under the target list for damage
        and healing that isn't an attack.</div></div></div>`;
    }
    const rows = list.map((a, i) => {
      const line = a.pc
        ? `${a.bonus >= 0 ? '+' : ''}${a.bonus} to hit · ${esc(a.dmgText || '—')}`
        : `${esc(a.toHit || '')}${a.toHit ? ' to hit · ' : ''}${(a.parts || []).map(pt => `${pt.avg} (${esc(pt.dice)}) ${esc(pt.type)}`).join(' + ')}`;
      const spent = (c.rechargeSpent || []).includes(a.name);
      const rech = a.recharge
        ? `<span class="tv-save rech" title="Recharges on a d6 roll of ${esc(String(a.recharge))} at the start of its turn">↺ ${esc(String(a.recharge))}</span>`
        : '';
      let ctl;
      if (spent){
        ctl = `${rech}<span class="tv-act-note">spent — recharges on its turn</span>`;
      } else if (a.save){
        // A breath weapon has no attack roll, so there is nothing to roll to
        // hit — the decision is whether the target made its save. Two buttons
        // instead of one, and no d20.
        ctl = `${rech}<span class="tv-save">DC ${a.save.dc} ${esc(String(a.save.ability).slice(0,3).toUpperCase())}</span>
          <button class="btn" data-tv="save" data-ai="${i}" data-half="0" title="Target failed the save — full damage">Failed</button>
          ${a.save.half ? `<button class="btn" data-tv="save" data-ai="${i}" data-half="1" title="Target saved — half damage">Saved ½</button>` : ''}`;
      } else if (a.pc ? !!a.dmgText : (a.parts || []).length){
        ctl = `${rech}<button class="btn" data-tv="roll" data-ai="${i}" aria-label="Roll ${esc(a.name)}">${ICO('i-dice')}Roll</button>`;
      } else {
        ctl = `<span class="tv-act-note">no damage parsed</span>`;
      }
      return `<div class="tv-act">
        <div class="tv-act-body">
          <div class="tv-act-name">${esc(a.name)}</div>
          <div class="tv-act-line">${line}</div>
        </div>
        <div class="tv-act-ctl">${ctl}</div>
      </div>`;
    }).join('');

    // Multiattack is the instruction for the whole turn, so it sits above the
    // individual attacks. Shown VERBATIM: "Run 3" only appears when the
    // wording resolved to real attacks, because a button that silently did
    // less than the sentence says is worse than no button.
    const m = this._multiOf(c);
    const q = this._queue;
    let head = '';
    if (q){
      const it = q.items[q.i];
      head = `<div class="tv-multi run">
        <span class="tv-multi-tag">Multiattack ${q.i + 1}/${q.items.length}</span>
        <span class="tv-multi-text"><b>${esc(it ? it.name : '')}</b> — pick a target on the right</span>
        <span class="tv-multi-pips">${q.items.map((x, k) =>
          `<span class="tv-multi-pip${k < q.i ? ' done' : k === q.i ? ' now' : ''}">${esc(x.name)}</span>`).join('')}</span>
        <button class="btn" data-tv="qmiss" title="This one missed — skip to the next">Miss</button>
        <button class="btn" data-tv="qstop">Stop</button>
      </div>`;
    } else if (m){
      head = `<div class="tv-multi">
        <span class="tv-multi-tag">Multiattack</span>
        <span class="tv-multi-text">${esc(m.text)}</span>
        ${m.plan.length ? `<button class="btn" data-tv="multi"
            title="${esc(m.plan.map(p => p.name).join(' → '))} — roll each in turn, choosing a target for every one"
            >${ICO('i-dice')}Run ${m.plan.length}</button>` : ''}
      </div>`;
    }
    const advBtn = (v, label, title) =>
      `<button class="btn ${this._adv === v ? 'primary' : ''}" data-tv="adv" data-v="${v}" title="${title}">${label}</button>`;
    const advBar = `<div class="tv-advbar">
      <span class="tv-manual-l">Roll</span>
      ${advBtn(-1, 'Disadv', 'Roll two d20 and keep the lower')}
      ${advBtn(0, 'Straight', 'One d20')}
      ${advBtn(1, 'Adv', 'Roll two d20 and keep the higher')}
      <span class="tv-note">Sticky for the turn — Reckless Attack lasts all of it.
        Shift-click a Roll for advantage, Alt-click for disadvantage.</span>
    </div>`;
    // The manual row sits OUTSIDE the scroller. .tv-actions gives way so the
    // result line stays on screen, which meant that on a creature with three
    // or more attacks the "rolled it yourself" row scrolled out of reach —
    // and that row is the fallback for every attack the parser didn't get,
    // so it is the last thing that should disappear when the list gets long.
    return `<div class="tv-actions-wrap">
      <div class="tv-actions">${this._renderEconomy(c)}${this._renderClassRow(c)}${head}${this._renderBonusActions(c)}${advBar}${rows}</div>
      ${manual}
    </div>`;
  },

  // ─── Legendary actions ────────────────────────────────────────────────────
  // These fire at the END of somebody else's turn, which is exactly the moment
  // this panel is showing and exactly why they had no home in it. So they are
  // offered for every legendary creature that ISN'T the one acting — on the
  // dragon's own turn there is nothing to spend.
  //
  // The pool is the tracker's own legendaryUsed/legendaryMax, so spending here
  // empties the same pips the Combat Tracker draws.
  _legendaryRows(){
    const cur = this._active();
    return this._order()
      .filter(c => c.legendaryMax && (c.hp || 0) > 0 && c.id !== (cur && cur.id))
      .map(c => ({
        c,
        left: (c.legendaryMax || 0) - (c.legendaryUsed || 0),
        acts: this._rawList((this._entryOf(c) || {})._raw, ['legendary_actions', 'legendary']),
      }));
  },
  // "Wing Attack (Costs 2 Actions)" — the price is written into the name.
  _legendaryCost(name){
    const m = /costs?\s+(\d+)\s+actions?/i.exec(String(name));
    return m ? parseInt(m[1], 10) : 1;
  },
  _renderLegendary(){
    const rows = this._legendaryRows().filter(r => r.acts.length);
    if (!rows.length) return '';
    return rows.map(r => {
      const pips = Array.from({ length: r.c.legendaryMax }, (_, i) =>
        `<span class="tv-pip-o ${i < r.left ? '' : 'off'}"></span>`).join('');
      const btns = r.acts.map((a, ai) => {
        const cost = this._legendaryCost(a.name);
        const over = cost > r.left;
        return `<button class="btn ${over ? 'tv-cant' : ''}" data-tv="legend" data-id="${esc(r.c.id)}"
                        data-ai="${ai}" ${over ? 'disabled' : ''} title="${esc(a.text)}">
          ${esc(a.name.replace(/\s*\(costs?[^)]*\)/i, ''))}${cost > 1 ? ` <span class="tv-react-cost">· ${cost}</span>` : ''}
        </button>`;
      }).join('');
      return `<div class="tv-multi legend">
        <span class="tv-multi-tag">Legendary</span>
        <span class="tv-multi-text"><b>${esc(r.c.name)}</b><span class="tv-pips">${pips}</span></span>
        ${btns}
      </div>`;
    }).join('');
  },
  _useLegendary(id, ai){
    const c = this._order().find(x => x.id === id); if (!c) return;
    const acts = this._rawList((this._entryOf(c) || {})._raw, ['legendary_actions', 'legendary']);
    const a = acts[ai]; if (!a) return;
    const cost = this._legendaryCost(a.name);
    const left = (c.legendaryMax || 0) - (c.legendaryUsed || 0);
    if (cost > left) return;
    c.legendaryUsed = (c.legendaryUsed || 0) + cost;
    const bare = a.name.replace(/\s*\(costs?[^)]*\)/i, '').trim();
    // "Tail Attack" is an instruction to make the Tail attack, so roll it if
    // the stat block has one by that name. Everything else is spent, logged
    // and adjudicated — the same line the reaction bar holds.
    const list = this._attacksFor(c);
    const idx = list.findIndex(x => x.name && new RegExp('\\b' + x.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(bare));
    const t = this._order().find(x => x.id === this._armed);
    this._log.unshift(`<strong>${esc(c.name)}</strong> legendary — ${esc(bare)} <span style="opacity:.7">· ${c.legendaryMax - c.legendaryUsed}/${c.legendaryMax} left</span>`);
    if (idx >= 0 && t && !list[idx].save){
      this._rollAttack(idx, { attacker: c, target: t, label: list[idx].name + ' (legendary)' });
      return;
    }
    this._setResult(`<strong>${esc(c.name)}</strong> — ${esc(bare)}. <span class="dim">${esc(a.text)}</span>`, true);
    save(); panelDefs.combat?._render?.(); this._render();
  },

  // The rest of the stat block — the part a two-action monster otherwise
  // leaves as a hole under its actions.
  _renderTraits(c){
    const p = this._partyOf(c);
    const bits = [], traits = [];
    const ws = this._wsOf(c);
    if (p && ws){
      // The beast's own passives — the druid's speed and senses are not the
      // ones in play, and a wolf's 40 ft matters on the very turn this shows.
      const raw = this._wsRaw(ws);
      // speed.walk is sometimes a number (30) and sometimes an already-worded
      // string ("50 ft."), so only add the unit when it isn't there — the
      // obvious concatenation produced "Speed 50 ft. ft".
      const w = raw && (typeof raw.speed === 'string' ? raw.speed : (raw.speed && raw.speed.walk));
      const sp = w == null || w === '' ? ''
               : (typeof w === 'number' ? w + ' ft' : String(w));
      if (sp) bits.push('Speed ' + this._plain(sp));
      if (raw){ const sen = this._plain(raw.senses); if (sen) bits.push(sen); }
      if (ws.resistances && ws.resistances.length)  bits.push('Resists ' + ws.resistances.join(', '));
      if (ws.immunities && ws.immunities.length)    bits.push('Immune ' + ws.immunities.join(', '));
      bits.push(`Wild Shape — ${p.name} has ${p.hp} HP of their own`);
      if (p.concentration) bits.push('Concentrating on ' + p.concentration);
      if (raw) this._rawList(raw, ['special_abilities', 'trait']).forEach(t => traits.push(t));
      (p.buffs || []).forEach(b => traits.push({ name: b.label || 'Buff', text: b.note || '' }));
    } else if (p){
      if (p.spd) bits.push('Speed ' + p.spd + ' ft');
      if (p.pp) bits.push('Passive Perception ' + p.pp);
      if (p.rage) bits.push('Raging');
      if (p.concentration) bits.push('Concentrating on ' + p.concentration);
      (p.buffs || []).forEach(b => traits.push({ name: b.label || 'Buff', text: b.note || '' }));
    } else {
      const entry = this._entryOf(c);
      if (entry){
        const raw = entry._raw || {};
        if (entry.speed || raw.speed) bits.push('Speed ' + this._plain(entry.speed || raw.speed));
        // senses is an OBJECT here ({darkvision:'60 ft.', passive_perception:8})
        // and the damage lists are arrays, empty far more often than not.
        // String()-ing either gave "[object Object]" and a bare "Resists".
        const sen = this._plain(raw.senses); if (sen) bits.push(sen);
        const lang = this._plain(raw.languages); if (lang) bits.push(lang);
        const res = this._plain(raw.damage_resistances); if (res) bits.push('Resists ' + res);
        const imm = this._plain(raw.damage_immunities); if (imm) bits.push('Immune ' + imm);
        const cim = this._plain(raw.condition_immunities); if (cim) bits.push('Immune to ' + cim);
        this._rawList(raw, ['special_abilities', 'trait']).forEach(t => traits.push(t));
      }
    }
    (c.buffs || []).forEach(b => { if (!traits.some(t => t.name === (b.label || 'Buff'))) traits.push({ name: b.label || 'Buff', text: b.note || '' }); });
    const p1 = bits.length ? `<div class="tv-passive">${bits.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : '';
    const p2 = traits.length ? `<div class="tv-traits-l">Traits</div>` + traits.map(t =>
      `<div class="tv-trait"><b>${esc(t.name)}</b>${t.text ? ' — ' + esc(t.text) : ''}</div>`).join('') : '';
    // A PC's class features are the Party panel's Features tab, which resolves
    // them from the same class data. Pointed at rather than reimplemented —
    // two renderers for one list is two things to keep in step.
    const p3 = p ? `<div class="tv-trait" style="color:var(--text-dim)">Class and subclass features
      are in the Party panel's <b>Features</b> tab.</div>` : '';
    return p1 + p2 + p3;
  },

  _renderTargets(c){
    const rows = this._order().filter(t => t.id !== (c && c.id)).map(t => {
      const pct = t.hpMax ? Math.max(0, (t.hp / t.hpMax) * 100) : 0;
      const col = pct <= 0 ? '#5a3a3a' : pct < 35 ? 'var(--danger)' : pct < 75 ? 'var(--warning)' : 'var(--success)';
      // A creature holding an unspent reaction that could ANSWER an attack is
      // worth seeing before you commit, not only once the prompt appears.
      // Everyone has Opportunity Attack, so flagging that would mark the table.
      const r = (!t.reactionUsed && this._reactionsFor(t).some(x => x.when))
        ? '<span class="tv-pip-r" title="Has an unspent reaction that can answer an attack">R</span>' : '';
      return `<button class="tv-tgt ${this._armed === t.id ? 'armed' : ''}" data-tv="arm" data-id="${esc(t.id)}"
                      aria-pressed="${this._armed === t.id}">
        <span class="tv-tgt-row">
          <span class="tv-tgt-name">${esc(t.name)}${r}</span>
          <span class="tv-tgt-hp">${t.hp}/${t.hpMax}</span>
          <span class="tv-tgt-ac">${ICO('i-shield')}${t.ac ?? '–'}</span>
        </span>
        <span class="tv-hpbar"><i style="width:${pct}%;background:${col}"></i></span>
      </button>`;
    }).join('');
    return '<h4>Target</h4>' + (rows || '<div class="tv-act-line">No one else in the fight.</div>');
  },
  _renderAdjust(){
    const a = this._order().find(x => x.id === this._armed);
    return `<span class="tv-adjust-name">${a ? esc(a.name) : 'Pick a target'}</span>
      <button class="btn" data-tv="adj" data-sign="-1" ${a ? '' : 'disabled'} aria-label="Damage">−</button>
      <input class="tv-in" data-tvadj="amt" type="number" value="5" style="width:46px" aria-label="Amount">
      <button class="btn" data-tv="adj" data-sign="1" ${a ? '' : 'disabled'} aria-label="Heal">+</button>`;
  },

  _renderTurnline(c){
    const o = this._order();
    const i = o.findIndex(x => x.id === (c && c.id));
    const n = o[(i + 1) % o.length];
    return `<b>${esc(c ? c.name : '—')}</b>'s turn · next up <b>${esc(n ? n.name : '—')}</b>`;
  },
  _renderLog(){
    return this._log.length
      ? this._log.slice(0, 8).map(l => `<div class="tv-log-line">${l}</div>`).join('')
      : '<div class="tv-log-line" style="opacity:.55">Rolls this combat appear here.</div>';
  },

  _renderMap(){
    const onMap = this._map().tokens.length;
    // The grid is sized in _placeTokens, once the box has real pixels.
    // .tv-map-rot carries the map's rotation, so the art, the pencil strokes
    // and the tokens turn together — exactly as the battle map's own stage
    // does. The hint stays outside it, because a caption reading bottom-to-top
    // helps nobody.
    const z = this._mapZoom || 1;
    return `<div class="tv-map${this._mapBig ? ' big' : ''}">
      <div class="tv-map-rot">
        <canvas class="tv-map-draw"></canvas>
      </div>
      <div class="tv-map-grid"></div>
      <div class="tv-map-zoom">
        <button data-tv="mapzoom" data-d="-1" title="Zoom out — show more of the map" aria-label="Zoom out">−</button>
        <button data-tv="mapzoom" data-d="0" title="Back to framing the fight" aria-label="Fit to the fight"
                class="${z === 1 ? 'off' : ''}">${z === 1 ? 'fit' : Math.round(z * 100) + '%'}</button>
        <button data-tv="mapzoom" data-d="1" title="Zoom in on whoever is acting" aria-label="Zoom in">+</button>
      </div>
      <div class="tv-map-hint">${esc(this._mapHint(onMap))}</div>
    </div>`;
  },
  // Enlarging on hover is a desktop affordance. On a phone the panel is
  // already one column and the map already 200px of a 390px screen, so the
  // "enlarged" version was a 210px-wide box thrown on top of the controls —
  // it cost more than it showed. 760px is the same breakpoint .tv-main uses
  // to go single-column, so the CSS and this agree about what "small" means.
  _canExpandMap(){ return !matchMedia('(max-width: 760px)').matches; },
  _mapHint(onMap){
    if (!onMap) return 'no tokens on the battle map';
    if (!this._map().live) return 'open the Battle Map to move tokens';
    if (this._mapBig) return 'drag a token — reach updates live, and leaving it provokes';
    if (!this._canExpandMap()) return 'drag a token — leaving reach provokes';
    return 'hover to enlarge';
  },
  // Tokens are absolutely positioned from the real ones' stage coordinates, so
  // the thumbnail is a view of battlemap's data rather than a second copy.
  //
  // It iterates THE MAP'S tokens, not the initiative order. Walking the order
  // and looking up a token for each meant anything on the map without a
  // matching combatant simply wasn't drawn — on a real fight that left two
  // dots on an empty grid next to a battle map with eight creatures on it,
  // because monster tokens and their tracker entries don't always carry the
  // same name. A map that omits most of the map is worse than no map.
  _placeTokens(){
    const b = this._body; if (!b) return;
    const m = b.querySelector('.tv-map'); if (!m) return;
    // Dropping below the breakpoint with the map already enlarged — resizing
    // the window, or rotating a tablet — would otherwise strand it big.
    if (this._mapBig && !this._canExpandMap()){ this._mapBig = false; m.classList.remove('big'); }
    const rot = m.querySelector('.tv-map-rot') || m;
    rot.querySelectorAll('.tv-tok').forEach(n => n.remove());
    const src = this._map(), vp = this._viewport();
    const cs = src.cs || 50;
    // Under a 90/270 rotation the rotated layer's own width and height are
    // the box's swapped, so everything inside is laid out against those and
    // the transform does the rest. transform-origin is the layer's centre, so
    // centring the swapped box inside the outer one lands it square.
    const deg = src.rotation || 0;
    const quarter = deg === 90 || deg === 270;
    const boxW = m.clientWidth || 250, boxH = m.clientHeight || 172;
    const W = quarter ? boxH : boxW, H = quarter ? boxW : boxH;
    rot.style.width = W + 'px';
    rot.style.height = H + 'px';
    rot.style.left = ((boxW - W) / 2) + 'px';
    rot.style.top  = ((boxH - H) / 2) + 'px';
    rot.style.transform = deg ? `rotate(${deg}deg)` : '';
    // ONE cell size for both axes, letterboxed. Fitting the viewport to the box
    // independently per axis would give rectangular cells, and a grid whose
    // squares aren't square misreports the one thing this map exists to show.
    const cell = Math.min(W / vp.w, H / vp.h);
    const offX = (W - cell * vp.w) / 2, offY = (H - cell * vp.h) / 2;
    const k = cell / cs;                       // thumbnail px per stage px

    // The actual map art, positioned exactly as the battle map positions it:
    // natural size × bgMapScale, from stage origin. Without this the panel
    // drew an abstract grid beside a hex map of Ice Peak and called it the
    // same place.
    const B = this._bm();
    const img = this._bgImage();
    const hasArt = !!img;
    if (hasArt){
      const scale = src.bgScale || 1;
      const natW = (B && B._bgMapNaturalW) || img.naturalWidth;
      const natH = (B && B._bgMapNaturalH) || img.naturalHeight;
      const dispW = natW * scale * k, dispH = natH * scale * k;
      const url = src.bgPath ? assetUrl(src.bgPath) : img.src;
      rot.style.backgroundImage = `url("${url}")`;
      rot.style.backgroundRepeat = 'no-repeat';
      rot.style.backgroundSize = `${dispW}px ${dispH}px`;
      rot.style.backgroundPosition = `${offX - vp.x * cell}px ${offY - vp.y * cell}px`;
    } else {
      rot.style.backgroundImage = '';
      rot.style.backgroundSize = '';
      rot.style.backgroundPosition = '';
    }

    // Pencil annotations. Stored as {c:colour, s:width, p:[x1,y1,x2,y2,…]} in
    // stage pixels, so the same k and offsets the art uses put them in the
    // right place. They are the DM's own marks — a spell area, a line of
    // retreat — and the panel simply wasn't drawing them.
    this._drawStrokes(rot.querySelector('.tv-map-draw'), src, vp, cell, offX, offY, W, H);

    // The overlay grid is only ever right for a square grid with no art. A map
    // image carries its own grid — printed, and hex on this one — so drawing
    // squares over it produces two grids that disagree.
    const g = m.querySelector('.tv-map-grid');
    if (g){
      const square = !hasArt && src.gridType === 'square';
      g.hidden = !square;
      if (square){
        g.style.left = offX + 'px'; g.style.top = offY + 'px';
        g.style.width = (cell * vp.w) + 'px'; g.style.height = (cell * vp.h) + 'px';
        g.style.right = 'auto'; g.style.bottom = 'auto';
        g.style.backgroundSize = cell + 'px ' + cell + 'px';
      }
    }

    m.style.setProperty('--tok', Math.max(12, cell * 0.9) + 'px');
    const frag = document.createDocumentFragment();
    src.tokens.forEach(t => {
      const c = this._combatantForToken(t);
      const n = document.createElement('div');
      const label = String((c && c.name) || t.label || '?').trim();
      n.className = 'tv-tok ' + ((c ? c.isPC : t.isPC) ? 'pc ' : '')
        + (c && c.id === state.activeCombatantId ? 'cur ' : '')
        + (c && this._armed === c.id ? 'tgt ' : '')
        + (((c && (c.hp || 0) <= 0) || t.dead) ? 'dead ' : '')
        + (c ? '' : 'loose');
      if (c) n.dataset.tvtok = c.id;
      n.dataset.tvlabel = t.label || '';
      // A Large creature covers four squares and a Huge one nine, and the
      // battle map draws them that way — this panel drew every token the same
      // 12px dot, so the giant and the ogre in a Storm King fight looked like
      // the rogue. .tv-tok reads --tok for width, height AND its centring
      // margin, so one property per token is the whole change.
      //
      // Multiply the FLOORED base, not the raw cell size. There is a 12px
      // minimum so a token stays legible, and on a wide viewport the cell is
      // ~7px — so `max(12, cell*0.9*2)` floored a Large creature to the same
      // 12px as everyone else and the sizing did nothing at all. Scaling the
      // floor keeps the proportion true whatever the zoom.
      const sz = Math.max(1, t.size || 1);
      if (sz > 1) n.style.setProperty('--tok', Math.max(12, cell * 0.9) * sz + 'px');
      n.title = label + (c ? ` — ${c.hp}/${c.hpMax}` : ' — not in the initiative order');
      n.textContent = label.charAt(0).toUpperCase();
      // t.x/t.y are the token's CENTRE in stage pixels — that is the
      // convention the battle map stores (sktFreeCell returns cs/2 for the
      // first cell, and its own drop snaps to `floor(x/cs)*cs + cs/2`). The
      // extra half-cell here treated them as a corner, so every token was
      // drawn half a square down and to the right of where it stands: 3px at
      // this thumbnail's scale, enough to sit a creature off the road it is
      // standing on. `.tv-tok` already centres itself on this point with a
      // negative margin, so no half-cell belongs in the maths at all.
      n.style.left = (offX + ((t.x / cs) - vp.x) * cell) + 'px';
      n.style.top  = (offY + ((t.y / cs) - vp.y) * cell) + 'px';
      frag.appendChild(n);
    });
    rot.appendChild(frag);
  },

  // Pencil strokes onto the thumbnail's own canvas. Same k and offsets the
  // art uses, so a stroke lands on the same feature it was drawn over.
  _drawStrokes(cv, src, vp, cell, offX, offY, W, H){
    if (!cv) return;
    const list = src.drawings || [];
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.max(1, Math.round(W * dpr));
    cv.height = Math.max(1, Math.round(H * dpr));
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const ctx = cv.getContext('2d'); if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!list.length) return;
    const cs = src.cs || 50, k = cell / cs;
    const px = v => offX + (v / cs - vp.x) * cell;
    const py = v => offY + (v / cs - vp.y) * cell;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    list.forEach(s => {
      const p = s && s.p; if (!p || p.length < 4) return;
      ctx.strokeStyle = s.c || '#ff4040';
      // Widths are stage px; scaled down they vanish, so keep a hairline floor.
      ctx.lineWidth = Math.max(0.75, (s.s || 4) * k);
      ctx.beginPath();
      ctx.moveTo(px(p[0]), py(p[1]));
      for (let i = 2; i + 1 < p.length; i += 2) ctx.lineTo(px(p[i]), py(p[i + 1]));
      ctx.stroke();
    });
  },

  _renderPending(){
    const o = this._pending;
    if (!o) return '<div class="tv-react" hidden></div>';
    if (o.kind === 'move'){
      const opts = o.rows.map(w => `<button class="btn" data-tv="oa" data-id="${esc(w.id)}"
          title="${esc(w.name)} had ${esc(o.mover.name)} within ${this._reachOf(w)} ft">
          <span class="tv-react-who">${esc(w.name)}</span>Opportunity Attack</button>`).join('');
      return `<div class="tv-react"><span class="tv-react-l">Opportunity attack?</span>
        <span class="tv-react-note">${esc(o.mover.name)} moved ${o.moved} ft, out of reach</span>
        ${opts}<button class="btn primary" data-tv="oa" data-id="">No reaction</button></div>`;
    }
    const rows = this._gatherReactions(o);
    const opts = rows.map(({ who, r, ft, problem }) => {
      let preview = '';
      if (r.when === 'damage' && r.halve) preview = ` → ${Math.floor(o.dmg / 2)}`;
      if (r.when === 'damage' && r.reduce) preview = ` −${r.reduce[0]}d${r.reduce[1]}`;
      if (r.when === 'tohit' && r.ac)     preview = ` AC +${r.ac}`;
      if (r.when === 'tohit' && r.die)    preview = ` −d${r.die}`;
      if (r.when === 'tohit' && r.disadv) preview = ' disadv';
      if (r.when === 'tohit' && r.reroll) preview = ' reroll';
      const mine = who.id === o.target.id;
      const cost = this._costLabel(who, r);
      const far = mine || ft == null ? '' : ` ${ft} ft`;
      return `<button class="btn ${problem ? 'tv-cant' : ''}" data-tv="react" data-who="${esc(who.id)}"
                      data-key="${esc(r.key)}" ${problem ? 'disabled' : ''} title="${esc(r.note || '')}">
        ${mine ? '' : `<span class="tv-react-who">${esc(who.name)}</span>`}${esc(r.name)}${preview}
        <span class="tv-react-cost">${problem ? '· ' + esc(problem) : (cost ? '· ' + esc(cost) : '')}${esc(far)}</span>
      </button>`;
    }).join('');
    const waiting = state.prompt && state.prompt.id === this._promptId && !state.prompt.answer
      ? `<span class="tv-waiting">${ICO('i-monitor')}asked ${esc(state.prompt.offers.map(x => x.who)
          .filter((v, i, a) => a.indexOf(v) === i).join(', '))}</span>` : '';
    return `<div class="tv-react"><span class="tv-react-l">Reaction?</span>${waiting}
      <span class="tv-react-note">${esc(o.target.name)} ${o.hit ? `takes ${o.dmg} ${esc(o.type || 'damage')}` : 'was missed'}${
        o.total == null ? '' : ` — ${o.total} vs AC ${(o.target.ac || 0) + (o.acBonus || 0)}`}</span>
      ${opts}
      <button class="btn primary" data-tv="react" data-who="" data-key="__none">${o.hit ? `Take ${o.dmg}` : 'Let it miss'}</button>
    </div>`;
  },

  _setResult(html, live){ this._result = html; this._resultLive = !!live; },

  // ─── One step back ────────────────────────────────────────────────────────
  // Everything here writes through to the tracker and the party, so a misclick
  // on Roll was permanent and had to be unpicked with the −/+ stepper and
  // arithmetic. One snapshot, taken before a whole attack resolves, so undo
  // rewinds the attack AND any reaction spent answering it — the two are one
  // decision at the table and should be one step here.
  _snapshot(label){
    this._undo = {
      label,
      round: state.combatRound, active: state.activeCombatantId,
      combat: this._order().map(c => ({
        id:c.id, hp:c.hp, dead:c.dead, stable:c.stable, reactionUsed:c.reactionUsed,
        actionUsed:c.actionUsed, bonusUsed:c.bonusUsed, dodging:c.dodging,
        legendaryUsed:c.legendaryUsed,
        deathSaves: c.deathSaves ? {...c.deathSaves} : c.deathSaves,
        rechargeSpent: (c.rechargeSpent || []).slice(),
      })),
      party: (state.party || []).map(p => ({
        // hp was missing here, so undoing damage to a PC put the combatant
        // back and left the party card on the damaged number — the same two
        // records disagreeing that reconcilePcHp() exists to stop, arriving
        // through the undo door instead.
        id:p.id, tempHp:p.tempHp, hp:p.hp, hpMax:p.hpMax,
        // Damage to a wild-shaped druid drains the BEAST pool, and dropping
        // the beast to 0 clears the form outright — neither was undoable.
        wildshape: p.wildshape ? {...p.wildshape} : p.wildshape,
        resources: (p.resources || []).map(r => ({...r})),
        sheet: p.sheet && p.sheet.spellSlots ? JSON.parse(JSON.stringify(p.sheet.spellSlots)) : null,
      })),
    };
  },
  _undoLast(){
    const u = this._undo; if (!u) return;
    u.combat.forEach(s => {
      const c = this._order().find(x => x.id === s.id);
      if (c) Object.assign(c, s);
    });
    u.party.forEach(s => {
      const p = (state.party || []).find(x => x.id === s.id);
      if (!p) return;
      p.tempHp = s.tempHp;
      p.hp = s.hp; p.hpMax = s.hpMax;
      p.wildshape = s.wildshape ? {...s.wildshape} : s.wildshape;
      p.resources = s.resources.map(r => ({...r}));
      if (s.sheet && p.sheet) p.sheet.spellSlots = s.sheet;
    });
    state.combatRound = u.round;
    state.activeCombatantId = u.active;
    this._log.unshift(`<span style="opacity:.7">undid — ${esc(u.label)}</span>`);
    this._setResult(`<span class="dim">Undone: ${esc(u.label)}.</span>`);
    this._undo = null;
    this._pending = null;
    save();
    panelDefs.combat?._render?.(); panelDefs.party?._render?.();
    this._render();
  },

  // ─── Resolving an attack ──────────────────────────────────────────────────
  // A hit is held un-committed only when someone actually has an unused
  // reaction that could change it, so the common case stays two clicks.
  _resolve(o){
    o.kind = 'hit';
    if (o.hit && this._gatherReactions(o).length){ this._pending = o; this._publishPrompt(o); this._render(); return; }
    this._commit(o, null);
  },

  // ─── Pushed reactions ─────────────────────────────────────────────────────
  // The reason the rest of this exists. Everything needed was already here —
  // the derivation knows who can react and what it costs, the spend already
  // writes to shared state — so the only new thing is a place to put the
  // question and a way to hear the answer.
  //
  // One prompt at a time, matching what the DM's own bar already does: the
  // first reaction answered resolves the hit. Three decisions, stated because
  // they are rulings rather than mechanics:
  //
  //   Two players could answer     → first write wins, exactly as the first
  //                                  shout at the table would.
  //   DM commits while they decide → the prompt is cleared, and a late answer
  //                                  carrying a stale id is dropped.
  //   The DM's tab goes away       → a prompt older than five minutes is
  //                                  ignored, so nobody is left staring at a
  //                                  question that will never be answered.
  _publishPrompt(o){
    const rows = this._gatherReactions(o).filter(r => r.who.isPC && !r.problem);
    if (!rows.length){ return; }          // nobody's phone can answer this one
    state.prompt = {
      id: 'p_' + (typeof uid === 'function' ? uid() : String(Math.random()).slice(2)),
      ts: Date.now(),
      attacker: o.attacker, label: o.label,
      target: { id: o.target.id, name: o.target.name },
      hit: !!o.hit, total: o.total, ac: o.target.ac, dmg: o.dmg, type: o.type || '',
      offers: rows.map(({ who, r, ft }) => ({
        pcId: who.id, who: who.name, key: r.key, name: r.name,
        note: r.note || '', cost: this._costLabel(who, r) || '',
        ft: who.id === o.target.id ? 0 : ft,
        preview: r.when === 'damage' && r.halve ? `${o.dmg} → ${Math.floor(o.dmg / 2)}`
               : r.when === 'damage' && r.reduce ? `−${r.reduce[0]}d${r.reduce[1]}`
               : r.when === 'tohit' && r.ac ? `AC +${r.ac}`
               : r.when === 'tohit' && r.disadv ? 'disadvantage'
               : r.when === 'tohit' && r.reroll ? 'reroll'
               : r.when === 'tohit' && r.die ? `−d${r.die}` : '',
      })),
      answer: null,
    };
    this._promptId = state.prompt.id;
    save();
  },
  _clearPrompt(){
    if (!state.prompt) { this._promptId = null; return; }
    state.prompt = null;
    this._promptId = null;
    save();
  },
  // Called by the sync layer whenever the prompt key changes, from either end.
  _onPromptChange(){
    const p = state.prompt;
    if (!p || !p.answer) { if (this._body) this._render(); return; }
    // A late answer to a prompt this panel has already moved past.
    if (!this._pending || this._pending.kind !== 'hit' || p.id !== this._promptId){
      this._clearPrompt(); return;
    }
    const a = p.answer;
    this._promptId = null;
    state.prompt = null;                  // cleared before applying, so the
    this._log.unshift(                    // apply's own save() ships it away
      `<strong>${esc(a.who || 'A player')}</strong> answered from their own screen`);
    this._useReaction(a.pcId, a.key);
  },
  _commit(o, usedName){
    this._clearPrompt();          // whatever happens next, the question is closed
    const t = o.target;
    const tag = usedName ? ` <span class="dim">(${esc(usedName)})</span>` : '';
    // A save has no attack roll, so there is no "18 vs AC 16" to show.
    const vs = o.total == null ? ''
      : ` <strong>${o.total}</strong> <span class="dim">vs AC ${t.ac}${o.hitNote ? ' · ' + esc(o.hitNote) : ''}</span>`;
    this._pending = null;
    if (!o.hit){
      this._setResult(`<span class="miss">Miss</span> — ${esc(o.label)} vs ${esc(t.name)}:${vs}${tag}`, true);
      this._log.unshift(`<strong>${esc(o.attacker)}</strong> missed <strong>${esc(t.name)}</strong> with ${esc(o.label)}${usedName ? ' — ' + esc(usedName) : ''}`);
      save();
      if (o.queued && this._queue){ this._queue.misses++; this._advanceQueue(); return; }
      this._render(); return;
    }
    const before = t.hp;
    this._applyDamage(t, o.parts || [{ amt: o.dmg, type: o.type }], o.magical);
    const after = (this._order().find(x => x.id === t.id) || t).hp;
    const breakdown = o.detail ? ` <span class="dim">[${esc(o.detail)}]</span>` : '';
    // Every type, not just the first: "22 piercing" hid the fire half.
    const dmgText = (o.parts && o.parts.length > 1)
      ? o.parts.filter(p => p.amt).map(p => `${p.amt} ${esc(p.type)}`).join(' + ')
      : `${o.dmg} ${esc(o.type || 'damage')}`;
    this._setResult(`<span class="${o.crit ? 'crit' : o.save ? 'dim' : 'hit'}">${
        o.crit ? 'Critical hit' : o.save ? 'Save' : 'Hit'}</span> —
      ${esc(o.label)} vs ${esc(t.name)}:${vs}${vs ? ' ·' : ''}
      <strong>${dmgText}</strong>${breakdown}${tag}
      <span class="dim">· ${esc(t.name)} ${before} → ${after}</span>`, true);
    this._log.unshift(`<strong>${esc(o.attacker)}</strong> hit <strong>${esc(t.name)}</strong> for <strong>${o.dmg}</strong> ${esc(o.type || '')}${o.crit ? ' (crit)' : ''}${usedName ? ' — ' + esc(usedName) : ''} <span style="opacity:.7">· ${before} → ${after}</span>`);
    if (o.queued && this._queue){ this._queue.hits++; this._advanceQueue(); return; }
    this._render();
  },
  // Straight through the Combat Tracker, so resistances, immunities,
  // concentration checks, death saves and the party write-back all happen
  // exactly as they do when the damage is typed in there by hand.
  //
  // ONE CALL PER TYPE, which is not a detail. A young red dragon's bite is
  // 2d10+6 piercing PLUS 1d6 fire; _applyHpDelta resolves resistance against
  // the single type it is handed, so passing the sum under one label applied
  // the target's fire resistance to the piercing as well, or to neither. The
  // first version of this rolled both parts correctly and then threw the
  // second away — 17 piercing + 5 fire went in as "22 piercing".
  _applyDamage(target, parts, magical){
    const C = panelDefs.combat; if (!C) return;
    const prev = C._lastAtkProp;
    C._lastAtkProp = magical ? 'magical' : null;
    this._applying = true;
    try {
      parts.forEach(p => {
        const i = this._order().indexOf(target);   // re-find: the list can shift
        if (i < 0 || !p.amt) return;
        C._applyHpDelta(i, -p.amt, p.type || null);
      });
    } finally { C._lastAtkProp = prev; this._applying = false; }
    C._render?.();
  },
  // Damage parts, kept in step with the total. A reaction that halves the
  // damage halves each type — 5e halves "the attack's damage", and halving
  // per part is also what keeps the per-type application above honest.
  _scaleParts(o, fn){
    o.parts = (o.parts || [{ amt: o.dmg, type: o.type }]).map(p => ({ ...p, amt: fn(p.amt) }));
    o.dmg = o.parts.reduce((s, p) => s + p.amt, 0);
  },
  // A flat reduction (Spirit Shield's 2d6) comes off the largest part first.
  // 5e doesn't say how to split a reduction across damage types; taking it
  // off the biggest is the common ruling and the one that can't produce a
  // negative part.
  _reduceParts(o, n){
    o.parts = (o.parts || [{ amt: o.dmg, type: o.type }]).map(p => ({ ...p }));
    o.parts.sort((a, b) => b.amt - a.amt);
    let left = n;
    o.parts.forEach(p => { const take = Math.min(p.amt, left); p.amt -= take; left -= take; });
    o.dmg = o.parts.reduce((s, p) => s + p.amt, 0);
  },

  _useReaction(whoId, key){
    const o = this._pending; if (!o || o.kind !== 'hit') return;
    const who = this._order().find(c => c.id === whoId);
    const r = who && this._reactionsFor(who).find(x => x.key === key);
    if (!r) return;
    const problem = this._costProblem(who, r);
    if (problem){ this._setResult(`<span class="dim">${esc(who.name)} can't — ${esc(problem)}.</span>`, true); this._render(); return; }
    who.reactionUsed = true;
    const spent = this._payCost(who, r);
    const by = (who.id === o.target.id ? r.name : `${who.name}'s ${r.name}`) + (spent ? ` · ${spent}` : '');

    if (r.when === 'damage'){
      const was = o.dmg;
      if (r.halve) this._scaleParts(o, a => Math.floor(a / 2));
      else if (r.reduce){
        let n = 0; for (let i = 0; i < r.reduce[0]; i++) n += this._d(r.reduce[1]);
        this._reduceParts(o, n);
      }
      this._commit(o, `${by}, ${was} → ${o.dmg}`);
      return;
    }
    if (r.when === 'tohit'){
      // A to-hit reaction can turn a hit into a miss, so the roll is always
      // re-tested against AC rather than assumed still to land.
      let desc;
      if (r.ac != null){
        o.acBonus = (o.acBonus || 0) + r.ac; desc = `${by}, AC +${r.ac}`;
      } else if (r.disadv || r.reroll){
        // Nothing to reroll on a hand-entered total — the DM typed a number,
        // not a d20. Spend it and let them re-roll at the table.
        if (o.nat == null){ this._commit(o, `${by} — reroll it yourself`); return; }
        const n2 = this._d(20);
        const keep = r.disadv ? Math.min(o.nat, n2) : n2;
        desc = `${by}, ${o.nat}${r.disadv ? ' / ' : ' → '}${n2}${r.disadv ? ' → ' + keep : ''}`;
        o.nat = keep;
        o.total = keep + (o.bonus || 0);
        o.crit = keep === 20;
      } else {
        const sub = r.pb ? this._pb(r._lvl || (this._partyOf(who) || {}).level) : this._d(r.die);
        o.total -= sub; desc = `${by}, −${sub}`;
      }
      const ac = (o.target.ac || 0) + (o.acBonus || 0);
      // A natural 1 misses whatever the total says — which a reroll can now
      // produce, so the rule has to be applied here and not only at roll time.
      o.hit = o.crit || (o.nat !== 1 && o.total >= ac);
      this._commit(o, desc);
      return;
    }
    this._commit(o, by);   // no mechanics: spent, logged, the DM adjudicates
  },

  // `opts` lets an opportunity attack say who is swinging and at whom without
  // borrowing state.activeCombatantId to say it. Borrowing was a real bug:
  // _applyHpDelta calls save(), so the wrong creature's id reached
  // localStorage — the turn looked right on this screen and had moved to the
  // reactor everywhere the state syncs to.
  _rollAttack(ai, opts){
    const o = opts || {};
    const c = o.attacker || this._active();
    const t = o.target || this._order().find(x => x.id === this._armed);
    if (!t){ this._setResult('<span class="dim">Pick a target on the right first.</span>'); this._render(); return; }
    const a = this._attacksFor(c)[ai]; if (!a) return;
    this._snapshot(`${c.name} · ${a.name} → ${t.name}`);
    // Advantage and disadvantage, the most-used modifier in the game and the
    // one thing the panel had no way to express. Both dice are shown, because
    // a DM reading "18" wants to know it was 18 and 4.
    // 5e: ANY source of advantage and ANY source of disadvantage cancel to a
    // straight roll — they don't stack or net out. So the toggle and a dodging
    // target are collected as two booleans, not summed.
    const asked = o.mode != null ? o.mode : this._adv;
    const adv = asked > 0, dis = asked < 0 || !!t.dodging;
    const mode = (adv && dis) ? 0 : adv ? 1 : dis ? -1 : 0;
    let nat = this._d(20), hitNote = '';
    if (t.dodging) hitNote = adv ? 'dodge, cancelled by advantage' : 'target dodging';
    if (mode){
      const n2 = this._d(20);
      const keep = mode > 0 ? Math.max(nat, n2) : Math.min(nat, n2);
      hitNote = `${nat}/${n2} → ${keep} ${mode > 0 ? 'adv' : 'dis'}`
        + (t.dodging && mode < 0 ? ' (dodging)' : '');
      nat = keep;
    }
    if (a.recharge) this._markRechargeSpent(c, a.name);
    // A multiattack is one action for the whole sequence, not one per swing.
    if (!o.queued || (this._queue && this._queue.i === 0)) this._spend(c, 'actionUsed');
    const bonus = a.pc ? a.bonus : (parseInt(String(a.toHit || '').replace(/[^\d+-]/g, ''), 10) || 0);
    const total = nat + bonus;
    const crit = nat === 20;
    const hit = crit || (nat !== 1 && total >= (t.ac || 10));
    // Damage is carried as PARTS all the way to the tracker, never flattened.
    let parts = [], detail = '';
    const dbl = d => String(d).replace(/^(\d*)d/, (s, n) => (2 * (parseInt(n || '1'))) + 'd');
    if (a.pc){
      // "1d8+3 slashing" off the imported sheet.
      const m = String(a.dmgText).match(/(\d*d\d+(?:\s*[+-]\s*\d+)?)\s*(.*)/i);
      const dice = m ? m[1] : a.dmgText;
      const r = this._roll(crit ? dbl(dice) : dice);
      parts = [{ amt: r.total, type: (m && m[2] ? m[2] : '').trim().replace(/^damage\s*/i, '') }];
      detail = r.detail;
    } else {
      parts = (a.parts || []).map(pt => {
        const r = this._roll(crit ? dbl(pt.dice) : pt.dice);
        detail += (detail ? ' · ' : '') + pt.type + ' ' + r.detail;
        return { amt: r.total, type: pt.type };
      });
    }
    const dmg = parts.reduce((s, x) => s + x.amt, 0);
    this._resolve({ attackerId: c.id, attacker: c.name, label: o.label || a.name, target: t,
                    total, crit, hit, dmg, parts, queued: !!o.queued, nat, bonus, hitNote,
                    type: parts.length ? parts[0].type : '', detail,
                    magical: !a.pc && panelDefs.attacks && this._entryOf(c) && this._entryOf(c)._raw
                             ? panelDefs.attacks._parsed(this._entryOf(c)._raw).magical : false });
  },

  // ─── Multiattack ──────────────────────────────────────────────────────────
  // One swing at a time, each choosing its own target — which is why the queue
  // lives here rather than reusing the Attack Runner's chip bar: the target
  // list is already on screen, so a swing costs one click on the creature you
  // want it to hit. Damage is rolled AT each step, not all up front, so what
  // you see is what the target is about to take.
  _startMulti(){
    const c = this._active(); if (!c) return;
    const m = this._multiOf(c); if (!m || !m.plan.length) return;
    this._queue = { srcId: c.id, name: c.name, items: m.plan, i: 0, hits: 0, misses: 0 };
    this._setResult(`<span class="dim">Multiattack — <b>${esc(m.plan[0].name)}</b>: pick a target.</span>`);
    this._render();
  },
  _advanceQueue(){
    const q = this._queue; if (!q) return;
    q.i++;
    if (q.i >= q.items.length){ this._finishMulti(false); return; }
    this._setResultAppend(`<span class="dim"> · next <b>${esc(q.items[q.i].name)}</b></span>`);
    this._render();
  },
  _finishMulti(stopped){
    const q = this._queue; if (!q) return;
    this._log.unshift(`<strong>${esc(q.name)}</strong> Multiattack ${stopped ? 'stopped' : 'done'}`
      + ` — ${q.hits} hit${q.hits === 1 ? '' : 's'}` + (q.misses ? `, ${q.misses} missed` : ''));
    this._queue = null;
    this._render();
  },
  _setResultAppend(html){ this._result = (this._result || '') + html; },
  // A queue step: roll the current item at whoever was just clicked.
  _rollQueueStep(targetId){
    const q = this._queue; if (!q) return;
    const src = this._order().find(c => c.id === q.srcId);
    const t = this._order().find(c => c.id === targetId);
    const it = q.items[q.i];
    // The creature can leave the fight mid-sequence — killed by a reaction, or
    // removed by the DM. Abandon rather than throw.
    if (!src || !t || !it){ this._finishMulti(true); return; }
    this._rollAttack(it.ai, { attacker: src, target: t, queued: true });
  },

  // ─── Action economy ───────────────────────────────────────────────────────
  // A turn is an action, a bonus action, a reaction and movement, and the panel
  // modelled exactly one of them. These three are the ones with a yes/no answer
  // the panel can actually keep: the reaction flag already existed and the
  // tracker already draws it, so this reads the same field rather than a copy.
  //
  // Marked automatically when you roll something, and clickable, because a DM
  // does plenty the panel doesn't model and the pips have to be able to tell
  // the truth about it.
  _spend(c, what){ if (c && !c[what]) { c[what] = true; } },
  _renderEconomy(c){
    const pip = (key, label, title) =>
      `<button class="tv-econ ${c[key] ? 'spent' : ''}" data-tv="econ" data-k="${key}"
               title="${title}" aria-pressed="${!!c[key]}">${label}</button>`;
    // The six a DM actually reaches for. Dodge is the only one of them with a
    // mechanic this panel can enforce, so it is the only one that does more
    // than log — the rest are recorded and adjudicated, same rule as the
    // reactions with no mechanics.
    const acts = ['Dash', 'Disengage', 'Dodge', 'Help', 'Hide', 'Ready'];
    return `<div class="tv-econ-bar">
      ${pip('actionUsed', 'Action', 'This turn&rsquo;s action')}
      ${pip('bonusUsed', 'Bonus', 'This turn&rsquo;s bonus action')}
      ${pip('reactionUsed', 'Reaction', 'Refreshes at the start of its own turn')}
      <span class="tv-econ-sep"></span>
      ${acts.map(a => `<button class="btn tv-econ-act ${a === 'Dodge' && c.dodging ? 'primary' : ''}"
          data-tv="stdact" data-a="${a}"
          title="${a === 'Dodge' ? 'Attacks against this creature have disadvantage until the start of its next turn — applied automatically' : 'Take the ' + a + ' action: spends the action and logs it'}"
          >${a}</button>`).join('')}
    </div>`;
  },
  _takeStandardAction(name){
    const c = this._active(); if (!c) return;
    this._snapshot(`${c.name} · ${name}`);
    this._spend(c, 'actionUsed');
    if (name === 'Dodge'){
      c.dodging = true;
      this._setResult(`<strong>${esc(c.name)}</strong> takes the <strong>Dodge</strong> action —
        attacks against them have disadvantage until the start of their next turn.`, true);
    } else {
      this._setResult(`<strong>${esc(c.name)}</strong> takes the <strong>${esc(name)}</strong> action.`, true);
    }
    this._log.unshift(`<strong>${esc(c.name)}</strong> — ${esc(name)}`);
    save(); panelDefs.combat?._render?.(); this._render();
  },

  // Monster bonus actions, straight from the stat block. 543 of the 4,454
  // creatures in the loaded bestiary have them; a PC's live on their sheet and
  // there is nothing to derive, so the manual row covers those.
  _bonusActionsFor(c){
    if (c.isPC) return [];
    return this._rawList((this._entryOf(c) || {})._raw, ['bonus_actions', 'bonus']);
  },
  _renderBonusActions(c){
    const list = this._bonusActionsFor(c);
    if (!list.length) return '';
    return `<div class="tv-multi bonus">
      <span class="tv-multi-tag">Bonus</span>
      ${list.map((a, i) => `<button class="btn" data-tv="bonusact" data-ai="${i}"
          title="${esc(a.text)}">${esc(a.name)}</button>`).join('')}
    </div>`;
  },
  _useBonusAction(ai){
    const c = this._active(); if (!c) return;
    const a = this._bonusActionsFor(c)[ai]; if (!a) return;
    this._snapshot(`${c.name} · ${a.name}`);
    this._spend(c, 'bonusUsed');
    this._setResult(`<strong>${esc(c.name)}</strong> — <strong>${esc(a.name)}</strong>.
      <span class="dim">${esc(a.text)}</span>`, true);
    this._log.unshift(`<strong>${esc(c.name)}</strong> bonus action — ${esc(a.name)}`);
    save(); panelDefs.combat?._render?.(); this._render();
  },

  // ─── Recharge ─────────────────────────────────────────────────────────────
  // "Recharge 5–6" means the breath weapon is gone until a d6 says otherwise
  // at the start of the creature's next turn. Nothing tracked it, so the panel
  // would happily let a dragon breathe three rounds running.
  //
  // The roll happens automatically when the turn comes round, and is LOGGED
  // either way — a DM who wants to roll it at the table can see what it came
  // up as, and one who forgets doesn't get a free breath weapon. Keyed on the
  // round so a re-render can't roll it twice.
  _rechargeMin(v){ const m = String(v || '').match(/\d+/); return m ? parseInt(m[0], 10) : 6; },
  _markRechargeSpent(c, name){
    c.rechargeSpent = c.rechargeSpent || [];
    if (!c.rechargeSpent.includes(name)) c.rechargeSpent.push(name);
  },
  _rollRecharges(c){
    if (!c) return;
    if (c._rechRound === state.combatRound) return;
    // Stamp the round BEFORE the has-anything-spent check, not after. With the
    // check first, the first render of the turn returned early without
    // stamping, so firing the breath weapon and re-rendering rolled its
    // recharge in the same turn it was spent — the dragon breathed every round.
    c._rechRound = state.combatRound;
    if (!(c.rechargeSpent || []).length) return;
    const list = this._attacksFor(c);
    const still = [];
    c.rechargeSpent.forEach(name => {
      const a = list.find(x => x.name === name);
      const min = this._rechargeMin(a && a.recharge);
      const roll = this._d(6);
      if (roll >= min){
        this._log.unshift(`<strong>${esc(c.name)}</strong> — ${esc(name)} recharged <span style="opacity:.7">· d6 ${roll}</span>`);
      } else {
        still.push(name);
        this._log.unshift(`<strong>${esc(c.name)}</strong> — ${esc(name)} did not recharge <span style="opacity:.7">· d6 ${roll}</span>`);
      }
    });
    c.rechargeSpent = still;
  },

  // ─── Death saves ──────────────────────────────────────────────────────────
  // A downed PC's turn has exactly one legal action, and the panel was
  // offering attacks. The pips and the stabilise/die rules belong to the
  // tracker; this is the roll and the three shortcuts around it.
  _isDowned(c){ return !!(c && c.isPC && (c.hp || 0) <= 0 && !c.dead && !c.stable); },
  _renderDeathSaves(c){
    const ds = c.deathSaves || { success:0, fail:0 };
    const row = (kind, n) => Array.from({ length:3 }, (_, i) =>
      `<span class="tv-ds-pip ${kind} ${(ds[kind] || 0) > i ? 'on' : ''}"></span>`).join('');
    return `<div class="tv-actions"><div class="tv-death">
      <span class="tv-multi-tag">Death saves</span>
      <span class="tv-ds"><span class="tv-ds-l">✓</span>${row('success')}</span>
      <span class="tv-ds"><span class="tv-ds-l">✗</span>${row('fail')}</span>
      <button class="btn primary" data-tv="dsroll">${ICO('i-dice')}Roll</button>
      <button class="btn" data-tv="ds" data-kind="success" title="Record a success without rolling">+ ✓</button>
      <button class="btn" data-tv="ds" data-kind="fail" title="Record a failure without rolling">+ ✗</button>
      <span class="tv-note">A 20 brings them back at 1 HP; a 1 counts twice.</span>
    </div></div>`;
  },
  _rollDeathSave(){
    const c = this._active(); if (!this._isDowned(c)) return;
    this._snapshot(`${c.name} · death save`);
    const nat = this._d(20);
    const C = panelDefs.combat;
    if (nat === 20){
      // Back on their feet at 1 HP, saves cleared — the one result that isn't
      // just a pip.
      const i = this._order().indexOf(c);
      c.deathSaves = null;
      this._applying = true;
      try { C._applyHpDelta(i, 1, null); } finally { this._applying = false; }
      this._setResult(`<span class="hit">Natural 20</span> — <strong>${esc(c.name)}</strong> is conscious at 1 HP.`, true);
      this._log.unshift(`<strong>${esc(c.name)}</strong> death save — <strong>natural 20</strong>, up at 1 HP`);
    } else {
      const kind = nat >= 10 ? 'success' : 'fail';
      const n = nat === 1 ? 2 : 1;
      const outcome = C._addDeathSave(c.id, kind, n);
      const word = nat === 1 ? 'natural 1 — two failures' : (kind === 'success' ? 'success' : 'failure');
      this._setResult(`Death save <strong>${nat}</strong> — ${esc(word)}${
        outcome === 'stable' ? '. <span class="hit">Stable.</span>' :
        outcome === 'dead' ? '. <span class="miss">Dead.</span>' : '.'}`, true);
      this._log.unshift(`<strong>${esc(c.name)}</strong> death save <strong>${nat}</strong> — ${esc(word)}${outcome ? ' · ' + outcome : ''}`);
    }
    save(); C._render?.(); this._render();
  },

  // ─── Saving throws ────────────────────────────────────────────────────────
  // No attack roll to make, so no d20 and no to-hit reactions: the decision is
  // whether the target made its save. Halve BEFORE resistance and round down,
  // because 5e rounds down at each step and doing it after would hand a point
  // back.
  _rollSave(ai, half){
    const c = this._active();
    const t = this._order().find(x => x.id === this._armed);
    if (!t){ this._setResult('<span class="dim">Pick a target on the right first.</span>'); this._render(); return; }
    const a = this._attacksFor(c)[ai]; if (!a || !a.save) return;
    this._snapshot(`${c.name} · ${a.name} → ${t.name}`);
    if (a.recharge) this._markRechargeSpent(c, a.name);
    this._spend(c, 'actionUsed');
    let detail = '';
    const parts = (a.parts || []).map(pt => {
      const r = this._roll(pt.dice);
      const amt = half ? Math.floor(r.total / 2) : r.total;
      detail += (detail ? ' · ' : '') + pt.type + ' ' + r.detail + (half ? ' ÷2' : '');
      return { amt, type: pt.type };
    });
    this._resolve({
      attackerId: c.id, attacker: c.name, target: t, save: true,
      label: a.name + (half ? ' (saved)' : ' (failed)'),
      total: null, crit: false, hit: true, parts, detail,
      dmg: parts.reduce((s, x) => s + x.amt, 0),
      type: parts.length ? parts[0].type : '',
      magical: panelDefs.attacks && (this._entryOf(c) || {})._raw
               ? panelDefs.attacks._parsed(this._entryOf(c)._raw).magical : false,
    });
  },

  _manualAttack(){
    const b = this._body;
    const t = this._order().find(x => x.id === this._armed);
    if (!t){ this._setResult('<span class="dim">Pick a target on the right first.</span>'); this._render(); return; }
    const raw = parseInt(b.querySelector('[data-tvman="tohit"]').value, 10);
    const dmg = parseInt(b.querySelector('[data-tvman="dmg"]').value, 10);
    if (isNaN(dmg)){
      this._setResult('<span class="dim">Enter the damage.</span>'); this._render(); return;
    }
    // The attack total is OPTIONAL. Somebody rolling their own dice does not
    // come to this row to report a miss — they say "missed" and the turn moves
    // on — so requiring the number meant typing one in purely to get past the
    // check. Blank means it hit: no roll to compare, and _commit already omits
    // the "18 vs AC 16" clause when total is null, which is the same path a
    // saving throw takes. Filling it in still adjudicates against AC, because
    // letting the panel make that call is a legitimate reason to enter it.
    const rolled = !isNaN(raw);
    const type = (b.querySelector('[data-tvman="type"]').value || '').trim();
    const c = this._active();
    // Every other path that changes HP takes an undo snapshot — rolled
    // attacks, saves, death saves, the ±  adjuster. This one didn't, which
    // left the only route where the number is TYPED as the only route with no
    // way back. A stray zero here is the likeliest mistake in the panel.
    this._snapshot(`${c ? c.name : 'Someone'} · manual ${dmg}${type ? ' ' + type : ''} → ${t.name}`);
    this._resolve({ attackerId: c && c.id, attacker: c ? c.name : 'Someone', label: 'attack', target: t,
                    total: rolled ? raw : null, crit: false,
                    hit: rolled ? raw >= (t.ac || 10) : true, dmg, type, detail: '' });
  },

  _adjust(sign){
    const t = this._order().find(x => x.id === this._armed); if (!t) return;
    const el = this._body.querySelector('[data-tvadj="amt"]');
    const n = Math.abs(parseInt(el && el.value, 10) || 0); if (!n) return;
    this._snapshot(`${t.name} ${sign < 0 ? '−' : '+'}${n}`);
    const before = t.hp;
    const C = panelDefs.combat; if (!C) return;
    const i = this._order().indexOf(t);
    this._applying = true;
    try { C._applyHpDelta(i, sign < 0 ? -n : n, null); } finally { this._applying = false; }
    C._render?.();
    const after = (this._order().find(x => x.id === t.id) || t).hp;
    const word = sign < 0 ? 'took' : 'regained';
    this._setResult(`<span class="dim">${esc(t.name)} ${word} <strong>${n}</strong> — ${before} → ${after}</span>`, true);
    this._log.unshift(`<strong>${esc(t.name)}</strong> ${word} <strong>${n}</strong> <span style="opacity:.7">· ${before} → ${after}</span>`);
    this._render();
  },

  // ─── Opportunity attacks ──────────────────────────────────────────────────
  // The one reaction triggered by movement rather than by a roll, which is why
  // the hit prompt could never house it. Its home is the map.
  _provokedBy(mover, fromXY){
    const cs = this._cs() || 50;
    const at = { x: fromXY.x, y: fromXY.y };
    const ft = (t, q) => Math.round(Math.max(Math.abs(t.x - q.x), Math.abs(t.y - q.y)) / cs) * 5;
    const now = this._tokenFor(mover);
    if (!now) return [];
    return this._order().filter(c => {
      if (c.id === mover.id || (c.hp || 0) <= 0 || c.reactionUsed) return false;
      if (this._sideOf(c) === this._sideOf(mover)) return false;
      const t = this._tokenFor(c); if (!t) return false;
      const reach = this._reachOf(c);
      return ft(t, at) <= reach && ft(t, now) > reach;   // had them, doesn't now
    });
  },
  _useOA(whoId){
    const o = this._pending; if (!o || o.kind !== 'move') return;
    const who = this._order().find(c => c.id === whoId);
    this._pending = null;
    if (!who){ this._render(); return; }
    who.reactionUsed = true;
    const list = this._attacksFor(who);
    const melee = list.find(a => !a.save && (a.pc ? a.dmgText : (a.parts || []).length));
    if (melee){
      // Attacker and target passed explicitly. An opportunity attack takes
      // nobody's turn, so the turn pointer must not move even for an instant —
      // _applyHpDelta saves, and a borrowed pointer got written to storage.
      this._rollAttack(list.indexOf(melee),
        { attacker: who, target: o.mover, label: melee.name + ' (opportunity attack)' });
      return;
    }
    this._setResult(`<strong>${esc(who.name)}</strong> takes an opportunity attack on
      <strong>${esc(o.mover.name)}</strong> <span class="dim">— roll it, then use the manual row
      or the −/+ under the target list.</span>`, true);
    this._log.unshift(`<strong>${esc(who.name)}</strong> opportunity attack on <strong>${esc(o.mover.name)}</strong> <span style="opacity:.7">· reaction spent</span>`);
    save(); this._render();
  },

  // ─── Initiative, add and remove ───────────────────────────────────────────
  // All four delegate to the Combat Tracker rather than reimplementing it. Its
  // _removeCombatantAt already handles passing the turn on and ticking the
  // round when the last creature in the order leaves; a second implementation
  // here would be a second set of those bugs.
  _setInit(id, v){
    const c = this._order().find(x => x.id === id);
    if (!c || isNaN(v)) return;
    c.initiative = v;
    panelDefs.combat?._sortByInitiative?.(true);
    save(); panelDefs.combat?._render?.(); this._render();
  },
  _rollNpcInit(){
    this._order().forEach(c => {
      if (c.isPC) return;
      c.initiative = this._d(20) + (c.initBonus || 0);
    });
    panelDefs.combat?._sortByInitiative?.(true);
    this._setResult('<span class="dim">Rolled initiative for '
      + this._order().filter(c => !c.isPC).map(c => esc(c.name) + ' ' + c.initiative).join(', ') + '.</span>', true);
    save(); panelDefs.combat?._render?.(); this._render();
  },
  _addCombatant(){
    const b = this._body;
    const g = k => b.querySelector(`[data-tvadd="${k}"]`);
    const name = (g('name').value || '').trim();
    if (!name){ this._setResult('<span class="dim">Give the combatant a name.</span>'); this._render(); return; }
    const iv = parseInt(g('init').value, 10);
    const hp = Math.max(1, parseInt(g('hp').value, 10) || 10);
    const ac = Math.max(1, parseInt(g('ac').value, 10) || 10);
    state.combatants.push({ id: uid(), name, isPC: false, hp, hpMax: hp, ac,
                            initBonus: 0, initiative: isNaN(iv) ? this._d(20) : iv, conditions: [] });
    if (!state.combatRound) state.combatRound = 1;
    panelDefs.combat?._sortByInitiative?.(true);
    ['name','init','hp','ac'].forEach(k => { g(k).value = ''; });
    this._log.unshift(`<strong>${esc(name)}</strong> joined the fight`);
    this._setResult(`<span class="dim"><strong>${esc(name)}</strong> added, ${hp} HP.</span>`, true);
    save(); panelDefs.combat?._render?.(); this._render();
    this._body.querySelector('[data-tvadd="name"]')?.focus();
  },
  _removeCombatant(id){
    const C = panelDefs.combat; if (!C) return;
    const i = this._order().findIndex(c => c.id === id); if (i < 0) return;
    const gone = this._order()[i];
    if (this._armed === id) this._armed = null;
    if (this._pending && ((this._pending.target && this._pending.target.id === id)
                       || (this._pending.mover && this._pending.mover.id === id))) this._pending = null;
    C._removeCombatantAt(i);
    this._log.unshift(`<strong>${esc(gone.name)}</strong> left the fight`);
    save(); C._render?.(); this._render();
  },
  _endTurn(){
    if (this._pending){ showToast('Resolve the reaction first'); return; }
    this._clearPrompt();
    if (this._queue) this._finishMulti(true);   // the turn ends, so the sequence does
    // Advantage was set for THIS turn (Reckless Attack, a prone target), and
    // an undo that reaches back across a turn boundary would rewind the turn
    // pointer too. Both end here.
    this._adv = 0; this._undo = null;
    this._armed = null;
    this._setResult('');
    panelDefs.combat?._nextTurn?.();
    this._render();
  },

  // ─── Interaction ──────────────────────────────────────────────────────────
  _wire(){
    const b = this._body; if (!b || b._tvWired) return;
    b._tvWired = true;

    b.addEventListener('click', e => {
      // The class row is the Party panel's own markup, which speaks data-act
      // rather than data-tv. Checked before the data-tv lookup because those
      // buttons carry no data-tv at all and would otherwise be inert.
      const cls = e.target.closest('[data-act]');
      if (cls && cls.closest('.tv-classrow')){
        if (this._classAction(cls.dataset.act, +cls.dataset.idx)) return;
      }
      const el = e.target.closest('[data-tv]'); if (!el) return;
      const act = el.dataset.tv;
      if (act === 'jump'){
        // Jumping to a pip makes it that creature's turn, so their reaction
        // comes back with it — same rule as advancing normally.
        state.activeCombatantId = el.dataset.id;
        panelDefs.combat?._refreshTurnEconomy?.(el.dataset.id);
        this._armed = null; save(); panelDefs.combat?._render?.(); this._render();
      }
      else if (act === 'mapzoom'){ this._zoomMap(+el.dataset.d); }
      else if (act === 'initedit'){ this._editInit = true;  this._render(); }
      else if (act === 'initdone'){ this._editInit = false; this._render(); }
      else if (act === 'rollinit'){ this._rollNpcInit(); }
      else if (act === 'add'){ this._addCombatant(); }
      else if (act === 'rm'){ this._removeCombatant(el.dataset.id); }
      else if (act === 'arm'){
        this._armed = el.dataset.id;
        // Mid-multiattack, clicking a target IS the swing — the target list is
        // already the thing you were reaching for.
        if (this._queue) this._rollQueueStep(el.dataset.id); else this._render();
      }
      // Shift/Alt on a Roll matches the Party panel's attack rows, which have
      // worked that way since before this panel existed.
      else if (act === 'roll'){
        const mode = e.shiftKey ? 1 : (e.altKey ? -1 : null);
        this._rollAttack(+el.dataset.ai, mode == null ? undefined : { mode });
      }
      else if (act === 'adv'){ this._adv = +el.dataset.v; this._render(); }
      else if (act === 'econ'){
        const cur = this._active();
        if (cur){ cur[el.dataset.k] = !cur[el.dataset.k]; save(); panelDefs.combat?._render?.(); this._render(); }
      }
      else if (act === 'stdact'){ this._takeStandardAction(el.dataset.a); }
      else if (act === 'bonusact'){ this._useBonusAction(+el.dataset.ai); }
      else if (act === 'undo'){ this._undoLast(); }
      else if (act === 'dsroll'){ this._rollDeathSave(); }
      else if (act === 'ds'){
        const c = this._active();
        if (this._isDowned(c)){
          this._snapshot(`${c.name} · death save`);
          const outcome = panelDefs.combat._addDeathSave(c.id, el.dataset.kind, 1);
          this._log.unshift(`<strong>${esc(c.name)}</strong> death save recorded — ${esc(el.dataset.kind)}${outcome ? ' · ' + outcome : ''}`);
          save(); panelDefs.combat._render?.(); this._render();
        }
      }
      else if (act === 'save'){ this._rollSave(+el.dataset.ai, el.dataset.half === '1'); }
      else if (act === 'multi'){ this._startMulti(); }
      else if (act === 'legend'){ this._useLegendary(el.dataset.id, +el.dataset.ai); }
      else if (act === 'qmiss'){ if (this._queue){ this._queue.misses++; this._advanceQueue(); } }
      else if (act === 'qstop'){ this._finishMulti(true); }
      else if (act === 'manual'){ this._manualAttack(); }
      else if (act === 'adj'){ this._adjust(+el.dataset.sign); }
      else if (act === 'end'){ this._endTurn(); }
      else if (act === 'oa'){ if (el.dataset.id) this._useOA(el.dataset.id); else { this._pending = null; this._render(); } }
      else if (act === 'react'){
        const k = el.dataset.key;
        if (k === '__none') this._commit(this._pending, null);
        else this._useReaction(el.dataset.who, k);
      }
    });

    // change, not input — re-sorting on every keystroke would rip the field out
    // from under the cursor halfway through typing "12".
    b.addEventListener('change', e => {
      const f = e.target.closest('[data-tvinit]');
      if (f) this._setInit(f.dataset.tvinit, parseInt(f.value, 10));
    });
    b.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.closest('.tv-init-add')){ e.preventDefault(); this._addCombatant(); }
    });

    // Map: enlarge on approach so it is already the right size by the time the
    // cursor arrives, and stay big while dragging or it would collapse under
    // the pointer mid-drag.
    // pointerenter/pointerleave fire for EVERY descendant, not just the box —
    // so crossing onto a token raised an enter and crossing off it raised a
    // leave while the cursor had never left the map. The panel duly collapsed,
    // which re-ran _placeTokens, which destroyed and rebuilt the node under
    // the cursor, which raised another pair: the map flickered open and shut
    // for as long as you moved over it. Only act when the pointer has actually
    // crossed the box's own boundary.
    // The wheel is what a hand reaches for on a map. passive:false because it
    // has to preventDefault — otherwise the panel scrolls under the pointer at
    // the same time and the zoom is unusable.
    b.addEventListener('wheel', e => {
      const map = e.target.closest && e.target.closest('.tv-map'); if (!map) return;
      e.preventDefault();
      this._zoomMap(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });

    const leftTheMap = (map, to) => !to || !map.contains(to);
    b.addEventListener('pointerenter', e => {
      if (!this._canExpandMap()) return;
      const map = e.target.closest && e.target.closest('.tv-map'); if (!map) return;
      if (!leftTheMap(map, e.relatedTarget)) return;   // moved WITHIN the map
      if (!this._mapBig){ this._mapBig = true; this._reflowMap(); }
    }, true);
    b.addEventListener('pointerleave', e => {
      const map = e.target.closest && e.target.closest('.tv-map'); if (!map) return;
      if (!leftTheMap(map, e.relatedTarget)) return;
      // relatedTarget is null when the pointer leaves the window OR when the
      // element under it was just re-rendered, so fall back to geometry: if
      // the cursor is still inside the (now larger) box, it hasn't left.
      if (e.relatedTarget == null && e.clientX != null){
        const r = map.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right &&
            e.clientY >= r.top  && e.clientY <= r.bottom) return;
      }
      if (this._mapBig && !this._drag){ this._mapBig = false; this._reflowMap(); }
    }, true);

    b.addEventListener('pointerdown', e => {
      const t = e.target.closest('.tv-tok'); if (!t) return;
      // Read-only when the battle map hasn't mounted — see _mapSrc.
      if (!this._map().live){ showToast('Open the Battle Map to move tokens'); return; }
      // Tokens with no combatant are draggable too — they are on the map, so
      // they are part of the picture — they just can't provoke anything.
      const c = t.dataset.tvtok ? this._order().find(x => x.id === t.dataset.tvtok) : null;
      const tok = c ? this._tokenFor(c)
                    : this._map().tokens.find(x => x.label === t.dataset.tvlabel);
      if (!tok) return;
      this._drag = { id: c ? c.id : null, tok, from: { x: tok.x, y: tok.y } };
      try { t.setPointerCapture(e.pointerId); } catch(err){}
      e.preventDefault();
    });
    b.addEventListener('pointermove', e => {
      if (!this._drag) return;
      const m = b.querySelector('.tv-map'); if (!m) return;
      const tok = this._drag.tok; if (!tok) return;
      const src = this._map(), vp = this._viewport(), r = m.getBoundingClientRect();
      const cs = src.cs || 50;
      // Undo the map's rotation before doing any cell maths. The pointer is in
      // screen space and the layout inside .tv-map-rot is not, so on a turned
      // map the un-rotated version dropped tokens on the wrong axis entirely.
      // Measured from the box CENTRE because that is the transform origin.
      const deg = src.rotation || 0;
      const quarter = deg === 90 || deg === 270;
      // getBoundingClientRect INCLUDES the 1px border; _placeTokens lays out
      // against clientWidth/clientHeight, which does not. Mixing the two put
      // every drop about a pixel off what the eye had aimed at. Measure the
      // content box, exactly as the drawing does.
      const boxW = m.clientWidth, boxH = m.clientHeight;
      const bx = (r.width - boxW) / 2, by = (r.height - boxH) / 2;
      const W = quarter ? boxH : boxW, H = quarter ? boxW : boxH;
      const sx = e.clientX - r.left - bx - boxW / 2;
      const sy = e.clientY - r.top  - by - boxH / 2;
      const un = deg === 90  ? { x:  sy, y: -sx }
               : deg === 180 ? { x: -sx, y: -sy }
               : deg === 270 ? { x: -sy, y:  sx }
               :               { x:  sx, y:  sy };
      const lx = un.x + W / 2, ly = un.y + H / 2;
      // Same letterbox the tokens are drawn with, or the drop lands a square
      // off wherever the black bars are.
      const cell = Math.min(W / vp.w, H / vp.h);
      const offX = (W - cell * vp.w) / 2, offY = (H - cell * vp.h) / 2;
      // Free placement unless the map itself asks for snapping. Forcing a
      // square snap here was wrong twice over: it overrode the DM's own
      // setting, and this campaign's map is a HEX grid, so the lattice being
      // snapped to is not the one printed on the map.
      if (!src.snap){
        const fx = vp.x + (lx - offX) / cell, fy = vp.y + (ly - offY) / cell;
        tok.x = Math.max(0, Math.min(src.cols, fx)) * cs;
        tok.y = Math.max(0, Math.min(src.rows, fy)) * cs;
        this._placeTokens();
        return;
      }
      const cx = vp.x + Math.floor((lx - offX) / cell);
      const cy = vp.y + Math.floor((ly - offY) / cell);
      // Snap to the CENTRE of the dropped cell, the same convention the battle
      // map's own drop uses. Writing the corner put the token half a square up
      // and to the left of the square it was dropped on, on the real map —
      // this is the panel writing through to shared state, so the error was
      // not cosmetic.
      tok.x = (Math.max(0, Math.min(src.cols - 1, cx)) + 0.5) * cs;
      tok.y = (Math.max(0, Math.min(src.rows - 1, cy)) + 0.5) * cs;
      this._placeTokens();
    });
    b.addEventListener('pointerup', () => {
      const d = this._drag; if (!d) return;
      this._drag = null;
      const B = this._bm();
      const mover = d.id ? this._order().find(x => x.id === d.id) : null;
      const tok = d.tok;
      // Write through to the battle map — this IS its token, so the panel and
      // the map can't disagree about where anyone is standing.
      B?._renderTokens?.(); B?._saveMap?.();
      // A token with no combatant can be moved but can't provoke — there is
      // nobody in the order for the opportunity attack to belong to.
      const moved = tok && (tok.x !== d.from.x || tok.y !== d.from.y);
      if (moved && mover && !this._pending){
        const rows = this._provokedBy(mover, d.from);
        if (rows.length){
          const cs = this._cs() || 50;
          const ft = Math.round(Math.max(Math.abs(tok.x - d.from.x), Math.abs(tok.y - d.from.y)) / cs) * 5;
          this._pending = { kind:'move', mover, rows, moved: ft };
        }
      }
      this._render();
    });
  },

  // The enlarge is a class swap, but token offsets are computed from the box's
  // pixel size — so they have to be recomputed once it has the new one.
  // dir: -1 out, +1 in, 0 back to the automatic frame. Steps through a fixed
  // ladder rather than multiplying, so the readout is always a round number
  // and repeated clicks can't drift to 137%.
  _zoomMap(dir){
    const L = this._MAP_ZOOMS;
    if (!dir){ this._mapZoom = 1; }
    else {
      let i = L.indexOf(this._mapZoom);
      if (i < 0){ i = L.indexOf(1); }
      this._mapZoom = L[Math.max(0, Math.min(L.length - 1, i + dir))];
    }
    this._vp = null;              // the frame is derived, so drop the cache
    this._placeTokens();
    const rd = this._body && this._body.querySelector('.tv-map-zoom [data-d="0"]');
    if (rd){
      rd.textContent = this._mapZoom === 1 ? 'fit' : Math.round(this._mapZoom * 100) + '%';
      rd.classList.toggle('off', this._mapZoom === 1);
    }
  },

  _reflowMap(){
    const b = this._body; if (!b) return;
    const m = b.querySelector('.tv-map'); if (!m) return;
    m.classList.toggle('big', this._mapBig);
    const h = m.querySelector('.tv-map-hint');
    if (h) h.textContent = this._mapBig ? 'drag a token — reach updates live, and leaving it provokes'
                                        : (matchMedia('(pointer: coarse)').matches ? 'tap to enlarge' : 'hover to enlarge');
    // .tv-map ANIMATES its width and height over 160ms. One rAF lands in the
    // middle of that, so _placeTokens measured a box part-way through growing
    // and laid the art, the strokes and every token out at that stale size —
    // the enlarged map ended up with its contents stuck in a small patch of a
    // wide empty box. Place once immediately so the change is instant, then
    // again when the transition actually finishes.
    requestAnimationFrame(() => this._placeTokens());
    const settle = e => {
      if (e.target !== m || (e.propertyName !== 'width' && e.propertyName !== 'height')) return;
      m.removeEventListener('transitionend', settle);
      this._placeTokens();
    };
    m.addEventListener('transitionend', settle);
    // A belt-and-braces re-place: transitionend never fires if the size did
    // not actually change (already at that width) or if the panel is hidden.
    clearTimeout(this._reflowT);
    this._reflowT = setTimeout(() => this._placeTokens(), 220);
  },
});
